# 0081 — A variation sheet with a different row layout is left out of the build, not fatal

Status: Accepted

## Context

A maker bug report on 2026-11-13 (mono, `naturalVariation: true`, `charsetLines: 1`, `detectedRows: 1`, sheet 1023x765) failed at the trace stage with `A variation sheet has 2 rows, but the mapping has 1. Use sheets with the same row layout.` The uploaded base sheet was a screenshot of another app: two white cells with bold "Fi" and "FL" on a #eee panel, with a thin grey rule and a light grey band of UI chrome below.

The first guess was that the grey band read as an ink row on the variation pass but not the base pass. That is not the cause:

- Base and variation sheets both go through `traceSheet` with the same charset and trace options; the `sessionRole` argument only decides where the session is stored. The same image cannot count differently on the two passes.
- A synthetic copy of the reported sheet binarizes to one band, `[85, 270]`, at both the standard (128) and dark-core (64) cutoffs. The #eee panel, the rule (~205) and the band (~242) stay white.

So the 2-row "variation sheet" was a different image sitting in a variation slot. `onFile` (a single-image drop) replaces the base sheet but leaves `variationImgsRef` alone, and only the sample button clears it, so a sheet loaded for an earlier font (a multi-file drop or the variation slot input) is still traced against the new base mapping. When the row counts differ and the geometry guess shares fewer than two rows with the mapping, `run()` threw, and the whole build failed over a sheet the user may have forgotten was loaded.

## Decision

Move the mismatch decision into `variationRowPlan(slot, detectedRows, baseLines, guessedLines)` in `src/lib/maker-checks.ts`:

- `match`: the variation sheet has the base row count; traced as before.
- `shared`: the geometry guess has the detected row count and shares at least two rows with the base mapping; traced against the guess and only the shared rows are used, as before (warning text unchanged).
- `skip`: anything else. `run()` leaves the sheet out of the font and adds `Variation sheet N has R rows but your sheet has B, so it was left out of this font. Remove it under natural variation, or use a variation sheet with the same rows.` to the build warning. The base font (and any matching variation sheets) still build.

Row counting itself is unchanged: `traceSheet`, `mergeSliverBands`, `mergeAccentBands` and `detectGeometry` are untouched, so plain sheets count exactly as before.

## Alternatives rejected

- Clearing the variation slots on every single-image base drop: it would also drop sheets a maker loaded on purpose before replacing a weak base sheet. It is a separate product decision.
- Treating the light band as a row-detection bug: the band never inks (see Context), so changing thresholds or sliver folding would change plain sheets for no gain.
- Keeping the error with clearer wording: the base sheet is fine, so failing the build punishes the maker for a sheet they cannot see in the error.

## Consequences

A stray or mismatched variation sheet no longer blocks a font; the maker gets the base font, a warning naming the sheet, and where to remove it. A build where every variation sheet is skipped has no `.cv01`/`.cv02` alternates, so `naturalVariation` is off in the built font, exactly as when no variation sheet is loaded.

## Evidence

- Bug report 2026-11-13 in the admin queue (fonthead.dev/admin), error string above.
- `test/variation-rows.test.ts`: the reported sheet reads one row; a 2-row variation sheet against a 1-line mapping returned the reported error before this change and a `skip` plan after it; matching and partially matching sheets keep their old plans.
