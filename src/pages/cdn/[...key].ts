import type { APIRoute } from 'astro';
import { createAuth } from '../../lib/auth';

export const prerender = false;

// Serves font binaries and avatar images from the R2 FONTS bucket. Public objects
// are edge-cached with the Cloudflare Cache API, so a repeat download is served
// from cache instead of re-reading R2. Private fonts are owner-gated and never
// cached, and the D1 visibility lookup runs on every request, so a font flipped to
// private stops serving at once even if a public copy was cached earlier.
export const GET: APIRoute = async ({ params, locals, request }) => {
  const key = params.key;
  const env = locals.runtime.env;
  const ctx = locals.runtime.ctx;
  const cache = (
    globalThis as unknown as {
      caches?: { default?: { match(r: Request): Promise<Response | undefined>; put(r: Request, res: Response): Promise<void> } };
    }
  ).caches?.default;
  // a clean, header-free cache key so range/conditional headers don't fragment it
  const cacheKey = new Request(new URL(request.url).toString());

  // Return 304 if the caller already holds this etag, otherwise the response.
  const conditional = (response: Response): Response => {
    const inm = request.headers.get('if-none-match');
    const etag = response.headers.get('etag');
    if (inm && etag && inm === etag) return new Response(null, { status: 304, headers: response.headers });
    return response;
  };

  // Serve a public object from R2 via the edge cache. Visibility (for fonts) must
  // already be confirmed by the caller; avatars are always public.
  const servePublic = async (k: string, headers: Headers): Promise<Response> => {
    if (cache) {
      const hit = await cache.match(cacheKey);
      if (hit) return conditional(hit);
    }
    const object = await env.FONTS.get(k);
    if (!object) return new Response('Not found', { status: 404 });
    headers.set('etag', object.httpEtag);
    const response = new Response(object.body, { headers });
    if (cache && ctx?.waitUntil) ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return conditional(response);
  };

  // Avatars: public images, no font-row lookup (they have none).
  if (key && /^avatars\/[\w-]+\.(png|jpg|webp)$/.test(key)) {
    const ext = key.slice(key.lastIndexOf('.') + 1);
    const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    return servePublic(
      key,
      new Headers({
        'content-type': type,
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'cache-control': 'public, max-age=86400',
        'access-control-allow-origin': '*',
      }),
    );
  }

  if (!key || !/^fonts\/[\w.-]+\.(otf|ttf|woff2)$/.test(key)) {
    return new Response('Not found', { status: 404 });
  }

  const id = key.replace(/^fonts\//, '').replace(/\.(otf|ttf|woff2)$/, '');
  // visibility gate, live on every request so a flip to private takes effect now
  const row = await env.DB.prepare('SELECT visibility, owner_id FROM fonts WHERE id = ?')
    .bind(id)
    .first<{ visibility: string; owner_id: string | null }>();
  if (!row) return new Response('Not found', { status: 404 });

  const ext = key.slice(key.lastIndexOf('.') + 1);
  const ctype = ext === 'otf' ? 'font/otf' : ext === 'ttf' ? 'font/ttf' : 'font/woff2';

  if (row.visibility === 'private') {
    const auth = createAuth(env);
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session || session.user.id !== row.owner_id) {
      return new Response('Not found', { status: 404 });
    }
    // private: owner-only, never cached
    const object = await env.FONTS.get(key);
    if (!object) return new Response('Not found', { status: 404 });
    const headers = new Headers({
      'content-type': ctype,
      etag: object.httpEtag,
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'cache-control': 'private, no-store',
    });
    return conditional(new Response(object.body, { headers }));
  }

  // public font: edge-cached, immutable
  return servePublic(
    key,
    new Headers({
      'content-type': ctype,
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'cache-control': 'public, max-age=31536000, immutable',
      'access-control-allow-origin': '*',
    }),
  );
};
