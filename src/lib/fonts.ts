// fonthead.dev – font data access + specimen helpers.
// Fonts live in D1; their binaries live in R2 and are served by /cdn/[...key].

export interface FontMeta {
  treat: 'normal' | 'gradient' | 'flat' | 'variable';
  grad?: string;
  flat?: string;
  varset?: string;
  size: number;
  italic: boolean;
  badge: 'variable' | 'color' | 'line' | null;
  family: string;
  designer: string;
  ofl: string;
  standIn?: boolean;
  builtWith?: string;
  // true once a per-font social card (og/<id>.png) has been generated + stored
  og?: boolean;
  // the license the maker chose at publish; older fonts without it read as OFL
  license?: 'ofl' | 'cc0' | 'personal';
}

export interface FontRow {
  id: string;
  owner_id: string | null;
  name: string;
  maker_handle: string;
  specimen_word: string;
  meta: string;
  visibility: 'public' | 'private';
  glyph_count: number | null;
  otf_key: string | null;
  ttf_key: string | null;
  woff2_key: string | null;
  otf_size: number | null;
  ttf_size: number | null;
  woff2_size: number | null;
  votes_count: number;
  downloads_count: number;
  created_at: string;
}

export interface Font extends Omit<FontRow, 'meta'> {
  meta: FontMeta;
}

const DEFAULT_META: FontMeta = {
  treat: 'normal',
  size: 88,
  italic: false,
  badge: null,
  family: '',
  designer: '',
  ofl: '',
};

function parse(row: FontRow): Font {
  let meta: FontMeta = DEFAULT_META;
  try {
    meta = { ...DEFAULT_META, ...(JSON.parse(row.meta) as Partial<FontMeta>) };
  } catch {
    /* keep defaults on malformed json */
  }
  return { ...row, meta };
}

/** Apply an owner edit (name, license) to a font's raw meta JSON string. The og
 *  share card renders only the specimen word, so it only goes stale (dropOg)
 *  when the resolved specimen changed and a card exists; a rename alone keeps
 *  it. Every other key (treat, designer, ofl, standIn, builtWith, …) passes
 *  through untouched. */
export function editedFontMeta(
  raw: string,
  edit: { name: string; license: 'ofl' | 'cc0' | 'personal'; specimenChanged: boolean },
): { meta: string; dropOg: boolean } {
  let parsed: Record<string, unknown> = {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) parsed = v as Record<string, unknown>;
  } catch {
    /* malformed meta still takes the edit */
  }
  const dropOg = edit.specimenChanged && parsed.og === true;
  const next = {
    ...parsed,
    family: edit.name,
    license: edit.license,
    ...(dropOg ? { og: false } : {}),
  };
  return { meta: JSON.stringify(next), dropOg };
}

export interface HeroFace {
  id: string;
  family: string;
  name: string;
  designer: string;
  treat: 'normal' | 'gradient' | 'flat' | 'variable';
  grad?: string;
  flat?: string;
  varset?: string;
  italic?: boolean;
}

export type Sort = 'popular' | 'new';

/** Default and max fonts per wall page. */
export const PAGE_SIZE = 24;
const PAGE_MAX = 60;

export interface FontPage {
  items: Font[];
  total: number;
  limit: number;
  offset: number;
}

/** Escape a user search term for a LIKE pattern (so % and _ are literal). The
 *  caller pairs this with ESCAPE '\\' in the query. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => '\\' + c);
}

/** The badge kinds a wall filter can select (the non-null FontMeta badges). */
export type BadgeKind = 'color' | 'line' | 'variable';

/** Validate a ?badge= query param; anything unknown reads as no filter. */
export function parseBadge(v: string | null): BadgeKind | undefined {
  return v === 'color' || v === 'line' || v === 'variable' ? v : undefined;
}

export interface ListOpts {
  q?: string;
  badge?: BadgeKind;
  limit?: number;
  offset?: number;
}

export interface PageInfo {
  page: number;
  pages: number;
  offset: number;
  limit: number;
  hasPrev: boolean;
  hasNext: boolean;
}

