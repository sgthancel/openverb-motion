/**
 * Turning a GeoStory into a video file, in the browser.
 *
 * Not on the server: rendering a map means rasterising tiles, which means a
 * browser, and a serverless function cannot hold a headless one open for the
 * minutes a story takes. The browser that is already showing the story has
 * everything needed, so the work happens where the story is.
 *
 * Frames come from lib/geostory/raster, which draws the same picture the
 * preview does. This file is only the encoder: it walks the timeline, hands
 * each frame over, and collects a file.
 *
 * Rendering is not realtime. Frames are produced as fast as tiles arrive and
 * stamped with the time they belong to, so a slow machine makes a slow
 * export rather than a stuttering video.
 */
import type { GeoStoryDocument } from "@openverb/geostory"
import { attributionFor, totalDuration } from "./timeline"
import { renderFrame, tileSourcesFor } from "./raster"
import {
  buildTrack,
  generateNarration,
  withMeasuredTiming,
  type VoiceName,
} from "./narrate"

export interface ExportOptions {
  document: GeoStoryDocument
  width: number
  height: number
  fps: number
  /** Burn captions into the picture. On by default. */
  captions?: boolean
  /** Credit the basemap in the corner. On by default, and usually required. */
  credit?: boolean
  /**
   * Speak the narration into the file. The scenes are then retimed around
   * how long each line actually took.
   */
  narrate?: boolean
  voice?: VoiceName
  /**
   * Where the document came from, so a relative asset `src` resolves
   * against it. Without it the live canvas drew the pictures and the
   * exported file quietly did not, because only the preview was passing
   * this through.
   */
  baseUrl?: string
  signal?: AbortSignal
  onProgress?: (rendered: number, total: number) => void
  /** Called while the narration is being generated, before any frames. */
  onNarrating?: (done: number, total: number) => void
}

export interface ExportResult {
  blob: Blob
  extension: "mp4" | "webm"
  frames: number
  seconds: number
  /** True when an audio track was written. */
  narrated: boolean
  /** Scenes that have words but whose narration could not be generated. */
  silentScenes: string[]
}

export const RESOLUTIONS = {
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
  "4K": { width: 3840, height: 2160 },
  "square": { width: 1080, height: 1080 },
  "vertical": { width: 1080, height: 1920 },
} as const

export type ResolutionName = keyof typeof RESOLUTIONS

/** Can this browser encode video at all? */
export function canExport(): boolean {
  return typeof window !== "undefined" && typeof window.VideoEncoder === "function"
}

class Aborted extends Error {
  constructor() {
    super("Export cancelled")
    this.name = "Aborted"
  }
}

/**
 * Render the whole document and hand back a file.
 *
 * mediabunny is imported here rather than at the top of the module because it
 * is ten megabytes of media toolkit, and nobody who merely watches a story
 * should have to download an encoder first.
 */
export async function exportVideo({
  document: original,
  width,
  height,
  fps,
  captions = true,
  credit = true,
  narrate = false,
  voice = "documentary",
  signal,
  onProgress,
  onNarrating,
  baseUrl,
}: ExportOptions): Promise<ExportResult> {
  if (!canExport()) {
    throw new Error(
      "This browser cannot encode video. Chrome or Edge can; Safari and Firefox do not expose the encoder yet."
    )
  }

  const {
    Output,
    Mp4OutputFormat,
    WebMOutputFormat,
    BufferTarget,
    CanvasSource,
    AudioBufferSource,
    Quality,
    getFirstEncodableVideoCodec,
    getFirstEncodableAudioCodec,
  } = await import("mediabunny")

  // Narration first, because it decides how long every scene is. Rendering
  // frames against the authored estimate and then discovering the speech
  // runs longer would put the picture and the voice permanently out of step.
  let doc = original
  let track: AudioBuffer | null = null
  let silentScenes: string[] = []

  if (narrate) {
    const { voices, missing } = await generateNarration(original, {
      voice,
      signal,
      onProgress: onNarrating,
    })
    silentScenes = missing
    if (voices.length) {
      doc = withMeasuredTiming(original, voices)
      track = buildTrack(doc, voices)
    }
  }

  // H.264 in MP4 if the machine can, because that is the file that plays
  // everywhere and uploads without being transcoded. VP9 in WebM otherwise,
  // which is a real file rather than a failure.
  const codec = await getFirstEncodableVideoCodec(["avc", "vp9", "vp8"], {
    width,
    height,
  })
  if (!codec) {
    throw new Error("This browser has no video encoder we can use")
  }

  const mp4 = codec === "avc"
  const output = new Output({
    format: mp4 ? new Mp4OutputFormat() : new WebMOutputFormat(),
    target: new BufferTarget(),
  })

  const canvas = window.document.createElement("canvas")
  canvas.width = width
  canvas.height = height

  const source = new CanvasSource(canvas, {
    codec,
    quality: new Quality("high"),
  })
  output.addVideoTrack(source)

  // Added before start(), which is the only time tracks may be added.
  let audio: InstanceType<typeof AudioBufferSource> | null = null
  if (track) {
    const audioCodec = await getFirstEncodableAudioCodec(
      mp4 ? ["aac", "opus"] : ["opus", "vorbis"],
      { numberOfChannels: track.numberOfChannels, sampleRate: track.sampleRate }
    )
    if (audioCodec) {
      audio = new AudioBufferSource({
        codec: audioCodec,
        quality: new Quality("high"),
      })
      output.addAudioTrack(audio)
    }
  }

  const seconds = totalDuration(doc)
  const total = Math.max(1, Math.ceil(seconds * fps))
  const step = 1 / fps

  const tiles = tileSourcesFor(doc)
  const attribution = credit ? attributionFor(doc).join(" · ") : undefined

  await output.start()

  try {
    // The whole narration in one buffer, so silence between lines is real
    // samples and the voice stays pinned to the picture.
    if (audio && track) await audio.add(track)

    for (let frame = 0; frame < total; frame++) {
      if (signal?.aborted) throw new Aborted()

      await renderFrame({
        document: doc,
        seconds: frame * step,
        width,
        height,
        tiles,
        captions,
        attribution,
        chrome: true,
        // The same canvas every frame: CanvasSource reads it at add() time,
        // so a fresh canvas each frame would be encoding an empty one.
        canvas,
        baseUrl,
      })

      // Awaited, so that a machine which encodes slower than it draws applies
      // backpressure instead of filling memory with queued frames.
      await source.add(frame * step, step)

      onProgress?.(frame + 1, total)
    }

    await output.finalize()
  } catch (problem) {
    // Without this the encoder keeps its workers and its buffer alive after a
    // cancelled export, and a second attempt starts against a busy machine.
    await output.cancel().catch(() => {})
    throw problem
  }

  const buffer = output.target.buffer
  if (!buffer) throw new Error("The encoder produced nothing")

  return {
    blob: new Blob([buffer], { type: mp4 ? "video/mp4" : "video/webm" }),
    extension: mp4 ? "mp4" : "webm",
    frames: total,
    seconds,
    narrated: audio !== null,
    silentScenes,
  }
}

/** A filename from the story's own title. */
export function fileNameFor(doc: GeoStoryDocument, extension: string): string {
  const base =
    (doc.story?.title || doc.name || "geostory")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "geostory"
  return `${base}.${extension}`
}
