# ADR 0030 — Connected-cursive ships as a two-stage mode behind one flag (touch floor, then opt-in seamless overlap)

**Status:** Accepted · backfilled 2026-06-29 from project history (review and correct if the reconstruction is wrong)
**Date:** 2026-06-28 (spec, approved design)

## Context

On a genuinely connected cursive sheet, the existing flourish-overhang path fakes joins inconsistently and the cell-width path floats every letter apart; there was no connected-script model anywhere in the engine. ADR 0001 establishes that cursive connection is the engine's job using real ink. A staged success bar de-risks shipping the reliable floor before the harder seamless behavior.

## Decision

Add a connected-cursive build mode shipped behind one mode in two stages: (1) a consistent floor where letters reliably touch with even rhythm, no cramming/floating/welds, at overlap = 0; (2) an opt-in seamless stage with a small uniform overlap so strokes merge, made reliable by an input contract (a 'script' generate preset plus a printable connector guide). OVERLAP_PCT defaults to 0.0 (the shipping default); OVERLAP_SEAMLESS=0.015 is the opt-in value gated behind the weld pass. Connect mode is auto-on for detected script faces (replacing flourish-overhang there), with a mono-only advanced toggle to force it on or off; colour faces do not get the toggle.

## Alternatives rejected

The flourish-overhang fake-join path and the cell-width float-apart path were both rejected for genuine cursive (the cases this mode exists to fix). Making the seamless overlap the default was rejected in favor of the touch floor.

## Consequences

The 'good' bar is defined per stage (continuous lowercase runs; clean breaks for g/j/q/y/z, digits, punctuation, space; no fusion welds; no negative-x ink; fontTools-valid bytes). The first build of a script face may need a rebuild to pick up auto-connect (acceptable for v1, seeded cheaply from the previous build's __lastTrim.script flag).

## Evidence

Specs: docs/superpowers/specs/2026-06-28-connected-cursive-design.md 'Goal and success bar (staged)' and 'UX and trigger': 'Auto for detected script faces, replacing flourish-overhang there; a mono-only advanced connected cursive toggle forces it on or off.'