/** Clamp a requested page against a total and derive the offset + nav state. */
export function pageInfo(total: number, page: number, pageSize: number = PAGE_SIZE): PageInfo {
  const limit = Math.max(Math.trunc(pageSize) || PAGE_SIZE, 1);
  const pages = Math.max(Math.ceil(Math.max(total, 0) / limit), 1);
  const cur = Math.min(Math.max(Math.trunc(page) || 1, 1), pages);
  return { page: cur, pages, offset: (cur - 1) * limit, limit, hasPrev: cur > 1, hasNext: cur < pages };
}

/** The public wall. popular = votes then recency; new = recency. Paginated
 *  (LIMIT/OFFSET) with an optional LIKE search over name + maker handle. */
export async function listPublicFonts(db: D1Database, sort: Sort, opts: ListOpts = {}): Promise<FontPage> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? PAGE_SIZE), 1), PAGE_MAX);
  const offset = Math.max(Math.trunc(opts.offset ?? 0), 0);
  const order =
    sort === 'popular'
      ? 'votes_count DESC, created_at DESC, rowid DESC'
      : 'created_at DESC, rowid DESC';

  const where = ["visibility = 'public'"];
  const filterBinds: unknown[] = [];
  const q = (opts.q ?? '').trim();
  if (q) {
    where.push("(name LIKE ? ESCAPE '\\' OR maker_handle LIKE ? ESCAPE '\\')");
    const like = `%${escapeLike(q)}%`;
    filterBinds.push(like, like);
  }
  // Badge lives inside the meta JSON; like the LIKE search above this scans the
  // public rows, which stays cheap at wall scale (no index, no migration).
  if (opts.badge) {
    where.push("json_extract(meta, '$.badge') = ?");
    filterBinds.push(opts.badge);
  }
  const whereSql = where.join(' AND ');

  const countRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM fonts WHERE ${whereSql}`)
    .bind(...filterBinds)
    .first<{ n: number }>();
  const total = countRow?.n ?? 0;

  const { results } = await db
    .prepare(`SELECT rowid, * FROM fonts WHERE ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .bind(...filterBinds, limit, offset)
    .all<FontRow>();

  return { items: (results ?? []).map(parse), total, limit, offset };
}

/** The badge kinds that exist on at least one public font, in display order.
 *  Drives the wall's filter chips, so a badge no font carries never renders a
 *  chip (and the single-line chip appears by itself when that mode ships). */
export async function listBadgesInUse(db: D1Database): Promise<BadgeKind[]> {
  const { results } = await db
    .prepare("SELECT DISTINCT json_extract(meta, '$.badge') AS b FROM fonts WHERE visibility = 'public'")
    .all<{ b: string | null }>();
  const present = new Set((results ?? []).map((r) => r.b));
  return (['color', 'variable', 'line'] as const).filter((b) => present.has(b));
}

/** Fetch specific public fonts by id, returned in the order of the ids given
 *  (used for the hero's featured/starter set). */
