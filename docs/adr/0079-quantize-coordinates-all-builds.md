# 0079 — Quantize coordinates before CFF export on non-connect builds

Status: Accepted (supersedes the non-connect build-mode scoping in ADR 0069)

## Context

`opentype.js` serializes CFF Type 2 charstrings as integer relative deltas from point to point, rounding each step independently. When the font builder receives two-decimal coordinates, small per-step rounding errors accumulate along contours and can shift endpoints by several font units.

ADR 0069 enabled integer coordinate rounding before CFF serialization (`quantizeX`, `quantizeY`), but scoped `quantizeX` to fitted upright builds (`uprightSpacing || exactSpacing`) and `quantizeY` to non-connected, baseline-aligned builds (`!opts.connect && opts.autoBaseline !== false`). Flourish-trimmed script, variation, and plain builds skipped horizontal (and some vertical) rounding, leaving long curves exposed to CFF delta drift.

## Decision

Send `quantizeX: !opts.connect` and `quantizeY: !opts.connect` on the main build payload in `src/lib/maker.ts`, and `quantizeX: false`, `quantizeY: false` on the connected-cursive `probePayload`. Upright, flourish-trimmed script, variation, and plain builds round transformed X and Y coordinates with `Math.round` before CFF serialization, keeping outline endpoints, join heights, and `Math.round`-ed advance widths and kerning tables aligned. Connected cursive builds keep ADR 0069's original unrounded behavior.

### Connected cursive

Enabling coordinate rounding on connected cursive builds (`2e4508f`) broke the `connected-cursive-nano-v3` corpus gate (join-gap median moved from `49` to `68`, limit `60`). Kerning did not change: `GPOS` was byte-identical (`0` pairs changed kern value) because `analyzeConnectKern` runs on the input glyphs before `makeOtGlyph` rounds them. Instead, removing CFF delta drift shifted connect outlines by up to ~8 font units and caused the corpus strip band measure (`stripY0 = 0.15 * xh`) to jump on `in` (`-48` to `80`) and `ic` (`-224` to `-92`). Two other connected fixtures also moved near their limits without failing: `connected-cursive-2` (`structural` `31` to `90`, limit `95`) and `connected-cursive-light` (`joinGap` median `-12` to `-56`). Rounding for connect builds is deferred until the connect gates are recalibrated.

This supersedes the build-mode scoping of `quantizeX` and `quantizeY` in ADR 0069 for non-connect builds. Source tracing, spacing, scaling, and kerning rules are unchanged.

## Consequences

- Every non-connect CFF/OTF export (upright, flourish-trimmed script, variation, and plain builds) receives and serializes exact whole-integer coordinates with zero accumulated relative-delta drift.
- Connected cursive builds remain unrounded (`quantizeX: false`, `quantizeY: false`), preserving `master` (`07a060b`) outlines and corpus metrics.
- `exactSpacing` tracking in `buildFont` is not needed to toggle `quantizeX`.

## Evidence

- `test/cff-quantize.test.ts`: verifies connected cursive (`connect: true`) builds send `quantizeX: false` and `quantizeY: false` (unrounded input coordinates preserved), while flourish-trimmed (`trimFlourishes: true`) builds over 60-segment fractional cubic contours emit whole-integer coordinates matching the builder's pre-serialization points with zero drift.
- `npm test`: `52` test files / `425` tests passed.
- `npm run test:e2e`: `99` passed, `1` skipped (`admin-analytics.spec.ts`); `e2e/accents.spec.ts` failed (known failure on `master` `07a060b`); `e2e/tight-accents.spec.ts` timed out waiting for build start at 150s in the full run and passed in `40.1s` on isolated rerun.
- `npm run test:corpus`: `44/44` passed; all `15` connected-cursive fixtures match `master` `07a060b` on `joinGap` median and `structural` depth, and `serif-georgia` spot check matches `master` `07a060b` on all `74` shared glyphs while non-connect `script-segoe` receives integer X quantization.
- `npx astro check --minimumSeverity warning`: `221` files, `0` errors, `0` warnings.
