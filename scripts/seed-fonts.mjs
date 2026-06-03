// fonthead.dev — seed generator for the launch wall (stand-in phase).
//
// HONESTY NOTE (see SEED.md): these twelve are open-licensed Google Fonts
// standing in for Stephen's house fonts until the real files land in R2.
// Everything measured here is REAL: the woff2 file, its byte size, and the
// glyph count (read with fontkit). Names are the true font family names,
// credited to their real OFL designers (sourced from each family's OFL.txt
// copyright line, stored verbatim in meta.ofl). Vote counts start at 0 — no
// fabricated engagement. Two specimens carry a CSS gradient/flat treatment
// for wall colour; that is presentation styling, not a real colour font, so
// they carry no category badge. Only the genuinely variable faces (Fraunces,
// Outfit) get the "variable" badge.

import * as fontkitNs from 'fontkit';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const open = fontkitNs.openSync || (fontkitNs.default && fontkitNs.default.openSync);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STAGE = join(ROOT, 'fonts-staging');

// id, display name (real family), designer handle, specimen word, the staged
// woff2 (relative to fonts-staging), treatment, optional variation settings,
// default card size, italic, visibility.
const FONTS = [
  { id: 'monoton',          name: 'Monoton',          designer: 'Vernon Adams',     word: 'Replay',   dir: 'monoton',          file: 'monoton-400.woff2',          treat: 'normal',   size: 96,  italic: false, vis: 'public' },
  { id: 'anton',            name: 'Anton',            designer: 'Vernon Adams',     word: 'Bakery',   dir: 'anton',            file: 'anton-400.woff2',            treat: 'gradient', grad: 'linear-gradient(96deg,#ff6a2c 4%,#ff2e6e 96%)', size: 104, italic: false, vis: 'public' },
  { id: 'abril-fatface',    name: 'Abril Fatface',    designer: 'TypeTogether',     word: 'Verona',   dir: 'abril-fatface',    file: 'abril-fatface-400.woff2',    treat: 'normal',   size: 92,  italic: false, vis: 'public' },
  { id: 'vt323',            name: 'VT323',            designer: 'Peter Hull',       word: 'uptime',   dir: 'vt323',            file: 'vt323-400.woff2',            treat: 'normal',   size: 104, italic: false, vis: 'public' },
  { id: 'pacifico',         name: 'Pacifico',         designer: 'Vernon Adams',     word: 'Saturday', dir: 'pacifico',         file: 'pacifico-400.woff2',         treat: 'normal',   size: 80,  italic: false, vis: 'public' },
  { id: 'fraunces',         name: 'Fraunces',         designer: 'Undercase Type',   word: 'Weight',   dir: 'fraunces',         file: 'fraunces-italic.woff2',      treat: 'variable', varset: '"opsz" 144, "wght" 600', size: 92, italic: true, vis: 'public' },
  { id: 'silkscreen',       name: 'Silkscreen',       designer: 'Jason Kottke',     word: 'PIXEL',    dir: 'silkscreen',       file: 'silkscreen-400.woff2',       treat: 'normal',   size: 64,  italic: false, vis: 'public' },
  { id: 'dm-serif-display', name: 'DM Serif Display', designer: 'Colophon Foundry', word: 'Marigold', dir: 'dm-serif-display', file: 'dm-serif-display-400.woff2', treat: 'normal',   size: 84,  italic: false, vis: 'public' },
  { id: 'outfit',           name: 'Outfit',           designer: 'McKL',             word: 'Plotter',  dir: 'outfit',           file: 'outfit.woff2',               treat: 'variable', varset: '"wght" 600', size: 84, italic: false, vis: 'public' },
  { id: 'spectral',         name: 'Spectral Italic',  designer: 'Production Type',  word: 'Letters',  dir: 'spectral',         file: 'spectral-italic.woff2',      treat: 'normal',   size: 84,  italic: true,  vis: 'public' },
  { id: 'bungee',           name: 'Bungee',           designer: 'David Jonathan Ross', word: 'STICKER', dir: 'bungee',         file: 'bungee-400.woff2',           treat: 'flat',     flat: '#1f6feb', size: 64, italic: false, vis: 'public' },
  { id: 'gloria-hallelujah',name: 'Gloria Hallelujah',designer: 'Kimberly Geswein', word: 'Recess',   dir: 'gloria-hallelujah',file: 'gloria-hallelujah-400.woff2',treat: 'normal',   size: 64,  italic: false, vis: 'private' },
];

const oflLine = (dir) => {
  try {
    const txt = readFileSync(join(STAGE, dir, 'OFL.txt'), 'utf-8');
    const m = txt.split(/\r?\n/).find((l) => /copyright/i.test(l));
    return (m || '').trim();
  } catch { return ''; }
};

const sql = (v) => v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;

const rows = [];
const manifest = [];
let totalBytes = 0;

for (const f of FONTS) {
  const path = join(STAGE, f.dir, f.file);
  const bytes = statSync(path).size;
  const font = open(path);
  const glyphs = font.numGlyphs;
  totalBytes += bytes;

  const badge = f.treat === 'variable' ? 'variable' : null;
  const key = `fonts/${f.id}.woff2`;
  const meta = {
    treat: f.treat,
    ...(f.grad ? { grad: f.grad } : {}),
    ...(f.flat ? { flat: f.flat } : {}),
    ...(f.varset ? { varset: f.varset } : {}),
    size: f.size,
    italic: f.italic,
    badge,
    family: f.name,
    designer: f.designer,
    ofl: oflLine(f.dir),
    standIn: true,
  };

  manifest.push({ id: f.id, key, file: path });
  rows.push(
    `INSERT INTO fonts (id, owner_id, name, maker_handle, specimen_word, meta, visibility, glyph_count, woff2_key, woff2_size, votes_count, created_at) VALUES (` +
    `${sql(f.id)}, NULL, ${sql(f.name)}, ${sql(f.designer)}, ${sql(f.word)}, ${sql(JSON.stringify(meta))}, ${sql(f.vis)}, ${glyphs}, ${sql(key)}, ${bytes}, 0, datetime('now'));`
  );
  console.log(`${f.id.padEnd(18)} glyphs=${String(glyphs).padStart(4)}  ${(bytes/1024).toFixed(1).padStart(6)} KB  ${f.designer}`);
}

const out =
  `-- generated by scripts/seed-fonts.mjs — do not edit by hand\n` +
  `DELETE FROM fonts;\n` +
  rows.join('\n') + '\n';

writeFileSync(join(ROOT, 'scripts', 'seed.generated.sql'), out);
writeFileSync(join(ROOT, 'scripts', 'fonts-manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`\n${FONTS.length} fonts · ${(totalBytes/1024).toFixed(1)} KB total`);
console.log('wrote scripts/seed.generated.sql and scripts/fonts-manifest.json');
