# ADR 0024 — Edge-cache public binaries at the CDN while keeping the D1 visibility check live

**Status:** Accepted · backfilled 2026-06-29 from project history (review and correct if the reconstruction is wrong)
**Date:** 2026-06-04 to 2026-06-06 (5f5fd82 / 3a49892)

## Context

Repeat downloads were re-reading R2, and the assets binding defaulted to max-age=0 must-revalidate, forcing 304 round trips. Caching had to not leak private fonts: a font flipped to private must stop serving immediately, and a private font's card must never leak its name.

## Decision

Serve public R2 objects (fonts, avatars, og cards) through the Cloudflare Cache API so repeat downloads skip the R2 read, but run the D1 visibility check on every request and never cache private fonts. Cache /_astro/*, /fonts/*, /assets/* immutably for a year via a _headers file (safe because bundles are content-hashed, fonts stable, the engine ?v=-busted). Redirect HTTP to HTTPS at the worker (localhost skipped).

## Alternatives rejected

Caching without the per-request visibility check was rejected (a font flipped to private must stop serving immediately). Relying on edge defaults was rejected (forced revalidate-on-every-visit 304s).

## Consequences

Public objects are edge-cached; privacy changes take effect immediately because the visibility check stays live. The immutable _headers caching depends on the content-hashing/cache-bust guarantees holding.

## Evidence

Git commits 3a49892 'Edge-cache public fonts and avatars at the CDN' ('The D1 visibility check stays live on every request and private fonts are never cached'), 5f5fd82 'Cache static assets immutably (_headers)', dda0f7e.
