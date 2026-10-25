import { describe, it, expect } from 'vitest';
import { dropForeignRowFragments, mergeSliverBands, splitBandsAtValleys } from '../src/lib/maker';
import graffitiProfile from './fixtures/graffiti-row-profile.json';

describe('decorated row valleys', () => {
  it('discards only shallow runs connected to ink outside the row', () => {
    const width = 80, height = 140;
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    const rect = (x: number, top: number, bottom: number) => {
      for (let y = top; y < bottom; y++) for (let dx = 0; dx < 5; dx++) data[(y * width + x + dx) * 4] = 0;
    };
    rect(5, 0, 18); // the preceding row's tail crosses the band's top
    rect(20, 102, 130); // the following row's tip crosses its bottom
    rect(35, 10, 18); // a detached decoration, with no connection above
    rect(50, 10, 115); // a real tall character, touching both boundaries
    rect(65, 90, 110); // a detached low mark, with no connection below
    expect(dropForeignRowFragments(data, width, 10, 110, [[5, 10], [20, 25], [35, 40], [50, 55], [65, 70]]))
      .toEqual([[35, 40], [50, 55], [65, 70]]);
  });

  it('recovers all seven rows when decorations bridge the number/symbol gap', () => {
    const rows = splitBandsAtValleys(graffitiProfile.profile, graffitiProfile.bands);
    expect(rows).toHaveLength(7);
    // The first two and last rows were already separated by white space.
    expect(rows.slice(0, 2)).toEqual(graffitiProfile.bands.slice(0, 2));
    expect(rows[6]).toEqual(graffitiProfile.bands[3]);
    expect(rows[4][1]).toBeGreaterThan(590);
    expect(rows[4][1]).toBeLessThan(610);
  });

  it('does not split a shallow valley inside a letter row', () => {
    const profile = Array.from({ length: 120 }, (_, y) => y >= 50 && y < 70 ? 35 : 100);
    expect(splitBandsAtValleys(profile, [[0, 119]])).toEqual([[0, 119]]);
  });
});

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
