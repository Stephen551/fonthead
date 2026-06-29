# ADR 0021 — Set-once owner-scoped handle, with Google sign-in linked by verified email when enabled

**Status:** Accepted · backfilled 2026-06-29 from project history (review and correct if the reconstruction is wrong)
**Date:** 2026-06-05 to 2026-06-06

## Context

Better Auth will not persist a custom handle at signUp (no additionalFields here), and handles need to be immutable after being set while keeping the denormalized fonts.maker_handle in sync. Google was added as a second sign-in path, but the app must still boot without Google secrets configured.

## Decision

Let a user choose their handle once (at sign-up or once on the profile for older auto-handle accounts), then set handle_locked=1, via a two-call flow (signUp.email then actions.claimHandle); claimHandle also rewrites fonts.maker_handle for that owner, scoped by indexed owner_id. Add Better Auth socialProviders.google enabled only when GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET are set, with account.accountLinking enabled and trustedProviders:['google'] to link a Google login to an existing email/password account by verified email (no migration needed, the 0001 account table already has the OAuth columns).

## Alternatives rejected

Persisting the handle directly at signUp was not possible (Better Auth lacks additionalFields here), so the two-call flow was adopted. No alternative provider is recorded.

## Consequences

The handle is immutable once set; claimHandle cascades to fonts.maker_handle scoped by owner_id. The app boots without Google secrets; Google users skip the handle picker (auto-assigned, changeable once); no CSP change is needed (top-level nav, not fetch). A known open bug: Google sign-in can fail account_not_linked for an existing same-email account.

## Evidence

Memory: 'Set-once handle... then handle_locked=1; claimHandle also rewrites fonts.maker_handle... Better Auth won't persist a custom handle at signUp (no additionalFields) -> two-call flow.' and 'socialProviders.google... enabled only when GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET are set... accountLinking... trustedProviders: [google].'
