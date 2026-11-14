// One-off backfill for ADR 0085: strip EXIF/XMP/text metadata from avatars that
// were stored before the upload path started doing it.
//
// DRY RUN BY DEFAULT. It lists every avatar key on the user table, downloads
// each object, runs it through the same stripImageMetadata helper the upload
// path uses, and prints what it would change. Nothing is written unless you
// pass --write.
//
//   node scripts/strip-avatar-metadata.mjs            # dry run, production
//   node scripts/strip-avatar-metadata.mjs --local    # dry run, local wrangler state
//   node scripts/strip-avatar-metadata.mjs --write    # rewrite changed avatars
//
// Needs Node 22.18+ (it imports the TypeScript helper directly) and a wrangler
// login for the remote run. Downloads go to a temp folder that is removed at
// the end.
//
// A JPEG whose EXIF says it should be rotated loses that instruction when the
// EXIF goes, so it would show sideways. Those are reported and never rewritten;
// the member can re-upload (the browser redraw bakes the rotation in).
// Avatars are edge-cached for up to a day, so a rewritten one can keep showing
// the old bytes from the cache until then.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripImageMetadata } from '../src/lib/image-metadata.ts';

const BUCKET = 'fonthead-fonts';
const args = new Set(process.argv.slice(2));
const write = args.has('--write');
const where = args.has('--local') ? '--local' : '--remote';
const TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

const wrangler = (...a) =>
  execFileSync('npx', ['wrangler', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** EXIF Orientation (tag 0x0112) from a JPEG's APP1 Exif block, or 1 if none. */
function jpegOrientation(u) {
  let i = 2;
  while (i + 4 <= u.length && u[i] === 0xff) {
    const m = u[i + 1];
    if (m === 0xda || m === 0xd9) break;
    const len = (u[i + 2] << 8) | u[i + 3];
    const s = i + 4;
    if (m === 0xe1 && String.fromCharCode(...u.subarray(s, s + 6)) === 'Exif\0\0') {
      const t = s + 6;
      const le = u[t] === 0x49;
      const v = new DataView(u.buffer, u.byteOffset + t, Math.max(0, len - 8));
      try {
        const ifd = v.getUint32(4, le);
        const n = v.getUint16(ifd, le);
        for (let k = 0; k < n; k++) {
          const e = ifd + 2 + k * 12;
          if (v.getUint16(e, le) === 0x0112) return v.getUint16(e + 8, le);
        }
      } catch {
        return 1;
      }
    }
    i = s + len - 2;
  }
  return 1;
}

// wrangler can print a notice line before the JSON, so parse from the first '['.
const out = wrangler('d1', 'execute', 'DB', where, '--json', '--command',
  `SELECT image FROM "user" WHERE image LIKE 'avatars/%'`);
const rows = JSON.parse(out.slice(out.indexOf('[')))[0].results;
const keys = rows.map((r) => r.image).filter((k) => /^avatars\/[\w-]+\.(png|jpg|webp)$/.test(k));

const dir = mkdtempSync(join(tmpdir(), 'fh-avatars-'));
const tally = { clean: 0, change: 0, rotated: 0, unreadable: 0, written: 0 };
try {
  for (const key of keys) {
    const ext = key.slice(key.lastIndexOf('.') + 1);
    const file = join(dir, key.replace('/', '_'));
    wrangler('r2', 'object', 'get', `${BUCKET}/${key}`, where, '--file', file);
    const bytes = new Uint8Array(readFileSync(file));
    let result;
    try {
      result = stripImageMetadata(bytes, ext);
    } catch (e) {
      tally.unreadable++;
      console.log(`${key}: could not parse (${e.message}), left alone`);
      continue;
    }
    if (result.removed === 0) {
      tally.clean++;
      console.log(`${key}: already clean`);
      continue;
    }
    const orient = ext === 'jpg' ? jpegOrientation(bytes) : 1;
    if (orient !== 1) {
      tally.rotated++;
      console.log(`${key}: ${result.removed} bytes of metadata, but EXIF rotation ${orient}; left alone (would show sideways)`);
      continue;
    }
    tally.change++;
    console.log(`${key}: would remove ${result.removed} of ${bytes.length} bytes`);
    if (write) {
      writeFileSync(file, result.bytes);
      wrangler('r2', 'object', 'put', `${BUCKET}/${key}`, where, '--file', file, '--content-type', TYPES[ext]);
      tally.written++;
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(
  `\n${keys.length} avatars: ${tally.clean} already clean, ${tally.change} with metadata to strip, ` +
    `${tally.rotated} rotated (skipped), ${tally.unreadable} unreadable (skipped).`,
);
console.log(write ? `Rewrote ${tally.written}.` : 'Dry run: nothing was written. Pass --write to rewrite.');
