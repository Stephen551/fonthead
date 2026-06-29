# ADR 0023 — Per-font social cards rendered client-side via canvas at publish (no Satori/resvg/sharp)

**Status:** Accepted · backfilled 2026-06-29 from project history (review and correct if the reconstruction is wrong)
**Date:** 2026-06-06

## Context

The pre-launch share feature needed per-font 1200x630 OG/social cards, and the maker already has the built font in the browser. No server-side image library was installed.

## Decision

Render the OG/social card client-side from the built FontFace using a <canvas> and c.toBlob at publish time (Maker.tsx renderOgCard), uploading it as part of the publish FormData and storing it in R2 via the existing R2-then-D1 rollback. Do not use a server-side image library.

## Alternatives rejected

Satori/resvg/sharp were rejected ('none installed; canvas-at-publish is the whole trick').

## Consequences

Card generation lives in the maker; existing/older fonts fall back to /og.png and can be backfilled via a browser canvas technique. Colour fonts were initially expected to render as a mono silhouette (later found Chromium canvas does render COLR).

## Evidence

Memory + git commit c649bcc + memory: 'No Satori/resvg/sharp (none installed; canvas-at-publish is the whole trick)... client-side <canvas> -> c.toBlob -> publish FormData ogImage.'
