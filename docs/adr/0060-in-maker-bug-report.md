# ADR 0060 — In-maker bug report: automatic context, opt-in sheet, admin queue

**Status:** Accepted
**Date:** 2026-10-24

## Context

The only way to report a problem was the `/support` form, linked from the site
footer. It arrives as free text: "it didn't work", with no sheet, no settings,
no error, and no browser. Fonthead's failures are almost all about a specific
sheet meeting a specific setting, so a report without either is rarely fixable.
A wider launch (posting the maker to communities of strangers) would bring
sheets the corpus has never seen, which is exactly when reports matter most.

## Decision

1. **A report form inside the maker.** A quiet "something wrong? tell us" link
   sits under the build readout. When a build fails, the form opens on its own
   with a plain prompt ("That didn't build..."), because the failure is the moment
   people will say what happened.
2. **Context is sent automatically and kept bounded.** The browser sends the
   maker's state: phase, stage, kind, the error and its `classifyBuildError`
   class, the warning, every build setting, row and glyph counts, sheet size,
   user agent, viewport and pixel ratio. The server keeps only the fixed key
   list in `src/lib/bugreport.ts`, scalar values only, strings capped. Nothing
   else in the payload is stored.
3. **The sheet is opt-in.** A checkbox, off by default, attaches the source
   sheet flattened onto white and downscaled to 2400px on the long side as JPEG.
   The privacy page says sheets stay on the device unless the person chooses
   otherwise, so attaching must be that choice. The server checks magic bytes
   (JPEG or PNG) and size (64 B to 4 MB), never the declared type.
4. **Stored first, emailed second.** A report is a row in `bug_reports`
   (migration 0007) plus, when attached, an R2 object at `bugs/<uuid>.jpg`. The
   support email (reusing `sendFeedbackEmail`) is best-effort, so a Resend
   outage loses nothing. If the row insert fails, the just-written sheet is
   deleted so nothing is orphaned.
5. **Sheets are admin-only and short-lived.** `/cdn/bugs/...` serves only to an
   `ADMIN_EMAILS` session, never cached, and returns the same 404 as a missing
   object to everyone else. Closing a report from the admin page deletes the
   sheet. Deleting an account deletes that account's bug reports and sheets.
6. **No account needed.** Like `/support`, a report works signed out, behind the
   same honeypot and a per-IP limit of 5 per hour.

## Consequences

- The admin page gains a "Bug reports" queue above font reports, showing the
  note, the formatted context, a thumbnail of any sheet, and a close button.
- A sheet worth keeping as a corpus fixture has to be saved before the report
  is closed, because closing deletes it.
- `/support` stays as the general channel for ideas and anything outside the
  maker.
