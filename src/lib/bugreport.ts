// The in-maker bug report (ADR 0060). The browser gathers what the maker knew at
// the moment something went wrong; the server keeps only the keys below, each
// bounded, so a report can never smuggle in arbitrary data or grow without limit.
// Pure functions, shared by the action and the unit tests.

// key -> max string length (numbers and booleans pass through as-is)
const CONTEXT_KEYS: Record<string, number> = {
  where: 40,
  phase: 20,
  stage: 40,
  kind: 20,
  error: 500,
  errorClass: 40,
  warning: 300,
  preset: 20,
  fineDetail: 0,
  spacing: 0,
  trimFlourishes: 0,
  connect: 0,
  italic: 0,
  naturalVariation: 0,
  charsetLines: 0,
  detectedRows: 0,
  glyphCount: 0,
  flaggedCount: 0,
  sheetW: 0,
  sheetH: 0,
  userAgent: 300,
  viewport: 20,
  dpr: 0,
};

export type BugContext = Record<string, string | number | boolean>;

/** Keep only known keys with scalar values; trim and cap strings; drop the rest. */
export function sanitizeBugContext(raw: unknown): BugContext {
  const out: BugContext = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, max] of Object.entries(CONTEXT_KEYS)) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === 'string') {
      const s = v.trim().slice(0, max || 100);
      if (s) out[key] = s;
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      out[key] = v;
    } else if (typeof v === 'boolean') {
      out[key] = v;
    }
  }
  return out;
}

/** Parse the JSON the form sends; anything unparseable becomes an empty context. */
export function parseBugContext(json: string | undefined): BugContext {
  if (!json) return {};
  try {
    return sanitizeBugContext(JSON.parse(json));
  } catch {
    return {};
  }
}

/** One "key: value" line per field, in a stable order, for the email and admin page. */
export function formatBugContext(ctx: BugContext): string {
  return Object.keys(CONTEXT_KEYS)
    .filter((k) => k in ctx)
    .map((k) => `${k}: ${ctx[k]}`)
    .join('\n');
}

/**
 * A report has to carry something to act on: a note, an error the maker hit, or
 * the sheet itself. An empty submit is refused rather than stored.
 */
export function hasBugSubstance(message: string, ctx: BugContext, hasSheet: boolean): boolean {
  return message.trim().length > 0 || typeof ctx.error === 'string' || hasSheet;
}

export const MIN_BUG_SHEET_BYTES = 64;
// the client downscales to 2400px on the long side as JPEG, which lands well
// under this; the cap only stops a hand-crafted oversized upload
export const MAX_BUG_SHEET_BYTES = 4 * 1024 * 1024;
