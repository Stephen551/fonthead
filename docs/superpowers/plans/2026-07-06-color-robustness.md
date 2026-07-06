# Color Robustness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the color font pipeline (COLRv0 flat / COLRv1 gradient) the same measured corpus footing mono has, then land the first fixes (live GPOS kerning, visible failure states) with the gates watching.

**Architecture:** A canvas-rendered color fixture set (`e2e/fixtures/corpus-color/`) plus a new corpus spec (`e2e-corpus/corpus-color.spec.ts`) that builds every fixture through the real engine at `/make` and gates validity, COLR status, palette, coverage, and confidence flags. Unit tests load the `color-core.js` IIFE into a sandbox (the `test/gpos.test.ts` pattern). The GPOS fix is pure wiring: `compileFeatures` already writes GPOS when `buildGposKern` exists; the main thread just never loads `font-engine-gpos.js` and `injectKernIfAny` only injects the `kern` tag.

**Tech Stack:** Playwright (corpus config `playwright.corpus.config.ts`), vitest (jsdom), the vendored client-side font engine (`public/assets/`), Astro 5.

**Spec:** `docs/superpowers/specs/2026-07-06-color-robustness-design.md`

## Global Constraints

- Voice rules apply to every string, comment, and doc line: no em dashes, no exclamation marks, American spelling (color, not colour) in OUR files. The vendored engine's existing "colour" comments stay untouched except in lines this plan explicitly rewrites.
- User-facing copy (the new warning strings in Task 6) must be surfaced to Stephen for approval before ship. Ship them behind his exact wording.
- Engine edits (`public/assets/`) are surgical and additive. Never hardcode a `?v=` cache token; the content hash handles busting automatically.
- Stage specific files only (`git add file1 file2`). Never `git add -A`.
- `npm test` must pass before every commit. `npx tsc --noEmit -p tsconfig.json` is the type check (never `npm run check`).
- Kill any running dev server before builds or e2e: `taskkill //F //IM workerd.exe` (workerd only, never node.exe). The corpus config starts `npm run dev` itself and reuses an existing one.
- Commit via the Bash tool with single-quoted messages (PowerShell here-strings corrupt quotes). End commit messages with the Co-Authored-By line.
- The corpus webserver is astro dev (`npm run dev`), which has local bindings via platformProxy; no wrangler build needed for these tests.

---

### Task 1: Color fixture generator

**Files:**
- Create: `scripts/gen-color-corpus.mjs`
- Modify: `package.json` (add `gen:color-corpus` script beside `gen:corpus`)
- Create (generated, committed): `e2e/fixtures/corpus-color/*.png` (8 fixtures)

**Interfaces:**
- Produces: 8 PNG sheets named `flat-2color`, `flat-3color`, `flat-shadow`, `flat-light`, `flat-outline`, `flat-lowres`, `gradient-basic`, `gradient-shadow` in `e2e/fixtures/corpus-color/`. Task 4's spec reads this directory and keys expectations by these exact names. Six rows: `A-M / N-Z / a-m / n-z / 0-9 / .,!?:;'-&@#` (the same rows as `scripts/gen-corpus.mjs`, so the geometry charset guess lands without arming).

- [ ] **Step 1: Write the generator**

Create `scripts/gen-color-corpus.mjs`. It mirrors `scripts/gen-corpus.mjs` (Playwright Chromium, canvas, probe-or-skip) but varies color treatment over one heavy face instead of varying the typeface:

```js
// Color corpus sheet generator: renders COLOR alphabet sheets into
// e2e/fixtures/corpus-color/. One heavy system face (color separation is the
// variable under test, not letterform style); each fixture is one color
// treatment the pipeline must survive: flat multi-color, drop shadow, light
// ink, outline, gradient, low resolution. The layout mirrors gen-corpus.mjs
// (same six rows) so the geometry charset guess resolves without arming.
// Static field-failure PNGs dropped into the output directory survive
// regeneration: only the names in SHEETS are rewritten.
//
// Usage: node scripts/gen-color-corpus.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'e2e/fixtures/corpus-color';
mkdirSync(OUT, { recursive: true });

const FACE = { family: 'Arial Black', fallback: 'Arial', weight: 900 };
const ROWS = ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', 'abcdefghijklm', 'nopqrstuvwxyz', '0123456789', ".,!?:;'-&@#"];

// One entry per fixture. colors cycle per letter (flat); gradient paints a
// per-row vertical ramp; shadow is a hard offset duplicate (blur 0), the
// exact signature detectShadowMask tests for; outline is a strokeText ring.
const SHEETS = {
  'flat-2color': { kind: 'flat', colors: ['#c22a1e', '#1e4fc2'] },
  'flat-3color': { kind: 'flat', colors: ['#c22a1e', '#1e4fc2', '#159146'] },
  'flat-shadow': { kind: 'flat', colors: ['#e0341f', '#f0a51c'], shadow: { color: '#3a3a3a', dx: 7, dy: 7 } },
  'flat-light': { kind: 'flat', colors: ['#f2df6a', '#f4b8d0'] },
  'flat-outline': { kind: 'flat', colors: ['#f7a01e'], outline: { color: '#141414', width: 6 } },
  'flat-lowres': { kind: 'flat', colors: ['#c22a1e', '#1e4fc2'], rowH: 130 },
  'gradient-basic': { kind: 'gradient', gradient: ['#c41608', '#e64a0c', '#f7a01e', '#ffde5a'] },
  'gradient-shadow': { kind: 'gradient', gradient: ['#28a0c8', '#7a3fd0'], shadow: { color: '#3a3a3a', dx: 7, dy: 7 } },
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 100, height: 100 } });
await page.setContent('<body></body>');

const results = await page.evaluate(
  async ({ face, rows, sheets }) => {
    // probe: a real face measures differently from the generic fallbacks
    const probe = document.createElement('canvas').getContext('2d');
    const pw = (fam) => { probe.font = `100px '${fam}'`; return probe.measureText('mWQil10').width; };
    let family = face.family;
    if (Math.abs(pw(face.family) - pw('serif')) < 0.5 && Math.abs(pw(face.family) - pw('sans-serif')) < 0.5) {
      family = face.fallback;
    }

    const made = {};
    for (const [name, spec] of Object.entries(sheets)) {
      const W = 2200;
      const rowH = spec.rowH || 265;
      const top = 70;
      const H = top + rows.length * rowH + 40;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      rows.forEach((row, r) => {
        const rowTop = top + r * rowH;
        const baseline = rowTop + rowH * 0.62;
        const n = row.length;
        const cellW = W / n;
        let size = Math.floor(rowH * 0.55);
        ctx.font = `${face.weight} ${size}px '${family}'`;
        const widest = Math.max(...[...row].map((ch) => ctx.measureText(ch).width)) || 1;
        const maxGlyphW = cellW * 0.66;
        if (widest > maxGlyphW) {
          size = Math.max(40, Math.floor((size * maxGlyphW) / widest));
          ctx.font = `${face.weight} ${size}px '${family}'`;
        }
        // per-row gradient (letter-relative vertical ramp, like the sample sheet)
        let grad = null;
        if (spec.gradient) {
          grad = ctx.createLinearGradient(0, baseline, 0, rowTop + rowH * 0.08);
          spec.gradient.forEach((c, i) => grad.addColorStop(i / (spec.gradient.length - 1), c));
        }
        for (let i = 0; i < n; i++) {
          const x = i * cellW + cellW / 2;
          if (spec.shadow) {
            ctx.shadowColor = spec.shadow.color;
            ctx.shadowOffsetX = spec.shadow.dx;
            ctx.shadowOffsetY = spec.shadow.dy;
            ctx.shadowBlur = 0;
          }
          ctx.fillStyle = grad || spec.colors[i % spec.colors.length];
          ctx.fillText(row[i], x, baseline);
          if (spec.shadow) { ctx.shadowColor = 'transparent'; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; }
          if (spec.outline) {
            ctx.lineWidth = spec.outline.width;
            ctx.strokeStyle = spec.outline.color;
            ctx.strokeText(row[i], x, baseline);
          }
        }
      });
      made[name] = canvas.toDataURL('image/png').split(',')[1];
    }
    return { made, family };
  },
  { face: FACE, rows: ROWS, sheets: SHEETS },
);

for (const [name, b64] of Object.entries(results.made)) {
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(b64, 'base64'));
}
console.log(`written (${results.family}): ${Object.keys(results.made).join(', ')}`);
await browser.close();
```

