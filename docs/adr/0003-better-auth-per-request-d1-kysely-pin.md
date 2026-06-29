# ADR 0003 — Better Auth on native D1, built per-request, with kysely pinned to 0.28.17

**Status:** Accepted · backfilled 2026-06-29 from project history (review and correct if the reconstruction is wrong)
**Date:** 2026-06-02 to 2026-06-03 (d617814)

## Context

Authentication must run inside the Cloudflare Worker per-request model, where bindings (DB) are only available per request via env. Better Auth depends on kysely, and a newer kysely broke the Worker bundle.

## Decision

Use Better Auth 1.5+ against native D1 (database: env.DB), constructed per request via a createAuth(env) factory in src/lib/auth.ts, with a catch-all /api/auth route and SSR session reads. Pin kysely to 0.28.17 via package.json overrides.

## Alternatives rejected

kysely 0.29 was rejected: it dropped DEFAULT_MIGRATION_TABLE, which Better Auth's adapter still imports, breaking the Worker bundle.

## Consequences

Auth is instantiated per request from env; trustedOrigins, baseURL, and OAuth config all derive from per-request construction. kysely is held at 0.28.17 until Better Auth can tolerate 0.29; upgrading it is a known landmine. This setup later forced explicit trustedOrigins handling and BETTER_AUTH_URL choices for the custom domain.

## Evidence

Memory + CLAUDE.md + git commit d617814 'M1: Better Auth spike on D1 with a protected SSR route': 'Per-request createAuth(env) factory using Better Auth 1.5+ native D1... Pins kysely to 0.28.17 via overrides: 0.29 dropped DEFAULT_MIGRATION_TABLE.'
