# 0071 — Preserve and map accented Latin drawings

Status: Accepted

## Context

Accented drawings previously used positional mapping without canonical Unicode
normalization. Decomposed e + acute counted as two cells; non-ASCII glyph names
collapsed to underscores, colliding in variation and color-layer lookup maps.
Detached marks could become extra rows/cells or be removed as stray ink. The
baseline pass skipped accented characters entirely.

The user supplied a clean seven-row Extended Latin supplement with 119 unique
characters, including upper/lower accents, cedillas, ogoneks and side carons.
Its earlier annotated specimen also contains headings/rules, which are not
character drawings and still need removing before upload.

## Decision

Normalize charset rows to NFC and iterate Unicode code points in monochrome
slicing and re-slicing. Reject remaining separate combining marks with an
actionable message instead of silently shifting later cells. This supports
precomposed Latin characters, including canonically decomposable multi-accent
characters; it does not introduce general mark-to-base GPOS attachment or OCR.
Give non-ASCII glyphs deterministic uniXXXX/uXXXXX names, shared by monochrome,
color and variation builds. Existing ASCII glyph names stay unchanged.

Use canonical Latin decompositions as mark metadata. Reconcile excess row
bands with the declared charset through a bounded ordered partition; only
short, nearby bands on an expected accent side may merge. Retain the original
bands if a complete fit is unavailable. Group tiny horizontal runs such as
side carons using the largest inter-letter gaps in accent rows. User-forced
component/ownership/anchored slicers retain their existing semantics.

Protect legitimate detached accents during monochrome and color cleanup,
including side-carons on d/t/l. Keep tracing's small-component cutoff from
erasing dots, while still rejecting remote minor fragments. Preserve the
original contours; do not synthesize accents or substitute another drawing.

Measure exact bounds of the main body, excluding detached mark contours.
Above-only accents sit on the body's foot. Below-base marks and genuine
descenders use the corresponding base drawing or the family's body height.
Accent-only supplements can supply their own reference heights. Variations
remain grouped by source sheet. Color assembly reapplies accent alignment after
edits and rounds absolute Y coordinates to prevent CFF relative-delta drift.
Accent supplements lacking the ordinary x-height reference use complete-outline
spacing instead of speculative script overhangs.

## Alternatives rejected

- Identify letters from the artwork: this engine has no OCR, and ambiguous
  accent drawings cannot reliably supply their own Unicode identity.
- Preserve every speck: real-sheet testing found remote fragments that tripled
  an accented letter's advance width.
- Align to the lowest ink: cedillas/ogoneks would raise the entire letter.
- Strip accents for mapping: loses the intended character and variation group.

## Consequences

Users must provide a charset matching the clean sheet's exact row order. NFC
input covers ordinary precomposed Latin accents; standalone marks and arbitrary
uncomposable sequences remain unsupported and are reported explicitly. Closely
touching letters or accents outside the bounded association region may still
need re-slicing. Existing exports must be rebuilt to receive these corrections.
No new dependency or database migration is required.

## Evidence

The new normalization and baseline unit regressions both failed before the fix.
The actual supplied sheet is tested in OTF, TTF and WOFF2 for 119 unique mappings,
unique glyph names, accent contour counts, baseline positions and re-slicing.
Chromium renders NFC and NFD text identically with the generated webfont.
Separate browser checks cover flat/gradient color accents through edits and
ensure natural variation never substitutes an alternate of a different letter.
