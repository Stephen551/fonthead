import { describe, it, expect } from 'vitest';
import { parseCharset, guessCharset, DEFAULT_CHAR_LINES } from '../src/lib/maker';

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
