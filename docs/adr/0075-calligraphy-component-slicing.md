# 0075 — Preserve calligraphy components before forced row cuts

Status: Accepted

## Context

The Elegant Calligraphy field sheet has horizontally overlapping but physically
separate F/G and W/X swashes. Whitespace sees twelve cells in those thirteen-letter
rows. The n–z row has fourteen runs because v has a detached hairline. The old
letter-row fallback cuts at anchored vertical minima, clips complete swashes and
includes neighboring fragments. Those fragments also distort spacing metrics.
Two pixels of crop padding can separately admit a preceding row's disconnected
ink, such as a tiny Y fragment above lowercase l.

## Decision

After the existing whitespace and foreign-fragment repairs, try component slicing
for letter rows. Adopt it when the count matches the charset. If whitespace has
extra runs and components cannot recover the expected count, use anchored
ownership rather than unmasked vertical cuts. Retain the forced-cut diagnostic
for that case. Existing explicit slicer overrides remain available.

Guard vertical crop padding using the recovered row extent. Keep a one-pixel
antialias fringe next to owned ink, but reject disconnected neighboring ink in
the padding. Connected descender/ascender recovery runs first; charset-owned
accents can still extend the crop afterward.

The user's chosen build preserves letterforms: fine detail, automatic spacing,
flourish overhang on, connected cursive and smooth joins off. This changes
placement without reconstructing terminal strokes. Continuous joins are not
guaranteed for this sheet's high exits and missing open entries. No new join
model or dependencies were introduced.

## Evidence

The browser regression failed on the old anchored slicing. Correct extraction
changes E's cell width from 138 to 96 pixels, r from 165 to 94, and t from 164 to
83, while restoring W's complete 176-pixel swash rather than clipping it to 161.
The padding guard removes l's foreign third contour, retaining its outline and
counter. Unit cases cover foreign padding ink, retained antialias fringe and
cell ownership. OTF, TTF and WOFF2 exports retain all 92 sheet characters.

Validation: 362 unit tests; six browser cases covering this sheet, legacy Latin
accents, the tight accent supplement, smooth joins, luxury serif kerning and
natural variation. Typecheck: zero errors and warnings (existing hints remain).
