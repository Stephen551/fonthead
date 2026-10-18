# ADR 0059 — Fold sliver row bands before comparing row reads

**Status:** Accepted
**Date:** 2026-10-18

A ballpoint scan of the printed grid (2157x1501, six drawn rows) failed to
trace. The maker reported 21 rows, a single cell in row 1, and a 7px median
row. It labeled ten rows as punctuation and built a garbled font.

The pen ink in that scan sits mostly at luminance 60 to 130. The standard
128 cutoff reads it cleanly as six rows plus one 2px band, the tip of the
apostrophe one scanline above its row. The shadow-robust row pass at 64 keeps
only the darkest pixels of each stroke. Whole scanlines go empty, and each
drawn row splits into thin fragments separated by seams of 1 to 3px. Both
traceSheet and detectGeometry take whichever read finds more rows, so the
fragmented read won.

Both reads, and the re-read after the stroke-weight floor, now pass through
`mergeSliverBands` before any comparison. A band shorter than 25% of the
sheet's typical row height is folded into its nearer neighbour when the gap
to that neighbour is at most 5% of the typical row height, with a 2px floor.
The typical row height is the median of the bands at least 10% as tall as
the tallest. Tall bands are never merged, however small the gap between
them, and an isolated short band is left alone. A shadow-bridged generator
sheet therefore keeps its dark-core read.

The 10% cut is deliberately low. A tightly leaded generator sheet reads rows
1 to 4 as one fused band, which the valley split separates later. On nano-v3
that band is 708px and the real rows below it are 128 to 140px. The first
version used a 35% cut, so the fused band became the typical row, and the
real rows read as slivers and merged. That changed the bands on all three
nano sheets. On nano-v3 the connect join-gap median rose from 49 to 68,
past the corpus gate of 60. With the 10% cut, the only reads changed across
all 35 corpus and fixture sheets are the field scan's two reads.

Rejected: dropping the 64 pass for light ink. Gating on the share of ink
that survives at 64 has no corpus calibration. Lowering
SHADOW_ROW_THRESHOLD would reintroduce generator shadow bridging.

Verification: the field scan now reads 6 rows with 13/13/13/13/10/11 cells.
It builds 73 glyphs and renders a pangram in the hand. The unit regression
uses the scan's measured band lists (21 dark-core bands fold to the six drawn
rows, and the 7-band standard read folds to six). Tall rows two pixels apart
stay separate, and an isolated short row is kept. The nano-v3 band lists pass
through unchanged; that test fails under the 35% cut. 296 unit tests passed.
Every sheet-upload browser test passed locally (maker, template, charset,
baseline, connect, spacing, variation, stress). The scan itself is not
committed because it is a user's handwriting.

The template's punctuation row is still guessed as `!?@#$%^&*()`. Reading
that row in the template's known order is a separate change.
