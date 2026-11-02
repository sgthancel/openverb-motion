/**
 * Drawing animated lines onto a 2D context.
 *
 * Split out of the Leaflet overlay so the video exporter can draw the same
 * thing. Two implementations would drift - different casing, different
 * particle shape, different fade - and the drift would only ever show up in
 * the exported file, after the author had already approved the preview.
 *
 * The only thing the caller supplies is a projection, because that is the
 * only part that genuinely differs: on screen Leaflet knows where a
 * coordinate falls, and in an export the renderer works it out itself.
 */
import { canvasProjector, isCanvas, smoothingFor } from "./space"
import type { GeoStoryAnnotation } from "@openverb/geostory"
import {
  annotationWindow,
  flowAt,
  flowSettings,
  isAnimatable,
  measure,
  pathOf,
  pointAt,
  smooth,
  type FlowDefaults,
  type Point,
  type PointOnPath,
} from "./flow"

export interface FlowScene {
  id: string
  start: number
  end: number
  annotationIds: string[]
}

/** Where a coordinate falls, in context pixels. */
export type Project = (lng: number, lat: number) => Point

function drawParticle(
  context: CanvasRenderingContext2D,
  at: PointOnPath,
  settings: FlowDefaults,
  scale: number
) {
  const size = settings.width * 2.4 * scale

  context.save()
  context.translate(at.x, at.y)
  context.rotate(at.angle)
  context.beginPath()

  if (settings.particle === "dot") {
    context.arc(0, 0, size * 0.4, 0, Math.PI * 2)
  } else {
    // A chevron rather than a filled triangle: the notch at the back reads as
    // direction even at a few pixels, where a triangle turns into a blob.
    context.moveTo(size, 0)
    context.lineTo(-size * 0.6, size * 0.55)
    context.lineTo(-size * 0.25, 0)
    context.lineTo(-size * 0.6, -size * 0.55)
    context.closePath()
  }

  context.fill()
  context.restore()
}

/**
 * Every animated annotation that is on screen at `now`.
 *
 * `scale` carries the quoted-at-1080p convention: particle speed and line
 * width mean the same thing on a phone, a projector and in a 4K export.
 */
export function drawFlow(
  context: CanvasRenderingContext2D,
  annotations: GeoStoryAnnotation[],
  scenes: FlowScene[],
  now: number,
  /** Absent when the document has no camera - canvas lines need none. */
  project: Project | null,
  scale: number,
  frame: { width: number; height: number }
): void {
  const onCanvas = canvasProjector(frame)

  for (const annotation of annotations) {
    if (!isAnimatable(annotation)) continue

    const window_ = annotationWindow(annotation, scenes)
    if (!window_) continue
    if (now < window_.start || now > window_.end) continue

    const coordinates = pathOf(annotation)
    if (!coordinates) continue

    const settings = flowSettings(annotation)

    // Projected now, not once: the whole point is that the line stays on the
    // ground while the camera moves over it.
    const place = isCanvas(annotation) ? onCanvas : project
    if (!place) continue

    let projected: Point[] = coordinates.map(([lng, lat]) => place(lng, lat))

    if (settings.direction === "reverse") projected = projected.reverse()
    projected = smooth(projected, smoothingFor(annotation))

    const lengths = measure(projected)
    const total = lengths[lengths.length - 1]
    if (!total) continue

    const elapsed = now - window_.start
    const frame = flowAt(settings, elapsed, window_.end - window_.start, total)
    if (frame.alpha <= 0.01) continue

    context.save()
    context.lineCap = "round"
    context.lineJoin = "round"
    if (settings.glow) {
      context.shadowColor = settings.color
      context.shadowBlur = 12 * scale
    }

    // The line, as far as it has been revealed. Twice: a dark casing first,
    // then the colour over it. A single translucent stroke reads clearly on a
    // dark basemap and nearly disappears on a pale one - and an ocean
    // basemap is pale, which is exactly where a current most needs to be
    // legible.
    const revealedTo = total * frame.revealed
    const trace = () => {
      context.beginPath()
      context.moveTo(projected[0].x, projected[0].y)
      for (let i = 1; i < projected.length && lengths[i] <= revealedTo; i++) {
        context.lineTo(projected[i].x, projected[i].y)
      }
      const tip = pointAt(projected, lengths, revealedTo)
      context.lineTo(tip.x, tip.y)
      context.stroke()
    }

    context.globalAlpha = frame.alpha * 0.35
    context.strokeStyle = "#06121c"
    context.lineWidth = (settings.width + 2.5) * scale
    trace()

    context.globalAlpha = frame.alpha * 0.85
    context.strokeStyle = settings.color
    context.lineWidth = settings.width * scale
    trace()

    // Then the particles travelling it.
    context.globalAlpha = frame.alpha
    context.fillStyle = settings.color
    for (const offset of frame.offsets) {
      drawParticle(context, pointAt(projected, lengths, offset), settings, scale)
    }

    context.restore()
  }
}
