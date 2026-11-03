# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-11-03

Seven themes instead of three, and a typeface per role rather than one for
the whole document.

### Added

- Four presets, chosen by subject rather than by surface: `rose` for
  relationships and psychology, `forest` for nature and ecology, `arctic`
  for clinical and research work, `mono` for a technical explainer that
  should carry no mood. With `midnight`, `paper` and `editorial` that is
  seven.
- `theme.fonts` — a stack per role: `display`, `title`, `body`, `caption`.
  The same four words `theme.scale` and `emphasis` already use, so an
  annotation marked `emphasis: display` takes the display size and the
  display face without saying anything else. Any role a theme omits falls
  back to `theme.font`.
- `theme.webfonts` — the families a host must load before the document will
  render as written, and `webfontsOf(doc)` to read them. Preset stacks are
  all system faces, so nothing here needs a network unless a document asks
  for one.
- `theme.slab` and `theme.slabInk` — the caption slab and the words on it.
  Every preset leaves them dark, including the two light ones. That looks
  wrong written down and is right on the screen: a cream slab on a cream page
  has no edge, so the caption stops reading as a panel and runs into whatever
  is behind it. Reversed out it is obviously a caption. They are tokens so a
  document that knows its own background can decide otherwise.
- `fontFor`, `firstFamily`, `missingFonts`, `roleOf`, `FONT_ROLES`,
  `PRESET_NAMES`, `PRESET_NOTES`, `SYSTEM_STACKS`.
- Four lint rules: `unknown-theme-preset`, `unknown-font-role`,
  `webfont-not-declared`, `webfont-unused`.

### Fixed

- The caption slab was hardcoded sans, so a `paper` document set in Georgia
  put its captions in a sans-serif. It now takes the caption face. That is
  the only visible change to the documents already published.
- The scale bar was hardcoded sans for the same reason, and now takes the
  caption face.
- A callout with a leader measured its own label in the default sans at body
  size to decide whether to flip away from the frame edge, however it was
  actually going to be drawn. A Georgia display label came out about a third
  narrower than it renders and stayed pointing off the frame. No document in
  the reference set carries both a leader and an emphasis, so nothing
  published changes; the next one would have.

### Why fonts are declared rather than detected

A canvas cannot wait for a typeface it was not told about. Ask for Caveat
before it is loaded and the frame is drawn in something else, with no error,
no warning and nothing wrong with the file — the one typographic failure
that leaves no trace in the output. So `webfonts` is explicit, the linter
reports a face that is named but not declared, and `missingFonts` reports
one that was declared but has not arrived. Loading them is the host's
business, because choosing a font provider is not a rendering decision.

## [0.1.0] - 2026-11-02

First release. Extracted from the reference renderer, where it had been
working for some time and reachable by nobody.

### Added

- `renderFrame` — a document and a time in, a drawn canvas out. The function
  most hosts want.
- `exportVideo`, `canExport`, `fileNameFor` — a run of frames into an MP4.
  Needs WebCodecs and the optional `mediabunny` peer, which stays a dynamic
  import so a host that only wants frames does not pull in a video encoder.
- `drawAnnotations`, `drawFlow`, `drawChart`, `chromeLayout` and the rest of
  the drawing layer, for a host that owns its own frame loop.
- `sceneWindows`, `totalDuration`, `sceneAt`, `cameraFor` and the timing
  layer; `canvasProjector`, `canvasBox`, `canvasRadius` and the space layer;
  `flowAt`, `entranceAt`, `themeOf`. All pure.
- `lintGeoStory` and `sortFindings` — the faults a document can have while
  parsing and validating perfectly. Pure, so it runs in CI without a display.

### Why this is a package and not a folder

The format has been published for a while: `@openverb/geostory` parses,
validates and serialises `.ov`. Nothing in it draws. So a reader could get a
document, confirm it was well-formed, and then have no way to see it, because
the only renderer lived inside one website.

That is the whole distance between a format and a demo. A document that only
its author can render is a file, not an artifact.

### What is not in here

Three modules stayed behind in the application they came from, because they
are application concerns rather than rendering: a React hook for speaking a
document's narration, the illustrator's prompt suggestions, and a browser zip
writer for taking generated pictures away. None of them are needed to draw a
frame.

### On the extraction

The fifteen modules moved byte-identical, verified by diff, so behaviour could
not change by construction — the only real risk was wiring. That was checked
by capturing every draw call the renderer makes for five documents at three
times each, switching the application over, and capturing again: 15 of 15
frames identical, including two geographic documents that exercise the camera
and basemap paths this package also owns.
