# Maker mapping and spacing checks

The maker assigns keys by position. It does not recognize letter shapes.
Uploaded sheets therefore need a mapping review before publishing.

Compact alphabet-only grids use consecutive letters across their actual row
lengths. A four-column alphabet starts `ABCD`, `EFGH`, `IJKL`, and so on.
Any cells beyond the suggested alphabet are marked `□`; users must supply the
actual characters. Uppercase alphabets followed by a digit row also have their
own layout suggestions. Existing full-row, split-row, and armed preset layouts
remain supported.

The source review shows each original detected cell above its assigned key.
Empty mappings, repeated keys, spaces between keys, unassigned cells, and a
different number of source/mapping rows prevent publishing. Editing the mapping,
rebuilding, or editing glyphs invalidates the previous review. The built-in
sample has a known mapping and can verify it automatically.

After compilation, the maker checks that each requested character has an outline
unless deliberately excluded. It also checks advances against actual outline
bounds. A separate letter whose advance is much narrower than its ink, or whose
outline is displaced far beyond its advance, blocks publication. Small optical
overhangs are allowed. Explicit connected-cursive and italic modes allow their
intentional overlap, while still requiring valid advances.

`use safe spacing` rebuilds with flourish trimming off and 4% side bearings.
This preserves the source outlines and puts each separate letter inside its
advance. The rebuilt font must pass the same checks and receive a fresh mapping
review before publishing.

The publish action requires a valid charset plus mapping/spacing review flags,
and stores the charset and review status in font metadata for future diagnosis.
Geometry checks run in the browser using the compiled font. The action's review
flags enforce the normal maker workflow; they are not independent server-side
optical recognition or a guarantee against a deliberately modified client.

Tests cover the Handmade-style short-row failure, uppercase-plus-digit layouts,
invalid mappings, compiled narrow advances and missing characters, review
invalidation, and publication of a corrected compact sheet. Normal sample,
generated-sheet, color, and spacing flows retain their own browser regressions.
