# ADR 0002 — Astro 5 SSR on Cloudflare Workers as the application platform

**Status:** Accepted · backfilled 2026-06-29 from project history (review and correct if the reconstruction is wrong)
**Date:** 2026-06-02 to 2026-06-03 (cae199b)

## Context

fonthead.dev is a community font library and maker that needs server-rendered pages (the wall, font pages, profiles, maker page) plus client-side islands for the interactive maker, on a platform with relational, object, and key-value storage. This was the foundational scaffold choice for the whole product.

## Decision

Build fonthead.dev as Astro 5 SSR (output: 'server') on the @astrojs/cloudflare 12 adapter, running on Cloudflare Workers, with React 19 islands and Tailwind v4 via the Vite plugin, TypeScript strict. Storage is Cloudflare-native: D1 (binding DB, database fonthead), R2 (binding FONTS, bucket fonthead-fonts), and KV (binding SESSION). Design tokens are ported into global.css and fonts (JetBrains Mono, Geist) are self-hosted as static assets with no CDN.

## Alternatives rejected

Adapter 13 was rejected because it requires Astro 6; the project stays on Astro 5 / adapter 12. No competing framework or platform is recorded in the source.

## Consequences

The adapter version is coupled to the Astro major version, so upgrading to adapter 13 would force an Astro 6 migration. The whole stack is bound to the Cloudflare Workers runtime and its bindings, which constrains later choices (e.g. email cannot use SMTP). Content pages deliberately ship minimal JS.

## Evidence

Memory + CLAUDE.md: 'Astro 5 SSR on @astrojs/cloudflare 12 (output: server). React 19 islands. Tailwind v4 via the Vite plugin.' Git commit cae199b 'Scaffold Astro 5 SSR on Cloudflare (D1, R2, KV, Tailwind v4, React)'. Adapter coupling from memory: 'adapter 13 needs Astro 6'.
