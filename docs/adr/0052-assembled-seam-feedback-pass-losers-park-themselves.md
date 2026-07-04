# ADR 0052 — The assembled seam feedback pass: a losing alternate parks itself

**Status:** Accepted (Stage F correction; the director's strip gate remains, deploy held)
**Date:** 2026-07-03
**Executes:** the pass ADR 0040 parked ("deferred until the field justifies it")
**Builds on:** ADR 0051 (the sensor), ADR 0049/0050 (the reconstruction)
**Plan:** docs/superpowers/plans/2026-07-03-assembled-seam-feedback.md

## Context

Stage F's director gate failed: the reconstruction's A/B strips read worse to
the director's eye on the signature face's o seams (ow/ov/own) and smooth ve,
and the Stage E sensor agreed wherever it looked (signature o.jn01 worse on 4
of 5 assembled seams, cc-3's c on both of its two). The build fired alternates
with no gate that knows a losing seam from a winning one.

Every build-time scalar was then refuted by measurement across all 14 connect
fixtures before this pass was built:

- Descent DEPTH: the signature o (a loser) drops 0.173·xh, SHALLOWER than
  every smooth winner (0.185-0.275).
- Dive-slope floor: handmade's w (a winner, crossings 25→16) dives 0.26,
  shallower than the signature o (0.35); six of cc-3's nine offenders RISE
  (negative dives) and include its biggest winners.
- Dive-slope ceiling: cc-4's o (the corpus-best winner, 66→37) dives 1.7,
  just under the existing 1.75 park.
- Same face, same dive, opposite outcomes: cc-3's c (−0.36) net-worse,
  cc-3's w (−0.36) a big win.

This is ADR 0040's wall again, met on its own terms: the defect exists only
assembled, so the gate must measure assembled seams.

## Decisions

1. **A probe build senses every fired exit seam before the real build.** When
   the seam hook is on and exit offenders exist, buildFont fits copies
   (connectGlyphs mutates), runs a real worker build (otf only, full
   GSUB/GPOS), and rasters each offender-by-rights pair twice at the font's
   OWN metrics — advance plus the GPOS connect kern via opentype's
   getKerningValue — with the corpus sensor's zone read ported verbatim
   (100px x-height, band −0.1..1.1·xh, gap/cross/pool per column). Sensing
   the BUILT font is load-bearing: the first cut measured cell paths at
   kernless fit advances and the validation gate failed — the connect kern
   moves per-pair positions enough to flip the signature ow verdict's sign
   and to grow phantom gap columns on cc-4. At real metrics the ported
   sensor reproduces the corpus sensor's banked deltas digit for digit.

2. **Common bigrams vote; rare pairs cannot dilute.** Per-seam verdict (gap
   regression always worse; crossings decide past ±2, the knot metric;
   pooling breaks ties past ±1), calibrated on the banked Stage E table and
   locked by test/seam-feedback.test.ts against the real sensor JSONs
   (test/fixtures/seam-sensor). Crossing/pool verdicts VOTE only on the
   corpus's own common-bigram pair set (SEAM_CLASSIC_BIGRAMS): exhaustive
   majority voting let 21 rare pairs (ox/ob/oa) outvote the signature o's
   five banked worse-seams — the reader sees ou/ow/on, so those decide.

3. **Gap regressions veto from every base-follower seam.** Daylight is never
   legitimate, so an offender whose alternates introduce gaps on a third or
   more of its base-follower seams drops regardless of votes — the catch
   that found cc-3's p (a 2-column gap on all 24 of its seams, a real
   regression the corpus pair set never sensed). A collapsed .jn02 follower
   removes its own hook ink, so its gaps are not the left glyph's to answer
   for (without that attribution rule, smooth's r false-dropped on r|w).

4. **A dropped offender parks like a dive-parked one.** Selection re-runs
   with the drop set (`makeSeamAlternates` dropExits): no .jn01, no .jn03
   (its exit half is the same synthesis), the .jn02 entry collapse survives
   (separately measured, all wins), and the parked exit leaves the backtrack
   lefts so the follower's drawn hook survives after it. The park state is
   always the drawn hand; a failed probe build parks nothing.

## Alternatives rejected

- **Kernless cell-path sensing at fit advances** (built, validated, torn
  out): verdict directions flip on exactly the seams that matter.
- **Exhaustive-coverage majority voting**: dilution; the banked worse-cases
  are common-bigram seams and rare-pair wins must not rescue them.
- **Per-seam GSUB pruning** (per-offender context classes): buys back the
  signature o|r and cc-3 o|o wins at the cost of an engine change; v2 if a
  face ever needs a keep/drop split inside one offender.
- **Frequency-weighted voting**: the classic-set filter is the same idea
  with the corpus's own pair list as the weight function, and it keeps one
  definition of "the seams that matter" across corpus and build.

## Consequences

Validated drops across the corpus (all banked verdicts reproduced, locked by
unit fixtures): signature o (its only alternate — the face builds plain, the
director's three strips revert to the drawn hand), cc-3 c/o/p/r (keeps its
winners b/n/u/v/w), handmade o/v, light o. Every measured winner keeps
firing (smooth all 13, cc-4's corpus-best o, the nano family's w). The
corpus seam sensor now reads gapMax=0 on every face — the bridged faces'
banked 1-column gap seams belonged to exactly the alternates this pass
parks. Suites: unit 238, corpus 35/35, e2e 57/57.

Costs and bounds, honestly: a hook build with offenders runs one extra
worker build (~seconds; production builds never reach the pass). Exit-side
only (.jn02 stays ungated; every sensed one measures better or tie).

**Addendum (same day): the director resolved the ve call — v parks by
class.** The smooth ve seam survived the pass by measurement (crossings −6,
pool −1.09: the metric reads the merged junction as improvement), and the
director's eye confirmed the drawn crossing reads better — a defect class
the sensor cannot see (the synthesized exit carries more mass through the
crossing than the drawn loop-born stroke). No scalar separates smooth's v
from the measured v wins elsewhere (the dive ceiling cannot come below
cc-4's o at 1.7), so v joins the taste-class exclusions
(`SEAM_DIRECTOR_PARK`, beside the crossbars and descender exits): its
drawn exit everywhere, .jn02 entry side unaffected, out of the backtrack
lefts like any parked high exit. Accepted cost: the single-digit crossing
wins on cc-3/cc-4/cc-6 v seams (never eye-reviewed). One line reverts it.
Suites after the park: unit 239, connect corpus 15/15, seam e2e green;
smooth fires 11 alternates.

## Do not re-walk

Kernless positions for seam verdicts; exhaustive-majority decisions;
blaming a collapsed follower's gap on the left glyph; per-glyph scalars for
assembled defects (this ADR's context table is the third refutation —
ADR 0040 and 0043 hold).

## Evidence

Validation sweeps 2026-07-03 (scratchpad diag runs: per-seam deltas vs
test/fixtures/seam-sensor JSONs, exact match on every banked seam; final
DROPS lines match the fixture-locked expectations on all 14 faces).
Pixel-diff of the signature strips before/after: 0.03 percent, zero
structural. Sensor source: src/lib/maker.ts (senseBuiltSeams, seamVerdict,
decideSeamDrops); tests: test/seam-feedback.test.ts,
test/maker-connect.test.ts (the dropExits park).
