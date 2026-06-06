import { betterAuth } from 'better-auth';

// Per-request Better Auth factory. On Workers the D1 binding only exists at
// request time (Astro.locals.runtime.env), so the instance must be built per
// request — never at module top level. Better Auth 1.5+ detects the D1 binding
// natively, so we pass env.DB straight in.
export function createAuth(env: Env) {
  // Fail loud and early on a missing config rather than booting an auth instance
  // with an empty secret (which would silently break sessions in production).
  if (!env.BETTER_AUTH_SECRET || !env.BETTER_AUTH_URL) {
    throw new Error('Auth is not configured: BETTER_AUTH_SECRET and BETTER_AUTH_URL are required.');
  }
  // A browser sends an Origin header that Better Auth checks against this list;
  // the live domain MUST be here or sign-in/sign-up fail with "Invalid origin".
  // Trust the canonical domain, the workers.dev fallback, whatever BETTER_AUTH_URL
  // is set to, and localhost only when running locally.
  const isLocal = /localhost|127\.0\.0\.1/.test(env.BETTER_AUTH_URL || '');
  const trustedOrigins = [
    ...new Set([
      env.BETTER_AUTH_URL,
      'https://fonthead.dev',
      'https://fonthead.stephenalatriste.workers.dev',
      ...(isLocal
        ? ['http://localhost:4321', 'http://127.0.0.1:4321', 'http://localhost:8788', 'http://127.0.0.1:8788']
        : []),
    ]),
  ].filter((o): o is string => !!o);

  return betterAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    emailAndPassword: { enabled: true },
    trustedOrigins,
    advanced: {
      // single-origin app: Lax is the right default, and Secure everywhere but
      // local http. Explicit so it does not ride on a browser default.
      defaultCookieAttributes: {
        sameSite: 'lax',
        secure: !isLocal,
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
