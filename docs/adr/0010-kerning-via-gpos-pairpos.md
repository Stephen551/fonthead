# ADR 0010 — Real kerning emits a GPOS PairPos table, not the legacy kern table

**Status:** Accepted · backfilled 2026-06-29 from project history (review and correct if the reconstruction is wrong)
**Date:** 2026-06-08 to 2026-06-10 (e00de1c / 8f83691 / c62fe09)

## Context

The engine's kern analyzer worked, but compileFeatures could only emit a legacy TrueType kern table, which Chrome and Firefox ignore (they kern from GPOS only) and Safari over-applies. This was the exact acmeridian.co brand-font bug, where the same font rendered differently per browser. Mono builds were left un-kerned until a GPOS writer existed.

## Decision

Treat real kerning as a genuine GPOS-emit engine build: write auto-kerning as a GPOS PairPos table via a new font-engine-gpos.js writer fed by a silhouette analyzer (DFLT/latn, one type-2 lookup, PairPos format 1, XAdvance-only), carried through OTF and TTF. The writer is overhang-aware so script faces whose swash overlap is built into their advances yield no pairs. The legacy kern table is left opt-in behind featureOpts.legacyKernTable and OFF by default; buildFont passes features:null by default.

## Alternatives rejected

Emitting the legacy TrueType kern table as the default was rejected for cross-browser breakage (Safari honors it, Chrome and Firefox ignore it). It is kept opt-in, off by default.

## Consequences

Mono builds carry a real GPOS PairPos table validated via OTS/FontFace and fontTools (checkChecksums=2); the silhouette rasterizer pads its canvas so body-advance swash overhangs are measured honestly. This also corrected the earlier optimistic 'deep features are just wiring' note: ligatures and variable fonts were re-scoped as needing new input/UX.

## Evidence

Memory + CLAUDE.md + git commits e00de1c 'Document why mono builds stay un-kerned for now', 8f83691 'Add a GPOS PairPos writer to the engine', c62fe09. Memory: 'real kerning = a genuine GPOS-emit engine build, not wiring.'
