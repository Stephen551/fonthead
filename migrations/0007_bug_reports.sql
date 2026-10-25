-- In-maker bug reports (ADR 0060). A report carries an optional note, an
-- optional reply email, the maker's context at the moment it was sent (bounded
-- JSON, see src/lib/bugreport.ts), and, only when the person ticks the box, an R2
-- key for a downscaled copy of their sheet. Anonymous reports are allowed, so
-- user_id is nullable; the account's own reports are deleted with the account.

CREATE TABLE bug_reports (
  id          text PRIMARY KEY NOT NULL,
  message     text NOT NULL DEFAULT '',
  reply_email text,
  user_id     text REFERENCES "user" ("id") ON DELETE SET NULL,
  context     text NOT NULL DEFAULT '{}',
  sheet_key   text,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at  text NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX bug_reports_status_idx ON bug_reports (status, created_at);
CREATE INDEX bug_reports_user_idx ON bug_reports (user_id);
