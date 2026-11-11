CREATE TABLE build_failures (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  kind TEXT NOT NULL CHECK (kind IN ('mono', 'flat', 'gradient')),
  source TEXT NOT NULL CHECK (source IN ('upload', 'sample', 'unknown')),
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 1000)
);
CREATE INDEX build_failures_time ON build_failures(created_at, id);
