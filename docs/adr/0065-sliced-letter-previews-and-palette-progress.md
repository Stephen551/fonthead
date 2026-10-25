# 0065 — Sliced-letter previews and progress for the whole palette

Status: Accepted; extends 0064

## Context and decision

Row counts alone do not reveal clipped or misassigned letters. Each row now
shows its actual traced cell outlines, with the assigned character underneath.
Previews use the raw paths from that sheet, before font fitting or contextual
substitution. Empty cells retain their place and label. Re-slicing replaces only
that row's previews after the rebuilt font succeeds; rollback retains the old
previews with the old row.

The variation traces previously had no progress callback, leaving the readout
at the first sheet's last row. All sheets now report their position in the
loaded palette and their own row progress. The completed trace stage retains
the actual total rows, surviving drawings, and processed sheets. These three
graffiti sheets report 21 rows, 276 drawings, and 3 sheets. Row edits update the
totals if they recover or lose drawings. Progress text wraps on narrow screens.

## Scope and verification

Use the existing maker typography and paper, ink, line, and warning tokens.
Tiles wrap in a responsive grid beneath each row's controls. Paths are rendered
as SVG elements without inserting markup or allocating separate preview fonts.
No additional tracing pass, dependencies, or animation.

Browser checks compare the different sheets' preview paths, check that previews
change after row edits, and observe progress messages from all three sheets.
The export still shapes three drawings per character. A simulated empty engine
result checks that A remains an empty labeled slot and B does not shift into it.
The existing responsive and keyboard checks cover the expanded row groups.
Before this change the preview regression failed because there were no row
preview lists.
