# Color robustness milestone: corpus + first fixes

Date: 2026-07-06
Status: approved design, pending implementation plan

## Context

The color pipeline (flat COLRv0/CPAL and gradient COLRv1, built main-thread from
`color-orchestrator.js` + `color-core.js` + the vendored `font-engine-color-build.js`
/ `font-engine-colr-cpal.js` / `font-engine-colr-v1.js`) carries a real defensive
layer from the June hardening arc: shadow-aware row detection, bgDist ink masking,
edge-bleed trim, despeckle, stray-island cull with MULTI_PART exemptions, glow
warning, fail-safe table splice, checksum repair plus validateFont gating.

What it does not have is measurement. Mono earned its quality arc through
`npm run test:corpus` (29 faces, calibrated gates, the field-failure playbook:
a broken user sheet becomes a fixture, its failure becomes a metric). Color has
two sample-sheet smoke tests in `e2e/maker.spec.ts` and three row-detection cases
in `e2e/charset.spec.ts`. The algorithmic core of `color-core.js` (detectPalette,
detectShadowMask, separateGlyph, sampleFireGradient, bodyBoundsX) has zero unit
tests. Two defects are already known without a corpus:

1. **Color kerning is inert in browsers.** `applyAutoKern`
   (`font-engine-color-build.js`) routes through `compileFeatures` into a legacy
   `kern` table. Chrome and Firefox position from GPOS only and ignore it; Safari
   over-applies it (the acmeridian.co brand-font bug that got legacy kern turned
   off for mono, ADR 0010). Mono ships GPOS PairPos via `font-engine-gpos.js`,
   whose own header names color as a future phase. Color never got the port.
2. **Failures degrade silently.** A COLR authoring failure console.warns, sets
   `colrStatus: 'error'`, and ships a monochrome font while the UI proceeds as
   if the build succeeded. The woff2 wrap failure path is an empty catch.

## Goal

Give color the same measured footing mono has, then land the first fixes with
the gates watching. Every subsequent color fix, this milestone and after, lands
locked against regression.

## Design

### 1. Fixture generator: `scripts/gen-color-corpus.mjs`

