# ADR 0049 — Measured-parameter connector reconstruction (amends ADR 0033's no-synthesis rule)

**Status:** Accepted (doctrine amendment; the milestone it enables is in
progress — the connection-point spec, stroke-model route)
**Date:** 2026-07-02
**Amends:** ADR 0033 (connect uses real ink only)
**Builds on:** ADR 0048 (both outline warps failed the panel), ADR 0041/0042
(the connection-point spec), ADR 0040/0043 (the assembled-pass wall)

## Context

Five arcs have now hit the same wall from different directions. Kerning
cannot fix a seam (it moves letters, not strokes — ADR 0040, 0041).
Placement cannot (it fixes rhythm — ADR 0043/0044). Coordinate-warping the
traced outlines cannot (a Potrace contour has its stroke width baked in:
lowering a terminal through the entry shears eyelets, truncating it at the
seam starves it into needles — both failed the adversarial judge panel,
ADR 0048). Every seam defect on file — knots, floats, welds, eyelets,
needles — is one event: two independently drawn terminals meeting at
uncontrolled heights and angles.

The professional model (research on file since ADR 0041) removes the
variable instead of correcting it: every entry and exit terminates at one
standardized join point and angle, and the connecting stroke is DRAWN.
Pros draw it by hand. The maker must reconstruct it from the hand's own
measurements. That is synthesis, and ADR 0033 bans synthesis.

## Decision

ADR 0033's rule is amended, narrowly:

**Connector reconstruction from measured parameters of the same hand is
permitted. Invented letterform variation remains banned.**

A reconstructed connector must be derived entirely from measurements of the
sheet it serves: the hand's connector stroke width (measured), its terminal
tangent directions (measured), its median join height (measured), and
attachment points inside its own dense-body ink (measured). Freehand or
statistically-invented shapes, borrowed strokes from other hands, and any
reconstruction of NON-connector ink (bowls, stems, letterform bodies,
flourishes) stay outside the permission. The intent of ADR 0033 — the font
is this writer's hand, not the machine's guess — is preserved: a connector
rebuilt to the hand's own width, angle, and height carries no information
the hand did not supply.

## Why the line sits here

ADR 0033 was written against a single-sheet randomizer that perturbed
letterforms — inventing shapes the writer never made. A connector differs in
kind: it is the most constrained stroke in cursive (a short transition whose
geometry is dictated by its endpoints), the sheets draw letters SEPARATELY
so no ground-truth connected pair exists to be faithful to, and the panel
verdict showed the alternative concretely — warped real ink reads as
"machine editing," while the deployed build's honest knots read as pen
pooling. Faithfulness to the hand at the seam means reproducing how this
hand's strokes would meet, which is a measured-parameter question, not an
archival one.

## Consequences

The connection-point spec's stroke-model route is unblocked: skeletonize the
terminal tails (centerline + width), delete the drawn tail, draw one
tangent-blended stroke from inside the dense body to the standard join
point, stroke it at the measured width, and emit outlines. The ADR 0048
selection machinery (calt lookahead alternates, metric transparency, kern
fanout and analyzer hygiene) is the delivery vehicle. The assembled-pair
sensor gates the result, and the adversarial panel remains the final gate —
reconstruction that reads as machine editing fails regardless of doctrine.

## Evidence

The ADR 0048 panel verdicts (two warp geometries, converging
machine-artifact content), the ADR 0041 professional-practice research, and
the connection-point spec (docs/superpowers/specs/2026-07-01-connection-point-spec.md),
which this route executes.
