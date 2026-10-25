import { describe, expect, it } from 'vitest';
import { analyticsWindow, summarizeFunnel, summarizeMembers, countChange } from '../src/lib/analytics';

describe('admin analytics', () => {
  it('uses UTC dates across month and year boundaries and bounds URL input', () => {
    const now = new Date('2026-01-01T23:30:00-05:00');
    expect(analyticsWindow('7', now)).toMatchObject({ days: 7, start: '2025-12-27', end: '2026-01-02', previousStart: '2025-12-20' });
    expect(analyticsWindow('999999', now).days).toBe(30);
    expect(analyticsWindow('90', now).dates).toHaveLength(90);
  });

  it('splits equal periods, combines metadata, fills quiet days and ignores out-of-range rows', () => {
    const range = analyticsWindow('7', new Date('2026-10-25T12:00:00Z'));
    const row = (day: string, event: string, count: number, meta = '') => ({ day, event, count, meta });
    const result = summarizeFunnel([
      row('2026-10-18', 'build_ok', 10), row('2026-10-19', 'build_ok', 3, 'mono'),
      row('2026-10-25', 'build_ok', 3, 'mono+script'), row('2026-10-25', 'build_fail', 2, 'trace'),
      row('2026-10-26', 'build_ok', 100), row('2026-10-11', 'build_ok', 100),
      row('2026-10-25', 'download', 4, 'woff2'), row('2026-10-25', 'library_download', 1),
    ], range);
    expect(result.current).toEqual({ build_ok: 6, build_fail: 2, download: 4, library_download: 1 });
    expect(result.previous).toEqual({ build_ok: 10 });
    expect(result.successRate).toBe(75);
    expect(result.daily).toHaveLength(7);
    expect(result.daily[1].counts).toEqual({});
    expect([...result.breakdowns.get('build_ok')!]).toEqual([['mono', 3], ['mono+script', 3]]);
  });

  it('does not invent percentages when no denominator exists', () => {
    expect(summarizeFunnel([], analyticsWindow(null)).successRate).toBeNull();
    expect(countChange(4, 0)).toBe('No events in previous period');
    expect(countChange(0, 0)).toBe('No change');
    expect(countChange(0, 4)).toBe('-100% vs previous period');
    expect(countChange(6, 4)).toBe('+50% vs previous period');
  });

  it('counts people rather than repeated builds, and requires a different build day for return', () => {
    expect(summarizeMembers([
      { builds: 10, downloads: 3, first_build: '2026-10-25', last_build: '2026-10-25' },
      { builds: 1, downloads: 0, first_build: '2026-10-01', last_build: '2026-10-25' },
      { builds: 0, downloads: 1, first_build: '2026-10-01', last_build: null },
      { builds: 0, downloads: 0, first_build: null, last_build: null },
    ])).toEqual({ builders: 2, downloaders: 2, returning: 1 });
  });

  it('keeps failures with missing metadata visible in the breakdown', () => {
    const range = analyticsWindow('7', new Date('2026-10-25T12:00:00Z'));
    const result = summarizeFunnel([{ day: range.end, event: 'build_fail', meta: '', count: 2 }], range);
    expect(result.breakdowns.get('build_fail')?.get('Unspecified')).toBe(2);
  });
});
