// The daily feature. A nightly job tallies the previous calendar day's votes
// on public fonts and writes the featured set for the day. The hero reads it;
// with no "yesterday" yet, the featured set is empty and the hero falls back to
// the house fonts (cold start).

const pad = (n: number) => String(n).padStart(2, '0');
// D1 stores created_at via datetime('now') as "YYYY-MM-DD HH:MM:SS" (UTC).
const sqlDateTime = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
export const dateKey = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export interface FeaturedResult {
  date: string;
  font_ids: string[];
  counted: number;
}

/**
 * Tally the previous calendar day's votes on public fonts and store the top set
 * under today's date. Pass `now` for testing; defaults to the current time.
 */
export async function computeAndStoreFeatured(db: D1Database, now: Date = new Date(), limit = 6): Promise<FeaturedResult> {
  const todayMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const yStart = new Date(todayMidnight.getTime() - 86_400_000); // yesterday 00:00 UTC
  const yEnd = todayMidnight; // today 00:00 UTC

  const { results } = await db
    .prepare(
      `SELECT v.font_id AS id, COUNT(*) AS n
         FROM votes v JOIN fonts f ON f.id = v.font_id
        WHERE f.visibility = 'public' AND v.created_at >= ? AND v.created_at < ?
        GROUP BY v.font_id
        ORDER BY n DESC, v.font_id
        LIMIT ?`,
    )
    .bind(sqlDateTime(yStart), sqlDateTime(yEnd), limit)
    .all<{ id: string; n: number }>();

  const ids = (results ?? []).map((r) => r.id);
  const date = dateKey(todayMidnight);

  await db
    .prepare(
      `INSERT INTO featured (date, font_ids) VALUES (?, ?)
       ON CONFLICT(date) DO UPDATE SET font_ids = excluded.font_ids`,
    )
    .bind(date, JSON.stringify(ids))
    .run();

  return { date, font_ids: ids, counted: ids.length };
}

/** Today's featured font ids (newest featured row at or before today). */
export async function getFeaturedFontIds(db: D1Database, now: Date = new Date()): Promise<string[]> {
  const today = dateKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())));
  const row = await db
    .prepare('SELECT font_ids FROM featured WHERE date <= ? ORDER BY date DESC LIMIT 1')
    .bind(today)
    .first<{ font_ids: string }>();
  if (!row) return [];
  try {
    const ids = JSON.parse(row.font_ids);
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}
