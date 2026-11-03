/**
 * Drawing a GeoStory frame onto a canvas, without a map library.
 *
 * Leaflet puts tiles in the DOM as <img> elements and the captions are HTML,
 * so there is no canvas to record and nothing to hand an encoder. Exporting
 * by screenshotting the DOM would tie the output to the window size, to the
 * frame rate the machine happened to manage, and to whatever the browser had
 * finished painting.
 *
 * So the exporter draws its own frames: tile arithmetic is about forty lines,
 * and in exchange a frame becomes a pure function of the document and a time.
 * Any resolution, any frame rate, no realtime, and the same frame every run.
 *
 * The flow drawing is shared with the live overlay rather than reimplemented
 * here - see draw-flow - so that the file matches the preview.
 */
import type { GeoStoryDocument, GeoStoryAnnotation } from "@openverb/geostory"
import { withSpaces, hasCanvasAnnotations, isCanvas } from "./space"
import { DEFAULT_THEME, fontFor, themeOf, type Theme } from "./theme"
import {
  basemapAt,
  cameraTrack,
  sceneWindows,
  visualsFrom,
  type GeoCamera,
} from "./timeline"
import { drawFlow, type FlowScene } from "./draw-flow"
import {
  drawAnnotations,
  drawAnnotationLabels,
  emphasisOf,
  roleOf,
} from "./draw-annotations"
import { annotationWindow } from "./flow"
import {
  PAGE_COLOUR,
  chromeAt,
  chromeLayout,
  drawChrome,
  type Rect,
} from "./chrome"

export const TILE_SIZE = 256

/**
 * How basemap tiles are toned down before anything is drawn on them.
 *
 * Esri's terrain and ocean tiles are built to be read on their own: bright
 * green land, white ice, full-strength bathymetry. A story draws its own
 * lines and labels on top, and at full saturation they compete with the map
 * instead of sitting on it - the Gulf Stream nearly disappears into the
 * bathymetry it is crossing.
 *
 * Gentle on purpose. Enough to push the basemap back a step, not enough to
 * turn a daylight satellite image into night, which would be a different
 * and worse lie about the place.
 *
 * Exported as a string because the live player applies the identical filter
 * in CSS - see globals.css. One definition, so the preview and the file
 * cannot drift apart.
 */
export const BASEMAP_FILTER = "saturate(0.78) brightness(0.94) contrast(1.04)"

/* -- Web Mercator ------------------------------------------------------ */

/** Longitude onto the 0..1 axis of the Mercator square. */
function normX(lng: number): number {
  return (lng + 180) / 360
}

/** Latitude onto the 0..1 axis, which is where the log comes in. */
function normY(lat: number): number {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat))
  const sin = Math.sin((clamped * Math.PI) / 180)
  return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)
}

function latFromNormY(y: number): number {
  return (180 / Math.PI) * Math.atan(Math.sinh(Math.PI * (1 - 2 * y)))
}

export interface RasterCamera {
  /** [lat, lng], the order Leaflet uses and the rest of this app follows. */
  center: [number, number]
  zoom: number
}

/**
 * The zoom and centre that put `bounds` inside a frame of this size.
 *
 * The document's own `zoom` is a convenience the spec says bounds outrank,
 * and it was cached against whatever window the author happened to have open.
 * An export can be any size, so the fit is computed rather than trusted.
 */
export function fitBounds(
  bounds: [[number, number], [number, number]],
  width: number,
  height: number,
  maxZoom = 18,
  // More air than the old 0.12. The exported band is wider and shorter
  // than the player's map, so the same bounds framed tighter there and
  // clipped things the preview had shown. A document can ask for less:
  // a frame with no map has no context to leave room for.
  padding = 0.2
): RasterCamera {
  if (!Number.isFinite(padding) || padding < 0 || padding >= 1) padding = 0.2
  const [[south, west], [north, east]] = bounds

  const spanX = Math.abs(normX(east) - normX(west)) || 1e-9
  const spanY = Math.abs(normY(south) - normY(north)) || 1e-9

  const usableWidth = width * (1 - padding)
  const usableHeight = height * (1 - padding)

  const zoom = Math.min(
    Math.log2(usableWidth / (TILE_SIZE * spanX)),
    Math.log2(usableHeight / (TILE_SIZE * spanY))
  )

  return {
    center: [latFromNormY((normY(south) + normY(north)) / 2), (west + east) / 2],
    zoom: Math.max(0, Math.min(maxZoom, zoom)),
  }
}