- [ ] **Step 2: Add the npm script**

In `package.json`, directly under `"gen:corpus": "node scripts/gen-corpus.mjs"`, add:

```json
"gen:color-corpus": "node scripts/gen-color-corpus.mjs"
```

- [ ] **Step 3: Run it and eyeball the output**

Run: `npm run gen:color-corpus`
Expected: `written (Arial Black): flat-2color, flat-3color, ...` and 8 PNGs in `e2e/fixtures/corpus-color/`. Open two or three with the Read tool (they are images): letters must sit one per cell with clear gaps, colors as specified, shadow visibly offset on the shadow fixtures.

- [ ] **Step 4: Verify tests still green and commit**

Run: `npm test`
Expected: PASS (nothing touched the app).

```bash
git add scripts/gen-color-corpus.mjs package.json e2e/fixtures/corpus-color/flat-2color.png e2e/fixtures/corpus-color/flat-3color.png e2e/fixtures/corpus-color/flat-shadow.png e2e/fixtures/corpus-color/flat-light.png e2e/fixtures/corpus-color/flat-outline.png e2e/fixtures/corpus-color/flat-lowres.png e2e/fixtures/corpus-color/gradient-basic.png e2e/fixtures/corpus-color/gradient-shadow.png
git commit -m 'Color corpus: fixture generator + 8 treatment sheets

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>'
```

---

### Task 2: color-core unit tests, palette + shadow

**Files:**
- Create: `test/color-core.test.ts`

**Interfaces:**
- Consumes: `public/assets/color-core.js` IIFE globals via sandbox load (`new Function('self', code)(sandbox)`, the `test/gpos.test.ts` pattern). Signatures under test (from the source):
  - `detectPalette(data, w, h, K, opts) -> { colors: [{r,g,b,lab,count}], bg, bgDist, mono }` (colors sorted by count descending)
  - `detectShadowMask(data, w, h, palette) -> Uint8Array | null`
- Produces: the `blank`/`rect`/`drawH` pixel-buffer helpers Task 3 reuses (export nothing; Task 3 copies them into its own file so each test file is self-contained).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Load the browser IIFE into a sandbox (the gpos.test.ts pattern).
const code = readFileSync(join(__dirname, '..', 'public', 'assets', 'color-core.js'), 'utf-8');
const sandbox: { ColorCore?: any } = {};
new Function('self', code)(sandbox);
const CC = sandbox.ColorCore!;

type RGB = [number, number, number];

function blank(w: number, h: number, bg: RGB = [255, 255, 255]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    data[p * 4] = bg[0]; data[p * 4 + 1] = bg[1]; data[p * 4 + 2] = bg[2]; data[p * 4 + 3] = 255;
  }
  return data;
}

function rect(data: Uint8ClampedArray, w: number, x0: number, y0: number, x1: number, y1: number, [r, g, b]: RGB) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * w + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b;
  }
}

// A thin-stroked H: two 6px vertical bars + a crossbar. Thin strokes matter
// for the shadow tests: an offset copy of a thin shape stays mostly visible,
// so the dark centroid sits close to the true offset vector.
function drawH(data: Uint8ClampedArray, w: number, x: number, y: number, color: RGB) {
  rect(data, w, x, y, x + 6, y + 40, color);
  rect(data, w, x + 22, y, x + 28, y + 40, color);
  rect(data, w, x + 6, y + 17, x + 22, y + 23, color);
}

const RED: RGB = [224, 32, 32];
const BLUE: RGB = [30, 79, 194];
const DARK: RGB = [60, 60, 60];

