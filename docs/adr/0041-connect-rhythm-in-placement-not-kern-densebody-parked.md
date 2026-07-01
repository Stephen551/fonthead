# ADR 0041 — Even connect rhythm belongs in connector PLACEMENT, not a per-pair kern; the dense-body kern is parked, superseded by a connection-point spec

**Status:** Accepted (dense-body kern parked)
**Date:** 2026-07-01

## Context

A field cursive sheet (a thin, tightly-drawn hand, now the corpus fixture
`connected-cursive-handmade`) rendered with visibly uneven joins: letters that
should touch left daylight (`a`/`d`, `a`/`n`) while others jammed (`d`/`m`). The
shipped band-profile rhythm gate (`RHYTHM_SD_MAX`) did NOT catch it — it read the
face at rhythmSd 40, well under the gate — because that metric measures the
connector-inclusive closest approach, and on a thin hand a thin connecting stroke
rides into the strip and reads a gapped pair as tight.

A render-scale DENSE-BODY measure (rasterize each built glyph at ~60px x-height,
keep the tall columns = stems/bowls with the thin connectors blurred away, gap =
body-to-body white space) reproduced the eye's read exactly: `d`/`m` overlapping,
`a`/`d` and `a`/`n` gapping. Decomposing the built font showed the placement seats
bodies at a roughly constant gap, but the GPOS connect-kern (ADR 0039, which evens
`bodyAvg` — a connector-dominated soft-min) SCATTERS the rendered dense-body rhythm
on 7 of 11 connect corpus faces.

## Decision

PARK the dense-body kern. Two implementations were built and measured; both fail,
and professional practice (research on file, claude.ai) explains why in one line:
**even rhythm in a connected script comes from consistent connector PLACEMENT, not
from kerning the connecting pairs.** Kerning is reserved for the transitions that do
NOT connect (after a cap, after a letter with no exit stroke). Kerning connecting
pairs — which is what the shipped connect-kern and both new attempts do — is the
wrong lever.

The real fix is a CONNECTION-POINT SPEC: one join height + angle that every glyph's
entry and exit terminal is normalized to, with structural (deep-bridge, coincident)
overlap, so connectors meet by construction. Scoped as its own milestone in
`docs/superpowers/specs/2026-07-01-connection-point-spec.md`. ADR 0038's
connector-height snap is a partial version of it (it lowers high exits only).

## Alternatives rejected (do NOT re-walk)

1. **A1 — worker evens its own silhouette dense-body.** The worker silhouette is
   supersampled 4× (to catch thin exit strokes for the collision floors), so it
   counts a letter's tall exit/entry connector as body, under-measures gaps into
   connector-heavy letters, and over-loosens them (`ne` 35→238, `re` 80→262, `ee`
   35→208). A build-time proxy diverges from the render — the same root as ADR 0040.
2. **A2 — main thread evens the render-scale dense-body (the measure that matches
   the eye), passed to the worker kern as the target; the worker keeps its crash
   floors.** Correct measure, correct site. Result: a WASH. Dense-body sd 69→59
   (modest), but thin-stem letters (`l i t f`) have a one-to-two-column body edge
   that shifts a pixel between the placement raster and the built font, so evening
   any gap that touches them over-loosens it (`lo` 106→188; "hello million little"
   rendered visibly looser). The rendered A/B showed no net improvement.

Both confirm the professional finding from a new angle: evening the dense body as a
kern target trades one subtle unevenness for another. Making it clean would need
per-letter-class measure tuning — precisely the grind ADR 0040 warned against.

## Consequences

Thin/inconsistent hands stay at ~B on join evenness until the connection-point spec
lands. The research VALIDATES the surrounding architecture, worth banking:

- No `curs` (GPOS cursive attachment) for Latin — baked connectors + kern + `calt`
  is the correct, portable architecture (Hudson, Hosny, Phinney on TypeDrawers).
- The flashy-hand park (ADR 0040) is right: professionals deliberately do NOT
  automate deep flourished overlap. Restrained forms are default; flamboyant
  deep-overlap forms are user opt-in (a two-tier alternate system).
- Rhythm is judged in the CONNECTION BAND (our `connGap`), not the dense body.

KEPT as a guardrail: the render-scale dense-body probe (`CORPUS_KERN_PROBE=1` now
also emits per-face `denseBody med / sdKern / sdNoKern`) and the
`connected-cursive-handmade` fixture. They catch what the band-profile gate misses
and are the test case for the connection-point milestone.

## Evidence

The professional-practice research (on file). A/B receipts: A1 `ne` 35→238; A2
dense-body sd 69→59 with `lo` 106→188 and a wash render. The corpus sweep
(`CORPUS_KERN_PROBE=1 npm run test:corpus`): the connect-kern raises dense-body
spread on 7/11 faces; `handmade` relative spread 0.60 vs the clean faces' 0.24–0.31;
`flashy` dense-body relatively even (0.31) while its render is uneven (the ADR 0040
divergence). Builds on ADR 0038 (height snap = partial connection-point), ADR 0039
(the shipped connect-kern this would have modified), ADR 0040 (the parked contextual
kern, same root cause).