/** A document camera, resolved against a frame of this size. */
function resolve(
  camera: GeoCamera,
  width: number,
  height: number,
  maxZoom: number
): RasterCamera {
  if (camera.bounds) {
    return fitBounds(camera.bounds, width, height, maxZoom, camera.padding)
  }
  return { center: camera.center, zoom: Math.min(camera.zoom, maxZoom) }
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

/** How long the camera takes to arrive, by transition. */
const FLIGHT: Record<GeoCamera["transition"], number> = {
  cut: 0,
  fly: 1.6,
  fade: 1.0,
  dissolve: 1.2,
}

/**
 * Where the camera is at this instant, interpolating between shots.
 *
 * The live player hands each shot to Leaflet's flyTo and lets it animate.
 * Here there is nothing to animate it, so the move is interpolated directly,
 * in Mercator space, so that panning and zooming at once does not drift.
 */
export function cameraAtTime(
  doc: GeoStoryDocument,
  seconds: number,
  width: number,
  height: number,
  maxZoom = 18
): RasterCamera | null {
  const windows = sceneWindows(doc)
  if (!windows.length) return null

  const track = cameraTrack(doc)

  let index = windows.findIndex(
    ({ start, end }) => seconds >= start && seconds < end
  )
  if (index === -1) index = seconds < windows[0].start ? 0 : windows.length - 1

  const camera = track[index]
  if (!camera) return null

  const target = resolve(camera, width, height, maxZoom)

  const flight = FLIGHT[camera.transition] ?? 0
  const elapsed = seconds - windows[index].start

  /**
   * Once the camera arrives it used to stop dead, and a held shot with a
   * voice over it is a photograph for ten or fifteen seconds. A slow push
   * in keeps the frame alive without inventing anything: the geography is
   * unchanged, only the framing moves.
   *
   * Small enough to be felt rather than noticed - about four percent of a
   * zoom level across a whole scene.
   */
  const drift = (): RasterCamera => {
    const window_ = windows[index]
    const held = Math.max(0, seconds - window_.start - flight)
    const room = Math.max(0.001, window_.end - window_.start - flight)
    return {
      center: target.center,
      zoom: target.zoom + 0.06 * Math.min(1, held / room),
    }
  }

  if (index === 0 || flight <= 0 || elapsed >= flight) return drift()

  const previous = track[index - 1]
  if (!previous) return target
  const from = resolve(previous, width, height, maxZoom)

  const t = easeInOut(Math.max(0, Math.min(1, elapsed / flight)))
  const fromX = normX(from.center[1])
  const fromY = normY(from.center[0])
  const toX = normX(target.center[1])
  const toY = normY(target.center[0])

  return {
    center: [
      latFromNormY(fromY + (toY - fromY) * t),
      (fromX + (toX - fromX) * t) * 360 - 180,
    ],
    zoom: from.zoom + (target.zoom - from.zoom) * t,
  }
}

/* -- Tiles ------------------------------------------------------------- */

/**
 * Tiles, fetched once and kept.
 *
 * A thirty-second export at thirty frames asks for the same tiles nine
 * hundred times over. The cache is what makes rendering faster than
 * realtime; without it the export is bounded by the tile server's patience.
 *
 * crossOrigin is not optional: a canvas that has drawn a single tile without
 * it is tainted for good, and every later read - which is what encoding is -
 * throws. Both Esri basemaps send Access-Control-Allow-Origin.
 */
export class TileSource {
  private cache = new Map<string, Promise<HTMLImageElement | null>>()

  constructor(
    private template: string,
    readonly maxZoom = 18
  ) {}

  private url(z: number, x: number, y: number): string {
    return this.template
      .replace("{z}", String(z))
      .replace("{x}", String(x))
      .replace("{y}", String(y))
      .replace("{s}", "a")
      .replace("{r}", "")
  }

  load(z: number, x: number, y: number): Promise<HTMLImageElement | null> {
    const url = this.url(z, x, y)
    const existing = this.cache.get(url)
    if (existing) return existing

    const job = new Promise<HTMLImageElement | null>((settle) => {
      const image = new Image()
      image.crossOrigin = "anonymous"
      image.onload = () => settle(image)
      // A missing tile is a hole in the sea, not a failed export.
      image.onerror = () => settle(null)
      image.src = url
    })

    this.cache.set(url, job)
    return job
  }
}

/** Where a coordinate falls in a frame of this size. */
export function toScreen(
  lng: number,
  lat: number,
  camera: RasterCamera,
  width: number,
  height: number
): { x: number; y: number } {
  const world = TILE_SIZE * Math.pow(2, camera.zoom)
  const originX = normX(camera.center[1]) * world - width / 2
  const originY = normY(camera.center[0]) * world - height / 2
  return {
    x: normX(lng) * world - originX,
    y: normY(lat) * world - originY,
  }
}

async function drawBasemap(
  context: CanvasRenderingContext2D,
  source: TileSource,
  camera: RasterCamera,
  width: number,
  height: number
): Promise<void> {
  const tileZoom = Math.max(0, Math.min(source.maxZoom, Math.round(camera.zoom)))
  // Tiles are drawn at whatever size the fractional zoom calls for, so a
  // camera between two levels does not snap to one of them.
  const size = TILE_SIZE * Math.pow(2, camera.zoom - tileZoom)
  const across = Math.pow(2, tileZoom)

  const originX = normX(camera.center[1]) * across * size - width / 2
  const originY = normY(camera.center[0]) * across * size - height / 2

  const firstX = Math.floor(originX / size)
  const lastX = Math.floor((originX + width - 1) / size)
  const firstY = Math.floor(originY / size)
  const lastY = Math.floor((originY + height - 1) / size)

  const jobs: Promise<void>[] = []

  // Only the tiles. Annotations, captions and furniture are drawn after
  // this is cleared, at full strength, which is the whole point.
  const supportsFilter = "filter" in context
  if (supportsFilter) context.filter = BASEMAP_FILTER

  for (let ty = firstY; ty <= lastY; ty++) {
    if (ty < 0 || ty >= across) continue
    for (let tx = firstX; tx <= lastX; tx++) {
      // Wrapped, so a frame crossing the date line is not half empty.
      const wrapped = ((tx % across) + across) % across
      const dx = tx * size - originX
      const dy = ty * size - originY

      jobs.push(
        source.load(tileZoom, wrapped, ty).then((image) => {
          if (!image) return
          // A pixel of overlap: neighbouring tiles drawn at fractional sizes
          // otherwise leave hairline seams across the whole frame.
          context.drawImage(image, dx, dy, size + 1, size + 1)
        })
      )
    }
  }

  await Promise.all(jobs)
  if (supportsFilter) context.filter = "none"
}

/* -- Media ------------------------------------------------------------- */

/**
 * Pictures on the map.
 *
 * The player has shown these since it was written and the exporter never
 * did, so a story illustrated in the preview produced a video with nothing
 * in it. They are drawn into the map band rather than the whole frame, the
 * way the inset is, so they sit on the map they are explaining.
 */
const pictures = new Map<string, Promise<HTMLImageElement | null>>()

function loadPicture(src: string): Promise<HTMLImageElement | null> {
  const existing = pictures.get(src)
  if (existing) return existing

  const job = new Promise<HTMLImageElement | null>((settle) => {
    const image = new Image()
    // Harmless for the data URLs generated images use, and necessary for any
    // document that points at a real host - without it one picture taints
    // the canvas and every later read throws.
    image.crossOrigin = "anonymous"
    image.onload = () => settle(image)
    image.onerror = () => settle(null)
    image.src = src
  })

  pictures.set(src, job)
  return job
}

async function drawMedia(
  context: CanvasRenderingContext2D,
  doc: GeoStoryDocument,
  seconds: number,
  band: Rect,
  scale: number,
  baseUrl?: string
): Promise<void> {
  const showing = visualsFrom(doc, baseUrl).filter(
    (visual) => seconds >= visual.startTime && seconds < visual.endTime
  )
  if (!showing.length) return

  const loaded = await Promise.all(
    showing.map(async (visual) => ({
      visual,
      image: await loadPicture(visual.imageUrl),
    }))
  )

  for (const { visual, image } of loaded) {
    // A picture that would not load draws nothing, and the scene keeps its
    // map, its words and its chrome. That is the format's own rule: a
    // story has to stand up from its declarative data alone, so a missing
    // asset must degrade rather than leave a hole.
    if (!image) continue

    // The same half-second fade as captions and annotations.
    const into = (seconds - visual.startTime) / 0.5
    const outOf = (visual.endTime - seconds) / 0.5
    const alpha = Math.max(0, Math.min(1, into, outOf))
    if (alpha <= 0.01) continue

    if (visual.fit === "cover" || visual.fit === "contain") {
      // Cover takes the larger scale so the frame is filled and the
      // overflow is cropped; contain takes the smaller so the whole
      // picture is inside it. Neither gets a shadow or a border - those
      // are for a panel sitting on top of something, and this IS the
      // something.
      const byWidth = band.width / image.naturalWidth
      const byHeight = band.height / image.naturalHeight
      const base =
        visual.fit === "cover"
          ? Math.max(byWidth, byHeight)
          : Math.min(byWidth, byHeight)

      // A slow push across the window, so a held picture is not a freeze.
      const run = Math.max(0.001, visual.endTime - visual.startTime)
      const through = Math.max(0, Math.min(1, (seconds - visual.startTime) / run))
      const grown = visual.drift && visual.fit === "cover" ? 1 + 0.05 * through : 1

      const w = image.naturalWidth * base * grown
      const h = image.naturalHeight * base * grown

      context.save()
      // Clipped, because cover means the overflow is cut off rather than
      // painted across the bands above and below the map.
      context.beginPath()
      context.rect(band.x, band.y, band.width, band.height)
      context.clip()
      context.globalAlpha = alpha
      context.drawImage(
        image,
        band.x + (band.width - w) / 2,
        band.y + (band.height - h) / 2,
        w,
        h
      )
      context.restore()
      continue
    }

    const width = (visual.position.width / 100) * band.width
    const height = (width * image.naturalHeight) / image.naturalWidth
    const x = band.x + (visual.position.x / 100) * band.width
    const y = band.y + (visual.position.y / 100) * band.height

    context.save()
    context.globalAlpha = alpha

    context.shadowColor = "rgba(0,0,0,0.5)"
    context.shadowBlur = 14 * scale
    context.shadowOffsetY = 3 * scale
    context.drawImage(image, x, y, width, height)
    context.restore()

    context.save()
    context.globalAlpha = alpha
    context.strokeStyle = "rgba(255,255,255,0.22)"
    context.lineWidth = Math.max(1, 1.5 * scale)
    context.strokeRect(x, y, width, height)
    context.restore()
  }
}

/* -- The locator inset --------------------------------------------------- */

/** The ground the camera can currently see, as [[south, west], [north, east]]. */
export function viewBounds(
  camera: RasterCamera,
  width: number,
  height: number
): [[number, number], [number, number]] {
  const world = TILE_SIZE * Math.pow(2, camera.zoom)
  const originX = normX(camera.center[1]) * world - width / 2
  const originY = normY(camera.center[0]) * world - height / 2

  return [
    [latFromNormY((originY + height) / world), (originX / world) * 360 - 180],
    [latFromNormY(originY / world), ((originX + width) / world) * 360 - 180],
  ]
}

// Degrees. Below this the box is a smudge rather than a shape, so it is grown
// to here, centred on the real view - it stops being an accurate extent long
// before it stops being an accurate location, and location is the part worth
// keeping. The same numbers the live inset uses.
const MIN_SPAN_LAT = 11
const MIN_SPAN_LNG = 22
// Past this the inset would only be showing what the main map already shows.
const GLOBAL_SPAN_LNG = 170

/**
 * A small world with a box on it, saying where the main map is.
 *
 * Present in the live player from the start and missing from the first
 * export, which made a close shot of the Florida Straits unplaceable for
 * anyone who did not already know the coastline.
 */
async function drawInset(
  context: CanvasRenderingContext2D,
  source: TileSource,
  frame: Rect,
  view: [[number, number], [number, number]]
): Promise<void> {
  const [[south, west], [north, east]] = view
  if (east - west > GLOBAL_SPAN_LNG) return

  const centreLat = (south + north) / 2
  const centreLng = (west + east) / 2
  const spanLat = Math.max(north - south, MIN_SPAN_LAT)
  const spanLng = Math.max(east - west, MIN_SPAN_LNG)

  const box: [[number, number], [number, number]] = [
    [Math.max(-85, centreLat - spanLat / 2), Math.max(-180, centreLng - spanLng / 2)],
    [Math.min(85, centreLat + spanLat / 2), Math.min(180, centreLng + spanLng / 2)],
  ]

  context.save()
  context.translate(frame.x, frame.y)
  context.beginPath()
  context.rect(0, 0, frame.width, frame.height)
  context.clip()

  context.fillStyle = "#0b1016"
  context.fillRect(0, 0, frame.width, frame.height)

  // Zoomed so the whole world spans the inset's width.
  const camera: RasterCamera = {
    center: [0, 0],
    zoom: Math.log2(frame.width / TILE_SIZE),
  }
  await drawBasemap(context, source, camera, frame.width, frame.height)

  const at = (lng: number, lat: number) =>
    toScreen(lng, lat, camera, frame.width, frame.height)

  const topLeft = at(box[0][1], box[1][0])
  const bottomRight = at(box[1][1], box[0][0])
  const boxX = topLeft.x
  const boxY = topLeft.y
  const boxW = Math.max(3, bottomRight.x - topLeft.x)
  const boxH = Math.max(3, bottomRight.y - topLeft.y)

  // Everything outside the box goes dim, which reads as "here" far better
  // than an outline alone on a busy basemap.
  context.fillStyle = "rgba(6, 12, 20, 0.62)"
  context.fillRect(0, 0, frame.width, boxY)
  context.fillRect(0, boxY + boxH, frame.width, frame.height - boxY - boxH)
  context.fillRect(0, boxY, boxX, boxH)
  context.fillRect(boxX + boxW, boxY, frame.width - boxX - boxW, boxH)

  context.strokeStyle = "rgba(255,255,255,0.9)"
  context.lineWidth = Math.max(1, frame.height / 90)
  context.strokeRect(boxX, boxY, boxW, boxH)

  context.restore()

  context.save()
  context.strokeStyle = "rgba(255,255,255,0.22)"
  context.lineWidth = Math.max(1, frame.height / 120)
  context.strokeRect(frame.x, frame.y, frame.width, frame.height)
  context.restore()
}

/* -- Map furniture ------------------------------------------------------ */

/**
 * A scale bar and a north arrow.
 *
 * The scale bar answers the question every map raises and almost none
 * answer, and it is pure arithmetic - the camera already knows how many
 * metres a pixel is worth. The north arrow is nearly decorative on a
 * north-up projection, but the narration says things like "turns north
 * along the American coast" and "pushed steadily west", and a viewer who
 * does not read maps has no other way to check that.
 *
 * Bottom left of the map band, where neither the inset nor a generated
 * picture goes.
 */
function drawFurniture(
  context: CanvasRenderingContext2D,
  band: Rect,
  camera: RasterCamera,
  scale: number,
  theme: Theme = DEFAULT_THEME
): void {
  const metresPerPixel =
    (156543.03392 * Math.cos((camera.center[0] * Math.PI) / 180)) /
    Math.pow(2, camera.zoom)
  if (!Number.isFinite(metresPerPixel) || metresPerPixel <= 0) return

  // A round number near a seventh of the width, because "1.37 km" is not a
  // scale bar.
  const wanted = band.width * 0.14 * metresPerPixel
  const power = Math.pow(10, Math.floor(Math.log10(wanted)))
  const nice = [1, 2, 5, 10].find((step) => step * power >= wanted / 1.6) ?? 10
  const metres = nice * power
  const barWidth = metres / metresPerPixel
  if (barWidth < 20 || barWidth > band.width * 0.4) return

  const text =
    metres >= 1000
      ? `${Math.round(metres / 1000).toLocaleString()} km`
      : `${Math.round(metres)} m`

  const left = band.x + Math.round(band.width * 0.022)
  const bottom = band.y + band.height - Math.round(band.height * 0.055)

  context.save()
  context.lineCap = "butt"
  context.font = `600 ${Math.round(12 * scale)}px ${fontFor(theme, "caption")}`
  context.textBaseline = "alphabetic"

  const tick = Math.round(6 * scale)
  const line = () => {
    context.beginPath()
    context.moveTo(left, bottom - tick)
    context.lineTo(left, bottom)
    context.lineTo(left + barWidth, bottom)
    context.lineTo(left + barWidth, bottom - tick)
    context.stroke()
  }

  // Cased, like every other line, so it survives a pale basemap.
  context.strokeStyle = "rgba(6, 12, 20, 0.75)"
  context.lineWidth = Math.max(3, 4 * scale)
  line()
  context.strokeStyle = "rgba(247, 250, 252, 0.95)"
  context.lineWidth = Math.max(1, 1.6 * scale)
  line()

  context.textAlign = "left"
  context.lineJoin = "round"
  context.lineWidth = Math.max(2, 3 * scale)
  context.strokeStyle = "rgba(6, 12, 20, 0.85)"
  context.strokeText(text, left, bottom - tick - 5 * scale)
  context.fillStyle = "#F7FAFC"
  context.fillText(text, left, bottom - tick - 5 * scale)

  // North arrow, just right of the bar.
  const ax = left + barWidth + Math.round(26 * scale)
  const ay = bottom
  const h = Math.round(20 * scale)

  context.beginPath()
  context.moveTo(ax, ay - h)
  context.lineTo(ax + h * 0.32, ay)
  context.lineTo(ax, ay - h * 0.26)
  context.lineTo(ax - h * 0.32, ay)
  context.closePath()

  context.strokeStyle = "rgba(6, 12, 20, 0.85)"
  context.lineWidth = Math.max(2, 2.5 * scale)
  context.stroke()
  context.fillStyle = "rgba(247, 250, 252, 0.95)"
  context.fill()

  context.textAlign = "center"
  context.lineWidth = Math.max(2, 3 * scale)
  context.strokeStyle = "rgba(6, 12, 20, 0.85)"
  context.strokeText("N", ax, ay - h - 4 * scale)
  context.fillStyle = "#F7FAFC"
  context.fillText("N", ax, ay - h - 4 * scale)

  context.restore()
}

/* -- Captions ---------------------------------------------------------- */

function wrap(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
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
    }
  }
  if (line) lines.push(line)
  return lines
}

