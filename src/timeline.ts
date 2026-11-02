/**
 * lib/geostory/timeline.ts
 *
 * A GeoStory document, turned into things a player can draw.
 *
 * Everything here is a pure function of the document. No fetching, no
 * geocoding, no DOM — geocoding is an authoring step and the document already
 * carries the answers, so a player that calls a geocoder is a player with a
 * bug.
 *
 * Two rules from the spec drive most of this, and both are easy to get wrong
 * in ways nothing reports:
 *
 *   `audio`, `media` and `camera.track` are document-absolute. Time zero is
 *   the start of the story, not the start of a scene.
 *
 *   Scenes carry a length, never a start. A scene begins where the previous
 *   one ended, plus its own `delay`. Every caption, basemap switch and camera
 *   move hangs off that sum, so an off-by-one here desynchronises the entire
 *   film silently.
 *
 * This is the second implementation of these rules; the QGIS plugin is the
 * first. Where they disagree, one of them is wrong, and the document is the
 * arbiter.
 */
import type {
  GeoStoryDocument,
  GeoStoryScene,
  GeoStoryBasemap,
  GeoStoryAudioClip,
  GeoStoryMediaItem,
  GeoStoryPlace,
} from "@openverb/geostory"

/** A scene with the absolute window it occupies. */
export interface SceneWindow {
  scene: GeoStoryScene
  start: number
  end: number
  index: number
}

/** Where the map should be. Bounds win when present — see `cameraFor`. */
export interface GeoCamera {
  center: [number, number] // [lat, lng], Leaflet's order
  zoom: number
  /** [[south, west], [north, east]] when the document framed by bounds. */
  bounds?: [[number, number], [number, number]]
  /** How the story arrives at this shot. */
  transition: "fly" | "fade" | "cut" | "dissolve"
  /**
   * Air left around `bounds`, 0..1. Absent means the renderer's default,
   * which is generous because a map needs context around its subject. A
   * document with no map has no context to show, so it asks for less.
   */
  padding?: number
}

const DEFAULT_DURATION = 8
const MIN_DURATION = 0.1

/** How long a scene runs, following the timing mode. */
export function sceneDuration(
  scene: GeoStoryScene,
  fallback = DEFAULT_DURATION
): number {
  const timing = scene.timing
  if (!timing) return fallback

  // A pinned scene runs to the length its author set and the narration is
  // expected to fit. A derived one runs to whatever the narration measured,
  // falling back to the estimate when nothing has been recorded yet.
  const value =
    timing.mode === "fixed"
      ? timing.intended ?? timing.measured
      : timing.measured ?? timing.intended

  return Math.max(MIN_DURATION, Number(value) || fallback)
}

/**
 * Every scene with its absolute start and end, in sequence order.
 *
 * The one inference the spec does not spell out. A scene starts where the one
 * before it finished, plus its own delay — which is the only way the format
 * can express a gap.
 */
export function sceneWindows(doc: GeoStoryDocument): SceneWindow[] {
  const fallback = Number(doc.settings?.default_duration) || DEFAULT_DURATION
  const ordered = [...(doc.scenes ?? [])].sort(
    (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)
  )

  let cursor = 0
  return ordered.map((scene, index) => {
    cursor += Number(scene.delay) || 0
    const start = cursor
    const end = start + sceneDuration(scene, fallback)
    cursor = end
    return { scene, start, end, index }
  })
}

/**
 * How long the whole story runs.
 *
 * The scenes are not always the last thing to finish: a music bed can outlast
 * them, and a story that stops before its audio does cuts the sound off.
 */
export function totalDuration(doc: GeoStoryDocument): number {
  const windows = sceneWindows(doc)
  const scenesEnd = windows.length ? windows[windows.length - 1].end : 0

  const audioEnd = (doc.audio ?? []).reduce(
    (latest, clip) => Math.max(latest, (clip.at ?? 0) + (clip.duration ?? 0)),
    0
  )
  const mediaEnd = (doc.media ?? []).reduce(
    (latest, item) => Math.max(latest, Number(item.until) || 0),
    0
  )

  return Math.max(scenesEnd, audioEnd, mediaEnd)
}

/** Which scene is on screen at this moment. */
export function sceneAt(
  windows: SceneWindow[],
  seconds: number
): SceneWindow | null {
  for (const window of windows) {
    if (seconds >= window.start && seconds < window.end) return window
  }
  // Past the end, hold the last scene rather than showing nothing.
  return windows.length ? windows[windows.length - 1] : null
}

export function placeOf(
  doc: GeoStoryDocument,
  id: string | undefined
): GeoStoryPlace | undefined {
  if (!id) return undefined
  return (doc.places ?? []).find((place) => place.id === id)
}

