# ADR 0054 — Auto-level separate letters before font assembly

**Status:** Accepted
**Date:** 2026-09-13

## Problem

`rowToGlyphs` assigns every glyph in a row the same estimated baseline. An
uneven generated sheet therefore produces uneven text. In the supplied serif
WOFF2, the bottom of `8` sits about 80 font units below `0`, and the second
lowercase row drifts downward. The existing `connectGlyphs` correction only
applies to connected cursive.

## Decision

Run `alignGlyphBaselines` at the start of ordinary monochrome `buildFont`
calls, before trimming, spacing, kerning, and file assembly. Re-slices and
variation builds use the same entry point. `autoBaseline: false` preserves
the source placement for programmatic callers. Connected cursive keeps its
existing placement pass; color builds and punctuation are unchanged.

Connected cursive is now explicitly opt-in in the maker. It starts off and
uploads/rebuilds preserve the user's setting. The old script classifier also
classified the supplied serif sheet as script, automatically enabling cursive
and bypassing separate-letter alignment. The UI no longer calls that classifier.

Measure actual curve extrema with the existing engine's SVG-to-OpenType path
converter and `Path.getBoundingBox`, rather than control-point bounds. A raster
body-top measurement excludes narrow ears such as the one above a `g` bowl.
The pure alignment helper then:

- Estimates cap, lowercase, and ascender heights from median outline heights,
  independent of the original row baseline.
- Anchors ordinary letters and digits exactly at their bottom ink. Optical
  overshoot is accounted for only when estimating a descender's body line.
- Aligns `p/q/y` by lowercase tops, and `g` by its body top when the ear
  exclusion is small enough to be reliable. `j` uses the corresponding `i`
  dot height. `J/Q/R` and unusually tall capital swashes use cap tops so
  their tails survive. Upright `f` sits on the baseline; substantially taller
  `f` forms retain their descenders.
- Handles each variation sheet in its own source pixel scale.
- Skips unsupported characters, missing references, invalid measurements,
  floating-point noise, and corrections larger than half the reference height.

Only `baselineYInCell` changes. Outlines, counters, dots, and cell dimensions
remain intact. This is vertical placement, not a rescaling pass; letters drawn
at different sizes will still have different sizes. Diagnostics are available
on `__lastBaseline.adjustments`, with signed shifts in source pixels.

## Verification

`test/baseline.test.ts` covers both directions of drift, preserved outlines,
rounded bottoms, fractional-pixel drift, descenders and dots, missing references, invalid bounds,
outliers, repeated alignment, and independent variation sheets.

`e2e/baseline.spec.ts` uploads the actual field image, downloads the assembled
OTF, checks SFNT checksums, measures letter/digit baselines, and checks that
descenders remain below the line. It checks the same bounds in the WOFF2
with fontkit, an independent parser, and confirms cursive stays off after
upload. The new regression fails against the
original `maker.ts` (the `f` bottom is about 70 units below the baseline); the
original monochrome sample smoke test still passes on that version.

Connected-cursive browser tests verify that even a cursive sheet stays off
until explicitly enabled and that turning it off restores the overhang path.
Variation and seam tests now explicitly enable cursive when testing joins.

No new dependencies.

## Follow-up: visible steps in “Handmade”

The initial 2%-of-x-height dead zone left `d` at +6 font units while `H`
sat at -8, and the round-letter overshoot left `a/e` below zero. These
differences remain visible at the maker's 60px preview size. The correction
now removes fractional-pixel source drift and puts non-descending bottom
ink directly on the line. It does not resize letters. The export regression
requires every letter in “Handmade” to land within one font unit of zero;
it fails the initial implementation at `H` (8 units from the baseline).

The CFF writer also rounds relative curve deltas independently, accumulating
small vertical errors even after accurate source alignment. Aligned builds
now quantize absolute Y coordinates to font units before serialization. This
keeps delta rounding from moving the outline. The worker forwards this option
to the builder only for non-connected builds with auto-baselines enabled;
other modes retain their existing precision. A synthetic fractional-curve
regression verifies both the old drift and the corrected serialized baseline.
