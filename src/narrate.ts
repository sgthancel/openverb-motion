/**
 * Real narration for the exported file.
 *
 * The live player speaks with the browser's own voice, which cannot be
 * recorded - speechSynthesis hands back no stream - so an exported video made
 * from what the player does is necessarily silent. This generates the
 * narration properly instead, as audio, which can then be measured and muxed.
 *
 * Measuring is the part that matters beyond sound. `timing: {mode: derived}`
 * has always meant "as long as the narration turns out to be", and until
 * something actually produced the narration there was nothing to measure, so
 * every derived scene fell back to the author's estimate. Scenes ran short and
 * cut sentences in half. With real audio the estimate is replaced by the
 * truth and the timeline is rebuilt around it.
 */
import type { GeoStoryDocument, GeoStoryScene } from "@openverb/geostory"
import { narrationFor, sceneWindows, totalDuration } from "./timeline"
import { FADE_RAMP } from "./narration-clock"

/** A beat of silence after each line, so scenes do not butt together. */
export const BREATH = 0.45

export type VoiceName = "documentary" | "educational" | "default" | "casual"

export interface SceneVoice {
  sceneId: string
  buffer: AudioBuffer
  seconds: number
}

export interface NarrationResult {
  voices: SceneVoice[]
  /** Scenes that have words but came back with no audio. */
  missing: string[]
}

function audioContext(): AudioContext {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext
  return new Ctor()
}

/**
 * Speak every scene that has words.
 *
 * The voice route answers `success: true` with an empty url when it fails or
 * has no key, so that callers degrade quietly. Here that would be the worst
 * possible outcome - a file announced as having narration that plays in
 * silence - so an empty url is treated as the failure it is and named.
 */
export async function generateNarration(
  doc: GeoStoryDocument,
  {
    voice = "documentary",
    signal,
    onProgress,
  }: {
    voice?: VoiceName
    signal?: AbortSignal
    onProgress?: (done: number, total: number) => void
  } = {}
): Promise<NarrationResult> {
  const spoken = (doc.scenes ?? [])
    .map((scene) => ({ scene, text: narrationFor(doc, scene) }))
    .filter((row): row is { scene: GeoStoryScene; text: string } =>
      Boolean(row.text?.trim())
    )

  const context = audioContext()
  const voices: SceneVoice[] = []
  const missing: string[] = []

  try {
    for (const [index, { scene, text }] of spoken.entries()) {
      if (signal?.aborted) throw new Error("Export cancelled")

      const response = await fetch("/api/generate-voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice }),
        signal,
      })

      if (!response.ok) {
        missing.push(scene.id)
        onProgress?.(index + 1, spoken.length)
        continue
      }

      const data = (await response.json()) as { audioUrl?: string }
      if (!data.audioUrl) {
        // The route's quiet degradation. Not quiet here.
        missing.push(scene.id)
        onProgress?.(index + 1, spoken.length)
        continue
      }

      const bytes = await fetch(data.audioUrl).then((r) => r.arrayBuffer())
      const buffer = await context.decodeAudioData(bytes)

      voices.push({
        sceneId: scene.id,
        buffer,
        // The real length, not the route's word-count estimate.
        seconds: buffer.duration,
      })
      onProgress?.(index + 1, spoken.length)
    }
  } finally {
    void context.close().catch(() => {})
  }

  return { voices, missing }
}

/**
 * The document retimed around how long the narration actually took.
 *
 * A copy: the document on screen belongs to whoever is looking at it, and an
 * export should not silently rewrite the story's timings underneath them.
 *
 * A `fixed` scene keeps the length its author pinned, which is what fixed
 * means - unless the narration is longer than the pin, in which case the pin
 * is raised. Cutting a sentence in half to honour a number is the failure
 * this whole function exists to stop.
 */
