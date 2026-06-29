# ADR 0006 — No React on content pages; React only on the maker

**Status:** Accepted · backfilled 2026-06-29 from project history (review and correct if the reconstruction is wrong)
**Date:** 2026-06-03 (57b28ef)

## Context

M6 was an accessibility and performance milestone. The cycling masthead hero was the only React island on the wall, pulling the whole ~186KB React runtime onto the highest-traffic page for a tiny animation.

## Decision

Keep content pages free of React. Re-render the cycling masthead hero server-side with a small vanilla cycler in app.ts (and do the M6 morph via native View Transitions / FLIP), so the library, font page, and profiles ship zero React. React loads only on /make for the maker island.

## Alternatives rejected

Keeping a React island for the hero animation and content pages was rejected for the payload it forced onto every content page.

## Consequences

Content pages now ship ~17KB of JS (app + ClientRouter) and no React; React is confined to the maker route. Client behaviour (vote/favorite delegation, lazy fonts, size slider) is centralized in app.ts and re-initialized on each navigation.

## Evidence

Memory + git commit 57b28ef 'M6: vanilla cycling hero — no React on the content pages': 'pulling the whole 186KB React runtime onto the highest-traffic page for a tiny animation... The library, font page, and profiles now ship ~17KB of JS... and zero React; React loads only on /make for the maker.'
