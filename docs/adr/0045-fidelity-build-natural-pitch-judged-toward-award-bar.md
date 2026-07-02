# ADR 0045 — The fidelity build: trace the hand at resolution, place it at its own pitch; judged three rounds toward the award bar

**Status:** Accepted (shipped to master pending review gate)
**Date:** 2026-07-01
**Builds on:** ADR 0044 (bridged placement), ADR 0042 (the variance gate, now live two-sided), ADR 0037 (the stroke floor, recalibrated here)
**Bar:** Stephen's: a built font clean enough for an award-winning website's hero. Measured by an adversarial 3-lens vision panel (typography craft / award-site fitness / fidelity to the hand) per face, score 93 = shippable.

## Context

A field report ("every sheet turns bold") led to the fidelity doctrine: the maker's job
is to replicate the hand cleanly, never to restyle it. Professionals digitizing a hand
keep skeleton and weight exactly; what makes their output professional is clean outlines,
consistent rhythm, and format hygiene. The engine's corrective passes were audited against
that line: metrics-level correction is craft, ink-level correction is distortion.

## Decisions

1. **Fidelity defaults.** Fine-detail supersampling auto-enables for under-resolved
   sheets (median row under AUTO_FINE_ROWH 200px — a GPT sheet's ~80-160px rows trace
   lumpy at native), with the advanced toggle as the off switch (ref-carried so the
   drop's own build sees the decision). The stroke floor rescues only DISINTEGRATING
   ink: gate 0.05→0.025 (the field hands 0.038-0.063 are all spared), target 0.04, one
   dilation step (two steps turned a 3px low-res hairline 2.3x bold — the field report).
2. **Supersampled trace quality.** turdsize scales by scale² (an unscaled area threshold
   stopped culling seam flecks at 3x); alphamax floors at 1.15 (hairline loop apexes
   left straight facets at hero size); the supersample threshold runs 24 under the base
   (the smoothing interpolation spread a 3px stroke to ~1.5x — measured stroke/em
   0.045→0.040; the further −40 step pulled connectors past reach and broke joins, so
   −24 is the calibrated point).
3. **Natural-pitch bridged placement.** The bridged daylight level is the hand's own
   pitch: gap + median entry reach (evening at the bare gap crushed letters into welded
   clusters — judged round 1). Each glyph's entry deficit closes only the span the
   pair's connectors cannot cover (bridgedGap − 0.75·medianExit − ownTail + margin,
   capped at half its body), folded into the left bearing so its own advance is
   untouched. The eye-body read unions with the thin-trim body (a curved cup or bowl
   never stacks 0.45·xh in one column — the u traced to a 161-unit advance against 401
   units of ink and vanished under its neighbours), and both the anchor and the tail
   measure band-limit to the join zone (a y's descender loop read as body/tail and
   broke `ly` into two words).
4. **Two-sided variance snap.** ADR 0042's recorded gate is live: entry-height sd over
   SNAP_VAR_GATE 0.12 fires the connector-height snap both ways (raise capped 0.25·xh),
   so scattered terminals coincide and merge instead of crossing into welds. cc-5's
   rhythm went 26→9 and cc-7's 36→15 under it; the mismatch-gated lowering path
   (signature) is unchanged.
5. **Bridged supporting metrics.** Word space 0.38em on firing faces (letter daylight
   grew with the natural pitch); the corpus joinGap-median ceiling is 75 for bridged
   faces (cc-4, the widest-pitch hand at 0.57·xh median reach, rode the 60 ceiling at 59
   before this milestone and reads 67 at natural pitch with structural/crosser/
   capOverhang all zero; fullJoin still guards connection).

## The judged arc (bar 93)

| lens | light r1→r2→r3 | handmade r1→r2→r3 |
|---|---|---|
| craft | 59→63→61 | 61→57→71 |
| award | 52→64→59 | 54→71→72 |
| fidelity | 58→71→84 | 70→74→86 |

Judge instances are stochastic (±5 on overlapping defect lists); the defect CONTENT is
the signal. Round 1's list (word fractures, bold restyling, buried letters, seam flecks,
polygonal facets) is engineering-resolved. Round 3's fidelity judges call the letterforms
"unmistakably mine" with weight "essentially preserved."

## The remaining distance, decomposed honestly

1. **Input resolution.** Scan wobble and micro-lumps at 130px+ from 80px-row sheets;
   3x supersampling cannot invent detail. The lever is input-side: higher-resolution
   sheets (per-row generation, drawing apps) — the prompt already asks for 2400px that
   GPT cannot deliver.
2. **The hand's own letterforms.** The Palmer-style Q reads as 2, Z as 3; clubbed p
   feet and a clogging s counter are drawn ink. The lever is the alternates milestone
   (two-tier alternates, ADR 0040's user-opt-in model), not tracing.
3. **Crossing knots and per-pair optical residue.** Ink pools where strokes cross even
   at coincident heights, and per-pair rhythm beyond the per-glyph model needs assembled
   feedback (ADR 0040's deep end, still parked).
4. **Small sizes.** A faithful hairline grays out under 28px; the honest product answer
   is display-first framing plus the stroke-weight knob (user choice, not a forced
   floor).

## Evidence

Weight measurements (sheet 0.038 stroke/rowH; built 0.045→0.040 stroke/em across the
compensation steps; the r3 fidelity judge's own ratio measurements), the u layout dump
(advance 161→408), the six-round corpus lines, and the specimen series in the session
transcript. Verification at ship: unit 159, corpus 31/31, e2e 54/54, fontTools
checkChecksums=2 on both field faces, astro build clean.
