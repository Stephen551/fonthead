// Serves font binaries from the R2 FONTS bucket. Public fonts are cached hard
// and immutable; private fonts are gated to their owner via the session. The
// key is fonts/<id>.<ext>, so visibility is looked up by font id (primary key).
import type { APIRoute } from 'astro';
import { createAuth } from '../../lib/auth';

export const prerender = false;

export const GET: APIRoute = async ({ params, locals, request }) => {
  const key = params.key;
  if (!key || !/^fonts\/[\w.-]+\.(otf|ttf|woff2)$/.test(key)) {
    return new Response('Not found', { status: 404 });
  }

  const env = locals.runtime.env;
  const id = key.replace(/^fonts\//, '').replace(/\.(otf|ttf|woff2)$/, '');

  // visibility gate: only private fonts incur the auth check
  const row = await env.DB.prepare('SELECT visibility, owner_id FROM fonts WHERE id = ?')
    .bind(id)
    .first<{ visibility: string; owner_id: string | null }>();
  const isPrivate = row?.visibility === 'private';

  if (isPrivate) {
    const auth = createAuth(env);
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session || session.user.id !== row?.owner_id) {
      return new Response('Not found', { status: 404 });
    }
  }

  const object = await env.FONTS.get(key);
  if (!object) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  if (!headers.has('content-type')) headers.set('content-type', 'font/woff2');
  if (isPrivate) {
    headers.set('cache-control', 'private, no-store');
  } else {
    headers.set('cache-control', 'public, max-age=31536000, immutable');
    headers.set('access-control-allow-origin', '*');
  }

  if (request.headers.get('if-none-match') === object.httpEtag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(object.body, { headers });
};