describe('detectPalette', () => {
  it('finds two colors on a two-color sheet, largest area first', () => {
    const w = 400, h = 200;
    const data = blank(w, h);
    rect(data, w, 20, 40, 120, 140, RED);   // 100x100 red
    rect(data, w, 200, 40, 260, 100, BLUE); // 60x60 blue
    const pal = CC.detectPalette(data, w, h, 3, {});
    expect(pal.mono).toBe(false);
    expect(pal.colors.length).toBe(2);
    expect(pal.colors[0].count).toBeGreaterThan(pal.colors[1].count);
    expect(pal.colors[0].r).toBeGreaterThan(150); // red is the bigger area
  });

  it('collapses a monochrome sheet to one color (mono)', () => {
    const w = 300, h = 150;
    const data = blank(w, h);
    rect(data, w, 20, 20, 200, 120, RED);
    const pal = CC.detectPalette(data, w, h, 3, {});
    expect(pal.mono).toBe(true);
    expect(pal.colors.length).toBe(1);
  });

  it('returns no colors on an empty sheet', () => {
    const pal = CC.detectPalette(blank(200, 100), 200, 100, 3, {});
    expect(pal.colors.length).toBe(0);
    expect(pal.mono).toBe(true);
  });

  it('halo gate: near-background low-chroma haze is not a color', () => {
    const w = 300, h = 150;
    const data = blank(w, h);
    rect(data, w, 20, 20, 200, 120, [242, 242, 242]); // faint gray wash
    const pal = CC.detectPalette(data, w, h, 3, {});
    expect(pal.colors.length).toBe(0);
  });
});

