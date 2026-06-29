# ADR 0035 — Connect touches no vendored engine file; pure decision core is unit-tested, raster gated by corpus/e2e

**Status:** Accepted · backfilled 2026-06-29 from project history (review and correct if the reconstruction is wrong)
**Date:** 2026-06-28 (plan / spec)

## Context

The vendored font engine is edited only surgically and additively per project policy, and canvas raster runs only under real Chromium, so the deep behavior cannot be unit-tested in jsdom. The connect feature is constrained to the levers the worker already consumes.

## Decision

Confine the connected-cursive feature to NO vendored engine file: the entire control surface is translatePathX + per-glyph cellW + the style name + the features.kerning flag, all already consumed by the worker. Implementation lives in src/lib/maker.ts (connectGlyphs, faceMetrics, joinClass, anchorAdvance, buildFont branch, editMonoRow threading, makeTemplateSheet guide), Maker.tsx, make.astro, and tests. Split the decision/arithmetic core into pure functions (joinClass, anchorAdvance) that unit-test in jsdom; gate the canvas raster and full assembly (connectGlyphs end-to-end) via the corpus harness and e2e in real Chromium plus fontTools for authoritative validity (a connect-mode corpus fixture and a join-gap metric are added). Keep two distinct ascent metrics in faceMetrics — a raster ascent for band geometry only and a bbox ascent for every px-to-UPM conversion — factored as one helper used by both buildFont and connectGlyphs so the realized overlap does not drift.

## Alternatives rejected

Editing the vendored engine was rejected (surgical/additive policy). Using a single ascent value for both band geometry and unit conversion was rejected (mixing them drifts the realized overlap off its intended percent). Unit-testing the raster in jsdom is not possible (Chromium only).

## Consequences

The engine bundle is unchanged; TDD applies to joinClass and anchorAdvance, with connectGlyphs getting only a structural smoke test in jsdom and real validation in the corpus/e2e/fontTools gates. faceMetrics centralizes the two-ascent derivation to prevent divergence; a connect-mode corpus fixture is locked in.

## Evidence

Specs: docs/superpowers/plans/2026-06-28-connected-cursive.md Global Constraints and Architecture ('The decision/arithmetic core is split into pure functions... that unit-test in jsdom; the canvas raster and full assembly are gated by the corpus/e2e suites in real Chromium'); design.md Pass 0 ('Two distinct maxAsc values, kept separate... Factor as a faceMetrics(glyphs) helper... do not duplicate.').
