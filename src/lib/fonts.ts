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

export interface ListOpts {
  q?: string;
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

/** Human file size, e.g. "31 KB". */
export const kb = (bytes: number | null) => (bytes == null ? '–' : `${Math.round(bytes / 1024)} KB`);