export async function getFontsByIds(db: D1Database, ids: string[]): Promise<Font[]> {
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT rowid, * FROM fonts WHERE id IN (${placeholders}) AND visibility = 'public'`)
    .bind(...ids)
    .all<FontRow>();
  const byId = new Map((results ?? []).map((r) => [r.id, parse(r)]));
  return ids.map((id) => byId.get(id)).filter((f): f is Font => Boolean(f));
}

/** A maker's fonts. Public only, unless the owner is viewing their own page. */
export async function listFontsByOwner(
  db: D1Database,
  ownerId: string,
  includePrivate: boolean,
): Promise<Font[]> {
  const visClause = includePrivate ? '' : "AND visibility = 'public'";
  const { results } = await db
    .prepare(`SELECT rowid, * FROM fonts WHERE owner_id = ? ${visClause} ORDER BY created_at DESC, rowid DESC`)
    .bind(ownerId)
    .all<FontRow>();
  return (results ?? []).map(parse);
}

export async function getFont(db: D1Database, id: string): Promise<Font | null> {
  const row = await db.prepare('SELECT * FROM fonts WHERE id = ?').bind(id).first<FontRow>();
  return row ? parse(row) : null;
}

export interface UserInteractions {
  voted: Set<string>;
  favorited: Set<string>;
}

/** The set of font ids the user has voted on / favorited, for rendering state. */
export async function getUserInteractions(db: D1Database, userId: string): Promise<UserInteractions> {
  const votes = await db.prepare('SELECT font_id FROM votes WHERE user_id = ?').bind(userId).all<{ font_id: string }>();
  const favs = await db.prepare('SELECT font_id FROM favorites WHERE user_id = ?').bind(userId).all<{ font_id: string }>();
  return {
    voted: new Set((votes.results ?? []).map((r) => r.font_id)),
    favorited: new Set((favs.results ?? []).map((r) => r.font_id)),
  };
}

/** Public R2 URL for a font binary, served by the /cdn route. */
export const cdnUrl = (key: string) => `/cdn/${key}`;

/** The CSS @font-face family name for a font id. */
export const familyOf = (id: string) => `fh-${id}`;

// Only emit keys that match the safe object-key shape, so nothing can break out
// of the CSS string context (ids/keys are slugified, this is defence in depth).
const SAFE_KEY = /^fonts\/[\w.-]+\.woff2$/;

/** One @font-face rule per font, pointing at the R2-served woff2. */
export function fontFaceCss(fonts: Font[]): string {
  return fonts
    .filter((f) => f.woff2_key && SAFE_KEY.test(f.woff2_key))
    .map(
      (f) =>
        `@font-face{font-family:'${familyOf(f.id)}';` +
        `src:url('${cdnUrl(f.woff2_key as string)}') format('woff2');` +
        `font-display:swap;}`,
    )
    .join('');
}

/** Treatment-only style (no font-family) for lazy specimens: the family is
 *  swapped in by the IntersectionObserver once the card nears the viewport. */
export function specTreat(meta: FontMeta): string {
  const parts: string[] = [];
  if (meta.italic) parts.push('font-style:italic');
  if (meta.treat === 'gradient' && meta.grad) parts.push(`background-image:${meta.grad}`);
  if (meta.treat === 'flat' && meta.flat) parts.push(`--specflat:${meta.flat}`);
  if (meta.treat === 'variable' && meta.varset) parts.push(`font-variation-settings:${meta.varset}`);
  return parts.join(';');
}

/** Specimen class for a treatment (mirrors the design mock's spec--* classes). */
export function specClass(meta: FontMeta): string {
  const t =
    meta.treat === 'gradient'
      ? ' spec--gradient'
      : meta.treat === 'flat'
        ? ' spec--flat'
        : '';
  return 'spec' + t;
}

/** Inline style for a specimen element (gradient image, flat color, variation). */
export function specStyle(id: string, meta: FontMeta, fallback = 'var(--sans)'): string {
  const parts = [`font-family:'${familyOf(id)}',${fallback}`];
  if (meta.italic) parts.push('font-style:italic');
  if (meta.treat === 'gradient' && meta.grad) parts.push(`background-image:${meta.grad}`);
  if (meta.treat === 'flat' && meta.flat) parts.push(`--specflat:${meta.flat}`);
  if (meta.treat === 'variable' && meta.varset) parts.push(`font-variation-settings:${meta.varset}`);
  return parts.join(';');
}

/**
 * Length-aware specimen font-size. The original `min(pxCap, fluidCap)` keeps a
 * specimen responsive to its container (cqw on a card or feature column, vw on
 * the full-width band) but is blind to the WORD length, so a long name
 * overflows: it wraps mid-word in the feature/wide bands and clips in the card.
 * This folds in a third cap that shrinks inversely with character count, so a
 * long word drops to one line. All three are needed: pxCap stops a 2-3 letter
 * word ballooning, fluidCap holds the design size for normal words, and the
 * length term reins in long ones. `budget` is the fluid-unit span one average
 * glyph spends on a line, tuned conservatively for wide geometric faces (and
 * the narrowest 300px card) so it errs small rather than overflowing. Counts by
 * code point so emoji/combining specimens don't undercount.
 */
export function specimenFontSize(word: string, pxCap: number, fluidCap: number, unit: 'cqw' | 'vw' = 'cqw', budget = 130): string {
  const len = Math.max(1, [...(word || '')].length);
  const cap = Math.min(fluidCap, Math.round(budget / len));
  return `min(${pxCap}px, ${cap}${unit})`;
}

/** Human file size, e.g. "31 KB". */
export const kb = (bytes: number | null) => (bytes == null ? '–' : `${Math.round(bytes / 1024)} KB`);
