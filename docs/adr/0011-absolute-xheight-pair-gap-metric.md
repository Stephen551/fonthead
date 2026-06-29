# ADR 0011 — Measure kerning pair gaps at absolute x-height fractions, not band-normalized

**Status:** Accepted · backfilled 2026-06-29 from project history (review and correct if the reconstruction is wrong)
**Date:** 2026-06-29

## Context

A band-normalized gap metric (per-glyph yMin..yMax bands) misread height-mismatched pairs, reporting 'a+n loose 82' when absolute measurement showed the pair overlapped, which caused a wrong diagnosis. Min/max-based metrics are dominated by one or two height-mismatched pairs. The misleading anchor sabotaged the judge panel until anchored to kerned reality.

## Decision

Always measure kerning pair gaps at absolute x-height fractions (baseline = 0) using a robust x-height-strip body metric (P10..P90 percentiles), never band-normalized per-glyph bands and never raw min/max. Apply the same absolute measurement to kern analysis and corpus metrics.

## Alternatives rejected

Band-normalized (per-glyph yMin..yMax) gap measurement and min/max-based metrics were rejected as misleading on height-mismatched pairs.

## Consequences

Kern analysis and corpus metrics use absolute x-height-strip percentile measurement. Recorded as a recurring lesson: a misleading metric anchor cost a wrong diagnosis.

## Evidence

Memory: 'a BAND-NORMALIZED gap metric (per-glyph yMin..yMax bands) MISREADS height-mismatched pairs... Always measure pair gaps at ABSOLUTE x-height fractions (baseline=0), never band-normalized.'
