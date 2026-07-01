# ADR 0042 — Phase 1 connection-height normalization is a prerequisite, not the fix; thin-hand joins banked at ~B pending the placement rework

**Status:** Accepted (thin-hand joins banked at ~B)
**Date:** 2026-07-01
**Refines:** ADR 0041 / the connection-point spec (`docs/superpowers/specs/2026-07-01-connection-point-spec.md`)
**Builds on:** ADR 0038 (the connector-height snap this extends)

## Context

The connection-point spec (ADR 0041) scoped Phase 1 — normalize every glyph's entry and
exit terminal to one join height — as the lowest-risk first step and "likely the biggest
single win" for the `connected-cursive-handmade` field failure (a/d and a/n read as
gapped, d/m jams). Phase 1 was prototyped and measured before committing to it.

## Decision

Phase 1-height is a PREREQUISITE, not the fix. Two measured results:

1. **The variance gate works as a discriminator.** The ADR 0038 snap skips `handmade`
   because its median exit-vs-entry mismatch (0.192) is a hair under the 0.2 gate — yet
   its terminals scatter (entry-height sd 0.171). Firing the snap also on high
   terminal-height variance (`SNAP_VAR_GATE ~0.12`) engages the scattered hands and
   spares the consistent ones. Calibration across the 11 connect faces (entry-height sd):
   FIRE `handmade` 0.171 / `cc-5` 0.167 / `cc-7` 0.16; SKIP (byte-stable) `flashy` 0.073 /
   `cc-2` 0.07 / `cc-3` 0.053.
2. **But firing it changes nothing the eye reads.** `handmade`'s connectors ALREADY meet
   — every join-band `connGap` is negative (Ha −18, an −7, nd −17, dm −13, ma −18, ad −35,
   de −14). The variance-gated snap fired (snapped 20 of 52) and only made them overlap
   slightly more; the render was byte-for-eye unchanged. What the eye reads as "a and d
   don't touch" is the **dense-body** daylight — the bodies sit a connector-width apart
   and a thin stroke bridges them.

So terminal height was never the defect; the defect is per-pair BODY SPACING, and the
only lever that moves it is the placement itself (Phase 3, structural overlap). Height
normalization is required so Phase 3's tip-to-tip placement does not gap at mismatched
heights (the reason tip-to-tip was abandoned once, ADR history) — but it is a no-op on
its own, and firing it moves 3 faces for no visible gain, so the prototype was reverted.

Given `handmade` renders acceptably at ~B and Phase 3 is a major, risky rework that
re-attempts the abandoned tip-to-tip model, BANK thin-hand join evenness at ~B and defer
Phase 3 to a focused milestone (the updated spec).

## Alternatives rejected

- **Ship Phase 1 alone.** A no-op on the render with a 3-face blast radius. Rejected.
- **Tighten `connectGapPx` uniformly** (bring all bodies closer). Does not even the
  per-pair spacing variance that is the actual defect; risks welding. Rejected.
- **The dense-body connect-kern** (ADR 0041) — parked; kerning connecting pairs is the
  wrong lever.

## Consequences

Thin/inconsistent hands stay ~B on join evenness. The variance gate (`SNAP_VAR_GATE`
~0.12) and its calibration are recorded (here and in the spec) as the Phase 3
prerequisite, not shipped. The engine builds the common and clean hands at A; the
copperplate stays byte-stable. The spec is revised: Phase 1 = prerequisite, Phase 3 =
the fix, ship them together.

## Evidence

The `connGap` all-negative measurement and the unchanged render (`test-results` A/B, not
committed); the 11-face variance calibration above; ADR 0038 (`snapConnectorHeights` /
`warpTailY`, the snap extended); ADR 0041 (the dense-body kern parked, same root: the
defect is body spacing); the dense-body probe + `connected-cursive-handmade` fixture kept
in `e2e-corpus/corpus.spec.ts`.