Renders color alphabet sheets into `e2e/fixtures/corpus-color/` (a separate
directory so the mono corpus spec's readdir never sees them). Same technique as
`scripts/gen-corpus.mjs`: Playwright Chromium, canvas-rendered system faces,
committed PNGs, rerun-to-regenerate. The axis of variation is color treatment,
not typeface:

| Fixture | Treatment | Failure class it guards |
|---|---|---|
| `flat-2color` | two flat fills | baseline flat path |
| `flat-3color` | three flat fills | k-means palette merge/split |
| `flat-shadow` | flat fills + canvas shadowOffset drop shadow | shadow strip, row bridging |
| `flat-light` | pale ink (yellow family) | light ink vanishing under luminance assumptions |
| `flat-outline` | strokeText outline + fill | outline/fill layer separation |
| `gradient-basic` | canvas linear gradient fill | baseline gradient path, stop sampling |
| `gradient-shadow` | gradient + drop shadow | shadow vs gradient tip trim interaction |
| `flat-lowres` | small row height (under-resolved) | low-res robustness |

Layout: six rows (A-M / N-Z / a-m / n-z / digits / `.,!?:;'"-&@#`), matching the
color generate presets. Static field-failure PNGs dropped into the directory
survive regeneration, so the mono playbook carries over verbatim: a user's broken
color sheet becomes a fixture, its failure becomes a metric.

### 2. Corpus spec: `e2e-corpus/corpus-color.spec.ts`

Runs under the existing `playwright.corpus.config.ts`, so `npm run test:corpus`
covers mono and color in one command. Each fixture builds through the real engine
(mode chosen by fixture name: `gradient-*` builds gradient, everything else flat).
Gates per face:

- **Validity**: `verifySfntChecksums` passes and the engine `validateFont` accepts
  the OTF. (CI already runs one built font through fontTools; a color OTF joins it.)
- **`colrStatus === 'ok'`** as a hard gate. An authoring failure is a test failure,
  never a silent mono fallback.
- **Rows**: detected row count is exactly 6. Known quirk to watch during
  calibration: a sparse punctuation row (low `. ,` beside tall `! ?`) has split
  into two detected rows on clean synthetic sheets before. If a fixture trips it,
  that is a real robustness finding for fix three, not a reason to widen the gate.
- **Coverage**: built glyph count matches the charset.
- **Palette**: CPAL color count equals the fixture's intended color count (flat).
- **Layer integrity**: every flat base glyph keeps at least one COLR layer; no
  vanished layers.
- **Flag budget**: stray / filled / empty confidence flags are zero on these clean
  synthetic sheets. (Field-failure fixtures may carry a calibrated per-fixture
  budget, the way mono fixtures carry per-face expectations.)

A contact sheet lands at `test-results/corpus-color-contact.png` for the
thirty-second eyeball pass. Chromium canvas renders COLR in color (proven during
the og-card backfill), so the contact sheet shows true color output, not mono
silhouettes.

Gate numbers above are the design intent; exact thresholds get calibrated during
implementation against the actual first run, the same way the mono gates were
calibrated, and the calibration evidence goes in the implementation notes.

### 3. Unit tests on color-core

Vitest coverage for the pure functions in `color-core.js`: `detectPalette` /
`detectBackground` (synthetic pixel buffers: known palettes, border background),
`detectShadowMask` (offset dark copy of a component fires, plain two-color sheet
does not), `separateGlyph` culls (stray island dropped, docked MULTI_PART parts
kept, edge-bleed strip trimmed, real top-heavy glyph untouched), `bodyBoundsX`
(wisp excluded from advance), `sampleFireGradient` (known vertical gradient
yields ordered stops; chroma gate drops a black outline). `color-core.js` is an
IIFE that assigns to `window`, so tests evaluate the file source against a stub
global; no engine restructuring.

### 4. Fix one: GPOS kern for color

`applyAutoKern` in `font-engine-color-build.js` keeps the same analyzer
(`analyzeAutoKern`) but swaps the writer: `buildGposKern` from
`font-engine-gpos.js` instead of `compileFeatures`'s legacy `kern` table. The
GPOS bytes ride the existing `_customTables` + `injectCustomTables` surgery pipe,
which already carries COLR/CPAL. `make.astro` gains a script tag for
`font-engine-gpos.js` if the main thread does not already load it. The legacy
kern path goes away for color, per ADR 0010. Surgical, additive-shaped engine
edit: one writer swap inside an existing function, guarded so a writer failure
degrades to no kerning rather than a failed build. Verified with fontTools that
GPOS PairPos exists and pair values are sane, plus a corpus/e2e assertion.

### 5. Fix two: surface the silent degrades

Our-code changes (maker.ts, Maker.tsx), no engine surgery:

- `colrStatus === 'error'` renders a plain, visible state in the build readout:
  color authoring failed, a monochrome fallback was built, what to try. No more
  proceeding as if the color build succeeded.
- The woff2 wrap catch stops being empty: the readout states the font shipped
  OTF-only and why.
- Exact user-facing copy gets confirmed with Stephen before ship, per house rule.

### 6. Fix three: what the corpus exposes

Run the new gates, triage the failures, fix the top classes with gates locked.
Bounded to surgical engine edits (new opt-in paths, guarded culls, threshold
gates in the established style). Anything structural that surfaces (worker
offload, re-slice loops) gets parked as its own milestone with an ADR note
rather than absorbed here.

## Non-goals (parked, each a candidate later milestone)

- Worker offload for the color build (main-thread freeze on big sheets, ADR 0012).
- Color TTF (COLR on glyf).
- Fine-detail supersampling auto-enable parity with mono (ADR 0045 class).
- Per-row color re-slice / seam refinement loop.
- Color italic and variable axes.
- AI-generated color sheets as fixtures (needs the paid image API; the
  field-failure playbook covers the same ground free).

## Verification (director-runnable, no code reading)

1. `npm run test:corpus` goes green and writes
   `test-results/corpus-color-contact.png`; the contact sheet shows every fixture
   in color with sane spacing.
2. `npm test` green (new color-core unit tests included).
3. One built color OTF passes fontTools `TTFont(path, checkChecksums=2)` and
   shows a GPOS table.
4. Drop a color fixture sheet in /make on local dev: kerned pairs render, and a
   deliberately broken sheet shows the visible failure state instead of a silent
   mono fallback.

## Risks

- **Gate calibration**: synthetic sheets are cleaner than field sheets; gates
  tuned too tight on them could block legitimate engine behavior. Mitigation:
  calibrate on the first real run, keep per-fixture budgets, and lean on the
  contact sheet for judgment calls.
- **GPOS swap regression**: color builds that previously carried a (dead) kern
  table now carry live kerning; spacing changes are intended but must be eyeballed
  on the contact sheet and the two sample sheets.
- **Engine cache**: any `public/assets` edit relies on the content-hash `?v=`
  cache-buster; never hardcode the token (standing rule).

## Calibration record (2026-07-06, Task 7 full run)

First-run measured values per fixture (from the `COLOR-CORPUS |` console lines,
reproduced identically across the Task 4 baseline run and this task's full run,
confirming no drift):

| fixture | mode | glyphs | colrStatus | palette found (intended) | flags |
|---|---|---|---|---|---|
| flat-2color | flat | 73 | ok | 3 (2) | narrow:2, stray:2 |
| flat-3color | flat | 73 | ok | 3 (3, passes) | narrow:2, stray:2 |
| flat-light | flat | 73 | ok | 3 (2) | narrow:2, stray:2 |
| flat-lowres | flat | 73 | ok | 3 (2) | narrow:1, stray:2 |
| flat-outline | flat | 73 | ok | 3 (2) | stray:1 |
| flat-shadow | flat | 73 | ok | 3 (2) | narrow:2, stray:2 |
| gradient-basic | gradient | 73 | ok | n/a (no palette gate) | narrow:2, stray:2 |
| gradient-shadow | gradient | 67 (min 70) | ok | n/a | empty:75, filled:6, narrow:3, stray:5 |

No gate adjustments made. Every failure above is in the real-defect classes the
binding protocol reserves for findings (AA-blend third palette entry, stray-flag
punct-guess interplay, gradient-shadow charset undercoverage). Failures recorded
as findings, not calibrated away. Result: 8 of 8 color fixtures fail on these
documented gates, 1 of 1 (contact sheet) passes; this is the expected end state,
not a regression.

**GPOS gate addition (Task 5):** `flat-2color` and `gradient-basic` gained a
hard `expect(tableSlice(otf, 'GPOS'), 'GPOS PairPos present').not.toBeNull()`
assertion. `gradient-basic` clears it directly (no earlier assertion in its
path throws first) and moves on to fail at the pre-existing stray-flags finding,
confirming GPOS itself is clear. `flat-2color` still throws first on the
pre-existing CPAL palette finding (upstream in file order), so the GPOS line is
not reached inside the Playwright run for that fixture; a direct fontTools read
of its saved OTF (this task's fresh run) confirms GPOS is present regardless
(`True 2`, LookupType 2 / PairPos), matching the Task 5 pre/post comparison.

**Strip-render-before-gates repair (Task 5):** the per-fixture strip screenshot
(feeding the contact sheet) was moved to run immediately after the OTF
download/build read, before any gating assertion, so a fixture that fails a
gate still lands a strip on `test-results/corpus-color-contact.png`. Confirmed
working this run: the contact sheet exists (`test-results/corpus-color-contact.png`,
~244KB) with all 8 fixtures visible despite 8 of 8 failing their gates.