describe('detectShadowMask', () => {
  it('fires on an offset dark duplicate of the letters', () => {
    const w = 500, h = 120;
    const data = blank(w, h);
    // four H letters, each with a dark copy shifted +5/+5 drawn FIRST
    for (let i = 0; i < 4; i++) {
      const x = 30 + i * 110;
      drawH(data, w, x + 5, 35, DARK);
      drawH(data, w, x, 30, RED);
    }
    const pal = CC.detectPalette(data, w, h, 3, {});
    expect(pal.colors.length).toBe(2);
    const mask = CC.detectShadowMask(data, w, h, pal);
    expect(mask).not.toBeNull();
    let n = 0; for (let p = 0; p < w * h; p++) if (mask![p]) n++;
    expect(n).toBeGreaterThan(200); // the visible dark rim is real ink area
  });

  it('does not fire on a concentric dark outline', () => {
    const w = 500, h = 120;
    const data = blank(w, h);
    for (let i = 0; i < 4; i++) {
      const x = 30 + i * 110;
      rect(data, w, x - 3, 27, x + 33, 73, DARK); // outline ring drawn first
      rect(data, w, x, 30, x + 30, 70, RED);      // fill covers the center
    }
    const pal = CC.detectPalette(data, w, h, 3, {});
    const mask = CC.detectShadowMask(data, w, h, pal);
    expect(mask).toBeNull();
  });

  it('does not fire with fewer than two palette colors', () => {
    const w = 300, h = 100;
    const data = blank(w, h);
    rect(data, w, 20, 20, 200, 80, RED);
    const pal = CC.detectPalette(data, w, h, 3, {});
    const mask = CC.detectShadowMask(data, w, h, pal);
    expect(mask).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they run against the real module**

Run: `npx vitest run test/color-core.test.ts`
Expected: PASS if the engine behaves as documented. If any test FAILS, do not weaken the assertion to green it. Read the failing function, decide honestly whether the test's synthetic input misses a documented gate (fix the test) or the engine misbehaves (record it as a Task 7 finding and mark the test `it.fails` with a comment naming the finding). These tests characterize a shipped engine; a discovered defect is a corpus finding, not a test bug.

- [ ] **Step 3: Full suite + commit**

Run: `npm test`
Expected: PASS.

```bash
git add test/color-core.test.ts
git commit -m 'Unit tests: color-core palette detection + shadow mask

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>'
```

---

### Task 3: color-core unit tests, separation + spacing + gradient

**Files:**
- Create: `test/color-separate.test.ts`

**Interfaces:**
- Consumes: same sandbox load as Task 2 (copy the loader and the `blank`/`rect` helpers into this file; the files stay self-contained). Signatures under test:
  - `separateGlyph(data, w, h, palette, char) -> { totalInk, union, layers: [{paletteIndex, mask}], bodyMinX, bodyMaxX, strayDropped }` (union is RGBA, ink = black so `union[(y*w+x)*4] === 0`)
  - `bodyBoundsX(mask, w, h) -> { minX, maxX }` (mask is Uint8 0/1; maxX is exclusive)
  - `sampleFireGradient(data, w, h, rows, opts) -> { stops: [{offset,r,g,b}], bg }` (rows are `[y0, y1]` tuples; offset 0 = baseline color, offset 1 = top color)

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const code = readFileSync(join(__dirname, '..', 'public', 'assets', 'color-core.js'), 'utf-8');
const sandbox: { ColorCore?: any } = {};
new Function('self', code)(sandbox);
const CC = sandbox.ColorCore!;

type RGB = [number, number, number];
function blank(w: number, h: number, bg: RGB = [255, 255, 255]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    data[p * 4] = bg[0]; data[p * 4 + 1] = bg[1]; data[p * 4 + 2] = bg[2]; data[p * 4 + 3] = 255;
  }
  return data;
}
function rect(data: Uint8ClampedArray, w: number, x0: number, y0: number, x1: number, y1: number, [r, g, b]: RGB) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * w + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b;
  }
}
const RED: RGB = [224, 32, 32];
const BLUE: RGB = [30, 79, 194];
const palette2 = { colors: [{ r: 224, g: 32, b: 32 }, { r: 30, g: 79, b: 194 }], bg: { r: 255, g: 255, b: 255 }, bgDist: 20 };
const inkAt = (union: Uint8ClampedArray, w: number, x: number, y: number) => union[(y * w + x) * 4] === 0;

describe('separateGlyph', () => {
  it('splits a two-color glyph into two layers', () => {
    const w = 80, h = 100;
    const data = blank(w, h);
    rect(data, w, 20, 10, 60, 50, RED);
    rect(data, w, 20, 50, 60, 90, BLUE);
    const g = CC.separateGlyph(data, w, h, palette2, 'o');
    expect(g.layers.length).toBe(2);
    expect(g.totalInk).toBe(40 * 80);
    expect(g.strayDropped).toBe(false);
  });

  it('culls a stray minor island for a single-shape glyph, keeps it for MULTI_PART', () => {
    const w = 80, h = 100;
    const mk = () => {
      const d = blank(w, h);
      rect(d, w, 20, 30, 50, 60, RED);  // 30x30 body
      rect(d, w, 60, 5, 70, 15, RED);   // 10x10 distant crumb (over despeckle absMin, under half)
      return d;
    };
    const o = CC.separateGlyph(mk(), w, h, palette2, 'o');
    expect(o.strayDropped).toBe(true);
    expect(inkAt(o.union, w, 65, 10)).toBe(false);
    const i = CC.separateGlyph(mk(), w, h, palette2, 'i');
    expect(i.strayDropped).toBe(false); // an i dot is legitimate
    expect(inkAt(i.union, w, 65, 10)).toBe(true);
  });

  it('never culls two big halves (a mis-slice to flag, not delete)', () => {
    const w = 80, h = 100;
    const data = blank(w, h);
    rect(data, w, 10, 20, 35, 80, RED);
    rect(data, w, 45, 20, 70, 80, BLUE);
    const g = CC.separateGlyph(data, w, h, palette2, 'o');
    expect(g.strayDropped).toBe(false);
    expect(inkAt(g.union, w, 20, 50)).toBe(true);
    expect(inkAt(g.union, w, 60, 50)).toBe(true);
  });

  it('trims a neighbour-row strip fused to the top edge, spares a top-heavy cap', () => {
    const w = 80, h = 100;
    // bleed: wide strip rows 0-5, thin neck rows 6-11, much wider body below
    const bleed = blank(w, h);
    rect(bleed, w, 20, 0, 60, 6, RED);    // strip width 40 at the very edge
    rect(bleed, w, 36, 6, 44, 12, RED);   // neck width 8 (fused, not an island)
    rect(bleed, w, 5, 12, 75, 90, RED);   // body width 70 (>= 1.6x the edge)
    const gb = CC.separateGlyph(bleed, w, h, palette2, 'o');
    expect(inkAt(gb.union, w, 30, 2)).toBe(false);  // strip cleared
    expect(inkAt(gb.union, w, 40, 50)).toBe(true);  // body intact
    // top-heavy cap: wide top but the body below is NARROWER, must be spared
    const cap = blank(w, h);
    rect(cap, w, 10, 0, 70, 10, RED);   // T crossbar width 60
    rect(cap, w, 33, 10, 47, 90, RED);  // stem width 14
    const gc = CC.separateGlyph(cap, w, h, palette2, 'T');
    expect(inkAt(gc.union, w, 40, 4)).toBe(true);   // crossbar untouched
  });
});

describe('bodyBoundsX', () => {
  const mask = (w: number, h: number, boxes: Array<[number, number, number, number]>) => {
    const m = new Uint8Array(w * h);
    for (const [x0, y0, x1, y1] of boxes) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 1;
    return m;
  };
  it('merges an x-overlapping detached part, drops a beside-the-body fragment', () => {
    const w = 100, h = 100;
    const m = mask(w, h, [
      [10, 10, 40, 60],  // body (largest)
      [15, 70, 35, 95],  // detached descender, x-overlaps the body
      [60, 30, 75, 45],  // neighbour-bleed fragment beside the body
    ]);
    const b = CC.bodyBoundsX(m, w, h);
    expect(b.minX).toBe(10);
    expect(b.maxX).toBe(40); // descender inside, side fragment out
  });
});

describe('sampleFireGradient', () => {
  it('samples a vertical ramp: baseline stop from the bottom color, top stop from the top color', () => {
    const w = 60, h = 100;
    const data = blank(w, h);
    rect(data, w, 10, 20, 50, 50, [250, 210, 40]); // yellow upper half of the band
    rect(data, w, 10, 50, 50, 80, [200, 24, 12]);  // red lower half
    const g = CC.sampleFireGradient(data, w, h, [[20, 80]], { stops: 3 });
    expect(g.stops.length).toBe(3);
    expect(g.stops[0].r).toBeGreaterThan(150); // offset 0 = baseline = red
    expect(g.stops[0].g).toBeLessThan(100);
    expect(g.stops[2].g).toBeGreaterThan(150); // offset 1 = top = yellow
  });

  it('chroma gate: a gray outline does not drag the stops muddy', () => {
    const w = 60, h = 100;
    const data = blank(w, h);
    rect(data, w, 10, 20, 50, 50, [250, 210, 40]);
    rect(data, w, 10, 50, 50, 80, [200, 24, 12]);
    rect(data, w, 0, 20, 8, 80, [85, 85, 85]); // gray column, chroma under the 18 gate
    const g = CC.sampleFireGradient(data, w, h, [[20, 80]], { stops: 3 });
    expect(g.stops[2].g).toBeGreaterThan(150); // still yellow, not muddied
  });
});
```

- [ ] **Step 2: Run**

Run: `npx vitest run test/color-separate.test.ts`
Expected: PASS, with the same honesty rule as Task 2 Step 2 for any failure (characterize, do not paper over).

- [ ] **Step 3: Full suite + commit**

Run: `npm test`
Expected: PASS.

```bash
git add test/color-separate.test.ts
git commit -m 'Unit tests: color separation culls, body bounds, gradient sampling

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>'
```

---

### Task 4: Color corpus spec + build verification hook

**Files:**
- Modify: `src/components/Maker.tsx` (add `window.__lastColor` beside the existing `__lastBuild` hook at ~line 363)
- Create: `e2e-corpus/corpus-color.spec.ts`

**Interfaces:**
- Consumes: fixture PNGs from Task 1; `window.__lastBuild` (`{kind, glyphCount, colrStatus, ...}`, Maker.tsx:363); the maker UI (`#sheet-file` input, `color · flat` / `color · gradient` kind buttons, `download otf` button); `verifySfntChecksums` from `src/lib/sfnt`.
- Produces: `window.__lastColor: { colrStatus: string; rowWarning: string; glowWarning: boolean; flags: Record<string, number> }` (Task 6's warning work and any future spec assertions read this); `test-results/corpus-color-strips/*.png` and `test-results/corpus-color-contact.png`; the `EXPECT` table Task 5 extends with the GPOS gate.

- [ ] **Step 1: Add the `__lastColor` hook in Maker.tsx**

In the color branch of `run()`, immediately after `rep = cres.report || [];` (~line 293, inside the `if (isColor)` block, where `cres` is still in scope — the later `warn` variable conflates rowWarning with the glow message, so read the raw fields here):

```tsx
        // color verification hook (harmless, mirrors __lastBuild): the corpus
        // gates colrStatus, row alignment, and the confidence-flag budget
        const flagCounts: Record<string, number> = {};
        for (const r of rep) for (const f of r.flags) flagCounts[f] = (flagCounts[f] ?? 0) + 1;
        (window as any).__lastColor = {
          colrStatus: cres.colrStatus,
          rowWarning: cres.rowWarning || '',
          glowWarning: !!cres.glowWarning,
          flags: flagCounts,
        };
```

The report flags come from the orchestrator's `computeConfidence` ('empty', 'wide', 'narrow', 'stray', 'filled').

- [ ] **Step 2: Write the corpus spec**

Create `e2e-corpus/corpus-color.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { verifySfntChecksums, isOtf } from '../src/lib/sfnt';

// The color lint. Every color fixture builds through the real engine (flat
// COLRv0/CPAL or gradient COLRv1 by name prefix) and the result is gated:
// valid sfnt, COLR authored (never the silent mono fallback), rows aligned,
// full charset coverage, the intended palette size, and a zero confidence-
// flag budget on these clean synthetic sheets. Field-failure PNGs dropped
// into e2e/fixtures/corpus-color/ build too; unknown names get the default
// gates (no palette assertion) so a broken field sheet can land as a fixture
// before its fix. A per-fixture strip + a contact sheet land in test-results
// for the thirty-second eyeball pass (Chromium renders COLR in color).

const ROOT = process.cwd();
const CORPUS_DIR = join(ROOT, 'e2e', 'fixtures', 'corpus-color');
const OUT_DIR = join(ROOT, 'test-results');
const STRIPS = join(OUT_DIR, 'corpus-color-strips');

// name -> expectations. palette = CPAL entry count for flat fixtures.
const EXPECT: Record<string, { palette?: number }> = {
  'flat-2color': { palette: 2 },
  'flat-3color': { palette: 3 },
  'flat-shadow': { palette: 2 },   // the dark offset copy strips, never a palette entry
  'flat-light': { palette: 2 },    // pale ink must not vanish
  'flat-outline': { palette: 2 },  // concentric outline is real ink, not a shadow
  'flat-lowres': { palette: 2 },
  'gradient-basic': {},
  'gradient-shadow': {},
};

// 13+13+13+13+10+11 cells; the charset guess pins letters and digits exactly.
const FULL_CHARSET = 73;
const GLYPHS_MIN = 70;

const sheets = readdirSync(CORPUS_DIR)
  .filter((f) => f.endsWith('.png'))
  .map((f) => ({ name: f.replace('.png', ''), path: join(CORPUS_DIR, f) }));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('fh-maker-tour-seen', '1');
    } catch {
      /* private mode */
    }
  });
});

// --- sfnt table reads (offsets per the OpenType spec) ----------------------
function tableSlice(b: Uint8Array, tag: string): Uint8Array | null {
  const u16 = (o: number) => (b[o] << 8) | b[o + 1];
  const u32 = (o: number) => b[o] * 0x1000000 + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
  const n = u16(4);
  for (let i = 0; i < n; i++) {
    const rec = 12 + i * 16;
    const t = String.fromCharCode(b[rec], b[rec + 1], b[rec + 2], b[rec + 3]);
    if (t === tag) return b.subarray(u32(rec + 8), u32(rec + 8) + u32(rec + 12));
  }
  return null;
}
const u16At = (t: Uint8Array, o: number) => (t[o] << 8) | t[o + 1];

for (const sheet of sheets) {
  const mode = sheet.name.startsWith('gradient') ? 'gradient' : 'flat';
  const exp = EXPECT[sheet.name] ?? {};

  test(`color corpus: ${sheet.name}`, async ({ page }) => {
    await page.goto('/make');
    await page.getByRole('button', { name: `color · ${mode}`, exact: true }).click();
    await page.locator('#sheet-file').setInputFiles(sheet.path);
    await expect(page.getByRole('button', { name: 'download otf' })).toBeVisible({ timeout: 150_000 });

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'download otf' }).click(),
    ]);
    const otfPath = test.info().outputPath(`${sheet.name}.otf`);
    await download.saveAs(otfPath);
    const otf = new Uint8Array(readFileSync(otfPath));

    const lb = await page.evaluate(() => (window as any).__lastBuild);
    const lc = await page.evaluate(() => (window as any).__lastColor);

    console.log(
      `COLOR-CORPUS | ${sheet.name.padEnd(18)} | ${mode} glyphs=${lb.glyphCount} colr=${lc.colrStatus} ` +
        `rowWarn=${lc.rowWarning ? 'YES' : 'no'} glow=${lc.glowWarning} flags=${JSON.stringify(lc.flags)}`,
    );

    // validity
    expect(isOtf(otf), 'real OTF signature').toBe(true);
    const check = verifySfntChecksums(otf);
    expect(check.ok, `sfnt checksums valid: ${check.errors.join('; ')}`).toBe(true);

    // COLR authored, hard gate: a silent mono fallback is a failure
    expect(lc.colrStatus, 'COLR authoring').toBe('ok');

    // rows aligned + full coverage
    expect(lc.rowWarning, 'row alignment').toBe('');
    expect(lb.glyphCount, 'charset coverage').toBeGreaterThanOrEqual(GLYPHS_MIN);
    expect(lb.glyphCount, 'charset coverage (over-slice)').toBeLessThanOrEqual(FULL_CHARSET + 2);

    // table structure
    const colr = tableSlice(otf, 'COLR');
    const cpal = tableSlice(otf, 'CPAL');
    expect(colr, 'COLR present').not.toBeNull();
    expect(cpal, 'CPAL present').not.toBeNull();
    if (mode === 'flat') {
      expect(u16At(colr!, 0), 'COLR version').toBe(0);
      // every colored base glyph keeps at least one layer
      expect(u16At(colr!, 2), 'base glyph records').toBeGreaterThanOrEqual(lb.glyphCount - 2);
      if (exp.palette != null) expect(u16At(cpal!, 2), 'CPAL palette entries').toBe(exp.palette);
    } else {
      expect(u16At(colr!, 0), 'COLR version').toBe(1);
    }

    // confidence-flag budget: clean synthetic sheets earn zero
    for (const f of ['stray', 'filled', 'empty'] as const) {
      expect(lc.flags[f] ?? 0, `${f} flags`).toBe(0);
    }

    // strip for the contact sheet (Chromium renders COLR in color)
    const b64 = readFileSync(otfPath).toString('base64');
    await page.setContent(`
      <style>@font-face { font-family: f; src: url(data:font/otf;base64,${b64}); }</style>
      <div id="strip" style="background:#fff;padding:10px 16px;width:1100px;">
        <div style="font-family:monospace;font-size:12px;color:#888;">${sheet.name}</div>
        <div style="font-family:f;font-size:42px;white-space:nowrap;">The quick brown fox jumps over</div>
        <div style="font-family:f;font-size:42px;white-space:nowrap;">AVATAR To 0123456789 .,!?</div>
      </div>`);
    await page.waitForTimeout(400);
    mkdirSync(STRIPS, { recursive: true });
    await page.locator('#strip').screenshot({ path: join(STRIPS, `${sheet.name}.png`) });
  });
}

test('color contact sheet', async ({ page }) => {
  const strips = readdirSync(STRIPS).filter((f) => f.endsWith('.png'));
  expect(strips.length, 'strips rendered by the fixture tests').toBeGreaterThan(0);
  const imgs = strips
    .map((f) => `<img style="display:block;" src="data:image/png;base64,${readFileSync(join(STRIPS, f)).toString('base64')}">`)
    .join('');
  await page.setContent(`<div id="contact" style="background:#fff;">${imgs}</div>`);
  await page.locator('#contact').screenshot({ path: join(OUT_DIR, 'corpus-color-contact.png') });
});
```

- [ ] **Step 3: Type check + build clean**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: clean.

- [ ] **Step 4: Run the color corpus**

Kill any running dev server first (`taskkill //F //IM workerd.exe`; ignore not-found). Then:

Run: `npx playwright test -c playwright.corpus.config.ts corpus-color`
Expected: the 8 fixture tests run (several minutes; color builds are main-thread). Record every failure verbatim; do NOT immediately fix. Two categories:
- A gate that is simply miscalibrated against healthy output (for example the punct row splitting so `rowWarning` is non-empty on a visually fine build): adjust the gate, with the measured number in a comment, the way the mono gates carry their calibration history.
- A real defect (a vanished layer, stray flags on a clean sheet, colrStatus not ok): keep the test failing and log it as a Task 7 finding. The spec doc rules the sparse-punct-row split a finding, not a gate widen.

- [ ] **Step 5: Verify the mono corpus still passes untouched**

Run: `npm run test:corpus`
Expected: mono suite green as before, color suite in whatever calibrated state Step 4 ended at.

- [ ] **Step 6: Full unit suite + commit**

Run: `npm test`
Expected: PASS.

```bash
git add e2e-corpus/corpus-color.spec.ts src/components/Maker.tsx
git commit -m 'Color corpus: gated build spec + __lastColor verification hook

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>'
```

---

### Task 5: Live GPOS kerning for color builds

**Files:**
- Modify: `e2e-corpus/corpus-color.spec.ts` (add the GPOS gate; failing first)
- Modify: `src/pages/make.astro` (load `font-engine-gpos.js` on the main thread, after line 46's autokern tag)
- Modify: `public/assets/vendor/font-engine-color-build.js` (`injectKernIfAny` carries GPOS; stale comment fixed)
- Modify: `src/lib/maker.ts` (`waitForColorEngine` waits for `buildGposKern`)

**Interfaces:**
- Consumes: `compileFeatures(font, featureOpts, upm, scale, pairs)` (font-engine-features.js) which since 2026-06-10 writes `font._customTables.GPOS` whenever `global.buildGposKern` exists; `injectCustomTables(bytes, tables)` (font-engine-tables.js, already loaded on the main thread); `buildGposKern` (font-engine-gpos.js, worker-safe, no DOM).
- Produces: color OTFs that carry a GPOS PairPos table when the analyzer finds pairs. No API change anywhere; `applyAutoKern`'s signature is untouched.

Why this is wiring, not a writer swap: the color path already routes `analyzeAutoKern` pairs through `compileFeatures`, and `compileFeatures` already prefers GPOS. The main thread just never loads the GPOS writer, so `typeof global.buildGposKern === 'function'` is false there, the GPOS branch is skipped, and (legacyKernTable being unset) NOTHING is written, only a console.warn. Color fonts today ship with no kerning at all.

- [ ] **Step 1: Write the failing gate**

In `e2e-corpus/corpus-color.spec.ts`, extend `EXPECT` with a `gpos` flag on the two cleanest upright fixtures (the analyzer legitimately may emit zero pairs on some sheets, so the gate is scoped, not universal):

```ts
const EXPECT: Record<string, { palette?: number; gpos?: boolean }> = {
  'flat-2color': { palette: 2, gpos: true },
  'flat-3color': { palette: 3 },
  'flat-shadow': { palette: 2 },
  'flat-light': { palette: 2 },
  'flat-outline': { palette: 2 },
  'flat-lowres': { palette: 2 },
  'gradient-basic': { gpos: true },
  'gradient-shadow': {},
};
```

And after the table-structure block:

```ts
    // live kerning: Chrome and Firefox position from GPOS only; the legacy
    // kern table this path used to describe was never written on the main
    // thread (no GPOS writer loaded) so color fonts shipped un-kerned
    if (exp.gpos) {
      expect(tableSlice(otf, 'GPOS'), 'GPOS PairPos present').not.toBeNull();
    }
```

- [ ] **Step 2: Run the two gated fixtures to verify they fail**

Run: `npx playwright test -c playwright.corpus.config.ts corpus-color -g "flat-2color|gradient-basic"`
Expected: FAIL on 'GPOS PairPos present' (everything else green from Task 4).

- [ ] **Step 3: Load the GPOS writer on the main thread**

In `src/pages/make.astro`, after the autokern line (46) and before font-engine-features.js (47), add:

```astro
  <script is:inline defer src={`/assets/vendor/font-engine-gpos.js?v=${V}`}></script>
```

- [ ] **Step 4: Carry GPOS through the color inject**

In `public/assets/vendor/font-engine-color-build.js`, replace the `injectKernIfAny` function (lines 40-48) and the stale sentence in the `applyAutoKern` comment (lines 25-28). The comment currently says compileFeatures "writes a real `kern` table"; it must describe GPOS:

```js
  // Optional auto-kern. Builds silhouettes from each glyph's cell-space path and
  // asks analyzeAutoKern for pulls (mostly diagonal pairs: A V W Y T), then
  // compileFeatures writes a GPOS PairPos table into font._customTables (the
  // cross-browser path; the legacy `kern` table stays opt-in and unused here).
  // Needs chars to carry cellW/cellH (cell pixel dims) + baseD. Fails silent.
```

```js
  // Inject the kerning tables (written into font._customTables by
  // compileFeatures) into the sfnt bytes — same surgery pipe as COLR/CPAL.
  // GPOS is the one browsers read; legacy kern rides along only if a caller
  // ever opts into it.
  function injectKernIfAny(bytes, font) {
    const t = (font && font._customTables) || {};
    const inject = {};
    if (t.kern) inject.kern = t.kern;
    if (t.GPOS) inject.GPOS = t.GPOS;
    if (Object.keys(inject).length && typeof global.injectCustomTables === 'function') {
      try { return global.injectCustomTables(bytes, inject); }
      catch (e) { console.warn('kern inject skipped: ' + (e && e.message)); }
    }
    return bytes;
  }
```

(Keep the em dash in that comment: it is vendored-engine style, matching the file's existing comments.)

- [ ] **Step 5: Close the load race**

In `src/lib/maker.ts` `waitForColorEngine` (line 3825), extend `ready()` so a build cannot start before the GPOS writer is present:

```ts
    const ready = () =>
      w().ColorMaker && w().buildColorFont && w().buildGradientFont && w().ColorCore && w().wrapAsWoff2 &&
      w().validateFont && w().buildGposKern;
```

(`w()` is the file's existing any-window accessor; `buildGposKern` is a global set by font-engine-gpos.js.)

- [ ] **Step 6: Run the gated fixtures to verify they pass**

Run: `npx playwright test -c playwright.corpus.config.ts corpus-color -g "flat-2color|gradient-basic"`
Expected: PASS, including checksum validity (fixSfntChecksums runs after injection in maker.ts, so the new table is checksummed).

- [ ] **Step 7: fontTools verification (the authoritative check)**

The corpus saved OTFs under test-results. Run fontTools on the flat-2color build (adjust the exact output path playwright printed):

```bash
python -c "from fontTools.ttLib import TTFont; f = TTFont(r'test-results/corpus-color-cee2e-color-corpus-flat-2color-chromium/flat-2color.otf', checkChecksums=2); print('GPOS' in f, f['GPOS'].table.LookupList.Lookup[0].LookupType)"
```

Expected: `True 2` (PairPos lookup) and no checksum exception. If the path differs, `ls test-results` to find it.

- [ ] **Step 8: Full color corpus + eyeball the strips**

Run: `npx playwright test -c playwright.corpus.config.ts corpus-color`
Expected: same pass state as end of Task 4 plus the GPOS gates. Open `test-results/corpus-color-contact.png` and compare AVATAR/To spacing against the Task 4 strips; kerned pairs should sit tighter with no overlaps. Spacing change here is intended; a crash/overlap is a finding.

- [ ] **Step 9: Full unit suite + commit**

Run: `npm test`
Expected: PASS.

```bash
git add e2e-corpus/corpus-color.spec.ts src/pages/make.astro public/assets/vendor/font-engine-color-build.js src/lib/maker.ts
git commit -m 'Color kerning goes live: GPOS writer on the main thread, carried through the color inject

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>'
```

---

### Task 6: Surface the silent degrades

**Files:**
- Modify: `src/lib/maker.ts` (`ColorResult` gains `woff2Failed`; the empty catches record it; new pure helper `colorBuildWarnings`)
- Modify: `src/components/Maker.tsx` (render the warnings; colrStatus copy)
- Create: `test/color-warnings.test.ts`

**Interfaces:**
- Consumes: `ColorResult` (maker.ts ~3805) and the color branch of Maker.tsx `run()` (~line 279).
- Produces: `colorBuildWarnings(status: string, woff2Failed: boolean): string[]` exported from `src/lib/maker.ts`; `ColorResult.woff2Failed?: boolean`. Copy strings below are PROPOSALS: present them to Stephen verbatim before this task ships and use his wording.

- [ ] **Step 1: Write the failing unit test**

Create `test/color-warnings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { colorBuildWarnings } from '../src/lib/maker';

describe('colorBuildWarnings', () => {
  it('is silent on a healthy build', () => {
    expect(colorBuildWarnings('ok', false)).toEqual([]);
  });
  it('states plainly that a COLR failure shipped monochrome', () => {
    const w = colorBuildWarnings('error', false);
    expect(w.length).toBe(1);
    expect(w[0]).toMatch(/monochrome/i);
  });
  it('explains the one-color skip', () => {
    const w = colorBuildWarnings('skipped', false);
    expect(w.length).toBe(1);
    expect(w[0]).toMatch(/one ink color/i);
  });
  it('reports a woff2 failure without blocking the otf', () => {
    const w = colorBuildWarnings('ok', true);
    expect(w.length).toBe(1);
    expect(w[0]).toMatch(/otf/i);
  });
  it('stacks both', () => {
    expect(colorBuildWarnings('error', true).length).toBe(2);
  });
});
```

Run: `npx vitest run test/color-warnings.test.ts`
Expected: FAIL, `colorBuildWarnings` is not exported.

- [ ] **Step 2: Implement in maker.ts**

Add `woff2Failed?: boolean` to the `ColorResult` interface (~line 3805, beside `glowWarning`). In `buildColorFontFromImage`, replace the woff2 catch (lines 3874-3878):

```ts
  let woff2: Uint8Array | undefined;
  let woff2Failed = false;
  try {
    woff2 = await w().wrapAsWoff2(otf);
  } catch {
    // woff2 is optional; the otf is the source of truth. But the failure is
    // surfaced, not swallowed: the readout tells the user what shipped.
    woff2Failed = true;
  }
```

and add `woff2Failed,` to the returned object. Apply the same change to `editColorGlyph` (lines 3906-3911). Then add the pure helper near the `ColorResult` interface:

```ts
/** User-facing warnings for a color build's degrade states. Pure so it is
 *  unit-testable; the Maker readout renders these verbatim. Copy approved by
 *  the director before ship. */
export function colorBuildWarnings(colrStatus: string, woff2Failed: boolean): string[] {
  const out: string[] = [];
  if (colrStatus === 'error') {
    out.push('color layers failed to build, so this font is monochrome outlines only. Try fewer colors (K), or a cleaner sheet.');
  } else if (colrStatus === 'skipped') {
    out.push('only one ink color was found, so this built as a regular monochrome font.');
  }
  if (woff2Failed) {
    out.push('woff2 packing failed. The otf download still works and installs everywhere.');
  }
  return out;
}
```

- [ ] **Step 3: Run the unit test**

Run: `npx vitest run test/color-warnings.test.ts`
Expected: PASS.

- [ ] **Step 4: Render in Maker.tsx**

In the color branch of `run()` (after `rep = cres.report || [];`), fold the degrade warnings into the existing `warn` string mechanism (which already renders via `setWarning`):

```tsx
        const degrade = colorBuildWarnings(cres.colrStatus, !!cres.woff2Failed);
        warn = [warn, ...degrade].filter(Boolean).join(' ');
```

Import `colorBuildWarnings` in Maker.tsx's existing maker.ts import list. Also extend the Task 4 `__lastColor` hook with `warnings: degrade` so the corpus can assert on it.

- [ ] **Step 5: Type check, e2e smoke, corpus**

Run: `npx tsc --noEmit -p tsconfig.json` — clean.
Run: `npx playwright test e2e/maker.spec.ts -g "color"` (dev server killed first) — the two color sample tests still pass and show no warning (colrStatus ok, woff2 healthy).
Run: `npx playwright test -c playwright.corpus.config.ts corpus-color -g "flat-2color"` — still green.

- [ ] **Step 6: Present the copy**

Show Stephen the two warning strings and the one-color skip line exactly as written in Step 2. Do not ship past this task without his wording. Record his approved copy in the commit message body if it changed.

- [ ] **Step 7: Full suite + commit**

Run: `npm test`
Expected: PASS.

```bash
git add src/lib/maker.ts src/components/Maker.tsx test/color-warnings.test.ts
git commit -m 'Color degrades surface: COLR failure and woff2 failure state plainly in the readout

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>'
```

---

### Task 7: Full run, calibration record, triage

**Files:**
- Modify: `e2e-corpus/corpus-color.spec.ts` (final calibrated gate values with measured numbers in comments)
- Modify: `CLAUDE.md` (the `npm run test:corpus` bullet now says it covers mono AND color; one sentence)
- Modify: `docs/superpowers/specs/2026-07-06-color-robustness-design.md` (append a short "Calibration record" section: first-run numbers per fixture, gates moved and why)

**Interfaces:**
- Consumes: everything above.
- Produces: the fix-three triage list for Stephen (findings, not fixes; each candidate fix is its own follow-up with the corpus watching).

- [ ] **Step 1: Full corpus, both suites**

Run: `npm run test:corpus`
Expected: mono suite green; color suite green with final calibrated gates, or failing only on tests deliberately left red as findings. Save the console `COLOR-CORPUS |` lines.

- [ ] **Step 2: Full unit + e2e**

Run: `npm test` — green.
Run: `npx playwright test` (dev server killed first) — the standard e2e suite green.

- [ ] **Step 3: fontTools spot-check**

Repeat the Task 5 Step 7 fontTools command on one flat and one gradient OTF from the fresh run. Expected: both open with `checkChecksums=2`, flat shows GPOS.

- [ ] **Step 4: Write the calibration record + CLAUDE.md line**

Append to the spec doc a table: fixture, first-run values (glyphs, colrStatus, flags, palette), gate adjustments made with reasons. Update the CLAUDE.md `test:corpus` bullet: it builds the 29 mono faces AND the color treatment fixtures (e2e/fixtures/corpus-color, regenerate with `npm run gen:color-corpus`), gating COLR authoring, palette, coverage, and flags, with a color contact sheet at test-results/corpus-color-contact.png.

- [ ] **Step 5: Compose the triage list**

From every finding logged in Tasks 2-5 plus deliberately-red tests, write the fix-three candidates ranked by field impact, each with the corpus evidence line. Deliver as chat output to Stephen, not a file. Typical expected entries: the sparse-punct-row split, any vanished pale layer, any stray flag on a clean sheet, analyzer-zero-pairs fixtures.

- [ ] **Step 6: Commit the calibration**

```bash
git add e2e-corpus/corpus-color.spec.ts CLAUDE.md docs/superpowers/specs/2026-07-06-color-robustness-design.md
git commit -m 'Color corpus calibration: measured gates, corpus doc line, calibration record

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>'
```

Verification for the director, no code reading: `npm run test:corpus` green end to end; `test-results/corpus-color-contact.png` shows all 8 fixtures rendering in color with sane spacing; the triage list arrives in chat.

---

## Deliberately out of scope (parked in the spec)

Worker offload for color, color TTF (COLR on glyf), fine-detail auto-enable parity, per-row color re-slice, color italic/variable, AI-generated fixtures. The engine's module-global `_session` clobber risk is a known structural item; park it in the triage list, do not fix it here.
