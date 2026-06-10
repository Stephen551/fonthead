-- The maker funnel instrument panel: day-bucketed event counters, nothing
-- else. No identifiers, no sessions, no rows per user — privacy is structural
-- (there is nowhere to put PII). meta carries a small enum-ish detail per
-- event (build kind, failure class, download format).
CREATE TABLE funnel (
  day   text NOT NULL,
  event text NOT NULL,
  meta  text NOT NULL DEFAULT '',
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, event, meta)
);
