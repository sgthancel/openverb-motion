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
 */
import type { GeoStoryDocument } from "@openverb/geostory"

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
  font: string
  /** Label size multipliers, by emphasis. */
  scale: Record<string, number>
}

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
  font: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`,
  scale: { display: 2.4, title: 1.6, body: 1, caption: 0.78 },
}

/**
 * Three identities, not thirty.
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
    font: `Georgia, "Iowan Old Style", "Times New Roman", serif`,
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
    font: `Georgia, "Iowan Old Style", "Times New Roman", serif`,
    scale: { display: 2.8, title: 1.7, body: 1, caption: 0.74 },
  },
}

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

  const merged: Theme = { ...DEFAULT_THEME, ...preset }

  for (const key of Object.keys(DEFAULT_THEME) as (keyof Theme)[]) {
    if (key === "scale") continue
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

  return merged
}
