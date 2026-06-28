# Connected-cursive build mode — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a connected-cursive build mode to the maker so a script alphabet sheet builds into a font whose letters join, instead of floating apart or overlapping inconsistently.

**Architecture:** A new pure-ish `connectGlyphs()` in `src/lib/maker.ts`, a sibling of `trimGlyphOverhangs`, finds each glyph's connection plugs in a band above the baseline and sets advances so consecutive plugs meet (one anchor/advance origin). `buildFont` gains a mutually-exclusive `connect` branch (cell-width advance, kerning off, style forced Regular). The UI auto-enables it for detected script faces with an override; a generate preset + a connector guide on the printable sheet make seamless joins reliable. The decision/arithmetic core is split into pure functions (`joinClass`, `anchorAdvance`) that unit-test in jsdom; the canvas raster and full assembly are gated by the corpus/e2e suites in real Chromium.

**Tech Stack:** TypeScript strict, the vendored font engine (`public/assets/vendor/*`), opentype.js, Potrace, vitest (jsdom) for units, Playwright (real Chromium) for e2e + the corpus harness, fontTools (Python) for authoritative validity.

**Spec:** `docs/superpowers/specs/2026-06-28-connected-cursive-design.md` (read it; this plan implements it).

## Global Constraints

- TypeScript strict; type check is `npx tsc --noEmit -p tsconfig.json` (NOT `npm run check`).
- Never trust fontkit/opentype to validate a font. Every build runs `fixSfntChecksums` + `verifySfntChecksums`/`assertValid`; the authoritative gate is fontTools `TTFont(path, checkChecksums=2)`.
- The vendored engine (`public/assets/*`) is edited surgically and additively only; this feature touches NO engine file. The entire control surface is `translatePathX` + per-glyph `cellW` + the style name + the `features.kerning` flag, all already consumed by the worker.
- American spelling in all visible copy (color, favorite, behavior). No em dashes, no double dashes, no exclamation marks in copy or commit messages.
- Commit messages on this Windows box must contain NO double-quote characters (here-string mangling). Stage specific files; never `git add -A` or `git add .` (it would stage the tracked `browse/dist` / engine binaries... not in this repo, but the habit stays: specific files only).
- `npm test` (vitest) and `npx tsc --noEmit` must pass before every commit. Kill any dev server on 4321 before editing source or running e2e (`Get-NetTCPConnection -LocalPort 4321 | Stop-Process`), or the astro overlay corrupts pages.
- Branch: `feat/connected-cursive` (already created; the design spec is its first commit). Do not push (master auto-deploys on push).

## Constants (calibrated in Task 1, consumed everywhere)

These are starting values from the spec, validated/tuned against the real sheet in Task 1. Final values live as named consts near `connectGlyphs` in `maker.ts`.

```
BAND_LO=0.06  BAND_HI=0.42  HIGH_EXIT_LO=0.50  HIGH_EXIT_HI=0.95
CAP_BAND_LO=0.06  CAP_BAND_HI=0.30  BAND_MIN_ROWS=2  BAND_MIN_AREA=0.005
MIN_ADV_PCT=0.18 (·xhPx)  OVERLAP_PCT=0.0 (·xhPx, shipping default)  OVERLAP_SEAMLESS=0.015
WORD_SPACE=0.30 (em)  LEFT_PAD_FLOOR=1 (px)
maxPenPx = max(3, round(0.018 * maxAscBBox / 0.8))
HIGH_EXIT = {o,v,w,b,d,s,u, O,V,W,B}   DESC_EXIT = {g,j,q,y,z}   CAP_NO_RIGHT_EXIT = {F,J,O,Q}
```

## File structure

- `src/lib/maker.ts` — add `connect`/`connectOverlapPct` to `BuildOpts`; add the pure helpers `joinClass`, `anchorAdvance`; add `faceMetrics` + `connectGlyphs`; add the `connect` branch in `buildFont`; flip the hardcoded `features:{kerning:true}`; thread `connect` through `editMonoRow`; add the connector guide line to `makeTemplateSheet`.
- `src/components/Maker.tsx` — `connect` state; auto-on for detected script; advanced toggle; disable italic/spacing/trim when connect is on; pass `connect` to `buildFont` and `editMonoRow`.
- `src/pages/make.astro` — a "script" generate preset (chip, prompt builder, `PRESET_CHARSETS` entry).
- `test/maker-connect.test.ts` — vitest units for the pure decision/arithmetic core.
- `e2e-corpus/corpus.spec.ts` + `e2e/fixtures/corpus/` — connect-mode fixture + join-gap metric.
- `e2e/connect.spec.ts` — e2e: build connect mode, assert validity + joins.
- `scratchpad` — Task 0 throwaway prototype harness (never committed).

---

### Task 0: Prototype and calibrate against the real sheet (throwaway, de-risk)

No production code. Prove the connector model and lock the constants on the actual traced sheet before writing the engine function. Stephen's gate is the before/after strip.

**Files:**
- Create (throwaway, scratchpad): a Playwright spec under `e2e-corpus/_proto-connect.spec.ts` (deleted at end of task).
- Read: `src/lib/maker.ts` (`traceSheet`, `glyphColumnAreas`, `translatePathX`, the `Glyph` type, `buildFont`).

