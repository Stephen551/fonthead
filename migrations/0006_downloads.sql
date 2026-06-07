-- Per-font download counter. Incremented best-effort from the font page when a
-- visitor clicks a download link, deduped per IP + font so reloads and clicking
-- more than one format do not inflate it. A denormalized column (like
-- votes_count) since it is read on the font page and bumped often. Direct CDN
-- hits and the maker's own download are not counted; the font-page click is the
-- signal we can see.
ALTER TABLE fonts ADD COLUMN downloads_count integer NOT NULL DEFAULT 0;
