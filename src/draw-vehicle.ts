/**
 * One thing, moving along a path, in step with the narration.
 *
 * WHY THIS IS NOT `animate.particles`. The flow layer already moves markers
 * along a line, and it is the wrong tool for a journey. Flow particles are a
 * texture: N of them, spaced evenly, cycling forever at a speed quoted in
 * pixels per second. They say "this line has a direction and a rate" — which
 * is right for a current, a trade route or a river, and wrong for an
 * aircraft, because an aircraft is ONE object, it is somewhere definite at
 * every moment, and it arrives once.
 *
 * So the position here is not integrated from a speed. It is a pure function
 * of the clock: progress through declared legs, resolved to a distance along
 * the path. That matters for a document whose claim is that the picture
 * agrees with the words — scrubbing backwards puts the vehicle exactly where
 * it was, and a line of narration about the Gulf plays while the aircraft is
 * over the Gulf. A particle system can promise neither.
 *
 * BY DISTANCE, NOT BY VERTEX. Walking the polyline one vertex per tick makes
 * the marker sprint across a long leg and crawl through a cluster of close
 * ones. Progress is measured against cumulative great-circle distance, so a
 * constant progress rate is a constant ground speed.
 *
 * HOW A DOCUMENT ASKS FOR IT. `animate` is the one block in the schema with
 * an explicit index signature for unknown fields, which makes it the
 * designed place to put this without changing the format:
 *
 *     animate:
 *       vehicle: plane          # plane | dot | none
 *       vehicle_keys: [0.04, 0.80, 1.0, 1.0]
 *       vehicle_color: "#F2F5F7"
 *       vehicle_label: "N722BD"
 *
 * `vehicle_keys` gives ONE FRACTION OF THE PATH PER SCENE the annotation
 * appears in: how far along it has travelled by the time that scene ends.
 * Motion is linear inside a scene and the keys are the joins, so the pace
 * can differ scene to scene while staying continuous.
 *
 * That is not a flourish. The camera in a GeoStory moves per scene, and a
 * vehicle crossing at one constant rate spends most of its time outside
 * whatever the camera is framing — two hours of Gulf and three minutes of
 * Florida cannot share a rate. Per-scene keys put the vehicle where the
 * sentence being spoken says it is. Equal keys either side of a scene park
 * it for that scene.
 *
 * Without keys, a single leg runs across the whole window, trimmed by the
 * optional `vehicle_from` / `vehicle_to` fractions.
 *
 * THIS LIVES IN THE PACKAGE RATHER THAN IN A HOST so that the preview and
 * the exported video draw the same thing. It did not, for one release: the
 * player had a vehicle layer of its own and `renderFrame` had no vehicle
 * pass at all, so every exported MP4 came out with the aircraft missing and
 * nothing in the pipeline could notice.
 */
import type { GeoStoryAnnotation } from "@openverb/geostory"
import type { FlowScene, Project } from "./draw-flow"
import { canvasProjector, isCanvas } from "./space"

export type VehicleKind = "plane" | "dot"

/** One scene's worth of travel: clock seconds in, path fractions out. */
interface Leg {
  start: number
  end: number
  from: number
  to: number
}

interface VehicleSpec {
  id: string
  kind: VehicleKind
  canvas: boolean
  /** Ordered, contiguous, one per scene that shows the annotation. */
  legs: Leg[]
  path: [number, number][]
  /** Cumulative great-circle distance to each vertex, metres. */
  marks: number[]
  total: number
  /**
   * The glyph and its track. The annotation's own colour stays the faint
   * whole route underneath, so the part already travelled reads brighter.
   */
  colour: string
  weight: number
  trail: boolean
  label?: string
}

const R = 6371008.8
const D2R = Math.PI / 180

function haversine(a: [number, number], b: [number, number]): number {
  const dLat = (b[1] - a[1]) * D2R
  const dLon = (b[0] - a[0]) * D2R
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * D2R) * Math.cos(b[1] * D2R) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

