export const ANALYTICS_EVENTS = ['make_view', 'sheet_drop', 'sample_try', 'grid_print', 'build_ok', 'build_fail', 'download', 'publish_ok', 'library_download'] as const;
export const ANALYTICS_LABELS: Record<string, string> = {
  make_view: 'Maker visits', sheet_drop: 'Sheet uploads', sample_try: 'Sample tries',
  grid_print: 'Template clicks', build_ok: 'Successful builds', build_fail: 'Failed builds',
  download: 'Maker downloads', publish_ok: 'Publishes', library_download: 'Library downloads',
};
export type FunnelRow = { day: string; event: string; meta: string; count: number };

/** UTC calendar windows include today; comparisons use the preceding equal window. */
export function analyticsWindow(value: string | null, now = new Date()) {
  const days = value === '7' ? 7 : value === '90' ? 90 : 30;
  const date = (offset: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset)).toISOString().slice(0, 10);
  return { days, start: date(1 - days), previousStart: date(1 - days * 2), end: date(0), dates: Array.from({ length: days }, (_, i) => date(1 - days + i)) };
}

export function summarizeFunnel(rows: FunnelRow[], range: ReturnType<typeof analyticsWindow>) {
  const current: Record<string, number> = {};
  const previous: Record<string, number> = {};
  const daily = range.dates.map(day => ({ day, counts: {} as Record<string, number> }));
  const byDay = new Map(daily.map(d => [d.day, d.counts]));
  const breakdowns = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (r.day < range.previousStart || r.day > range.end) continue;
    const totals = r.day >= range.start ? current : previous;
    totals[r.event] = (totals[r.event] ?? 0) + r.count;
    const counts = byDay.get(r.day);
    if (!counts) continue;
    counts[r.event] = (counts[r.event] ?? 0) + r.count;
    if (r.meta || ['build_ok', 'build_fail', 'download'].includes(r.event)) {
      if (!breakdowns.has(r.event)) breakdowns.set(r.event, new Map());
      const detail = breakdowns.get(r.event)!;
      const label = r.meta || 'Unspecified';
      detail.set(label, (detail.get(label) ?? 0) + r.count);
    }
  }
  const completed = (current.build_ok ?? 0) + (current.build_fail ?? 0);
  return { current, previous, daily, breakdowns, successRate: completed ? Math.round(100 * (current.build_ok ?? 0) / completed) : null };
}

export function countChange(current: number, previous: number) {
  if (!previous) return current ? 'No events in previous period' : 'No change';
  const change = Math.round((current - previous) / previous * 100);
  return `${change > 0 ? '+' : ''}${change}% vs previous period`;
}

export function summarizeMembers(members: { builds: number; downloads: number; first_build: string | null; last_build: string | null }[]) {
  return {
    builders: members.filter(m => m.builds > 0).length,
    downloaders: members.filter(m => m.downloads > 0).length,
    returning: members.filter(m => m.first_build && m.last_build && m.first_build < m.last_build).length,
  };
}
