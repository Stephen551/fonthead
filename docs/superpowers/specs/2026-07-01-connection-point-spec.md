# Spec — Connection-point placement for connected cursive

**Status:** SHIPPED (2026-07-01, ADR 0044). The Phase 3 route (ADR 0043: gated eye-body
placement + kern deference) is live with its protection layer: the exit-overhang cap
(ARM_LAP_FRAC 0.12·xh, scan to 1.25·xh, f/t excluded) replaces the row-min weld on firing
faces, and the corpus judges bridged fusion above the connect band (0.45·xh up). Shipped
numbers: `handmade` rendered dense-body sd 69→32 (med 115→68), `light` 65→27, `cc-4`
94→42; skip faces byte-stable; corpus 31/31, unit 158, e2e 54, fontTools strict. The
tip-to-tip-on-normalized-terminals mechanism below stayed superseded; no Phase 1 height
normalization and no assembled-glyph feedback loop were needed.
**Date:** 2026-07-01
**Supersedes the approach in:** ADR 0040, ADR 0041 (the per-pair connect-kern path)
**Builds on:** ADR 0030–0035 (connect model), ADR 0037 (baseline hardening), ADR 0038 (connector-height snap)
**Refined by:** ADR 0042 (Phase 1-height verified insufficient alone), ADR 0043 (the proven mechanism + the open crux)

## Why

Connected-cursive joins on thin or inconsistent hands render unevenly: some pairs
touch, some gap, some jam (`connected-cursive-handmade`: `a`/`d` and `a`/`n` gap,
`d`/`m` jams). Two arcs (ADR 0040 contextual kern; ADR 0041 dense-body kern) tried to
fix this by KERNING the connecting pairs even. Both hit the same wall.

Professional practice (research on file) says why: **in a connected script, even
rhythm comes from consistent connector PLACEMENT, not from kerning connecting pairs.**
Every serious script face defines one *connection point* — a fixed join height and
angle — and normalizes every glyph's entry and exit terminal to meet it, then makes
the join by structural overlap (deep bridge, coincident points). Kerning is reserved
for the transitions that do NOT connect (after a cap, after a no-exit letter).

Our engine took a detour here. `connectGlyphs` abandoned tip-to-tip placement because
"matching tip-to-tip leaves the seam gapping whenever the two strokes ride at
different heights" and moved to a dense-body-edge model. The professional answer to
that exact problem is the step we skipped: **normalize the terminals to one height
first**, then tip-to-tip meets by construction. ADR 0038's connector-height snap is a
one-sided partial version (it lowers abnormally-high exits only).

## Goal

Make connected joins meet consistently by construction, so the rendered rhythm is
even without a per-pair kern on connecting pairs. Target the `connected-cursive-handmade`
defects at their source (connectors meeting inconsistently), and keep the good hands
(copperplate, `connected-cursive-2/3`) byte-stable.

## The model

1. **Connection line.** Derive one connection height `h` (above the baseline) and one
   approach angle `θ` for the face, from the hand's own median entry/exit geometry
   (ADR 0037/0038 already compute median entry and exit heights). A well-behaved hand
   whose terminals already sit on one line yields ~its current geometry (self-gated,
   byte-stable).
2. **Terminal normalization.** Warp each glyph's entry terminal endpoint and exit
   terminal endpoint onto the connection line at angle `θ`, WITHOUT distorting the
   body or a legitimate swash. This generalizes ADR 0038's `warpTailY` from "lower a
   high exit" to "move both terminals to the shared connection point," two-sided and
   angle-aware. Gate exactly like 0037/0038 so a hand whose terminals already meet is
   untouched.
3. **Structural-overlap placement.** Place so the exit endpoint of L coincides with
   the entry endpoint of R (tip-to-tip) with a small deep-bridge overlap, relying on
   nonzero-winding fill to merge the strokes into one seamless join. This replaces the
   dense-body-edge advance for connecting pairs.
