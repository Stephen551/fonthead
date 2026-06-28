import { describe, it, expect } from 'vitest';
import { joinClass } from '../src/lib/maker';

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
