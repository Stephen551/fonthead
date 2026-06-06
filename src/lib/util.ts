// Shared server helpers: slugs, font ids, and handle assignment.

/** Escape a JSON string for safe embedding inside an HTML <script> element.
 *  JSON.stringify does not escape < > or &, so a value containing </script>
 *  would break out of the element. Escaping them to their \uXXXX form keeps the
 *  text valid JSON (JSON.parse restores the characters) while making a markup
 *  breakout impossible. Use on the output of JSON.stringify, never on raw HTML. */
export function escapeJsonForScript(json: string): string {
  return json.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

/** Is this email in the comma-separated admin allowlist? Case-insensitive,
 *  whitespace-tolerant. Empty list or empty email means not an admin. */
export function isAdminEmail(adminList: string | undefined | null, email: string | undefined | null): boolean {
  if (!email) return false;
  const admins = (adminList || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.toLowerCase());
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s.-]/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 32) || 'untitled'
  );
}

/** Normalize a user-typed handle to its canonical url-safe slug. Unlike slugify
 *  there is no 'untitled' fallback: an unusable input returns '' so the caller
 *  can reject it. Keeps [a-z0-9.-], collapses runs, trims edges, caps at 32. */
export function normalizeHandle(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w.\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 32);
}

/** A handle is acceptable if its normalized form is 2 to 32 characters. */
export function isValidHandle(s: string): boolean {
  const h = normalizeHandle(s);
  return h.length >= 2 && h.length <= 32;
}

/** Handles that would impersonate the site or a system area. Compared against
 *  the normalized form. */
export const RESERVED_HANDLES = new Set([
  'admin', 'administrator', 'root', 'support', 'help', 'about', 'fonthead',
  'staff', 'team', 'mod', 'moderator', 'official', 'api', 'cdn', 'www', 'account',
]);

const rand = (n: number) =>
  Array.from({ length: n }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');

/** A unique, readable font id: slug of the name plus a short suffix. */
export async function uniqueFontId(db: D1Database, name: string): Promise<string> {
  const base = slugify(name);
  for (let i = 0; i < 6; i++) {
    const id = `${base}-${rand(5)}`;
    const taken = await db.prepare('SELECT 1 FROM fonts WHERE id = ?').bind(id).first();
    if (!taken) return id;
  }
  return `${base}-${rand(8)}`;
}

/** Return the user's handle, assigning one (from name/email) on first need. */
export async function ensureHandle(
  db: D1Database,
  userId: string,
  name?: string | null,
  email?: string | null,
): Promise<string> {
  const row = await db.prepare('SELECT handle FROM "user" WHERE id = ?').bind(userId).first<{ handle: string | null }>();
  if (row?.handle) return row.handle;

  const base = slugify(name || (email || '').split('@')[0] || 'maker');
  const claim = async (handle: string): Promise<boolean> => {
    const taken = await db.prepare('SELECT 1 FROM "user" WHERE handle = ? AND id <> ?').bind(handle, userId).first();
    if (taken) return false;
    try {
      await db
        .prepare('UPDATE "user" SET handle = ?, "updatedAt" = ? WHERE id = ?')
        .bind(handle, new Date().toISOString(), userId)
        .run();
      return true;
    } catch {
      // UNIQUE(handle) conflict from a concurrent claim — caller retries
      return false;
    }
  };

  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    if (await claim(candidate)) return candidate;
  }
  // last resort: random suffix
  const fallback = `${base}-${Math.random().toString(36).slice(2, 7)}`;
  await claim(fallback);
  return fallback;
}
