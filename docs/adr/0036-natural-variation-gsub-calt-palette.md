# ADR 0036 — Natural variation: a 3-sheet same-hand palette cycled by GSUB calt

**Status:** Accepted
**Date:** 2026-06-29

## Context

A single traced sheet gives one outline per glyph, so a repeated letter ("aaaa", "mm" in "minimum") stamps identically and the font reads mechanical, not handmade. Real handwriting varies each pass. We want a font where a repeated letter cycles through genuinely different forms, without inventing variation the input does not contain (ADR 0033's no-synthesis rule).

## Decision

Take THREE sheets of the SAME hand (the script generate preset asks for three versions). `mergeVariantSheets` aligns them by character into one glyph list: the first sheet's letters are the bases (no suffix), the others become `.cv01`/`.cv02` variant glyphs. A hand-written GSUB table (`font-engine-gsub.js`: `collectVariantGroups` + `buildGsubCalt`, a Lookup Type 6 chained-context rule driving a Type 1 single-subst) cycles a repeated letter through its variants under the `calt` feature, in ROTATION (a a1 a2 a1 a2…) keyed on the predecessor's variant, not a settle-to-last floor. Variation is OUTLINE-ONLY and metrically TRANSPARENT: a variant INHERITS its base letter's advance and shift, so a calt swap never jolts spacing; only the drawn shape differs. In connect mode the variant's body is REGISTERED onto its base's body (`scaleTranslatePathX`, clamped) so a variant traced a touch narrow still fills the base metric box and joins; the connect gap is tightened for variation builds (0.05·xh vs 0.16) because a varied hand is often lighter and its thin connectors must let the dense bodies carry the join. The user loads all three at once on the main input (one action, `onFiles`), or via the variation slots.

## Alternatives rejected

A single-sheet randomizer that perturbs one outline (would synthesize variation the hand never made, violating ADR 0033, and the corpus showed it reads as noise). A settle-to-last calt floor (a long run of the same letter degraded to one form; rotation keeps every adjacent pair distinct). Per-variant advances (each variant computing its own advance jolted the spacing mid-word and dropped letters; metric transparency from the base is the fix).

## Consequences

The font carries extra glyphs (.cvNN, no cmap) wired only through GSUB/GPOS; `expandVariantKern` fans the kern pairs out to the variant GIDs since they have no codepoint. The amplitude is input-bound: subtle source sheets cycle subtly. Validated with fontkit shaping (a repeated run yields distinct glyph ids) and fontTools (GSUB/GPOS structure), e2e'd on a copperplate and a light hand, gated by the corpus.

## Evidence

Commits 07d524a (metric-transparent variants), fb39ed6 (rotation), 1630d20 (body registration), 993cf32 (variation-build gap), d2feb51 (one-shot multi-sheet load). `src/lib/maker.ts` mergeVariantSheets/connectGlyphs; `public/assets/vendor/font-engine-gsub.js`. Build memory: the natural-variation entries.
