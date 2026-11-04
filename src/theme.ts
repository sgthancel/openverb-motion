/**
 * What a document looks like, rather than what it says.
 *
 * Every colour and the one font stack used to be constants inside
 * `chrome.ts`, which is defensible for a renderer that draws maps - the
 * basemap carries the identity and the chrome stays out of its way. It is
 * not defensible for a frame with no map, where the type IS the design.
 * Every presentation rendered here looked identical because there was no
 * way for one to look like anything else.
 *
 * A document declares `theme:` at the root. It may name a preset, override
 * individual values, or both. Anything it does not mention keeps the
 * default, so a document with no theme block renders exactly as it did
 * before this existed.
 *
 * `theme` is a new field name and was checked against the format before
 * being chosen, which is a habit this work acquired the hard way.
 *
 * ON SEVEN PRESETS RATHER THAN THREE. The first set was midnight, paper and
 * editorial, which covered dark, light and dark-with-serifs. That is a range
 * of surfaces, not a range of subjects. A film about a coastline and a film
 * about coercive control were both rendered in cyan-on-navy, and the second
 * one looked like a product launch. The presets below are chosen by subject,
 * because that is how an author actually picks one: `forest` for ecology,
 * `rose` for psychology, `arctic` for clinical work, `mono` for a technical
 * explainer that should carry no mood at all.
 *
 * ON FONT ROLES. `font` was a single stack, so a theme could be a serif
 * theme or a sans theme and nothing else. The pairing that makes editorial
 * design work - a serif that argues over a sans that explains - was not
 * expressible. `fonts` names a stack per role, and the role names are the
 * same words `scale` and `emphasis` already use, so an author who writes
 * `emphasis: display` on an annotation already knows which font it takes.
 *
 * Roles are `display`, `title`, `body` and `caption`. Any role a theme
 * leaves out falls back to `font`, which is why a document written before
 * this existed renders identically: its `fonts` is empty and every role
 * resolves to the one stack it always used.
 *
 * ON FONTS THE BROWSER DOES NOT HAVE. A canvas cannot ask for a typeface
 * that is not loaded; it silently substitutes and the frame comes out in
 * something else, which is the one failure here that looks like success.
 * Preset stacks are therefore all system faces, available everywhere
 * without a network. A document that wants Caveat or Playfair Display must
 * say so in `webfonts`, and the host must load them before it renders -
 * `webfontsOf` is what a host reads to know what to fetch. Naming a
 * non-system face without declaring it is caught by the linter rather than
 * discovered in a finished render.
 */
import type { GeoStoryDocument } from "@openverb/geostory"

/** The roles a theme can set a typeface for. The same words `scale` uses. */
export const FONT_ROLES = ["display", "title", "body", "caption"] as const

export type FontRole = (typeof FONT_ROLES)[number]

export interface Theme {
  /** Behind everything, including the bands above and below the map. */
  page: string
  /** The small line above a scene title. */
  kicker: string
  title: string
  dek: string
  caption: string
  legend: string
  note: string
  /** The big faint scene number. */
  counter: string
  /** The progress rail, and the part of it already played. */
  track: string
  fill: string
  /** Annotation labels, and the outline that keeps them readable. */
  label: string
  halo: string
  /**
   * The caption slab, and the words on it.
   *
   * Separate from `page` and `caption` because the slab is not the page: it
   * sits over a basemap as often as not, and has to stay readable against
   * terrain it did not choose.
   *
   * EVERY PRESET LEAVES THIS DARK, including the two light ones, which is
   * the opposite of what the halo does and was arrived at by looking. A
   * cream slab on a cream page has no edge: the caption stops reading as a
   * panel and runs into whatever is drawn behind it, which on `paper` was a
   * line of annotation text it then appeared to be part of. Reversed out, it
   * is obviously a caption. It is a token so that a document which knows its
   * own background can say otherwise.
   */
  slab: string
  slabInk: string
  /** The stack every role falls back to. */
  font: string
  /** A stack per role. Empty means every role uses `font`. */
  fonts: Partial<Record<FontRole, string>>
  /**
   * Families the host must load before rendering, by family name as a
   * provider knows it - "Caveat", not a CSS stack.
   */
  webfonts: string[]
  /** Label size multipliers, by emphasis. */
  scale: Record<string, number>
}