function drawCaption(
  context: CanvasRenderingContext2D,
  text: string,
  width: number,
  height: number,
  scale: number,
  alpha: number,
  theme: Theme = DEFAULT_THEME
): void {
  if (alpha <= 0.01) return

  const fontSize = Math.round(26 * scale)
  const padding = Math.round(22 * scale)
  const lineHeight = Math.round(fontSize * 1.35)

  context.save()
  context.font = `500 ${fontSize}px ${fontFor(theme, "caption")}`
  context.textBaseline = "top"

  const lines = wrap(context, text, width * 0.78)
  const boxWidth =
    Math.max(...lines.map((line) => context.measureText(line).width)) + padding * 2
  const boxHeight = lines.length * lineHeight + padding * 2 - (lineHeight - fontSize)

  const boxX = (width - boxWidth) / 2
  const boxY = height - boxHeight - Math.round(48 * scale)

  context.globalAlpha = alpha

  // The same slab the preview puts behind a caption: white text straight onto
  // a basemap is unreadable the moment the map goes pale.
  context.fillStyle = theme.slab
  const radius = Math.round(8 * scale)
  context.beginPath()
  context.moveTo(boxX + radius, boxY)
  context.arcTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + boxHeight, radius)
  context.arcTo(boxX + boxWidth, boxY + boxHeight, boxX, boxY + boxHeight, radius)
  context.arcTo(boxX, boxY + boxHeight, boxX, boxY, radius)
  context.arcTo(boxX, boxY, boxX + boxWidth, boxY, radius)
  context.closePath()
  context.fill()

  context.fillStyle = theme.slabInk
  context.textAlign = "center"
  lines.forEach((line, i) => {
    context.fillText(line, width / 2, boxY + padding + i * lineHeight)
  })

  context.restore()
}


