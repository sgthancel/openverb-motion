/**
 * The typography around the map.
 *
 * A frame that is only a map and a caption reads as a screenshot of a map
 * application. What makes an explainer look authored is the banding: a
 * header that says where you are, a map given a defined area rather than the
 * whole frame, and a footer that says what the colours mean and how far
 * through you are.
 *
 * Every word drawn here is already in the document. Scene titles in
 * particular have been sitting in `scene.title` since the format was written
 * and no renderer has ever put them on screen.
 */
import type { GeoStoryDocument, GeoStoryScene } from "@openverb/geostory"
import { DEFAULT_THEME, type Theme } from "./theme"
import {
  attributionFor,
  isMapless as mapless,
  placeOf,
  sceneWindows,
} from "./timeline"

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface LegendEntry {
  label: string
  color: string
}

export interface ChromeInfo {
  /** Small line above the title: the story this scene belongs to. */
  kicker?: string
  /** The scene's own title, numbered. */
  title?: string
  /** A line under the title saying where this is. */
  dek?: string
  caption?: string
  legend: LegendEntry[]
  /** The credit and caveat line along the bottom. */
  note?: string
  /** 1-based. */
  index: number
  count: number
  /** How far through each scene is, 0..1, one per scene. */
  progress: number[]
}

/**
 * Where everything sits, as fractions of the frame.
 *
 * Proportional rather than fixed so that a 720p export and a 4K one are the
 * same picture, and so a vertical frame does not have a header sized for a
 * widescreen one.
 */
export function chromeLayout(width: number, height: number): {
  map: Rect
  margin: number
  scale: number
} {
  const margin = Math.round(width * 0.042)
  const tall = height > width

  // Thin. The first version of this copied a reference frame's proportions
  // and gave nearly half the height to type, which left the map a 3.2:1
  // letterbox showing a sliver of latitude - a world map with no world in
  // it. The map is the subject; the words are a label on it.
  const top = Math.round(height * (tall ? 0.085 : 0.105))
  const bottom = Math.round(height * (tall ? 0.075 : 0.085))

  return {
    // Full width. Side margins bought nothing and cost degrees of longitude.
    map: {
      x: 0,
      y: top,
      width,
      height: Math.max(80, height - top - bottom),
    },
    margin,
    scale: Math.max(0.5, height / 1080),
  }
}

/** Everything the chrome needs for one moment of the story. */
export function chromeAt(
  doc: GeoStoryDocument,
  seconds: number
): ChromeInfo | null {
  const windows = sceneWindows(doc)
  if (!windows.length) return null

  let current = windows.find(
    ({ start, end }) => seconds >= start && seconds < end
  )
  if (!current) current = seconds < windows[0].start ? windows[0] : windows[windows.length - 1]

  const scene: GeoStoryScene = current.scene
  // The sub-heading says where you are looking. A document with no basemap
  // is not looking anywhere, and naming its canvas as if it were a place
  // put the word "Canvas" under the title of a product presentation.
  const place = mapless(doc) ? undefined : placeOf(doc, scene.place_id)

  // The legend is the scene's own annotations, named and coloured as the
  // document named and coloured them. Nothing invented.
  const shown = new Set(scene.annotation_ids ?? [])
  const legend: LegendEntry[] = (doc.annotations ?? [])
    .filter((annotation) => shown.has(annotation.id) && annotation.label)
    .map((annotation) => ({
      label: String(annotation.label),
      color: annotation.style?.color ?? "#4FC3F7",
    }))

  const number = String(current.index + 1).padStart(2, "0")

  return {
    kicker: doc.story?.title ?? doc.name,
    title: scene.title ? `${number} / ${scene.title}` : undefined,
    dek: place?.resolved?.name ?? place?.as_written,
    caption: scene.content?.caption?.trim() || undefined,
    legend,
    note: attributionFor(doc).join(" · ") || undefined,
    index: current.index + 1,
    count: windows.length,
    progress: windows.map(({ start, end }) =>
      Math.max(0, Math.min(1, (seconds - start) / Math.max(0.001, end - start)))
    ),
  }
}

function wrap(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines = 3
): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ""

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (context.measureText(candidate).width <= maxWidth || !line) {
      line = candidate
    } else {
      lines.push(line)
      line = word
      if (lines.length === maxLines) break
    }
  }
  if (line && lines.length < maxLines) lines.push(line)
  return lines
}

/** Uppercase with the letters spaced out, which canvas will not do for us. */
function tracked(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  spacing: number
): void {
  let cursor = x
  for (const character of text) {
    context.fillText(character, cursor, y)
    cursor += context.measureText(character).width + spacing
  }
}

