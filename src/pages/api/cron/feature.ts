// Computes and stores the daily feature. Called by the cron worker on a nightly
// schedule, and usable manually with the shared secret. Guarded so it cannot be
// triggered anonymously.
import type { APIRoute } from 'astro';
import { computeAndStoreFeatured } from '../../../lib/featured';

export const prerender = false;

export const POST: APIRoute = async ({ locals, request, url }) => {
  const env = locals.runtime.env;
  const key = url.searchParams.get('key') || request.headers.get('x-cron-key');
  if (!env.CRON_SECRET || key !== env.CRON_SECRET) {
    return new Response('forbidden', { status: 403 });
  }
  const result = await computeAndStoreFeatured(env.DB);
  return new Response(JSON.stringify(result), {
    headers: { 'content-type': 'application/json' },
  });
};
