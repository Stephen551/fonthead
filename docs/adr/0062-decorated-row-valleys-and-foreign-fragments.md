# ADR 0062 — Decorated row valleys and foreign fragments

**Date:** 2026-10-25
**Status:** Accepted

## Context

The supplied three-sheet graffiti palette has seven rows, but the base sheet
was detected as four. Its number/symbol valley measures 0.218 of the smaller
flanking ink peak, just above the 0.2 gate. Leaving that pair fused caused the
height-consistency guard to reject every other recovered split.

After recovering the rows, detached decorations over-counted the first
punctuation row, advancing the punctuation bank into the wrong characters.
A neighboring exclamation-mark tip and a descender fragment also entered the
digit band; anchored slicing treated the first tip as zero and shifted digits.

## Decision

- Accept valleys up to 0.25 of the smaller flanking peak, retaining minimum
  height and even-spacing checks. Shallow in-letter valleys remain intact.
- Recognize the standard seven-row generator layout when the final punctuation
  row has 13 cells and the preceding row has 17–20. Map its known 17/13 symbols.
  Other layouts keep the editable count-based guess.
- Before an alphanumeric row falls back to forced slicing, discard isolated
  shallow runs only when ink continues across the row boundary. Reuse the
  existing narrow-gap merge and adopt the repair only if the exact expected
  count is recovered. Detached marks inside the row and full-height characters
  remain intact. Explicit slicer overrides remain available.

## Verification

The measured row-profile test failed on the original detector (4 instead of 7).
The punctuation test failed on the original mapping. The exported-zero shape
assertion failed with the foreign tip (aspect ratio 0.302, minimum 0.6).

All three supplied sheets detect seven rows. All 32 existing monochrome corpus
sheets retain identical row boundaries. Unit coverage includes shallow valleys,
foreign fragments, legitimate detached marks, and full-height edge ink. The
browser regression builds all three sheets through the UI without a saved
charset and validates 92 characters, both alternates, and OTF/TTF/WOFF2 exports.

No production schema changes or dependencies are required.
