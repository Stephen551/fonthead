-- No artwork, filenames, text, IPs or anonymous visitor identifiers.
CREATE TABLE member_activity (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  event TEXT NOT NULL CHECK(event IN ('make_view', 'build_ok', 'build_fail', 'download')),
  source TEXT NOT NULL CHECK(source IN ('upload', 'sample', 'unknown')),
  count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, day, event, source)
);
CREATE INDEX member_activity_day ON member_activity(day);

CREATE TABLE analytics_start (
  feature TEXT PRIMARY KEY,
  day TEXT NOT NULL DEFAULT (date('now'))
);
INSERT INTO analytics_start(feature) VALUES ('member_activity'), ('library_download');
