import { defineAction, ActionError } from 'astro:actions';
import { z } from 'astro:schema';
import { createAuth } from '../lib/auth';
import { ensureHandle, uniqueFontId, isAdminEmail, normalizeHandle, isValidHandle, RESERVED_HANDLES } from '../lib/util';
import { verifySfntChecksums } from '../lib/sfnt';
import { isOtf, isTtf, isWoff2 } from '../lib/fontsig';
import { imageExt, MIN_AVATAR_BYTES, MAX_AVATAR_BYTES, AVATAR_CONTENT_TYPE } from '../lib/imagesig';
import { rateLimit } from '../lib/ratelimit';

// Mutations live here as Astro Actions (per the build brief).
async function requireUser(ctx: { locals: App.Locals; request: Request }) {
  const env = ctx.locals.runtime.env;
  const auth = createAuth(env);
  const session = await auth.api.getSession({ headers: ctx.request.headers });
  if (!session) throw new ActionError({ code: 'UNAUTHORIZED', message: 'Sign in first.' });
  return { env, userId: session.user.id, email: session.user.email };
}

// Per-user rate limit on a named action; throws 429 when over budget.
async function limit(env: Env, who: string, action: string, max: number, windowSec: number) {
  const ok = await rateLimit(env.SESSION, `${action}:${who}`, max, windowSec);
  if (!ok) throw new ActionError({ code: 'TOO_MANY_REQUESTS', message: 'Slow down a moment and try again.' });
}

// Admins are configured via the ADMIN_EMAILS env (comma-separated). Used to gate
// the takedown action.
function isAdmin(env: Env, email: string | null | undefined): boolean {
  return isAdminEmail(env.ADMIN_EMAILS, email);
}

// A font is interactable (vote/favorite) only if it exists and is public, or
// the viewer owns it. Prevents voting/favoriting on others' private fonts.
async function assertInteractable(env: Env, fontId: string, userId: string) {
  const font = await env.DB.prepare('SELECT visibility, owner_id FROM fonts WHERE id = ?')
    .bind(fontId)
    .first<{ visibility: string; owner_id: string | null }>();
  if (!font) throw new ActionError({ code: 'NOT_FOUND', message: 'No such font.' });
  if (font.visibility === 'private' && font.owner_id !== userId) {
    throw new ActionError({ code: 'NOT_FOUND', message: 'No such font.' });
  }
}

const MAX_FONT_BYTES = 5 * 1024 * 1024;

