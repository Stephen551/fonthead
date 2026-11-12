# 0079 — Quantize coordinates before CFF export on all builds

Status: Accepted (supersedes the build-mode scoping in ADR 0069)

## Context

`opentype.js` serializes CFF Type 2 charstrings as integer relative deltas from point to point, rounding each step independently. When the font builder receives two-decimal coordinates, small per-step rounding errors accumulate along contours and can shift endpoints by several font units.

ADR 0069 enabled integer coordinate rounding before CFF serialization (`quantizeX`, `quantizeY`), but scoped `quantizeX` to fitted upright builds (`uprightSpacing || exactSpacing`) and `quantizeY` to non-connected, baseline-aligned builds (`!opts.connect && opts.autoBaseline !== false`). Connected cursive and flourish-trimmed script builds skipped rounding, leaving joins and long curves exposed to CFF delta drift.

## Decision

Send `quantizeX: true` and `quantizeY: true` on every font build payload in `src/lib/maker.ts` (including seam probe builds). Because `makeOtGlyph` already rounds advance widths with `Math.round(cellW * scale)` and kerning tables round values with `Math.round`, rounding transformed outline X and Y coordinates with `Math.round` keeps entry points (`x = 0`), exit points (`x = cellW`), join heights, and advance widths aligned at identical integer coordinates.

This supersedes the build-mode scoping of `quantizeX` and `quantizeY` in ADR 0069. Source tracing, spacing, scaling, and kerning rules are unchanged.

## Consequences

- Every CFF/OTF export receives and serializes exact whole-integer coordinates with zero accumulated relative-delta drift across connected cursive, flourish-trimmed script, upright, and variation builds.
- `exactSpacing` tracking in `buildFont` is no longer needed solely to toggle `quantizeX`.

## Evidence

- `test/cff-quantize.test.ts`: verifies connected cursive (`connect: true`) and flourish-trimmed (`trimFlourishes: true`) builds over 60-segment fractional cubic contours emit whole-integer coordinates matching the builder's pre-serialization points with zero drift.
- `npx playwright test e2e/variation.spec.ts e2e/seam.spec.ts`: all 5 seam and variation gate tests (ADR 0047) pass without regression.
- Full unit suite (`npm test`), full E2E suite (`npm run test:e2e`), and corpus gate (`npm run test:corpus`) run against the branch.
