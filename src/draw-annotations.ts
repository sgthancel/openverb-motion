/**
 * Drawing the annotations that do not move.
 *
 * The flow layer was built first, against the one bundled example that uses
 * `animate` - and nothing ever drew the others. Of the five examples shipped
 * with the app, two declare annotations that appeared nowhere: Transbay has a
 * walking-radius circle, a bus ramp and a tower marker, and Iceland has the
 * Surtsey exclusion zone. All four rendered as empty map.
 *
 * `animate` arrived in 0.2.0. A plain marker or a labelled line is the normal
 * way to annotate a story, and the normal way was the unimplemented one.
 *
 * Labels are drawn, not optional. "Salesforce Tower - 326 m" and "Closed to
 * all but research" are the content; a dot with no words is decoration.
 */
import type { GeoStoryAnnotation } from "@openverb/geostory"
import { annotationWindow, smooth, type Point } from "./flow"
import type { FlowScene, Project } from "./draw-flow"
import {
  canvasProjector,
  canvasRadius,
  isCanvas,
  smoothingFor,
} from "./space"
import { entranceAt, revealText } from "./entrance"
import { DEFAULT_THEME, type Theme } from "./theme"
import { chartOf, drawChart } from "./draw-chart"

/** Style, with the format's optional fields resolved. */
interface Paint {
  color: string
  fill: string
  fillOpacity: number
  weight: number
}

function paintOf(annotation: GeoStoryAnnotation): Paint {
  // fill_color is not in the published type but the examples use it, and the
  // format requires unknown fields to survive parsing - so it is here.
  const style = (annotation.style ?? {}) as {
    color?: string
    fill_color?: string
    fill_opacity?: number
    weight?: number
  }
  const color = style.color ?? "#4FC3F7"

  return {
    color,
    fill: style.fill_color ?? color,
    fillOpacity: Number(style.fill_opacity ?? 0.15),
    weight: Number(style.weight ?? 2),
  }
}

/* -- Leader lines ------------------------------------------------------ */

/**
 * A label on the end of a line, pointing at the thing it names.
 *
 * Not a new annotation kind, but an optional block on any annotation that
 * has a label - so a circle, a marker or a line can each have one, and the
 * format gains no kinds. The same shape `animate` took: a renderer that has
 * never heard of `leader` still draws the label, just beside the geometry
 * rather than on the end of a line.
 *
 * It is read straight off the document without the published type knowing
 * about it, which the format allows: annotations carry unknown fields
 * through the parser and back out of the serializer untouched.
 */
interface Leader {
  dx: number
  dy: number
  /** Fraction of the frame's shorter side. */
  length: number
  elbow: boolean
  arrow: boolean
}

const COMPASS: Record<string, [number, number]> = {
  north: [0, -1],
  north_east: [0.7071, -0.7071],
  east: [1, 0],
  south_east: [0.7071, 0.7071],
  south: [0, 1],
  south_west: [-0.7071, 0.7071],
  west: [-1, 0],
  north_west: [-0.7071, -0.7071],
}

function leaderOf(annotation: GeoStoryAnnotation): Leader | null {
  const raw = (annotation as unknown as { leader?: unknown }).leader
  if (!raw || typeof raw !== "object") return null

  const block = raw as {
    direction?: string
    length?: number
    elbow?: boolean
    arrow?: boolean
  }

  // Compass words rather than degrees: an author thinks "up and to the
  // right", and degrees raise "from north? clockwise?" every single time.
  const [dx, dy] = COMPASS[block.direction ?? "north_east"] ?? COMPASS.north_east

  return {
    dx,
    dy,
    // A fraction of the frame, because a leader is a graphic device and not
    // a geographic one. In metres it would become absurd when the camera
    // pulls back; in pixels it would be wrong at 4K against 720p.
    length: Math.max(0.02, Math.min(0.5, Number(block.length ?? 0.14))),
    elbow: block.elbow !== false,
    arrow: block.arrow !== false,
  }
}