/**
 * The shot for a scene.
 *
 * Bounds beat a cached centre and zoom, always. The spec makes `center` and
 * `zoom` conveniences and `frame.bounds` authoritative, and the reason is
 * practical: a zoom recorded on a 16:9 desktop frames something quite
 * different on a phone, while bounds frame the same ground on both. Leaflet
 * can fit bounds directly, so honouring this costs nothing here.
 *
 * Returns null when the scene names no camera and no place — the document is
 * leaving the shot to whatever came before, which is a decision, not a gap.
 */
/**
 * A box around everything one annotation draws.
 *
 * Circles are given a real radius on the ground, so the box has to grow by
 * it or half the circle frames out of shot.
 */
function annotationBounds(
  annotation: Record<string, unknown>
): [[number, number], [number, number]] | null {
  const geometry = (annotation.geometry ?? {}) as {
    type?: string
    coordinates?: unknown
  }
  const points: [number, number][] = []

  if (geometry.type === "Point" && Array.isArray(geometry.coordinates)) {
    points.push(geometry.coordinates as [number, number])
  } else if (geometry.type === "LineString" && Array.isArray(geometry.coordinates)) {
    points.push(...(geometry.coordinates as [number, number][]))
  } else if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
    const ring = (geometry.coordinates as [number, number][][])[0] ?? []
    points.push(...ring)
  }
  if (!points.length) return null

  let west = Infinity
  let east = -Infinity
  let south = Infinity
  let north = -Infinity
  for (const [lng, lat] of points) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
    west = Math.min(west, lng)
    east = Math.max(east, lng)
    south = Math.min(south, lat)
    north = Math.max(north, lat)
  }
  if (!Number.isFinite(west) || !Number.isFinite(south)) return null

  const radius = Number(annotation.radius_m) || 0
  if (radius > 0) {
    const lat = (south + north) / 2
    const dLat = radius / 110574
    const dLng = radius / Math.max(1, 111320 * Math.cos((lat * Math.PI) / 180))
    west -= dLng
    east += dLng
    south -= dLat
    north += dLat
  }

  return [
    [west, south],
    [east, north],
  ]
}

/**
 * The box around everything a scene draws.
 *
 * Only consulted for a document that declares no basemap. A map frames the
 * ground and lets the subject sit within it; a frame with no map has no
 * ground, so the subject IS the shot. Framing the declared place instead
 * left the content filling under half the width and made filling a frame a
 * matter of arithmetic the author had to do by hand.
 */
export function contentBounds(
  doc: GeoStoryDocument,
  scene: GeoStoryScene
): [[number, number], [number, number]] | null {
  const shown = new Set(scene.annotation_ids ?? [])
  if (!shown.size) return null

  let west = Infinity
  let east = -Infinity
  let south = Infinity
  let north = -Infinity
  let found = false

  const canvasDefault =
    (doc.settings as { default_space?: unknown } | undefined)?.default_space ===
    "canvas"

  for (const annotation of doc.annotations ?? []) {
    if (!shown.has(annotation.id)) continue
    // A canvas annotation's coordinates are percentages of the frame. Folding
    // them into a geographic box would ask the camera to frame a hundred
    // degrees of longitude.
    const space = (annotation as { space?: unknown }).space
    if (space === "canvas" || (canvasDefault && space !== "geo")) continue
    const box = annotationBounds(annotation as unknown as Record<string, unknown>)
    if (!box) continue
    found = true
    west = Math.min(west, box[0][0])
    south = Math.min(south, box[0][1])
    east = Math.max(east, box[1][0])
    north = Math.max(north, box[1][1])
  }
  if (!found) return null

  // A single point has no extent, and a zero span would ask for infinite
  // zoom. Give it a little room rather than refusing to frame it.
  if (east - west < 1e-6) {
    west -= 0.05
    east += 0.05
  }
  if (north - south < 1e-6) {
    south -= 0.05
    north += 0.05
  }

  return [
    [west, south],
    [east, north],
  ]
}

/** True when nothing in this document will ever draw a map. */
export function isMapless(doc: GeoStoryDocument): boolean {
  return !(doc.basemaps ?? []).length
}

