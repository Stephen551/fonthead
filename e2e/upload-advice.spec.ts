import { test, expect, type Page } from '@playwright/test';

// Upload guidance (ADR 0084): a "what works" hint with a sample sheet above the
// drop area, and plain advice beside a loaded sheet that looks like a
// screenshot, is very small, or has letters that touch. The advice never holds
// the build.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('fh-maker-tour-seen', '1');
    } catch {
      /* private mode */
    }
  });
});

const charsetBox = (page: Page) => page.getByLabel('Charset, one row of characters per line');
const advice = (page: Page) => page.getByRole('status', { name: 'Sheet advice' });

// Render rows of letters and feed them to the main file input.
// `chrome` adds app-style flat gray bars across the top and bottom;
// `gap` is the space between letters (a negative gap makes them touch).
async function feedSheet(page: Page, rows: string[], opts: { width?: number; chrome?: boolean; gap?: number } = {}) {
  await page.evaluate(async ({ rows, opts }) => {
    const rowH = 150;
    const pad = 52;
    const size = Math.round(rowH * 0.74);
    const c = document.createElement('canvas');
    const ctx0 = c.getContext('2d')!;
    ctx0.font = `700 ${size}px sans-serif`;
    const gap = opts.gap ?? 40;
    const rowW = (r: string) => [...r].reduce((w, ch) => w + ctx0.measureText(ch).width + gap, -gap);
    const bar = opts.chrome ? 120 : 0;
    c.width = opts.width ?? pad * 2 + Math.max(...rows.map(rowW));
    c.height = pad * 2 + rows.length * rowH + bar * 2;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    if (opts.chrome) {
      ctx.fillStyle = '#dadce0';
      ctx.fillRect(0, 0, c.width, bar);
      ctx.fillStyle = '#3c4043';
      ctx.fillRect(0, c.height - bar, c.width, bar);
    }
    ctx.fillStyle = '#000';
    ctx.font = `700 ${size}px sans-serif`;
    ctx.textBaseline = 'middle';
    for (let r = 0; r < rows.length; r++) {
      const y = bar + pad + r * rowH + rowH / 2;
      let x = pad;
      for (const ch of rows[r]) {
        ctx.fillText(ch, x, y);
        x += ctx.measureText(ch).width + gap;
      }
    }
    const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b as Blob), 'image/png'));
    const input = document.querySelector('#sheet-file') as HTMLInputElement;
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'sheet.png', { type: 'image/png' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { rows, opts });
}

test('the maker shows what kind of sheet works before any upload', async ({ page }) => {
  await page.goto('/make');
  const hint = page.getByRole('note', { name: 'What kind of sheet works' });
  await expect(hint).toContainText('dark ink on plain white paper');
  await expect(hint.getByRole('img', { name: /^Sample sheet:/ })).toBeVisible({ timeout: 30_000 });
  await expect(advice(page)).toHaveCount(0);
});

test('a screenshot gets plain advice and still builds', async ({ page }) => {
  await page.goto('/make');
  await page.locator('#sheet-file').waitFor({ state: 'attached', timeout: 30_000 });
  await feedSheet(page, ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ'], { chrome: true });
  await expect(advice(page)).toContainText('This looks like a screenshot.', { timeout: 60_000 });
  // advice only: the build carries on to a result
  await expect(page.getByRole('button', { name: 'download otf' })).toBeVisible({ timeout: 90_000 });
});

test('touching letters are named by row', async ({ page }) => {
  await page.goto('/make');
  await page.locator('#sheet-file').waitFor({ state: 'attached', timeout: 30_000 });
  // three characters drawn so they overlap: one shape for "ABC"
  await feedSheet(page, ['ABC'], { gap: -30 });
  await expect(charsetBox(page)).not.toHaveValue('', { timeout: 60_000 });
  await charsetBox(page).fill('ABC');
  await expect(advice(page)).toContainText('Row 1 has 3 characters in the charset, but the maker only found 1 shape there.', { timeout: 30_000 });
});

test('a clean sheet gets no advice', async ({ page }) => {
  await page.goto('/make');
  await page.locator('#sheet-file').waitFor({ state: 'attached', timeout: 30_000 });
  await feedSheet(page, ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ']);
  await expect(charsetBox(page)).toHaveValue('ABCDEFGHIJKLM\nNOPQRSTUVWXYZ', { timeout: 60_000 });
  await expect(advice(page)).toHaveCount(0);
});
