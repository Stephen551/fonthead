import { describe, it, expect } from 'vitest';
import { classifyBuildError } from '../src/lib/maker';

describe('classifyBuildError', () => {
  it('buckets the known failure classes', () => {
    expect(classifyBuildError('font engine did not load')).toBe('engine_load');
    expect(classifyBuildError('color engine did not load')).toBe('engine_load');
    expect(classifyBuildError('no glyphs traced. Try a cleaner sheet (dark letters on white).')).toBe('no_glyphs');
    expect(classifyBuildError('detected 5 rows but your charset has 3 lines. Glyphs are probably misaligned; edit the charset to match your sheet.')).toBe('rows_mismatch');
    expect(classifyBuildError('No character rows detected — ensure dark characters on a light background, or raise bgDist.')).toBe('no_rows');
    expect(classifyBuildError('add at least one row of characters to the charset')).toBe('charset');
    expect(classifyBuildError('worker crashed: out of memory')).toBe('worker');
  });

  it('everything else lands in other, never throws', () => {
    expect(classifyBuildError('')).toBe('other');
    expect(classifyBuildError('some novel failure')).toBe('other');
  });
});
