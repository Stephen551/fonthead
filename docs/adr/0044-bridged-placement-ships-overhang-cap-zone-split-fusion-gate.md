# ADR 0044 — Bridged placement ships: the exit-overhang cap is the weld guard, and bridged fusion is judged above the connect band

**Status:** Accepted (shipped to master; deploy gated on review)
**Date:** 2026-07-01
**Implements:** ADR 0043 (the proven route) / the connection-point spec Phase 3
**Supersedes in part:** ADR 0040's "assembled-glyph feedback pass" framing — the guard that
sufficed is placement-side and per-glyph, no feedback loop

## Context

ADR 0043 proved the route (gated eye-body placement + kern deference, rendered dense-body
rhythm sd 69→26 on `handmade`) and parked it on one problem: with the kern floors deferred
and the weld exempted, real welds crashed through (structural 269 `rl` / 298 / 207). This
milestone built the missing protection. The candidate recorded in 0043 (strip-row
counting) was instrumented FIRST and refuted by its own calibration data: deep-row counts
do not separate a bridge from a weld (`handmade` r-pairs d9, `light` d12, vs true welds on
clean faces spanning d2–d16). Seam renders of the flagged pairs then localized the real
defect: the placement is visually right, and the failure is specifically the r-arm riding
THROUGH the following letter, worst on `cc-4`.

## Decision

Two mechanisms, both live only on a firing (entry-reach-normalized) face:

1. **The exit-overhang cap is the weld guard** (`connectGlyphs`, after placement,
   replacing the row-min weld pass there). The next glyph's stem sits exactly at the
   advance by construction, so ink overhanging the advance laps that stem by the same
   amount. A joining glyph's strip ink may overhang by at most `ARM_LAP_FRAC` (0.12·xh) —
   the lap IS the join — and any excess grows the advance. Per-glyph and CONSTANT, so a
   letter's own pairs stay even (the property the row-min weld lacked: its per-pair
   growths re-scattered the rhythm). The scan runs 0.15–1.25·xh because the r arm rides
   at and above the x-height (a 1.1 ceiling missed its tip: the cap grabbed 70 units and
   structural still read 198); f and t scan only to 1.1 — their crossbars overhang by
   design (the old trim lesson).
2. **Bridged fusion is judged above the connect band** (corpus): after the cap, the
   residual structural depth (198/191/157) was the LOW entry hooks — `l`/`i` anchored at
   their stems reach ~200 units left through the neighbour's cell, the deliberate
   under-connection the seam renders show as a good join. On a bridged face the zone
   separates defect from join: LOW crossings (0.02–0.6·xh, the engine's own connect band)
   are the join by construction; HIGH crossings (an arm through a stem) are the defect
   the cap bounds. The corpus fusion gate for bridged faces (`entryNorm`, read from
   `__lastConnect`) therefore measures the strip from 0.45·xh up, same 145 ceiling.
   Result: `handmade` 36 (`Gn`), `light` 89 (`rb`), `cc-4` 61 (`ui`).

The thickness question ADR 0040 posed ("no build-time measure separates an intentional
bridge from a weld") resolved as a ZONE question for this face class: the discrimination
that works is WHERE the crossing rides, not how thick it is, plus the cap bounding how far
any high ink may ride. No assembled-glyph feedback loop was needed.

## Shipped numbers (vs the shipped-baseline probe, same fixtures)

- `handmade`: denseBody med 115→68, sdKern 69→32; structural 269 (run-5 unguarded) →
  36 (bridged gate zone); render A/B on file (baseline loose and uneven; after continuous
  and even, word breaks clear).
- `light`: sdKern 65→27; `cc-4`: sdKern 94→42 and rhythmSd 131→92.
- Skip faces (copperplate, `cc-2/3/5/6/7`, `flashy`, `signature`): byte-identical probe
  numbers in every run; the gate-off path re-verified against the baseline snapshot.
- Verification: corpus 31/31 (the recurring `cc-5` download-button timeout is a flake,
  passes on re-run), unit 158/158 (5 new: gate fires/skips/long-sweep-exempts, cap grows
  exactly, f exclusion), e2e 54/54, fontTools `checkChecksums=2` on the bridged OTF,
  astro build clean.

## Alternatives rejected

- **Strip-row counting** (the 0043 candidate): refuted by calibration before building —
  no separating boundary exists in the row counts.
- **A bridged structural ceiling on the full strip** (gate-widening): the good and bad
  exemplars interleave (good ≤198 vs bad ≥207 across faces with different hook lengths);
  the zone split separates them cleanly instead.
- **Capping the entry hooks too** (warping ink): the hooks are the join and render well;
  only metrics disliked them. Ink stays untouched.

## Consequences

Thin scattered hands (`handmade`-class) now build with even rendered rhythm by
construction; the banked ~B is superseded on the corpus evidence. The connect-kern on
firing faces emits only descender clearance, cap floors, and word-space evening
(`bridgedPlacement`, font-engine-autokern.js, additive opt-in). The corpus prints
`entrySd`/`entryMed`/NORM and the weld probe per connect face, so the gate calibration
and penetration profiles stay visible. Flashy and `cc-2` remain exempt by the long-sweep
median (ADR 0040 park honored). Field watch: the first user hand that fires the gate and
renders badly becomes a fixture, per the playbook.