/** Faces that are on the machine already, so a stack naming one needs no fetch. */
const SYSTEM_SANS = `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
const SYSTEM_SERIF = `Georgia, "Iowan Old Style", "Times New Roman", serif`
const SYSTEM_MONO = `ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace`

export const DEFAULT_THEME: Theme = {
  page: "#0A1118",
  kicker: "#5EC8E5",
  title: "#F7FAFC",
  dek: "#9FB3C8",
  caption: "#F7FAFC",
  legend: "#8CA3B8",
  note: "#5B7183",
  counter: "rgba(255,255,255,0.16)",
  track: "rgba(255,255,255,0.10)",
  fill: "rgba(255,255,255,0.55)",
  label: "#F7FAFC",
  halo: "rgba(6, 12, 20, 0.85)",
  slab: "rgba(10, 14, 20, 0.82)",
  slabInk: "#f3f4f6",
  font: SYSTEM_SANS,
  fonts: {},
  webfonts: [],
  scale: { display: 2.4, title: 1.6, body: 1, caption: 0.78 },
}

/**
 * Seven identities, not seventy.
 *
 * Each is a complete set of decisions rather than a palette: a light theme
 * needs its label halo inverted or every label on it disappears, which is
 * the kind of thing a colour picker does not tell you.
 */
export const PRESETS: Record<string, Partial<Theme>> = {
  midnight: {},

  paper: {
    page: "#F4F1EA",
    kicker: "#9A5B2C",
    title: "#1A1814",
    dek: "#5C564C",
    caption: "#1A1814",
    legend: "#5C564C",
    note: "#8A8275",
    counter: "rgba(26,24,20,0.10)",
    track: "rgba(26,24,20,0.10)",
    fill: "rgba(26,24,20,0.55)",
    label: "#1A1814",
    // Inverted: a dark halo on a light page makes every label look bruised.
    halo: "rgba(244, 241, 234, 0.9)",
    font: SYSTEM_SERIF,
    scale: { display: 2.6, title: 1.65, body: 1, caption: 0.76 },
  },

  editorial: {
    page: "#14110E",
    kicker: "#D4A65E",
    title: "#F6F1E7",
    dek: "#A99C89",
    caption: "#F6F1E7",
    legend: "#A99C89",
    note: "#6B6050",
    counter: "rgba(246,241,231,0.14)",
    track: "rgba(246,241,231,0.10)",
    fill: "rgba(212,166,94,0.65)",
    label: "#F6F1E7",
    halo: "rgba(20, 17, 14, 0.88)",
    font: SYSTEM_SERIF,
    scale: { display: 2.8, title: 1.7, body: 1, caption: 0.74 },
  },

  /**
   * Relationships, psychology, anything with a person in it.
   *
   * The pairing is the point: a serif says the large things and a sans
   * carries the explanation under them, so a sentence about someone's life
   * does not read in the same voice as a chart axis.
   */
  rose: {
    page: "#17101A",
    kicker: "#E2899B",
    title: "#F7EDF0",
    dek: "#BFA3AD",
    caption: "#F7EDF0",
    legend: "#B294A0",
    note: "#7E6670",
    counter: "rgba(247,237,240,0.13)",
    track: "rgba(247,237,240,0.10)",
    fill: "rgba(226,137,155,0.62)",
    label: "#F7EDF0",
    halo: "rgba(23, 16, 26, 0.88)",
    font: SYSTEM_SANS,
    fonts: { display: SYSTEM_SERIF, title: SYSTEM_SERIF },
    scale: { display: 2.7, title: 1.65, body: 1, caption: 0.76 },
  },

  /** Nature, ecology, wellness. Green that stays green on a satellite basemap. */
  forest: {
    page: "#0C1410",
    kicker: "#7FC89B",
    title: "#F2F7F3",
    dek: "#A3B8A9",
    caption: "#F2F7F3",
    legend: "#94AC9B",
    note: "#5C7064",
    counter: "rgba(242,247,243,0.14)",
    track: "rgba(242,247,243,0.10)",
    fill: "rgba(127,200,155,0.60)",
    label: "#F2F7F3",
    halo: "rgba(12, 20, 16, 0.88)",
    font: SYSTEM_SANS,
    fonts: { display: SYSTEM_SERIF },
    scale: { display: 2.5, title: 1.6, body: 1, caption: 0.78 },
  },

  /**
   * Medicine, research, anything that should look measured.
   *
   * Light, like paper, but cool and sans - a clinical page rather than a
   * printed one. Its halo is inverted for the same reason paper's is.
   */
  arctic: {
    page: "#F2F6F9",
    kicker: "#0E6E8C",
    title: "#0C1B24",
    dek: "#4A6472",
    caption: "#0C1B24",
    legend: "#4A6472",
    note: "#7C929E",
    counter: "rgba(12,27,36,0.10)",
    track: "rgba(12,27,36,0.10)",
    fill: "rgba(14,110,140,0.55)",
    label: "#0C1B24",
    halo: "rgba(242, 246, 249, 0.92)",
    font: SYSTEM_SANS,
    scale: { display: 2.4, title: 1.55, body: 1, caption: 0.78 },
  },

  /**
   * Minimal technical explainers.
   *
   * Monochrome is about colour, not typeface: the caption stays in the sans
   * because a paragraph of narration set in a monospace is a chore to read.
   * A document that wants the terminal look can say so itself, which is
   * what `fonts.caption` is for.
   */
  mono: {
    page: "#101113",
    kicker: "#9AA0A6",
    title: "#FFFFFF",
    dek: "#9AA0A6",
    caption: "#FFFFFF",
    legend: "#8A9096",
    note: "#5F646A",
    counter: "rgba(255,255,255,0.12)",
    track: "rgba(255,255,255,0.10)",
    fill: "rgba(255,255,255,0.65)",
    label: "#FFFFFF",
    halo: "rgba(16, 17, 19, 0.9)",
    font: SYSTEM_SANS,
    scale: { display: 2.3, title: 1.5, body: 1, caption: 0.8 },
  },
}

/** In the order a picker should offer them: dark first, then the two light ones. */
export const PRESET_NAMES = Object.keys(PRESETS)

/** One line each, for a host building a theme picker. */
export const PRESET_NOTES: Record<string, string> = {
  midnight: "Cyan on navy. AI, science, technology.",
  paper: "Printed page. History, cartography, archives.",
  editorial: "Gold on near-black. Long-form reporting.",
  rose: "Serif over sans, warm plum. Relationships, psychology.",
  forest: "Moss on deep green. Nature, ecology, wellness.",
  arctic: "Cool and light. Medicine, research, measurement.",
  mono: "No colour at all. Minimal technical explainers.",
}

/** A stack that needs nothing fetched, so a theme using it is safe offline. */
export const SYSTEM_STACKS = {
  sans: SYSTEM_SANS,
  serif: SYSTEM_SERIF,
  mono: SYSTEM_MONO,
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * The theme for a document: defaults, then a named preset, then whatever
 * the document said itself.
 */
export function themeOf(doc: GeoStoryDocument | null | undefined): Theme {
  const declared = (doc as { theme?: unknown } | null | undefined)?.theme
  if (!isRecord(declared)) return DEFAULT_THEME

  const named = typeof declared.preset === "string" ? declared.preset : ""
  const preset = PRESETS[named] ?? {}

  const merged: Theme = {
    ...DEFAULT_THEME,
    ...preset,
    // Spread copies the reference, and a caller that edited one of these
    // would be editing the preset itself for every later document.
    fonts: { ...DEFAULT_THEME.fonts, ...preset.fonts },
    webfonts: [...(preset.webfonts ?? DEFAULT_THEME.webfonts)],
  }

  for (const key of Object.keys(DEFAULT_THEME) as (keyof Theme)[]) {
    if (key === "scale" || key === "fonts" || key === "webfonts") continue
    const value = declared[key]
    if (typeof value === "string" && value) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(merged as any)[key] = value
    }
  }

  if (isRecord(declared.scale)) {
    const scale = { ...merged.scale }
    for (const [name, value] of Object.entries(declared.scale)) {
      const size = Number(value)
      if (Number.isFinite(size) && size > 0) scale[name] = size
    }
    merged.scale = scale
  }

  if (isRecord(declared.fonts)) {
    const fonts = { ...merged.fonts }
    for (const [role, value] of Object.entries(declared.fonts)) {
      if (typeof value === "string" && value.trim()) {
        fonts[role as FontRole] = value.trim()
      }
    }
    merged.fonts = fonts
  }

  if (Array.isArray(declared.webfonts)) {
    const families = declared.webfonts
      .filter((f): f is string => typeof f === "string" && f.trim().length > 0)
      .map((f) => f.trim())
    // Added to the preset's rather than replacing them, so a document can
    // ask for one extra face without having to restate the theme's own.
    for (const family of families) {
      if (!merged.webfonts.includes(family)) merged.webfonts.push(family)
    }
  }

  return merged
}

/**
 * The stack to draw a role in.
 *
 * Unknown roles resolve to the base font rather than throwing, because a
 * typo in a theme block should cost you a typeface, not a frame.
 */
export function fontFor(theme: Theme, role?: string): string {
  if (!role) return theme.font
  const named = theme.fonts?.[role as FontRole]
  return named && named.trim() ? named : theme.font
}

/**
 * Families a host must load before this document will render as written.
 *
 * Returned in declaration order and de-duplicated, so it can be handed
 * straight to a font loader.
 */
export function webfontsOf(doc: GeoStoryDocument | null | undefined): string[] {
  return themeOf(doc).webfonts
}

/**
 * The first family in a CSS stack, unquoted.
 *
 * Used to tell "Caveat" from the generic fallbacks after it, which is the
 * only part a font loader can actually fetch.
 */
export function firstFamily(stack: string): string {
  const first = stack.split(",")[0]?.trim() ?? ""
  return first.replace(/^['"]|['"]$/g, "")
}

/**
 * Faces this document asks for that the browser cannot draw yet.
 *
 * NOT `document.fonts.check`, which is the obvious call and answers a
 * different question. Given a family with no `@font-face` rule the browser
 * resolves it to a system fallback, decides that fallback is loaded, and
 * returns true - so it returns true for "Caveat" before Caveat exists, and
 * true for a family name that is pure nonsense. Measured here, it said yes
 * to "Zzqq Not A Font". A check that cannot say no is not a check.
 *
 * What does work is measuring. If asking for the family and falling back to
 * monospace draws the same width as monospace alone, the family was not used.
 * Three fallbacks rather than one, because a face could coincidentally match
 * the metrics of a single fallback; matching all three is not something a
 * real typeface does.
 *
 * Empty outside a browser, and empty for a theme that only uses system
 * faces, so it is safe to call unconditionally.
 */
export function missingFonts(theme: Theme): string[] {
  if (typeof document === "undefined" || !theme.webfonts.length) return []

  const probe = document.createElement("canvas").getContext("2d")
  // No canvas, no answer. Reporting everything as missing would be a
  // confident lie, which is the thing this file exists to avoid.
  if (!probe) return []

  const SAMPLE = "MWimnsxz0123456789—llll"
  const FALLBACKS = ["monospace", "serif", "sans-serif"]
  const widthIn = (stack: string) => {
    probe.font = `16px ${stack}`
    return probe.measureText(SAMPLE).width
  }

  return theme.webfonts.filter((family) => {
    const quoted = `"${family.replace(/["\\]/g, "")}"`
    return !FALLBACKS.some((fallback) => {
      try {
        return widthIn(`${quoted}, ${fallback}`) !== widthIn(fallback)
      } catch {
        return false
      }
    })
  })
}

/**
 * Label ink that follows the basemap under it.
 *
 * A theme is document-level and a basemap is per scene, and the two disagree
 * the moment a story flies from a dark canvas down to a street map: pale
 * label ink with a dark halo is exactly right over the first and invisible
 * over the second. Nothing about the document is wrong when that happens, so
 * it is resolved here rather than asked of the author.
 *
 * A basemap says which it is with `light: true`. Only the ink and the halo
 * swap — colours an author chose for shapes are theirs, and a theme that
 * flipped its whole palette under them would be a different kind of surprise.
 *
 * This has to be shared rather than done by a host, because a preview that
 * applies it and an exporter that does not produce different films from one
 * document — which is exactly what happened: the exported video rendered
 * light labels onto the light street map and lost them.
 */
export function themeForBasemap(theme: Theme, basemap: unknown): Theme {
  const light = Boolean((basemap as { light?: unknown } | null)?.light)
  if (!light) return theme
  return { ...theme, label: "#0C1116", halo: "rgba(255, 255, 255, 0.94)" }
}
