# ADR 0048 — Seam knots fix by contextual alternates, not base surgery

**Status:** Parked (the selection machinery is banked and test-gated; both
warp geometries failed the judge panel — see "Parked" below; the stroke-model
rework is ADR 0049)
**Date:** 2026-07-02
**Builds on:** ADR 0038 (the snap and its HIGH_EXIT exemption), ADR 0036 (the variant glyph carrier), ADR 0045 (which named crossing-knot pools as remaining distance)

## Context

On the smooth-script hand (the first true high-res sheet, 5632px), the seams all
touch and the joins gate green, yet the word "fonthead" reads with a small knot
at f>o and o>n. Isolated pair renders split the seams into two classes: exit
and entry riding at the SAME height merge tangentially and read as one stroke
(h>e, e>a, a>d), while a HIGH exit descending across a LOW entry crosses it at
an angle and pools ink into a loop (f>o, o>n, v>e, s>o). The knot is by CLASS —
high exit over low entry — not by scatter.

None of the shipped levers can reach it. The snap's scan stops at the
connection band's 0.6·xh ceiling, so a stub riding at 0.8·xh is never measured;
lowering the BASE glyph's exit is the reverted stub-snap that flattened the
copperplate swash, which is exactly why HIGH_EXIT letters keep their drawn stub
(ADR 0038). Kerning moves letters horizontally and cannot uncross two strokes
(ADR 0040/0041 territory). And smoothing across the seam inside the font is
impossible: OpenType glyphs render independently.

## Decision

The base glyph keeps its drawn flick everywhere it is seen alone; a COPY
carries the fix, substituted only where the knot happens.

1. **Measured offenders, not classes.** After the snap, each lowercase joiner's
   exit-tail tip height is measured (ink outside the dense body, zone up to
   1.05·xh). An exit riding more than 0.15·xh above the face's entry line (the
   median low-band entry-hook height, clamped 0.08-0.3) is an offender.
2. **One alternate per offender.** A `.jn01` copy with the exit tail warped
   down onto the entry line (`warpTailY`, ramped from the body edge so the
   letterform is untouched, travel capped 1.0·xh). The copy rides the existing
   variant-glyph carrier: appended unicode-less by the builder, placed by the
   variant inheritance (base advance and shift — metrically transparent), and
   fanned into the connect kern by `expandVariantKern`.
3. **A lookahead calt.** `buildGsubJoinAlts` writes a GSUB chain (backtrack 0,
   input = offenders, lookahead 1 = the measured low-entry follower set)
   nesting a SingleSubst base→alternate. Mid-word before a low entry the seam
   merges; word-finally and before a high entry the drawn exit survives.
4. **Measurement rules, each bought with live calibration data:**
   - exit zone ceiling 1.05·xh — at 1.3 the caps and the l/d ascender ink
     read as huge fake tails (A/D/O/S/T flagged, l at the ceiling);
   - structure check band 1.15-1.4·xh — right-of-body ink continuing WELL
     above the zone is a loop or swash, never a connector (the l false
     positive); the band starts above optical overshoot, or v and w
     (stroke tops ~1.08) fall out and their knots go uncorrected;
   - entry hooks read in the low connect band only — measured higher, the
     m/n arch shoulder occludes the low tick and drops real followers;
   - lowercase joiners only; f/t (crossbars by design) and descender-exit
     letters excluded; gate 0.15 (the gentle o .21 / b .18 / w .21 / v .245
     crossings sit under the first-cut 0.28, the clean a/e/h/u class at ~0);
   - the entry line is the hand's OWN median, UNCLAMPED — a copperplate-class
     hand joins at mid-height (cc-3 entries 0.43) and clamping to the snap's
     0.3 ceiling read every one of its exits as high (18 needless alternates,
     caught by the corpus); the snap's clamp protects its warp target, not a
     measurement.
5. **Scope:** v1 fires on non-variation connect builds; the cycling calt owns
   GSUB on a palette and composing the two rule sets is a follow-up. The
   `seam joins` toggle in the advanced panel is the off switch (default on,
   the trimFlourishes doctrine). Ligatures-off gate shared with the variation
   table.

