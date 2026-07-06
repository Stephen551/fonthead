import { describe, it, expect } from 'vitest';
import { colorBuildWarnings } from '../src/lib/maker';

describe('colorBuildWarnings', () => {
  it('is silent on a healthy build', () => {
    expect(colorBuildWarnings('ok', false)).toEqual([]);
  });
  it('states plainly that a COLR failure shipped monochrome', () => {
    const w = colorBuildWarnings('error', false);
    expect(w.length).toBe(1);
    expect(w[0]).toMatch(/monochrome/i);
  });
  it('explains the one-color skip', () => {
    const w = colorBuildWarnings('skipped', false);
    expect(w.length).toBe(1);
    expect(w[0]).toMatch(/one ink color/i);
  });
  it('reports a woff2 failure without blocking the otf', () => {
    const w = colorBuildWarnings('ok', true);
    expect(w.length).toBe(1);
    expect(w[0]).toMatch(/otf/i);
  });
  it('stacks both', () => {
    expect(colorBuildWarnings('error', true).length).toBe(2);
  });
});
