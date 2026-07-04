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

## Progress (2026-07-03)

Stages A-D are done and committed. Stage D ran three blinded 3-lens rounds;
each round's finding became a measured correction (taper into the overlap +
width-preserving curvature clamp; reach to the drawn flick's span after the
tail profiles showed the stroke running naked in the kern gap; tip capped at
the span after an oc far-edge spur). Final forensic: no eyelets, needles,
cracks, debris, or gaps; connector at face stroke norm through every join.

The ENTRY SIDE, deferred in the v1 scope pending "the panel says the residual
entry variance still reads," was executed early: the director's eye caught the
w's floating lead-in (this hand draws its arch letters' entries at the TOP,
invisible to the low-band scan — m/n/r/v/w read entryFrac null with hooks at
0.74-0.92·xh). A follower's floating hook collapses in a .jn02 copy fired by
a BACKTRACK calt after a lowercase joiner (word-initial keeps the drawn
lead-in); a both-sides letter composes through .jn03 (awa → w.jn03). Gates
bought live: a letter with a REAL low entry never fires (h/k/q false-fired at
the 0.6 band floor — their sweep continuation is not a hook), caps are not
joiner-exits, and the collapse pads 0.03·xh past the body edge (the n's flick
root straddled the clip line and left a needle flank). Forensic-verified
clean; word-initial and word-final controls byte-near-identical.

Two later corrections, both director catches (ADR 0050 records all executed
gates): the wo pair exposed the collapse amputating the w's terminal limb —
the stroke model now attaches at the CONNECTOR-WEIGHT point (three
consecutive sane-width columns), sparing drawn structure, verified within
1-2px of the drawn form. And the Stage E steep rollout replaced the flat
descent cap with the measured DIVE GATE (max slope 1.75; verified-clean
class 0.88-1.49; this hand's s 2.66 and x 2.08 park with drawn sweeps, and
a parked high exit is excluded from the entry rule's backtrack class so the
follower's hook survives after it).

Stage E completed 2026-07-03. The corpus builds its connect faces WITH the
seam-alternate hook (the rollout: the corpus now gates the future connect
default; production stays plain, proven by the seam e2e), the smooth hand
joined the corpus as connected-cursive-smooth, and the assembled-pair seam
sensor reads every fired .jn seam at final shaped metrics (fontkit shaping in
node, raster + zone read in-page between the two dense bodies, band -0.1 to
1.1 xh): gap columns / crossing columns / pooling ratio, each seam also read
with the alternates mapped back to their bases at the identical positions
(metric transparency), so every line logs the defect contrast. Calibration
across all 11 firing faces (28 seams on smooth, 20 on cc-3, 13 on cc-4):
gap discriminates sharply (healthy 0, bridged faces 1 raster column, gate 3);
crossing columns are dominated by legitimate two-run geometry (cc-3's r arm
rides its whole seam at 62; smooth's verified-clean seams reach 25), so its
gate (90) is the catastrophe floor, not a taste instrument; pooling (healthy
max 6.13 beside an arch shoulder) gates at 8 for runaway blobbing only. On
the smooth knots the alternates measurably beat the plain render (on 11 vs
17 crossing cols, va 1 vs 6). GATE PASSED: corpus 35/35 (existing gates all
held with the hook on), unit 219, e2e 57.

Stage F ran 2026-07-03. The blinded 3-lens A/B + real 12-16px waterfalls:
small sizes are a production tie (high confidence, the Stage D worry
settled), reading rhythm split, and the instrumented probe cleared the
synthesis of floor-class content (no daylight, no needles — the "needle"
read was the designed tip taper). The DIRECTOR'S GATE then failed the
signature o seams (ow/ov/own, the carry-in look-item) and smooth ve: the
build fired alternates on seams where the drawn hand wins. Every build-time
scalar separator was refuted by measurement (depth, dive floor, dive
ceiling — same face, same dive, opposite outcomes), so the correction is
the pass ADR 0040 parked, now built and banked as ADR 0052: a probe build
senses every fired exit seam alternate-vs-plain at the font's own metrics
and a losing offender parks itself (plan:
2026-07-03-assembled-seam-feedback.md). Validated drops: signature o (the
face builds plain), cc-3 c/o/p/r, handmade o/v, light o; every measured
winner keeps firing; corpus gapMax now 0 everywhere; unit 238 / corpus
35/35 / e2e 57 green.

Remaining: the director's eye on the re-rendered strips (his ve call is
the open taste item — v survives by measurement, 've' is outside the
sensed pair set), then deploy.

## Do-not-re-walk (carried from ADR 0048)

No coordinate-warp variants (lower-through shears eyelets; truncate starves
needles). No per-pair kern for seams. No cross-glyph outline smoothing.

## Rollback

Everything rides the opt-in flag until Stage F passes; the park state
(production plain) is one flag away at every stage.