On the motivating hand: offenders b/o/r/s/v/w/x (exits 0.44-0.89 over a 0.258
line), 7 alternates, 101 glyphs. The A/B renders show on/ve/so/ok/oc merging
tangentially where they crossed; word-final flicks intact; f>o keeps its
crossbar texture by design.

## Alternatives rejected

Snapping HIGH_EXIT bases (the reverted stub-snap — flattens the swash
everywhere including word-finally). A per-pair kern refinement (cannot uncross
strokes; the parked ADR 0040 class). Cross-glyph outline union (impossible in
the format). A corpus knot metric in v1 (opentype.js cannot apply calt, so the
corpus measure would read the BASE seams it already gates; the shaping proofs
live in the seam e2e and the knot quality in the A/B renders — an assembled,
shaping-aware metric stays with the parked feedback pass).

## Consequences

Connect fonts grow one glyph per offender (typically 5-8) plus a second GSUB
shape; browsers apply calt by default so the fix needs no user action.
`expandVariantKern` now fans .jnNN alternates, and the non-variation kern path
switches to gid pairs whenever alternates exist. The corpus line prints
`jn=N` per connect face. The r alternate softens the mid-word arm into a low
connector — flagged for the review gate as the one taste call.

**The kern analyzers excise .jn glyphs up front** (`withoutSeamAlts` in
font-engine-autokern.js). The first full corpus with alternates live failed
cc-3 (structural nn 167) and cc-4 (joinGap median 89): the analyzers index
glyphs by char last-wins, so every offender's warped copy SHADOWED its base
and the kern was fitted to lowered exits while rendering mostly bases. The
kern must be fitted to the base outlines; the alternates inherit those values
through the gid-pair expansion. Faces that fire despite already-meeting seams
(cc-3 jn=9 against its mid-height line) were A/B rendered and read
neutral-to-slightly-smoother; no daylight condition was added on that
evidence.

## Parked (same day): both warp geometries failed the judge panel

The 3-lens adversarial A/B panel (deployed build vs the alternates build,
blind) failed BOTH warp iterations, with converging defect content:

1. **v1, lower-through (the linear y-ramp):** craft 70/63, award 64/56,
   fidelity 84/87 against the deployed build. The lowered exit descends
   THROUGH the follower's rising entry and closes a white eyelet loop at
   nearly every v/w/r junction; an identical below-baseline pigtail repeats
   at join after join ("the identical curl everywhere reads as mechanical
   tampering"); the thin lowered strokes read as wire laid over the letters.
2. **v3, terminate-at-join (bounded descent + x-truncation to the seam,
   y-banded):** craft 75/66, award 74/67, fidelity 88/75 — unanimous. The
   compressed curl collapses into a hairline RETRACE NEEDLE repeated at
   nearly every high-exit join; white cracks where the truncated stub stops
   short of the entry (a broken join at province v-i); thorn debris below
   seams; ink below the baseline at b-r; the v drifting toward a y/u hybrid.

The two modes bracket the root cause: **coordinate-warping a fixed-width
OUTLINE cannot draw a connector.** Lowering it through the entry shears it
(eyelets); truncating it at the seam starves its width (needles/cracks). The
deployed build's knots read as pen-weight pooling — imperfect but human;
both warps read as machine editing. Do NOT build a third warp variant.

**Disposition:** the warp is retired; the SELECTION machinery is banked and
stays gated — the measurement layer and its calibration rules, the GSUB calt
lookahead builder, the kern-analyzer excision, the fixture, and the tests.
Production builds never fire the feature (no user surface; `seamAlternates`
is explicit opt-in only, set by the e2e `fh-test-seam-alts` hook). The fix
that replaces the warp is stroke-aware connector reconstruction on the
connection-point spec's standard-join model, enabled by the ADR 0049
doctrine amendment. Panel-score note for future arcs: identical specimens
scored ±10 across panel instances — defect CONTENT is the durable signal,
never the scalar.

## Evidence

Live calibration dumps (`__lastSeamAlts.terminals`), the offender progression
(first cut 19 with cap/loop false positives → final b/o/r/s/v/w/x), fontkit
shaping proofs ('on' → o.jn01 n; 'no' → n o; 'brown' → 4 alternates), and the
A/B renders in the session transcript. Verification at commit: unit 178,
seam e2e 2/2, connect + variation e2e green, corpus 34/34, fontTools strict
checksums on the built OTF, astro build clean.
