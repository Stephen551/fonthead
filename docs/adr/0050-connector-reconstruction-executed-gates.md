# ADR 0050 — The reconstruction's executed gates: connector-weight attach, entry-side backtrack, the dive gate

**Status:** Accepted (Stages A-D + entry side shipped behind the test hook;
Stage E's corpus sensor landed in ADR 0051, Stage F closed in ADR 0052 —
milestone closed and deployed 2026-07-03, production connect plain)
**Date:** 2026-07-03
**Executes:** ADR 0049 (measured-parameter reconstruction)
**Builds on:** ADR 0048 (delivery machinery), ADR 0040 (the assembled-pair wall)

## Context

ADR 0049 permitted drawing a connector from the hand's own measurements. The
build ran as staged panel loops (three blinded 3-lens rounds plus focused
forensic verifiers, every finding becoming a measured correction), and two of
the director's own catches redirected the geometry. This ADR records the
decisions that now define the reconstruction, so they are not re-derived or
un-learned.

## Decisions

1. **Width is the whole-tail median; the attach point is the
   connector-weight start.** A drawn tail's first columns past the dense body
   are bowl-overlap unions (o) or the letter's own tapered terminal limb (the
   w's descent from its final loop, v and b likewise), then a separation
   pinch, then the true flick. Three consecutive columns within [0.4, 2.5]x
   the whole-tail median mark where the connector begins: the stroke attaches
   there, the collapse clips there, and everything before it stays the
   letter's ink. Clipping at the dense-body edge amputated the w's limb (the
   wo regression); a root-columns width read landed in the pinch (the slab
   and the short-fall regressions). Do not re-walk either.

2. **Reach spans the kern gap; the taper hides in the overlap's last
   quarter.** The pair kern is fitted to the BASE outline's flick, so the
   follower sits near where the drawn flick ended. The synthesized tip runs
   to `max(joinX + 1.5w, m.last − w/2)` capped at `m.last + w/2` — short of
   the follower's far edge (the oc spur), long enough that the taper never
   runs naked in the kern gap (the round-2 waist).

3. **The curvature guard is width-preserving.** Only the inner rail yields
   to the local radius; the outer rail swells by the remainder. Clamping
   both rails starved the trough (the round-1 waist).

4. **The entry side ships as backtrack alternates.** Arch letters on this
   hand draw their lead-in at the TOP (entryFrac null, hooks 0.74-0.92·xh) —
   floating ink no exit can meet. `.jn02` collapses the hook, fired by a
   backtrack calt only after a lowercase joiner whose exit MEETS the line
   (low, or reconstructed); `.jn03` composes both sides through ordered calt
   passes. Word-initial keeps the drawn lead-in. Guards bought live: a letter
   with a real low entry never fires (h/k/q's sweep crosses the band floor —
   collapsing it chops a live connector), caps never trigger, and the clip
   pads 0.03·xh past the body edge (the n's flick-root needle).

5. **Steepness is gated by measurement, not by letter list.** The flat
   descent cap (SEAM_DY_MAX 0.35) is gone. The dive gate parks any seam
   whose synthesized descent would exceed slope 1.75 (dy per dx to the tip
   target): the verified-clean class measures 0.88-1.49; this hand's s
   (2.66) and x (2.08) park with their drawn sweeps and rendered as a weld
   and a dangle when forced. A parked high exit is also excluded from the
   entry rule's backtrack class — its drawn sweep lands on the follower's
   hook, so the hook must survive. A roomier hand's s/x fires on its own
   geometry.

## Consequences

The steep short-stub class joins ADR 0040's parked territory: its fix is
per-pair (the assembled pass), not a wilder cubic. Remaining work: the
assembled-pair seam sensor as a gated corpus metric (Stage E), then the
full-specimen panel with a real 12-16px waterfall and the director's gate
(Stage F). Everything rides `fh-test-seam-alts`; production builds are
byte-stable.

## Evidence

The panel record and calibration numbers live in the plan
(docs/superpowers/plans/2026-07-02-connector-reconstruction.md, Progress) and
in `__lastSeamAlts` diagnostics (offender width profiles, runs, dives,
skipped, entryOffenders, lefts). Gated by test/seam-stroke,
test/seam-connector, test/maker-connect, test/gsub, and e2e/seam.spec.ts.