export const server = {
  toggleVote: defineAction({
    input: z.object({ fontId: z.string().min(1) }),
    handler: async ({ fontId }, ctx) => {
      const { env, userId } = await requireUser(ctx);
      await limit(env, userId, 'vote', 120, 60);
      await assertInteractable(env, fontId, userId);
      const existing = await env.DB.prepare('SELECT 1 FROM votes WHERE user_id = ? AND font_id = ?')
        .bind(userId, fontId)
        .first();
      // Toggle, recount from the votes table, and read the fresh count all in one
      // atomic batch, so votes_count cannot drift and the returned number cannot
      // be stale from a racing toggle.
      const toggle = existing
        ? env.DB.prepare('DELETE FROM votes WHERE user_id = ? AND font_id = ?').bind(userId, fontId)
        : env.DB.prepare('INSERT OR IGNORE INTO votes (user_id, font_id) VALUES (?, ?)').bind(userId, fontId);
      const recount = env.DB
        .prepare('UPDATE fonts SET votes_count = (SELECT COUNT(*) FROM votes WHERE font_id = ?) WHERE id = ?')
        .bind(fontId, fontId);
      const read = env.DB.prepare('SELECT votes_count FROM fonts WHERE id = ?').bind(fontId);
      const results = await env.DB.batch<{ votes_count: number }>([toggle, recount, read]);
      const count = results[2]?.results?.[0]?.votes_count ?? 0;
      return { voted: !existing, count };
    },
  }),

  toggleFavorite: defineAction({
    input: z.object({ fontId: z.string().min(1) }),
    handler: async ({ fontId }, ctx) => {
      const { env, userId } = await requireUser(ctx);
      await limit(env, userId, 'fav', 120, 60);
      await assertInteractable(env, fontId, userId);
      const existing = await env.DB.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND font_id = ?')
        .bind(userId, fontId)
        .first();
      if (existing) {
        await env.DB.prepare('DELETE FROM favorites WHERE user_id = ? AND font_id = ?').bind(userId, fontId).run();
      } else {
        await env.DB.prepare('INSERT OR IGNORE INTO favorites (user_id, font_id) VALUES (?, ?)')
          .bind(userId, fontId)
          .run();
      }
      return { favorited: !existing };
    },
  }),

  setVisibility: defineAction({
    input: z.object({ fontId: z.string().min(1), visibility: z.enum(['public', 'private']) }),
    handler: async ({ fontId, visibility }, ctx) => {
      const { env, userId } = await requireUser(ctx);
      const owned = await env.DB.prepare('SELECT 1 FROM fonts WHERE id = ? AND owner_id = ?')
        .bind(fontId, userId)
        .first();
      if (!owned) throw new ActionError({ code: 'FORBIDDEN', message: 'Not your font.' });
      await env.DB.prepare('UPDATE fonts SET visibility = ? WHERE id = ?').bind(visibility, fontId).run();
      return { visibility };
    },
  }),

  publishFont: defineAction({
    accept: 'form',
    input: z.object({
      // Reject HTML markup characters in user-facing strings: defence in depth
      // behind the data-island escaping, so a font name can never carry a script
      // breakout no matter where it is later rendered.
      name: z
        .string()
        .min(1, 'Name your font')
        .max(60)
        .refine((s) => !/[<>&]/.test(s), 'Name cannot contain < > or &'),
      specimenWord: z
        .string()
        .max(40)
        .refine((s) => !/[<>&]/.test(s), 'Specimen cannot contain < > or &')
        .optional(),
      visibility: z.enum(['public', 'private']),
      glyphCount: z.coerce.number().int().min(0).max(10000),
      // 'normal' = monochrome (otf+ttf+woff2); 'gradient'/'flat' = COLR/CPAL color (otf+woff2, no ttf)
      treat: z.enum(['normal', 'gradient', 'flat']).default('normal'),
      otf: z.instanceof(File),
      woff2: z.instanceof(File),
      ttf: z.instanceof(File).optional(),
    }),
    handler: async (input, ctx) => {
      const env = ctx.locals.runtime.env;
      const auth = createAuth(env);
      const session = await auth.api.getSession({ headers: ctx.request.headers });
      if (!session) {
        throw new ActionError({ code: 'UNAUTHORIZED', message: 'Sign in to publish.' });
      }
      const userId = session.user.id;
      await limit(env, userId, 'publish', 20, 3600);
      const handle = await ensureHandle(env.DB, userId, session.user.name, session.user.email);

      const id = await uniqueFontId(env.DB, input.name);
      const keys = { otf: `fonts/${id}.otf`, ttf: `fonts/${id}.ttf`, woff2: `fonts/${id}.woff2` };

      const otf = new Uint8Array(await input.otf.arrayBuffer());
      const woff2 = new Uint8Array(await input.woff2.arrayBuffer());
      const ttf = input.ttf ? new Uint8Array(await input.ttf.arrayBuffer()) : null;

      // size floor (must have built) + ceiling (no unbounded R2 writes)
      if (otf.length < 256 || woff2.length < 256 || (ttf && ttf.length < 256)) {
        throw new ActionError({ code: 'BAD_REQUEST', message: 'That font did not build correctly.' });
      }
      if (otf.length > MAX_FONT_BYTES || woff2.length > MAX_FONT_BYTES || (ttf && ttf.length > MAX_FONT_BYTES)) {
        throw new ActionError({ code: 'BAD_REQUEST', message: 'Font file too large.' });
      }
      // validate real font signatures (don't trust the client-declared type)
      if (!isOtf(otf) || !isWoff2(woff2) || (ttf && !isTtf(ttf))) {
        throw new ActionError({ code: 'BAD_REQUEST', message: 'Those are not valid font files.' });
      }
      // table-checksum gate: never publish a font Windows would reject
      const otfCk = verifySfntChecksums(otf);
      if (!otfCk.ok) {
        throw new ActionError({ code: 'BAD_REQUEST', message: `Font has invalid checksums: ${otfCk.errors.join('; ')}` });
      }
      if (ttf) {
        const ttfCk = verifySfntChecksums(ttf);
        if (!ttfCk.ok) {
          throw new ActionError({ code: 'BAD_REQUEST', message: `TTF has invalid checksums: ${ttfCk.errors.join('; ')}` });
        }
      }

      // A real color font carries its own COLR/CPAL color, so no CSS treatment
      // is applied (treat stays 'normal'); it just earns the color badge.
      const isColor = input.treat !== 'normal';
      const meta = {
        treat: 'normal',
        size: 96,
        italic: false,
        badge: isColor ? 'color' : null,
        family: input.name,
        designer: handle,
        ofl: '',
        standIn: false,
        builtWith: 'fonthead maker',
        ...(isColor ? { colorMode: input.treat } : {}),
      };
      const word = (input.specimenWord || '').trim() || input.name;

      // Write R2 then D1 with rollback: if the row insert fails after any object
      // was written, delete those objects so a failed publish never orphans
      // binaries in the bucket.
      const written: string[] = [];
      try {
        await env.FONTS.put(keys.otf, otf, { httpMetadata: { contentType: 'font/otf' } });
        written.push(keys.otf);
        await env.FONTS.put(keys.woff2, woff2, { httpMetadata: { contentType: 'font/woff2' } });
        written.push(keys.woff2);
        if (ttf) {
          await env.FONTS.put(keys.ttf, ttf, { httpMetadata: { contentType: 'font/ttf' } });
          written.push(keys.ttf);
        }
        await env.DB.prepare(
          `INSERT INTO fonts
             (id, owner_id, name, maker_handle, specimen_word, meta, visibility,
              glyph_count, otf_key, ttf_key, woff2_key, otf_size, ttf_size, woff2_size, votes_count)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
        )
          .bind(
            id,
            userId,
            input.name,
            handle,
            word,
            JSON.stringify(meta),
            input.visibility,
            input.glyphCount,
            keys.otf,
            ttf ? keys.ttf : null,
            keys.woff2,
            otf.length,
            ttf ? ttf.length : null,
            woff2.length,
          )
          .run();
      } catch (e) {
        await Promise.allSettled(written.map((k) => env.FONTS.delete(k)));
        if (e instanceof ActionError) throw e;
        throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: 'Publish failed, nothing was saved. Try again.' });
      }

      return { id, handle, visibility: input.visibility };
    },
  }),

  // Anyone signed in can flag a font they can see. The report is stored for an
  // admin to action; it does not change the font's visibility.
  reportFont: defineAction({
    input: z.object({ fontId: z.string().min(1), reason: z.string().min(1, 'Add a reason').max(500) }),
    handler: async ({ fontId, reason }, ctx) => {
      const { env, userId } = await requireUser(ctx);
      await limit(env, userId, 'report', 15, 3600);
      await assertInteractable(env, fontId, userId);
      await env.DB.prepare('INSERT INTO reports (id, font_id, reporter_id, reason) VALUES (?,?,?,?)')
        .bind(crypto.randomUUID(), fontId, userId, reason.trim())
        .run();
      return { ok: true };
    },
  }),

  // Admin takedown: delete the row (cascades votes/favorites/reports) and remove
  // the font's R2 objects so nothing is left serving.
  removeFont: defineAction({
    input: z.object({ fontId: z.string().min(1) }),
    handler: async ({ fontId }, ctx) => {
      const { env, email } = await requireUser(ctx);
      if (!isAdmin(env, email)) throw new ActionError({ code: 'FORBIDDEN', message: 'Not allowed.' });
      const row = await env.DB.prepare('SELECT otf_key, ttf_key, woff2_key FROM fonts WHERE id = ?')
        .bind(fontId)
        .first<{ otf_key: string | null; ttf_key: string | null; woff2_key: string | null }>();
      if (!row) throw new ActionError({ code: 'NOT_FOUND', message: 'No such font.' });
      await env.DB.prepare('DELETE FROM fonts WHERE id = ?').bind(fontId).run();
      const keys = [row.otf_key, row.ttf_key, row.woff2_key].filter((k): k is string => !!k);
      await Promise.allSettled(keys.map((k) => env.FONTS.delete(k)));
      return { ok: true };
    },
  }),

  // Live availability for the handle picker. Read-only: returns the normalized
  // form and whether it is free, taken, or not a valid handle.
  checkHandle: defineAction({
    input: z.object({ handle: z.string().min(1).max(40) }),
    handler: async ({ handle }, ctx) => {
      // Anonymous-friendly: the sign-up picker calls this before an account
      // exists. Availability is public anyway (handles live at /u/<handle>). When
      // signed in (the account editor) the user's own handle is excluded.
      const env = ctx.locals.runtime.env;
      const auth = createAuth(env);
      const session = await auth.api.getSession({ headers: ctx.request.headers });
      const who = session?.user.id ?? ctx.request.headers.get('cf-connecting-ip') ?? 'anon';
      await limit(env, who, 'handlecheck', 60, 60);
      const normalized = normalizeHandle(handle);
      if (!isValidHandle(handle) || RESERVED_HANDLES.has(normalized)) {
        return { available: false, normalized, reason: 'invalid' as const };
      }
      const taken = session
        ? await env.DB.prepare('SELECT 1 FROM "user" WHERE handle = ? AND id <> ?')
            .bind(normalized, session.user.id)
            .first()
        : await env.DB.prepare('SELECT 1 FROM "user" WHERE handle = ?').bind(normalized).first();
      return { available: !taken, normalized, reason: (taken ? 'taken' : 'ok') as 'taken' | 'ok' };
    },
  }),

  // Claim a handle, once. Sets it and locks it, and rewrites the maker credit on
  // the owner's existing fonts so their attribution stays correct. The user
  // UPDATE is guarded by handle_locked = 0 so a second claim cannot overwrite it,
  // and a UNIQUE(handle) collision (someone claimed it between check and claim)
  // surfaces as a conflict.
  claimHandle: defineAction({
    input: z.object({ handle: z.string().min(1).max(40) }),
    handler: async ({ handle }, ctx) => {
      const { env, userId } = await requireUser(ctx);
      await limit(env, userId, 'claimhandle', 10, 3600);
      const normalized = normalizeHandle(handle);
      if (!isValidHandle(handle) || RESERVED_HANDLES.has(normalized)) {
        throw new ActionError({
          code: 'BAD_REQUEST',
          message: 'Pick a handle of 2 to 32 letters, numbers, dots, or dashes.',
        });
      }
      const current = await env.DB.prepare('SELECT handle_locked FROM "user" WHERE id = ?')
        .bind(userId)
        .first<{ handle_locked: number }>();
      if (current?.handle_locked) {
        throw new ActionError({ code: 'FORBIDDEN', message: 'Your handle is already set.' });
      }
      try {
        const now = new Date().toISOString();
        const setUser = env.DB
          .prepare('UPDATE "user" SET handle = ?, handle_locked = 1, "updatedAt" = ? WHERE id = ? AND handle_locked = 0')
          .bind(normalized, now, userId);
        const setFonts = env.DB.prepare('UPDATE fonts SET maker_handle = ? WHERE owner_id = ?').bind(normalized, userId);
        const results = await env.DB.batch([setUser, setFonts]);
        const changed = results[0]?.meta?.changes ?? 0;
        if (!changed) {
          throw new ActionError({ code: 'CONFLICT', message: 'Your handle is already set.' });
        }
      } catch (e) {
        if (e instanceof ActionError) throw e;
        throw new ActionError({ code: 'CONFLICT', message: 'That handle was just taken. Pick another.' });
      }
      return { handle: normalized };
    },
  }),

  // Edit the profile: display name, bio, and an optional avatar. The avatar is
  // validated by magic bytes (no SVG) and size, written to R2 under avatars/<id>,
  // then recorded on the user row. A failed row update drops the just-written
  // object, and a format change cleans up the previous key so nothing orphans.
  updateProfile: defineAction({
    accept: 'form',
    input: z.object({
      name: z
        .string()
        .min(1, 'Add a name')
        .max(60)
        .refine((s) => !/[<>&]/.test(s), 'Name cannot contain < > or &'),
      bio: z
        .string()
        .max(280)
        .refine((s) => !/[<>&]/.test(s), 'Bio cannot contain < > or &')
        .optional(),
      avatar: z.instanceof(File).optional(),
    }),
    handler: async (input, ctx) => {
      const { env, userId } = await requireUser(ctx);
      await limit(env, userId, 'profile', 30, 3600);
      const bio = (input.bio || '').trim();

      let newKey: string | null = null;
      if (input.avatar && input.avatar.size > 0) {
        const bytes = new Uint8Array(await input.avatar.arrayBuffer());
        if (bytes.length < MIN_AVATAR_BYTES) {
          throw new ActionError({ code: 'BAD_REQUEST', message: 'That image did not upload correctly.' });
        }
        if (bytes.length > MAX_AVATAR_BYTES) {
          throw new ActionError({ code: 'BAD_REQUEST', message: 'Avatar must be under 2 MB.' });
        }
        const ext = imageExt(bytes);
        if (!ext) {
          throw new ActionError({ code: 'BAD_REQUEST', message: 'Avatar must be a PNG, JPEG, or WebP image.' });
        }
        newKey = `avatars/${userId}.${ext}`;
        await env.FONTS.put(newKey, bytes, { httpMetadata: { contentType: AVATAR_CONTENT_TYPE[ext] } });
      }

      const prev = await env.DB.prepare('SELECT image FROM "user" WHERE id = ?')
        .bind(userId)
        .first<{ image: string | null }>();
      const prevKey = prev?.image ?? null;

      try {
        const now = new Date().toISOString();
        if (newKey) {
          await env.DB.prepare('UPDATE "user" SET name = ?, bio = ?, image = ?, "updatedAt" = ? WHERE id = ?')
            .bind(input.name, bio, newKey, now, userId)
            .run();
        } else {
          await env.DB.prepare('UPDATE "user" SET name = ?, bio = ?, "updatedAt" = ? WHERE id = ?')
            .bind(input.name, bio, now, userId)
            .run();
        }
      } catch {
        if (newKey) await env.FONTS.delete(newKey).catch(() => {});
        throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not save your profile. Try again.' });
      }

      if (newKey && prevKey && prevKey !== newKey) {
        await env.FONTS.delete(prevKey).catch(() => {});
      }
      return { ok: true, image: newKey ?? prevKey };
    },
  }),
};
