/**
 * OpenVerb Motion — the renderer for .ov documents.
 *
 * A GeoStory document describes what happens and when. This turns that into
 * pixels: a frame at any second, and a sequence of frames into a video.
 *
 * The split is deliberate. @openverb/geostory owns the format — parsing,
 * validating, serialising, the schema. Nothing here parses anything. This
 * package owns only the drawing, so a host can adopt the format without
 * adopting a renderer, or write its own and still read everyone's documents.
 *
 * MOTION IS NOT A SECOND FORMAT. A document whose annotations are addressed
 * in canvas space, with no basemap, is still a GeoStory document and still
 * says `profile: geostory`. "Motion" is what you get when the geography is
 * absent: the same renderer, the same primitives, pointed at a frame instead
 * of at the ground. That is why this depends on the format package rather
 * than forking it.
 *
 * WHAT NEEDS A BROWSER. `renderFrame` and everything under it draw into a
 * CanvasRenderingContext2D, and `exportVideo` needs WebCodecs. The timing,
 * geometry and linting halves — timeline, space, flow, entrance, theme,
 * lint — are pure and run anywhere, which is what lets a document be
 * checked in CI without a display.
 */

// ─── Timing ───────────────────────────────────────────────────────────────
// When each scene runs, how long the whole thing takes, what is on screen
// at a given second. Pure.
export * from "./timeline"

// ─── Space ────────────────────────────────────────────────────────────────
// Degrees or percentages of the frame, and the letterbox that keeps a canvas
// document the shape it was authored for. Pure.
export * from "./space"

// ─── Motion ───────────────────────────────────────────────────────────────
// How a line draws itself and what travels along it; how an annotation
// arrives. Pure.
export * from "./flow"
export * from "./entrance"

// ─── Look ─────────────────────────────────────────────────────────────────
// Presets, scales, and the colours a document does not name. Pure.
export * from "./theme"

// ─── Drawing ──────────────────────────────────────────────────────────────
// Needs a 2D context. Given one, these are what put a document on it.
export * from "./draw-annotations"
export * from "./draw-flow"
export * from "./draw-chart"
export * from "./chrome"

// ─── Frames and video ─────────────────────────────────────────────────────
// `renderFrame` is the one function most hosts want: a document and a second
// in, a drawn canvas out. `exportVideo` turns a run of them into a file and
// needs WebCodecs plus the optional mediabunny peer; `canExport` says whether
// this browser can before you offer the button.
export * from "./raster"
export * from "./export-video"

// ─── Narration timing ─────────────────────────────────────────────────────
// Fitting spoken words to scenes, which an export needs so the picture and
// the voice do not drift apart.
export * from "./narrate"
export * from "./narration-clock"

// ─── Checking a document ──────────────────────────────────────────────────
// Faults a document can have while parsing and validating perfectly. Pure,
// so it runs in CI.
export * from "./lint"
export * from "./problems"