/**
 * Pull the camera back until the labels fit, not just the geometry.
 *
 * `contentBounds` frames the shapes a scene draws. The words hang off those
 * shapes and are drawn in pixels, so no amount of care in degrees can
 * predict them - which is why the safe area was a tuned 0.18 rather than a
 * number anyone could defend. Here there is a canvas, so the labels can
 * simply be measured.
 *
 * One corrective pass, not a loop: shrinking the frame moves the labels
 * closer together but does not change their size, so a second pass buys
 * almost nothing and costs a measureText for every label on screen.
 *
 * Only for documents with no basemap. A map frames the ground on purpose
 * and must not be zoomed out because a place name is long.
 */
function fitLabels(
  context: CanvasRenderingContext2D,
  camera: RasterCamera,
  annotations: GeoStoryAnnotation[],
  windows: FlowScene[],
  seconds: number,
  band: { width: number; height: number },
  scale: number,
  theme: Theme
): RasterCamera {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let seen = false

  const widen = (x: number, y: number) => {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
    seen = true
  }

  for (const annotation of annotations) {
    if (isCanvas(annotation)) continue // positioned in the frame already
    const window_ = annotationWindow(annotation, windows)
    if (!window_) continue
    if (seconds < window_.start || seconds > window_.end) continue

    const geometry = (annotation.geometry ?? {}) as {
      type?: string
      coordinates?: unknown
    }

    // The shape itself first. A box wider than the words written on it
    // still has to fit, and unioning only the labels let exactly that
    // scene run off both edges.
    const points: [number, number][] = []
    if (geometry.type === "Point" && Array.isArray(geometry.coordinates)) {
      points.push(geometry.coordinates as [number, number])
    } else if (Array.isArray(geometry.coordinates)) {
      const ring =
        annotation.kind === "polygon"
          ? ((geometry.coordinates as [number, number][][])[0] ?? [])
          : (geometry.coordinates as [number, number][])
      points.push(...(ring as [number, number][]))
    }
    if (!points.length) continue

    for (const [lng, lat] of points) {
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
      const at = toScreen(lng, lat, camera, band.width, band.height)
      widen(at.x, at.y)
    }

    // A circle reaches its radius beyond its centre.
    const radius = Number(annotation.radius_m) || 0
    if (annotation.kind === "circle" && radius > 0) {
      const [lng, lat] = points[0]
      const at = toScreen(lng, lat, camera, band.width, band.height)
      const perPixel =
        (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, camera.zoom)
      const r = perPixel > 0 ? radius / perPixel : 0
      widen(at.x - r, at.y - r)
      widen(at.x + r, at.y + r)
    }

    if (!annotation.label) continue

    // Then the words hung off it, which are measured rather than guessed.
    const anchor =
      geometry.type === "Point"
        ? points[0]
        : // The label pass puts a line's words two thirds along it.
          points[Math.floor(points.length * 0.66)] ?? points[0]

    const weight = emphasisOf(annotation as { emphasis?: unknown }, theme)
    const size = Math.round(15 * scale * weight)
    context.save()
    context.font = `600 ${size}px ${fontFor(theme, roleOf(annotation as { emphasis?: unknown }))}`
    const half = context.measureText(String(annotation.label)).width / 2
    context.restore()

    const at = toScreen(anchor[0], anchor[1], camera, band.width, band.height)
    widen(at.x - half, at.y - size - 16 * scale)
    widen(at.x + half, at.y + size)
  }

  if (!seen) return camera

  const used = Math.max(maxX - minX, 1)
  const tall = Math.max(maxY - minY, 1)
  // A little air left deliberately, so nothing sits flush against the edge.
  const room = 0.94
  const shrink = Math.min(1, (band.width * room) / used, (band.height * room) / tall)
  if (shrink >= 0.999) return camera

  return { center: camera.center, zoom: camera.zoom + Math.log2(shrink) }
}

