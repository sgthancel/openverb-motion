# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
