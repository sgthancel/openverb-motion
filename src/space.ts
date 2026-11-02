/**
 * Addressing a frame instead of the Earth.
 *
 * Every annotation in this format is positioned in longitude and latitude,
 * which is right for a story about places and useless for one about
 * anything else. The first non-geographic document written here worked
 * around it by exploiting the fact that Web Mercator is near-linear at the
 * equator and placing a product presentation off the coast of Africa. That
 * was a diagnostic. This is the real version.
 *
 * An annotation may declare `space: canvas`, and its coordinates are then
 * read as percentages of the frame - `[0, 0]` top left, `[100, 100]` bottom
 * right - with no camera involved at all. Everything else about it is
 * unchanged: the same kinds, the same styles, the same labels, the same
 * animation. Only the projection differs, and the projection was already a
 * function passed into the drawing code rather than baked into it.
 *
 * WHY THIS IS NOT A NEW PROFILE. `profile: motion` is rejected by the
 * parser - the profile is validated against an enum inside @openverb/format,
 * which is a different repository. These fields are not: `space`, `at`,
 * `radius` and `settings.default_space` all round-trip through the parser
 * untouched, because the format preserves fields it does not know. So
 * canvas addressing ships inside the geostory profile and needs no format
 * change to work. Naming it as its own profile is a one-line enum change
 * whenever the package is next touched.
 */
import type { GeoStoryDocument, GeoStoryAnnotation } from "@openverb/geostory"
import type { Project } from "./draw-flow"

export type Space = "geo" | "canvas"

export interface Frame {
  width: number
  height: number
}

/**
 * The shape a canvas document is written for.
 *
 * Every canvas document here computes its geometry in pixels on 1920x1080 and
 * converts once, the same way `scale` is quoted against a height of 1080. A
 * percentage is therefore meaningful only against that shape.
 */
const AUTHORED_ASPECT = 16 / 9

/**
 * The 16:9 rectangle a canvas document is drawn into, centred in the frame.
 *
 * Canvas percentages used to be read against whatever rectangle they were
 * handed, which is right exactly when that rectangle is 16:9 and wrong by its
 * aspect the rest of the time. With the player's chrome on, the map band is
 * about 2.21:1, so x was stretched against a wider box than y while a circle's
 * radius - measured against the shorter side - was not stretched at all. The
 * visible result was a document agreeing with itself and disagreeing with its
 * own geometry: lines-of-longitude.ov had meridians hanging outside the globe
 * they were drawn from, and the-blue-dot.ov drew an oval Earth in a scene
 * whose whole argument is scale.
 *
 * Letterboxing fixes it at the only place that knows: a canvas document is
 * drawn at its authored shape wherever it is put, and the frame's leftover
 * width is margin. On a frame that is already 16:9 this is the identity, so
 * nothing rendered without chrome moves at all.
 */
export function canvasBox(frame: Frame): Frame & { x: number; y: number } {
  const wide = frame.width / frame.height > AUTHORED_ASPECT
  const width = wide ? frame.height * AUTHORED_ASPECT : frame.width
  const height = wide ? frame.height : frame.width / AUTHORED_ASPECT
  return {
    x: (frame.width - width) / 2,
    y: (frame.height - height) / 2,
    width,
    height,
  }
}

/**
 * Percentages of the frame, not degrees.
 *
 * Deliberately the same `(x, y) => Point` shape the geographic projection
 * has, so the drawing code cannot tell which one it was handed.
 */
export function canvasProjector(frame: Frame): Project {
  const box = canvasBox(frame)
  return (x: number, y: number) => ({
    x: box.x + (x / 100) * box.width,
    y: box.y + (y / 100) * box.height,
  })
}

/** Which space an annotation is addressed in, once defaults are applied. */
export function spaceOf(annotation: unknown): Space {
  const space = (annotation as { space?: unknown } | null)?.space
  return space === "canvas" ? "canvas" : "geo"
}

export function isCanvas(annotation: unknown): boolean {
  return spaceOf(annotation) === "canvas"
}

/**
 * A circle's size on a frame with no ground.
 *
 * `radius_m` is metres and means nothing here, so canvas circles take
 * `radius` as a percentage of the frame's shorter side - which keeps a
 * circle round and keeps it the same size whatever the frame's shape.
 */
export function canvasRadius(annotation: unknown, frame: Frame): number {
  const percent = Number((annotation as { radius?: unknown } | null)?.radius) || 0
  const box = canvasBox(frame)
  return (percent / 100) * Math.min(box.width, box.height)
}

