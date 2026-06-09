import { describe, it, expect } from 'vitest';
import { escapeLike, pageInfo, parseBadge, PAGE_SIZE } from '../src/lib/fonts';

describe('escapeLike', () => {
  it('leaves ordinary text untouched', () => {
    expect(escapeLike('Fraunces')).toBe('Fraunces');
    expect(escapeLike('ac flames')).toBe('ac flames');
  });

  it('escapes LIKE wildcards so they match literally', () => {
    expect(escapeLike('100%')).toBe('100\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
  });

  it('escapes the escape character itself', () => {
    expect(escapeLike('back\\slash')).toBe('back\\\\slash');
  });

  it('handles a term that is all wildcards', () => {
    expect(escapeLike('%_%')).toBe('\\%\\_\\%');
  });
});

describe('parseBadge', () => {
  it('accepts exactly the three badge kinds', () => {
    expect(parseBadge('color')).toBe('color');
    expect(parseBadge('line')).toBe('line');
    expect(parseBadge('variable')).toBe('variable');
  });

  it('reads anything else as no filter', () => {
    expect(parseBadge(null)).toBeUndefined();
    expect(parseBadge('')).toBeUndefined();
    expect(parseBadge('COLOR')).toBeUndefined();
    expect(parseBadge('private')).toBeUndefined();
    expect(parseBadge("color' OR 1=1 --")).toBeUndefined();
  });
});

describe('PAGE_SIZE', () => {
  it('is a sane positive default', () => {
    expect(PAGE_SIZE).toBeGreaterThan(0);
    expect(Number.isInteger(PAGE_SIZE)).toBe(true);
  });
});

describe('pageInfo', () => {
  it('one page when the total fits', () => {
    const i = pageInfo(10, 1, 24);
    expect(i).toMatchObject({ page: 1, pages: 1, offset: 0, hasPrev: false, hasNext: false });
  });

  it('splits a total across pages and tracks nav state', () => {
    expect(pageInfo(50, 1, 24)).toMatchObject({ page: 1, pages: 3, offset: 0, hasPrev: false, hasNext: true });
    expect(pageInfo(50, 2, 24)).toMatchObject({ page: 2, pages: 3, offset: 24, hasPrev: true, hasNext: true });
    expect(pageInfo(50, 3, 24)).toMatchObject({ page: 3, pages: 3, offset: 48, hasPrev: true, hasNext: false });
  });

  it('clamps an over-shot page down to the last page', () => {
    expect(pageInfo(50, 99, 24)).toMatchObject({ page: 3, pages: 3, offset: 48, hasNext: false });
  });

  it('clamps a junk or sub-1 page up to 1', () => {
    expect(pageInfo(50, 0, 24).page).toBe(1);
    expect(pageInfo(50, -5, 24).page).toBe(1);
    expect(pageInfo(50, NaN, 24).page).toBe(1);
  });

  it('always reports at least one page, even when empty', () => {
    expect(pageInfo(0, 1, 24)).toMatchObject({ page: 1, pages: 1, offset: 0, hasPrev: false, hasNext: false });
  });
});
