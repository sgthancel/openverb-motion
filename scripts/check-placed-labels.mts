/**
 * The label pass reports where it drew.
 *
 * `drawAnnotationLabels` used to return `void`. It computed an anchor, a
 * leader with its bend, a text position and a measured width — everything
 * needed to know what sits under a cursor — and discarded all of it at the
 * edge of the canvas. An editor built on top had to recompute the same
 * geometry from outside and hope it still matched.
 *
 * So the question this asks is not "does it return an array". It is whether
 * the boxes it returns are WHERE THE TEXT REALLY IS — checked by recording
 * every call the renderer makes to the canvas and comparing the reported box
 * against the coordinates `fillText` was actually given.
 *
 * There is no canvas in Node, so one is faked: a recording 2D context with
 * real-enough text metrics. That is sound here because the thing under test
 * is arithmetic over the numbers the renderer is handed, not rasterising.
 *
 *   node --experimental-strip-types scripts/check-placed-labels.mts
 */
// The BUILT artifact, which is what gets published. Testing src would test
// something nobody installs.
import { createRequire } from "node:module"
const require_ = createRequire(import.meta.url)
const { drawAnnotationLabels } = require_("../dist/draw-annotations.js") as typeof import("../src/draw-annotations.ts")
type PlacedLabel = import("../src/draw-annotations.ts").PlacedLabel

let failures = 0
const fail = (why: string) => {
  failures++
  console.log(`  FAIL  ${why}`)
}
const ok = (what: string) => console.log(`  ok    ${what}`)

/* ── a canvas that remembers ──────────────────────────────────────────── */
interface DrawnText {
  text: string
  x: number
  y: number
  align: string
  font: string
}

function recordingContext() {
  const texts: DrawnText[] = []
  const lines: Array<Array<[number, number]>> = []
  let path: Array<[number, number]> = []
  const state = {
    font: "600 15px sans-serif",
    textAlign: "center",
    textBaseline: "middle",
    globalAlpha: 1,
    lineWidth: 1,
    strokeStyle: "",
    fillStyle: "",
    lineCap: "",
    lineJoin: "",
  }
  const stack: Array<typeof state> = []

  /** Monospace-ish metrics: wide enough to be realistic, exact enough to check. */
  const widthOf = (text: string, font: string) => {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 15)
    return text.length * size * 0.54
  }

  const context = {
    ...state,
    save() {
      stack.push({ ...(context as unknown as typeof state) })
    },
    restore() {
      const prior = stack.pop()
      if (prior) Object.assign(context, prior)
    },
    measureText(text: string) {
      return { width: widthOf(text, (context as unknown as typeof state).font) }
    },
    fillText(text: string, x: number, y: number) {
      const s = context as unknown as typeof state
      texts.push({ text, x, y, align: s.textAlign, font: s.font })
    },
    strokeText() {},
    beginPath() {
      path = []
    },
    moveTo(x: number, y: number) {
      path = [[x, y]]
    },
    lineTo(x: number, y: number) {
      path.push([x, y])
    },
    stroke() {
      if (path.length > 1) lines.push([...path])
    },
    closePath() {},
    fill() {},
    translate() {},
    rotate() {},
    arc() {},
    setLineDash() {},
    ellipse() {},
    rect() {},
    clip() {},
    createLinearGradient() {
      return { addColorStop() {} }
    },
  }
  return { context: context as unknown as CanvasRenderingContext2D, texts, lines }
}

const FRAME = { width: 1280, height: 720 }

/** A flat projector: longitude and latitude straight onto the frame. */
const project = ((lng: number, lat: number) => ({ x: lng, y: lat })) as never

function scenesFor(annotations: unknown[]) {
  return [
    {
      id: "s1",
      start: 0,
      end: 10,
      annotationIds: annotations.map((a) => String((a as { id?: unknown }).id ?? "")),
    },
  ] as never
}

