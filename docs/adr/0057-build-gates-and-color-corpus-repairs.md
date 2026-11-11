# ADR 0057 — Enforce build gates and the intended color corpus behavior

**Status:** Accepted (local implementation; not deployed)
**Date:** 2026-10-07

The build review found that `npm run check` exited successfully without checking
types because `@astrojs/check` was absent. Deployment also waited only for the
build/unit job, allowing a release before browser validation finished. The color
corpus explicitly accepted three known defects: an extra palette entry from
anti-aliasing, detached punctuation being culled, and scrambled gradient-shadow
segmentation. Bridged cursive's intended 0.38em word space was overwritten by
the classic 0.30em assignment.

Install the checker and Node types as development dependencies. Generate
Cloudflare bindings before checking and declare secret bindings independently
of local `.dev.vars`, so a fresh checkout checks the same source. Suppress hint
output from vendored modules while retaining the error exit gate. Deployment
must wait for both build/unit and browser jobs; the browser job now includes
the strict color corpus and independent fontTools color-table validation.

Palette clustering prefers coherent stroke interiors. Other sampled colors
remain candidates unless RGB coverage blends of known surfaces explain them;
this retains thin distinct pigments. Ink-to-ink coverage also explains outline
edges. After shadow removal, the original palette supplies edge surfaces so
foreground pixels composited over a shadow cannot introduce another pigment.
Shadow classification uses the same paper-to-ink coverage distance to include
its anti-aliased rim. The existing offset-duplicate test still distinguishes
shadows from real outlines and dark lettering.

Restrict destructive stray/edge culling to supported letter and digit labels.
Detached punctuation remains ink even when its label is guessed. Recognize
the supplied template's single eleven-character punctuation row in its actual
order. Preserve 0.38em word spaces for bridged cursive and 0.30em for classic.

These are local repairs to palette sampling, classification, and assembly;
tracing and glyph placement are retained. Color TTF, single-line output, and
the default rollout of advanced seam alternates remain separate milestones.

Regression tests reproduced the old failures before correction: 300 instead
of 380 font units for bridged space, three instead of two palette colors, lost
punctuation marks, and the wrong template punctuation order. The corpus now
requires all 73 known fixture characters, intended flat palette sizes, and
zero empty/filled/stray flags. The repaired shadowed gradient meets those gates.

Verification on the local implementation:

- `npm test`: 299 tests passed across 30 files.
- `npm run check`: zero errors/warnings. The same source also checked with
  bindings generated from an empty environment file. An intentional TypeScript
  error returned exit 1; removing the probe restored the passing check.
- Direct `tsc --noEmit` and the production `npm run build` passed.
- Corpus: 43 passed in the full 44-case run; one case was interrupted by a
  documentation edit triggering dev-server reload. That unchanged-source case
  passed on rerun. All eight color fixture exports preserve 73 characters,
  intended palette counts, and zero empty/filled/stray flags. Their rendered
  contact sheet was inspected.
- Browser suite: 60 passed in the full 62-case run; two library searches lacked
  the expected local seed fonts. Inserting missing fixture rows without deleting
  existing data restored all three search tests. Both new word-space exports
  passed, alongside existing build, publishing, kerning, seam, variation, and
  stress checks.
- fontTools independently read every table with strict checksums in all eight
  color exports plus monochrome and natural-variation exports. COLR and CPAL
  decompiled successfully; the variation export contains GSUB.

No remote deployment was performed.