/**
 * Annotations with their space resolved and `pos` expanded.
 *
 * `pos: [50, 30]` is sugar for a Point geometry, because writing nine lines
 * of GeoJSON to put a headline in the middle of a frame is the kind of
 * friction that makes a format feel like a chore. Both forms are accepted;
 * an explicit geometry wins.
 *
 * It is `pos` and NOT `at` because `at` is already taken: the format uses
 * it for WHEN an annotation appears, in seconds. Writing a position there
 * made Number([22, 46]) into NaN, every text element was read as having an
 * invalid time window, and nineteen of them silently drew nothing.
 *
 * Resolved here, once, rather than inside the drawing loop, so the drawing
 * code reads `annotation.space` and nothing has to carry the document
 * around to look up a default.
 */
export function withSpaces(doc: GeoStoryDocument): GeoStoryAnnotation[] {
  const fallback =
    (doc.settings as { default_space?: unknown } | undefined)?.default_space ===
    "canvas"
      ? "canvas"
      : "geo"

  const resolved = (doc.annotations ?? []).map((annotation) => {
    const loose = annotation as GeoStoryAnnotation & {
      space?: unknown
      pos?: unknown
    }
    const space = loose.space === "canvas" || loose.space === "geo"
      ? loose.space
      : fallback

    const pos = loose.pos
    const needsGeometry =
      !annotation.geometry && Array.isArray(pos) && pos.length === 2

    if (space === "geo" && !needsGeometry) return annotation

    return {
      ...annotation,
      space,
      ...(needsGeometry
        ? { geometry: { type: "Point", coordinates: [Number(pos[0]), Number(pos[1])] } }
        : {}),
    } as GeoStoryAnnotation
  })

  return withStagger(doc, resolved)
}

/**
 * A scene's `stagger` turned into per-element delays.
 *
 * Sequencing a slide by hand means writing a delay on every element and
 * redoing all of them whenever one is inserted - the same arithmetic that
 * framing used to demand, reappearing for time. A scene that says
 * `stagger: 0.3` gives its annotations, in the order it lists them, an
 * extra 0.3s each.
 *
 * Added to whatever the element already asked for rather than replacing
 * it, so an author can still pull one element out of the sequence.
 */
function withStagger(
  doc: GeoStoryDocument,
  annotations: GeoStoryAnnotation[]
): GeoStoryAnnotation[] {
  const extra = new Map<string, number>()

  for (const scene of doc.scenes ?? []) {
    const step = Number((scene as { stagger?: unknown }).stagger)
    if (!Number.isFinite(step) || step <= 0) continue
    ;(scene.annotation_ids ?? []).forEach((id, index) => {
      // First scene to claim an element wins, so an element reused later
      // does not get two different delays.
      if (!extra.has(id)) extra.set(id, index * step)
    })
  }
  if (!extra.size) return annotations

  return annotations.map((annotation) => {
    const added = extra.get(annotation.id)
    if (!added) return annotation
    const loose = annotation as GeoStoryAnnotation & { enter?: unknown }
    // Nothing to delay if the element never said how it arrives.
    if (!loose.enter) return annotation

    const enter: Record<string, unknown> =
      typeof loose.enter === "string"
        ? { type: loose.enter }
        : { ...(loose.enter as Record<string, unknown>) }
    enter.delay = (Number(enter.delay) || 0) + added
    return { ...annotation, enter } as GeoStoryAnnotation
  })
}

/**
 * How much corner-cutting a shape should get.
 *
 * Smoothing exists because a coastline or a current is written with a
 * handful of points and looks like a route planner's polyline drawn raw.
 * That is an argument about geography. A canvas shape is not traced from
 * anything - its corners are where the author put them - so a rectangle
 * drawn at four percentages came out as a lozenge, which is what this
 * fixes.
 *
 * Geography keeps its two rounds. Either default can be overridden with
 * `smooth`, because a hard-cornered box on a map is a reasonable thing to
 * want and so is a flowing shape on a canvas.
 */
export function smoothingFor(annotation: unknown): number {
  const asked = (annotation as { smooth?: unknown } | null)?.smooth
  if (asked === false) return 0
  if (asked === true) return 2
  return isCanvas(annotation) ? 0 : 2
}

/** True when at least one annotation does not need a camera to be drawn. */
export function hasCanvasAnnotations(annotations: GeoStoryAnnotation[]): boolean {
  return annotations.some((annotation) => isCanvas(annotation))
}
