# ADR 0017 — Outbound email via the Resend HTTPS API (Workers cannot do SMTP); inbound via Email Routing

**Status:** Accepted · backfilled 2026-06-29 from project history (review and correct if the reconstruction is wrong)
**Date:** 2026-06-08 (7ddaf01)

## Context

Cloudflare Workers cannot open SMTP connections, but self-service password reset (Better Auth), email confirmation, and the support form all need outbound mail. MailChannels (the old free Workers option) ended its free tier in 2024. For inbound, Porkbun forwarding could not be used because Porkbun is not authoritative DNS.

## Decision

Send all transactional email through the Resend HTTPS API via a single src/lib/email.ts helper that never throws and no-ops without RESEND_API_KEY, with an EMAIL_DRY_RUN guard for local/e2e. Handle inbound mail via Cloudflare Email Routing (DNS is on Cloudflare), with Resend on a send. subdomain to avoid conflicting with the root MX/SPF used by Email Routing.

## Alternatives rejected

SMTP/nodemailer was rejected (Workers cannot do SMTP). MailChannels was rejected (free Workers tier ended in 2024). Porkbun forwarding for inbound was rejected (not authoritative DNS).

## Consequences

A send failure cannot break a request (the helper never throws); the app boots without a key; EMAIL_DRY_RUN keeps local/e2e from mailing real inboxes. Email confirmation later became a prerequisite for Better Auth Google account linking.

## Evidence

Memory + git commits 7ddaf01 'Add self-service password reset' ('Email goes out through Resend over HTTPS (Cloudflare Workers can't do SMTP)... a small src/lib/email.ts helper that never throws') and efa9ead 'Add an EMAIL_DRY_RUN guard'.
