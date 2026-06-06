import { describe, it, expect } from 'vitest';
import { normalizeHandle, isValidHandle } from '../src/lib/util';

describe('normalizeHandle', () => {
  it('lowercases and turns spaces into dashes', () => {
    expect(normalizeHandle('Stephen A')).toBe('stephen-a');
  });
  it('strips markup and punctuation, collapses separators', () => {
    expect(normalizeHandle('  A&C  Meridian!! ')).toBe('ac-meridian');
    expect(normalizeHandle('foo___bar')).toBe('foo-bar');
    expect(normalizeHandle('--lead--trail--')).toBe('lead-trail');
  });
  it('keeps dots and digits', () => {
    expect(normalizeHandle('a.b.c')).toBe('a.b.c');
    expect(normalizeHandle('maker99')).toBe('maker99');
  });
  it('caps at 32 characters', () => {
    expect(normalizeHandle('x'.repeat(50)).length).toBe(32);
  });
  it('returns empty when nothing usable remains', () => {
    expect(normalizeHandle('***')).toBe('');
    expect(normalizeHandle('')).toBe('');
  });
});

describe('isValidHandle', () => {
  it('accepts handles whose normalized form is 2 to 32 chars', () => {
    expect(isValidHandle('ab')).toBe(true);
    expect(isValidHandle('a-good-handle')).toBe(true);
    expect(isValidHandle('A&C Meridian')).toBe(true);
  });
  it('rejects too short, empty, or all-stripped input', () => {
    expect(isValidHandle('a')).toBe(false);
    expect(isValidHandle('')).toBe(false);
    expect(isValidHandle('***')).toBe(false);
  });
});
