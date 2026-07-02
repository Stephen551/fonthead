# ADR 0047 — The variation build joins classic: the mode boundary was the whole defect

**Status:** Accepted (regression gates committed, deploy gated with ADR 0046's fix)
**Date:** 2026-07-02
**Builds on:** ADR 0046 (the mode boundary), ADR 0036 (natural variation)

## Context

ADR 0046 recorded the 3-sheet variation build of the Nano Banana hand joining
visibly worse than the single-sheet build, with the hypothesis "variant
registration misfits this hand class," and put the variation-join milestone at
the head of the queue. This ADR closes that milestone.

## Investigation

Systematic root-cause work, all four builds (three solos + the merged palette)
rebuilt through the real maker and measured with fontkit:

1. **The registration hypothesis is refuted by measurement.** Across the
   palette's 186 variant glyphs, the entry-tip offset against the base is
   median 0.002·xh (sd 0.039) and the exit-overhang offset median 0.000
   (sd 0.025); every variant advance matches its base exactly. The only large
   offsets live on break-class glyphs (ampersand, eight, B at 0.10–0.25·xh),
   which never join — invisible inside their padded advances. Body-only
   registration is not the defect.

2. **The defect reproduces under the pre-fix boundary, and only there.** With
   `NORM_SWEEP_EXEMPT` restored to 0.6, the merged palette re-enters the
   BRIDGED path (`entryNorm: true`) and the recorded render reappears exactly:
   "Handmad e", "d eed", "sl eeves", gapped "dadada" — shaped-run seams show
   +24..+46 units of daylight on d>a / d>e / l>e. At 0.5 (ADR 0046's fix,
   commit 192f20b) the same palette builds CLASSIC and the worst seam in the
   same words is −12 units (ink overlapping). The variation build was the
   floating-e defect wearing more letters: half of "Handmade"'s lowercase are
   calt variants, so the bridged flick-over-entry seams multiplied.

3. **Why the palette followed the boundary:** the entry-reach gate skips
   variant glyphs (they inherit base metrics), so a merged build's mode is
   measured on the BASE sheet alone. The base sheet's median entry reach
   (0.593) sat under the old 0.6 exemption — bridged; over the new 0.5 —
   classic. The palette therefore rides whichever side its base sheet is on,
   which is the intended design once the boundary sits clear of the hand.

## Decision

No engine change. The fix is ADR 0046's widened exemption; this milestone
ships as regression protection so the boundary can never silently slice a
palette again:

- **Corpus fixtures:** the two remaining nano sheets lock in as
  `connected-cursive-nano-v2.png` / `-v3.png` (entry medians 0.574 / 0.593 —
  the two sheets that built bridged pre-fix). Each now solo-builds through the
  full corpus gates on every run.
- **Palette e2e** (`e2e/variation.spec.ts`): the three-sheet nano build must
  merge (variants=2), stay CLASSIC (`entryNorm: false`), validate, and pass a
  shaped-run seam gate — no horizontal daylight between adjacent glyphs inside
  "Handmade / deed / sleeves / dadada / minimum" (≤5 units; the pre-fix build
  fails 6 seams at up to +46). The gate reads the run with calt+kern the way a
  reader does and asserts the variant glyphs actually cycled in.
- **Unit test** (`test/maker-connect.test.ts`): variant glyphs stay out of the
  entry-reach gate (scattered variant tails cannot flip the palette's mode)
  and inherit the base advance.

## Also recorded

- The merged palette renders ~7% smaller than the solo build of the same hand
  (one face scale across three sheets — the palette's tallest ascender sets
  the em). Cosmetic, inherent to merging, unjudged; noted for a future look.
- One-shot multi-file loads arrive name-sorted from the picker in practice;
  the maker takes the first file as the base sheet. All three nano sheets
  clear the 0.5 exemption solo, so load order no longer selects the mode.

## Evidence

The A/B renders (pre-fix bridged vs HEAD classic), the variant-delta and
seam-geometry fontkit dumps, and the gate red/green validation are in the
session transcript. Verification at commit: unit 160, variation e2e 3/3,
corpus 34/34 with the two new fixtures.
