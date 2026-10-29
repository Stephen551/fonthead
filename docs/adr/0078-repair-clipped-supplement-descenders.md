# 0078 — Repair clipped supplement descenders from matching base letters

Status: Accepted

## Context

Preserving the detached curl in ADR 0077 did not restore its missing connection.
The supplied ornamental supplement itself has a horizontal cut through the
bottoms of ý and ÿ. Its base sheet has an intact y. Repairing exported files alone
does not carry that correction into subsequent maker builds or row edits.

## Decision

After supplement size and baseline registration, restore an eligible accented
descender from the matching non-variant base glyph. Keep the original accent
contours, baseline and cell width. Grow cell height to contain the restored tail.
Both upload and re-slicing already pass through this registration step, so live
font preview and every export receive the same repaired outlines.

Require all of the following: an above-accented g/p/q/y; an intact corresponding
base; close width and body-top alignment; a modest amount of missing depth;
two disconnected body pieces ending at the same bottom cut; at least 94%
bidirectional pixel agreement above that cut within a two-pixel allowance at
normalized x-height; and one connected donor body. Accents never participate
in the comparison. Healthy, differently drawn, differently scaled, below-accented
and ambiguous glyphs remain unchanged. This is restoration from supplied
letterforms, not synthesis of an arbitrary joining stroke.

## Evidence

The updated browser regression fails before this change: the exported ý body
has two ink components instead of one. It checks connected bodies in OTF, TTF
and WOFF2, retained accents and 214 mapped characters, and repeats the export
after re-slicing. Unit cases protect intact and intentionally different forms,
reject unrelated or disconnected donors, and check geometry preservation.

Validation: 372 unit tests, seven browser cases including natural variation,
smooth joins, calligraphy, luxury serif, ornate spacing and tight accents;
typecheck reports zero errors and warnings. Comparing the rebuilt 214-character
font against the preceding export changes only ý and ÿ. Their bodies now match
the base y and contain one connected ink component in every export format.
