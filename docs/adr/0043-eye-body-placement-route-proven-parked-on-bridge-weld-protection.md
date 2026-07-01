# ADR 0043 — Eye-body placement normalization proves the Phase 3 route (rendered rhythm sd 69→26); parked on bridge-vs-weld protection

**Status:** Accepted (route proven, prototype reverted, diagnostics kept)
**Date:** 2026-07-01
**Refines:** ADR 0042 / the connection-point spec (`docs/superpowers/specs/2026-07-01-connection-point-spec.md`)
**Builds on:** ADR 0040 (the discrimination problem this re-locates), ADR 0041 (the dense-body probe used as the metric)

## Context

ADR 0042 banked thin-hand joins at ~B and deferred the Phase 3 placement rework. This
session route-found that milestone empirically: diagnose the defect from the probe data,
prototype the smallest placement change that attacks it, and measure each layer's
reaction. Six corpus runs, every step gated and compared against the same baseline.

## Findings

1. **The daylight identity.** Under the shipped body-edge model, per-pair dense-body
   daylight = the connector gap + the RIGHT letter's entry-tail reach (the left anchor
   cancels; the left letter's exit tail overhangs the advance and contributes nothing).
   Confirmed by variance decomposition of the baseline probe: on `handmade`, conditioning
   on the right letter halves the spread (overall sd 73 → within-same-R 35) while the
   left letter explains almost nothing (65). In-face proof: the roundFloat letters
   (o/c/e, already body-anchored) are exactly the tight right-groups (e 31, o 81) while
   the unanchored letters are the loose ones (l 227, r 211).
2. **Faces split into two scatter classes.** `handmade`/`light`/`cc-4` are RIGHT-dominant
   (entry reach). `cc-3`/`cc-5`/`cc-6`/`cc-7`/copperplate/`signature` are LEFT-dominant
   (within-same-L as low as 7 on `cc-6`): their scatter comes from the exit side, where a
   tall exit stroke reads as body to the eye but not to the thin-trim placement body.
   A reach gate, not ADR 0042's height gate, selects the fixable class.
3. **The gate (calibrated, 11 faces, entry-reach sd in xh):** FIRE `handmade` 0.242 /
   `cc-4` 0.270 / `light` 0.212; SKIP `signature` 0.171 / `cc-3` 0.165 / copperplate
   0.146 / `cc-7` 0.127 / `cc-5` 0.121 / `cc-6` 0.112; gate 0.19. A long-sweep hand is
   exempted by median entry reach > 0.6·xh (the compressConnectorTails gate): `flashy`
   (1.00, the ADR 0040 park) and `cc-2` (0.62). ADR 0042's byte-stable list
   (`cc-2`/`cc-3`/`flashy`) is honored with no special-casing, verified byte-identical
   corpus metrics across all runs.
4. **Entry-only anchoring fails (Stage A).** Body-anchoring every left-joiner on the
   thin-trim placement body collapsed the loose right-groups but was a rendered wash
   (sdKern 69→68): the weld pass converted the r arm's deliberate ride into +240 units of
   advance growth (`re`/`ro`), and the exit-side eye-vs-placement body divergence surfaced
   everywhere else. One-sided normalization in placement-body terms just moves the
   scatter.
5. **Eye-body placement works (Stage B).** Placing BOTH advance edges and the anchor by
   the eye-consistent dense body (columns whose ink pixel count exceeds 0.45·xh — the
   corpus probe's own criterion, computed at full cell resolution from the profiles the
   placement already has), plus exempting HIGH_EXIT-left pairs from the weld pass,
   collapsed `handmade`'s placement rhythm sd 73→26 — the tightest of all 11 connect
   faces. No 60px raster, no in-build feedback loop; the ADR 0041 A2 sensor fragility
   never enters.
