# ADR 0055 — Preserve upright letter structure and audit the whole alphabet

**Status:** Accepted
**Date:** 2026-09-13

## Problem

The full 52-letter audit of the supplied serif sheet found that flourish
overhang treated diagonal wedges and serifs as thin script tails. It shortened
advances until pairs such as VV, LA and vv overlapped. The earlier baseline
checks and limited spacing pair list did not catch this. Upright J also retained
a small baseline offset because it always used the cap-top anchor.

## Decision

Before trimming overhangs, look for at least three distinct, straight upright
stems among H/I/i/l. Fit their centers through the lowercase body strip; require
small slope and residual, and sufficient ink. A face meeting that evidence uses
complete ink bounds plus symmetric side bearings. Its serifs and diagonals stay
inside the advance. Slanted or curved script stems keep the existing overhang
path; explicitly connected cursive keeps its separate placement pipeline.

For these upright builds, expand kerning to all present A–Z/a–z pairs. The
existing minimum full-height clearance guard and maximum pull still apply.
This closes gaps the old candidate list missed, such as fi and fg. The user’s
spacing control continues to set the side-bearing size.

J now anchors its bottom when it has ordinary cap height, while a substantially
taller descending J keeps its cap-top anchor. Ordinary R sits on its foot;
it is no longer automatically treated as a descender. Q and lowercase
descenders retain their tails. Letter heights are not rescaled.

## Verification

The exported WOFF2 is parsed and shaped with fontkit. The browser rasterizes
each outline independently at 500px/em, then compares every scanline across
all 2,704 ordered letter pairs with GPOS positioning applied. The supplied
sheet must have positive clearance and no gap larger than 40% of x-height.
Every non-descending letter must sit within one font unit of zero. Descender
body tops, j/i dots, and Q's cap top have separate checks.

The old export has 1,001 pairs with more than five units of full-height
overlap. The intermediate bounds fix eliminates overlaps but leaves fg at
about 356 units of clearance; the expanded kerning regression catches that.
An alphabet specimen and representative words are also reviewed visually.

These are regression guarantees for the supplied sheet, not proof that every
possible handwriting style will be classified or spaced perfectly.
