# ADR 0020 — Better Auth canonical-domain config: BETTER_AUTH_URL and trustedOrigins on the custom domain

**Status:** Accepted · backfilled 2026-06-29 from project history (review and correct if the reconstruction is wrong)
**Date:** 2026-06-06

## Context

Sign-in/sign-up were fully broken on fonthead.dev with 403 'Invalid origin' because trustedOrigins came only from the workers.dev BETTER_AUTH_URL, and OAuth derives its redirect_uri and cookie domain from baseURL, so Google users bounced to the wrong host. curl and localhost e2e never send the production Origin header, so the bug shipped.

## Decision

Set BETTER_AUTH_URL (baseURL) to the canonical custom domain https://fonthead.dev (local .dev.vars stays http://localhost:4321), and set trustedOrigins to include https://fonthead.dev plus the workers.dev URL, BETTER_AUTH_URL, and localhost-in-dev. Adopt the rule that auth must be tested in a real browser on the actual domain.

## Alternatives rejected

Relying on BETTER_AUTH_URL alone to populate trustedOrigins (the prior behavior) was rejected. Leaving BETTER_AUTH_URL as the workers.dev URL was rejected (OAuth host mismatch). Relying on curl/localhost e2e to catch auth-origin bugs is explicitly insufficient.

## Consequences

OAuth redirect_uri and cookie domain are the canonical domain; trustedOrigins trusts both domains so email/password works from either; local override stays localhost. A new test discipline: auth must be verified in a real browser on the real domain because localhost e2e and curl never exercise the production Origin check.

## Evidence

Memory: 'auth.ts trustedOrigins now includes https://fonthead.dev + the workers.dev URL + BETTER_AUTH_URL + localhost-in-dev... LESSON: test auth in a real browser on the actual domain.' and 'BETTER_AUTH_URL is now https://fonthead.dev (was the workers.dev URL).'
