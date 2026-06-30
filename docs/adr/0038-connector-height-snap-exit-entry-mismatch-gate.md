# ADR 0038 — Connector-height snap: lower high exit flicks onto the entry join line, gated on the exit-vs-entry mismatch

**Status:** Accepted
**Date:** 2026-06-30

## Context

A signature-style hand (the common AI-generated cursive) flicks every letter
upward on the way out: measured on a real field hand, the exit connectors ride at
~0.59 x-height while the entry connectors sit at ~0.22. The connect model places
dense bodies a small gap apart and lets each letter's own connecting stroke bridge
the seam, so when the exit of one letter rides high and the entry of the next rides
low, the two strokes cross at different heights without merging. The result is a
visible dot at every seam (the exit and entry not meeting) and, because the high
exit is also long, it rides over the next letter (an overlap). The user's report
was direct: every tail overlaps, some tails float, and the rendered specimen is not
shippable. This is the dominant failure on AI signature input, which is the bulk of
real uploads, so the engine must handle it rather than send the input back.

ADR 0037 rejected a connector-height stub-snap because it flattened a copperplate's
swashes and "no scalar (height, tail length, curvature) cleanly separates a swash
hand from a running one." That scalar exists: it is the hand's median exit height
minus its median entry height. The AI signature hand measures +0.44; a copperplate
whose exits already meet its entries measures ~0.0. The earlier attempt snapped to a
mixed median and gated on the wrong signal; this one snaps to the low entry line and
gates on the mismatch.

## Decision

A fourth-and-a-half connect pre-pass in `src/lib/maker.ts` (no vendored-engine edit,
so no cache-bust), run after `compressConnectorTails` and before `connectGlyphs`:

1. **`warpTailY(d, edge, tip, dy, side)`** — the y-mirror of `warpTailX`. It ramps a
   connecting tail's y from 0 at the body `edge` to a full `dy` at the connector
   `tip`, leaving x untouched, so the stub keeps its horizontal reach while its tip
   drops onto a target line. `side` 'right' warps the exit tail, 'left' the entry.
2. **`snapConnectorHeights(glyphs)`** — measures, per full joiner, the entry and exit
   connector heights (the leftmost/rightmost ink rows in the connect band, relative to
   the glyph baseline). It gates on `medianLowExit − medianEntry > 0.2` x-height
   (`SNAP_MISMATCH_GATE`): only a hand whose plain letters exit abnormally high is
   touched. When it fires, each high exit is lowered onto the entries' join line
   (`medianEntry`, clamped to a low [0.08, 0.30] band), capped at 0.5 x-height of
   travel; a high entry is lowered the same way so a previous letter's snapped exit
   meets it. Only the **plain** low-exit letters move: `HIGH_EXIT` (o v w b d s u r)
   and `DESC_EXIT` (g j q y z) exit high or via a descender by nature and keep their
   drawn stub. An exit already at or below the join line is never raised.

The snap fired on 57 connectors of the signature hand and the seams close; a
copperplate (mismatch ~0) is skipped byte-for-byte. This **supersedes the
stub-snap rejection in ADR 0037**: the snap is reinstated with the mismatch gate
and a low-join target, which together preserve the swash hands the first attempt
flattened.

## Alternatives rejected

A **horizontal-gap close** (push bodies tighter or extend short connectors to kill
the gap-dots seen on a delicate hand at small render size): the delicate copperplate
connects cleanly at usable size — the small-size breaks are thin connectors fading at
40px, not outline gaps — so there was nothing to fix and tightening risked welding.
**Snapping every exit including the naturally-high letters**: lowering an o or b exit
fights the form (o connects from its top); protecting `HIGH_EXIT`/`DESC_EXIT` keeps
those joins honest. **Raising low exits up to a mid-line** (the ADR 0037 mixed-median
target): a mid-height join reads wrong for a baseline-riding cursive; the low entry
line is where a running hand actually joins.

## Consequences

The engine now closes the high-exit-flick seam on the signature-hand family, the
common AI cursive, without touching the copperplate or the corpus (30/30 faces, all
metric gates held, copperplate byte-stable). The field hand is committed as the
`connected-cursive-signature` corpus fixture so a regression that re-floats the
exits trips its metrics. The EXTREME flashy hand (tiny bowls, 3·x-height sweeps)
still caps around B+: its problem is per-pair spacing, not exit height, and remains
the deferred contextual-GPOS-kern milestone. Adjustment knobs for the residual stay
a complement, not a substitute.

## Evidence

Commits 6915013 (snap + warpTailY), 2769088 (unit tests), e503dd7 (corpus fixture).
`warpTailY`/`snapConnectorHeights`/`buildFont` in src/lib/maker.ts; `test/warp.test.ts`;
`e2e/fixtures/corpus/connected-cursive-signature.png`. Measurements: exit 0.59 vs entry
0.22 (signature) and mismatch 0.44 vs ~0.0 (copperplate), from the seam-geometry probe;
corpus contact sheet (29 faces). Builds on ADR 0033 (no-synthesis, real-ink joins) and
ADR 0037 (gated hardening); supersedes 0037's stub-snap rejection.