export function cameraFor(
  doc: GeoStoryDocument,
  scene: GeoStoryScene
): GeoCamera | null {
  const camera = scene.camera
  const transition = (scene.transition ??
    doc.settings?.default_transition ??
    "fly") as GeoCamera["transition"]

  const bounds = camera?.frame?.bounds
  if (bounds && bounds.length === 2) {
    const [[west, south], [east, north]] = bounds
    return {
      center: [(south + north) / 2, (west + east) / 2],
      zoom: camera?.zoom ?? 6,
      bounds: [
        [south, west],
        [north, east],
      ],
      transition,
    }
  }

  // No explicit frame, and no map to give the subject context: frame what
  // the scene actually draws. An author who wrote `camera.frame.bounds`
  // above has already said what they want and is not overruled here.
  if (isMapless(doc)) {
    const content = contentBounds(doc, scene)
    if (content) {
      const [[west, south], [east, north]] = content
      return {
        center: [(south + north) / 2, (west + east) / 2],
        zoom: 6,
        bounds: [
          [south, west],
          [north, east],
        ],
        transition,
        // A real safe area now, rather than a number tuned to stop labels
        // being clipped. The renderer measures the labels and pulls the
        // camera back itself when they overflow, so this only has to be
        // the margin the frame wants for its own sake.
        padding: 0.08,
      }
    }
  }

  // No explicit frame: a place with bounds frames itself.
  const place = placeOf(doc, scene.place_id)
  const placeBounds = place?.resolved?.bounds
  if (!camera?.center && placeBounds && placeBounds.length === 2) {
    const [[west, south], [east, north]] = placeBounds
    return {
      center: [(south + north) / 2, (west + east) / 2],
      zoom: 6,
      bounds: [
        [south, west],
        [north, east],
      ],
      transition,
    }
  }

  if (camera?.center && camera.center.length === 2) {
    const [lng, lat] = camera.center
    return { center: [lat, lng], zoom: camera.zoom ?? 10, transition }
  }

  const point = place?.resolved?.point
  if (point && point.length === 2) {
    const [lng, lat] = point
    return { center: [lat, lng], zoom: camera?.zoom ?? 10, transition }
  }

  return null
}

/**
 * The camera for every scene, with gaps filled by holding the previous shot.
 *
 * A scene with nothing to say about the camera is not an error and must not
 * reset the map: the coffee example has one, a line of narration over
 * whatever is already on screen. Holding is the only answer that cannot be
 * wrong; cutting to a default view would invent a move the author never
 * wrote.
 */
export function cameraTrack(doc: GeoStoryDocument): (GeoCamera | null)[] {
  const windows = sceneWindows(doc)
  let last: GeoCamera | null = null

  return windows.map(({ scene }) => {
    const camera = cameraFor(doc, scene)
    if (camera) {
      last = camera
      return camera
    }
    // Held: same shot, and arriving at it is a cut because nothing moves.
    return last ? { ...last, transition: "cut" as const } : null
  })
}

/** Which basemap is on screen at this moment, resolved against the registry. */
export function basemapAt(
  doc: GeoStoryDocument,
  seconds: number
): GeoStoryBasemap | null {
  const windows = sceneWindows(doc)
  const current = sceneAt(windows, seconds)
  const wanted = current?.scene.basemap || doc.settings?.default_basemap
  const registry = doc.basemaps ?? []

  if (wanted) {
    const found = registry.find((basemap) => basemap.id === wanted)
    if (found) return found
  }
  // A document that names an id it never defined is relying on the reader
  // already knowing it, which is exactly what the registry exists to stop.
  // Fall back to whatever it did define rather than drawing nothing.
  return registry[0] ?? null
}

/**
 * The words spoken over a scene.
 *
 * A document can keep them in three places and the spec does not state a
 * precedence, so this picks one and is explicit about it: the scene's own
 * content first, then the newer scene-level field, then the text carried on
 * the narration clip the scene points at.
 */
export function narrationFor(
  doc: GeoStoryDocument,
  scene: GeoStoryScene
): string {
  const fromContent = scene.content?.narration?.trim()
  if (fromContent) return fromContent

  const fromScene = (scene as { narration?: string }).narration?.trim()
  if (fromScene) return fromScene

  for (const id of scene.audio_ids ?? []) {
    const clip = (doc.audio ?? []).find((entry) => entry.id === id)
    const text = clip?.text?.trim()
    if (text) return text
  }
  return ""
}

/** True when the document carries enough text to be spoken at all. */
export function hasNarrationText(doc: GeoStoryDocument): boolean {
  return (doc.scenes ?? []).some((scene) => narrationFor(doc, scene).length > 0)
}

/**
 * Captions, as the caption layer wants them.
 *
 * The caption line is preferred over the narration because they are not the
 * same thing: a caption is written to be read in a corner of the frame, the
 * narration to be heard. Falling back to the narration is better than an
 * empty frame, though, so it does.
 */
export function captionsFrom(doc: GeoStoryDocument) {
  return sceneWindows(doc)
    .map(({ scene, start, end }) => {
      const text = scene.content?.caption?.trim() || narrationFor(doc, scene)
      if (!text) return null
      return {
        text,
        startTime: start,
        endTime: end,
        position: "bottom" as const,
        style: (scene.content?.style as "cinematic") || ("cinematic" as const),
        fontSize: "medium" as const,
        animation: "fade" as const,
      }
    })
    .filter((caption): caption is NonNullable<typeof caption> => caption !== null)
}

