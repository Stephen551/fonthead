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

// Render `rows` to a sheet PNG (in `fill`, default black) and feed it to the
// maker's file input. `opts.bridge` draws a thin vertical strip in the left
// margin spanning every row, in the fill color: it stands in for a drop shadow
// tail that leaves a little ink in the inter-row gaps, so the zero-ink row
// detector merges the rows into one. The shadow-aware probe must still recover
// them. `opts.fill2` (a second color anywhere off the letters) makes the maker
// treat the drop as a multi-color sheet.
async function feedSheet(page: Page, rows: string[], fill = '#000', opts: { bridge?: boolean } = {}) {
  await page.evaluate(async ({ rows, fill, opts }) => {
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
    ctx.fillStyle = fill;
    ctx.font = `400 ${Math.round(rowH * 0.74)}px sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    for (let r = 0; r < rows.length; r++) {
      const y = pad + r * rowH + rowH / 2;
      for (let i = 0; i < rows[r].length; i++) ctx.fillText(rows[r][i], pad + i * cellW + cellW / 2, y);
    }
    if (opts.bridge) {
      // a few-px column down the left margin, touching every row: nonzero ink in
      // the gaps so the zero-ink detector can't split them
      ctx.fillStyle = fill;
      ctx.fillRect(8, pad, 4, rows.length * rowH);
    }
    const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b as Blob), 'image/png'));
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'sheet.png', { type: 'image/png' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { rows, fill, opts });
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

test('a color sheet detects all its rows (yellow letters no longer vanish)', async ({ page }) => {
  await page.goto('/make');
  await page.locator('input[type=file]').waitFor({ state: 'attached', timeout: 30_000 });
  // build as a flat-color font, so the maker treats the drop as a color sheet
  await page.getByRole('button', { name: 'color · flat', exact: true }).click();

  // a 5-row sheet with YELLOW letters: under the old mono cutoff (128) the yellow
  // read as background and vanished, so the rows went uncounted. It must now find
  // all five. (Uniform-height rows avoid the separate punctuation-split quirk.)
  const FIVE = ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', 'abcdefghijklm', 'nopqrstuvwxyz', '0123456789'];
  await feedSheet(page, FIVE, '#FFD400');
  await expect
    .poll(async () => (await charsetBox(page).inputValue()).split('\n').filter((l) => l.length).length, {
      timeout: 90_000,
    })
    .toBe(5);
});

test('a color sheet uses its armed preset charset even when the probe disagrees', async ({ page }) => {
  await page.goto('/make');
  await page.locator('input[type=file]').waitFor({ state: 'attached', timeout: 30_000 });
  await page.getByRole('button', { name: 'color · flat', exact: true }).click();
  // arm the flat 6-row preset charset, as the generate block does
  const FLAT6 = ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', 'abcdefghijklm', 'nopqrstuvwxyz', '0123456789', '.,!?:;\'"-&@#'];
  await page.evaluate((cs) => localStorage.setItem('fh-gen-charset', JSON.stringify(cs)), FLAT6);
  // feed a sheet whose free row count differs (5 rows): a color sheet must still
  // use the armed 6-row charset, because drop shadows make the gap probe
  // unreliable and the color build recovers the rows from the expected count.
  await feedSheet(page, ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', 'abcdefghijklm', 'nopqrstuvwxyz', '0123456789'], '#FFD400');
  await expect(charsetBox(page)).toHaveValue(FLAT6.join('\n'), { timeout: 90_000 });
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

test('a shadow-bridged color sheet guesses every row with no charset armed', async ({ page }) => {
  await page.goto('/make');
  await page.locator('input[type=file]').waitFor({ state: 'attached', timeout: 30_000 });
  await page.getByRole('button', { name: 'color · flat', exact: true }).click();

  // The bug this guards: no preset armed, the maker guesses the charset from the
  // sheet. A drop shadow leaves a little ink in the inter-row gaps (the `bridge`
  // strip), so the plain zero-ink row detector collapses every row into one and
  // the guess maps the whole alphabet onto a single A-M row, so only A-M builds.
  // The shadow-aware probe must recover all six rows, including the lighter
  // punctuation row (which a global threshold would have dropped), with the
  // alphabet halves and the digit row landing exactly.
  const SIX = ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', 'abcdefghijklm', 'nopqrstuvwxyz', '0123456789', ".,!?:;'\"-&@#"];
  await feedSheet(page, SIX, '#FFD400', { bridge: true });
  await expect
    .poll(async () => (await charsetBox(page).inputValue()).split('\n').filter((l) => l.length).length, {
      timeout: 90_000,
    })
    .toBe(6);
  // the alphabet halves and digits land exactly; the punctuation row is a best guess
  await expect(charsetBox(page)).toHaveValue(
    /^ABCDEFGHIJKLM\nNOPQRSTUVWXYZ\nabcdefghijklm\nnopqrstuvwxyz\n0123456789\n.+$/,
  );
});
