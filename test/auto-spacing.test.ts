import { describe, expect, it } from 'vitest';
import { chooseAutoSpacing } from '../src/lib/spacing';

const samples = (width: number, counter: number) => [...'HOnou'].map(char => ({ char, width, counter }));

describe('automatic family spacing', () => {
  it('gives open counters more room than condensed heavy letters', () => {
    const open = chooseAutoSpacing(samples(650, 320), 1000);
    const compact = chooseAutoSpacing(samples(320, 110), 1000);
    expect(open).toMatchObject({ pct: 5.1, source: 'counters', samples: 5 });
    expect(compact.pct).toBe(2.5);
  });

  it('is invariant to image scale and sample order', () => {
    const a = samples(700, 340);
    expect(chooseAutoSpacing(a, 1000)).toEqual(chooseAutoSpacing(a.reverse().map(s => ({ ...s, width: s.width * 3, counter: s.counter * 3 })), 3000));
  });

  it('does not let one decoration or repeated character dominate', () => {
    const a = samples(700, 300);
    a[0] = { char: 'H', width: 1700, counter: 1600 };
    expect(chooseAutoSpacing(a, 1000).pct).toBe(4.8);
    expect(chooseAutoSpacing([...a, ...a, ...a], 1000)).toEqual(chooseAutoSpacing(a, 1000));
  });

  it('uses proportions when counters are closed, instead of collapsing the gap', () => {
    expect(chooseAutoSpacing(samples(500, 0), 1000)).toEqual({ pct: 3.3, source: 'proportions', samples: 5 });
    expect(chooseAutoSpacing(samples(1100, 0), 1000).pct).toBe(7);
  });

  it('bounds extreme measurements and rejects invalid data', () => {
    expect(chooseAutoSpacing(samples(5000, 4000), 1000).pct).toBe(7);
    expect(chooseAutoSpacing(samples(500, Infinity), 1000).source).toBe('proportions');
    for (const em of [0, -1, NaN, Infinity]) expect(chooseAutoSpacing(samples(500, 200), em).source).toBe('fallback');
    expect(chooseAutoSpacing(samples(Infinity, 10), 1000).source).toBe('fallback');
  });

  it('keeps a conservative fallback for incomplete or symbol-only alphabets', () => {
    expect(chooseAutoSpacing(samples(600, 300).slice(0, 2), 1000)).toMatchObject({ pct: 3.5, source: 'fallback' });
    expect(chooseAutoSpacing(['.', '!', '@'].map(char => ({ char, width: 200, counter: 100 })), 1000).source).toBe('fallback');
  });
});
