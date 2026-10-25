import { describe, expect, it } from 'vitest';
import { walkTerminal } from '../src/lib/cursive-terminals';

const raster = (rows: string[]) => ({
  width: rows[0].length,
  height: rows.length,
  mask: Uint8Array.from(rows.join(''), c => c === '#' ? 1 : 0),
});

describe('terminal skeleton tracing', () => {
  it('follows a diagonal staircase without mistaking it for a fork', () => {
    const r = raster(['........', '.###....', '...##...', '....##..', '.....##.', '.......#', '........']);
    const path = walkTerminal(r.mask, r.width, r.height, 9, 100);
    expect(path[0]).toEqual({ x: 1, y: 1 });
    expect(path.at(-1)).toEqual({ x: 7, y: 5 });
    expect(new Set(path.map(p => `${p.x},${p.y}`)).size).toBe(path.length);
  });

  it('stops at a real junction instead of walking into a bowl', () => {
    const r = raster(['.......', '.#...#.', '..#.#..', '...#...', '...#...', '...#...', '.......']);
    const path = walkTerminal(r.mask, r.width, r.height, 38, 100);
    expect(path.at(-1)).toEqual({ x: 3, y: 3 });
    expect(path).toHaveLength(3);
  });

  it('bounds work by the requested tail length', () => {
    const r = raster(['..........', '.########.', '..........']);
    const path = walkTerminal(r.mask, r.width, r.height, 11, 3);
    expect(path.at(-1)).toEqual({ x: 4, y: 1 });
  });

  it('does not treat an isolated dot or interior stroke pixel as an endpoint', () => {
    const r = raster(['.......', '.#.....', '.......', '.####..', '.......']);
    expect(walkTerminal(r.mask, r.width, r.height, 8, 10)).toEqual([]);
    expect(walkTerminal(r.mask, r.width, r.height, 23, 10)).toEqual([]);
  });
});
