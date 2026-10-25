# 0064 — Row editing for every variation sheet

Status: Accepted; extends 0063

## Context and decision

The maker exposed row diagnostics and re-slicing for the base alphabet only.
Keep the source pixels, row geometry, and per-row glyphs for each variation
sheet as well. A row edit targets one sheet and row, rolls that row back on
failure, and rebuilds the full palette. Base glyph counts and reports continue
to describe the base alphabet.

Show a labeled row group for every traced sheet, with the same slicer choices,
counts, and re-slice controls as the original. Picker state and busy state use
both the sheet and row index. Sheet numbers match the upload slots, including
when only the third slot is filled. A full rebuild resets the picker choices
to match its automatic slicing.

## Scope and consequences

This extends the existing React maker and its paper, ink, mono typography, and
focus tokens. Its single job is to let someone correct a cut in any uploaded
alphabet without losing the other drawings. No new dependencies or animation.
The extra source buffers stay in memory until the next base-sheet trace so
edits can reuse the original image and geometry.

## Verification

The browser regression loads the three supplied graffiti sheets, changes a row
on each variation, and checks that the selected outlines actually change while
all other sheets' outlines remain identical. Untouched rows of the edited sheet
retain their contours; their baseline can move when its cap-height estimate
changes. It also checks three drawings per character, independent picker state,
keyboard focus, and layouts at 375, 768, and 1280 pixels. The existing base-row
regression remains in place. Before this change the new test fails because the
second sheet has no row-control group.
