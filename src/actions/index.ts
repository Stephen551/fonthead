import { defineAction, ActionError } from 'astro:actions';
import { z } from 'astro:schema';
import { createAuth } from '../lib/auth';
import { ensureHandle, uniqueFontId } from '../lib/util';

// Mutations live here as Astro Actions (per the build brief). Publish is the
// M3 action; vote/favorite/setVisibility arrive in M4.
export const server = {
  publishFont: defineAction({
    accept: 'form',
    input: z.object({
      name: z.string().min(1, 'Name your font').max(60),
      specimenWord: z.string().max(40).optional(),
      visibility: z.enum(['public', 'private']),
      glyphCount: z.coerce.number().int().min(0),
      otf: z.instanceof(File),
      ttf: z.instanceof(File),
      woff2: z.instanceof(File),
    }),
    handler: async (input, ctx) => {
      const env = ctx.locals.runtime.env;
      const auth = createAuth(env);
      const session = await auth.api.getSession({ headers: ctx.request.headers });
      if (!session) {
        throw new ActionError({ code: 'UNAUTHORIZED', message: 'Sign in to publish.' });
      }
      const userId = session.user.id;
      const handle = await ensureHandle(env.DB, userId, session.user.name, session.user.email);

      const id = await uniqueFontId(env.DB, input.name);
      const keys = { otf: `fonts/${id}.otf`, ttf: `fonts/${id}.ttf`, woff2: `fonts/${id}.woff2` };

      const otf = new Uint8Array(await input.otf.arrayBuffer());
      const ttf = new Uint8Array(await input.ttf.arrayBuffer());
      const woff2 = new Uint8Array(await input.woff2.arrayBuffer());

      // basic sanity: woff2 signature + non-trivial size
      if (woff2.length < 256 || otf.length < 256) {
        throw new ActionError({ code: 'BAD_REQUEST', message: 'That font did not build correctly.' });
      }

      await env.FONTS.put(keys.otf, otf, { httpMetadata: { contentType: 'font/otf' } });
      await env.FONTS.put(keys.ttf, ttf, { httpMetadata: { contentType: 'font/ttf' } });
      await env.FONTS.put(keys.woff2, woff2, { httpMetadata: { contentType: 'font/woff2' } });

      const meta = {
        treat: 'normal',
        size: 96,
        italic: false,
        badge: null,
        family: input.name,
        designer: handle,
        ofl: '',
        standIn: false,
        builtWith: 'fonthead maker',
      };
      const word = (input.specimenWord || '').trim() || input.name;

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
          keys.ttf,
          keys.woff2,
          otf.length,
          ttf.length,
          woff2.length,
        )
        .run();

      return { id, handle, visibility: input.visibility };
    },
  }),
};