export function withMeasuredTiming(
  doc: GeoStoryDocument,
  // Structural on purpose: a generated clip carries an AudioBuffer, but a
  // line spoken by the browser has only a duration, and the retiming never
  // wanted the audio - just how long it took.
  voices: { sceneId: string; seconds: number }[]
): GeoStoryDocument {
  const measured = new Map(voices.map((v) => [v.sceneId, v.seconds]))

  const retimed: GeoStoryDocument = {
    ...doc,
    scenes: (doc.scenes ?? []).map((scene) => {
      const seconds = measured.get(scene.id)
      if (seconds === undefined) return scene

      // The tail has to cover the fade as well as the breath. At 0.45s of
      // breath against a 0.6s ramp, a perfectly measured scene still began
      // fading 0.15s before its own line finished - so the playhead held,
      // and the whole point of measuring is that it should not have to.
      const needed = seconds + Math.max(BREATH, FADE_RAMP)

      // `intended` is required by the format, so a scene that never declared
      // its timing gets one built around what the narration turned out to be.
      const timing = scene.timing ?? { mode: "derived" as const, intended: needed }

      if (timing.mode === "fixed") {
        const pinned = Number(timing.intended) || 0
        if (pinned >= needed) return scene
        return { ...scene, timing: { ...timing, intended: needed } }
      }

      return { ...scene, timing: { ...timing, measured: needed } }
    }),
  }

  /**
   * Everything else on the document timeline has to move with the scenes.
   *
   * `at` and `until` are document-absolute, so when retiming takes a story
   * from 4:02 down to 2:53 an image pinned to 3:20 is now past the end and
   * simply never appears. That is what "the pictures did not finish" was:
   * the scenes were retimed and nothing else was, so every generated image
   * and every annotation with its own window was still pointing at a
   * timeline that no longer existed.
   *
   * Remapped piecewise through the scene boundaries rather than by one
   * global ratio, because scenes do not all shrink by the same amount - a
   * scene whose narration ran long may not shrink at all.
   */
  const before = sceneWindows(doc)
  const after = sceneWindows(retimed)
  if (!before.length || before.length !== after.length) return retimed

  const remap = (t: unknown): number | undefined => {
    const time = Number(t)
    if (!Number.isFinite(time)) return undefined

    for (let i = 0; i < before.length; i++) {
      if (time <= before[i].end || i === before.length - 1) {
        const span = Math.max(1e-6, before[i].end - before[i].start)
        const into = Math.max(0, Math.min(1, (time - before[i].start) / span))
        return (
          after[i].start + into * (after[i].end - after[i].start)
        )
      }
    }
    return time
  }

  const moveWindow = <T extends { at?: unknown; until?: unknown }>(item: T): T => {
    if (item.at === undefined && item.until === undefined) return item
    const next = { ...item }
    if (item.at !== undefined) {
      const at = remap(item.at)
      if (at !== undefined) (next as { at?: number }).at = Number(at.toFixed(3))
    }
    if (item.until !== undefined) {
      const until = remap(item.until)
      if (until !== undefined)
        (next as { until?: number }).until = Number(until.toFixed(3))
    }
    return next
  }

  return {
    ...retimed,
    media: (retimed.media ?? []).map(moveWindow) as GeoStoryDocument["media"],
    annotations: (retimed.annotations ?? []).map(
      moveWindow
    ) as GeoStoryDocument["annotations"],
  }
}

/**
 * One buffer for the whole story, each line at its scene's start.
 *
 * Built as a single buffer rather than handed over clip by clip because the
 * encoder lays consecutive buffers end to end: it has no notion of a gap, so
 * a scene with no narration would pull everything after it out of sync with
 * the picture. Silence has to be real samples.
 */
export function buildTrack(
  doc: GeoStoryDocument,
  voices: SceneVoice[]
): AudioBuffer | null {
  if (!voices.length) return null

  const rate = voices[0].buffer.sampleRate
  const seconds = totalDuration(doc)
  const frames = Math.ceil(seconds * rate)
  if (frames <= 0) return null

  const context = audioContext()
  try {
    // Mono: narration is one voice, and stereo would double the memory a
    // long story needs for no audible gain.
    const track = context.createBuffer(1, frames, rate)
    const out = track.getChannelData(0)

    const starts = new Map(
      sceneWindows(doc).map(({ scene, start }) => [scene.id, start])
    )

    for (const voice of voices) {
      const start = starts.get(voice.sceneId)
      if (start === undefined) continue

      const offset = Math.floor(start * rate)
      const source = voice.buffer.getChannelData(0)
      const room = Math.min(source.length, frames - offset)

      for (let i = 0; i < room; i++) out[offset + i] = source[i]
    }

    return track
  } finally {
    void context.close().catch(() => {})
  }
}
