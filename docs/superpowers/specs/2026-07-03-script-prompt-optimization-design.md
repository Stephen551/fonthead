# Script prompt optimization — measured eval loop

Date: 2026-07-03
Status: approved (Stephen, in session; API key provided for the generation loop)

## Goal

Rewrite the `SCRIPT` generation prompt in `src/pages/make.astro` (the copy-out prompt
users paste into an image model to produce the 3-version cursive palette sheets) so the
sheets it produces are the best possible input for the maker engine, and prove the
improvement by building real generations through the engine and measuring, not by taste.

## Why now

The connector-reconstruction milestone (ADR 0049-0052) closed with a known polish
ceiling (ADR 0045): input resolution, the hand's own letterforms, crossing-knot pools,
small-size weight. Two of those four live upstream of the engine, in the sheet itself.
The engine's gates now describe precisely what a perfect script sheet looks like; the
prompt should ask the image model for exactly that.

## Scope

- In: the `SCRIPT` template string (and, if measurement justifies it, the sheet layout
  it requests, since GPT Image tops out at 1536px and the current copy asks for an
  impossible 4096px; 7 rows at 1536 gives ~150px row height, under the engine's 200px
  fidelity threshold).
- Out: the other four presets, engine code, charset mapping changes unless a layout
  change forces them (round-two lever only), deploy (Stephen's gate).

## Method

Scratchpad harness, same pattern as the seam-milestone stage-f/probe harnesses:

1. `gen.mjs` — GPT Image API (gpt-image-1, 1536px, high quality), N calls per prompt
   revision, PNGs + run manifest. The shipped prompt asks one conversation for three
   version sheets; the API returns one image per call, so the eval generates
   per-version single sheets with identical rules text (a faithful proxy for how the
   model follows the rules, which is what is being tuned).
2. `sheetcheck.mjs` — static node-side checks before the engine sees the sheet:
   gray/shadow ink histogram, row count, per-row connected-component count vs the
   expected counts (catches stray labels and fused pairs cheaply), stroke width vs
   row height against the 0.05 floor, effective row height vs the 200px threshold.
3. `measure.mjs` — Playwright against the local build, driving the maker the way
   e2e-corpus/corpus.spec.ts does (explicit connect mode, `fh-test-no-autoconnect`,
   `fh-test-seam-alts`), reading the banked sensors: structural fusion, fullJoin /
   joinGap, entry-height sd + median reach, denseBody probe, seam-sensor
   gap/cross/pool, weld probe, plus a contact-sheet render per sheet.

## Rounds

- Round 0 (baseline): current prompt verbatim minus the three-versions wrapper, 4-6
  generations. Measurements name the defect list; nothing in the rewrite is
  speculative.
- Rewrite: target the measured defects using the ADR 0037-0052 gate knowledge —
  entries/exits confined to the low connect band at one consistent height (the
  0.12·xh variance gate), short entry reach (under the long-sweep exemption), no high
  exit flicks outside the natural HIGH_EXIT class (each one is a seam knot), one
  uniform stroke comfortably above the 0.05·rowH floor, flat black with zero shadow,
  steady baseline and x-height, wide separation, canvas-filling layout in place of
  the impossible 4096px ask.
- Iterate: regenerate, remeasure, compare per metric class against baseline.

## Acceptance

- The revised prompt beats or ties baseline on every measured class, no new failure
  class, contact sheets pass the eyeball.
- Stephen approves the final prompt copy before it lands (copy gate).
- Ship: edit the template in make.astro only, `npm test`, clean `npx astro build`,
  single-logical-change commit. Deploy is a separate call.

## Cost

~20-30 GPT Image generations, roughly $3-8. Key provided in session, stored in the
scratchpad only, flagged for rotation afterward.