6. **The connect-kern re-fights, layer by layer (measured).** With evening active the
   render re-scatters (sdKern 79 over a 26 placement). With evening off (floors only) the
   protective floors still shove 27/29 joins apart (+18..+232 units; sdKern 63) — their
   silhouette min reads the deliberate bridge as a collision. With the lowercase
   collision/body floors also off, the render finally follows the placement: **sdKern
   69→26 (`handmade`), 65→46 (`light`), 94→70 (`cc-4`)** — but three real welds crash
   through: structural 269 (`rl`), 298 (`rb` on `cc-4`), 207 (`rb` on `light`), the ADR
   0040 dead-end-5 signature. Both guards (the HIGH_EXIT-left weld exemption AND the
   floor removal) were off for those pairs; each was load-bearing for a different class.

## Decision

The Phase 3 route is PROVEN and CONCRETIZED: gated eye-body placement + kern deference
delivers rendered dense-body rhythm sd 26 on the field-failure hand (vs 69 shipped), with
the clean faces byte-stable by the gate. It is PARKED at one remaining problem: a
placement-aware protection layer that tells a deliberate thin bridge from a body weld.
The floors/weld cannot (their scanline min is the bridge, by design), and removing them
lets real arm-into-stem welds through. That discrimination is ADR 0040's assembled-glyph
problem in its minimal, tractable form — the geometry is now known at placement time.

Candidate discriminators for the milestone (recorded, none validated):
- **Strip-row counting:** a thin bridge penetrates deeply on few x-height strip rows
  (stroke thickness); a body weld on many. Computable in the existing weld loop.
- **Bridge-depth budget from placement:** the placement knows each glyph's eye-body edge
  and connector extent; allow penetration up to the connector's own reach, weld-grow
  beyond it.
- **Assembled-raster seam check:** rasterize only the seam neighborhood of the placed
  pair and measure joined-ink thickness at the crossing (the ADR 0040 feedback pass
  reduced to a local protection check, not a correction loop).

The prototype was fully reverted (placement, weld exemption, engine `bridgedPlacement`
opt). KEPT: the entry-reach diagnostics (`entrySd`/`entryMed` in `__lastConnect` and the
corpus CORPUS line) so the gate calibration stays visible on every run.

## Alternatives rejected

- **Closed-loop raster feedback in the build** (assemble → measure dense-body → correct
  advances). Adversarially reviewed before prototyping: the sensor inherits the ADR 0041
  A2 thin-stem wash cause regardless of lever, and hardening it by dilation reproduces
  A1 (connectors counted as body). The analytic eye-body terms proved sufficient for the
  rhythm without it.
- **Relaxing the kern floors without a replacement guard.** Reproduced ADR 0040 dead end
  5 exactly (structural 269/298/207). The floors are wrong for bridged pairs AND
  load-bearing for weld protection; they must be replaced, not removed.
- **Shipping the floors-only middle state** (sdKern 63, 11/11 green). A 3-face blast
  radius for a 69→63 change the eye barely reads — the ADR 0042 bar rejects it.

## Consequences

Thin-hand joins stay banked at ~B (unchanged from ADR 0042). The connection-point spec is
revised: the proven mechanism is eye-body-edge placement, which does NOT need Phase 1
terminal-height normalization (bodies and bridges carry the join; coincident terminal
heights are a tip-to-tip requirement, and tip-to-tip is superseded by this route). The
milestone's crux is now precisely scoped: build and validate the bridge-vs-weld
protection layer, then re-run this configuration; the corpus gates for bridged faces
(rhythmSd, wordSpace) also need re-derivation since a bridged placement legitimately
shifts both. Numbers to beat are recorded here.

## Evidence

Baseline vs per-stage probe comparisons (six corpus runs, 2026-07-01): baseline handmade
denseBody med 115 / sdKern 69 / sdNoKern 73; Stage A sdKern 68 / sdNoKern 86 (weld
re-fight, `re`+250); Stage B sdNoKern 26 / sdKern 79 (evening re-fight); floors-only
sdKern 63 (27/29 pairs floor-shoved, +18..+232); floors-off sdKern 26 / structural 269
(`rl`). Gate calibration in Finding 3. The variance decomposition and per-pair delta
tables are in the session transcript; the probe JSONs regenerate via
`CORPUS_KERN_PROBE=1 npm run test:corpus`.
