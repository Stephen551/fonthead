import { betterAuth } from 'better-auth';

// Per-request Better Auth factory. On Workers the D1 binding only exists at
// request time (Astro.locals.runtime.env), so the instance must be built per
// request — never at module top level. Better Auth 1.5+ detects the D1 binding
// natively, so we pass env.DB straight in.
export function createAuth(env: Env) {
  // localhost origins are trusted only when running locally; production trusts
  // just its own canonical origin.
  const isLocal = /localhost|127\.0\.0\.1/.test(env.BETTER_AUTH_URL || '');
  const trustedOrigins = [
    env.BETTER_AUTH_URL,
    ...(isLocal
      ? ['http://localhost:4321', 'http://127.0.0.1:4321', 'http://localhost:8788', 'http://127.0.0.1:8788']
      : []),
  ].filter(Boolean);

  return betterAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    emailAndPassword: { enabled: true },
    trustedOrigins,
  });
}

export type Auth = ReturnType<typeof createAuth>;