/**
 * Resolve a path the document gave us against wherever the document came from.
 *
 * Documents point at their assets the way they were authored — `audio/01.wav`,
 * relative to the file — which is what lets a story and its media move as one
 * folder. Taken literally in a browser that resolves against the page URL, so
 * every one of them silently 404s and the story plays silent.
 */
export function resolveAsset(src: string, baseUrl?: string): string {
  if (!src) return ""
  if (/^(https?:|data:|blob:|\/)/.test(src)) return src
  if (!baseUrl) return src
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
  return `${base}${src}`
}

function gainToVolume(gainDb: number | undefined): number {
  if (gainDb === undefined || gainDb === null) return 1
  return Math.max(0, Math.min(1, Math.pow(10, Number(gainDb) / 20)))
}

/** Audio clips as tracks, in document-absolute time. */
export function tracksFrom(doc: GeoStoryDocument, baseUrl?: string) {
  return (doc.audio ?? [])
    .filter((clip): clip is GeoStoryAudioClip => Boolean(clip?.src))
    .map((clip) => ({
      id: clip.id,
      url: resolveAsset(clip.src, baseUrl),
      type:
        clip.kind === "music"
          ? ("music" as const)
          : clip.kind === "sfx"
            ? ("ambient" as const)
            : ("narration" as const),
      volume: gainToVolume(clip.gain_db),
      startTime: clip.at ?? 0,
      endTime: (clip.at ?? 0) + (clip.duration ?? 0),
      ducking: clip.duck
        ? { enabled: true, duckAmount: 0.4 }
        : undefined,
    }))
}

const PLACEMENTS: Record<string, { x: number; y: number; width: number }> = {
  top_left: { x: 3, y: 5, width: 22 },
  top_right: { x: 75, y: 5, width: 22 },
  bottom_left: { x: 3, y: 66, width: 22 },
  bottom_right: { x: 75, y: 66, width: 22 },
  full: { x: 0, y: 0, width: 100 },
}

/** Media items as visuals, placed by the corner the document asked for. */
export function visualsFrom(doc: GeoStoryDocument, baseUrl?: string) {
  const duration = totalDuration(doc)

  /**
   * Which scenes claim each picture.
   *
   * `media_ids` has been in the format and in the documents all along -
   * the coffee example attaches an inset to one scene - and the renderer
   * read none of it, so every picture was persistent or hand-timed. An
   * annotation already works this way: it belongs to a scene and takes
   * that scene's window. A picture should too, and for the same reason
   * beyond tidiness - a window written as an absolute second stops being
   * true the moment a scene is inserted before it, while one that belongs
   * to a scene simply moves with it.
   */
  const claimed = new Map<string, { start: number; end: number }>()
  for (const { scene, start, end } of sceneWindows(doc)) {
    for (const id of (scene as { media_ids?: string[] }).media_ids ?? []) {
      const already = claimed.get(id)
      claimed.set(
        id,
        already
          ? { start: Math.min(already.start, start), end: Math.max(already.end, end) }
          : { start, end }
      )
    }
  }

  return (doc.media ?? [])
    .filter((item): item is GeoStoryMediaItem => Boolean(item?.src))
    .map((item) => {
      const place = PLACEMENTS[item.placement ?? "top_left"] ?? PLACEMENTS.top_left

      // An explicit window still wins: it is the only way to say that a
      // picture deliberately spans scenes, or appears part-way through one.
      const hasWindow = item.at !== undefined || item.until !== undefined
      const scene = claimed.get(item.id)

      let startTime = 0
      let endTime = duration
      if (hasWindow) {
        startTime = Number(item.at) || 0
        endTime = Number(item.until) || duration
      } else if (scene) {
        startTime = scene.start
        endTime = scene.end
      }
      // No window and no scene means persistent, not instantaneous - which
      // is what a watermark wants, and the coffee example has one.

      // How the picture meets the frame. Absent is the old behaviour: a
      // panel of a declared width, placed in a corner. `cover` fills the
      // frame and crops, `contain` fits the whole picture inside it.
      const asked = (item as { fit?: unknown }).fit
      const fit: "panel" | "cover" | "contain" =
        asked === "cover" || asked === "contain" ? asked : "panel"

      // A still picture held for a whole scene reads as a freeze next to
      // an animated map, so a covering one drifts unless told not to -
      // the same reason the camera drifts through a held shot.
      const drift = (item as { drift?: unknown }).drift !== false

      return {
        id: item.id,
        imageUrl: resolveAsset(item.src, baseUrl),
        startTime,
        endTime,
        position: { x: place.x, y: place.y, width: place.width },
        fit,
        drift,
        opacity: 1,
        transition: "fade" as const,
      }
    })
}

/** Every credit the document asks to show. */
export function attributionFor(doc: GeoStoryDocument): string[] {
  return (doc.attribution ?? []).filter(Boolean)
}
