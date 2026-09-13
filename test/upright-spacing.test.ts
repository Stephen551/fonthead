import { describe, expect, it } from 'vitest';
import { hasStraightUprightStems, type StemProfile } from '../src/lib/spacing';

function stem(char: string, slope = 0, wobble = 0): StemProfile {
  const center = (y: number) => 20 + slope * y + wobble * Math.sin(y / 3);
  return { char, baseline: 100, left: Array.from({ length: 110 }, (_, y) => center(y) - 4),
    right: Array.from({ length: 110 }, (_, y) => center(y) + 4) };
}

describe('upright spacing evidence', () => {
  it('recognizes multiple upright stems, with tolerance for raster noise', () => {
    expect(hasStraightUprightStems(['H', 'I', 'i', 'l'].map(c => stem(c, 0.01, 0.3)), 60)).toBe(true);
  });
  it('preserves slanted and curved script stems', () => {
    expect(hasStraightUprightStems(['H', 'I', 'i', 'l'].map(c => stem(c, 0.24)), 60)).toBe(false);
    expect(hasStraightUprightStems(['H', 'I', 'i', 'l'].map(c => stem(c, 0, 10)), 60)).toBe(false);
  });
  it('requires three distinct supported stems and enough ink', () => {
    expect(hasStraightUprightStems([stem('i'), stem('i'), stem('l'), stem('A')], 60)).toBe(false);
    expect(hasStraightUprightStems(['H', 'I', 'i'].map(c => ({ ...stem(c), left: [], right: [] })), 60)).toBe(false);
    expect(hasStraightUprightStems(['H', 'I', 'i'].map(c => stem(c)), NaN)).toBe(false);
  });
});
