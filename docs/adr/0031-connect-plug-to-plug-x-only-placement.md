# ADR 0031 — Connect via plug-to-plug x-only placement with a single shared anchor/advance origin

**Status:** Accepted · backfilled 2026-06-29 from project history (review and correct if the reconstruction is wrong)
**Date:** 2026-06-28 (spec)

## Context

A connected model was needed that joins letters without distorting them, implemented entirely with the levers the worker already exposes (no engine rewrite). The worker's useCellWidth branch sets shiftX=0, so anchoring on ink while measuring the advance plug-to-plug would diverge by leftPlug - inkLeft for round letters whose bowl bulges left of the entry hairline, back-colliding them.

## Decision

Implement connection as an x-only re-implementation of OpenType cursive attachment ('curs') at a fixed connection height: per glyph, find connection points (plugs) in a connector band just above the baseline (left plug = leftmost band ink, right plug = rightmost band ink), and set each glyph's advance so the next glyph's left plug lands on this glyph's right plug. No edits to the letterforms (translate-x and advance only). Anchor and advance MUST share one origin: anchorOrigin = min(leftPlug, inkLeft); dx = -anchorOrigin (never lets ink go negative); cellW = rightPlug - anchorOrigin - overlapPx. Do not implement two anchor paths and no per-glyph offset carry or look-behind. Compute overlapPx directly (round((connectOverlapPct ?? OVERLAP_PCT) * xhPx)) rather than routing it through bodyPadPx, whose Math.max(1, ...) would make 0 overlap unreachable.

## Alternatives rejected

Synthesized bridge strokes and canonical-line normalization were rejected (both do path surgery on every glyph and risk distorting letters whose natural connector is high; noted as a possible sheet-agnostic v2). Two separate anchor paths (anchoring on ink while measuring advance plug-to-plug) were rejected (diverges and back-collides round letters). Routing overlap through bodyPadPx was rejected (Math.max(1,...) makes 0 unreachable).

## Consequences

v1 has no vertical lever, so within-tolerance plug-y steps remain (a y-aware join is explicitly v2); the corpus contact sheet is the eyeball gate. The single-frame anchor landing round-letter joins is named as one of the two things that most determine whether the result looks made.

## Evidence

Specs: docs/superpowers/specs/2026-06-28-connected-cursive-design.md 'Approach (chosen: Approach 1)' and '§0. The geometry contract — ONE frame': 'Anchor and advance MUST share an origin... Do NOT implement two anchor paths.' and '§2: overlapPx = round(...) — 0 stays 0. bodyPadPx ends Math.max(1, ...)... compute directly.'
