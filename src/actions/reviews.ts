import { defineAction, ActionError } from 'astro:actions';
import { z } from 'astro:schema';
import { createAuth } from '../lib/auth';
import { rateLimit } from '../lib/ratelimit';
import { REVIEW_PUBLIC_PERMISSION } from '../lib/reviews';

export const submitMakerReview = defineAction({
  input: z.object({
    id: z.string().uuid(),
    rating: z.number().int().min(1).max(5),
    message: z.string().trim().max(2000).default(''),
    allowPublic: z.boolean().default(false),
    website: z.string().max(200).optional(),
  }),
  handler: async (input, ctx) => {
    if (input.website?.trim()) return { ok: true };
    const env = ctx.locals.runtime.env;
    const ip = ctx.request.headers.get('cf-connecting-ip') || 'anon';
    if (!await rateLimit(env.SESSION, `maker-review:${ip}`, 5, 3600)) {
      throw new ActionError({ code: 'TOO_MANY_REQUESTS', message: 'Please wait a while before sending another review.' });
    }
    const session = await createAuth(env).api.getSession({ headers: ctx.request.headers });
    if (session) {
      const user = await env.DB.prepare('SELECT banned FROM "user" WHERE id = ?').bind(session.user.id).first<{ banned: number }>();
      if (user?.banned) throw new ActionError({ code: 'FORBIDDEN', message: 'Your account is suspended.' });
    }
    // A retry after a lost response must not duplicate the review or change its
    // permission. Opt-in wording is retained with the original submission.
    await env.DB.prepare(
      `INSERT INTO maker_reviews (id, user_id, rating, message, allow_public, permission_text)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
    ).bind(input.id, session?.user.id ?? null, input.rating, input.message, input.allowPublic ? 1 : 0,
      input.allowPublic ? REVIEW_PUBLIC_PERMISSION : null).run();
    return { ok: true };
  },
});