4. **Kern only non-connecting transitions.** Keep GPOS kern for pairs that do not
   connect (cap→lower, no-exit→lower, descender-loop clearance). Drop the
   even-every-pair connect-kern on connecting pairs (it is the wrong lever — ADR 0041).

## Phase 1 finding (2026-07-01, ADR 0042) — height normalization is a prerequisite, not the fix

Phase 1 was prototyped and measured against `handmade`. Two results:

1. **The variance gate works as a discriminator.** The ADR 0038 snap skips `handmade`
   because its median exit-vs-entry mismatch (0.192) is a hair under the 0.2 gate — yet
   its terminals SCATTER (entry-height sd 0.171). Gating the snap to also fire on high
   terminal-height variance (`SNAP_VAR_GATE ~0.12`) engages the scattered hands and
   spares the consistent ones. Calibration across the 11 connect faces (entry-height sd):
   FIRE — `handmade` 0.171, `cc-5` 0.167, `cc-7` 0.16; SKIP (byte-stable) — `flashy`
   0.073, `cc-2` 0.07, `cc-3` 0.053. Clean separation.
2. **But firing it does nothing the eye reads.** `handmade`'s connectors ALREADY meet —
   every join-band `connGap` is negative (the thin strokes cross in the band). Snapping
   them onto one line (snapped 20 of 52) only made them overlap slightly more; the render
   was unchanged. What the eye reads as "a and d don't touch" is the **dense-body**
   daylight — the bodies sit a connector-width apart and a thin stroke bridges them.

So terminal height was never the defect. Height normalization is a PREREQUISITE for
tip-to-tip placement (which needs coincident terminal heights to not gap), not a
standalone fix. The defect is per-pair BODY SPACING, and the only lever that moves it is
the placement itself (Phase 3). The variance gate is a working prerequisite mechanism,
recorded here; it was reverted from the tree because it is a no-op (and a 3-face blast
radius) on its own.

## The proven route (2026-07-01, ADR 0043 — supersedes the phasing below)

The route was prototyped end to end and measured. The defect decomposes per-glyph, not
per-pair: daylight = connector gap + the right letter's entry reach, plus the exit-side
divergence between the thin-trim placement body and the body the eye reads. The fix:

1. **Gate** on entry-reach scatter (sd > 0.19·xh over the left-joiners), with a
   long-sweep exemption (median reach > 0.6·xh keeps `flashy` and `cc-2` untouched).
   Fires `handmade`/`light`/`cc-4`; every other face byte-stable. Calibration in ADR 0043.
2. **Eye-body placement** on firing faces: both advance edges and the anchor from the
   dense columns (ink count > 0.45·xh, full cell resolution). Placement rhythm sd 73→26.
   No Phase 1 height normalization needed — bodies and bridges carry the join.
3. **Kern deference** on firing faces: drop the per-pair rhythm evening AND the lowercase
   collision/body floors (they read the deliberate bridge as a crash: 27/29 joins shoved
   apart, +18..+232 units); keep descender clearance, cap floors, word-space evening.
   Rendered sd 69→26 (`handmade`), 65→46 (`light`), 94→70 (`cc-4`).
4. **THE OPEN CRUX — bridge-vs-weld protection.** With the floors deferred and the
   HIGH_EXIT-left weld exempted, real welds crash through (structural 269 `rl` / 298 /
   207 — the ADR 0040 dead-end-5 signature). The milestone is a placement-aware guard
   that tells a thin deliberate bridge from a body weld. Candidates in ADR 0043
   (strip-row counting, a bridge-depth budget from the placement's own geometry, a local
   assembled-raster seam check). Also re-derive the corpus rhythmSd/wordSpace gates for
   bridged faces — a bridged placement legitimately shifts both.

## Phasing (superseded by the proven route above; kept for history)

