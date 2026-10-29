# 0077 — Retain detached ornamental descender terminals

Status: Accepted

## Context

The ornamental Extended Latin supplement traces ý and ÿ completely, but
post-trace cleanup drops their detached bottom curls. Each curl touches the
bottom of the cell and overlaps the main descender vertically. The old docked
mark exemption only accepts marks above or below another contour, so it rejects
this curl. The counter exemption also fails because the curl extends four
source pixels left of the main outline.

## Decision

Keep the existing foreign-fragment cleanup and add a narrow bottom-terminal
exemption. A contour must lie in the main body's bottom 30%, overlap its vertical
span, finish no more than one pixel below it, and stay inside its horizontal
envelope with a 6%-of-body-height margin. This is geometry-based and applies to
other ornamental letters, with or without accents. Cropping, accent ownership,
baseline alignment and tracing are unchanged; no missing strokes are redrawn.

## Evidence

The field curl occupies x=77–104, y=158–189 beside a body at x=81–187,
y=43–189 in a 191-pixel cell. The regression fails on the old cleanup (two
contours retained instead of three). Counterexamples keep removing fragments
farther beside or below the body. The browser regression checks the complete
ý/ÿ contours, descenders and 214 mapped characters in OTF, TTF and WOFF2, then
checks the result again after re-slicing the affected supplement row.

Only ý and ÿ differ across all 122 traced supplement characters; each regains
one original contour. Validation: 367 unit tests, four browser regressions,
typecheck and production build. The existing tight-accent browser test first
timed out on the idle upload screen, then passed unchanged on rerun.
