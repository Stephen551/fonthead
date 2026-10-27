# 0069 — Preserve crossing descenders and complete serif spacing

Status: Accepted

## Context

The supplied 2006x784 luxury serif sheet has overlapping vertical extents for
its lowercase and numeral rows. A valley cut at approximately y=529 truncates
the lowercase y, whose connected terminal reaches y=539. Cleanup then removes
the separated hook. Raster-only spacing also misses hairline serif extrema;
CFF serialization adds horizontal drift by rounding relative curve deltas.

## Decision

Before extracting each monochrome cell, follow binary ink connected to its
middle half across a row boundary. Search no farther than 40% of the original
row height and stay inside the cell's horizontal bounds. Respect existing
component ownership. In any added vertical region, admit only that connected
ink and a one-pixel fringe for source supersampling. Preserve the original
absolute baseline. The shared row path covers initial tracing and re-slicing.
Rows with no ink crossing either boundary take a cheap unchanged path.

For the existing upright-stem classification, fit side bearings using exact
Bezier bounds rather than raster column bounds. Quantize absolute horizontal
coordinates before CFF serialization for these fitted upright builds, just as
baseline-aligned builds already quantize absolute Y. This prevents accumulated
rounding from shifting the saved contour. Keep existing full-alphabet kerning,
which now measures the corrected outlines. Worker and page cache tokens derive
from engine file contents automatically.

Use 5% side bearings for the delivered Elegant Display specimen. Keep the
maker's global default and connected-cursive behavior unchanged.

## Alternatives rejected

- Moving the entire row cut: captures portions of adjacent-row glyphs.
- Adding unmasked padding: admits unrelated ink where rows overlap vertically.
- Stretching the cropped y: cannot restore the missing hook and terminal.
- Compensating with tracking alone: leaves lost hairlines and export drift.

## Consequences

Recovery is bounded; it cannot reconstruct artwork already cut off in the source
image, or separate physically touching letters from different rows. Horizontal
fitting changes only faces already recognized as upright. Quantization is at
one font unit (1/1000 em by default); source tracing remains unmodified.
No database migration or new dependency is needed. Existing exports must be
rebuilt to receive the correction.

## Evidence

- Actual source y: 107px tall versus approximately 71px x-height. Export ratio
  improves from 1.367 to 1.510, with the complete terminal visually inspected.
- OTF, TTF and WOFF2 independently parsed with fontkit and loaded by Chromium;
  fitted alphabet/digit bearing asymmetry is under 1.24 font units.
- New real-sheet browser regression validates all formats, SFNT checksums,
  glyph coverage, descender height, spacing, kerning and 2,704 letter pairs.
- Unit regressions cover adjacent-row rejection, component ownership,
  ascenders, shallow foreign fragments, diagonal links and CFF horizontal drift.

Validation: 325 unit tests and 12 targeted browser regressions pass. Astro check
reports 187 files with no errors or warnings.
