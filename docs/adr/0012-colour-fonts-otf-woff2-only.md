# ADR 0012 — Colour fonts build main-thread and output OTF + WOFF2 only (no TTF yet)

**Status:** Accepted · backfilled 2026-06-29 from project history (review and correct if the reconstruction is wrong)
**Date:** 2026-06-03 (colour pipeline)

## Context

M7 wired the colour maker. The colour pipeline (color-orchestrator.js, gradient COLRv1 / flat COLRv0+CPAL) and the wawoff2 compression run on the main thread, while monochrome builds run in a Web Worker. TTF colour output requires COLR on glyf, which is not yet implemented.

## Decision

Build monochrome fonts in a Web Worker (otf/ttf/woff2) and build colour fonts on the main thread with main-thread wawoff2. Colour fonts output OTF + WOFF2 only, with no TTF, deferring COLR-on-glyf to a planned follow-up.

## Alternatives rejected

Shipping colour TTF now was deferred (COLR on glyf is a planned follow-up).

## Consequences

Two distinct build kinds with different threading models; colour faces have no TTF output until the COLR-on-glyf follow-up lands. A known perf cost is that wawoff2 + opentype load on both the main thread and the worker.

## Evidence

Memory + CLAUDE.md: 'Maker build kinds: monochrome (Web Worker, otf/ttf/woff2) + colour gradient/flat (main thread, otf/woff2).' and 'Colour fonts output OTF + WOFF2 only, no TTF yet (COLR on glyf is a planned follow-up).'
