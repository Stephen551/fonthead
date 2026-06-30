# ADR 0037 — Harden the auto baseline for imperfect hands, gated so good hands are untouched

**Status:** Accepted
**Date:** 2026-06-30

## Context

A user's FIRST trace is often imperfect: a loose flashy hand whose round letters float, a faint or thin-pen hand that traces wispy and fades, a sheet drawn unevenly so letters wobble off the baseline. If the first result is mediocre and there is no way to fix it, the user concludes the tool is broken and leaves. The lever is to raise the automatic baseline quality for imperfect hands, while never degrading the hands the engine already builds at A+ (a contained running script, a delicate copperplate, the calibrated corpus faces). Adjustment knobs for the residual are a complement (proposed: a connection-spacing slider, an in-connect letter-spacing control, a stroke-weight nudge), not a substitute.

## Decision

Four passes, all in `src/lib/maker.ts` (no vendored-engine edit, so no cache-bust), each self-gated so a hand that does not need it is left untouched, and each verified against the corpus before the next:

1. **Entry-sweep compression** (`compressConnectorTails` + `warpTailX`): a loose hand draws entry connectors 2-3·xh long; `anchorAdvance` folds the whole sweep into the advance and the letter floats. Compress over-long entry sweeps toward the body before connect, self-gated on the hand's MEDIAN entry tail (>0.6·xh marks a long-sweep hand; a short-entry copperplate ~0.10 is skipped).
2. **Round-letter body-anchor**: a round letter (o c e) with a long entry tail anchors its advance on its BODY, not its leftmost ink, so the bowl centres in a tight advance and the short sweep rides into the seam. A tight round letter keeps the leftmost-ink anchor (protecting f/t lead-ins).
3. **Stroke-weight floor** (`strokeWeightFloor` in `traceSheet`): measure the median horizontal ink-run vs the row height; a hand thinner than 0.05 (GATE) is re-binarized through the engine's existing `applyWeight` dilation up to a 0.07 weight (TARGET), capped at 2 iterations so counters survive. Gate and target are DECOUPLED on purpose: a genuinely wispy hand solidifies while an intentionally delicate engrosser (~0.057) is spared (weight 0, unchanged).
4. **Baseline auto-leveling** (the `baseY` re-derivation in `connectGlyphs`): the dense-bottom re-derivation corrected letters drawn LOW; it now also lifts a NORMAL letter drawn HIGH (its dense body bottom IS its lowest ink, so nothing narrow reaches below it) onto its body bottom, bounded by `BASE_UP_TOL`, so it sits on the line. Top-heavy (r) and descender forms keep the traced line.

The corpus is the floor-raiser: the field-failure hands from this work (`connected-cursive-flashy`, `connected-cursive-light`) are committed as gated fixtures, so any change that re-floats a round letter or re-thins a stroke trips them.

## Alternatives rejected

A **connector-height stub-snap** (warp each connecting stub to a shared join line): helped a light hand but flattened a copperplate's graceful swashes into ruled stubs, and no scalar (height, tail length, curvature) cleanly separates a swash hand from a running one — reverted. (**Reinstated by ADR 0038**: the separating scalar is the exit-vs-entry height MISMATCH, which the absolute height/tail/curvature scalars tried here all missed; snapping to the low entry line instead of the mixed median spares the swash.) A **prompt-only fix** (strengthen ADR 0034's connector instruction): the explicit "entry and exit stroke at one height" wording made the image model draw literal flanking dashes and collapse to one sheet — reverted to the prior prompt. **Contextual per-pair GPOS kerning**: the genuine path to A+ on an extreme flashy hand (the same glyph needs tight spacing in "minimum" and loose in "connecting", which a per-glyph advance cannot give) — deferred as its own milestone.

## Consequences

The engine builds contained, copperplate, and now thin/wispy and uneven hands well; an EXTREME flashy hand (tiny bowls, 3·xh sweeps) caps around B+ and needs the deferred contextual kern to close. Every pass is gated so good hands are byte-stable (corpus 29/29, copperplate unchanged). The baseline only rises from here as more field failures become corpus fixtures.

## Evidence

Commits 2bf95e2, 670357a, 9dafbac, da3ff82, dea588a; deployed b80dce5f. `strokeWeightFloor`/`compressConnectorTails`/`warpTailX`/`connectGlyphs` in src/lib/maker.ts; `test/weightfloor.test.ts`, `test/warp.test.ts`; corpus contact sheet (28 faces). Build memory: the baseline-hardening-batch entry.
