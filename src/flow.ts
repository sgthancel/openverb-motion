/**
 * lib/geostory/flow.ts
 *
 * The geometry and timing behind animated lines. No canvas, no React - just
 * the arithmetic, so it can be read, reasoned about and used by any renderer
 * that can draw a line and a triangle.
 *
 * The drawing is in geo-flow-layer.tsx. Keeping them apart matters because
 * the hard parts here - smoothing a handful of coordinates into something
 * that reads as a current, spacing particles evenly along a path that is not
 * evenly spaced - are the parts worth checking, and they are far easier to
 * check without a canvas in the way.
 */
import type { GeoStoryAnnotation, GeoStoryFlow } from "@openverb/geostory"

export interface FlowDefaults {
  direction: "forward" | "reverse" | "both"
  speed: number
  reveal: number
  fade_out: number
  particles: number
  particle: "arrow" | "dot" | "none"
  glow: boolean
  color: string
  width: number
}

// Every field of `animate` is optional, which is what lets an author ask for
// motion without describing it. Something has to supply the rest.
export const FLOW_DEFAULTS: FlowDefaults = {
  direction: "forward",
  speed: 120,
  reveal: 2,
  fade_out: 0.75,
  particles: 20,
  particle: "arrow",
  glow: false,
  color: "#4FC3F7",
  width: 3,
}

export function flowSettings(annotation: GeoStoryAnnotation): FlowDefaults {
  const animate = (annotation.animate ?? {}) as GeoStoryFlow
  const style = annotation.style ?? {}

  return {
    direction: (animate.direction as FlowDefaults["direction"]) ?? FLOW_DEFAULTS.direction,
    speed: Number(animate.speed ?? FLOW_DEFAULTS.speed),
    reveal: Number(animate.reveal ?? FLOW_DEFAULTS.reveal),
    fade_out: Number(animate.fade_out ?? FLOW_DEFAULTS.fade_out),
    particles: Math.max(0, Math.round(Number(animate.particles ?? FLOW_DEFAULTS.particles))),
    particle: (animate.particle as FlowDefaults["particle"]) ?? FLOW_DEFAULTS.particle,
    glow: Boolean(animate.glow ?? FLOW_DEFAULTS.glow),
    color: style.color ?? FLOW_DEFAULTS.color,
    width: Number(style.weight ?? FLOW_DEFAULTS.width),
  }
}

/** The [lng, lat] path of a line annotation, or null if it has none. */
export function pathOf(annotation: GeoStoryAnnotation): [number, number][] | null {
  const geometry = annotation.geometry as
    | { type?: string; coordinates?: unknown }
    | undefined
  if (!geometry || geometry.type !== "LineString") return null

  const coordinates = geometry.coordinates as [number, number][] | undefined
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null
  return coordinates
}

/** Can this annotation be animated at all? */
export function isAnimatable(annotation: GeoStoryAnnotation): boolean {
  // A marker has no path to travel. The spec says ignore the block rather
  // than treat the document as invalid, so this is a question, not a guard.
  return Boolean(annotation.animate) && pathOf(annotation) !== null
}

export type Point = { x: number; y: number }

/**
 * Chaikin corner-cutting: four coordinates become a curve.
 *
 * Ocean currents and migration routes are written as a handful of points
 * because nobody wants to type a hundred, and drawn raw they look like a
 * route planner's polyline - a series of decisions rather than a flow. Two
 * rounds of cutting is enough to read as water without blunting real
 * geography.
 */
export function smooth(points: Point[], iterations = 2): Point[] {
  let current = points
  for (let round = 0; round < iterations; round++) {
    if (current.length < 3) break
    const next: Point[] = [current[0]]
    for (let i = 0; i < current.length - 1; i++) {
      const a = current[i]
      const b = current[i + 1]
      next.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y })
      next.push({ x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y })
    }
    next.push(current[current.length - 1])
    current = next
  }
  return current
}

/**
 * Running distance along a path.
 *
 * Needed because the points are not evenly spaced: stepping through them one
 * by one would bunch particles where the coordinates happen to be dense and
 * strand them across long straight runs, which looks like the animation is
 * stuttering rather than the path being uneven.
 */
export function measure(points: Point[]): number[] {
  const lengths = [0]
  for (let i = 1; i < points.length; i++) {
    lengths.push(
      lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
    )
  }
  return lengths
}

export interface PointOnPath extends Point {
  angle: number
}

/** The point a given distance along the path, and the heading there. */
export function pointAt(
  points: Point[],
  lengths: number[],
  distance: number
): PointOnPath {
  if (points.length < 2) {
    return { x: points[0]?.x ?? 0, y: points[0]?.y ?? 0, angle: 0 }
  }

  let i = 1
  while (i < lengths.length - 1 && lengths[i] < distance) i++

  const span = lengths[i] - lengths[i - 1] || 1
  const t = Math.max(0, Math.min(1, (distance - lengths[i - 1]) / span))
  const a = points[i - 1]
  const b = points[i]

  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    // The heading is what points an arrow the right way, and is the whole
    // reason direction is expressible at all.
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  }
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

export interface FlowFrame {
  /** How far along the path the line has been drawn, 0 to 1. */
  revealed: number
  /** Overall opacity, covering both the draw-in and the fade-out. */
  alpha: number
  /** Distances along the path where particles sit this frame. */
  offsets: number[]
}

/**
 * Where everything is at one moment.
 *
 * `elapsed` is seconds since the annotation appeared, and `total` is the
 * length of the path in pixels, so speed means the same thing at any zoom.
 */
export function flowAt(
  settings: FlowDefaults,
  elapsed: number,
  window: number,
  total: number
): FlowFrame {
  const fadeIn = Math.max(0, Math.min(1, elapsed / 0.5))
  const fadeOut =
    settings.fade_out > 0
      ? Math.max(0, Math.min(1, (window - elapsed) / settings.fade_out))
      : 1

  const revealed =
    settings.reveal > 0
      ? easeInOut(Math.max(0, Math.min(1, elapsed / settings.reveal)))
      : 1

  const offsets: number[] = []
  if (settings.particles > 0 && settings.particle !== "none" && total > 0) {
    const spacing = total / settings.particles
    // Modulo the spacing, so particles leave the far end and reappear at the
    // near one rather than the whole train restarting.
    const travelled = (elapsed * settings.speed) % spacing
    for (let k = 0; k < settings.particles; k++) {
      const distance = k * spacing + travelled
      if (distance <= revealed * total) offsets.push(distance)
    }
  }

  return {
    revealed,
    alpha: Math.max(0, Math.min(fadeIn, fadeOut)),
    offsets,
  }
}

/**
 * When an annotation is on screen, in document-absolute seconds.
 *
 * An annotation can say so itself with at/until, or inherit the window of
 * whichever scenes reference it - which is the usual case, and the reason an
 * animated line needs no timing of its own.
 */
export function annotationWindow(
  annotation: GeoStoryAnnotation,
  scenes: { id: string; start: number; end: number; annotationIds: string[] }[]
): { start: number; end: number } | null {
  if (annotation.at !== undefined || annotation.until !== undefined) {
    const start = Number(annotation.at ?? 0)
    const end = Number(annotation.until ?? Infinity)
    return end > start ? { start, end } : null
  }

  const showing = scenes.filter((scene) =>
    scene.annotationIds.includes(annotation.id)
  )
  if (!showing.length) return null

  return {
    start: Math.min(...showing.map((scene) => scene.start)),
    end: Math.max(...showing.map((scene) => scene.end)),
  }
}