**Interfaces:**
- Produces: validated final values for the Constants block above; a captured before/after strip for Stephen.

- [ ] **Step 1: Expose traced glyphs for the probe.** In the proto spec, drive `/make` to drop the sheet `C:\Users\steph\Downloads\ChatGPT Image Jun 28, 2026, 12_32_59 PM.png`, then in-page call the maker's `traceSheet` (import path `/src/lib/maker.ts` via the dev server, or read `window.__lastBuild` glyphs if exposed). If glyphs are not reachable in-page, add a TEMP `(window as any).__lastGlyphs = glyphs` in `Maker.tsx run()` right after trace, to be reverted at task end.

- [ ] **Step 2: Implement the connector model in-page (JS prototype).** In `page.evaluate`, for each traced glyph rasterize via a canvas (mirror `glyphColumnAreas`), compute `xhPx` from `'xvwzonu'` ascents, find band plugs with the Constants, apply `joinClass`, compute `anchorOrigin/dx/cellW` per the spec §0/§4, then render a strip of `minimum connect`, `overlap cursive`, `the quick brown fox`, `lazy frog jumps`, `office roller`, `Hello World abcdefg` by tiling each glyph's translated paths at its advance. Screenshot it.

- [ ] **Step 3: Measure join gaps.** For each adjacent lowercase→lowercase pair in the strings, compute the body-strip min-gap (mirror corpus `pairGap`). Log per-pair gaps and the distribution. Target: lowercase→lowercase joins in `[-maxPenPx, +2px]`; breaks (after g/j/q/y/z, space) clearly positive; no negative-x ink.

- [ ] **Step 4: Tune constants.** Sweep `BAND_HI` (0.38–0.46), `MIN_ADV_PCT` (0.14–0.22), `OVERLAP_PCT` (0.0 vs 0.015), and the `HIGH_EXIT` membership against the measured gaps + the rendered strip until the floor reads connected with no weld/gap. Record the final values.

- [ ] **Step 5: Hand Stephen the strip.** Send the before (current default) and after (prototype) strips. Gate: he confirms the floor reads connected. If not, return to Step 4.

- [ ] **Step 6: Clean up.** Delete `e2e-corpus/_proto-connect.spec.ts`; revert any TEMP `__lastGlyphs` line in `Maker.tsx`. Verify `git status` shows no stray changes. No commit (nothing production changed); the deliverable is the locked Constants block, written back into this plan.

---

### Task 1: Pure join-class decision

**Files:**
- Modify: `src/lib/maker.ts` (add `JoinClass` type + `joinClass` near `trimGlyphOverhangs`, ~line 905)
- Test: `test/maker-connect.test.ts` (create)

**Interfaces:**
- Produces: `export type JoinClass = { kind: 'join' | 'break' | 'space'; joinsLeft: boolean; joinsRight: boolean; highExit: boolean; cap: boolean };` and `export function joinClass(char: string, prevChar: string | undefined, nextChar: string | undefined): JoinClass;`
- Consumes: the `HIGH_EXIT`, `DESC_EXIT`, `CAP_NO_RIGHT_EXIT` sets (define as module consts in this task).

- [ ] **Step 1: Write the failing tests.**

```ts
// test/maker-connect.test.ts
import { describe, it, expect } from 'vitest';
import { joinClass } from '../src/lib/maker';

describe('joinClass', () => {
  it('lowercase baseline letter joins both sides', () => {
    const c = joinClass('n', 'a', 'a');
    expect(c.kind).toBe('join');
    expect(c.joinsLeft).toBe(true);
    expect(c.joinsRight).toBe(true);
    expect(c.highExit).toBe(false);
  });
  it('high-exit lowercase flags highExit', () => {
    expect(joinClass('o', 'n', 'n').highExit).toBe(true);
    expect(joinClass('s', 'a', 'a').highExit).toBe(true);
    expect(joinClass('f', 'a', 'a').highExit).toBe(false); // f stays out
  });
  it('descender-exit letter joins left, breaks right', () => {
    const c = joinClass('g', 'a', 'a');
    expect(c.joinsLeft).toBe(true);
    expect(c.joinsRight).toBe(false);
  });
  it('cap joins right only into a following lowercase', () => {
    expect(joinClass('H', undefined, 'e')).toMatchObject({ joinsLeft: false, joinsRight: true });
    expect(joinClass('H', undefined, 'I')).toMatchObject({ joinsRight: false }); // cap before cap
    expect(joinClass('F', undefined, 'e')).toMatchObject({ joinsRight: false }); // no right exit
  });
  it('digit, punctuation break both sides; space is space', () => {
    expect(joinClass('5', 'a', 'a')).toMatchObject({ kind: 'break', joinsLeft: false, joinsRight: false });
    expect(joinClass('!', 'a', 'a').kind).toBe('break');
    expect(joinClass(' ', 'a', 'a').kind).toBe('space');
  });
});
```

- [ ] **Step 2: Run to verify it fails.** `npm test -- maker-connect` → FAIL (`joinClass` not exported).

- [ ] **Step 3: Implement `joinClass` and the sets.**

