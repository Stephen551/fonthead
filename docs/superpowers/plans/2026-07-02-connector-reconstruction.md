# Plan: connector reconstruction on the standard-join model (ADR 0049)

**Date:** 2026-07-02
**Enables:** the connection-point spec (2026-07-01), stroke-model route
**Doctrine:** ADR 0049 (measured-parameter reconstruction; invented letterform variation stays banned)
**Delivery vehicle:** the ADR 0048 banked machinery (offender measurement, calt lookahead alternates, metric transparency, kern fanout, analyzer excision, `fh-test-seam-alts` hook, the smooth-script fixture and seam e2e)

## The model

Every seam defect on file is two independently drawn terminals meeting at
uncontrolled heights and angles. The fix removes the variable: an offender
exit is REDRAWN as a stroke — measured width, tangent-blended from inside the
dense body, terminating just past the standard join point (the hand's own
median entry tip position and height) with a shallow tangent-aligned overlap
into the follower's entry corridor. Meeting is by construction; the panel
remains the taste gate.

v1 scope: EXIT-side only, non-variation connect builds, offenders selected by
the banked ADR 0048 measurement. Entry-side normalization only if the panel
says the residual entry variance still reads; steep-class (s/x) included this
time — synthesis does not share the warp's steepness problem, but the stage-3
micro-panel decides.

## Stages, each gated

**Stage A — terminal stroke model (pure, TDD).**
`traceTerminalStroke(prof, body, baseY, xhPx, side)` → centerline points +
per-column width + attachment point/tangent (at the body edge) + tip, or null.
Reconstruction from the existing glyphColumnAreas profile: for x beyond the
body edge, the tail's cross-section is the y-run where rowRight >= x (exit
side; the tail is the rightmost structure). Centerline = run mean; width =
median vertical thickness x cos(slope). Guards: null under 3 columns; a
curled tail (multi-run cross-section) takes the union — median damps it.
Diagnostics: per-glyph stroke params into __lastSeamAlts.terminals.
GATE: unit tests on synthetic profiles; measured widths on the smooth hand
within 20 percent of the trace's strokePx.

**Stage B — connector synthesis (pure, TDD).**
`synthesizeConnector(attach, tangentIn, joinPoint, tangentOut, width)` → one
closed outline path: cubic centerline tangent-matched at the attachment,
ending past the join point by OVERLAP_LEN with the standard tangent; stroked
±width/2 along normals, round start cap buried inside the body ink, tapered
tip. Standard join = median entry tip x-offset from the origin, median entry
height, median entry tangent — all measured per face.
GATE: unit tests (geometry: tangency, width, tip position); rendered
single-stroke sanity (no self-intersection at max curvature).

**Stage C — alternate assembly.**
The .jn01 alternate becomes: original paths with the drawn tail COLLAPSED
onto the body-edge clip line (x' = min(x, clipX), the degenerate cap hidden
under the synthesized stroke's ink) + the synthesized connector appended as
its own contour (nonzero fill unions visually). Metric transparency and
delivery unchanged (decisions inheritance, calt lookahead, kern fanout).
GATE: fontkit shaping proofs (banked e2e assertions), checksum validity,
alternate bbox sanity.

**Stage D — the o→n micro-panel.**
Build the smooth hand with synthesis on ONE class (o) via the test hook;
render the on/ok/oc/ow seams at high zoom; a 3-lens mini panel judges the
SEAM CLASS A/B. Numbers are stochastic ±10 — defect CONTENT decides.
GATE: no machine-artifact content (eyelets, needles, cracks, debris) on the
synthesized seams. Fail → stop, reassess geometry before widening scope.

**Stage E — rollout + assembled-pair sensor.**
All offender classes incl. s/x. The corpus gains the assembled-pair seam
metric (place pair at final metrics with the alternate applied — fontkit
shaping in the corpus node context, raster the seam zone, measure crossing
count / pooling area / gap) as a gated metric on the connect faces, fixture
thresholds calibrated on the smooth hand and cc corpus faces.
GATE: corpus green; unit + e2e suites green.

**Stage F — the full panel + Stephen's gate.**
Full-specimen 3-lens A/B against the deployed build. Both warp failures are
the bar's floor: the synthesis build must beat A on defect content, not just
score. Then Stephen's eye. Deploy stays held until both pass.

## Do-not-re-walk (carried from ADR 0048)

No coordinate-warp variants (lower-through shears eyelets; truncate starves
needles). No per-pair kern for seams. No cross-glyph outline smoothing.

## Rollback

Everything rides the opt-in flag until Stage F passes; the park state
(production plain) is one flag away at every stage.
