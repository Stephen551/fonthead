# ADR 0009 — Self-classifying sheet trim rules with a self-verifying trim loop

**Status:** Accepted · backfilled 2026-06-29 from project history (review and correct if the reconstruction is wrong)
**Date:** 2026-06-09 to 2026-06-10 (eb9f4a4 / bc7b4b0)

## Context

Conservative trim gates sized for upright safety choked on script letters (gaps after l, before g), but loosening the gates globally over-tucked upright crossbars (an upright T). No per-glyph rule can know where an overhang lands on a neighbour, and casual faces carry deep tails on most glyphs. The corpus lint found welded t-bars and doubled n-strokes from aggressive trimming.

## Decision

Let each sheet classify itself (upright vs script) and pick its own trim rules: a conservative pass runs first, and when at least 40% of glyphs carry a deep tail the face is treated as script and re-measured under looser script rules. Flourish overhang defaults on (the advanced toggle is the off switch). Close the trim loop with a pairwise feedback pass that measures misread-risk pairs on the trimmed result and backs trims off exactly where a pair would fuse.

## Alternatives rejected

Loosening the gates globally was rejected (it over-tucks upright crossbars). Per-glyph classification alone was rejected (casual faces carry deep tails on most glyphs; overhang landing is neighbour-dependent).

## Consequences

Uprights never reach script rules; script faces fit harder; trim is restored only where a pair would interpenetrate. Some letter-specific knowledge stays hard-coded (NO_TRIM_RIGHT for r/C/G) because the column profile cannot supply it. Backed by the typographic corpus lint.

## Evidence

Memory + CLAUDE.md + git commits eb9f4a4 'Let the sheet pick its trim rules: script faces fit harder' and bc7b4b0 'Close the trim loop: verify pairs after trimming and back off where they fuse'.