```ts
// near trimGlyphOverhangs in src/lib/maker.ts
const HIGH_EXIT = new Set(['o', 'v', 'w', 'b', 'd', 's', 'u', 'O', 'V', 'W', 'B']);
const DESC_EXIT = new Set(['g', 'j', 'q', 'y', 'z']);
const CAP_NO_RIGHT_EXIT = new Set(['F', 'J', 'O', 'Q']);
const LOWER = /[a-z]/;
const UPPER = /[A-Z]/;
const LETTER = /[A-Za-z]/;

export type JoinClass = {
  kind: 'join' | 'break' | 'space';
  joinsLeft: boolean;
  joinsRight: boolean;
  highExit: boolean;
  cap: boolean;
};

export function joinClass(char: string, _prevChar: string | undefined, nextChar: string | undefined): JoinClass {
  if (char === ' ') return { kind: 'space', joinsLeft: false, joinsRight: false, highExit: false, cap: false };
  if (!LETTER.test(char)) return { kind: 'break', joinsLeft: false, joinsRight: false, highExit: false, cap: false };
  if (UPPER.test(char)) {
    const joinsRight = !!nextChar && LOWER.test(nextChar) && !CAP_NO_RIGHT_EXIT.has(char);
    return { kind: joinsRight ? 'join' : 'break', joinsLeft: false, joinsRight, highExit: HIGH_EXIT.has(char), cap: true };
  }
  if (DESC_EXIT.has(char)) return { kind: 'join', joinsLeft: true, joinsRight: false, highExit: false, cap: false };
  return { kind: 'join', joinsLeft: true, joinsRight: true, highExit: HIGH_EXIT.has(char), cap: false };
}
```

- [ ] **Step 4: Run to verify pass.** `npm test -- maker-connect` → PASS. Then `npx tsc --noEmit -p tsconfig.json` → clean.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/maker.ts test/maker-connect.test.ts
git commit -m 'Add joinClass decision for connected-cursive mode'
```

---

### Task 2: Pure anchor/advance arithmetic

**Files:**
- Modify: `src/lib/maker.ts` (add `anchorAdvance` near `joinClass`)
- Test: `test/maker-connect.test.ts` (extend)

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `export function anchorAdvance(p: { leftPlug: number; rightPlug: number; inkLeft: number; overlapPx: number; minAdvPx: number; leftPadPx: number; mode: 'join' | 'leftpad' }): { dx: number; cellW: number };` — the single §0 origin rule, plus the `leftpad` variant for cap-right and post-break glyphs.

- [ ] **Step 1: Write the failing tests.**

```ts
import { anchorAdvance } from '../src/lib/maker';

