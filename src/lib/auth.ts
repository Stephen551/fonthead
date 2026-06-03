import { betterAuth } from 'better-auth';

// Per-request Better Auth factory. On Workers the D1 binding only exists at
// request time (Astro.locals.runtime.env), so the instance must be built per
// request — never at module top level. Better Auth 1.5+ detects the D1 binding
// natively, so we pass env.DB straight in.
export function createAuth(env: Env) {
  return betterAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    emailAndPassword: { enabled: true },
    // Permissive for the M1 spike across local ports + the deploy origin.
    // Tighten to the canonical origin in M3.
    trustedOrigins: [
      env.BETTER_AUTH_URL,
      'http://localhost:4321',
      'http://127.0.0.1:4321',
      'http://localhost:8788',
      'http://127.0.0.1:8788',
    ].filter(Boolean),
  });
}

export type Auth = ReturnType<typeof createAuth>;
