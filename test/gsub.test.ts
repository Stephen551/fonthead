import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Load the worker-style IIFE module into a sandbox (mirrors test/gpos.test.ts).
const code = readFileSync(join(__dirname, '..', 'public', 'assets', 'vendor', 'font-engine-gsub.js'), 'utf-8');
type Variant = { suffix: string; name: string; gid: number };
type Group = { base: string; baseGid: number; variants: Variant[] };
const sandbox: {
  collectVariantGroups?: (indexByName: Map<string, number>) => Group[];
} = {};
new Function('self', code)(sandbox);
const collectVariantGroups = sandbox.collectVariantGroups!;

describe('collectVariantGroups', () => {
  it('groups .cvNN variants under their base, ordered by cv number', () => {
    const idx = new Map<string, number>([
      ['a', 5],
      ['b', 6],
      ['a.cv01', 40],
      ['a.cv02', 41],
      ['b.cv01', 42],
    ]);
    expect(collectVariantGroups(idx)).toEqual([
      {
        base: 'a',
        baseGid: 5,
        variants: [
          { suffix: '.cv01', name: 'a.cv01', gid: 40 },
          { suffix: '.cv02', name: 'a.cv02', gid: 41 },
        ],
      },
      { base: 'b', baseGid: 6, variants: [{ suffix: '.cv01', name: 'b.cv01', gid: 42 }] },
    ]);
  });

  it('ignores an orphan variant whose base is absent from the index', () => {
    const idx = new Map<string, number>([['a', 5], ['a.cv01', 40], ['z.cv01', 99]]);
    const groups = collectVariantGroups(idx);
    expect(groups.map((g) => g.base)).toEqual(['a']);
    expect(groups[0].variants.map((v) => v.gid)).toEqual([40]);
  });

  it('returns groups sorted by base gid ascending', () => {
    const idx = new Map<string, number>([
      ['m', 20],
      ['a', 5],
      ['m.cv01', 70],
      ['a.cv01', 40],
    ]);
    expect(collectVariantGroups(idx).map((g) => g.baseGid)).toEqual([5, 20]);
  });

  it('orders variants by cv number even when the index is out of order', () => {
    const idx = new Map<string, number>([['a', 5], ['a.cv02', 41], ['a.cv01', 40]]);
    expect(collectVariantGroups(idx)[0].variants.map((v) => v.suffix)).toEqual(['.cv01', '.cv02']);
  });

  it('returns empty when no base carries a variant', () => {
    expect(collectVariantGroups(new Map([['a', 5], ['b', 6]]))).toEqual([]);
  });
});
