// Color corpus sheet generator: renders COLOR alphabet sheets into
// e2e/fixtures/corpus-color/. One heavy system face (color separation is the
// variable under test, not letterform style); each fixture is one color
// treatment the pipeline must survive: flat multi-color, drop shadow, light
// ink, outline, gradient, low resolution. The layout mirrors gen-corpus.mjs
// (same six rows) so the geometry charset guess resolves without arming.
// Static field-failure PNGs dropped into the output directory survive
// regeneration: only the names in SHEETS are rewritten.
//
// Usage: node scripts/gen-color-corpus.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'e2e/fixtures/corpus-color';
mkdirSync(OUT, { recursive: true });

const FACE = { family: 'Arial Black', fallback: 'Arial', weight: 900 };
const ROWS = ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', 'abcdefghijklm', 'nopqrstuvwxyz', '0123456789', ".,!?:;'-&@#"];

// One entry per fixture. colors cycle per letter (flat); gradient paints a
// per-row vertical ramp; shadow is a hard offset duplicate (blur 0), the
// exact signature detectShadowMask tests for; outline is a strokeText ring.
const SHEETS = {
  'flat-2color': { kind: 'flat', colors: ['#c22a1e', '#1e4fc2'] },
  'flat-3color': { kind: 'flat', colors: ['#c22a1e', '#1e4fc2', '#159146'] },
  'flat-shadow': { kind: 'flat', colors: ['#e0341f', '#f0a51c'], shadow: { color: '#3a3a3a', dx: 7, dy: 7 } },
  'flat-light': { kind: 'flat', colors: ['#f2df6a', '#f4b8d0'] },
  'flat-outline': { kind: 'flat', colors: ['#f7a01e'], outline: { color: '#141414', width: 6 } },
  'flat-lowres': { kind: 'flat', colors: ['#c22a1e', '#1e4fc2'], rowH: 130 },
  'gradient-basic': { kind: 'gradient', gradient: ['#c41608', '#e64a0c', '#f7a01e', '#ffde5a'] },
  'gradient-shadow': { kind: 'gradient', gradient: ['#28a0c8', '#7a3fd0'], shadow: { color: '#3a3a3a', dx: 7, dy: 7 } },
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 100, height: 100 } });
await page.setContent('<body></body>');

const results = await page.evaluate(
  async ({ face, rows, sheets }) => {
    // probe: a real face measures differently from the generic fallbacks
    const probe = document.createElement('canvas').getContext('2d');
    const pw = (fam) => { probe.font = `100px '${fam}'`; return probe.measureText('mWQil10').width; };
    let family = face.family;
    if (Math.abs(pw(face.family) - pw('serif')) < 0.5 && Math.abs(pw(face.family) - pw('sans-serif')) < 0.5) {
      family = face.fallback;
    }

    const made = {};
    for (const [name, spec] of Object.entries(sheets)) {
      const W = 2200;
      const rowH = spec.rowH || 265;
      const top = 70;
      const H = top + rows.length * rowH + 40;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      rows.forEach((row, r) => {
        const rowTop = top + r * rowH;
        const baseline = rowTop + rowH * 0.62;
        const n = row.length;
        const cellW = W / n;
        let size = Math.floor(rowH * 0.55);
        ctx.font = `${face.weight} ${size}px '${family}'`;
        const widest = Math.max(...[...row].map((ch) => ctx.measureText(ch).width)) || 1;
        const maxGlyphW = cellW * 0.66;
        if (widest > maxGlyphW) {
          size = Math.max(40, Math.floor((size * maxGlyphW) / widest));
          ctx.font = `${face.weight} ${size}px '${family}'`;
        }
        // per-row gradient (letter-relative vertical ramp, like the sample sheet)
        let grad = null;
        if (spec.gradient) {
          grad = ctx.createLinearGradient(0, baseline, 0, rowTop + rowH * 0.08);
          spec.gradient.forEach((c, i) => grad.addColorStop(i / (spec.gradient.length - 1), c));
        }
        for (let i = 0; i < n; i++) {
          const x = i * cellW + cellW / 2;
          if (spec.shadow) {
            ctx.shadowColor = spec.shadow.color;
            ctx.shadowOffsetX = spec.shadow.dx;
            ctx.shadowOffsetY = spec.shadow.dy;
            ctx.shadowBlur = 0;
          }
          ctx.fillStyle = grad || spec.colors[i % spec.colors.length];
          ctx.fillText(row[i], x, baseline);
          if (spec.shadow) { ctx.shadowColor = 'transparent'; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; }
          if (spec.outline) {
            ctx.lineWidth = spec.outline.width;
            ctx.strokeStyle = spec.outline.color;
            ctx.strokeText(row[i], x, baseline);
          }
        }
      });
      made[name] = canvas.toDataURL('image/png').split(',')[1];
    }
    return { made, family };
  },
  { face: FACE, rows: ROWS, sheets: SHEETS },
);

for (const [name, b64] of Object.entries(results.made)) {
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(b64, 'base64'));
}
console.log(`written (${results.family}): ${Object.keys(results.made).join(', ')}`);
await browser.close();