/**
 * How loudly a label speaks.
 *
 * Every label used to be drawn at one size, which is right for a map - a
 * place name is a place name - and wrong for anything that argues. On a
 * frame with no map the labels ARE the content, and "fifteen packages"
 * reading exactly as loudly as "Chess" is why the first presentation
 * looked flat. Absent means `body`, so nothing already written changes.
 */
export function emphasisOf(
  annotation: { emphasis?: unknown },
  theme: Theme = DEFAULT_THEME
): number {
  const named = typeof annotation.emphasis === "string" ? annotation.emphasis : ""
  return theme.scale[named] ?? theme.scale.body ?? 1
}

/** Text with a dark halo, which stays readable over any basemap. */
function label(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  scale: number,
  align: CanvasTextAlign = "center",
  weight = 1,
  theme: Theme = DEFAULT_THEME
): void {
  const size = Math.round(15 * scale * weight)
  context.save()
  context.font = `600 ${size}px ${theme.font}`
  context.textAlign = align
  context.textBaseline = "middle"

  // A halo rather than a plate: a story can carry a dozen labels, and a dozen
  // filled boxes would cover more map than they explain.
  context.lineJoin = "round"
  context.lineWidth = Math.max(2, 3.5 * scale)
  context.strokeStyle = theme.halo
  context.strokeText(text, x, y)

  context.fillStyle = theme.label
  context.fillText(text, x, y)
  context.restore()
}

/**
 * The leader line, and where its label goes.
 *
 * `from` is the edge of the thing being pointed at, not its centre, so the
 * line never crosses the shape it is labelling.
 */
function drawLeader(
  context: CanvasRenderingContext2D,
  leader: Leader,
  from: Point,
  paint: Paint,
  scale: number,
  frame: { width: number; height: number },
  text: string
): { x: number; y: number; align: CanvasTextAlign } {
  const run = Math.min(frame.width, frame.height) * leader.length
  const gap = 8 * scale
  const pad = 12 * scale

  context.save()
  context.font = `600 ${Math.round(15 * scale)}px system-ui, -apple-system, "Segoe UI", sans-serif`
  const textWidth = context.measureText(text).width
  context.restore()

  const reach = (dx: number, dy: number) => {
    const bendAt = leader.elbow ? 0.62 : 1
    const knee = { x: from.x + dx * run * bendAt, y: from.y + dy * run * bendAt }
    const end =
      leader.elbow && dx !== 0
        ? { x: knee.x + Math.sign(dx) * run * 0.38, y: knee.y }
        : knee
    return { knee, end }
  }

  // Turned away from whichever edge it would otherwise run off. The author
  // picks a direction against the map, but the framing changes with the
  // camera and the export size, so a callout aimed north-east from a subject
  // near the right edge puts its text outside the picture. A drafter would
  // flip it; so does this.
  let { dx, dy } = leader
  let placed = reach(dx, dy)

  const overflowsRight = placed.end.x + gap + textWidth > frame.width - pad
  const overflowsLeft = placed.end.x - gap - textWidth < pad
  if (dx > 0 && overflowsRight) dx = -dx
  else if (dx < 0 && overflowsLeft) dx = -dx

  placed = reach(dx, dy)
  if (dy < 0 && placed.end.y < pad) dy = -dy
  else if (dy > 0 && placed.end.y > frame.height - pad) dy = -dy

  const { knee, end } = reach(dx, dy)

  context.save()
  context.lineCap = "round"
  context.lineJoin = "round"

  const trace = () => {
    context.beginPath()
    context.moveTo(from.x, from.y)
    context.lineTo(knee.x, knee.y)
    if (end !== knee) context.lineTo(end.x, end.y)
    context.stroke()
  }

  // Cased like every other line we draw, so it survives a pale basemap.
  context.strokeStyle = "rgba(6, 12, 20, 0.7)"
  context.lineWidth = (paint.weight + 2.5) * scale
  trace()

  context.strokeStyle = paint.color
  context.lineWidth = paint.weight * scale
  trace()

  if (leader.arrow) {
    // Pointing back at the subject, which is the end that means something.
    const size = Math.max(4, 6 * scale)
    const angle = Math.atan2(-dy, -dx)
    context.save()
    context.translate(from.x, from.y)
    context.rotate(angle)
    context.beginPath()
    context.moveTo(0, 0)
    context.lineTo(-size * 1.7, size * 0.75)
    context.lineTo(-size * 1.7, -size * 0.75)
    context.closePath()
    context.fillStyle = paint.color
    context.fill()
    context.restore()
  }

  context.restore()

  if (dx === 0) {
    return { x: end.x, y: end.y + (dy < 0 ? -gap : gap), align: "center" }
  }
  return {
    x: end.x + (dx > 0 ? gap : -gap),
    y: end.y,
    align: dx > 0 ? "left" : "right",
  }
}

