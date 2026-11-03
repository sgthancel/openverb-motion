/**
 * The faults a .ov document can have while still parsing perfectly.
 *
 * The format preserves fields it does not recognise, which is what let canvas
 * space, `emphasis` and the chart primitive ship without a format change. The
 * same property means a typo is kept rather than refused: `emphasis: titel`
 * validates, renders at body size, and says nothing. Every rule here exists
 * because the fault it catches was shipped at least once in this repository
 * and found by instrumenting the canvas rather than by reading.
 *
 * ERRORS are things the renderer will draw wrongly or not at all. WARNINGS
 * are things that are probably a mistake and might be deliberate - an
 * annotation deliberately parked off-frame is legal, and rivers-of-the-ocean
 * has one.
 *
 * What this cannot do is measure text. Whether two labels overlap, or a line
 * runs off the side, depends on font metrics that only exist in a browser,
 * and guessing at them would produce exactly the confident-but-wrong report
 * this is meant to replace. Those checks belong in the probe, against a real
 * canvas. Everything here is exact.
 */
import { sceneWindows } from "./timeline"
import { FONT_ROLES, PRESETS, firstFamily } from "./theme"
import type { GeoStoryDocument } from "@openverb/geostory"

export type Severity = "error" | "warn"

export interface Finding {
  rule: string
  severity: Severity
  /** The annotation or scene id the finding is about. */
  where: string
  message: string
}

/** Annotation kinds the renderer draws. Anything else is silently skipped. */
const KINDS = ["text", "line", "polygon", "marker", "circle", "chart", "image"]

/** Entrances `entranceAt` understands. Anything else falls back to a fade. */
const ENTER_TYPES = ["fade", "rise", "fall", "left", "right", "typewriter"]

/** Emphasis names the default theme scale carries. */
const EMPHASIS = ["display", "title", "body", "caption"]

/**
 * Faces a browser already has, so a stack naming one needs nothing fetched.
 *
 * Not a complete list of every font on every machine - that does not exist -
 * but a list of the ones it is safe to ASSUME. Anything outside it has to be
 * loaded, and a document that does not say so renders in a substitute while
 * looking like it worked, which is the one typographic failure that leaves no
 * trace in the output.
 */
const SYSTEM_FAMILIES = new Set(
  [
    "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded",
    "sans-serif", "serif", "monospace", "cursive", "fantasy",
    "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto",
    "Helvetica", "Helvetica Neue", "Arial", "Arial Black", "Verdana",
    "Tahoma", "Trebuchet MS", "Impact", "Optima", "Futura", "Gill Sans",
    "Lucida Grande", "Lucida Sans Unicode", "Candara", "Calibri",
    "Georgia", "Iowan Old Style", "Times", "Times New Roman", "Palatino",
    "Palatino Linotype", "Book Antiqua", "Garamond", "Baskerville",
    "Didot", "Hoefler Text", "Cambria", "Constantia", "Charter",
    "Courier", "Courier New", "Menlo", "Monaco", "Consolas",
    "Cascadia Mono", "Cascadia Code", "SF Mono", "Andale Mono",
    "DejaVu Sans Mono", "Liberation Mono", "Lucida Console",
  ].map((f) => f.toLowerCase())
)

type Anno = Record<string, any>

const geometryType = (a: Anno): string => String(a?.geometry?.type ?? "")

/** Every [x, y] pair in a geometry, however deeply the rings are nested. */
function pointsOf(coordinates: unknown, out: [number, number][] = []): [number, number][] {
  if (!Array.isArray(coordinates)) return out
  if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
    out.push([coordinates[0] as number, coordinates[1] as number])
    return out
  }
  for (const part of coordinates) pointsOf(part, out)
  return out
}

