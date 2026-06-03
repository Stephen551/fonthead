// Better Auth catch-all. Builds the per-request instance from the Worker env
// and delegates every method to its handler.
import type { APIRoute } from 'astro';
import { createAuth } from '../../../lib/auth';

export const prerender = false;

export const ALL: APIRoute = async (ctx) => {
  const auth = createAuth(ctx.locals.runtime.env);
  return auth.handler(ctx.request);
};
