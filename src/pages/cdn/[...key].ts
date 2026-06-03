// Serves font binaries from the R2 FONTS bucket. The @font-face rules and the
// download links point here. All M1 stand-ins are public; M3 adds visibility
// gating (look up the font by woff2_key, require a session for private fonts).
import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async ({ params, locals, request }) => {
  const key = params.key;
  if (!key || !/^fonts\/[\w.-]+$/.test(key)) {
    return new Response('Not found', { status: 404 });
  }

  const env = locals.runtime.env;
  const object = await env.FONTS.get(key);
  if (!object) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  if (!headers.has('content-type')) headers.set('content-type', 'font/woff2');
  // public stand-in faces — cache hard and immutable (keys are content-stable)
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  headers.set('access-control-allow-origin', '*');

  // conditional request support
  if (request.headers.get('if-none-match') === object.httpEtag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(object.body, { headers });
};
