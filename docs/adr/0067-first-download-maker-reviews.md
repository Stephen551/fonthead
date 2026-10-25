# 0067 — Ask for a maker review after the first download

Status: Accepted

## Context and scope

Someone downloading a freshly made font can review the maker experience before
trying the font in another application. Ask once after a maker export starts,
without blocking the download or the publish controls. Library downloads do not
trigger this maker-specific question. Browsers do not expose confirmation that
the user saved a download, so the prompt says the download has started.

## Decision

Use an inline, dismissible React form beneath the export buttons. Require a
one-to-five rating; review text is optional and limited to 2,000 characters.
Both rating and public-display permission start unselected. The separate
checkbox permits showing the rating and review anonymously on Fonthead.
Unchecked submissions remain private feedback. No review is auto-published.

Mark the prompt as shown in localStorage, whether it is submitted or dismissed.
An in-memory guard prevents repeated prompting if storage is blocked. This is
once per browser storage, not a claim of cross-device or historical tracking.
Do not attach artwork, fonts, settings, names, or email to the form payload.
The server associates an existing signed-in account only for deletion and checks
the existing suspended-account restriction. Anonymous reviews are accepted.

Store reviews in D1 with a constrained rating and permission flag, original
opt-in wording, and submission timestamp. A UUID makes retries idempotent;
duplicate requests cannot change the original permission. Rate-limit the action
and ignore the honeypot. Failed submissions retain the text and checkbox state.
Show the latest 100 reviews in the existing protected admin page, with private
and permitted reviews explicitly distinguished. Delete linked reviews on account
deletion. The privacy page describes storage, permission, and the browser flag.

## Verification and rollout

Unit tests cover persistence and blocked storage. Browser tests exercise a real
font download, unselected defaults, keyboard rating controls, three viewport
widths, repeat downloads, reloads, dismissal, submission retry, and invalid server
input. Verify the stored permissions and retry row counts in local D1 and the
admin inbox. The first-download test fails against the pre-feature live build.
Apply migration 0008 before deploying code that reads or writes maker_reviews.

Existing paper/ink/line tokens, native radio and checkbox controls, visible focus,
and the existing button styles are retained. No animation or new dependency.