/**
 * Metres to pixels at this zoom and latitude.
 *
 * A circle in the format is given a real radius on the ground, so it has to
 * grow and shrink as the camera moves - 800 m is a ten minute walk whether
 * the map is showing a block or a continent. Web Mercator, which is what both
 * renderers use, so one formula serves both.
 */
function metresToPixels(metres: number, latitude: number, zoom: number): number {
  const perPixel =
    (156543.03392 * Math.cos((latitude * Math.PI) / 180)) / Math.pow(2, zoom)
  return perPixel > 0 ? metres / perPixel : 0
}

function coordsOf(annotation: GeoStoryAnnotation): {
  type?: string
  coordinates?: unknown
} {
  return (annotation.geometry ?? {}) as { type?: string; coordinates?: unknown }
}

/**
 * Every annotation on screen at `now` that is not animated.
 *
 * Animated ones are left to drawFlow, which draws the same geometry with
 * motion along it. Splitting on `animate` rather than on `kind` means an
 * author can add motion to a line without it being drawn twice.
 */
export function drawAnnotations(
  context: CanvasRenderingContext2D,
  annotations: GeoStoryAnnotation[],
  scenes: FlowScene[],
  now: number,
  /** Absent when the document has no camera - canvas annotations need none. */
  project: Project | null,
  scale: number,
  zoom: number,
  frame: { width: number; height: number },
  theme: Theme = DEFAULT_THEME
): void {
  const onCanvas = canvasProjector(frame)

  for (const annotation of annotations) {
    if (annotation.animate) continue
    // A text annotation is its label; there is no shape to draw under it.
    if (String(annotation.kind) === "text") continue

    const window_ = annotationWindow(annotation, scenes)
    if (!window_) continue
    if (now < window_.start || now > window_.end) continue

    // The same half-second fade the captions use, so nothing pops in -
    // unless the element says how it wants to arrive, which replaces it.
    const into = (now - window_.start) / 0.5
    const outOf = (window_.end - now) / 0.5
    const fade = Math.max(0, Math.min(1, into, outOf))
    const motion = entranceAt(annotation, window_, now, frame)
    const alpha = motion ? motion.alpha : fade
    if (alpha <= 0.01) continue

    const place = isCanvas(annotation) ? onCanvas : project
    if (!place) continue

    // A chart draws itself: bars growing from a baseline rather than a
    // shape with a label hung off it.
    const chart = chartOf(annotation, frame, place)
    if (chart) {
      context.save()
      context.globalAlpha = alpha
      if (motion && (motion.dx || motion.dy)) context.translate(motion.dx, motion.dy)
      drawChart(context, chart, motion ? motion.progress : 1, scale, theme)
      context.restore()
      continue
    }

    const paint = paintOf(annotation)
    const geometry = coordsOf(annotation)
    const leader = leaderOf(annotation)

    // Where the leader starts, and where the label goes without one.
    let anchor: Point | null = null
    let edge = 0
    let fallback: { x: number; y: number; align: CanvasTextAlign } | null = null

    context.save()
    context.globalAlpha = alpha
    if (motion && (motion.dx || motion.dy)) context.translate(motion.dx, motion.dy)
    context.lineCap = "round"
    context.lineJoin = "round"

    if (annotation.kind === "circle" && geometry.type === "Point") {
      const [lng, lat] = geometry.coordinates as [number, number]
      const centre = place(lng, lat)
      // Metres on the ground, or a percentage of a frame that has none.
      const radius = isCanvas(annotation)
        ? canvasRadius(annotation, frame)
        : metresToPixels(Number(annotation.radius_m) || 0, lat, zoom)

      if (radius >= 1) {
        context.beginPath()
        context.arc(centre.x, centre.y, radius, 0, Math.PI * 2)
        context.fillStyle = paint.fill
        context.globalAlpha = alpha * paint.fillOpacity
        context.fill()

        context.globalAlpha = alpha
        context.strokeStyle = paint.color
        context.lineWidth = paint.weight * scale
        context.stroke()
      }

      anchor = centre
      edge = radius
      fallback = { x: centre.x, y: centre.y - radius - 14 * scale, align: "center" }
    } else if (annotation.kind === "marker" && geometry.type === "Point") {
      const [lng, lat] = geometry.coordinates as [number, number]
      const at = place(lng, lat)
      const size = Math.max(4, 5.5 * scale)

      // A ringed dot: the ring is what keeps it visible on imagery that
      // happens to be the same colour as the marker.
      context.beginPath()
      context.arc(at.x, at.y, size + 2 * scale, 0, Math.PI * 2)
      context.fillStyle = "rgba(247, 250, 252, 0.95)"
      context.fill()

      context.beginPath()
      context.arc(at.x, at.y, size, 0, Math.PI * 2)
      context.fillStyle = paint.color
      context.fill()

      anchor = at
      edge = size + 3 * scale
      fallback = { x: at.x, y: at.y - size - 14 * scale, align: "center" }
    } else if (
      (annotation.kind === "line" || annotation.kind === "polygon") &&
      Array.isArray(geometry.coordinates)
    ) {
      const ring =
        annotation.kind === "polygon"
          ? ((geometry.coordinates as [number, number][][])[0] ?? [])
          : (geometry.coordinates as [number, number][])

      if (ring.length >= 2) {
        // Smoothed the same way the flow layer smooths, so a line does not
        // change shape the moment an author adds motion to it.
        const points: Point[] = smooth(
          ring.map(([lng, lat]) => place(lng, lat)),
          smoothingFor(annotation)
        )

        context.beginPath()
        context.moveTo(points[0].x, points[0].y)
        for (let i = 1; i < points.length; i++) {
          context.lineTo(points[i].x, points[i].y)
        }

        if (annotation.kind === "polygon") {
          context.closePath()
          context.fillStyle = paint.fill
          context.globalAlpha = alpha * paint.fillOpacity
          context.fill()
          context.globalAlpha = alpha
        }

        // Dark casing then colour, matching the animated lines so static and
        // animated annotations read as one family.
        context.strokeStyle = "#06121c"
        context.globalAlpha = alpha * 0.35
        context.lineWidth = (paint.weight + 2.5) * scale
        context.stroke()

        context.globalAlpha = alpha
        context.strokeStyle = paint.color
        context.lineWidth = paint.weight * scale
        context.stroke()

        const middle = points[Math.floor(points.length / 2)]
        anchor = middle
        edge = paint.weight * scale
        fallback = { x: middle.x, y: middle.y - 12 * scale, align: "center" }
      }
    }

    context.restore()
  }
}

