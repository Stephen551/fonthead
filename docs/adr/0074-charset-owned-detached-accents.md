# 0074 — Assign detached accents across row boundaries

Status: Accepted

## Context

The supplied 122-character Elegant Serif Glyph Specimen has tight vertical
spacing. Row one's ogonek reaches row two's accent band, so whitespace detection
puts row two's marks in row one and cuts row two at the letter bodies. The row
count and Unicode mappings are correct, but most second-row accents disappear.
Some dots remain attached to the wrong preceding-row glyph. The side caron on
ť also slightly overlaps its crossbar's horizontal bounds, defeating the old
strictly-right-of-body filter even though the actual ink is disconnected.

## Decision

For monochrome sheets with accented charset entries and matching row/cell
counts, label connected components once per trace. Identify the main letter
bodies from the declared cells, then assign small detached marks according to
the character's canonical accent role and its body's position. Each component
has at most one owner. Extend that cell's crop to include its mark, masking it
out of any other row that happened to contain it. Preserve an antialias fringe
for fine-detail tracing. Connected row-extent recovery continues to handle
swashes and attached descenders.

Never reassign a letter's main body or a disconnected serif inside its body
height. A connected cedilla/ogonek already descending below the row baseline
cannot claim the next row's dots. Side carons may overlap the rightmost body
bounds; they must still lie beside the upper ascender. Use the same semantic
geometry check when filtering traced subpaths.

Recompute ownership when a row is re-sliced, using the current slicers. No
permanent state or font-writer change is needed. Unknown/mismatched layouts keep
the previous behavior rather than guessing component owners. This is charset
guided geometry, not OCR or generation of missing drawings. Color tracing is
unchanged.

The Extended Latin prompt now requests a full letter height of blank space
between rows. This helps generation but is not a requirement for recovery.

## Evidence

The original WOFF2 maps the second-row characters but lacks their marks. The
new browser regression failed on Ê having one contour instead of two; a focused
ť test failed on its missing caron. The supplied image now exports all 214
combined characters in OTF, TTF and WOFF2, retains the intended row-two marks and
both side carons, and removes foreign dots from Ą. The same assertions run after
row-two and row-six re-slicing. Unit cases cover cross-row ownership, no double
assignment, connected ogonek protection, detached serifs and conservative
handling of unmatched cell counts.