function num(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/** The vehicles a document declares, with their legs resolved against scenes. */
function vehiclesOf(
  annotations: GeoStoryAnnotation[],
  scenes: FlowScene[]
): VehicleSpec[] {
  const out: VehicleSpec[] = []

  for (const annotation of annotations) {
    const animate = annotation.animate as Record<string, unknown> | undefined
    const asked = animate?.vehicle
    if (typeof asked !== "string" || asked === "none") continue
    const kind: VehicleKind = asked === "dot" ? "dot" : "plane"

    const geometry = annotation.geometry as { type?: string; coordinates?: unknown }
    if (geometry?.type !== "LineString" || !Array.isArray(geometry.coordinates)) continue
    const path = (geometry.coordinates as [number, number][]).filter(
      (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])
    )
    if (path.length < 2) continue

    const showing = scenes.filter((s) => s.annotationIds.includes(annotation.id))
    if (!showing.length) continue
    const windowStart = Math.min(...showing.map((s) => s.start))
    const windowEnd = Math.max(...showing.map((s) => s.end))

    const clamp01 = (v: unknown, fallback: number) =>
      Math.max(0, Math.min(1, num(v, fallback)))

    // Scene order is the order of travel. `showing` comes from the scene
    // list, which is already in sequence, but sorting makes that an
    // assumption this file states rather than one it inherits.
    const ordered = [...showing].sort((a, b) => a.start - b.start)
    const keys = Array.isArray(animate?.vehicle_keys)
      ? (animate.vehicle_keys as unknown[]).map((k, i) =>
          clamp01(k, (i + 1) / ordered.length)
        )
      : null

    const legs: Leg[] = []
    if (keys && keys.length) {
      let reached = 0
      ordered.forEach((scene, i) => {
        const target = clamp01(keys[Math.min(i, keys.length - 1)], 1)
        legs.push({ start: scene.start, end: scene.end, from: reached, to: target })
        reached = target
      })
    } else {
      const span = windowEnd - windowStart
      legs.push({
        start: windowStart + clamp01(animate?.vehicle_from, 0) * span,
        end: windowStart + clamp01(animate?.vehicle_to, 1) * span,
        from: 0,
        to: 1,
      })
    }
    if (!legs.length || !(legs[legs.length - 1].end > legs[0].start)) continue

    // Cumulative distance, so a constant progress rate is a constant ground
    // speed. On a canvas path there is no ground, so the same arithmetic is
    // run on the percentages and means the same thing.
    const marks: number[] = [0]
    for (let i = 1; i < path.length; i++) {
      marks.push(marks[i - 1] + haversine(path[i - 1], path[i]))
    }
    const total = marks[marks.length - 1]
    if (!(total > 0)) continue

    out.push({
      id: annotation.id,
      kind,
      canvas: isCanvas(annotation),
      legs,
      path,
      marks,
      total,
      colour:
        typeof animate?.vehicle_color === "string"
          ? (animate.vehicle_color as string)
          : annotation.style?.color ?? "#FFFFFF",
      weight: num(annotation.style?.weight, 3),
      trail: animate?.vehicle_trail !== false,
      label:
        typeof animate?.vehicle_label === "string"
          ? (animate.vehicle_label as string)
          : undefined,
    })
  }

  return out
}

/**
 * How far along the path the vehicle is at `now`, or null when there is none
 * to draw.
 *
 * Null OUTSIDE the legs in both directions. Holding the last position past
 * the final leg looks like the kinder behaviour and is wrong: the legs end
 * exactly when the last scene showing the annotation ends, so holding draws
 * the vehicle over every later scene. Staying put while a scene talks about
 * where it stopped is a matter of giving that scene a leg with equal
 * endpoints, not of outliving the annotation.
 */
function progressAt(spec: VehicleSpec, now: number): number | null {
  const legs = spec.legs
  if (now < legs[0].start) return null
  for (const leg of legs) {
    if (now <= leg.end) {
      const span = leg.end - leg.start
      const t = span > 0 ? Math.max(0, (now - leg.start) / span) : 1
      return leg.from + (leg.to - leg.from) * Math.min(1, t)
    }
  }
  return null
}

/** Whether the vehicle is travelling at `now`, as opposed to parked. */
function movingAt(spec: VehicleSpec, now: number): boolean {
  for (const leg of spec.legs) {
    if (now <= leg.end) return leg.to !== leg.from
  }
  return false
}

/** Where along the path a fraction falls, and which leg it is on. */
function at(
  spec: VehicleSpec,
  fraction: number
): { lng: number; lat: number; leg: number } {
  const target = Math.max(0, Math.min(1, fraction)) * spec.total
  let leg = 1
  while (leg < spec.marks.length - 1 && spec.marks[leg] < target) leg++
  const span = spec.marks[leg] - spec.marks[leg - 1]
  const t = span > 0 ? (target - spec.marks[leg - 1]) / span : 0
  const a = spec.path[leg - 1]
  const b = spec.path[leg]
  return { lng: a[0] + (b[0] - a[0]) * t, lat: a[1] + (b[1] - a[1]) * t, leg }
}

/**
 * An aeroplane in plan, nose along +x, drawn around the origin.
 *
 * Deliberately a silhouette rather than a triangle. At the size this draws,
 * a triangle reads as a cursor or a play button; swept wings and a tailplane
 * read as an aircraft from above, which is the one thing the glyph has to do
 * on a map that is already full of lines.
 */
