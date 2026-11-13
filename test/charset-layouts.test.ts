import { describe, expect, it } from 'vitest';
import { KNOWN_LAYOUTS, charsetFitsRows, matchCharsetLayout, suggestCharsetLayout } from '../src/lib/charset-layouts';
import { mappingProblems } from '../src/lib/maker-checks';
import { DEFAULT_CHAR_LINES, SAMPLE_CHAR_LINES, guessCharsetFromRows } from '../src/lib/maker';
import { EXTENDED_LATIN_ROWS, MARK_PRESET_ROWS, SPLIT_ALPHABET_ROWS, SYMBOL_PRESET_ROWS } from '../src/lib/charsets';
import { LEGACY_ACCENT_ROWS } from '../e2e/extended-latin-fixture';

const AZ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const az = 'abcdefghijklmnopqrstuvwxyz';
const digits = '0123456789';
const counts = (lines: string[]) => lines.map(l => [...l].length);

describe('row-shape charset match', () => {
  it('suggests A to Z, a to z, 0 to 9 when a 3-row sheet has the 7-line preset in the box', () => {
    // The 2026-11-13 report: three typed rows, the standard preset still armed.
    const hit = suggestCharsetLayout([26, 26, 10], SYMBOL_PRESET_ROWS);
    expect(hit?.lines).toEqual([AZ, az, digits]);
    expect(hit?.label).toBe('A to Z, a to z and 0 to 9');
  });

  it('tolerates a cell or two of slicer noise on letter and digit rows', () => {
    expect(matchCharsetLayout([24, 27, 9])?.lines).toEqual([AZ, az, digits]);
    expect(matchCharsetLayout([13, 12, 14, 13, 11])?.lines).toEqual(SPLIT_ALPHABET_ROWS);
  });

  it('recognises the shipped presets and simple subsets', () => {
    expect(matchCharsetLayout([26])?.label).toBe('A to Z');
    expect(matchCharsetLayout([10])?.label).toBe('0 to 9');
    expect(matchCharsetLayout([26, 10])?.label).toBe('A to Z and 0 to 9');
    expect(matchCharsetLayout([26, 26])?.label).toBe('A to Z and a to z');
    expect(matchCharsetLayout([13, 13])?.label).toBe('A to Z in two rows');
    expect(matchCharsetLayout([26, 26, 10, 11])?.lines).toEqual(DEFAULT_CHAR_LINES);
    expect(matchCharsetLayout([13, 13, 13, 13, 10, 12])?.lines).toEqual(MARK_PRESET_ROWS);
    expect(matchCharsetLayout([13, 13, 13, 13, 10, 17, 13])?.lines).toEqual(SYMBOL_PRESET_ROWS);
    expect(matchCharsetLayout([13, 13, 13, 13, 10, 19, 13])?.label).toBe('A to Z, a to z and 0 to 9 in five rows, then 2 rows of symbols');
  });

  it('leaves odd sheets to manual editing', () => {
    expect(matchCharsetLayout([7, 19, 3])).toBeNull();
    expect(matchCharsetLayout([26, 26, 26])).toBeNull();
    expect(matchCharsetLayout([])).toBeNull();
    expect(matchCharsetLayout([26, 0, 10])).toBeNull();
  });

  it('stays quiet when the charset already fits the rows', () => {
    expect(charsetFitsRows([AZ, az, digits], [25, 26, 10])).toBe(true);
    expect(suggestCharsetLayout([25, 26, 10], [AZ, az, digits])).toBeNull();
    // a hand-edited charset that fits by count is the maker's call, not ours
    expect(suggestCharsetLayout([26, 26, 10], ['ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz', '!?@#$%^&*(']))
      .toBeNull();
  });

  it('suggests 0 to 9 for a digits-only row the position guess maps to A to M', () => {
    expect(guessCharsetFromRows([10])).toEqual(['ABCDEFGHIJKLM']);
    expect(suggestCharsetLayout([10], guessCharsetFromRows([10]))?.lines).toEqual([digits]);
  });

  it('catches a plain sheet under the stale 7-row accented charset the old latin-ext preset armed', () => {
    // Before 61b06e6 (Oct 27) latin-ext armed the main charset key, and onFile
    // uses any non-ASCII armed charset whatever the row count.
    const stale = LEGACY_ACCENT_ROWS.map(r => r.normalize('NFC'));
    expect(suggestCharsetLayout([26, 26, 10], stale)?.lines).toEqual([AZ, az, digits]);
  });

  it('leaves a real accented sheet alone, detached accent band included', () => {
    const accented = EXTENDED_LATIN_ROWS;
    expect(suggestCharsetLayout(counts(accented), accented)).toBeNull();
    // the raw probe reads row 1's floating accents as an extra band (ADR 0080)
    expect(suggestCharsetLayout([9, ...counts(accented)], accented)).toBeNull();
  });

  it('never suggests the charset already in the box', () => {
    // the preset itself misfits a garbled sheet; there is nothing better to offer
    expect(suggestCharsetLayout([13, 13, 13, 13, 10, 40, 2], SYMBOL_PRESET_ROWS)).toBeNull();
  });

  it('agrees with the position guess on every shipped layout but digits only', () => {
    for (const layout of KNOWN_LAYOUTS) {
      const c = counts(layout.lines);
      if (c.length === 1 && c[0] === 10) continue;
      expect(suggestCharsetLayout(c, guessCharsetFromRows(c)), layout.label).toBeNull();
    }
  });

  it('only ships layouts that pass the mapping check, including the maker defaults', () => {
    for (const layout of KNOWN_LAYOUTS) expect(mappingProblems(layout.lines), layout.label).toEqual([]);
    const all = KNOWN_LAYOUTS.map(l => JSON.stringify(l.lines));
    expect(all).toContain(JSON.stringify(DEFAULT_CHAR_LINES));
    expect(all).toContain(JSON.stringify(SAMPLE_CHAR_LINES));
    expect(new Set(all).size).toBe(all.length);
  });
});
