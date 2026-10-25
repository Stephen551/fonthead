# ADR 0061 — Opt-in smooth joins from measured terminal strokes

**Date:** 2026-10-25
**Status:** Accepted

The elegant-script alphabet field case touches under the existing connection
model but leaves angled overlaps and thick seams. The parked high-exit repair
does not address all of those joins. A shared height alone is insufficient:
position, tangent, width, and spacing have to agree at the junction.

The maker now offers **smooth joins** underneath **connected cursive**. This is
an opt-in path for thin, fairly even-pen scripts with identifiable open entry and
exit tails. The existing default connection and experimental seam paths remain
unchanged. Natural variation and smooth joins use different contextual forms
and cannot be combined.

The new pass reuses SingleLineCore's thinning and distance transform to measure
terminal strokes. It stops tracing at a real branch, derives the shared join
height, direction, and width from the sheet, and reconstructs only the terminal
regions. Supersampled raster union followed by Potrace merges the replacement
with the letter outline. Fixed advances bring the reconstructed endpoints
together; overlap kerning is disabled for this path because it would move those
endpoints apart again.

The existing GSUB writer emits exit, entry, and combined contextual forms.
Isolated letters retain their drawn paths; initial entries and final exits
remain original. Capitals can supply an exit only when an identifiable tail
reaches the right edge; otherwise their full ink width receives side bearings
to prevent swash collisions. Unsupported lowercases or uneven stroke widths
produce an actionable error, rather than silently claiming a repair.

The exported font requires OpenType contextual alternates (`calt`) for the
repaired joins. It is not a general solution for brush scripts, every capital,
or applications that disable contextual shaping. No new dependencies were added.

Verification covers skeleton staircase/junction behavior, the supplied image,
OTF/TTF checksums, character coverage and contextual substitutions in all three
export formats, all 676 lowercase pair junctions in the exported outlines, and
the maker control at 375/768/1280px. The contextual-shaping assertion fails on
the original font (`anna` remains four base glyphs). Existing connect and parked
seam regressions are retained. The global sign-in navigation's existing 768px
overflow is outside this change; the maker itself fits the viewport.

The supplied sheet is retained as `e2e/fixtures/elegant-script.png` for regression coverage.

Release validation on top of production commit `159e2d4`: 307 unit tests
passed across 33 files; the browser regression passed all three exports and
676 lowercase pairs; the production build passed. Astro check reported
zero errors and warnings with generated local runtime bindings.
