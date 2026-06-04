-- User reports against published fonts, for the report + takedown workflow.
-- A report is kept even if the reporter's account is later removed (reporter_id
-- goes null); it is removed when the font is removed.

CREATE TABLE reports (
  id          text PRIMARY KEY NOT NULL,
  font_id     text NOT NULL REFERENCES fonts (id) ON DELETE CASCADE,
  reporter_id text REFERENCES "user" ("id") ON DELETE SET NULL,
  reason      text NOT NULL,
  created_at  text NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX reports_font_idx ON reports (font_id);
