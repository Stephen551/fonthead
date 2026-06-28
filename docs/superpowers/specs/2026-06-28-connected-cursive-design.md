# Connected-cursive build mode — design spec

Date: 2026-06-28
Status: approved design, ready for implementation plan
Author: Claude Code, directed by Stephen (A&C Meridian)

## Problem

The maker traces an alphabet grid sheet into a font by treating each cell as an
isolated glyph, then spaces them one of two ways: flourish-overhang (trims thin
tails and overhangs them per glyph) or cell-width (the sheet's drawn pitch).
Neither joins letters. On a genuinely connected cursive sheet the overhang path
fakes joins inconsistently (round lowercase overlap, caps gap) and the cell-width
path floats every letter apart. There is no connected-script model anywhere in
the engine. Reproduced on the field sheet
`C:\Users\steph\Downloads\ChatGPT Image Jun 28, 2026, 12_32_59 PM.png`
(7-row connected cursive: A-M / N-Z / a-m / n-z / 0-9 / 17 symbols / 13 symbols);
it self-classifies as script and trims 84/92 glyphs with overhang.

## Goal and success bar (staged)

Add a connected-cursive build mode. Two stages, both shipping behind one mode:

1. **Consistent floor:** letters reliably touch with even rhythm, no cramming,
   no floating letters, no welds. `overlap = 0`.
2. **Seamless (opt-in):** a small uniform overlap so strokes merge, made reliable
   by an input contract (preset + connector guide) that draws every connector at
   a common baseline height.

"Good" in one line: every lowercase run between breaks is one continuous stroke
at a consistent height; `g j q y z`, digits, punctuation, and space read as clean
breaks; no fusion-check pair welds; no glyph has negative-x ink; fontTools
validates the bytes.

## UX and trigger

- Auto for detected script faces, replacing flourish-overhang there; a mono-only
  advanced "connected cursive" toggle forces it on or off. Flourish overhang
  stays the path for everything else.
- When connect is on, the UI disables/ignores `trimFlourishes`, `spacing`, and
  `italic` (italic is load-bearing: the worker slants from the style name).

## Input contract (makes seamless reliable)

- A new "script" generate preset (chip + prompt + armed charset) whose prompt
  tells the model to draw every letter with entry and exit strokes meeting a
  common baseline connector line and reaching the cell edges.
- The printable template sheet (`makeTemplateSheet`) gains a faint per-row
  connector guide line, in the same vanishing gray as the other guides so it
  never traces. The guide notes: to join after `g j q y z`, draw a baseline
  connector flick into the band.

## Approach (chosen: Approach 1)

Per glyph, find connection points in a connector band just above the baseline.
Left plug = leftmost ink x in the band; right plug = rightmost ink x in the band.
Anchor each glyph and set its advance so the next glyph's left plug lands on this
glyph's right plug. No edits to the letterforms (translate-x and advance only).
This is an x-only re-implementation of OpenType cursive attachment (`curs`); we
use a fixed connection height rather than per-glyph vertical attachment.

Rejected: synthesized bridge strokes and canonical-line normalization (both do
path surgery on every glyph and risk distorting letters whose natural connector
is high). Available later as a sheet-agnostic v2 if wanted.

---

## Engine spec — `connectGlyphs()` + connect build mode

All claims below were source-verified against `src/lib/maker.ts`,
`public/assets/vendor/font-engine-builder.js`, `font-engine-worker.js`,
`font-engine-features.js` during design hardening, and the empirical claims about
the field sheet were confirmed by viewing it.

### 0. The geometry contract — ONE frame

Anchor and advance MUST share an origin. The worker's `useCellWidth` branch sets
`shiftX = 0` (builder.js:357-359), so cell-x 0 maps to the glyph origin, and the
previous glyph's advance lands the cursor on the next glyph's origin. Anchoring on
ink while measuring the advance plug-to-plug diverges by `leftPlug - inkLeft` for
round letters whose bowl bulges left of the entry hairline, back-colliding them.

One rule:

```
anchorOrigin = min(leftPlug, inkLeft)   // = leftPlug normally; = inkLeft when a bowl bulges left
dx           = -anchorOrigin            // never lets ink go negative
cellW        = rightPlug - anchorOrigin - overlapPx
```

The next glyph's origin lands at `cellW`, i.e. `overlapPx` short of this glyph's
right plug. Joins meet, overlap honored, round letters protected — one rule, no
per-glyph offset carry, no look-behind. Do NOT implement two anchor paths.

### 1. Signature and algorithm

```ts
export function connectGlyphs(
  glyphs: Glyph[],
  opts: { overlapPx: number; minAdvPx: number; leftPadPx: number; maxPenPx: number },
): { glyphs: Glyph[]; joined: number; broke: number };
```

Returns the same shape as `trimGlyphOverhangs` (mutates `paths` via
`translatePathX` and `cellW` only; `char`, `italic`, `cellH`, `baselineYInCell`
untouched). `joined`/`broke` are diagnostics (mirror `__lastTrim`).

**Pass 0 — face metrics + profiles (once):**
- `profiles[i] = glyphColumnAreas(glyphs[i])` (maker.ts:806-849: cols, spans,
  rowLeft, rowRight, inkTopRow). Same raster primitive as trim.
- `ink[i] = {first, last}` from the cols scan.
- Two distinct maxAsc values, kept separate:
  - **raster** `xhPx`, `maxAscRaster` from raster rows (`baselineYInCell -
    inkTopRow`, as maker.ts:977-989, over `'xvwzonu'`, x's ascent or median):
    band geometry ONLY.
  - **bbox** `maxAscBBox` from `w().estimateBBox` (as `bodyPadPx`, maker.ts:855-862;
    matches the engine scale `0.80*upm/maxAscBBox`, builder.js:288-290): every
    px<->UPM conversion. The two are not equal; mixing them drifts the realized
    overlap/penetration off its intended percent.
  - `capHpx` = median asc over caps `'HBEINPRT'` (fallback `xhPx/0.7`): band only.
- Factor as a `faceMetrics(glyphs)` helper used by both `buildFont` and
  `connectGlyphs`; do not duplicate the derivation.

**Pass 1 — classify + plug detect (forward order = string order):**

Connector band (per glyph, that glyph's cell pixel rows, y DOWN):
```
bandBotY = clamp(round(baselineYInCell - xhPx * BAND_LO), 0, cellH-1)
bandTopY = clamp(round(baselineYInCell - xhPx * BAND_HI), 0, cellH-1)
```

- **break-class glyph** (digit, punctuation/symbol, no-band, cap with no right
  exit, descender-exit letter): body advance via `bodyBoundsFromColumns(cols, {},
  spans)`; `cellW = body.max - body.min + 1 + 2*leftPadPx`, `dx = leftPadPx -
  body.min`. Breaks join both sides. Space is the exception (no ink; gets
  `spaceAdvance` from `buildFont`).
- **joining glyph:** find plugs.
  - LEFT PLUG = min over band rows of `rowLeft[r]`; record `leftPlugY`.
  - RIGHT PLUG = max over band rows of `rowRight[r]`; record `rightPlugY`.
    - high-exit override: if `char ∈ HIGH_EXIT`, search right plug in the upper
      band `[round(baselineYInCell - xhPx*HIGH_EXIT_HI) .. round(baselineYInCell -
      xhPx*HIGH_EXIT_LO)]`.
    - cap right-exit: use the CAP band (`capHpx*CAP_BAND_*`). Caps never join left.
  - no-band promotion: if `< BAND_MIN_ROWS` band rows carry finite ink OR band ink
    area `< BAND_MIN_AREA` of the glyph's ink, promote to break-class.

**Step 4 — anchor + advance:**
```
anchorOrigin = min(leftPlug, ink.first)
dx     = -anchorOrigin
cellW  = max(minAdvPx, rightPlug - anchorOrigin - overlapPx)
```
Left-side overrides:
1. cap joining right only: `dx = leftPadPx - inkLeft`, `cellW = max(minAdvPx,
   rightPlug - inkLeft - overlapPx)`.
2. joining glyph whose PREDECESSOR broke the join (follows digit/punct/space/
   descender-exit/no-band): same body-left bearing on the left, advance still to
   the right plug. Needs `prevChar` (forward pass already has it).

Apply `dx` via `translatePathX`; set `cellW`. Nothing else.

**Pass 2 — weld feedback (reuse trim pass 3, loosen-only):**
- Build `byChar` (one index per char) over glyphs with profile + ink.
- For each `[lc, rc]` in the existing static `FUSION_CHECK_PAIRS` (maker.ts:890-898),
  run the same body-strip penetration scan (maker.ts:1013-1023) with connect
  geometry (`adv = connectCellW`, `off = connectDx`, strip y ∈ [xh*0.15 .. xh*1.10]).
- If `minGap < -maxPenPx`, GROW the left glyph's `cellW` by `(-minGap - maxPenPx)`.
  Restores only ever grow advances → one sequential sweep is stable. Never tighten.

### 2. Default constants

`% of x-height` via `pctXh * xhPx`. `% of UPM` via `pct * (maxAscBBox / 0.8)`.

```
BAND_LO          = 0.06    // ·xhPx — band bottom, above baseline AA/foot, > 0
BAND_HI          = 0.42    // ·xhPx — band top, below the round-bowl bulge (~0.50)
HIGH_EXIT_LO     = 0.50    // ·xhPx — high-exit right band floor
HIGH_EXIT_HI     = 0.95    // ·xhPx — high-exit right band ceiling
CAP_BAND_LO      = 0.06    // ·capHpx
CAP_BAND_HI      = 0.30    // ·capHpx
BAND_MIN_ROWS    = 2
BAND_MIN_AREA    = 0.005   // band ink as fraction of glyph ink
LEFT_PAD_FLOOR   = 1       // px
MIN_ADV_PCT      = 0.18    // ·xhPx — narrow-letter advance floor (i l j)
OVERLAP_PCT      = 0.0     // ·xhPx — shipping default (touch floor); compute directly, NOT via bodyPadPx
OVERLAP_SEAMLESS = 0.015   // ·xhPx — opt-in seamless, gated behind the weld pass
WORD_SPACE       = 0.30    // em — spaceAdvance for connect mode
maxPenPx         = max(3, round(0.018 * maxAscBBox / 0.8))   // identical to trim's gate
HIGH_EXIT         = {o,v,w,b,d,s,u, O,V,W,B}   // f,t excluded; d,s,u added (sheet-verified)
DESC_EXIT         = {g,j,q,y,z}                 // descender-exit → break right
CAP_NO_RIGHT_EXIT = {F,J,O,Q}
```

`overlapPx = round((connectOverlapPct ?? OVERLAP_PCT) * xhPx)` — 0 stays 0.
`bodyPadPx` ends `Math.max(1, ...)`, so routing overlap through it makes 0
unreachable; compute directly.

Rationale: `BAND_HI=0.42` is the load-bearing number (above the join-stroke ride
height, below the round-bowl bulge so o/c/e/a's left plug stays the entry
hairline). `MIN_ADV_PCT=0.18·xh` guarantees daylight for i/l even at zero overlap,
killing r-i/m-i/u-i welds without per-pair rules. `WORD_SPACE=0.30em` sits between
the engine default 0.28 and the script-trim 0.38 (connected runs read denser).

### 3. `buildFont` integration

Add to `BuildOpts`: `connect?: boolean; connectOverlapPct?: number`.

Make connect and trim mutually exclusive, connect first; `connectGlyphs` is a
sibling of `trimGlyphOverhangs`, never a wrapper:

```ts
if (opts.connect) {
  flags.useCellWidth = true;    // cellW becomes the advance verbatim
  flags.tightAdvance = false;   // else re-measure bbox + add sideBearing, destroying the plug advance
  const fm = faceMetrics(glyphs);
  const overlapPx = Math.round((opts.connectOverlapPct ?? 0) * fm.xhPx);
  const fit = connectGlyphs(glyphs, {
    overlapPx,
    minAdvPx:  Math.round(0.18 * fm.xhPx),
    leftPadPx: Math.max(1, Math.round((0.1 / 100) * (fm.maxAscBBox / 0.8))),
    maxPenPx:  Math.max(3, Math.round(0.018 * fm.maxAscBBox / 0.8)),
  });
  glyphsIn = fit.glyphs;
  spaceAdvance = 0.30;
  styleOut = 'Regular';         // hard-force non-italic (the worker slants on style name)
  (globalThis as any).__lastConnect = { joined: fit.joined, broke: fit.broke };
} else if (opts.trimFlourishes) {
  /* existing trim path, unchanged */
}
```

Payload: `style: styleOut`, `italic: opts.connect ? false : !!g.italic`
(belt-and-braces; the load-bearing lever is style), `features: { kerning:
opts.connect ? false : true }` (was hardcoded `{kerning:true}` at maker.ts:1128),
`opticalSidebearings: false` (must stay false — `optimizeSidebearings` re-centers
glyphs and would void the join). The shared checksum/validate tail
(`fixSfntChecksums` → woff2 re-wrap → `assertValid`, maker.ts:1134-1146) is
inherited.

Thread `connect`/`connectOverlapPct` through `editMonoRow` (maker.ts:638-666;
add to signature after `trimFlourishes`, pass into its `buildFont` opts, pass from
`Maker.tsx:463`). Without this, any per-row re-slice after a connect build silently
rebuilds in trim spacing — a loss-of-joins regression.

What connect must NOT do that trim does: no two-sided padding for joining glyphs
(only break-class); no script self-classification / SCRIPT_TRIM; no NO_TRIM_RIGHT
or tail trimming; reuse (not re-run) the fusion check; sibling not wrapper.

### 4. Join-class table

`joinClass(char, prevChar, nextChar)`:

| Category | Glyphs | Joins LEFT | Joins RIGHT | Fallback |
|---|---|---|---|---|
| Lowercase, baseline exit | a c e h i k l m n r t x (any lowercase not HIGH_EXIT/DESC_EXIT) | yes | yes (default band) | — |
| Lowercase, high exit | o v w b d s u | yes | yes (HIGH_EXIT band) | — |
| Lowercase, descender exit | g j q y z | yes | NO (break right) | body advance right; left joins |
| Lowercase, no band ink | any failing BAND_MIN_* | no | no | body advance, two-sided break |
| Uppercase, normal | A B C D E G H K L M N P R S T U V W X Y Z | no | only if next is lowercase, via CAP band | body advance on non-joining side |
| Uppercase, no right exit | F J O Q (+ no cap-band ink) | no | no | body advance, two-sided break |
| Digits | 0-9 | no | no | body advance, two-sided break |
| Punctuation/symbols | not [A-Za-z], not space | no | no | body advance, two-sided break |
| Space | ` ` | no | no | spaceAdvance (0.30em) |

Predicate order: space → non-letter (break) → uppercase (left=no; right = next is
lowercase and not CAP_NO_RIGHT_EXIT) → descender-exit lowercase (left yes, right
break) → lowercase (both, HIGH_EXIT band on the right if applicable). A break is
two coordinated decisions: the break-class glyph body-advances, and the glyph
after it gets a post-break left bearing.

### 5. Coordinate contract

Stage A (cell px, y down): connect works here; `translatePathX` shifts x only,
never y. Stage B: anchor/advance per §0/§4. Stage C (worker, unchanged): `scale =
0.80*upm/maxAscBBox`; `useCellWidth` → `advanceUnits = round(cellW*scale)`,
`shiftX = 0`; `xFont = x*scale`, `yFont = -(y - baseY)*scale`. Therefore cell-x 0 =
font-x 0 = glyph origin = where the prior advance lands; the right plug sits
`overlapPx·scale` past the advance; joins meet end-to-end. Italic forced off (a
slant adds `italicSlantSpan` to advance and `shiftX`, voiding `shiftX=0`).

### 6. Residual risks (v1 ceiling)

1. Within-tolerance plug-y steps: x-only anchoring has no y lever. High-exit→
   low-entry and baseline-exit→high-entry pairs show small vertical steps. Accepted
   v1 contract (fixed connection height); the corpus contact sheet is the eyeball
   gate. A y-aware join is v2 (needs a per-glyph vertical offset the `useCellWidth`
   path does not expose). Do NOT patch with an auto-break — it over-breaks common
   pairs (`the and all high`).
2. `s` plug stability: little baseline ink, now HIGH_EXIT; watch `s`-pairs in the
   join-gap metric; if unstable, break after `s` rather than weld.
3. Constants are sheet-anchored: re-validate against the corpus harness before
   shipping; treat as starting values. Add this sheet as a connect fixture first.
4. Caps untested on cap→lowercase strings here; confirm `B→a`, `H→e` in preview.

## Validation

Instrument `connectGlyphs` behind `__lastConnect`: class counts + break-reason
histogram; realized join gaps (Pass-2 body-strip minGap per adjacent pair);
assert no negative-x ink (`min(inkLeft + dx) ≥ 0`); assert `cellW ≥ minAdvPx`.

"Good": every lowercase→lowercase join gap in `[-maxPenPx, +2px]`; breaks (after
g/j/q/y/z, digits, punct, space) show a clean positive gap; no FUSION_CHECK_PAIRS
weld; fontTools `TTFont(path, checkChecksums=2)` passes.

Test loop:
1. Prototype `connectGlyphs` against the real traced sheet in a throwaway harness;
   tune band/overlap/min-adv until the join-gap metric is clean and the strip
   reads connected. Hand Stephen a before/after strip.
2. Implement in the engine with unit tests (TDD).
3. Add the field sheet as a corpus fixture in connect mode + a join-gap metric
   (lowercase→lowercase joins ≤ touch floor; exclude break boundaries); keep the
   fusion gate; keep fontTools validation.
4. e2e: build connect mode, assert a valid font + joins.
5. Adversarial review of the diff.

## Files touched

- `src/lib/maker.ts`: `connect`/`connectOverlapPct` on `BuildOpts`; `faceMetrics`
  helper; `connectGlyphs` sibling of `trimGlyphOverhangs`; the `buildFont` branch
  (mutually exclusive with trim; `useCellWidth=true`/`tightAdvance=false`,
  `spaceAdvance=0.30`, `style:'Regular'`, `features:{kerning:false}`,
  `opticalSidebearings:false`, direct overlap conversion); change the hardcoded
  `features:{kerning:true}` literal; thread connect through `editMonoRow`. Add the
  connector guide line to `makeTemplateSheet`.
- `src/components/Maker.tsx`: `connect` state; pass in the `buildFont` and
  `editMonoRow` calls; mono-only "connected cursive" advanced toggle; auto-on for
  detected script faces with override; disable `trimFlourishes`/`spacing`/`italic`
  when connect is on.
- `src/pages/make.astro`: new "script" generate preset (chip + prompt +
  `PRESET_CHARSETS` entry).
- `e2e-corpus/` + `e2e/`: connect-mode corpus fixture + join metric; connect e2e.
- No changes to the vendored engine files; `translatePathX` + per-glyph `cellW` +
  the style override is the entire control surface.

## Confidence

High on the integration surface and the corrected §0 geometry (provable by the
Stage-C derivation). The constants are starting values to validate empirically on
the real sheet (step 1) and across the corpus before shipping. The two things that
most determine whether it looks made: the single-frame anchor landing round-letter
joins, and accepting clean breaks after g/j/q/y/z rather than faking them.
