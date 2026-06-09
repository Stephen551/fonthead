import { test, expect, type Page } from '@playwright/test';

// Skip the maker onboarding modal so it does not block the maker.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('fh-maker-tour-seen', '1');
    } catch {
      /* private mode */
    }
  });
});

// The generate-to-trace charset coupling: when a sheet was generated from a
// preset prompt, the maker traces it against that preset's exact charset (the
// characters the AI was told to draw) instead of guessing from shapes. The
// punctuation row is the tell — the guesser can't read it, the armed charset can.

const FLAT6 = [
  'ABCDEFGHIJKLM',
  'NOPQRSTUVWXYZ',
  'abcdefghijklm',
  'nopqrstuvwxyz',
  '0123456789',
  '.,!?:;\'"-&@#',
];

// Render `rows` to a sheet PNG and feed it to the maker's file input.
async function feedSheet(page: Page, rows: string[]) {
  await page.evaluate(async (rows) => {
    const rowH = 150;
    const pad = 52;
    const cellW = 128;
    const cols = Math.max(...rows.map((r) => r.length));
    const c = document.createElement('canvas');
    c.width = pad * 2 + cols * cellW;
    c.height = pad * 2 + rows.length * rowH;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#000';
    ctx.font = `400 ${Math.round(rowH * 0.74)}px sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    for (let r = 0; r < rows.length; r++) {
      const y = pad + r * rowH + rowH / 2;
      for (let i = 0; i < rows[r].length; i++) ctx.fillText(rows[r][i], pad + i * cellW + cellW / 2, y);
    }
    const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b as Blob), 'image/png'));
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'sheet.png', { type: 'image/png' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, rows);
}

const charsetBox = (page: Page) => page.getByLabel('Charset, one row of characters per line');

test('selecting a generate preset arms its charset for the tracer', async ({ page }) => {
  await page.goto('/make');
  await page.getByRole('button', { name: 'flat color', exact: true }).click();
  const armed = await page.evaluate(() => localStorage.getItem('fh-gen-charset'));
  expect(armed, 'preset stashed a charset').toBeTruthy();
  expect(JSON.parse(armed!)).toEqual(FLAT6);
});

test('a generated sheet traces against the armed preset charset', async ({ page }) => {
  await page.goto('/make');
  await page.locator('input[type=file]').waitFor({ state: 'attached', timeout: 30_000 });
  // arm the flat preset charset, exactly as the generate block does on copy/select
  await page.evaluate((cs) => localStorage.setItem('fh-gen-charset', JSON.stringify(cs)), FLAT6);

  // a 6-row sheet matching that preset: the charset box should be the armed
  // charset, punctuation row and all, not a geometry guess
  await feedSheet(page, FLAT6);
  await expect(charsetBox(page)).toHaveValue(FLAT6.join('\n'), { timeout: 60_000 });
});

test('a row-count mismatch falls back to the geometry guess', async ({ page }) => {
  await page.goto('/make');
  await page.locator('input[type=file]').waitFor({ state: 'attached', timeout: 30_000 });
  await page.evaluate((cs) => localStorage.setItem('fh-gen-charset', JSON.stringify(cs)), FLAT6);

  // a 4-row letters sheet: 4 rows != the armed 6, so the armed charset is ignored
  const FOUR = ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', 'abcdefghijklm', 'nopqrstuvwxyz'];
  await feedSheet(page, FOUR);
  // the box reflects the 4-row sheet (the guess), never the armed 6-row charset
  await expect(charsetBox(page)).toHaveValue(/^[^\n]*\n[^\n]*\n[^\n]*\n[^\n]*$/, { timeout: 60_000 });
  await expect(charsetBox(page)).not.toHaveValue(FLAT6.join('\n'));
});
