-- Moderation + admin. Soft-ban a user (read-only: blocked from every mutation,
-- but can still sign in and browse). Generalize reports to target a font OR a
-- maker, and add a status so the admin queue can mark a report resolved.

-- Soft-ban flags on the user.
ALTER TABLE "user" ADD COLUMN "banned" integer NOT NULL DEFAULT 0;
ALTER TABLE "user" ADD COLUMN "banned_at" text;
ALTER TABLE "user" ADD COLUMN "ban_reason" text;

-- Rebuild reports: a report now targets a font OR a maker and carries a status.
-- Nothing references the reports table (it is a leaf), so a rebuild is safe;
-- existing font reports are copied forward as target_type = 'font'.
CREATE TABLE reports_new (
  id               text PRIMARY KEY NOT NULL,
  target_type      text NOT NULL DEFAULT 'font' CHECK (target_type IN ('font', 'maker')),
  font_id          text REFERENCES fonts (id) ON DELETE CASCADE,
  reported_user_id text REFERENCES "user" ("id") ON DELETE CASCADE,
  reporter_id      text REFERENCES "user" ("id") ON DELETE SET NULL,
  reason           text NOT NULL,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at       text NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO reports_new (id, target_type, font_id, reporter_id, reason, created_at)
  SELECT id, 'font', font_id, reporter_id, reason, created_at FROM reports;
DROP TABLE reports;
ALTER TABLE reports_new RENAME TO reports;
CREATE INDEX reports_status_idx ON reports (status, created_at);
CREATE INDEX reports_font_idx ON reports (font_id);
