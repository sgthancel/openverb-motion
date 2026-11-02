# OpenVerb Motion

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Renders OpenVerb `.ov` documents to frames and video.

> **The format says what happens. This draws it.**

## What this is

[`@openverb/geostory`](https://www.npmjs.com/package/@openverb/geostory) owns
the `.ov` format: parsing, validating, serialising, the schema. It does not
draw anything.

This package is the other half. Give it a parsed document and a time in
seconds and it hands back a drawn canvas. Give it a document and a frame rate
and it hands back an MP4.

Nothing here parses. That split is the point — a host can adopt the format
without adopting a renderer, or write its own renderer and still read
everybody's documents.

## Motion is not a second format

A document whose annotations are addressed in canvas space, with no basemap,
is still a GeoStory document and still says `profile: geostory`.

"Motion" is what you get when the geography is absent: the same renderer and
the same primitives, pointed at a frame instead of at the ground. A line is a
line whether it is a river or a signal from a satellite. That is why this
package depends on the format package rather than forking it.

## Install

```bash
npm install @openverb/motion @openverb/geostory
```

`exportVideo` additionally needs [mediabunny](https://www.npmjs.com/package/mediabunny),
which is an optional peer so that a host only wanting frames does not pull in
a video encoder:

```bash
npm install mediabunny
```

## Drawing a frame

```js
import { parseGeoStory } from "@openverb/geostory"
import { renderFrame, totalDuration } from "@openverb/motion"

const doc = parseGeoStory(await (await fetch("/story.ov")).text())

const canvas = await renderFrame({
  doc,
  seconds: 12,
  width: 1920,
  height: 1080,
  tiles: new Map(),   // basemap sources, empty for a document with no map
  chrome: true,       // the player's header, footer and caption band
  captions: false,
})
```

`totalDuration(doc)` tells you how long the document runs, including an audio
bed that outlasts the last scene.

## Making a video

```js
import { canExport, exportVideo, fileNameFor } from "@openverb/motion"

if (canExport()) {
  const file = await exportVideo({ doc, width: 1920, height: 1080, fps: 30 })
  // ... save it as fileNameFor(doc)
}
```

Ask `canExport()` before you offer the button. WebCodecs is not everywhere,
and an export that fails after ninety seconds of rendering is worse than one
that was never offered.

## Checking a document before you draw it

```js
import { lintGeoStory, sortFindings } from "@openverb/motion"

for (const f of sortFindings(lintGeoStory(doc))) {
  console.log(`${f.severity} ${f.rule} [${f.where}] ${f.message}`)
}
```

Every rule exists because the fault it catches was shipped at least once and
found by instrumenting a canvas rather than by reading. It catches an
`animate` block on geometry that is not a LineString — drawn by neither
renderer, so it silently disappears; an annotation on screen in scenes it does
not declare, because a window runs from its first scene to its last
continuously; an `enter` on an animated line, which is ignored entirely; a
coordinate pair written into `at`, which is seconds; and the typos a format
that preserves unknown fields will otherwise keep in silence.

This half is pure, so it runs in CI without a display.

## What needs a browser

| Module | Needs |
| --- | --- |
| `timeline`, `space`, `flow`, `entrance`, `theme`, `lint` | nothing — pure |
| `draw-*`, `chrome` | a `CanvasRenderingContext2D` |
| `raster` | a canvas, and `Image` for basemap tiles |
| `export-video` | WebCodecs, plus the optional `mediabunny` peer |

## Canvas space

Canvas percentages are read against the 16:9 rectangle a document was authored
for, centred in whatever frame it is given, with the leftover width as margin.

That is not a style choice. A percentage is only meaningful against a shape,
and reading x against a wide band while a circle's radius is measured against
the short side makes a document disagree with its own geometry: an Earth drawn
round comes out an oval, and meridians computed from a sphere hang outside the
globe they were projected from. `canvasBox(frame)` is the rectangle, if a host
needs to place its own furniture around it.

## Part of the OpenVerb ecosystem

| Package | What it does |
| --- | --- |
| [`openverb`](https://www.npmjs.com/package/openverb) | Core framework — load and validate verb libraries |
| [`@openverb/stdlib`](https://www.npmjs.com/package/@openverb/stdlib) | Standard verbs for common UI operations |
| [`@openverb/geostory`](https://www.npmjs.com/package/@openverb/geostory) | The `.ov` format — parse, validate, serialise |
| `@openverb/motion` | This package — draw it |

## License

[MIT](LICENSE)
