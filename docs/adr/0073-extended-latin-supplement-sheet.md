# 0073 — Add Extended Latin through a separate supplement sheet

Status: Accepted

## Context

ADR 0071 preserves accented drawings, but extra uploads previously represented
only alternate drawings of the same alphabet. Variations share the base charset
and deliberately discard characters absent from the base. An accents sheet
needs its own mapping and must add characters to the same downloadable font.

## Decision

Expose one optional monochrome accents slot, outside the advanced variation
controls. It accepts its own image and editable charset. It can load before or
after the base alphabet; adding or removing it rebuilds, and editing its charset
invalidates the old download until rebuilt. Hide it in color mode. Disable adding
a supplement while connected cursive is on, and disable connected cursive while
a supplement is loaded. Keep both natural-variation slots available.

Add an Extended Latin generator preset backed by the same shared charset as the
slot. Its prompt requires the original alphabet as a reference image and matches
style, stroke weight and letter size. Store its armed charset separately under
fh-gen-charset-supplement; it never overwrites fh-gen-charset.

The new seven-row preset has 122 characters: it retains both D-with-stroke
(Đ/đ) and eth (Ð/ð), and adds lowercase German sharp-s (ß). The old supplied
119-character image really contains Đ and ð, so its fixture keeps its original
mapping. Do not relabel its eth drawing as đ. Existing sheets remain usable by
entering their actual row order in the accents charset field.

Merge in the order base, base variants, supplement. The base wins duplicates;
duplicate supplement entries are also dropped. Supplement glyphs have ordinary
Unicode entries and no variant suffix. Only the base alphabet receives natural
variation alternates. The font writer itself is unchanged.

Before merging, measure exact main-body bounds through measureBaselineBounds.
Use median flat-capital heights (the baseline pass's reference letters), falling
back to other capitals if necessary. Use non-descending lowercase body heights
for x-height. Exclude detached marks, below-mark references and variants. Scale
all supplement coordinates, cell sizes and baseline metadata uniformly in X/Y,
using the cap-height ratio for capitals and symbols, and the x-height ratio for
lowercase. If one case is absent, use the other measured ratio; if neither is
measurable, report an actionable error. Then align accented baselines against
the base with accentsOnly. Keep the base alphabet's own baseline decisions
separate so the many accented drawings cannot outvote its references.

Retain the original supplement trace in the mono session. Re-slicing any sheet
recomputes the size match and complete merged font from original traces; scales
never compound. Its row controls, sliced-letter previews and progress identify
it as “Sheet N · accents”. Builds with a supplement report mono+accents funnel
metadata, displayed by the existing admin breakdown without schema changes.

## Alternatives rejected

- Reuse a variation slot: would confuse new characters with alternate drawings,
  apply the wrong charset, and reduce the user's variation palette.
- Add raw outlines without scaling: independently generated images use different
  pixel sizes; one font-wide writer scale cannot correct the mismatch.
- Measure the entire accented outline: the accent would shrink the letter body.
- Relabel the old image to fix its case pair: would assign the wrong drawing.

## Consequences

One font can contain the original alphabet, its natural variations and an
Extended Latin supplement. Monochrome only; color supplements, connected-cursive
supplements, composites and standalone combining marks remain out of scope.
The engine still maps positions from an explicit charset; it does not use OCR.
No dependency, database migration or writer change is needed.

## Evidence

The new merge and 2x-size unit tests failed on missing functionality before
implementation. All three browser acceptance tests failed on the missing slot
or preset. Real luxury-serif + supplied 119-character supplement exports test
OTF, TTF and WOFF2 coverage, unique mappings/names where the format stores names,
é/e and É/E body heights within 2%, row edits, removal, and base-only alternates.
An initial 3.18% É/E discrepancy exposed why pointed A's must not dominate the
capital reference. Prompt tests cover both case pairs, sharp-s, storage isolation,
mobile/tablet/desktop controls, keyboard focus and unsupported-mode gating.
