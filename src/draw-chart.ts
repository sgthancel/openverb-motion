/**
 * Numbers, drawn.
 *
 * The last primitive on the list, and the only one that was genuinely
 * absent rather than merely addressed in the wrong coordinate system. A
 * presentation that cannot show a quantity has to put it in a sentence,
 * and a sentence is the worst way to show a trend.
 *
 * Deliberately small. Bars and a line, values above them, categories
 * below, and a baseline. No axes, no gridlines, no legend, no stacking, no
 * dual scales. Those are the things that make a chart library, and a chart
 * library is not what a renderer needs - a document that wants one of
 * those can say so later and be told no for a good reason.
 *
 * The bars grow with the entrance progress rather than fading in, because
 * a half-transparent bar at full height reads as a rendering fault while a
 * solid bar at half height reads as data arriving.
 */
import { canvasBox, isCanvas } from "./space"
import type { Theme } from "./theme"

export interface ChartPoint {
  label: string
  value: number
}

export interface ChartSpec {
  kind: "bars" | "line"
  points: ChartPoint[]
  /** Centre of the chart, in pixels. */
  cx: number
  cy: number
  width: number
  height: number
  colour: string
}

/** Pulls a chart out of an annotation, or null when it is not one. */
export function chartOf(
  annotation: unknown,
  frame: { width: number; height: number },
  project: (x: number, y: number) => { x: number; y: number }
): ChartSpec | null {
  const a = annotation as Record<string, unknown> | null
  if (!a || String(a.kind) !== "chart") return null

  const raw = Array.isArray(a.series) ? a.series : []
  const points: ChartPoint[] = raw
    .map((entry) => {
      const row = entry as { label?: unknown; value?: unknown }
      return { label: String(row?.label ?? ""), value: Number(row?.value) }
    })
    .filter((p) => Number.isFinite(p.value))
  if (!points.length) return null

  // Position comes from the same geometry everything else uses, so a chart
  // can sit in canvas space or on a map without a second code path.
  const geometry = (a.geometry ?? {}) as { type?: string; coordinates?: unknown }
  let centre = { x: frame.width / 2, y: frame.height / 2 }
  if (geometry.type === "Point" && Array.isArray(geometry.coordinates)) {
    const [x, y] = geometry.coordinates as [number, number]
    centre = project(x, y)
  }

  // A canvas chart is sized against the same letterboxed box its position is
  // read from, or it would sit in one rectangle and be measured in another.
  const size = Array.isArray(a.size) ? (a.size as unknown[]) : []
  const box = isCanvas(a) ? canvasBox(frame) : frame
  const width = ((Number(size[0]) || 60) / 100) * box.width
  const height = ((Number(size[1]) || 30) / 100) * box.height

  const style = (a.style ?? {}) as { color?: unknown }
  return {
    kind: String(a.chart) === "line" ? "line" : "bars",
    points,
    cx: centre.x,
    cy: centre.y,
    width,
    height,
    colour: typeof style.color === "string" ? style.color : "#5EC8E5",
  }
}

function short(value: number): string {
  const n = Math.abs(value)
  if (n >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

export function drawChart(
  context: CanvasRenderingContext2D,
  spec: ChartSpec,
  /** 0..1 of the entrance, so the data arrives rather than appearing. */
  progress: number,
  scale: number,
  theme: Theme
): void {
  const { points, width, height, colour } = spec
  const x0 = spec.cx - width / 2
  const y1 = spec.cy + height / 2
  const grown = Math.max(0, Math.min(1, progress))

  // Scaled from zero rather than from the smallest value: a bar chart whose
  // baseline is not zero lies about the ratios it is drawing.
  const peak = Math.max(...points.map((p) => p.value), 0) || 1
  const room = height - 26 * scale // leaves the value labels inside the box

  const slot = width / points.length
  const barWidth = Math.min(slot * 0.62, 90 * scale)

  context.save()
  context.textAlign = "center"
  context.lineJoin = "round"

  // The baseline, which is also what the bars stand on.
  context.strokeStyle = theme.track
  context.lineWidth = Math.max(1, 1.5 * scale)
  context.beginPath()
  context.moveTo(x0, y1)
  context.lineTo(x0 + width, y1)
  context.stroke()

  const centres = points.map((_, i) => x0 + slot * (i + 0.5))
  const tops = points.map((p) => y1 - (p.value / peak) * room * grown)

  if (spec.kind === "bars") {
    context.fillStyle = colour
    points.forEach((_, i) => {
      const top = tops[i]
      context.globalAlpha = 0.85
      context.fillRect(centres[i] - barWidth / 2, top, barWidth, y1 - top)
    })
    context.globalAlpha = 1
  } else {
    context.strokeStyle = colour
    context.lineWidth = Math.max(2, 3 * scale)
    context.beginPath()
    centres.forEach((x, i) => (i ? context.lineTo(x, tops[i]) : context.moveTo(x, tops[i])))
    context.stroke()

    context.fillStyle = colour
    centres.forEach((x, i) => {
      context.beginPath()
      context.arc(x, tops[i], Math.max(2.5, 4 * scale), 0, Math.PI * 2)
      context.fill()
    })
  }

  // Values above, categories below. Both fade in over the last of the
  // growth so the numbers do not flicker while the bars are still moving.
  const words = Math.max(0, (grown - 0.55) / 0.45)
  if (words > 0.01) {
    context.globalAlpha = Math.min(1, words)

    context.font = `600 ${Math.round(13 * scale)}px ${theme.font}`
    context.fillStyle = theme.title
    context.textBaseline = "bottom"
    points.forEach((p, i) => {
      context.fillText(short(p.value), centres[i], tops[i] - 6 * scale)
    })

    context.font = `400 ${Math.round(12 * scale)}px ${theme.font}`
    context.fillStyle = theme.legend
    context.textBaseline = "top"
    points.forEach((p, i) => {
      if (p.label) context.fillText(p.label, centres[i], y1 + 7 * scale)
    })
  }

  context.restore()
}