/**
 * Draw the page around the map.
 *
 * Called after the map so that nothing on the map can cover the words, and
 * so the header and footer sit on the page colour rather than on tiles.
 */
export function drawChrome(
  context: CanvasRenderingContext2D,
  info: ChromeInfo,
  width: number,
  height: number,
  theme: Theme = DEFAULT_THEME
): void {
  const { map, margin, scale } = chromeLayout(width, height)

  context.save()
  context.textBaseline = "alphabetic"
  context.textAlign = "left"

  /* Header ------------------------------------------------------------ */

  // Anchored to the frame rather than stacked by adding up font advances.
  // Stacking put the subtitle wherever the title happened to end, which on a
  // long title was on top of the map.
  const available = width - margin * 2

  if (info.kicker) {
    const size = Math.round(13 * scale)
    context.font = `600 ${size}px ${theme.font}`
    context.fillStyle = theme.kicker
    tracked(context, info.kicker.toUpperCase(), margin, height * 0.032, size * 0.18)
  }

  // The place sits at the right end of the title's own line rather than
  // under it. A line of its own would cost the map another forty pixels of
  // latitude to say three words.
  let dekWidth = 0
  if (info.dek) {
    const size = Math.round(19 * scale)
    context.font = `400 ${size}px ${theme.font}`
    const text = wrap(context, info.dek, available * 0.32, 1)[0] ?? ""
    dekWidth = context.measureText(text).width
    context.fillStyle = theme.dek
    context.textAlign = "right"
    context.fillText(text, width - margin, height * 0.082)
    context.textAlign = "left"
    dekWidth += margin
  }

  if (info.title) {
    const text = info.title.toUpperCase()
    const room = available - dekWidth

    // Shrunk to fit one line. The band is too thin to wrap into, and a
    // second line would push the title onto the map.
    let size = Math.round(38 * scale)
    const floor = Math.round(21 * scale)
    for (; size > floor; size -= 1) {
      context.font = `700 ${size}px ${theme.font}`
      if (context.measureText(text).width <= room) break
    }

    context.font = `700 ${size}px ${theme.font}`
    context.fillStyle = theme.title
    context.fillText(text, margin, height * 0.082)
  }

  /* Footer ------------------------------------------------------------ */

  const legendY = height - Math.round(height * 0.048)

  if (info.legend.length) {
    const size = Math.round(14 * scale)
    context.font = `600 ${size}px ${theme.font}`
    let cursor = margin

    for (const entry of info.legend.slice(0, 3)) {
      const swatch = Math.round(14 * scale)
      context.fillStyle = entry.color
      context.fillRect(cursor, legendY - swatch * 0.75, swatch * 1.6, swatch * 0.22)
      cursor += swatch * 2.3

      context.fillStyle = theme.legend
      const label = entry.label.toUpperCase()
      tracked(context, label, cursor, legendY, size * 0.16)
      cursor +=
        context.measureText(label).width + label.length * size * 0.16 + size * 2.4
    }
  }

  if (info.note) {
    const size = Math.round(12 * scale)
    context.font = `400 ${size}px ${theme.font}`
    context.fillStyle = theme.note
    const lines = wrap(context, info.note, width - margin * 2, 1)
    context.fillText(lines[0] ?? "", margin, legendY + Math.round(size * 1.7))
  }

  // The counter, large and nearly transparent, the way a page number is.
  {
    const size = Math.round(28 * scale)
    context.font = `300 ${size}px ${theme.font}`
    context.fillStyle = theme.counter
    context.textAlign = "right"
    const number = String(info.index).padStart(2, "0")
    const total = String(info.count).padStart(2, "0")
    context.fillText(`${number} / ${total}`, width - margin, legendY)
    context.textAlign = "left"
  }

  /* Progress ---------------------------------------------------------- */

  if (info.progress.length > 1) {
    const barY = height - Math.round(height * 0.014)
    const gap = Math.round(10 * scale)
    const span = width - margin * 2
    const each = (span - gap * (info.progress.length - 1)) / info.progress.length
    const thickness = Math.max(2, Math.round(3 * scale))

    info.progress.forEach((filled, i) => {
      const x = margin + i * (each + gap)
      context.fillStyle = theme.track
      context.fillRect(x, barY, each, thickness)
      if (filled > 0) {
        context.fillStyle = theme.fill
        context.fillRect(x, barY, each * filled, thickness)
      }
    })
  }

  context.restore()
}

export const PAGE_COLOUR = DEFAULT_THEME.page
