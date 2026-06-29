# ADR 0015 — KV fixed-window rate limiting plus binary-signature upload validation on mutations

**Status:** Accepted · backfilled 2026-06-29 from project history (review and correct if the reconstruction is wrong)
**Date:** 2026-06-03 (7cc4ba1 / a0a5b77 / b325060)

## Context

The app needed abuse throttling across mutations and untrusted-upload validation. KV is already a binding (SESSION), and the client-supplied MIME type is forgeable.

## Decision

Add a KV-backed (SESSION) fixed-window rate limiter (src/lib/ratelimit.ts) applied per user to authed mutations (vote/favorite/publish/report) and per IP to public actions (feedback, download, funnel). Validate published fonts by their real binary font-signature (OTTO / 0x00010000 / wOF2) with a 5MB ceiling server-side, and validate avatars by image signature, rather than trusting the client MIME type.

## Alternatives rejected

Trusting the client-supplied MIME type was rejected ('not just the client MIME type'). The rate-limiter mechanism itself records no rejected alternative.

## Consequences

Every mutation is rate limited; public endpoints key by IP, authed actions key by user. Untrusted uploads are gated on actual bytes; the limiter and signature detectors are pure, unit-tested helpers.

## Evidence

Memory + git commits 7cc4ba1 'feat(security): rate limiter, font-signature, and admin helpers', a0a5b77 ('Every mutation is rate limited per user via the SESSION KV'), b325060 ('5MB ceiling + real font-signature validation (OTTO/0x00010000/wOF2), not just the client MIME type'), 2acaf52.
