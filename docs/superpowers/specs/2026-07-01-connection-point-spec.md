# Spec — Connection-point placement for connected cursive

**Status:** Scoped, not started
**Date:** 2026-07-01
**Supersedes the approach in:** ADR 0040, ADR 0041 (the per-pair connect-kern path)
**Builds on:** ADR 0030–0035 (connect model), ADR 0037 (baseline hardening), ADR 0038 (connector-height snap)

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

## Phasing (each phase gated + corpus-verified before the next)

- **Phase 1 — connection-height normalization (height only).** Extend the ADR 0038
  snap to normalize BOTH entry and exit terminals to a single connection height (not
  just lower high exits). Lowest-risk, and likely the biggest single win: handmade's
  connectors ride at different heights, so meeting them on one line should make them
  touch consistently. Verify on handmade + the full connect corpus.
- **Phase 2 — connection angle.** Only if height-alone leaves visible seams: normalize
  the approach angle so terminals meet tangentially, not just at the same height.
- **Phase 3 — structural-overlap placement.** Move connecting-pair placement from the
  dense-body edge to tip-to-tip-on-the-normalized-terminals with a deep-bridge overlap;
  drop the connect-kern on connecting pairs. Higher risk (reworks the core placement),
  so only if Phases 1–2 do not get there.
- **Phase 4 — kern scope.** Restrict the connect GPOS kern to non-connecting
  transitions.

Phases 1–2 may be sufficient. Stop at the first phase that clears the bar.

## Success criteria (verifiable without reading code)

- **Connection band:** `connGap` (the low connector-zone measure) reads ~0 across the
  join pairs on handmade — connectors coincide, no daylight, no jam.
- **Render eyeball:** the `test-results/corpus-contact.png` contact sheet shows
  handmade's joins even; `a`/`d` and `a`/`n` touch, `d`/`m` no longer jams.
- **Dense-body probe (kept guardrail):** handmade's dense-body relative spread drops
  from 0.60 toward the clean-face range (0.24–0.31).
- **Byte-stability:** the good hands (copperplate, cc-2/3) stay byte-identical (the
  normalization is self-gated so a hand already on one line is untouched).
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
