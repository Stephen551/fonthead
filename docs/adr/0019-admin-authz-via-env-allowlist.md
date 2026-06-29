# ADR 0019 — Admin authz via an ADMIN_EMAILS env allowlist

**Status:** Accepted · backfilled 2026-06-29 from project history (review and correct if the reconstruction is wrong)
**Date:** 2026-06-06 (cbf4fa0 / 76ba1cc)

## Context

Phase 2 added reporting and admin takedown. The admin surface needed to be invisible to non-admins and gated by configuration rather than a database role.

## Decision

Gate admin/moderation features (the /admin dashboard, removeFont, banUser/unbanUser, resolveReport) behind a comma-separated ADMIN_EMAILS environment allowlist checked via isAdminEmail; /admin returns 404 for non-admins. banUser refuses to ban yourself or another admin.

## Alternatives rejected

A visible-but-forbidden admin page was rejected in favor of a 404 so the surface is hidden. No alternative is recorded for the allowlist mechanism itself.

## Consequences

Admin access is environment-config driven (a Worker secret), so it is environment-specific and the admin happy-path is verified manually rather than in CI.

## Evidence

Memory + git commits cbf4fa0 and 76ba1cc 'Add the admin moderation dashboard' ('gated by the ADMIN_EMAILS allowlist (404 for everyone else)').
