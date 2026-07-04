# Plan: the assembled seam feedback pass (ADR 0040's parked pass, field-justified)

**Date:** 2026-07-03
**Trigger:** the Stage F director gate (ADR 0049 plan). The reconstruction's
A/B strips read worse to the director's eye on the signature face's o seams
(ow/ov/own) and smooth ve; the Stage E sensor agrees wherever it looks
(signature o.jn01 worse on 4 of 5 assembled seams; cc-3's c.jn01 worse on
both). The build fires alternates with no gate that knows a losing seam from
a winning one.
**Doctrine:** ADR 0040 ("the rendered gap does not exist until the glyphs are
ASSEMBLED; the only reliable fix is an assembled-glyph feedback pass,
deferred until the field justifies it"). The director gate is the field.

## The refutation that forced this (banked, do not re-walk)

No build-time scalar separates losing alternates from winning ones. Measured
across all 14 connect fixtures (diag + seam-sensor JSONs, 2026-07-03):

- Descent DEPTH: signature o (loser) drops 0.173·xh — SHALLOWER than every
  smooth winner (0.185-0.275).
- Dive SLOPE floor: handmade w (winner, crossings 25→16) dives 0.26,
  shallower than signature o (loser, 0.35). cc-3's winners rise (n −0.53,
  w −0.36) — six of its nine offenders have NEGATIVE dives.
- Dive slope ceiling: cc-4 o (the corpus's biggest winner, 66→37) dives 1.7,
  just under the 1.75 park.
- Same face, same dive, opposite outcomes: cc-3 c (−0.36) net-worse,
  cc-3 w (−0.36) big win.

## The pass

After `connectGlyphs` fits the alternates (advances known), the maker
rasterizes every EXIT-side seam — each .jn01 offender against each follower
in its rights class — twice at identical positions: alternate vs base. The
zone read is the corpus sensor's, ported: 100px x-height raster, band
−0.1..1.1·xh, dense-body edges at 0.45·xh ink, per-column runs (≥2px);
gapCols / crossCols / poolRatio.

Per-seam verdict (calibrated on the banked sensor table):
1. gapΔ > 0 → WORSE (an alternate must never introduce daylight)
2. else |crossΔ| > 2 → WORSE/BETTER by sign (the knot metric, primary)
3. else |poolΔ| > 1 → WORSE/BETTER by sign (tiebreak)
4. else tie

Per-offender decision: WORSE count > BETTER count → the offender DROPS
whole. `makeSeamAlternates` re-runs with the drop set: the dropped char
loses .jn01 and .jn03 (its exit is the dropped one), keeps .jn02 (the entry
collapse is separately measured machinery, all wins), and leaves the
backtrack lefts exactly like a dive-parked exit (the follower's drawn hook
must survive after a drawn high exit). One refit; the worker build proceeds
unchanged — no engine edits, the GSUB machinery is untouched.

Measured drops from the banked table (locked by test/seam-feedback.test.ts
on the real sensor JSONs): signature o (4W/1B), cc-3 c (2W), cc-3 o (3W/1B),
cc-3 r (2W/1B), handmade o (3W, pool class), handmade v (1W, introduced gap),
light o (4W gap class /1B). Every director-visible win survives (smooth all
keep; cc-4, nano family, cc-6, cc-7, handmade b/w keep). Seams vote only
when the LEFT glyph carries the exit reconstruction — a .jn alternate as
FOLLOWER (a|n.jn01) has a base-outline left side and carries no exit
information, which is also what excludes the sensor's noisiest reads.

## v1 bounds (documented, honest)

- EXIT-side sensing only. The .jn02 entry collapses stay ungated: every
  sensed .jn02 seam in the corpus measures better or tie (cc-7 all wins).
- Per-offender granularity, unweighted majority over its sensed seams. The
  per-seam GSUB pruning (per-offender context classes) is the v2 if a face
  ever needs a keep/drop split within one offender; it costs an engine
  change and buys signature o|r back.
- Positions are the FIT advances (cell space), not the final kerned units.
  The verdict is a DELTA at identical positions, so absolute position error
  cancels; validation (below) proves the direction against the real-metrics
  corpus sensor before the drop wire ships.
- smooth ve may measure a tie and keep firing — the director's ve call sits
  at the sensor's resolution floor. Surface in the re-render, his call.

## Stages, each gated

**Stage A — the drop rule (pure, TDD).** `seamVerdict` + `decideSeamDrops`
against the banked sensor table as fixtures (signature, cc-3, handmade,
light, smooth). GATE: every predicted drop/keep above reproduced.

**Stage B — dropExits in makeSeamAlternates (pure, TDD).** Second-pass param:
dropped chars produce no .jn01/.jn03, keep .jn02, stay out of the backtrack
lefts. GATE: unit suite green.

**Stage C — the sensing port + wire.** Canvas raster in the maker main
thread (hook-gated, production untouched); diagnostics into __lastSeamAlts
(per-seam verdicts, drops). GATE: validation harness compares the ported
sensor's per-offender verdicts against the corpus seam-sensor JSONs on all
firing faces — every banked verdict direction must agree; disagreement
falls back to sensing the built OTF in a rebuild loop instead.

**Stage D — suites + strips.** Corpus (expect signature jn 1→0, cc-3 9→6-ish,
light 1→0, handmade o out), unit, e2e all green. Re-render the director's
five strips + the winners; his gate decides Stage F.

## Rollback

Everything stays behind `fh-test-seam-alts`; the drop pass only ever REMOVES
alternates, so its failure mode is the drawn hand (the shipped behavior).
