# 0068 — Admin usage and member adoption

Status: Accepted

## Context

The daily funnel table showed event counts but could not distinguish members who
successfully exported their own work from members who only tried a sample. A
member does not have to publish to get value from Fonthead. Unpublished artwork
must remain on their device.

## Decision

Render a server-side analytics panel behind the existing admin allowlist, with
7/30/90-day UTC windows, previous-period event comparisons, daily build reliability,
failure and format breakdowns, account/public-font/review summaries, and lifetime
popular public fonts. No chart dependency or new dashboard JavaScript.

Keep the anonymous aggregate funnel. Add daily library-download events in the
same atomic D1 batch as the existing per-font counter; retain its IP/font/hour
deduplication and public-font restriction. Historical library totals cannot be
assigned to dates, so migration 0009 records the tracking start date.

For signed-in non-admin members, track only maker visits, build outcomes, and
download clicks by account/day/event/source. The server obtains the account from
the existing session, never a browser-supplied identifier. Source is an enum:
upload, sample, unknown. Old clients default to unknown and cannot inflate
upload-specific adoption. The maker retains source across rebuilds. Do not send
artwork, font names, filenames, preview text, or anonymous visitor IDs. State this
account linkage in the privacy page; delete it with the account.

Count distinct members who build/download uploaded sheets. A returning builder
has an upload build in the selected window and another on an earlier UTC day.
Same-day rebuilds do not imply retention. Show member counts alongside event
counts without calling their ratio a conversion rate. Aggregate totals include
samples, repeat clicks, and admin testing; client events are best-effort and are
not verified installations or quality assessments. Row edits are not full builds.

Keep data out of caches with private/no-store on authenticated admin HTML, and
preserve that policy through middleware. Keep moderation controls and reviews.

## Alternatives rejected

- Inferring historical member activity from anonymous counters: impossible.
- Uploading unpublished fonts for inspection: unnecessary and contrary to local builds.
- Anonymous visitor/session profiles: not needed to answer member adoption questions.
- Treating downloads as confirmed successful installs: the browser cannot verify this.

## Consequences

Apply migration 0009 before deploying. New member and library-by-day insights
start at migration/deployment, with no backfill. Linked daily usage remains until
account deletion. Account/community totals reflect records still present. The
member table shows at most 100 rows; summary totals include all matching members.
Windows include the partial current UTC day, explicitly labeled.

## Evidence

- Unit coverage: UTC boundaries, bounded windows, period comparisons, empty data,
  unspecified failure details, distinct-member counts, later-day return semantics.
- Local browser coverage: anonymous/non-admin denial, admin exclusion, samples vs
  uploads, unknown legacy source, account deletion, private cache header, 7/90-day
  navigation, 375/768/1280px layouts, actual sample and upload build/download flows.
- Local D1 probe: two identical public-font requests increment both counters once;
  nonexistent font increments neither; deleted test accounts leave no activity.

Local admin browser test: set ADMIN_EMAILS and FH_TEST_ADMIN_EMAIL to a disposable
test address in a local environment, then run e2e/admin-analytics.spec.ts. It is
skipped without that explicit local setup and never runs against production.
