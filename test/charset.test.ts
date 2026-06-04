import { describe, it, expect } from 'vitest';
import { parseCharset, guessCharset, guessCharsetFromRows, mergeNarrowRuns, DEFAULT_CHAR_LINES } from '../src/lib/maker';

describe('parseCharset', () => {
  it('splits lines, trims trailing space, drops blanks', () => {
    expect(parseCharset('ABC\nabc\n\n123  ')).toEqual(['ABC', 'abc', '123']);
  });
  it('handles CRLF', () => {
    expect(parseCharset('ABC\r\nabc')).toEqual(['ABC', 'abc']);
  });
});

describe('guessCharset', () => {
  it('four split-layout rows map to the A-M / N-Z split (the fire-sheet shape)', () => {
    expect(guessCharset(4, 13)).toEqual([
      'ABCDEFGHIJKLM',
      'NOPQRSTUVWXYZ',
      'abcdefghijklm',
      'nopqrstuvwxyz',
    ]);
  });

  it('four wide rows map to AZ / az / digits / punctuation', () => {
    expect(guessCharset(4, 26)).toEqual([
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      'abcdefghijklmnopqrstuvwxyz',
      '0123456789',
      ".,!?:;'-&@#",
    ]);
  });

  it('five split rows add the digit row', () => {
    expect(guessCharset(5, 13)).toEqual([
      'ABCDEFGHIJKLM',
      'NOPQRSTUVWXYZ',
      'abcdefghijklm',
      'nopqrstuvwxyz',
      '0123456789',
    ]);
  });

  // Regression: non-split 5/6-row sheets must not produce duplicate, colliding
  // punctuation rows; they fall back to the default lines so the row-mismatch
  // warning fires instead.
  it('non-split five and six row sheets fall back to the default lines', () => {
    expect(guessCharset(5, 26)).toEqual(DEFAULT_CHAR_LINES);
    expect(guessCharset(6, 26)).toEqual(DEFAULT_CHAR_LINES);
  });
});

describe('guessCharsetFromRows (per-row cell counts)', () => {
  it('always returns one line per detected row', () => {
    expect(guessCharsetFromRows([13, 13, 13, 13, 10, 17, 14])).toHaveLength(7);
    expect(guessCharsetFromRows([13, 13, 13, 13]).length).toBe(4);
  });

  it('maps a 4-row split sheet (the fire sheet) exactly', () => {
    expect(guessCharsetFromRows([13, 13, 13, 13])).toEqual([
      'ABCDEFGHIJKLM',
      'NOPQRSTUVWXYZ',
      'abcdefghijklm',
      'nopqrstuvwxyz',
    ]);
  });

  it('pins letters and digits on a 6-row sheet (the slime sheet), punctuation sized to the row', () => {
    const r = guessCharsetFromRows([13, 13, 13, 13, 10, 12]);
    expect(r.slice(0, 5)).toEqual([
      'ABCDEFGHIJKLM',
      'NOPQRSTUVWXYZ',
      'abcdefghijklm',
      'nopqrstuvwxyz',
      '0123456789',
    ]);
    expect(r[5]).toHaveLength(12);
    expect(r[5].startsWith('!?@#')).toBe(true);
  });

  it('handles a 7-row sheet with two punctuation rows that do not collide', () => {
    const r = guessCharsetFromRows([13, 13, 13, 13, 10, 17, 14]);
    expect(r[4]).toBe('0123456789');
    expect(r[5]).toHaveLength(17);
    expect(r[6]).toHaveLength(14);
    // the second punctuation row continues the bank instead of repeating it
    expect(r[6].startsWith('!')).toBe(false);
    expect(r[5][0]).toBe('!');
  });

  it('maps a full-row layout (26 per row)', () => {
    expect(guessCharsetFromRows([26, 26, 10])).toEqual([
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      'abcdefghijklmnopqrstuvwxyz',
      '0123456789',
    ]);
  });
});

describe('mergeNarrowRuns (slicer over-count fix)', () => {
  it('rejoins a glyph whose split leaves an outlier gap among normal spacing', () => {
    // four glyphs, the third split by a 4px gap while real gaps are 30px
    expect(mergeNarrowRuns([[0, 20], [50, 70], [100, 110], [114, 130], [160, 180]])).toEqual([
      [0, 20],
      [50, 70],
      [100, 130],
      [160, 180],
    ]);
  });

  it('keeps even spacing separate', () => {
    expect(mergeNarrowRuns([[0, 20], [50, 70], [100, 120]])).toEqual([[0, 20], [50, 70], [100, 120]]);
  });

  it('leaves a tight but evenly spaced row alone (no false merges)', () => {
    // small uniform gaps are real separators, not intra-glyph splits
    expect(mergeNarrowRuns([[0, 20], [28, 48], [56, 76], [84, 104]])).toHaveLength(4);
  });

  it('leaves fewer than three runs untouched', () => {
    expect(mergeNarrowRuns([[0, 20]])).toEqual([[0, 20]]);
    expect(mergeNarrowRuns([[0, 20], [40, 60]])).toEqual([[0, 20], [40, 60]]);
    expect(mergeNarrowRuns([])).toEqual([]);
  });

  it('collapses a 17-run ornate row back to 16 cells', () => {
    const runs: number[][] = [];
    let x = 0;
    for (let i = 0; i < 16; i++) {
      if (i === 7) {
        runs.push([x, x + 9]);
        runs.push([x + 11, x + 20]); // same glyph split by a 2px internal gap
      } else {
        runs.push([x, x + 20]);
      }
      x += 32;
    }
    expect(runs).toHaveLength(17);
    expect(mergeNarrowRuns(runs)).toHaveLength(16);
  });
});