- **Phase 1 — connection-height normalization (PREREQUISITE).** Normalize both terminals
  to one connection height, gated on the terminal-height VARIANCE (see the finding) so a
  scattered hand engages and a consistent one is byte-stable. This does not fix anything
  alone; it makes Phase 3's tip-to-tip placement hold without the height-gap that made us
  abandon tip-to-tip once (ADR history: the connection-POINT band model → body-edge model).
  Ship it WITH Phase 3, not before.
- **Phase 2 — connection angle.** Only if coincident height still leaves a visible kink:
  normalize the approach angle so terminals meet tangentially.
- **Phase 3 — structural-overlap placement (THE FIX).** Replace the dense-body-edge
  advance for connecting pairs with tip-to-tip placement on the normalized terminals plus
  a deep-bridge overlap (bodies overlap IN the connector, per professional practice), so
  body spacing is even by construction. This is the change that moves what the eye reads,
  and it re-attempts the tip-to-tip model we abandoned — so it must be verified hard
  against that failure mode (tips gapping at mismatched heights, which Phase 1 now prevents)
  AND the ADR 0038 flattening risk. Highest risk; a focused milestone of its own.
- **Phase 4 — kern scope.** Restrict the connect GPOS kern to non-connecting transitions
  (cap→lower, no-exit→lower, descender clearance); drop it on connecting pairs.

Do NOT ship Phase 1 alone — it is a no-op that moves 3 faces for no visible gain. The
milestone clears the bar only when Phase 3 lands.

## Success criteria (verifiable without reading code)

The measure is BODY SPACING, not the connection band. The Phase 1 finding showed
`handmade`'s `connGap` is already negative (connectors meet), so "connectors coincide"
is not the target — even body rhythm is.

- **Dense-body probe (the primary metric):** `handmade`'s dense-body relative spread
  drops from 0.60 toward the clean-face range (0.24–0.31). Run `CORPUS_KERN_PROBE=1 npm
  run test:corpus` and read `denseBody sdKern` / `med`.
- **Render eyeball:** the `test-results/corpus-contact.png` contact sheet shows
  `handmade`'s joins even; `a`/`d` and `a`/`n` touch, `d`/`m` no longer jams.
- **Byte-stability:** the low-variance faces (`cc-2`, `cc-3`, `flashy`) stay
  byte-identical (Phase 1's variance gate skips them; Phase 3 must self-gate the same
  way). The high-variance faces (`cc-5`, `cc-7`) move WITH `handmade` — they must
  improve or hold, never regress, on the corpus gates and the contact sheet.
- Corpus, unit, e2e, and fontTools all green.

## Explicitly NOT in scope

- **Flashy / deep flourished overlap** stays parked (ADR 0040). Professionals do not
  automate deep decorative overlap — restrained forms default, flamboyant forms are
  user opt-in (two-tier alternates). If pursued later, it is a two-tier-alternate
  milestone, not this one.
- **The dense-body kern** (ADR 0041) — parked; do not revive as a per-pair connecting
  kern.
- **`curs` (GPOS cursive attachment)** — stay baked. Unreliable outside Arabic-aware
  shapers; unnecessary for baseline-joining Latin (ADR 0041 evidence).

## Risks

- **Flattening the hand.** Over-warping terminals kills character (the ADR 0038 swash
  lesson). Warp only the terminal endpoint region; preserve body + swash; self-gate.
- **Byte-stability.** A placement change touches every connect face; the self-gate must
  make an already-on-one-line hand a no-op, or the corpus/e2e move and shipped fonts
  change.
- **Angle is harder than height.** Height-only (Phase 1) may suffice; treat angle as
  contingent, not assumed.
- **Structural overlap depth** (Phase 3) reworks the advance model; only enter it if
  the lighter phases do not clear the bar.

## References

Professional-practice research (on file). ADR 0038 (`snapConnectorHeights`,
`warpTailY`), ADR 0041 (why the kern is the wrong lever), the dense-body probe +
`connected-cursive-handmade` fixture in `e2e-corpus/corpus.spec.ts`.
