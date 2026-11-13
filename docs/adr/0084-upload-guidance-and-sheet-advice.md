# 0084 — Show what kind of sheet works, and say plainly when an upload looks wrong

Status: Accepted

## Context

On 2026-11-13 one visitor on a Chromebook filed three maker bug reports in a row, each from an input fonthead is not built for: a screenshot of an app with gray UI bands across it, a typed 3-row sheet built against the 7-line charset (handled by ADR 0083), and a 296 × 571 image in flat color mode where "ABC" came out as one glyph because the letters touched.

The drop area said "png or jpg · rows of A–Z, a–z, 0–9" and nothing about paper, spacing, light, or screenshots. After a drop, nothing told the visitor that the image itself was the problem, so each attempt read as a maker bug.

## Decision

`src/components/Maker.tsx`:

- A "what works" note sits right above the drop area, before any upload. It shows a 120 px render of the built-in sample sheet (`makeSampleSheet`, or `makeColorSampleSheet` in color modes), so no new image asset ships, and one short paragraph: dark ink (or color letters) on plain white, a little room around every letter, each row matching a charset line, good light or a scanner, and that app screenshots and tiny images usually trace badly.
- After a sheet loads, a warning box under the drop area lists any advice that applies. It never holds or changes a build. It is recomputed live from the loaded sheet and the charset text, like the ADR 0083 prompt.

`src/lib/upload-advice.ts` (pure, unit tested):

- **Screenshot:** measured once in `captureSheet` from the overlay canvas it already draws (at most 520 px wide). A row is flat when its pixels across the full width have a standard deviation under 1. The most common flat shade is the page itself (white paper, or a plain gray or cream generated background) and never counts. Flat rows of another shade between 20 and 235 luma, in runs of at least 2% of the height, are UI chrome. A sheet with 5% or more of its height in chrome reads as a screenshot.
- **Small image:** the longer side of the original is under 800 px.
- **Touching letters:** when the sheet's row count equals the charset's, any row whose charset line has 3 or more characters but whose shape count is half that or less. Skipped while the ADR 0083 charset prompt is showing, so the two never say the same thing twice. Works in color modes too, since drop shadows over-count shapes and never under-count them.

## Alternatives rejected

- Blocking the build on any of these: they are hints, and a deliberate odd sheet must still build.
- Shipping a photographed sample sheet as a new asset: the built-in sample already shows the layout and costs nothing to render.
- Counting cell aspect ratio for touching letters: wide script and calligraphy letters would trip it. The charset comparison only fires when the visitor has said how many characters a row holds.
- Phone-shape or EXIF checks for screenshots: weak signals, and the flat-band test catches the reported case directly.

## Consequences

A visitor who starts with a screenshot or a tiny image sees why before they file a bug, and a row of touching letters is named by number. Known limits: a dark-mode screenshot whose bars are near black, or whose bars are under 2% of the height, is not called a screenshot; it may still get the small-image or touching-letters line.

## Evidence

- `test/upload-advice.test.ts`, written against a stub module first: 7 of 15 tests failed (the 8 that passed were the "leave it alone" cases). Against the first real version all 15 passed; a later test for a plain gray generated background failed on that version and drove the page-shade rule. 17 pass now.
- A Python port of the screenshot and small-image checks over all 54 committed fixture sheets (`e2e/fixtures`, `corpus`, `corpus-color`) flagged none of them.
- `e2e/upload-advice.spec.ts`: hint and sample image before upload, screenshot advice that still builds to a download, row 1 named for "ABC" drawn as one shape, and no advice on a clean sheet.
