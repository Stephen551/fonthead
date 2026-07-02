# ADR 0046 — Reading the generator sheet class, and the placement-mode boundary that floated the e

**Status:** Accepted (hardening + fixture deployed earlier; the mode-boundary fix committed, deploy gated)
**Date:** 2026-07-02
**Builds on:** ADR 0045 (the fidelity build), ADR 0044 (bridged placement), ADR 0043 (the gates)

## Context

Stephen generated one hand as three 7-row sheets with Nano Banana Pro against the
rewritten script prompt (connector contract, letterform insurance, one pen weight,
flat ink, 4K ask). The sheets arrived 2048px JPG, tight-leaded, soft-shadowed — a new
input class that broke the maker twice, and whose three sheets then exposed a placement
mode boundary slicing through a single hand.

## Part 1 — reading the sheet class (deployed 2026-07-02, live 1e05edba)

1. **Tight leading fuses rows.** Descenders physically interleave the next row's
   ascenders, so NO scanline between rows 1-4 is empty and the gap-based row detector
   returned 4 bands for 7 rows — the charset garbled silently (the first build rendered
   scrambled fragments; the four-line charset box was the tell). Fixes, mirroring the
   color path's shadow-awareness: rows also detect on a strict dark-core binarize
   (SHADOW_ROW_THRESHOLD 64, more-rows wins), and still-fused bands split at prominent
   ink-profile valleys (`splitBandsAtValleys`: recursive, VALLEY_MIN_ROW 40, even-height
   guard 2.6).
2. **The valley bar is 0.2, not 0.12.** Sheets v2/v3 of the same hand rained six
   descenders (~40px of ink) through the sparse digit row's line; the boundary valley
   measured 0.176 of its smaller flank and 0.12 missed it — digits silently vanished
   from the charset. A real in-row minimum measures 0.4+ of its flanks, so the classes
   are far apart at 0.2.
3. **Row-crossing tips cull at the subpath level.** After a valley cut, the row above's
   descender tip lands inside a cell as a breve-like tick over m and u — and Potrace
   hides it INSIDE the letter's compound path, so a path-level cull is a no-op
   (two attempts failed before a fontkit contour dump showed m carrying three contours).
   `cullForeignTopTails` explodes subpaths, culls a small piece in the top zone
   (starts ≤6% down, stays ≤30%) or its bottom-edge mirror (the row below's ascender
   tips), and spares i/j dots (~a third down), counters (inside a parent box), and
   quote-class glyphs (most of their own ink).
4. **Judged:** the single-sheet build scored 79 craft / 76 award / 86 fidelity — the
   program's best (bar 93) — and the sheet is locked as the corpus fixture
   `connected-cursive-nano`.

## Part 2 — the placement-mode boundary (the floating e)

The three sheets of the one hand measured median entry reach **0.574 / 0.593 / 0.614**,
and the bridged path's long-sweep exemption sat at 0.6: one sheet built CLASSIC (and
judged 80), two entered the BRIDGED path — where every e floated off its word
("Handmad e", "sl e e v e s").

Diagnosis discipline note: three placement-side tunings failed to move the seam before
a fontkit geometry dump located it — d's ink ends 42 units from e's ink, at MISMATCHED
HEIGHTS. A HIGH_EXIT letter's short high flick passes over the next letter's low entry
without meeting it, and on a height-CONSISTENT hand (Nano Banana obeyed the one-join-
height prompt) neither snap gate can see a by-class flick: the mismatch gate compares
plain-letter medians and the variance gate sees tiny sd. The classic path connects the
same seam because its tight daylight (gap + the e's own tail) puts the flick tip onto
the e's rim.

**Decision: a long-entry hand builds classic.** Its connectors are drawn to span its
own pitch — that is what long entries ARE — so the classic body-edge model is its
correct mode. The exemption widens from 0.6 to 0.5 (`NORM_SWEEP_EXEMPT`), clear of the
observed straddle; `cc-4` (0.57) returns to its long-green classic build. Banked from
the failed tunings, all corpus-verified: the span deficit trusts HALF the median exit
(the short half of the distribution is what a real predecessor spans), its cap is the
gap floor rather than half the letter body (the old cap bound narrow letters first —
the same float, different cause), and a height-SCATTERED hand lifts the HIGH_EXIT
exit-snap exemption (dormant on consistent hands, correct for true scatter).

## Also recorded

- The 3-sheet VARIATION build of this hand joins visibly worse than the single-sheet
  build (variant registration misfits this hand class; "Handmade" repeats a and d so
  half its lowercase are variants). Un-judged, un-fixed — the variation-join milestone
  now leads the queue with the seam pass.
- Nano Banana saves ~2K JPGs despite 4K asks; sheets land as `imageNNNN[1].jpg`.

## Evidence

The overlay screenshot (fused rows), the luminance histogram (1.3% of pixels at lum
16-127 as shadow), the zero-gap scan (four gaps at any threshold), the fontkit contour
and geometry dumps, the valley debug run (v2: boundary valley 39 vs digit peak 222),
and the e-join render series in the session transcript. Verification at commit: unit
159, corpus 32/32 (nano fixture included), cc-4 green on classic.
