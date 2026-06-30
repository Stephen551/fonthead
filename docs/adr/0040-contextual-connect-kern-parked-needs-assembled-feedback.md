# ADR 0040 — Contextual connect-kern parked: no build-time measure separates the connector bridge from a weld; the real fix is an assembled-glyph feedback pass

**Status:** Accepted (milestone parked)
**Date:** 2026-06-30

## Context

The deferred A+ path for an EXTREME flashy hand (tiny bowls, ~3·xh sweeps) is even
per-pair spacing: that hand's pairs render unevenly (corpus `connected-cursive-flashy`
joinGap max 225 at `or`, realized-gap spread sd 78, rhythmSd 73) while the median is
fine. The plan (a research/design/critique workflow, ADR-style) scoped it as a gated
per-pair PairPos refinement: measure each pair at build time, even the outliers, replace
the base connect-kern value. Step 0 (ADR 0039, the kern-drift reconciliation) and Step 1
(the `CORPUS_KERN_PROBE` residual probe) shipped. Step 3 (the refinement) did not.

## Decision

PARK the milestone. Five build-time refinement approaches were each built and measured
against the corpus; all five fail for ONE root reason, and the only reliable fix is a
larger architecture (below). The engine builds the common hands at A; this extreme hand
caps at ~B+. The seam fix the user actually reported (dots/overlap) shipped separately as
the connector-height snap (ADR 0038). Parking the edge case and banking the common-case
win is the right call.

## Alternatives rejected (the five dead ends — do NOT re-walk these)

All five share one root cause: **the connector bridge**. A flashy hand's connectors
intentionally overlap DEEP into the next letter (the bridge). No build-time measure can
tell that intentional overlap from a body weld, and the gap the eye actually reads does
not exist until the glyphs are ASSEMBLED.

1. **Worker per-pair refine targeting `bodyMin`** (`refineConnectKern` in
   font-engine-autokern.js): the self-gate measured flashy's spread as TIGHT (engine sd 7
   vs the corpus's 78) because the silhouette `bodyMin` is connector-inclusive and
   understates the looseness, so the gate skipped flashy. Wiring proven (a forced
   constant collapsed the gaps); the measure was the failure.
2. **Main-thread dense-body-gap evening**: the dense body gap does not predict the
   rendered gap. oo's bodies are normal (1.05·xh) yet it renders loose (+194, from the
   base kern); lo's bodies are tight (0.29·xh) yet it also renders loose (+184). Evening
   the bodies fixes neither.
3. **Main-thread closest-approach evening**: the min over the body strip is dominated by
   the connector overlap (oo −1.24·xh) which is intentional bridging, a red herring vs the
   corpus rendered raw (−0.13·xh). The spread signal it produced also false-flags clean
   hands whose connectors overlap.
4. **Damp the base kern's loosening** (scale the positive delta): the weld floors recompute
   the loosening to pull the tightest scanline (the connector overlap, `m.min`) back up to
   the floor, OVERRIDING the damp. The floor reads the connector as a weld.
5. **Relax the floors + damp**: removing the weld floors lets the real bodies crash
   together (corpus structural 163 on flashy, and it welded clean `connected-cursive-2` at
   150 — the raw-spread gate false-fired there too). No clean knob exists.

## Consequences

The flashy hand caps at ~B+. ADR 0039 (connect ships a GPOS kern) and the Step-1 probe
stay committed and useful (the probe is reusable; run `CORPUS_KERN_PROBE=1 npm run
test:corpus`). The real fix, if a flashy hand ever becomes common in the field, is an
**assembled-glyph feedback pass**: build the font, measure the ASSEMBLED glyph geometry
(advance + outline) the way the corpus and the eye do, compute per-pair corrections, and
re-emit the GPOS — because the assembled geometry is the only thing that matches what is
rendered. That is a measurement rework inside the builder (a multi-day milestone with its
own risks, including the corpus metric's own height-mismatch artifacts), not a gated
sibling pass. It is explicitly out of scope until the field justifies it.

## Evidence

The probe data (`test-results/kern-residual-connected-cursive-flashy.json`): flashy oo
rawGap −34 / kern +228 / realized +194; or +209 / +16 / +225; none saturated at the ±650
clamp. The five attempts' corpus results (flashy unchanged on attempts 1-4; structural 163
weld on attempt 5). Builds on ADR 0038 (the seam snap that DID ship) and ADR 0039 (connect
ships a GPOS kern). The connect-kern internals: `analyzeConnectKern` targetGap =
min(median bodyAvg, 0.08·xh), the ±650 clamp, and the collision/body floors at
font-engine-autokern.js.
