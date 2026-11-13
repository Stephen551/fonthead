# 0082 — A new main sheet clears the old natural-variation slots

Status: Accepted

## Context

ADR 0081 traced the 2026-11-13 bug report ("A variation sheet has 2 rows, but the mapping has 1") to a sheet left in a natural-variation slot. A single-image drop on the main input (`onFiles` → `onFile`) replaced the base sheet but kept `variationImgsRef`. Only the sample button cleared it. So a sheet loaded for an earlier font was traced against the next one. ADR 0081 stopped that from failing the build. It still left the stale sheet in the slot, where it would be merged as alternates whenever its rows happened to match.

Stephen's call on 2026-11-13: clear the slots on a new drop.

## Decision

`dropClearsVariationSlots(fileCount, isColor, hasBase)` in `src/lib/maker-checks.ts` is true when a drop on the main input replaces an existing base (`lastImgRef.current` is set) and loads only one sheet as the base: a single file, or any color drop, which uses only the first file. When it is true, `onFiles` empties `variationImgsRef`, the slot names, and the slot file inputs before the build.

- The natural variation toggle stays as the maker set it, so the slots stay visible and ready for new sheets.
- Slots filled before any base exists are kept, because they were loaded for the sheet being dropped now.
- A multi-file drop already refills both slots from its own files, so nothing changes there.
- The accents (supplement) slot is not touched.

## Alternatives rejected

- Also turning natural variation off: the existing flow (toggle on, drop the base, then add sheets, as in `e2e/variation.spec.ts`) would lose the slot inputs after the base drop.
- Clearing inside `onFile`: the multi-file drop calls `onFile` after filling the slots, so it would empty its own variation sheets.
- Clearing on every drop, even with no base: it would discard sheets a maker added to the slots first.

## Consequences

Replacing the main sheet starts a clean font. To vary the new one, the maker loads its variation sheets again. ADR 0081's skip-with-warning still covers a slot sheet whose layout differs from a base it was loaded with.

## Evidence

- `test/variation-rows.test.ts` (`dropClearsVariationSlots`). It was red before the change (`expected false to be true`) and green after.
- `e2e/graffiti-variation.spec.ts` "a new main sheet clears the old variation sheets": a 2-file drop builds with 1 variant, then a single re-drop builds with 0 and both slots read "choose a sheet".
