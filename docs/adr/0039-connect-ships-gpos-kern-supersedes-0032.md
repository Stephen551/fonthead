# ADR 0039 — Connect mode ships a GPOS kern table (kerning:true + connectKern); supersedes ADR 0032's kerning:false

**Status:** Accepted
**Date:** 2026-06-30

## Context

ADR 0032 recorded, from the connected-cursive spec, that connect mode sets
`features.kerning=false` and that "connected fonts always build non-italic, ship
**without a GPOS kerning table**" — to protect the plug-to-plug `shiftX=0` geometry
from any re-measured advance. The live code has since moved past that. At
`src/lib/maker.ts:2013` the connect build ships:

```
features: { kerning: true, connectKern: opts.connect ? {} : undefined, ... }
```

So connect mode DOES emit a GPOS PairPos kern table. The connect-specific analyzer
(`analyzeConnectKern`) evens every adjacent pair's body gap toward one target and
breaks descender-loop collisions, and `kerning:true` is what lets those values land
in the bytes. The code comment at maker.ts:2005-2012 documents this; ADR 0032 was
never updated, so the recorded doctrine and the shipping behaviour disagree.

The disagreement is load-bearing for the contextual-kern milestone: that work refines
the per-pair targets inside this same GPOS table. A future reader following ADR 0032
to the letter could revert `kerning:true` to `false`, silently killing both the
existing connect-kern and the refinement. This ADR records the current reality so the
milestone builds on stated doctrine, not a contradiction.

## Decision

Connect mode ships a GPOS PairPos kern table via `kerning:true` and `connectKern:{}`.
**ADR 0032 is superseded on its kerning point only** (the `features.kerning=false` and
"ships without a GPOS kerning table" claims). Everything else in 0032 stands unchanged:
connect is a sibling of trim, builds non-italic with style Regular, keeps
`opticalSidebearings:false`, and forces the cellW advance.

The distinction that makes this safe is the one 0032 conflated: a GPOS PairPos value is
a per-pair x-advance NUDGE applied AFTER placement; it does not re-measure or re-center
a glyph, so it cannot void the `shiftX=0` join geometry. What WOULD void the join is
`opticalSidebearings` (optimizeSidebearings re-centers glyphs) and a style slant (adds
italicSlantSpan to the advance) — both of which connect correctly still disables. So
kerning belongs on the safe side of that line, with optical sidebearings and slant on
the unsafe side.

The `connectKern:{}` options object is the attachment point for the contextual-kern
refinement (ADR to follow): a `{ refine: true }` flag will add a self-gated per-pair
target override inside this same table, never a second lookup.

## Alternatives rejected

Keeping `kerning:false` with no GPOS table (the original 0032 spec): rejected, because
the connect-kern's even-the-pairs corrections have nowhere to land without the table,
and a GPOS pair nudge is provably safe for the plug geometry (it does not re-measure
advances). Leaving ADR 0032 unchanged and letting code and doctrine disagree: rejected,
because the next milestone edits this exact path and a stale "turn kerning off" doctrine
is a live regression risk.

## Consequences

Connect builds carry a real GPOS kern table, validated by fontTools (checkChecksums=2)
and gated by the typographic corpus lint like every other build. `opticalSidebearings`
stays false and style stays Regular (those genuinely void the join). The contextual-kern
refinement milestone extends `connectKern`, not the GPOS writer or placement.

## Evidence

`src/lib/maker.ts:2013` (features kerning:true + connectKern) and the comment at
2005-2012; ADR 0032 (the superseded kerning claim, lines 12 and 20); ADR 0010/0011
(the GPOS PairPos writer and the absolute-x-height pair-gap metric the connect-kern
reuses); ADR 0033 (the connect model the kern refines). Supersedes ADR 0032 on the
kerning point only.
