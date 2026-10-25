import { describe, it, expect } from 'vitest';
import { sanitizeBugContext, parseBugContext, formatBugContext, hasBugSubstance } from '../src/lib/bugreport';

describe('sanitizeBugContext', () => {
  it('keeps known scalar keys and drops everything else', () => {
    const ctx = sanitizeBugContext({
      kind: 'mono',
      glyphCount: 62,
      connect: true,
      email: 'someone@example.test', // not a context key: dropped
      nested: { a: 1 }, // not a context key: dropped
      stage: { not: 'a string' }, // known key, wrong type: dropped
    });
    expect(ctx).toEqual({ kind: 'mono', glyphCount: 62, connect: true });
  });

  it('caps long strings and drops empty ones', () => {
    const ctx = sanitizeBugContext({ error: 'x'.repeat(2000), phase: '   ' });
    expect((ctx.error as string).length).toBe(500);
    expect('phase' in ctx).toBe(false);
  });

  it('drops non-finite numbers', () => {
    expect(sanitizeBugContext({ spacing: Number.NaN, dpr: Infinity, sheetW: 1200 })).toEqual({ sheetW: 1200 });
  });

  it('returns empty for non-objects', () => {
    expect(sanitizeBugContext(null)).toEqual({});
    expect(sanitizeBugContext('kind')).toEqual({});
    expect(sanitizeBugContext(['kind'])).toEqual({});
  });
});

describe('parseBugContext', () => {
  it('parses and sanitizes JSON, and never throws on junk', () => {
    expect(parseBugContext('{"kind":"flat","extra":1}')).toEqual({ kind: 'flat' });
    expect(parseBugContext('not json')).toEqual({});
    expect(parseBugContext(undefined)).toEqual({});
  });
});

describe('formatBugContext', () => {
  it('prints one line per field in a stable order', () => {
    expect(formatBugContext({ glyphCount: 10, kind: 'mono', where: 'maker' })).toBe(
      'where: maker\nkind: mono\nglyphCount: 10',
    );
  });
});

describe('hasBugSubstance', () => {
  it('needs a note, an error, or a sheet', () => {
    expect(hasBugSubstance('', {}, false)).toBe(false);
    expect(hasBugSubstance('  ', { kind: 'mono' }, false)).toBe(false);
    expect(hasBugSubstance('rows came out wrong', {}, false)).toBe(true);
    expect(hasBugSubstance('', { error: 'no glyphs traced' }, false)).toBe(true);
    expect(hasBugSubstance('', {}, true)).toBe(true);
  });
});