function run(annotations: unknown[]): {
  placed: PlacedLabel[]
  texts: DrawnText[]
  lines: Array<Array<[number, number]>>
} {
  const { context, texts, lines } = recordingContext()
  const scenes = scenesFor(annotations)
  const placed = drawAnnotationLabels(
    context,
    annotations as never,
    scenes,
    5,
    project,
    1,
    14,
    FRAME
  )
  return { placed, texts, lines }
}

console.log("\nthe label pass, against a canvas that remembers\n")

/* ── a label with no leader ───────────────────────────────────────────── */
{
  const { placed, texts } = run([
    {
      id: "plain",
      kind: "text",
      label: "Dwelling",
      geometry: { type: "Point", coordinates: [400, 300] },
    },
  ])
  if (placed.length !== 1) {
    fail(`one annotation produced ${placed.length} placements`)
  } else if (texts.length !== 1) {
    fail(`one annotation drew ${texts.length} texts`)
  } else {
    const p = placed[0]
    const drawn = texts[0]
    if (p.id !== "plain") fail(`placement id is "${p.id}"`)
    if (p.text !== drawn.text) fail(`reported text "${p.text}" but drew "${drawn.text}"`)
    // The box must contain the point fillText was given, on the correct side
    // for the alignment it used.
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(drawn.font)?.[1] ?? 15)
    const expectedLeft =
      drawn.align === "center"
        ? drawn.x - p.box.width / 2
        : drawn.align === "right"
          ? drawn.x - p.box.width
          : drawn.x
    if (Math.abs(p.box.x - expectedLeft) > 0.01) {
      fail(`box starts at x ${p.box.x.toFixed(2)}, text was drawn at ${drawn.x} (${drawn.align})`)
    } else if (Math.abs(p.box.y + p.box.height / 2 - drawn.y) > 0.01) {
      fail(`box centre y ${(p.box.y + p.box.height / 2).toFixed(2)} but text drawn at ${drawn.y}`)
    } else if (Math.abs(p.box.height - size) > 0.01) {
      fail(`box height ${p.box.height} but font is ${size}px`)
    } else {
      ok(`a label with no leader reports a box the text sits exactly inside`)
    }
    if (p.leader) fail("a label with no leader reported one")
    else ok("no leader reported where none was drawn")
    if (Math.abs(p.anchor.x - 400) > 0.01 || Math.abs(p.anchor.y - 300) > 0.01) {
      fail(`anchor reported at ${p.anchor.x}, ${p.anchor.y}, expected 400, 300`)
    } else {
      ok("the anchor is the point being named")
    }
  }
}

/* ── a label on a leader ──────────────────────────────────────────────── */
{
  const { placed, texts, lines } = run([
    {
      id: "led",
      kind: "marker",
      label: "RC1",
      geometry: { type: "Point", coordinates: [400, 300] },
      leader: { direction: "north_east", length: 0.12, elbow: true, arrow: true },
    },
  ])
  const p = placed[0]
  if (!p?.leader) {
    fail("a leader was drawn but none was reported")
  } else {
    const drawn = texts[0]
    const expectedLeft =
      drawn.align === "center"
        ? drawn.x - p.box.width / 2
        : drawn.align === "right"
          ? drawn.x - p.box.width
          : drawn.x
    if (Math.abs(p.box.x - expectedLeft) > 0.01) {
      fail(`leader label box at ${p.box.x.toFixed(2)}, text drawn at ${drawn.x} (${drawn.align})`)
    } else {
      ok("a leader's label reports a box matching where the text was drawn")
    }
    // The reported line must be the polyline the renderer stroked.
    const stroked = lines.find((l) => l.length >= 2)
    if (!stroked) {
      fail("no leader line was stroked")
    } else {
      const [sx, sy] = stroked[0]
      const [ex, ey] = stroked[stroked.length - 1]
      if (Math.abs(p.leader.from.x - sx) > 0.01 || Math.abs(p.leader.from.y - sy) > 0.01) {
        fail(`reported leader start ${p.leader.from.x},${p.leader.from.y} but stroked ${sx},${sy}`)
      } else if (Math.abs(p.leader.end.x - ex) > 0.01 || Math.abs(p.leader.end.y - ey) > 0.01) {
        fail(`reported leader end ${p.leader.end.x},${p.leader.end.y} but stroked ${ex},${ey}`)
      } else {
        ok("the reported leader is the line that was stroked, end to end")
      }
      if (stroked.length !== 3) fail(`an elbow leader stroked ${stroked.length} points, expected 3`)
      else ok("an elbow leader is three points, and the knee is reported")
    }
    if (p.leader.length !== 0.12) fail(`reported length ${p.leader.length}, expected 0.12`)
    if (!p.leader.elbow) fail("elbow was requested and reported false")
  }
}

