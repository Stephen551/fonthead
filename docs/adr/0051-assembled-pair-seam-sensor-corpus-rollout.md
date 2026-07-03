# ADR 0051 — The assembled-pair seam sensor: the corpus builds connect faces on the hook and reads every fired seam

**Status:** Accepted (Stage E of ADR 0049; Stage F remains, deploy held)
**Date:** 2026-07-03
**Executes:** ADR 0049 Stage E (rollout + assembled-pair sensor)
**Builds on:** ADR 0050 (the executed gates), ADR 0040 (the assembled-pair wall)

## Context

ADR 0040 established that seam defects do not exist until the glyphs are
ASSEMBLED: five build-time refinements failed because no per-glyph measure
sees the rendered seam. The reconstruction (ADR 0049/0050) was verified by
blinded panels on one hand; Stage E owed the corpus a permanent instrument
that measures assembled seams across the whole connect population, and a
rollout decision about which build the corpus gates.

## Decisions

1. **The corpus builds its connect faces WITH `fh-test-seam-alts`.** The
   corpus now gates the future connect default, not the parked present.
   Production stays plain and the seam e2e proves that separately. This was
   safe by construction: `.jn` copies are excluded from every face median,
   inherit base placement decisions, carry base advances, and are excised
   from the kern analyzers — and the run confirmed it (all existing gate
   values held on all 15 connect fixtures with the hook on).

2. **The smooth hand is a corpus fixture** (`connected-cursive-smooth`, the
   photographed sheet). The face whose fo/on/ve/so knots motivated ADR 0048
   and 0049 is locked against regression by the same harness as every other
   field failure, and it passes every pre-existing connect gate.

3. **The sensor reads fired seams at final metrics, alternate vs plain.**
   fontkit shapes probe texts (the join pairs plus .jn03 triples) through the
   real GSUB/GPOS in node; any run where a `.jn` glyph fired is rastered
   in-page at 100px x-height from the actual glyph ids at the shaped
   positions. The zone between the two dense-body edges, band −0.1..1.1·xh,
   is read per column: gap columns (no ink), crossing columns (2+ distinct
   runs), pooling ratio (max column ink over the zone median). Metric
   transparency means the base glyphs render at IDENTICAL positions, so each
   seam is read twice and every log line carries the defect contrast the
   alternate bought (smooth `on` 11 vs 17 crossing columns, `va` 1 vs 6).

4. **Gates are calibrated to what each read discriminates, and no more.**
   Gap columns discriminate sharply — healthy faces read 0, the two bridged
   faces one raster column, a connector failing to span reads 8+ — gate 3.
   Crossing columns are dominated by legitimate two-run geometry (cc-3's r
   arm rides its whole seam at 62 columns; the smooth hand's panel-verified
   seams reach 25), so the gate (90) is a catastrophe floor. Pooling's
   healthy max is 6.13 beside an arch shoulder; its gate (8) catches runaway
   blobbing only. Seam TASTE stays with the panel (Stage F), per ADR 0049's
   own division: meeting is by construction, the panel is the taste gate.

## Alternatives rejected

- **Gating the crossing read tightly.** Absolute crossing counts do not
  separate defect from letterform across faces (the r arm, bowl arcs, and
  crossbars all read as second runs); a tight gate would fail healthy hands
  or demand per-face thresholds fitted to noise.
- **A narrower vertical band to clean the crossing read.** The hook knots
  live up to 0.9·xh (the collapsed lead-ins), so a ceiling low enough to
  exclude arch shoulders and arms also blinds the sensor to the defect class
  it exists for.
- **Keeping the corpus on the plain build and sensing only in the seam
  e2e.** That gates one hand; the rollout question is the population.

## Consequences

Stage E closes. The reconstruction is measured wherever it fires (76 seams
across 11 faces this calibration), and a regression in synthesis geometry —
a connector that stops short, crosses at scale, or balloons — fails
`npm run test:corpus` with the seam named. Per-seam forensics land in
`test-results/seam-sensor-*.json`. Carry-in for Stage F's panel: the
signature face's `o.jn01|w` seam reads crossing 31 vs 16 plain (the w's high
lead-in geometry; the strip renders clean, under gate). Stage F (full-
specimen 3-lens A/B vs deployed, a real 12-16px waterfall, the director's
gate) still holds deploy.

## Evidence

Commit 2f2169b (the sensor, the fixture, the hook, the calibrated gates);
calibration numbers in the plan's Progress section
(docs/superpowers/plans/2026-07-02-connector-reconstruction.md) and the
SEAM-SENSOR lines of the 2026-07-03 corpus run (35/35 passed, unit 219,
e2e 57). Sensor source: e2e-corpus/corpus.spec.ts (`shapeSeamRuns`,
`senseSeams`).
