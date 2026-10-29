# 0076 — Compare decorative kerning clearance at shared heights

Status: Accepted

## Context

The Ornate Serif sheet leaves an excessive l–p gap in “Alpha.” The decorative
kerning safeguard uses the complete horizontal envelope of each glyph. It
therefore treats l's baseline curl and p's descending tail as if they occupied
the same height, limiting the pair adjustment to -57 units.

## Decision

Keep the existing optical fit, raster collision check and maximum adjustment.
Replace the decorative safeguard's full-height comparison with conservative
vector envelopes in small baseline-relative height bands. Subdivide lines and
Bezier curves and retain the control-point hull in every band it touches.
Combine envelopes across all natural-variation drawings sharing a character.
Retain the 20-unit clearance floor and the old full-envelope fallback if the
path is unsupported, invalid or exceeds the bounded subdivision budget.

This changes kerning only; traced outlines, advances and baseline positions
remain unchanged. Connected-cursive fitting and ordinary upright fitting are
unchanged. It applies to decorated fonts generally, without a special l–p rule.

## Consequences and evidence

The supplied sheet now fits l–p at -211 units. A synthetic regression fails on
the former guard and passes with height-aware comparison. Other unit cases
protect fractional baselines, thin curved strokes and the widest alternate.
The browser regression checks 92 mapped characters, l–p kerning and every
uppercase/lowercase pair in OTF, TTF and WOFF2 exports.

Validation: 365 unit tests; five browser regressions covering this sheet,
luxury serif, natural variation, preserved calligraphy and smooth joins.
All 2,704 alphabet pairs remain separated in each ornate export (minimum
measured clearance 55 units). All 92 source glyph outlines and advances match
the prior OTF build exactly. Typecheck and production build pass. The luxury
browser check was rerun successfully after a documentation-triggered dev reload.

Simply removing the envelope guard was rejected because rasterization can
miss very thin decorative strokes. The vector bands conservatively overestimate
ink and may still leave extra space where details occupy nearby heights.
