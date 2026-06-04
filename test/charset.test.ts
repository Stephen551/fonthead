import { describe, it, expect } from 'vitest';
import { parseCharset, guessCharset, guessCharsetFromRows, DEFAULT_CHAR_LINES } from '../src/lib/maker';

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
