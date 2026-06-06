-- Profile fields. `bio` is a short maker blurb shown on the profile and maker
-- page. `handle_locked` makes the handle a one-shot choice: a maker picks it at
-- sign-up (or changes their auto-assigned one once), then it locks. The avatar
-- reuses the existing Better Auth `image` column, so no column is added for it.
ALTER TABLE "user" ADD COLUMN "bio" text;
ALTER TABLE "user" ADD COLUMN "handle_locked" integer NOT NULL DEFAULT 0;
