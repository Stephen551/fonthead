# ADR 0001 — Cursive connection model

**Status:** Proposed (awaiting Stephen's ratification)
**Date:** 2026-06-29
**Context owners:** Stephen (decides), Claude Code (implements)

## Context

The maker can build connected-cursive fonts from a dropped/generated alphabet
sheet. Across several hands we have hit recurring join defects (a join landing on
the wrong part of an `s`, gaps before descenders, uneven color). In chasing them I
have repeatedly drifted to the same wrong framing: *"the input must draw a
consistent connecting line."* That re-litigates a decision already made and puts
the burden on input we do not control.

## Decision

**Cursive connection is the engine's job. It is produced by joining each letter's
own traced connecting strokes, and it must be robust to the natural inconsistency
of hand- and AI-drawn input. The engine does not require the input to draw a
consistent/flat connecting line, and it does not synthesize connector strokes.**

Mechanics:

- The letters arrive carrying their own entry/exit connecting strokes (drawn by the
  hand or the generator). The engine **keeps** those strokes — they are the join.
- Body-edge placement makes adjacent dense bodies meet so each letter's real
  entry/exit strokes bridge the seam (real ink, original texture preserved).
- The connection lands wherever the letters' strokes actually meet; the engine
  tolerates the height variance of real input rather than demanding it away.
- Removal is limited to **word-edge stubs**: the word-initial letter's left lead-in
  and the word-final letter's right lead-out (so a word does not start/end with a
  tail in space). Where two leads overlap at a mid-word seam, they merge into one
  connector — that is a merge, not a removal.

## Alternatives rejected

1. **Require the input/prompt to draw a consistent flat connecting line.** The
   input is inconsistent by nature; the prompt is not a reliable lever. The engine
   absorbs the inconsistency. (This is the framing this ADR exists to retire.)
2. **Synthesize connector strokes in the engine.** A vector stroke cannot match a
   contrast/brush face's taper and texture — it reads grafted. Real ink only.
3. **GPOS `curs` cursive attachment.** Browser support for default-on Latin
   cursive attachment is unsettled and breaks under letter-spacing.

## Optional / future (does not change the default build)

- **GSUB**, fed by **real** variant glyphs (not synthesis):
  - Word-edge positional forms (initial/final) so stubs are dropped cleanly instead
    of trimmed.
  - Contextual alternates for joins that one form cannot serve.
  - Variant forms can come from the generator drawing them **together in one image**
    (a single generation holds one hand consistent; separate generations drift).
- Always opt-in, and only where it helps (e.g. monoline faces); never the default.

## Consequences

- Connection quality is bounded by whether the input letters carry usable
  connecting strokes. Connected input → clean joins; the engine's responsibility is
  robustness + word-edge handling, not demanding perfect input.
- When a hand's own letterforms are genuinely incompatible (a high exit meeting a
  low entry with no usable connecting stroke between them), that is an **input
  limit**, not an engine bug — and it is named as such, not chased as one.
- "The input must be consistent" is not a valid diagnosis for a join defect. The
  first question is always what the engine did with the strokes it was given.