describe('anchorAdvance', () => {
  const base = { overlapPx: 0, minAdvPx: 5, leftPadPx: 1 };
  it('join: anchors on left plug when entry is leftmost ink', () => {
    const r = anchorAdvance({ ...base, leftPlug: 10, rightPlug: 40, inkLeft: 10, mode: 'join' });
    expect(r.dx).toBe(-10);            // anchorOrigin = min(10,10)=10
    expect(r.cellW).toBe(30);          // 40-10-0
  });
  it('join: round letter bowl left of entry anchors on ink and shortens advance the same', () => {
    // bowl bulges left: inkLeft=4, entry plug=10
    const r = anchorAdvance({ ...base, leftPlug: 10, rightPlug: 40, inkLeft: 4, mode: 'join' });
    expect(r.dx).toBe(-4);             // anchorOrigin = min(10,4)=4 → no negative-x ink
    expect(r.cellW).toBe(36);          // 40-4-0 → right plug still lands at the join
  });
  it('join: overlap shortens the advance', () => {
    const r = anchorAdvance({ ...base, overlapPx: 3, leftPlug: 10, rightPlug: 40, inkLeft: 10, mode: 'join' });
    expect(r.cellW).toBe(27);          // 40-10-3
  });
  it('join: minAdvPx floors a narrow letter', () => {
    const r = anchorAdvance({ ...base, leftPlug: 10, rightPlug: 12, inkLeft: 10, mode: 'join' });
    expect(r.cellW).toBe(5);           // max(5, 12-10-0=2)
  });
  it('leftpad: cap-right / post-break gets a left bearing, advance to right plug from ink', () => {
    const r = anchorAdvance({ ...base, leftPlug: 10, rightPlug: 40, inkLeft: 6, mode: 'leftpad' });
    expect(r.dx).toBe(1 - 6);          // leftPadPx - inkLeft
    expect(r.cellW).toBe(34);          // max(5, 40-6-0)
  });
});
```

- [ ] **Step 2: Run to verify it fails.** `npm test -- maker-connect` → FAIL.

- [ ] **Step 3: Implement.**

```ts
export function anchorAdvance(p: {
  leftPlug: number; rightPlug: number; inkLeft: number;
  overlapPx: number; minAdvPx: number; leftPadPx: number;
  mode: 'join' | 'leftpad';
}): { dx: number; cellW: number } {
  if (p.mode === 'leftpad') {
    return { dx: p.leftPadPx - p.inkLeft, cellW: Math.max(p.minAdvPx, p.rightPlug - p.inkLeft - p.overlapPx) };
  }
  const anchorOrigin = Math.min(p.leftPlug, p.inkLeft);
  return { dx: -anchorOrigin, cellW: Math.max(p.minAdvPx, p.rightPlug - anchorOrigin - p.overlapPx) };
}
```

- [ ] **Step 4: Run to verify pass.** `npm test -- maker-connect` → PASS; `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/maker.ts test/maker-connect.test.ts
git commit -m 'Add anchorAdvance single-origin rule for connect mode'
```

---

### Task 3: `faceMetrics` + `connectGlyphs` assembly

Canvas raster runs only under real Chromium, so the deep test is the corpus/e2e (Task 6). Here we write the function and a jsdom smoke test that exercises the break-class/no-band fallbacks (which need no real raster when profiles are absent).

**Files:**
- Modify: `src/lib/maker.ts` (add `faceMetrics`, `connectGlyphs` as a sibling of `trimGlyphOverhangs`)
- Test: `test/maker-connect.test.ts` (extend with the structural smoke test)

**Interfaces:**
- Consumes: `glyphColumnAreas` (maker.ts:806), `bodyBoundsFromColumns` (maker.ts:733), `translatePathX` (maker.ts:787), `w().estimateBBox`, `joinClass`, `anchorAdvance`.
- Produces: `export interface FaceMetrics { xhPx: number; maxAscRaster: number; maxAscBBox: number; capHpx: number }`; `export function faceMetrics(glyphs: Glyph[]): FaceMetrics`; `export function connectGlyphs(glyphs: Glyph[], opts: { overlapPct?: number; minAdvPct?: number; seamless?: boolean }): { glyphs: Glyph[]; joined: number; broke: number }`.

- [ ] **Step 1: Write the structural smoke test** (glyphs with empty `paths` exercise the no-band → break-class path; `glyphColumnAreas` returns null for unfillable paths, so this runs in jsdom).

```ts
import { connectGlyphs } from '../src/lib/maker';
// A glyph with no usable paths must fall to break-class and keep a positive cellW,
// never throw, and never produce negative cellW.
it('connectGlyphs tolerates empty glyphs (break-class fallback)', () => {
  const glyphs = [
    { char: 'a', italic: false, paths: [], cellW: 40, cellH: 100, baselineYInCell: 80 },
    { char: ' ', italic: false, paths: [], cellW: 30, cellH: 100, baselineYInCell: 80 },
  ];
  const out = connectGlyphs(glyphs as any, {});
  expect(out.glyphs).toHaveLength(2);
  for (const g of out.glyphs) expect(g.cellW).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run to verify it fails.** `npm test -- maker-connect` → FAIL (`connectGlyphs` not exported).

- [ ] **Step 3: Implement `faceMetrics`.**

```ts
export interface FaceMetrics { xhPx: number; maxAscRaster: number; maxAscBBox: number; capHpx: number }

export function faceMetrics(glyphs: Glyph[], profiles?: (ReturnType<typeof glyphColumnAreas>)[]): FaceMetrics {
  const estimateBBox = w().estimateBBox;
  let maxAscBBox = 1;
  for (const g of glyphs) for (const d of g.paths) { const bb = estimateBBox(d); if (bb) maxAscBBox = Math.max(maxAscBBox, g.baselineYInCell - bb.minY); }
  let maxAscRaster = 1, xAsc = 0;
  const xHeights: number[] = [], capAsc: number[] = [];
  glyphs.forEach((g, i) => {
    const prof = profiles ? profiles[i] : glyphColumnAreas(g);
    if (!prof) return;
    const asc = g.baselineYInCell - prof.inkTopRow;
    if (asc > maxAscRaster) maxAscRaster = asc;
    if (g.char === 'x') xAsc = asc;
    if ('xvwzonu'.includes(g.char)) xHeights.push(asc);
    if ('HBEINPRT'.includes(g.char)) capAsc.push(asc);
  });
  xHeights.sort((a, b) => a - b);
  const xhPx = xAsc || (xHeights.length ? xHeights[Math.floor(xHeights.length / 2)] : maxAscRaster * 0.5);
  capAsc.sort((a, b) => a - b);
  const capHpx = capAsc.length ? capAsc[Math.floor(capAsc.length / 2)] : xhPx / 0.7;
  return { xhPx, maxAscRaster, maxAscBBox, capHpx };
}
```

- [ ] **Step 4: Implement `connectGlyphs`** (computes profiles once, passes them to `faceMetrics`; band detect; per-glyph classify; anchor/advance; the loosen-only weld pass reusing `FUSION_CHECK_PAIRS` + the body-strip scan from `trimGlyphOverhangs` pass 3; apply via `translatePathX`). Use the Constants block. Full body:

```ts
const BAND_LO = 0.06, BAND_HI = 0.42, HIGH_EXIT_LO = 0.50, HIGH_EXIT_HI = 0.95;
const CAP_BAND_LO = 0.06, CAP_BAND_HI = 0.30, BAND_MIN_ROWS = 2, BAND_MIN_AREA = 0.005;
const MIN_ADV_PCT = 0.18, OVERLAP_PCT = 0.0, OVERLAP_SEAMLESS = 0.015, LEFT_PAD_FLOOR = 1;

export function connectGlyphs(
  glyphs: Glyph[],
  opts: { overlapPct?: number; minAdvPct?: number; seamless?: boolean } = {},
): { glyphs: Glyph[]; joined: number; broke: number } {
  const profiles = glyphs.map((g) => glyphColumnAreas(g));
  const fm = faceMetrics(glyphs, profiles);
  const xhPx = Math.max(1, fm.xhPx);
  const overlapPx = Math.round((opts.overlapPct ?? (opts.seamless ? OVERLAP_SEAMLESS : OVERLAP_PCT)) * xhPx);
  const minAdvPx = Math.max(1, Math.round((opts.minAdvPct ?? MIN_ADV_PCT) * xhPx));
  const leftPadPx = Math.max(LEFT_PAD_FLOOR, Math.round((0.1 / 100) * (fm.maxAscBBox / 0.8)));
  const maxPenPx = Math.max(3, Math.round((0.018 * fm.maxAscBBox) / 0.8));

  const ink = profiles.map((prof) => {
    if (!prof) return null;
    let first = -1, last = -1;
    for (let i = 0; i < prof.cols.length; i++) if (prof.cols[i] > 0) { if (first < 0) first = i; last = i; }
    return first < 0 ? null : { first, last };
  });

  // band ink area helper
  const bandPlugs = (i: number, lo: number, hi: number, hBase: number) => {
    const prof = profiles[i]!; const g = glyphs[i];
    const botY = Math.min(g.cellH - 1, Math.max(0, Math.round(g.baselineYInCell - hBase * lo)));
    const topY = Math.min(g.cellH - 1, Math.max(0, Math.round(g.baselineYInCell - hBase * hi)));
    let left = Infinity, right = -Infinity, rows = 0, area = 0, lY = -1, rY = -1;
    for (let y = topY; y <= botY; y++) {
      if (!isFinite(prof.rowLeft[y]) || !isFinite(prof.rowRight[y])) continue;
      rows++;
      if (prof.rowLeft[y] < left) { left = prof.rowLeft[y]; lY = y; }
      if (prof.rowRight[y] > right) { right = prof.rowRight[y]; rY = y; }
    }
    // band ink area = sum of (rowRight-rowLeft+1) in band / total ink area
    let bandInk = 0, totalInk = 0;
    for (let y = 0; y < prof.rowLeft.length; y++) if (isFinite(prof.rowLeft[y])) totalInk += prof.rowRight[y] - prof.rowLeft[y] + 1;
    for (let y = topY; y <= botY; y++) if (isFinite(prof.rowLeft[y])) bandInk += prof.rowRight[y] - prof.rowLeft[y] + 1;
    area = totalInk > 0 ? bandInk / totalInk : 0;
    return { left, right, rows, area, lY, rY };
  };

  const decisions: ({ dx: number; cellW: number } | null)[] = glyphs.map(() => null);
  const cellWById: number[] = glyphs.map((g) => Math.max(1, Math.ceil(g.cellW)));
  const dxById: number[] = glyphs.map(() => 0);
  let joined = 0, broke = 0;
  let prevBroke = true; // start of string behaves like a break boundary

  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i]; const prof = profiles[i]; const sp = ink[i];
    const cls = joinClass(g.char, glyphs[i - 1]?.char, glyphs[i + 1]?.char);

    const breakGlyph = () => {
      if (!prof || !sp) { decisions[i] = { dx: 0, cellW: Math.max(minAdvPx, Math.ceil(g.cellW)) }; broke++; prevBroke = true; return; }
      const body = bodyBoundsFromColumns(prof.cols, {}, prof.spans) || { min: sp.first, max: sp.last };
      decisions[i] = { dx: leftPadPx - body.min, cellW: body.max - body.min + 1 + 2 * leftPadPx };
      broke++; prevBroke = true;
    };

    if (cls.kind === 'space') { decisions[i] = null; prevBroke = true; continue; } // buildFont gives space its advance
    if (cls.kind === 'break' || !prof || !sp) { breakGlyph(); continue; }

    // right plug band
    const rightBand = cls.highExit ? { lo: HIGH_EXIT_LO, hi: HIGH_EXIT_HI } : { lo: BAND_LO, hi: BAND_HI };
    const hBase = cls.cap ? fm.capHpx : xhPx;
    const main = bandPlugs(i, BAND_LO, cls.cap ? CAP_BAND_HI : BAND_HI, hBase);
    if (main.rows < BAND_MIN_ROWS || main.area < BAND_MIN_AREA) { breakGlyph(); continue; }
    const rp = cls.highExit && !cls.cap ? bandPlugs(i, rightBand.lo, rightBand.hi, xhPx) : main;
    const rightPlug = isFinite(rp.right) ? rp.right : main.right;
    const leftPlug = main.left;

    // cap joining right only, or a glyph after a break, gets a left bearing
    const mode = cls.cap || prevBroke ? 'leftpad' : 'join';
    const aa = anchorAdvance({ leftPlug, rightPlug, inkLeft: sp.first, overlapPx, minAdvPx, leftPadPx, mode });
    decisions[i] = aa;
    dxById[i] = aa.dx; cellWById[i] = aa.cellW;
    joined++;
    prevBroke = cls.joinsRight ? false : true; // descender-exit / cap-no-right break the NEXT glyph
  }

  // loosen-only weld pass (mirror trimGlyphOverhangs pass 3)
  const byChar = new Map<string, number>();
  glyphs.forEach((g, i) => { if (profiles[i] && ink[i] && !byChar.has(g.char)) byChar.set(g.char, i); });
  const baselineYInCell = (i: number) => glyphs[i].baselineYInCell;
  for (const [lc, rc] of FUSION_CHECK_PAIRS) {
    const li = byChar.get(lc), ri = byChar.get(rc);
    if (li === undefined || ri === undefined) continue;
    const Lp = profiles[li], Rp = profiles[ri];
    if (!Lp || !Rp) continue;
    const dL = decisions[li], dR = decisions[ri];
    const GLadv = dL ? dL.cellW : Math.max(1, Math.ceil(glyphs[li].cellW));
    const GLoff = dL ? dL.dx : 0, GRoff = dR ? dR.dx : 0;
    let minGap = Infinity;
    for (let s = 0; s <= 32; s++) {
      const y = xhPx * 0.15 + xhPx * 0.95 * (s / 32);
      const rowL = Math.round(baselineYInCell(li) - y), rowR = Math.round(baselineYInCell(ri) - y);
      if (rowL < 0 || rowL >= Lp.rowRight.length || rowR < 0 || rowR >= Rp.rowLeft.length) continue;
      if (!isFinite(Lp.rowRight[rowL]) || !isFinite(Rp.rowLeft[rowR])) continue;
      const gap = GLadv + (Rp.rowLeft[rowR] + GRoff) - (Lp.rowRight[rowL] + GLoff);
      if (gap < minGap) minGap = gap;
    }
    if (isFinite(minGap) && minGap < -maxPenPx && dL) dL.cellW += -minGap - maxPenPx; // grow only
  }

  const out = glyphs.map((g, i) => {
    const d = decisions[i];
    if (!d) return g;
    return { ...g, paths: g.paths.map((p) => translatePathX(p, d.dx)), cellW: d.cellW };
  });
  return { glyphs: out, joined, broke };
}
```

- [ ] **Step 5: Run to verify pass.** `npm test -- maker-connect` → PASS; `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/maker.ts test/maker-connect.test.ts
git commit -m 'Add faceMetrics and connectGlyphs for connected-cursive mode'
```

---

### Task 4: `buildFont` connect branch + `editMonoRow` threading + kerning gate

**Files:**
- Modify: `src/lib/maker.ts` — `BuildOpts` (~708), `buildFont` branch (~1089), the `features:{kerning:true}` literal (~1128), `editMonoRow` (~638-666).

**Interfaces:**
- Consumes: `connectGlyphs`, `faceMetrics`.
- Produces: `BuildOpts.connect?: boolean; BuildOpts.connectOverlapPct?: number`; `editMonoRow(..., trimFlourishes, connect?, connectOverlapPct?)`.

- [ ] **Step 1: Add `connect`/`connectOverlapPct` to `BuildOpts`** (after `trimFlourishes`):

```ts
  /** Connected-cursive mode: place each glyph by its connection plugs so letters
   *  join. Mutually exclusive with trimFlourishes (connect wins). */
  connect?: boolean;
  /** Seamless overlap as a fraction of x-height. 0 (default) is the touch floor. */
  connectOverlapPct?: number;
```

- [ ] **Step 2: Add the connect branch in `buildFont`** (before the `if (opts.trimFlourishes)` block; make it `else if`):

```ts
  let styleOut = opts.style ?? 'Regular';
  if (opts.connect) {
    flags.useCellWidth = true;
    flags.tightAdvance = false;
    onProgress?.('connect', 'connected cursive · joining letters');
    const fit = connectGlyphs(glyphs, { overlapPct: opts.connectOverlapPct });
    glyphsIn = fit.glyphs;
    spaceAdvance = 0.30;
    styleOut = 'Regular'; // the worker slants on the style name; a slant voids the joins
    (globalThis as unknown as { __lastConnect?: object }).__lastConnect = { joined: fit.joined, broke: fit.broke };
  } else if (opts.trimFlourishes) {
    // ...existing block unchanged...
  }
```

(Existing `trimFlourishes` block becomes the `else if` body verbatim.)

- [ ] **Step 3: Update the payload** — `style: styleOut`, per-glyph `italic`, and the kerning gate:

```ts
    glyphs: glyphsIn.map((g) => ({
      char: g.char,
      italic: opts.connect ? false : !!g.italic,
      paths: g.paths,
      cellW: g.cellW,
      cellH: g.cellH,
      baselineYInCell: g.baselineYInCell,
    })),
    family: opts.family,
    style: styleOut,
    // ...
    features: { kerning: opts.connect ? false : true },
```

(`opticalSidebearings: false` already; leave it.)

- [ ] **Step 4: Thread `connect` through `editMonoRow`.** Signature (~638): add `connect?: boolean, connectOverlapPct?: number` after `trimFlourishes`. In its `buildFont` opts (~662-666) add `connect, connectOverlapPct`.

- [ ] **Step 5: Type check + units.** `npx tsc --noEmit -p tsconfig.json` clean; `npm test` green (no behavior change to existing paths — connect is off unless requested). 

- [ ] **Step 6: Commit.**

```bash
git add src/lib/maker.ts
git commit -m 'Wire connect mode into buildFont and editMonoRow'
```

---

### Task 5: Maker.tsx UI — auto-on for script, toggle, disable conflicting knobs

**Files:**
- Modify: `src/components/Maker.tsx` — `connect` state (~132 region), the `buildFont` call (~280), the `editMonoRow` call (~463), the advanced panel (~770-785).

**Interfaces:**
- Consumes: `BuildOpts.connect`, `__lastConnect`/`__lastTrim` script detection.

- [ ] **Step 1: Add `connect` state and auto-detect wiring.** Add `const [connect, setConnect] = useState(false);` and `const [connectTouched, setConnectTouched] = useState(false);`. After a build whose `__lastTrim.script` is true (or after trace detects script), if the user has not touched the toggle, default `connect` on. Keep it simple: in `run()`, before building, if `!connectTouched` set `connect` from the prior `__lastTrim?.script` flag (the face self-classified). Document that the first build of a script face may need a rebuild to pick up auto-connect; acceptable for v1, or compute script from a cheap pre-pass. Use the cheap path: read `(window as any).__lastTrim?.script` from the previous build to seed.

- [ ] **Step 2: Pass `connect` to the mono build call** (~280):

```ts
        res = await buildFont(
          glyphs,
          { family: fam, style: italic ? 'Italic' : 'Regular', formats: ['otf', 'ttf', 'woff2'], spacingPct: spacing, trimFlourishes: connect ? false : trimFlourishes, connect },
        );
```

- [ ] **Step 3: Pass `connect` to `editMonoRow`** (~463): add `connect` after `trimFlourishes`.

- [ ] **Step 4: Add the advanced toggle** (mono-only, in the `!isColor` block near the flourish toggle):

```tsx
                {!isColor && (
                  <div style={{ marginTop: 11 }}>
                    <ToggleRow label="connected cursive" on={connect} onChange={(v) => { setConnect(v); setConnectTouched(true); }} />
                    <p className="fh-mono" style={{ fontSize: 10, color: 'var(--ink-faint)', marginTop: 7, lineHeight: 1.5 }}>
                      joins the letters into a connected script. Auto for cursive sheets. Turns off flourish overhang, spacing, and italic.
                    </p>
                  </div>
                )}
```

- [ ] **Step 5: Disable the conflicting knobs when connect is on.** When `connect`, render the `flourish overhang`, `spacing`, and `italic` controls disabled (or visually muted), and ignore their values in the build (already handled for trim via `trimFlourishes: connect ? false : ...`; pass `style: 'Regular'` is forced in buildFont regardless, but also stop sending `italic:true` by gating the style: `style: !connect && italic ? 'Italic' : 'Regular'`). Spacing is ignored because connect forces `useCellWidth`.

- [ ] **Step 6: Verify in the built worker.** Kill 4321; `npx astro build && npx wrangler dev --port 8788 --local`; drop the sheet; confirm the toggle appears, auto-on fires for the cursive sheet, the preview shows joined letters, and toggling off returns to flourish overhang. (Manual; the automated gate is Task 6.)

- [ ] **Step 7: Commit.**

```bash
git add src/components/Maker.tsx
git commit -m 'Add connected-cursive toggle and auto-detect to the maker UI'
```

---

### Task 6: Tests — corpus connect fixture + join metric, and an e2e

**Files:**
- Modify: `e2e-corpus/corpus.spec.ts` (add a connect-mode build + a join-gap metric for the cursive fixture).
- Create: `e2e/fixtures/corpus/connected-cursive.png` (copy of the field sheet).
- Create: `e2e/connect.spec.ts`.

**Interfaces:**
- Consumes: the maker UI from Task 5, `connectGlyphs` via the build.

- [ ] **Step 1: Add the fixture.** Copy the field sheet to `e2e/fixtures/corpus/connected-cursive.png`. (It now builds through the corpus harness like every other face.)

- [ ] **Step 2: Add a join-gap metric to the corpus measure.** In `e2e-corpus/corpus.spec.ts`, when the face is built in connect mode, compute the median lowercase→lowercase JOIN gap over a set of in-band joining pairs (reuse `pairGap`), excluding break boundaries (pairs starting with `g j q y z`, or any digit/punct/space). Assert: no joining pair gap `> ~3% UPM` (else the face reads disconnected) and the existing fusion gate still holds (no weld). Drive connect mode by toggling the UI control before the build for this fixture only.

```ts
// inside the per-sheet test, for the connected-cursive fixture only:
if (sheet.name === 'connected-cursive') {
  await page.getByRole('button', { name: 'advanced' }).click();
  await page.getByRole('button', { name: /connected cursive/ }).click();
  await page.getByRole('button', { name: 'rebuild with these settings' }).click();
  await expect(page.getByRole('button', { name: 'download otf' })).toBeVisible({ timeout: 150_000 });
}
```
Then after `measure`, add the join-gap assertion using a new measured field (compute in-page like the other metrics; JOIN_PAIRS = ['an','ne','en','nn','mi','in','re','er','ou','un'] etc.; exclude break-starters).

- [ ] **Step 3: Write `e2e/connect.spec.ts`** — drop the fixture, enable connect, build, download otf, assert: opentype parses it, `verifySfntChecksums`-equivalent passes (the maker already gates), glyph count ≥ 60, and the rendered strip has no horizontal overflow / the join metric is clean. Mirror `e2e/maker.spec.ts` structure.

- [ ] **Step 4: Run the suites.** Kill 4321. `npm run test:corpus` (the new fixture builds + the join metric gates; eyeball `test-results/corpus-contact.png`). `npm run test:e2e -- connect`. Both green.

- [ ] **Step 5: fontTools validation.** Build the connect OTF (from the corpus output or a manual build), run Python `from fontTools.ttLib import TTFont; TTFont(path, checkChecksums=2)` plus a `head.checkSumAdjustment` recompute. Must pass.

- [ ] **Step 6: Commit.**

```bash
git add e2e-corpus/corpus.spec.ts e2e/fixtures/corpus/connected-cursive.png e2e/connect.spec.ts
git commit -m 'Gate connected-cursive joins in the corpus harness and e2e'
```

---

### Task 7: Input contract — script generate preset + connector guide on the template sheet

**Files:**
- Modify: `src/pages/make.astro` (the `PRESETS`, `PRESET_CHARSETS`, and `.fh-gen-presets` chip group around lines 80-315).
- Modify: `src/lib/maker.ts` (`makeTemplateSheet`, ~1245, add the connector guide line per row).

**Interfaces:**
- Consumes: the existing preset arming (`fh-gen-charset` localStorage), `connect` mode.

- [ ] **Step 1: Add the "script" chip** to `.fh-gen-presets` (after `monoline`): `<button type="button" class="fh-chip fh-preset" data-preset="script" aria-pressed="false">script</button>`.

- [ ] **Step 2: Add the `script` preset to `PRESETS`** — a prompt builder instructing: a connected cursive, every lowercase letter drawn with entry and exit strokes that meet a single common baseline connector line and reach the left and right cell edges, one character per box, 7 rows (A-M / N-Z / a-m / n-z / 0-9 / symbols / symbols), dark pen on white. One fill slot for a style word. American spelling, no em dashes. (Mirror the `standard` preset's shape.)

- [ ] **Step 3: Add the `script` entry to `PRESET_CHARSETS`** — the same 7-row charset as `standard` (so a generated sheet auto-arms).

- [ ] **Step 4: Add the connector guide to `makeTemplateSheet`.** In the per-row loop (after the dashed baseline), draw a second faint dashed line at the connector height `baseline - rowH * 0.62 * <BAND_HI-ish>` in the same `GUIDE` gray, and a margin note: to join after g j q y z, flick a baseline connector. Keep it above the 128 threshold so it never traces.

- [ ] **Step 5: Verify.** Kill 4321; `npm run dev`; on `/make` pick the script preset, confirm the prompt + armed charset, and that the printable sheet shows the connector guide. `npm test` (onboarding/charset specs still green; extend `onboarding.spec` if it enumerates presets).

- [ ] **Step 6: Commit.**

```bash
git add src/pages/make.astro src/lib/maker.ts
git commit -m 'Add script generate preset and connector guide sheet'
```

---

### Task 8: Adversarial review + final verification

**Files:** none (review + fix loop).

- [ ] **Step 1: Full type check + all free tests.** `npx tsc --noEmit -p tsconfig.json`; `npm test`; `npm run test:corpus`; `npm run test:e2e`. All green. Capture the corpus contact sheet.

- [ ] **Step 2: Adversarial diff review.** Run a multi-agent review workflow over the branch diff (correctness, regression to the existing trim/script path, validity, the coordinate math, UI state). Fix confirmed findings, each as its own commit.

- [ ] **Step 3: Build the real sheet end-to-end** in the built worker (`npx astro build && npx wrangler dev --port 8788 --local`), publish-preview it, and hand Stephen the final strip + a downloadable OTF. Gate: he confirms it feels right (the final A&C gate).

- [ ] **Step 4: fontTools authoritative pass** on the published OTF (`checkChecksums=2` + checkSumAdjustment recompute).

- [ ] **Step 5: Stop.** Do not push/merge to master (auto-deploys) until Stephen authorizes the deploy.

## Self-review

- **Spec coverage:** §0 anchor → Task 2; §1 algorithm → Tasks 1-3; §2 constants → Task 0 calibration + Task 3; §3 buildFont/editMonoRow/kerning/style → Task 4; §4 join table → Task 1; §5 coordinate contract → Tasks 2-3 (translate-x only); §6 residual risks → carried as comments + the corpus metric; §7 validation → Tasks 0 + 6 + 8; input contract → Task 7; UX/auto/toggle → Task 5. No uncovered section.
- **Placeholder scan:** the only deferred numbers are the Task 0 calibration outputs, which is the point of Task 0; every code step shows real code.
- **Type consistency:** `connectGlyphs`/`faceMetrics`/`joinClass`/`anchorAdvance` signatures match between definition (Tasks 1-3) and use (Task 4); `BuildOpts.connect`/`connectOverlapPct` consistent across Tasks 4-5; `editMonoRow` extra args consistent Tasks 4-5.
