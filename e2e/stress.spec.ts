import { test, expect, type Page } from '@playwright/test';
import { verifySfntChecksums } from '../src/lib/sfnt';
import { isOtf } from '../src/lib/fontsig';

// Flag 3: the honest behavior matrix. Render adversarial sheets in-browser
// (low resolution, touching letters, thin strokes, ornate serifs, punctuation),
// feed each to the real maker, and record glyph coverage + validity. The hard
// floor is that EVERY build must still produce a valid font; coverage is the
// recorded metric that says how much of the sheet survived. Logged so the answer
// to "how does it handle X" is measured, not guessed.

const ALPHA4 = ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', 'abcdefghijklm', 'nopqrstuvwxyz'];

type Result = { built: number; expected: number; rows: number; valid: boolean; otfLen: number };

// Render a sheet to a PNG data URL in the page, feed it to the maker as a File,
// build mono, and return the measured result.
async function buildSheet(
  page: Page,
  rows: string[],
  opts: { rowH: number; font: string; weight?: string; tracking?: number },
): Promise<Result> {
  return page.evaluate(
    async ({ rows, opts }) => {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      // draw the sheet
      const rowH = opts.rowH;
      const pad = Math.round(rowH * 0.35);
      const cellW = Math.round(rowH * 0.85);
      const measure = document.createElement('canvas').getContext('2d')!;
      const font = `${opts.weight || '400'} ${Math.round(rowH * 0.74)}px ${opts.font}`;
      measure.font = font;
      const cols = Math.max(...rows.map((r) => r.length));
      const W = pad * 2 + cols * cellW;
      const H = pad * 2 + rows.length * rowH;
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#000';
      ctx.font = font;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      for (let r = 0; r < rows.length; r++) {
        const y = pad + r * rowH + rowH / 2;
        const chars = rows[r];
        for (let i = 0; i < chars.length; i++) {
          const x = pad + i * cellW + cellW / 2 + (opts.tracking || 0) * i;
          ctx.fillText(chars[i], x, y);
        }
      }
      const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b as Blob), 'image/png'));
      const file = new File([blob], 'stress.png', { type: 'image/png' });

      // feed it (mono is the default kind)
      (window as { __lastBuild?: unknown }).__lastBuild = undefined;
      const input = document.querySelector('input[type=file]') as HTMLInputElement;
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));

      // settle: __lastBuild set, the "working…" readout cleared, AND the otf
      // download control rendered. __lastBuild is set right after React's
      // setResult, so the download button can lag the flag by a render; clicking
      // before it exists is the flake that read zero bytes (worst on the heaviest
      // faces, where the build and re-render take longest).
      const findDl = () =>
        Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'download otf');
      let waited = 0;
      while (waited < 80000) {
        await sleep(300);
        waited += 300;
        const lb = (window as { __lastBuild?: { glyphCount: number } }).__lastBuild;
        if (lb && findDl() && !/working…/.test(document.body.innerText)) break;
      }
      const lb = (window as { __lastBuild?: { glyphCount: number } }).__lastBuild;
      const expected = rows.join('').length;
      // capture the otf bytes by intercepting the download blob
      let b64 = '';
      let blob2: Blob | null = null;
      const orig = URL.createObjectURL;
      (URL as { createObjectURL: typeof URL.createObjectURL }).createObjectURL = function (o: Blob | MediaSource) {
        if (o instanceof Blob) blob2 = o;
        return orig.call(URL, o as Blob);
      };
      findDl()?.click();
      // poll for the captured blob rather than a fixed wait: a slow re-render or
      // serialization of the largest faces intermittently missed a fixed 150ms.
      let dwait = 0;
      while (!blob2 && dwait < 10000) {
        await sleep(100);
        dwait += 100;
      }
      (URL as { createObjectURL: typeof URL.createObjectURL }).createObjectURL = orig;
      if (blob2) {
        const buf = new Uint8Array(await (blob2 as Blob).arrayBuffer());
        let bin = '';
        for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + 8192)));
        b64 = btoa(bin);
      }
      return { built: lb?.glyphCount ?? 0, expected, b64 };
    },
    { rows, opts },
  ).then((raw) => {
    const otf = raw.b64 ? new Uint8Array(Buffer.from(raw.b64, 'base64')) : new Uint8Array();
    const valid = otf.length > 0 && isOtf(otf) && verifySfntChecksums(otf).ok;
    const r: Result = { built: raw.built, expected: raw.expected, rows: 0, valid, otfLen: otf.length };
    return r;
  });
}

const CONDITIONS: { name: string; rows: string[]; opts: { rowH: number; font: string; weight?: string; tracking?: number } }[] = [
  { name: 'baseline sans 150px', rows: ALPHA4, opts: { rowH: 150, font: 'sans-serif' } },
  { name: 'ornate serif 150px', rows: ALPHA4, opts: { rowH: 150, font: 'Georgia, serif' } },
  { name: 'thin weight 150px', rows: ALPHA4, opts: { rowH: 150, font: 'sans-serif', weight: '100' } },
  { name: 'low resolution 70px', rows: ALPHA4, opts: { rowH: 70, font: 'sans-serif' } },
  { name: 'touching letters', rows: ALPHA4, opts: { rowH: 150, font: 'sans-serif', tracking: -22 } },
  { name: 'punctuation heavy', rows: ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', '0123456789', "!?@#$%^&*()-+="], opts: { rowH: 150, font: 'sans-serif' } },
];

test.describe('tracing stress matrix', () => {
  for (const cond of CONDITIONS) {
    test(cond.name, async ({ page }) => {
      await page.goto('/make');
      // wait for the maker island to hydrate its file input before feeding it,
      // else the evaluate sets .files on null (a hydration race, not a build bug)
      await page.locator('input[type=file]').waitFor({ state: 'attached', timeout: 30_000 });
      const r = await buildSheet(page, cond.rows, cond.opts);
      const cov = r.expected ? Math.round((r.built / r.expected) * 100) : 0;
      // eslint-disable-next-line no-console
      console.log(`STRESS | ${cond.name.padEnd(22)} | built ${r.built}/${r.expected} (${cov}%) | valid=${r.valid} | otf ${r.otfLen}`);
      // hard floor: whatever it builds must be a valid font
      expect(r.valid, 'produces a valid font').toBe(true);
      // regression gate: every condition currently builds 100%, hold near that
      expect(cov, 'glyph coverage').toBeGreaterThanOrEqual(90);
    });
  }
});
