# ADR 0056 — Anchor R by its stem when its leg descends

**Status:** Accepted
**Date:** 2026-09-13

The Integrity export exposed an incorrect assumption in ADR 0055's alphabet
check: the bottom of R's right leg does not always belong on the baseline.
Its left stem sat 90 font units above zero while the descending leg sat at
zero. Snapping the lowest ink had raised the whole letter.

For R, measure exact curve bounds of complete segments inside the left 45%
of the outline. This isolates the stem from the right leg without changing
the drawing or using a raster-derived placement. Accept that stem anchor only
when its height is consistent with the other capitals and the right leg has
a distinct, bounded descent. Ordinary R forms and unreliable measurements
retain the existing fallback. Variant sheets retain their independent scales.

The alphabet regression now measures R's stem against the baseline and its
leg below it, instead of incorrectly requiring the lowest ink to be zero.
It still checks all 52 letters and 2,704 shaped pairs. In the corrected export
the stem is at zero and the leg at -90 font units. A new unit regression fails
the previous implementation (235 received versus 215 expected) and passes the
stem-aware correction. Ordinary R and invalid stem measurements are covered.

Verification: 284 unit tests passed; the alphabet export and chancery overhang
browser tests both passed. A before/after specimen was inspected against a
baseline guide. No new dependencies, outline resizing, or spacing rules.
