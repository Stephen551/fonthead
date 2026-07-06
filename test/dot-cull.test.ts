import { describe, it, expect, beforeAll } from 'vitest';
import { cullForeignTopTails } from '../src/lib/maker';

// cullForeignTopTails removes a neighbour row's descender tip that crossed the
// band cut (the breve-like tick judged above m/u, the dash under a cap B). Its
// original gates were purely zonal (top 6% / top 30% / under 20% of the ink),
// which assumed an i/j dot always begins well below the band top. A field
// sheet (2026-07-06, decorative serif) refuted that: its dots ARE the row's
// tallest ink, so the band starts at the dots and the zonal gates all fire —
// the j dot vanished on every preset and the i dot (area share 0.195, a hair
// under the 0.2 gate) flickered with the trace preset. The fix is the DOCKED
// exemption: a mark hugging x-overlapping ink just below (a dot over its stem)
// is a legitimate detached mark, never a foreign tail — a foreign tip floats
// far above the x-height body it landed on (measured ~27% of cellH vs ~2% for
// the field dots).
//
// The test's estimateBBox stub reads the bbox straight from the path string:
// each subpath is written as `M minX minY L maxX maxY`.

beforeAll(() => {
  (window as unknown as Record<string, unknown>).estimateBBox = (d: string) => {
    const n = (d.match(/-?\d+(\.\d+)?/g) || []).map(Number);
    if (n.length < 4) return null;
    return { minX: n[0], minY: n[1], maxX: n[2], maxY: n[3] };
  };
});

const sub = (minX: number, minY: number, maxX: number, maxY: number) => `M ${minX} ${minY} L ${maxX} ${maxY}`;
const entry = (...subs: string[]) => [{ d: subs.join(' '), bb: { minX: 0, maxX: 0, minY: 0, maxY: 0 }, area: 0 }];
const CELL_H = 370; // the field sheet's a-m row band + pad

const subCount = (out: Array<{ d: string }>) => out.reduce((n, p) => n + p.d.split(/(?=M)/).filter((s) => s.trim()).length, 0);

describe('cullForeignTopTails: docked marks survive', () => {
  it('keeps an i dot that rides the band top (field geometry: share 0.195, gap 2.2% of cellH)', () => {
    // dot y 6-75 over stem y 83-288 — the dot is the row's tallest ink
    const out = cullForeignTopTails(entry(sub(20, 6, 89, 75), sub(6, 83, 102, 288)), CELL_H);
    expect(subCount(out)).toBe(2);
  });

  it('keeps a j dot (share 0.114 — always culled before the fix)', () => {
    const out = cullForeignTopTails(entry(sub(20, 6, 89, 75), sub(0, 83, 130, 368)), CELL_H);
    expect(subCount(out)).toBe(2);
  });

  it('keeps a bottom mark hugging its body (the !-dot class)', () => {
    const out = cullForeignTopTails(entry(sub(100, 330, 160, 368), sub(90, 6, 170, 310)), CELL_H);
    expect(subCount(out)).toBe(2);
  });
});

describe('cullForeignTopTails: foreign tips still cull', () => {
  it('culls the breve-like tick above an x-height body (gap 27% of cellH)', () => {
    const out = cullForeignTopTails(entry(sub(40, 0, 100, 20), sub(0, 120, 300, 300)), CELL_H);
    expect(subCount(out)).toBe(1);
  });

  it('culls the dash under a cap (gap 17.6% of cellH)', () => {
    const out = cullForeignTopTails(entry(sub(100, 355, 200, 368), sub(0, 6, 300, 290)), CELL_H);
    expect(subCount(out)).toBe(1);
  });

  it('culls a top tip with no x-overlap on the ink below', () => {
    // tail hangs over the letter's left gap: near in y, disjoint in x
    const out = cullForeignTopTails(entry(sub(0, 0, 30, 20), sub(60, 30, 300, 300)), CELL_H);
    expect(subCount(out)).toBe(1);
  });
});

describe('cullForeignTopTails: existing guards unchanged', () => {
  it('leaves a counter (nested bbox) alone', () => {
    const out = cullForeignTopTails(entry(sub(0, 6, 300, 300), sub(100, 40, 200, 120)), CELL_H);
    expect(subCount(out)).toBe(2);
  });

  it('leaves a single-subpath glyph alone (a quote is most of its own ink)', () => {
    const out = cullForeignTopTails(entry(sub(10, 0, 60, 80)), CELL_H);
    expect(subCount(out)).toBe(1);
  });
});
