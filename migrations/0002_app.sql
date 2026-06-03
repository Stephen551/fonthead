-- fonthead domain tables: the library, votes, favorites, and the nightly
-- featured set. Mirrors the build brief's data model. `meta` is JSON text
-- carrying the specimen treatment (treat, grad, flat, size, italic, badge,
-- designer). File keys point at objects in the R2 FONTS bucket.

CREATE TABLE fonts (
  id            text PRIMARY KEY NOT NULL,
  owner_id      text REFERENCES "user" ("id") ON DELETE SET NULL,
  name          text NOT NULL,
  maker_handle  text NOT NULL,
  specimen_word text NOT NULL,
  meta          text NOT NULL DEFAULT '{}',
  visibility    text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  glyph_count   integer,
  otf_key       text,
  ttf_key       text,
  woff2_key     text,
  otf_size      integer,
  ttf_size      integer,
  woff2_size    integer,
  votes_count   integer NOT NULL DEFAULT 0,
  created_at    text NOT NULL DEFAULT (datetime('now'))
);
-- popular sort + wall read: public fonts by votes then recency
CREATE INDEX fonts_public_rank_idx ON fonts (visibility, votes_count DESC, created_at DESC);
CREATE INDEX fonts_owner_idx ON fonts (owner_id);

CREATE TABLE votes (
  user_id    text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  font_id    text NOT NULL REFERENCES fonts (id) ON DELETE CASCADE,
  created_at text NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, font_id)
);
CREATE INDEX votes_font_idx ON votes (font_id);
-- the daily feature counts yesterday's votes
CREATE INDEX votes_created_idx ON votes (created_at);

CREATE TABLE favorites (
  user_id    text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  font_id    text NOT NULL REFERENCES fonts (id) ON DELETE CASCADE,
  created_at text NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, font_id)
);
CREATE INDEX favorites_user_idx ON favorites (user_id);

CREATE TABLE featured (
  date     text PRIMARY KEY NOT NULL,
  font_ids text NOT NULL
);
