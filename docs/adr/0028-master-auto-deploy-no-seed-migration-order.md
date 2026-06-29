# ADR 0028 — master auto-deploys without seeding; remote migrations run before deploy and require approval

**Status:** Accepted · backfilled 2026-06-29 from project history (review and correct if the reconstruction is wrong)
**Date:** 2026-06-05 to 2026-06-06

## Context

The repo is public (MIT), works on master, and needs reliable continuous deploy, but prod data must never be reset by a deploy. Separately, when live code reads a new column on every request (requireUser SELECTs banned; the font page SELECTs downloads_count), deploying code before the remote migration would 500 every affected request.

## Decision

Make master auto-deploy through a deploy job in .github/workflows/ci.yml that runs npm run deploy (astro build && wrangler deploy, no seed) on push, gated to skip-green when CLOUDFLARE_API_TOKEN is unset; seed prod once manually and only seed --local in CI. Apply remote D1 migrations before deploying schema-coupled code. Remote migrations are a production database change and require explicit approval; --local is unrestricted.

## Alternatives rejected

Including seed in the deploy path was rejected (prod deletions/edits must stick). Deploying code first, then migrating, was rejected ('deploying first would 500 all mutations').

## Consequences

Deploy never reseeds prod, so prod deletions are durable; CI deploy is a no-op without the token secret (CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID required to deploy). The migration-before-deploy ordering is a hard operational rule for any schema-coupled read.

## Evidence

Memory + CLAUDE.md + memory: 'npm run deploy is just astro build && wrangler deploy (NO seed), and CI only seeds --local' and 'DEPLOY ORDER IS STRICT: the remote migration MUST precede the deploy, because requireUser SELECTs banned on every mutation.'