/* -- A frame ----------------------------------------------------------- */

export interface FrameOptions {
  document: GeoStoryDocument
  seconds: number
  width: number
  height: number
  /** One per basemap id; build them with `tileSourcesFor`. */
  tiles: Map<string, TileSource>
  /** Burn the caption into the picture. */
  captions?: boolean
  /** Credit line along the bottom edge. Ignored when `chrome` is on. */
  attribution?: string
  /** Draw into this canvas instead of a new one. */
  canvas?: HTMLCanvasElement
  /**
   * Draw the title, legend, counter and progress around the map, with the
   * map in a band rather than filling the frame. Off gives the bare map the
   * live player shows.
   */
  chrome?: boolean
  /**
   * Where the document was loaded from, so a relative `src` resolves
   * against it.
   *
   * Without this a picture written the way the format writes them -
   * `media/something.jpg`, relative to the document - was resolved against
   * whatever page happened to be showing. Every relative asset in every
   * example pointed somewhere that does not exist.
   */
  baseUrl?: string
}

/** A tile source for every basemap the document declares. */
export function tileSourcesFor(doc: GeoStoryDocument): Map<string, TileSource> {
  const sources = new Map<string, TileSource>()
  for (const basemap of doc.basemaps ?? []) {
    if (!basemap.url) continue
    sources.set(basemap.id, new TileSource(basemap.url, basemap.max_zoom ?? 18))
  }
  return sources
}

