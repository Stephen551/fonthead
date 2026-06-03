// Computes and stores the daily feature. The cron worker computes this directly
// on its nightly schedule; this endpoint is the manual trigger. The secret is
// accepted only via the x-cron-key header (never a query param, to keep it out
// of access logs) and compared in constant time.
import type { APIRoute } from 'astro';
import { computeAndStoreFeatured } from '../../../lib/featured';

export const prerender = false;

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export const POST: APIRoute = async ({ locals, request }) => {
  const env = locals.runtime.env;
  const key = request.headers.get('x-cron-key');
  if (!env.CRON_SECRET || !key || !safeEqual(key, env.CRON_SECRET)) {
    return new Response('forbidden', { status: 403 });
  }
  const result = await computeAndStoreFeatured(env.DB);
  return new Response(JSON.stringify(result), {
    headers: { 'content-type': 'application/json' },
  });
};