export function lintGeoStory(doc: GeoStoryDocument): Finding[] {
  const found: Finding[] = []
  const add = (rule: string, severity: Severity, where: string, message: string) =>
    found.push({ rule, severity, where, message })

  const annotations = ((doc as Anno).annotations ?? []) as Anno[]
  const windows = sceneWindows(doc)
  const defaultSpace = String((doc as Anno).settings?.default_space ?? "geo")

  // ── identity ──────────────────────────────────────────────────────────────
  const seen = new Set<string>()
  for (const a of annotations) {
    const id = String(a?.id ?? "")
    if (!id) {
      add("missing-id", "error", "(unnamed)", "An annotation has no id, so no scene can reference it.")
      continue
    }
    if (seen.has(id)) {
      add("duplicate-id", "error", id, "Two annotations share this id. The later one wins and the earlier is unreachable.")
    }
    seen.add(id)
  }

  // ── references and lifetimes ──────────────────────────────────────────────
  const referencedIn = new Map<string, number[]>()
  windows.forEach((w, index) => {
    const ids = ((w.scene as Anno).annotation_ids ?? []) as unknown[]
    const sceneId = String((w.scene as Anno).id ?? `scene ${index + 1}`)

    if (!ids.length) {
      add("empty-scene", "warn", sceneId, "This scene references no annotations, so nothing is drawn in it.")
    }

    for (const raw of ids) {
      const id = String(raw)
      if (!seen.has(id)) {
        add("undefined-reference", "error", sceneId, `References "${id}", which no annotation defines.`)
        continue
      }
      const at = referencedIn.get(id) ?? []
      at.push(index)
      referencedIn.set(id, at)
    }
  })

  for (const a of annotations) {
    const id = String(a?.id ?? "")
    if (!id) continue
    const at = referencedIn.get(id)

    // An annotation can carry its own window, in which case the scene lists
    // are not what decides when it is on screen.
    const ownTiming = a.at !== undefined || a.until !== undefined

    if (!at?.length && !ownTiming) {
      add("unused-annotation", "warn", id, "Defined but referenced by no scene, so it is never drawn.")
      continue
    }
    if (!at?.length) continue

    // An annotation carrying at/until takes its window from those and not
    // from the scene lists, so a gap between the scenes that mention it says
    // nothing about when it is on screen.
    if (ownTiming) continue

    // THE BIG ONE. annotationWindow takes min(start) to max(end), so an
    // annotation listed in scenes 1 and 3 is on screen through scene 2 as
    // well. Three of these shipped in lines-of-longitude.ov and printed
    // "Greenwich" over four scenes that never asked for it.
    const first = at[0]
    const last = at[at.length - 1]
    const gaps: string[] = []
    for (let i = first; i <= last; i++) {
      if (!at.includes(i)) {
        gaps.push(String((windows[i].scene as Anno).id ?? `scene ${i + 1}`))
      }
    }
    if (gaps.length) {
      // A warning and not an error, because the renderer is doing what the
      // format says and the author may want it: a star that stays up through
      // a scene about something else is fine. The question this asks is only
      // whether they knew. In lines-of-longitude.ov the answer was no, and
      // "Greenwich" was printed over four scenes that never asked for it.
      add("annotation-leak", "warn", id,
        `Listed in ${at.length} scenes but also on screen through ${gaps.length} it does not declare: ` +
        `${gaps.join(", ")}. An annotation lives from its first scene to its last continuously. ` +
        `If that is wanted, say so; if not, the gap needs a second id.`)
    }
  }

  // ── per-annotation faults ─────────────────────────────────────────────────
  for (const a of annotations) {
    const id = String(a?.id ?? "")
    if (!id) continue

    const kind = String(a.kind ?? "")
    if (kind && !KINDS.includes(kind)) {
      add("unknown-kind", "warn", id, `kind "${kind}" is not one the renderer draws, so this is skipped silently.`)
    }

    // `at` is WHEN, in seconds. A position written there blanks the element.
    if (Array.isArray(a.at)) {
      add("position-in-at", "error", id,
        "`at` is the time an annotation appears, in seconds. A coordinate pair here is read as a time and the element is blanked. Use `pos` or a geometry.")
    }

    const animate = a.animate
    if (animate) {
      // drawAnnotations skips anything carrying `animate`, assuming drawFlow
      // will take it; drawFlow needs LineString. So this is drawn by neither.
      if (geometryType(a) !== "LineString") {
        add("invisible-animation", "error", id,
          `\`animate\` needs LineString geometry and this is ${geometryType(a) || "untyped"}. ` +
          "The static renderer skips it and the flow renderer rejects it, so nothing is drawn at all. " +
          "A shape that should draw itself has to be a LineString with its first point repeated.")
      } else if (a.enter) {
        // drawFlow never calls entranceAt.
        add("ignored-enter", "warn", id,
          "An animated line ignores `enter` entirely, so this delay does nothing. Stagger with `reveal` instead.")
      }
    }

    const enterType = a.enter?.type
    if (enterType !== undefined && !ENTER_TYPES.includes(String(enterType))) {
      add("unknown-enter-type", "warn", id,
        `enter.type "${enterType}" is not understood, so it falls back to a fade.`)
    }

    if (a.emphasis !== undefined && !EMPHASIS.includes(String(a.emphasis))) {
      add("unknown-emphasis", "warn", id,
        `emphasis "${a.emphasis}" is not in the theme scale, so it renders at body size.`)
    }

    // Does the entrance finish before the annotation leaves?
    const at = referencedIn.get(id)
    const own = a.at !== undefined || a.until !== undefined
    if (at?.length || own) {
      // The same window the renderer will use: its own if it declares one,
      // otherwise first referencing scene to last.
      const span = own
        ? Number(a.until ?? Infinity) - Number(a.at ?? 0)
        : windows[at![at!.length - 1]].end - windows[at![0]].start
      const enterEnds = (Number(a.enter?.delay) || 0) + (Number(a.enter?.duration) || 0)
      if (enterEnds > span + 1e-9) {
        add("unfinished-entrance", "warn", id,
          `Its entrance ends at ${enterEnds.toFixed(1)}s but it is only on screen for ${span.toFixed(1)}s, so it never fully arrives.`)
      }
      const reveal = Number(a.animate?.reveal) || 0
      if (reveal > span + 1e-9) {
        add("unfinished-reveal", "warn", id,
          `reveal is ${reveal.toFixed(1)}s but it is only on screen for ${span.toFixed(1)}s, so the line never finishes drawing.`)
      }
    }

    // Canvas coordinates are percentages of the frame.
    const space = String(a.space ?? defaultSpace)
    if (space === "canvas") {
      const outside = pointsOf(a.geometry?.coordinates).filter(
        ([x, y]) => x < -1 || x > 101 || y < -1 || y > 101
      )
      if (outside.length) {
        const [x, y] = outside[0]
        add("canvas-out-of-frame", "warn", id,
          `${outside.length} point(s) outside the frame, first at [${x}, ${y}]. Canvas coordinates are percentages, 0 to 100.`)
      }
    }
  }

  // ── a chart cannot be made legible by the theme ────────────────────────────
  // drawChart sizes its own value and category labels against the raster
  // scale and ignores theme.scale, which is right beside a map and far too
  // small on a frame where the words are the content.
  const scale = ((doc as Anno).theme?.scale ?? {}) as Record<string, number>
  const raised = Math.max(Number(scale.body) || 1, Number(scale.caption) || 1)
  if (raised > 1.2) {
    for (const a of annotations) {
      if (String(a?.kind) === "chart") {
        add("chart-scale", "warn", String(a.id),
          `This document raises its text scale to ${raised}, but a chart labels itself at a fixed 12-13px and ignores theme.scale. Its numbers will read far smaller than everything around them.`)
      }
    }
  }

  // ── the theme ─────────────────────────────────────────────────────────────
  // A theme block validates whatever it says, so every mistake in one is
  // silent: an unknown preset renders as midnight, an unknown role is
  // ignored, and a face that is not loaded is quietly replaced with
  // something else. None of that is visible in the document.
  const theme = (doc as Anno).theme
  if (theme && typeof theme === "object" && !Array.isArray(theme)) {
    const preset = theme.preset
    if (preset !== undefined && !(String(preset) in PRESETS)) {
      add("unknown-theme-preset", "warn", "theme",
        `Preset "${preset}" does not exist, so the document renders in the default. The presets are ${Object.keys(PRESETS).join(", ")}.`)
    }

    const declared: string[] = Array.isArray(theme.webfonts)
      ? theme.webfonts
          .filter((f: unknown) => typeof f === "string")
          .map((f: string) => f.trim().toLowerCase())
      : []

    /** A stack whose first family has to be fetched but was never declared. */
    const checkStack = (where: string, stack: unknown) => {
      if (typeof stack !== "string" || !stack.trim()) return
      const family = firstFamily(stack)
      if (!family) return
      if (SYSTEM_FAMILIES.has(family.toLowerCase())) return
      if (declared.includes(family.toLowerCase())) return
      add("webfont-not-declared", "warn", where,
        `"${family}" is not a face every machine has, and theme.webfonts does not ask for it. A canvas cannot wait for a font it was not told about, so the frame renders in a substitute and nothing reports it.`)
    }

    checkStack("theme.font", theme.font)

    if (theme.fonts && typeof theme.fonts === "object" && !Array.isArray(theme.fonts)) {
      for (const [role, stack] of Object.entries(theme.fonts as Record<string, unknown>)) {
        if (!(FONT_ROLES as readonly string[]).includes(role)) {
          add("unknown-font-role", "warn", `theme.fonts.${role}`,
            `"${role}" is not a font role, so this typeface is never used. The roles are ${FONT_ROLES.join(", ")} - the same words as emphasis and theme.scale.`)
          continue
        }
        checkStack(`theme.fonts.${role}`, stack)
      }
    }

    if (Array.isArray(theme.webfonts)) {
      // A declared face that nothing names costs a network request and a
      // render delay for a typeface that never appears.
      const used = new Set<string>()
      const collect = (stack: unknown) => {
        if (typeof stack !== "string") return
        for (const part of stack.split(",")) {
          const name = part.trim().replace(/^['"]|['"]$/g, "")
          if (name) used.add(name.toLowerCase())
        }
      }
      collect(theme.font)
      if (theme.fonts && typeof theme.fonts === "object") {
        for (const stack of Object.values(theme.fonts as Record<string, unknown>)) collect(stack)
      }
      for (const family of theme.webfonts) {
        if (typeof family !== "string" || !family.trim()) continue
        if (!used.has(family.trim().toLowerCase())) {
          add("webfont-unused", "warn", "theme.webfonts",
            `"${family}" is loaded but no font role names it, so it is fetched and never drawn.`)
        }
      }
    }
  }

  return found
}

/** Errors first, then warnings, each group in document order. */
export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1
  )
}
