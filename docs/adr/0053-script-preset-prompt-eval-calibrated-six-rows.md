# 0053 — The script preset prompt is eval-calibrated: six rows, grid-contract rules, measured against the engine

Date: 2026-07-03
Status: accepted (Stephen approved the copy in session); DEPLOYED to prod
2026-07-03, wrangler version 34a6c005 — verified live: the /make page bundle
carries the grid-contract prompt and the 12-mark row. The eval API key was
deleted after the run.
Spec: docs/superpowers/specs/2026-07-03-script-prompt-optimization-design.md

## Context

The SCRIPT generate-a-sheet prompt in make.astro is the copy users paste into an
image model to produce the 3-version cursive palette the maker builds. It had never
been tested against what the engine actually rewards (ADR 0037-0052 gates). A
measured loop was run: generate real sheets with GPT Image (gpt-image-1, 1536px,
high; 5 sheets per revision), static-check them (row bands, per-row glyph counts,
stroke/rowH vs the 0.05 wispy floor, gray-fuzz/halo histograms), then build each
through the real maker via the corpus harness (connect mode, seam alts on) and read
the banked sensors.

## Baseline findings (current prompt, 5 sheets)

- 0/5 sheets had a correct charset. The model reflows rows (row 1 ends at L, M
  slides down; everything after mis-maps, since the tracer assigns by position),
  duplicates letters (M M, l l l, f f g g, y y), drops others (I, J, j, n, Y, L).
- The two exotic symbol rows were garbage on every sheet: duplicated %, stray
  arrows, wrong marks, never the requested set.
- 3/5 sheets fused rows vertically (cap swashes/descenders touching the next row,
  bands up to 402px) — a fused row cannot be sliced.
- Stroke weight 0.044-0.068 of rowH: at or under the engine's 0.05 floor.
- All rows 85-140px, far under the 200px fidelity threshold; supersampling always on.
- Engine: builds succeeded, 2/5 failed corpus gates (structural fusion 166, 181);
  entry-height sd 0.216-0.351 (all past the 0.19 bridged gate, every face NORM).

## Decision (the shipped v1 rules)

1. SIX rows: the 7-row sheet's two symbol rows collapse to 12 familiar marks
   (. , ! ? : ; ' " - & @ #), matching the flat/gradient presets' row.
   PRESET_CHARSETS.script mirrors this. Unbuildable filler is not worth the rows.
2. A "THE GRID IS THE CONTRACT" section: exact per-row sequences drawn once,
   leave short rows' remainder empty, rows never touch vertically, and a
   post-draw self-check/redraw instruction (inert for a raw image API; ChatGPT
   and Gemini can inspect their output and redraw).
3. Pen weight named numerically: about 1/9 of the lowercase body height. This
   moved engine-measured stroke to 0.070-0.084, clearing the floor on 5/5.
4. The impossible "4096px (4K)" resolution ask replaced with the lever the model
   controls: even same-height rows, grid filling the sheet, characters as large
   as the sheet allows.
5. The 3-version palette rules (ADR 0036 metric transparency) unchanged.

Shipped-version measured deltas vs baseline (5 sheets each): vertical fusion 3/5
to 0/5; row structure correct 0/5 to 5/5; digits row exact 1/5 to 4/5; stroke floor
cleared 5/5; rhythm sd 12-84 vs 74-98; corpus gate failures 2/5 vs 2/5 (a tie —
residual welds/cap-overhang are properties of the hand drawn, not the layout).

## Refuted alternatives — do not re-walk

- **Drawn pale-gray grid boxes (v2).** The gray guides stay under the trace
  threshold as designed, and box discipline is excellent, but the model invents
  its own column count (~11 in landscape) and REFLOWS the whole charset through
  it: uniform 11-glyph rows, 7-8 detected rows, position mapping destroyed.
- **More verbose rules, named punctuation, alphabet-half prose (v3).** Counts got
  worse (10-12 per 13-row), one sheet fused again, one drew near-empty rows.
  Verbosity is not compliance.
- **Short rows, max 10 per row, 8 rows portrait (v4).** Portrait shrinks the
  model's column prior to ~8 and it reflows again: 9 rows on 5/5 sheets.

The general finding: GPT Image fills an aspect-driven column budget and reflows
content through it; the only row structure it approximately honors is semantic
units it already knows (alphabet halves, digits) in landscape. Exact per-glyph
counts are NOT reachable by prompt: the residual is 1-2 duplicates/drops per
sheet, concentrated in lowercase rows.

## Addendum (2026-07-04): single-sheet mode

The script preset gained a mode toggle (director request): "one sheet" (default)
generates a single cursive sheet using the eval-winning prompt VERBATIM (it was
measured in exactly this single-sheet form), "three versions" keeps the 3-sheet
natural-variation palette. Same six rows, same PRESET_CHARSETS.script for both.
The toggle resets to "one sheet" on every entry to the preset.

## Follow-ups

- The maker could compare per-row glyph counts against the armed preset charset
  and warn precisely which row is off (catches the residual duplicate/drop class
  the prompt cannot fix). Un-built.
- The eval harness (gen/sheetcheck/measure scripts, corpus-driven) lives in the
  session scratchpad; the method is reproducible from this ADR + the spec.
