# ADR 0026 — Daily feature computed by a separate scheduled cron worker

**Status:** Accepted · backfilled 2026-06-29 from project history (review and correct if the reconstruction is wrong)
**Date:** 2026-06-03 (ccdb7f4)

## Context

M5 required a recurring daily feature selection without per-request cost. The hero cycles the featured set when present, falling back to house fonts on cold start.

## Decision

Compute the previous calendar day's most-liked public fonts via computeAndStoreFeatured, exposed as a secret-guarded POST /api/cron/feature, and call it nightly from a standalone cron worker (wrangler.cron.jsonc, named fonthead-cron, 06:00 UTC) bound to the same D1. The cron secret is accepted only via header (kept out of logs) with a constant-time compare.

## Alternatives rejected

Not recorded.

## Consequences

Feature scheduling lives in a distinct worker config sharing the D1 binding rather than the main app; the cron route is protected by a header secret with constant-time comparison.

## Evidence

Memory + git commits ccdb7f4 'M5: daily feature — nightly cron computes the previous day most-liked' ('a standalone cron worker (wrangler.cron.jsonc, 06:00 UTC) calls it nightly, bound to the same D1') and b325060 ('cron secret accepted only via header (out of logs), constant-time compare').
