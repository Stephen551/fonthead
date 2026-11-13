import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { dropClearsVariationSlots, variationRowPlan } from '../src/lib/maker-checks';
import { guessCharsetFromRows, mergeSliverBands } from '../src/lib/maker';

function loadTracerCore(): any {
  const ctx: any = { console, Math, Uint8Array, Uint8ClampedArray, Uint32Array, Int32Array, Float32Array, Float64Array };
  ctx.window = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(__dirname, '..', 'public', 'assets', 'tracer-core.js'), 'utf-8'), ctx, { filename: 'tracer-core.js' });
  return ctx.TracerCore;
}
const TracerCore = loadTracerCore();

const W = 1023, H = 765;
function blank(): Uint8ClampedArray {
  return new Uint8ClampedArray(W * H * 4).fill(255);
}
function fill(d: Uint8ClampedArray, x0: number, y0: number, x1: number, y1: number, v: number) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * W + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
}
const INK = 34;
function boldPair(d: Uint8ClampedArray, x: number, top: number) {
  fill(d, x, top, x + 65, top + 180, INK); // stem
  fill(d, x, top, x + 105, top + 40, INK); // top bar
  fill(d, x, top + 80, x + 95, top + 110, INK); // middle bar
}

// The reported sheet (bug report 2026-11-13, 1023x765): a screenshot of another
// app with two white cells holding bold "Fi" and "FL" on a #eee panel, then a
// thin grey rule and a light grey band of UI chrome below.
function reportedBaseSheet(): Uint8ClampedArray {
  const d = blank();
  fill(d, 0, 0, W, 368, 238);
  fill(d, 5, 0, 258, 363, 255);
  fill(d, 263, 0, 515, 363, 255);
  fill(d, 0, 363, W, 368, 232);
  fill(d, 258, 0, 263, 363, 235);
  boldPair(d, 45, 90); // F
  fill(d, 170, 140, 215, 270, INK); // i stem
  fill(d, 175, 85, 215, 125, INK); // i dot
  boldPair(d, 275, 90); // F
  fill(d, 400, 90, 460, 265, INK); // L stem
  fill(d, 400, 220, 505, 265, INK); // L foot
  fill(d, 0, 494, W, 497, 205); // thin rule
  fill(d, 0, 497, W, 624, 242); // light band
  return d;
}

// A sheet already sitting in a variation slot: two rows of bold letters.
function twoRowVariationSheet(): Uint8ClampedArray {
  const d = blank();
  for (const top of [90, 450]) for (let x = 40; x < 900; x += 160) boldPair(d, x, top);
  return d;
}

function rowBands(d: Uint8ClampedArray): number[][] {
  TracerCore.binarizeRgbaInPlace(d, W, H, 128, false, 0);
  return mergeSliverBands(TracerCore.detectRowsInBinary(d, W, H));
}

describe('variation sheet row mismatch (bug report 2026-11-13)', () => {
  it('reads the reported screenshot as one row; the grey UI chrome never inks', () => {
    // base and variation sheets go through the same traceSheet path, so the
    // faint band cannot read differently between them
    expect(rowBands(reportedBaseSheet())).toEqual([[85, 270]]);
  });

  it('builds the base font and leaves out a variation sheet with a different layout', () => {
    const mapping = ['FiFL'];
    const variationRows = rowBands(twoRowVariationSheet()).length;
    expect(variationRows).toBe(2);
    const plan = variationRowPlan(0, variationRows, mapping, guessCharsetFromRows([6, 6]));
    expect(plan).toEqual({
      kind: 'skip',
      warning: 'Variation sheet 2 has 2 rows but your sheet has 1, so it was left out of this font. Remove it under natural variation, or use a variation sheet with the same rows.',
    });
  });

  it('keeps matching sheets and partial matches exactly as before', () => {
    const base = ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', 'abcdefghijklm', 'nopqrstuvwxyz', '0123456789'];
    expect(variationRowPlan(0, 5, base, base)).toEqual({ kind: 'match' });
    const guessed = ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', '0123456789'];
    expect(variationRowPlan(1, 3, base, guessed)).toEqual({ kind: 'shared', lines: guessed, sharedLines: guessed.slice(0, 2) });
  });
});

describe('a new main sheet clears old variation slots (ADR 0082)', () => {
  it('a single sheet replacing an existing base empties the slots', () => {
    expect(dropClearsVariationSlots(1, false, true)).toBe(true);
    expect(dropClearsVariationSlots(1, true, true)).toBe(true);
    expect(dropClearsVariationSlots(3, true, true)).toBe(true); // color drops take only the first file
  });

  it('keeps slots loaded before the first base, and lets a multi-file drop refill them', () => {
    expect(dropClearsVariationSlots(1, false, false)).toBe(false);
    expect(dropClearsVariationSlots(3, false, true)).toBe(false);
  });
});
