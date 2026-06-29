# ADR 0032 — connectGlyphs is a sibling of trim, mutually exclusive with it; connect-mode disables italic/spacing/kern/optical-sidebearings

**Status:** Accepted · backfilled 2026-06-29 from project history (review and correct if the reconstruction is wrong)
**Date:** 2026-06-28 (spec)

## Context

The maker already had a flourish-overhang/trim path. The connected model must coexist without inheriting trim's per-glyph tail surgery or script classification, and the plug-to-plug geometry depends on the worker's useCellWidth path with shiftX=0, which any slant, optical re-centering, or re-measured advance would break.

## Decision

Implement connectGlyphs as a sibling of trimGlyphOverhangs (never a wrapper). In buildFont, connect and trim are mutually exclusive with connect first (else if). Connect must not do what trim does (no two-sided padding for joining glyphs beyond break-class, no script self-classification/SCRIPT_TRIM, no NO_TRIM_RIGHT or tail trimming, and it reuses rather than re-runs the fusion check). In connect mode: force flags.useCellWidth=true and flags.tightAdvance=false; hard-force style 'Regular' and italic off (the worker slants from the style name; a slant adds italicSlantSpan to advance and shiftX, voiding shiftX=0); set features.kerning=false (changing the previously hardcoded {kerning:true}) and keep opticalSidebearings:false (optimizeSidebearings re-centers glyphs and would void the join). Thread connect/connectOverlapPct through editMonoRow so a per-row re-slice does not silently rebuild in trim spacing.

## Alternatives rejected

Making connect a wrapper around trim, and reusing trim's two-sided padding/script-classification/tail-trimming, were rejected. Allowing italic, spacing, kerning, or optical sidebearings in connect mode was rejected (each breaks the shiftX=0 plug geometry).

## Consequences

Connected fonts always build non-italic, ship without a GPOS kerning table, and bypass optical sidebearing optimization; the spacing and italic controls are inert when connect is on. The mode forces the cellW advance verbatim. Flourish overhang stays the path for everything else.

## Evidence

Specs: docs/superpowers/specs/2026-06-28-connected-cursive-design.md §3 and §5: 'connectGlyphs is a sibling of trimGlyphOverhangs, never a wrapper' and 'features: { kerning: opts.connect ? false : true }... opticalSidebearings: false (must stay false — optimizeSidebearings re-centers glyphs and would void the join).' and 'styleOut = Regular; // hard-force non-italic.'
