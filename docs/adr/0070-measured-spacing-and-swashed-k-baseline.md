# 0070 — Measured automatic spacing and swashed lowercase baselines

Status: Accepted

## Context

The luxury serif required a manual 5% spacing override. Auto previously kept
source grid pitch, which is unrelated to the intended whitespace in a font.
Its lowercase k also floated because the descending swash was used as its
baseline: the stem ended 126 font units above zero in the exported WOFF2.

## Decision

Resolve auto spacing after baseline alignment. Measure the inner white gaps
of base H/O/n/o/u in the middle of their bodies. One side bearing receives
16% of the median counter width. With fewer than three valid counters, use
6.5% of median glyph width; with fewer than three usable reference glyphs,
fall back to 3.5% em. Clamp measured margins to 2.5–7% em. Variants do not
get extra votes. Manual 1–12% overrides and connected-cursive placement remain.

Fit complete curve bounds for upright and alternate alphabets, including
absolute X quantization during export. Auto accepts two independent straight
stems as evidence to preserve decorative edges; the existing three-stem
classification keeps optical kerning. Weaker decorative classifications and
alternate palettes cap kerning against the complete outline envelope of every
variant, with a 20-unit gap floor, to protect thin details missed by raster rows.
Color builds measure their traced union outlines and recompute after edits.

Extend the existing R stem-foot baseline anchor to lowercase k, using the
family's ascender height and bounded swash depth as checks. Change baseline
metadata only; retain the complete swash and source outline.

This supersedes ADR 0069's manual 5% delivery setting and unchanged global
default; its descender recovery and exact-curve spacing decisions still apply.

## Alternatives rejected

- Universal 5%: unsuitable for condensed versus open letterforms.
- Source cell pitch: reflects sheet layout rather than font design.
- Cropping the k swash: removes intentional artwork.
- Treating all decorative edges as script overhangs: caused a real WO collision.

## Consequences

Auto is a bounded heuristic, not a substitute for every artistic spacing
decision. Sparse alphabets use a fallback; users can still override margins.
Existing exported files need rebuilding. No schema change or dependency is
required. The luxury sheet now selects 5.3% automatically; the condensed and
light fixtures select 2.9% and 6.6% respectively.

## Evidence

Unit coverage checks measurement scale/order invariance, outliers, sparse and
invalid input, stem classification, shared-variant kerning bounds and k anchors.
Real exported font regressions check all three formats, complete y descent,
k stem alignment within two font units, and 2,704 pair clearances for both the
luxury and doodle alphabets. Browser checks also cover automatic/manual reset,
color edits, natural variation, re-slicing, and smooth connected joins.

The old k assertion failed at 126 units; the corrected stem reaches zero with
its swash below the baseline. Before/after specimens were visually inspected.