/** The scene windows in the shape the flow drawing wants. */
export function flowScenesFor(doc: GeoStoryDocument): FlowScene[] {
  return sceneWindows(doc).map(({ scene, start, end }) => ({
    id: scene.id,
    start,
    end,
    annotationIds: scene.annotation_ids ?? [],
  }))
}

/**
 * One complete frame.
 *
 * Everything on it is derived from the document and the time, so the same
 * arguments give the same picture - which is what makes an export
 * reproducible, and what lets it run faster than realtime.
 */
export async function renderFrame({
  document: doc,
  seconds,
  width,
  height,
  tiles,
  captions = true,
  attribution,
  canvas,
  chrome = false,
  baseUrl,
}: FrameOptions): Promise<HTMLCanvasElement> {
  const surface = canvas ?? window.document.createElement("canvas")
  if (surface.width !== width) surface.width = width
  if (surface.height !== height) surface.height = height

  const context = surface.getContext("2d")
  if (!context) throw new Error("This browser would not give us a canvas")

  // Nothing should show through, but a dark frame is a better failure than an
  // undefined one.
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.globalAlpha = 1
  const theme = themeOf(doc)
  // The theme's own page, with or without chrome. It used to be a hardcoded
  // #06121c whenever chrome was off, which is four units from the midnight
  // page and so went unnoticed for as long as every document was dark - and
  // rendered a parchment document near-black the moment one was not. That
  // made the chrome setting a per-theme obligation rather than a choice:
  // paper documents had to keep chrome on to get their page, and documents
  // with real geometry had to turn it off to escape the band's aspect.
  context.fillStyle = theme.page
  context.fillRect(0, 0, width, height)

  // With chrome the map is a band with a header above and a footer below;
  // without it the map is the frame. Everything inside is drawn against the
  // band's own size, so the camera frames for the shape it will occupy
  // rather than for the whole picture.
  const band = chrome
    ? chromeLayout(width, height).map
    : { x: 0, y: 0, width, height }

  const basemap = basemapAt(doc, seconds)
  const source = basemap ? tiles.get(basemap.id) : undefined
  const camera = cameraAtTime(
    doc,
    seconds,
    band.width,
    band.height,
    source?.maxZoom ?? 18
  )

  context.save()
  context.translate(band.x, band.y)
  context.beginPath()
  context.rect(0, 0, band.width, band.height)
  context.clip()

  if (camera && source) {
    await drawBasemap(context, source, camera, band.width, band.height)
  }

  const scale = Math.max(0.5, height / 1080)

  // Spaces and `at` shorthand resolved once, so the drawing code reads one
  // field and never has to look a default up on the document.
  const annotations = withSpaces(doc)

  // With no basemap the camera was framing shapes and clipping the words
  // attached to them. Now the words are measured and the camera gives way.
  const framed =
    camera && !source
      ? fitLabels(
          context,
          camera,
          annotations,
          flowScenesFor(doc),
          seconds,
          { width: band.width, height: band.height },
          scale,
          theme
        )
      : camera
  const box = { width: band.width, height: band.height }

  // A canvas annotation is positioned against the frame, so it draws whether
  // or not there is a camera - and a document made entirely of them has no
  // camera at all, because there is no ground for one to point at.
  if (camera || hasCanvasAnnotations(annotations)) {
    const windows = flowScenesFor(doc)
    const place = framed
      ? (lng: number, lat: number) =>
          toScreen(lng, lat, framed, band.width, band.height)
      : null

    // Static first, so a moving line is never drawn underneath a plain one.
    drawAnnotations(context, annotations, windows, seconds, place, scale, framed?.zoom ?? 0, box)
    drawFlow(context, annotations, windows, seconds, place, scale, box)
    // Words last, so nothing is drawn over them.
    drawAnnotationLabels(context, annotations, windows, seconds, place, scale, framed?.zoom ?? 0, box, theme)
  }

  context.restore()

  if (chrome) {
    // Inside the map band, top right, the way the live player places it.
    if (camera && source) {
      const insetWidth = Math.round(band.width * 0.15)
      const pad = Math.round(band.height * 0.035)
      await drawInset(
        context,
        source,
        {
          x: band.x + band.width - insetWidth - pad,
          y: band.y + pad,
          width: insetWidth,
          height: Math.round(insetWidth / 2),
        },
        viewBounds(camera, band.width, band.height)
      )
    }

    // A scale bar measures the ground and the arrow points north on it.
    // With no basemap drawn there is no ground, so both are furniture
    // describing something that is not on the frame.
    if (camera && source) drawFurniture(context, band, camera, scale, theme)

    await drawMedia(context, doc, seconds, band, scale, baseUrl)

    // Over the map rather than under it. A band of its own below the map
    // would cost sixty pixels of latitude to say one sentence, and the slab
    // behind the words already makes them readable on any basemap.
    if (captions) {
      const current = sceneWindows(doc).find(
        ({ start, end }) => seconds >= start && seconds < end
      )
      const text = current?.scene.content?.caption?.trim()
      if (current && text) {
        const into = (seconds - current.start) / 0.4
        const outOf = (current.end - seconds) / 0.4
        context.save()
        context.translate(band.x, band.y)
        drawCaption(
          context,
          text,
          band.width,
          band.height,
          scale,
          Math.max(0, Math.min(1, into, outOf)),
          theme
        )
        context.restore()
      }
    }

    const info = chromeAt(doc, seconds)
    if (info) drawChrome(context, info, width, height, theme)
    return surface
  }

  if (captions) {
    const current = sceneWindows(doc).find(
      ({ start, end }) => seconds >= start && seconds < end
    )
    const text = current?.scene.content?.caption?.trim()
    if (current && text) {
      // A short fade at each end, so captions do not snap between scenes.
      const into = (seconds - current.start) / 0.4
      const outOf = (current.end - seconds) / 0.4
      drawCaption(
        context,
        text,
        width,
        height,
        scale,
        Math.max(0, Math.min(1, into, outOf)),
        theme
      )
    }
  }

  if (attribution) {
    context.save()
    context.globalAlpha = 1
    context.font = `${Math.round(13 * scale)}px system-ui, sans-serif`
    context.fillStyle = "rgba(255,255,255,0.55)"
    context.textAlign = "right"
    context.textBaseline = "bottom"
    context.shadowColor = "rgba(0,0,0,0.9)"
    context.shadowBlur = 4
    context.fillText(attribution, width - 10 * scale, height - 8 * scale)
    context.restore()
  }

  return surface
}