/**
 * The labels, over everything.
 *
 * A separate pass for two reasons. Animated annotations are skipped by the
 * drawing above - drawFlow handles their geometry - and drawFlow has never
 * drawn a label, so until now an annotation silently lost its name the
 * moment an author gave it motion. Four ocean currents and two rivers were
 * all unlabelled on the map for exactly that reason.
 *
 * And words belong on top. Drawn in the same pass as the geometry, a label
 * ends up underneath whichever line is rendered after it.
 */
export function drawAnnotationLabels(
  context: CanvasRenderingContext2D,
  annotations: GeoStoryAnnotation[],
  scenes: FlowScene[],
  now: number,
  /** Absent when the document has no camera - canvas annotations need none. */
  project: Project | null,
  scale: number,
  zoom: number,
  frame: { width: number; height: number },
  theme: Theme = DEFAULT_THEME
): void {
  const onCanvas = canvasProjector(frame)

  for (const annotation of annotations) {
    if (!annotation.label) continue
    // A chart labels itself, below each bar.
    if (String(annotation.kind) === "chart") continue

    const window_ = annotationWindow(annotation, scenes)
    if (!window_) continue
    if (now < window_.start || now > window_.end) continue

    const into = (now - window_.start) / 0.5
    const outOf = (window_.end - now) / 0.5
    const fade = Math.max(0, Math.min(1, into, outOf))
    const motion = entranceAt(annotation, window_, now, frame)
    const alpha = motion ? motion.alpha : fade
    if (alpha <= 0.01) continue

    // A typewriter shortens the words rather than dimming them.
    const text = motion
      ? revealText(String(annotation.label), motion.reveal)
      : String(annotation.label)
    if (!text) continue

    const place = isCanvas(annotation) ? onCanvas : project
    if (!place) continue

    const paint = paintOf(annotation)
    const geometry = coordsOf(annotation)
    const leader = leaderOf(annotation)

    let anchor: Point | null = null
    let edge = 0
    let fallback: { x: number; y: number; align: CanvasTextAlign } | null = null

    if (geometry.type === "Point") {
      const [lng, lat] = geometry.coordinates as [number, number]
      const at = place(lng, lat)
      anchor = at

      if (String(annotation.kind) === "text") {
        edge = 0
      } else if (annotation.kind === "circle") {
        edge = isCanvas(annotation)
          ? canvasRadius(annotation, frame)
          : metresToPixels(Number(annotation.radius_m) || 0, lat, zoom)
      } else {
        edge = Math.max(4, 5.5 * scale) + 3 * scale
      }
      fallback =
        String(annotation.kind) === "text"
          ? { x: at.x, y: at.y, align: "center" as CanvasTextAlign }
          : { x: at.x, y: at.y - edge - 14 * scale, align: "center" as CanvasTextAlign }
    } else if (Array.isArray(geometry.coordinates)) {
      const ring =
        annotation.kind === "polygon"
          ? ((geometry.coordinates as [number, number][][])[0] ?? [])
          : (geometry.coordinates as [number, number][])
      if (ring.length < 2) continue

      const points = smooth(
          ring.map(([lng, lat]) => place(lng, lat)),
          smoothingFor(annotation)
        )
      // Two thirds along rather than the midpoint: on a long river the
      // middle is often the busiest part of the frame, and the label reads
      // better where the line has room beside it.
      const at = points[Math.floor(points.length * 0.66)] ?? points[0]
      anchor = at
      edge = paint.weight * scale
      fallback = { x: at.x, y: at.y - 14 * scale, align: "center" }
    }

    if (!anchor || !fallback) continue

    const weight = emphasisOf(annotation as { emphasis?: unknown }, theme)

    context.save()
    context.globalAlpha = alpha
    if (motion && (motion.dx || motion.dy)) context.translate(motion.dx, motion.dy)

    if (leader) {
      const from = {
        x: anchor.x + leader.dx * edge,
        y: anchor.y + leader.dy * edge,
      }
      const at = drawLeader(context, leader, from, paint, scale, frame, text)
      label(context, text, at.x, at.y, scale, at.align, weight, theme)
    } else {
      label(context, text, fallback.x, fallback.y, scale, fallback.align, weight, theme)
    }

    context.restore()
  }
}
