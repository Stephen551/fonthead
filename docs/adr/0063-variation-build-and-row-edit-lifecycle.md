# 0063 — Keep variation sheets in the preview, export, and row-edit session

Status: Accepted

## Context

A user loaded three decorated alphabet sheets with natural variation enabled,
but their exported Handmade WOFF2 contained only the 92 base characters, space,
and .notdef. It had kerning but no contextual-alternate feature.

Two maker paths reproduced that outcome. Adding a sheet through a variation
slot updated the filenames without rebuilding or invalidating the old export.
Tracing a variation also replaced the base row-edit session; re-slicing then
rebuilt the last variation sheet alone, dropping the other drawings and calt.

## Decision

Adding a variation sheet automatically rebuilds from the base sheet. The old
result becomes unavailable before image decoding starts. File inputs and row
edits serialize their work so concurrent traces cannot replace each other's
session. Downloads and publishing wait for row edits to finish.

Tracing a variation retains the base sheet's pixels, row geometry, and glyphs,
and stores the alternate glyphs with that session. Row edits rebuild the merged
palette and retain the selected style. The completed preview reports how many
sheets its font actually contains.

## Alternatives rejected

Requiring a manual rebuild leaves loaded filenames indistinguishable from
drawings already present in the export. Adjusting preview CSS alone cannot fix
a font that has no alternate glyphs or substitution rules.

## Consequences

Loading separate variation slots performs a rebuild after each selection. A
single three-file upload still performs one build. Re-slicing edits the base
sheet and preserves the alternate drawings. Natural variation continues to work
for monochrome display lettering and cursive alike.

## Evidence

`e2e/graffiti-variation.spec.ts` reproduces both failures on the prior source:
the original download remains visible after loading a slot, and the completed
row edit exports a font with only `kern`. The fixed tests check all 92 characters
for three distinct shaped glyphs, unchanged base outlines after re-slicing, and
an actual preview image difference when calt is disabled. Existing three-sheet
exports still verify OTF, TTF, and WOFF2.