function planePath(context: CanvasRenderingContext2D, r: number): void {
  context.beginPath()
  context.moveTo(r * 1.15, 0)
  context.lineTo(r * 0.3, r * 0.16)
  context.lineTo(r * 0.1, r * 0.16)
  context.lineTo(r * -0.42, r * 0.8)
  context.lineTo(r * -0.7, r * 0.8)
  context.lineTo(r * -0.4, r * 0.14)
  context.lineTo(r * -0.8, r * 0.14)
  context.lineTo(r * -0.98, r * 0.4)
  context.lineTo(r * -1.12, r * 0.4)
  context.lineTo(r * -1.04, 0)
  context.lineTo(r * -1.12, r * -0.4)
  context.lineTo(r * -0.98, r * -0.4)
  context.lineTo(r * -0.8, r * -0.14)
  context.lineTo(r * -0.4, r * -0.14)
  context.lineTo(r * -0.7, r * -0.8)
  context.lineTo(r * -0.42, r * -0.8)
  context.lineTo(r * 0.1, r * -0.16)
  context.lineTo(r * 0.3, r * -0.16)
  context.closePath()
}

/**
 * Every vehicle on screen at `now`, with the track it has already covered.
 *
 * Drawn after the labels, because a vehicle has to sit on top of every line
 * including its own track, and a place name under it is the lesser loss.
 */
export function drawVehicles(
  context: CanvasRenderingContext2D,
  annotations: GeoStoryAnnotation[],
  scenes: FlowScene[],
  now: number,
  /** Absent when the document has no camera - canvas vehicles need none. */
  project: Project | null,
  scale: number,
  frame: { width: number; height: number }
): void {
  const onCanvas = canvasProjector(frame)

  for (const spec of vehiclesOf(annotations, scenes)) {
    const place = spec.canvas ? onCanvas : project
    if (!place) continue

    const fraction = progressAt(spec, now)
    if (fraction === null) continue
    const head = at(spec, fraction)
    const here = place(head.lng, head.lat)

    // The track already covered, which is the part of a flight map that
    // carries the information. The faint whole route belongs to the
    // annotation itself and is drawn by the pass before this one.
    if (spec.trail) {
      context.save()
      context.lineCap = "round"
      context.lineJoin = "round"
      context.strokeStyle = spec.colour
      context.lineWidth = spec.weight * scale
      context.beginPath()
      const first = place(spec.path[0][0], spec.path[0][1])
      context.moveTo(first.x, first.y)
      for (let i = 1; i < head.leg; i++) {
        const point = place(spec.path[i][0], spec.path[i][1])
        context.lineTo(point.x, point.y)
      }
      context.lineTo(here.x, here.y)
      context.stroke()
      context.restore()
    }

    // Bearing from screen positions rather than from the coordinates,
    // because what has to look right is the glyph against the drawn track,
    // and the projection has already had its say by this point.
    const behind = at(spec, Math.max(0, fraction - 0.004))
    const tail = place(behind.lng, behind.lat)
    const dx = here.x - tail.x
    const dy = here.y - tail.y
    const angle = Math.hypot(dx, dy) > 0.5 ? Math.atan2(dy, dx) : 0

    context.save()
    context.translate(here.x, here.y)
    if (spec.kind === "plane") {
      context.rotate(angle)
      const r = 15 * scale
      // A dark outline under the fill: the glyph has to stay legible over a
      // pale coastline and over open water in the same shot.
      planePath(context, r)
      context.lineJoin = "round"
      context.strokeStyle = "rgba(6, 10, 14, 0.85)"
      context.lineWidth = 3.5 * scale
      context.stroke()
      context.fillStyle = spec.colour
      context.fill()
    } else {
      const r = 6 * scale
      context.beginPath()
      context.arc(0, 0, r, 0, Math.PI * 2)
      context.fillStyle = spec.colour
      context.strokeStyle = "rgba(6, 10, 14, 0.85)"
      context.lineWidth = 2.5 * scale
      context.fill()
      context.stroke()
    }
    context.restore()

    // A callsign identifies something in flight. Once the vehicle is parked
    // it is a place, and whatever marker is already there should be naming
    // it; keeping both only collides the two labels.
    if (spec.label && movingAt(spec, now)) {
      context.save()
      context.font = `600 ${Math.round(
        13 * scale
      )}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
      context.textAlign = "center"
      context.textBaseline = "bottom"
      const y = here.y - 22 * scale
      context.lineJoin = "round"
      context.strokeStyle = "rgba(6, 10, 14, 0.85)"
      context.lineWidth = 3.5 * scale
      context.strokeText(spec.label, here.x, y)
      context.fillStyle = spec.colour
      context.fillText(spec.label, here.x, y)
      context.restore()
    }
  }
}
