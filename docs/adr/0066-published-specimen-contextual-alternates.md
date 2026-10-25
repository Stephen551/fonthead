# 0066 — Preserve contextual alternates in published specimens

Status: Accepted

## Context

Portrait Variation's published WOFF2 was byte-identical to the working download:
278 glyphs, including three drawings for each of 92 characters, and a working
GSUB calt feature. The library sample nevertheless rendered like calt was off.
The shared specimen class applies nonzero letter spacing, which can suppress
automatic contextual alternates in Chromium; it also inherited the UI's ss01.

## Decision

Explicitly enable calt on the shared `.spec` class. This covers library cards,
featured samples, and detail specimens, while removing inherited UI-specific
stylistic sets from those specimens. Preserve existing spacing and treatments.
No font rebuild, republish, storage change, or additional client JavaScript.

## Evidence

The browser regression uses the supplied exported font on real card and detail
elements. It checks enabled calt and visible differences from disabled variation
at 375, 768, and 1280 pixels. The regression fails against the old live stylesheet
and passes with the fix. Compare default rendering with disabled alternates;
exact PNG equality between two enabled renders is unsuitable because centered
text can acquire different subpixel antialiasing after its width changes.
