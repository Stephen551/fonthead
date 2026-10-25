-- Reviews stay in the admin inbox. Permission to display is optional and is
-- distinct from publishing; this migration creates no public review endpoint.
CREATE TABLE maker_reviews (
  id              text PRIMARY KEY NOT NULL,
  user_id         text REFERENCES "user" ("id") ON DELETE CASCADE,
  rating          integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  message         text NOT NULL DEFAULT '' CHECK (length(message) <= 2000),
  allow_public    integer NOT NULL DEFAULT 0 CHECK (allow_public IN (0, 1)),
  permission_text text,
  created_at      text NOT NULL DEFAULT (datetime('now')),
  CHECK ((allow_public = 0 AND permission_text IS NULL) OR (allow_public = 1 AND permission_text IS NOT NULL))
);
CREATE INDEX maker_reviews_created_idx ON maker_reviews (created_at);
CREATE INDEX maker_reviews_user_idx ON maker_reviews (user_id);
