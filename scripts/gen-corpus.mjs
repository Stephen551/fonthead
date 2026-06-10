// Corpus sheet generator: renders tracer-compatible alphabet sheets from
// system faces into e2e/fixtures/corpus/. Each face that exists on this
// machine becomes one committed PNG fixture spanning a typographic class
// (script, calligraphic, marker, blackletter, serif, condensed, mono...).
// The layout mirrors the printable grid / charset guess: 6 rows of
// A-M / N-Z / a-m / n-z / digits / punctuation, white paper, dark ink.
//
// Usage: node scripts/gen-corpus.mjs   (rerun to regenerate; commits decide)
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'e2e/fixtures/corpus';
mkdirSync(OUT, { recursive: true });

// name -> { family, style?, weight? }. Probed at runtime; missing faces skip.
const FACES = {
  'script-gabriola': { family: 'Gabriola' },
  'script-segoe': { family: 'Segoe Script' },
  'script-corsiva': { family: 'Monotype Corsiva' },
  'script-brush': { family: 'Brush Script MT' },
  'marker-inkfree': { family: 'Ink Free' },
  'hand-segoeprint': { family: 'Segoe Print' },
  'rounded-comic': { family: 'Comic Sans MS' },
  'serif-georgia': { family: 'Georgia' },
  'serif-italic-times': { family: 'Times New Roman', style: 'italic' },
  'blackletter-oldenglish': { family: 'Old English Text MT' },
  'condensed-impact': { family: 'Impact' },
  'narrow-arial': { family: 'Arial Narrow' },
  'mono-consolas': { family: 'Consolas' },
  'light-segoe': { family: 'Segoe UI Light', weight: 300 },
};

const ROWS = ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', 'abcdefghijklm', 'nopqrstuvwxyz', '0123456789', ".,!?:;'-&@#"];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 100, height: 100 } });
await page.setContent('<body></body>');

const results = await page.evaluate(
  async ({ faces, rows }) => {
    const made = {};
    const skipped = [];
    for (const [name, spec] of Object.entries(faces)) {
      // probe: a real face measures differently from the generic fallback
      const probeCanvas = document.createElement('canvas');
      const pctx = probeCanvas.getContext('2d');
      const probeStr = 'mWQil10';
      pctx.font = `100px '${spec.family}'`;
      const a = pctx.measureText(probeStr).width;
      pctx.font = `100px serif`;
      const b = pctx.measureText(probeStr).width;
      pctx.font = `100px sans-serif`;
      const c = pctx.measureText(probeStr).width;
      if (Math.abs(a - b) < 0.5 || Math.abs(a - c) < 0.5) {
        // suspicious: could be a fallback; require it to differ from both
        if (Math.abs(a - b) < 0.5 && Math.abs(a - c) < 0.5) {
          skipped.push(name);
          continue;
        }
      }

      const W = 2200;
      const rowH = 265;
      const top = 70;
      const H = top + rows.length * rowH + 40;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#000000';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const style = spec.style || 'normal';
      const weight = spec.weight || 700;
      rows.forEach((row, r) => {
        const baseline = top + r * rowH + rowH * 0.62;
        const n = row.length;
        const cellW = W / n;
        // size the row so its widest glyph leaves a clear slicing gap
        let size = 150;
        ctx.font = `${style} ${weight} ${size}px '${spec.family}'`;
        const widest = Math.max(...[...row].map((ch) => ctx.measureText(ch).width)) || 1;
        const maxGlyphW = cellW * 0.68;
        if (widest > maxGlyphW) {
          size = Math.max(48, Math.floor((size * maxGlyphW) / widest));
          ctx.font = `${style} ${weight} ${size}px '${spec.family}'`;
        }
        for (let i = 0; i < n; i++) {
          ctx.fillText(row[i], i * cellW + cellW / 2, baseline);
        }
      });
      made[name] = canvas.toDataURL('image/png').split(',')[1];
    }
    return { made, skipped };
  },
  { faces: FACES, rows: ROWS },
);

for (const [name, b64] of Object.entries(results.made)) {
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(b64, 'base64'));
}
console.log(`written: ${Object.keys(results.made).join(', ')}`);
if (results.skipped.length) console.log(`skipped (face not installed): ${results.skipped.join(', ')}`);
await browser.close();
