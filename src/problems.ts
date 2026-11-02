/**
 * Telling a broken document from one the schema has not caught up with.
 *
 * `validateGeoStory` checks against the published schema in
 * `@openverb/geostory`, which knows four annotation kinds: circle,
 * polygon, line and marker. The Motion work added two more - `text` and
 * `chart` - and they render, export and play, because the format
 * preserves fields it does not recognise. The validator still reports
 * them, correctly: by the published schema they are invalid.
 *
 * Both of those facts are true and the person reading needs both. A list
 * that says "six schema problems" when three of them are a chart doing
 * exactly what it was asked to do teaches the reader to ignore the list,
 * and the next real error goes with it. So the errors are sorted rather
 * than suppressed: a document that uses an extension is told which ones,
 * and anything else is still a problem.
 *
 * This disappears the day the published schema knows these kinds. Until
 * then it is the honest way to show the gap.
 */
import type { GeoStoryDocument } from "@openverb/geostory"

/** Annotation kinds this renderer draws that the schema does not list. */
export const EXTENSION_KINDS = new Set(["text", "chart"])

export interface SortedProblems {
  /** Genuine faults: a reader should act on these. */
  problems: string[]
  /** Known extensions, named so the reader knows why they are listed. */
  extensions: string[]
}

/** `/annotations/2/kind` -> 2. Anything else -> null. */
function annotationIndex(error: string): number | null {
  const found = /^\/annotations\/(\d+)(\/|:)/.exec(error)
  if (!found) return null
  const index = Number(found[1])
  return Number.isInteger(index) ? index : null
}

export function sortProblems(
  doc: GeoStoryDocument | null,
  errors: string[]
): SortedProblems {
  const problems: string[] = []
  const extensions: string[] = []

  for (const error of errors) {
    const index = annotationIndex(error)
    const annotation = index === null ? undefined : doc?.annotations?.[index]
    const kind = String((annotation as { kind?: unknown } | undefined)?.kind ?? "")

    // Only a complaint about the kind itself, and only when the kind is one
    // this renderer actually implements. A typo in `kind` is still a
    // problem, because the typo will not be in this set.
    const aboutKind = /\/kind:/.test(error)
    if (aboutKind && EXTENSION_KINDS.has(kind)) {
      extensions.push(error)
      continue
    }

    problems.push(error)
  }

  return { problems, extensions }
}

/** One line explaining what the extensions are, for the reader. */
export function extensionNote(extensions: string[]): string {
  const kinds = [...EXTENSION_KINDS].sort().join(" and ")
  return (
    `${extensions.length} of these are the ${kinds} kinds, which this ` +
    `renderer draws and the published schema does not list yet. They play, ` +
    `export and share; the schema simply has not caught up.`
  )
}
