# ADR 0004 — Vendor the client-side font engine; engine edits stay surgical and additive

**Status:** Accepted · backfilled 2026-06-29 from project history (review and correct if the reconstruction is wrong)
**Date:** 2026-06-02 to 2026-06-03 (1e02fe6)

## Context

M2 needed an in-browser maker that traces an alphabet sheet into an installable font; Stephen already had a working vanilla-JS tool (tracer/color-builder) lifted from his A&C admin tools. A shared package was named as the eventual next step, but vendoring was chosen first to prove the maker.

## Decision

Vendor Stephen's existing vanilla font engine into public/assets and serve it verbatim (Potrace tracer, opentype.js OTF, custom CFF->TTF, COLR/CPAL colour pipeline, single-line/hinting/variable paths, a classic Web Worker, and the wawoff2 WASM compressor), building fonts entirely in the browser so nothing leaves the browser during a build. All engine changes must stay surgical and additive (new opt-in code paths, e.g. a new analyzer alongside the old one), never rewrites of the slicing or layout logic.

## Alternatives rejected

Building a new engine from scratch was rejected in favor of vendoring. Rewriting the existing slicing/layout logic is rejected on an ongoing basis; new behavior is added as additive opt-in paths instead.

## Consequences

All tracing and font generation runs client-side. The engine is served immutable for a year, which later created a cache-busting trap. The CSP must permit the engine's runtime needs (eval, data:, blob:). The vendored slicing/layout is treated as load-bearing and proven; new features (auto-kern analyzer, connect-mode kerning) are added as siblings rather than rewrites.

## Evidence

Memory + CLAUDE.md + git commit 1e02fe6 'Vendor the A&C font engine (client-side, served from /assets)': 'Served verbatim at /assets so the worker importScripts paths resolve unchanged. Vendored now to prove the maker; lifts into a shared package next.' CLAUDE.md: 'Engine edits stay surgical and additive (new opt-in paths), never rewrites of the slicing or layout logic.'
