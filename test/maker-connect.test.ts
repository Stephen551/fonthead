import { describe, it, expect } from 'vitest';
import { joinClass, anchorAdvance } from '../src/lib/maker';

// Connected-cursive join classification. Pure decision, no canvas, no engine.
describe('joinClass', () => {
  it('lowercase baseline letter joins both sides', () => {
    const c = joinClass('n', 'a', 'a');
    expect(c.kind).toBe('join');
    expect(c.joinsLeft).toBe(true);
    expect(c.joinsRight).toBe(true);
    expect(c.highExit).toBe(false);
  });

  it('high-exit lowercase flags highExit (incl. r, whose arm rides above the band)', () => {
    expect(joinClass('o', 'n', 'n').highExit).toBe(true);
    expect(joinClass('s', 'a', 'a').highExit).toBe(true);
    expect(joinClass('r', 'a', 'a').highExit).toBe(true); // prototype correction
    expect(joinClass('f', 'a', 'a').highExit).toBe(false); // f stays out (crossbar)
    expect(joinClass('t', 'a', 'a').highExit).toBe(false);
  });

  it('descender-exit letter joins left, breaks right', () => {
    const c = joinClass('g', 'a', 'a');
    expect(c.kind).toBe('join');
    expect(c.joinsLeft).toBe(true);
    expect(c.joinsRight).toBe(false);
  });

  it('cap joins right only into a following lowercase', () => {
    expect(joinClass('H', undefined, 'e')).toMatchObject({ joinsLeft: false, joinsRight: true, cap: true });
    expect(joinClass('H', undefined, 'I')).toMatchObject({ joinsRight: false }); // cap before cap
    expect(joinClass('F', undefined, 'e')).toMatchObject({ joinsRight: false }); // no right exit
    expect(joinClass('B', undefined, 'a')).toMatchObject({ joinsRight: true, highExit: true });
  });

  it('digit, punctuation break both sides; space is space', () => {
    expect(joinClass('5', 'a', 'a')).toMatchObject({ kind: 'break', joinsLeft: false, joinsRight: false });
    expect(joinClass('!', 'a', 'a').kind).toBe('break');
    expect(joinClass(' ', 'a', 'a').kind).toBe('space');
  });
});

describe('anchorAdvance', () => {
  const base = { overlapPx: 0, minAdvPx: 5, leftPadPx: 1 };
  it('join: anchors on left plug when entry is leftmost ink', () => {
    const r = anchorAdvance({ ...base, leftPlug: 10, rightPlug: 40, inkLeft: 10, mode: 'join' });
    expect(r.dx).toBe(-10); // anchorOrigin = min(10,10) = 10
    expect(r.cellW).toBe(30); // 40 - 10 - 0
  });

  it('join: round letter bowl left of entry anchors on ink and shortens advance the same', () => {
    // bowl bulges left: inkLeft=4, entry plug=10
    const r = anchorAdvance({ ...base, leftPlug: 10, rightPlug: 40, inkLeft: 4, mode: 'join' });
    expect(r.dx).toBe(-4); // anchorOrigin = min(10,4) = 4 → no negative-x ink
    expect(r.cellW).toBe(36); // 40 - 4 - 0 → right plug still lands at the join
  });

  it('join: overlap shortens the advance', () => {
    const r = anchorAdvance({ ...base, overlapPx: 3, leftPlug: 10, rightPlug: 40, inkLeft: 10, mode: 'join' });
    expect(r.cellW).toBe(27); // 40 - 10 - 3
  });

  it('join: minAdvPx floors a narrow letter', () => {
    const r = anchorAdvance({ ...base, leftPlug: 10, rightPlug: 12, inkLeft: 10, mode: 'join' });
    expect(r.cellW).toBe(5); // max(5, 12-10-0 = 2)
  });

  it('leftpad: cap-right / post-break gets a left bearing, advance to right plug from ink', () => {
    const r = anchorAdvance({ ...base, leftPlug: 10, rightPlug: 40, inkLeft: 6, mode: 'leftpad' });
    expect(r.dx).toBe(1 - 6); // leftPadPx - inkLeft
    expect(r.cellW).toBe(34); // max(5, 40-6-0)
  });
});
