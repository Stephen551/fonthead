# 0080 — Fold detached accent bands in preview row checks and normalize armed charsets

Status: Accepted

## Context

On `e2e/fixtures/extended-latin-sheet.png` paired with the 7-row `LEGACY_ACCENT_ROWS` charset, `detectGeometry` returns 8 bands: `[55,86] [87,211] [262,415] [469,598] [706,832] [913,1036] [1121,1251] [1329,1458]`. The first band `[55,86]` is row 1's 31px floating accent marks sitting 1px above `[87,211]`. The sliver filter in ADR 0059 leaves it separate because on the 123px typical row the 25% cutoff is 30.75px. `traceSheet` already folds `[55,86]` into `[87,211]` via `mergeAccentBands` (ADRs 0071 and 0074) and builds all 7 rows accurately, but commit `2a5c220` passed the raw `sheet.geom.rows.length` (`8`) into `mappingProblems`, causing the preview alert `Your sheet has 8 detected rows, but the mapping has 7.`

## Decision

Add `sheetRowCount(bands, lines)` in `src/lib/maker-checks.ts`, delegating to `mergeAccentBands(bands, lines.map(l => l.normalize('NFC'))).length`. In `src/components/Maker.tsx`, pass `sheetRowCount` from `mappingErrors` against live `parseCharset(charsetText)` and from `onFile`'s early-return `setDetectedRows` against `charLines`. Leave `detectGeometry`, the overlay drawing, and `traceSheet` unchanged.

### Armed charsets are NFC

Commit `2a5c220`'s early return in `onFile` checked the raw `readArmedCharset()` strings before `parseCharset` ran. When `localStorage` held a decomposed (NFD) charset, `mappingProblems` saw repeated combining marks across rows, set `phase` to `idle`, and skipped `run()` with no visible alert (because render-side `mappingErrors` ran on `parseCharset(charsetText)`, which normalizes to NFC). `parseArmedCharset` in `src/lib/maker-checks.ts` now normalizes stored strings to NFC inside `readArmedCharset` for both base and supplement keys, matching `parseCharset` and `validateCharset` while leaving ASCII unchanged.

## Alternatives rejected

- Loosening `SLIVER_FRAC` in ADR 0059: detached accent bands are a charset-ownership question (ADRs 0071 and 0074), not a sliver-fragmentation question, and raising the sliver cutoff risks merging cursive and light-ink rows.
- Running `mergeAccentBands` inside `detectGeometry`: `detectGeometry` runs before a charset is settled and drives `guessCharsetFromRows` and the raw cut preview.

## Consequences

Accented sheets count rows after folding expected detached accent bands and update live as the charset text is edited. Plain ASCII charsets retain the exact raw band count because `mergeAccentBands` returns `bands` unchanged when there are no accented characters or excess bands.

## Evidence

- Raw bands `[55,86] [87,211] [262,415] [469,598] [706,832] [913,1036] [1121,1251] [1329,1458]` reproduced across commits back to `74c0b0f`; row-count gate introduced in `2a5c220`.
- Covered by `test/maker-checks.test.ts` and `e2e/accents.spec.ts`.
