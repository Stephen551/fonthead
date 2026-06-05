-- Add Stephen's real fonts (built with the maker) to the library. These are NOT
-- stand-ins: standIn:false, credited to the maker. Flames and Slime are colour
-- (COLR/CPAL, colour badge); Peak is monochrome (no badge).
-- Re-runnable: clears any prior rows for these ids first.
DELETE FROM fonts WHERE id IN ('ac-flames', 'ac-slime', 'ac-peak', 'ac-mark', 'soft-and-sweet');

INSERT INTO fonts (id, owner_id, name, maker_handle, specimen_word, meta, visibility, glyph_count, otf_key, ttf_key, woff2_key, otf_size, ttf_size, woff2_size, votes_count, created_at)
VALUES (
  'ac-flames', NULL, 'AC Flames', 'a-c-meridian', 'Flames',
  '{"treat":"normal","size":88,"italic":false,"badge":"color","family":"AC Flames","designer":"a-c-meridian","ofl":"","standIn":false,"builtWith":"fonthead maker","colorMode":"flat"}',
  'public', 52, 'fonts/ac-flames.otf', NULL, 'fonts/ac-flames.woff2', 364748, NULL, 158964, 0, datetime('now')
);

INSERT INTO fonts (id, owner_id, name, maker_handle, specimen_word, meta, visibility, glyph_count, otf_key, ttf_key, woff2_key, otf_size, ttf_size, woff2_size, votes_count, created_at)
VALUES (
  'ac-slime', NULL, 'AC Slime', 'a-c-meridian', 'Slime',
  '{"treat":"normal","size":88,"italic":false,"badge":"color","family":"AC Slime","designer":"a-c-meridian","ofl":"","standIn":false,"builtWith":"fonthead maker","colorMode":"flat"}',
  'public', 73, 'fonts/ac-slime.otf', NULL, 'fonts/ac-slime.woff2', 217208, NULL, 132736, 0, datetime('now')
);

INSERT INTO fonts (id, owner_id, name, maker_handle, specimen_word, meta, visibility, glyph_count, otf_key, ttf_key, woff2_key, otf_size, ttf_size, woff2_size, votes_count, created_at)
VALUES (
  'ac-peak', NULL, 'AC Peak', 'a-c-meridian', 'Peak',
  '{"treat":"normal","size":88,"italic":false,"badge":null,"family":"AC Peak","designer":"a-c-meridian","ofl":"","standIn":false,"builtWith":"fonthead maker"}',
  'public', 92, 'fonts/ac-peak.otf', NULL, 'fonts/ac-peak.woff2', 63648, NULL, 40380, 0, datetime('now')
);

-- AC Mark: monochrome (otf+ttf+woff2), no badge. 93 glyphs, fontTools checkChecksums=2 passes.
INSERT INTO fonts (id, owner_id, name, maker_handle, specimen_word, meta, visibility, glyph_count, otf_key, ttf_key, woff2_key, otf_size, ttf_size, woff2_size, votes_count, created_at)
VALUES (
  'ac-mark', NULL, 'AC Mark', 'a-c-meridian', 'Mark',
  '{"treat":"normal","size":88,"italic":false,"badge":null,"family":"AC Mark","designer":"a-c-meridian","ofl":"","standIn":false,"builtWith":"fonthead maker"}',
  'public', 93, 'fonts/ac-mark.otf', 'fonts/ac-mark.ttf', 'fonts/ac-mark.woff2', 28296, 34612, 19904, 0, datetime('now')
);

-- Soft and Sweet: monochrome (otf+woff2, no ttf provided), no badge. 93 glyphs, fontTools checkChecksums=2 passes.
INSERT INTO fonts (id, owner_id, name, maker_handle, specimen_word, meta, visibility, glyph_count, otf_key, ttf_key, woff2_key, otf_size, ttf_size, woff2_size, votes_count, created_at)
VALUES (
  'soft-and-sweet', NULL, 'Soft and Sweet', 'a-c-meridian', 'Sweet',
  '{"treat":"normal","size":88,"italic":false,"badge":null,"family":"Soft and Sweet","designer":"a-c-meridian","ofl":"","standIn":false,"builtWith":"fonthead maker"}',
  'public', 93, 'fonts/soft-and-sweet.otf', NULL, 'fonts/soft-and-sweet.woff2', 24252, NULL, 16800, 0, datetime('now')
);
