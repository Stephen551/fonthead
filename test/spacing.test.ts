import { describe, it, expect } from 'vitest';
import { spacingToBuildFlags } from '../src/lib/maker';

describe('spacingToBuildFlags', () => {
  it('auto (0 or unset) keeps the historical cell-width advance, bit for bit', () => {
    for (const v of [undefined, 0, -3, NaN]) {
      expect(spacingToBuildFlags(v as number | undefined)).toEqual({
        useCellWidth: true,
        tightAdvance: false,
        sideBearingPct: 0.05,
      });
    }
  });

  it('a positive knob switches to tight advance with that percent of UPM', () => {
    expect(spacingToBuildFlags(5)).toEqual({ useCellWidth: false, tightAdvance: true, sideBearingPct: 0.05 });
    expect(spacingToBuildFlags(2)).toEqual({ useCellWidth: false, tightAdvance: true, sideBearingPct: 0.02 });
    expect(spacingToBuildFlags(12)).toEqual({ useCellWidth: false, tightAdvance: true, sideBearingPct: 0.12 });
  });

  it('clamps out-of-range values to the slider range', () => {
    expect(spacingToBuildFlags(0.4).sideBearingPct).toBe(0.01);
    expect(spacingToBuildFlags(40).sideBearingPct).toBe(0.12);
  });
});
