import { describe, it, expect } from 'vitest';
import { mergeSliverBands } from '../src/lib/maker';

// Row bands as detectRowsInBinary returns them: [y0, y1) runs of inked scanlines.
// Both reads below are the measured bands of a light-ballpoint scan of the
// printed grid (field sheet 2026-10-18, 2157x1501, 6 drawn rows).
const parse = (s: string) => s.split(' ').map((r) => r.split('-').map(Number));

// The dark-core (luminance 64) read: the light ink drops whole scanlines, so each
// drawn row splits into fragments with 1-3px seams. 21 bands, 6 real rows.
const STRICT_READ = parse(
  '5-12 13-198 235-236 237-250 251-252 253-455 456-457 458-459 533-554 557-558 561-562 564-723 724-726 843-981 1084-1240 1241-1249 1300-1301 1303-1307 1308-1324 1327-1329 1330-1495',
);
// The standard (128) read: clean except the apostrophe tip, 1 scanline above its row.
const STANDARD_READ = parse('4-199 235-470 532-732 843-983 1084-1250 1300-1301 1302-1495');

describe('mergeSliverBands (a light pen fragments into slivers; fragments are not rows)', () => {
  it('folds the field scan dark-core read back to its 6 drawn rows', () => {
    expect(mergeSliverBands(STRICT_READ)).toEqual(parse('5-198 235-459 533-726 843-981 1084-1249 1300-1495'));
  });

  it('folds the standard read apostrophe tip into the punctuation row', () => {
    expect(mergeSliverBands(STANDARD_READ)).toEqual(parse('4-199 235-470 532-732 843-983 1084-1250 1300-1495'));
  });

  it('leaves a tightly-leaded generator sheet alone, fused band and all (nano-v3)', () => {
    // Rows 1-4 read as one 708px band; the real rows below are 128-140px. The
    // fused band must not set the typical height, or those rows read as slivers.
    const std = parse('64-772 796-924 945-1085');
    const strict = parse('65-226 227-771 796-924 946-1085');
    expect(mergeSliverBands(std)).toEqual(std);
    expect(mergeSliverBands(strict)).toEqual(strict);
  });

  it('never merges two real rows, however tight the gap', () => {
    // tall rows 2px apart stay apart: only slivers fold
    const tight = [[0, 100], [102, 200], [202, 300]];
    expect(mergeSliverBands(tight)).toEqual(tight);
  });

  it('leaves an isolated sliver (a short row across a real gap) alone', () => {
    const rows = [[0, 100], [140, 160], [200, 300]];
    expect(mergeSliverBands(rows)).toEqual(rows);
  });

  it('is a no-op on zero or one band, and never mutates its input', () => {
    expect(mergeSliverBands([])).toEqual([]);
    expect(mergeSliverBands([[0, 5]])).toEqual([[0, 5]]);
    const input = [[0, 100], [101, 103]];
    mergeSliverBands(input);
    expect(input).toEqual([[0, 100], [101, 103]]);
  });
});