/* ── the frame edge flip is reported, not hidden ──────────────────────────
 * The renderer turns a leader round when its label would run off the frame.
 * An editor that does not know this happened would write the author's
 * direction back into the document and silently lose the correction.
 */
{
  const { placed } = run([
    {
      id: "edge",
      kind: "marker",
      label: "a label long enough to run off the right hand edge",
      geometry: { type: "Point", coordinates: [FRAME.width - 20, 300] },
      leader: { direction: "east", length: 0.2, elbow: false, arrow: true },
    },
  ])
  const p = placed[0]
  if (!p?.leader) {
    fail("no leader reported near the frame edge")
  } else if (!p.leader.flipped) {
    fail("a leader pointing off the right edge was not reported as flipped")
  } else if (p.leader.dx >= 0) {
    fail(`flipped was reported but dx is still ${p.leader.dx}`)
  } else {
    ok("a leader turned away from the frame edge reports flipped, with the dx used")
  }
}

/* ── a fading label is reported with its alpha ────────────────────────── */
{
  const { placed } = run([
    {
      id: "fade",
      kind: "text",
      label: "Shed",
      geometry: { type: "Point", coordinates: [400, 300] },
    },
  ])
  if (typeof placed[0]?.alpha !== "number") {
    fail("no alpha reported")
  } else if (placed[0].alpha <= 0 || placed[0].alpha > 1) {
    fail(`alpha reported as ${placed[0].alpha}`)
  } else {
    ok(`alpha reported (${placed[0].alpha}), so a half-faded label need not be grabbable`)
  }
}

/* ── nothing off-window is reported ───────────────────────────────────── */
{
  const { context } = recordingContext()
  const later = [
    {
      id: "later",
      kind: "text",
      label: "Not yet",
      at: 20,
      until: 30,
      geometry: { type: "Point", coordinates: [400, 300] },
    },
  ]
  const placed = drawAnnotationLabels(
    context,
    later as never,
    scenesFor(later),
    5,
    project,
    1,
    14,
    FRAME
  )
  if (placed.length) fail(`${placed.length} placement(s) reported for a label not on screen`)
  else ok("a label outside its window is not reported")
}

/* ── several labels come back in order, each identified ───────────────── */
{
  const { placed, texts } = run(
    ["RC1", "RC2", "RC3", "RC4"].map((id, i) => ({
      id,
      kind: "marker",
      label: id,
      geometry: { type: "Point", coordinates: [200 + i * 120, 300] },
      leader: { direction: "north", length: 0.08 },
    }))
  )
  if (placed.length !== 4) {
    fail(`four labels produced ${placed.length} placements`)
  } else if (placed.map((p) => p.id).join() !== "RC1,RC2,RC3,RC4") {
    fail(`ids came back as ${placed.map((p) => p.id).join()}`)
  } else if (texts.length !== 4) {
    fail(`four labels drew ${texts.length} texts`)
  } else {
    // No two boxes may be the same, or hit-testing picks the wrong one.
    const keys = new Set(placed.map((p) => `${p.box.x.toFixed(2)},${p.box.y.toFixed(2)}`))
    if (keys.size !== 4) fail("two labels report the same box")
    else ok("four labels, four identified placements, four distinct boxes")
  }
}

console.log(
  `\n${failures === 0 ? "The renderer says where it put the words." : `${failures} problem(s).`}\n`
)
process.exit(failures === 0 ? 0 : 1)
