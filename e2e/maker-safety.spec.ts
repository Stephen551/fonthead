import { test, expect, type Page } from '@playwright/test';

const ROWS = ['ABCD', 'EFGH', 'IJKL', 'MNOP', 'QRST', 'UVWX', 'YZ!'];
const reviewed = 'I checked that each assigned key matches its letter on the sheet.';

async function uploadCompactSheet(page: Page) {
  await page.evaluate(async (rows) => {
    const canvas = document.createElement('canvas');
    canvas.width = 800; canvas.height = rows.length * 180 + 80;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000'; ctx.font = 'bold 110px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    rows.forEach((row, ri) => [...row].forEach((char, ci) => ctx.fillText(char, 100 + ci * 190, 120 + ri * 180)));
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/png'));
    const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'compact-alphabet.png', { type: 'image/png' }));
    const input = document.querySelector<HTMLInputElement>('#sheet-file')!;
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  }, ROWS);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('fh-maker-tour-seen', '1'));
});

test('a short-row alphabet needs corrected mapping and explicit review before publish', async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  // Inject a valid but badly spaced compiled T. Safe spacing switches the
  // builder to tight advances, where this injected defect is absent.
  await page.context().route('**/assets/vendor/font-engine-builder.js*', async route => {
    const response = await route.fetch();
    const source = await response.text();
    await route.fulfill({ response, body: source + `\n(function () {
      const build = self.buildFontForStyle;
      self.buildFontForStyle = function (glyphs, opts) {
        const font = build(glyphs, opts);
        if (!opts.tightAdvance) for (let i = 0; i < font.glyphs.length; i++) {
          const g = font.glyphs.get(i);
          if (g.unicode === 84) { const b = g.getBoundingBox(); g.advanceWidth = Math.max(1, Math.round((b.x2 - b.x1) * 0.3)); }
        }
        return font;
      };
    })();` });
  });
  const stamp = Date.now();
  await page.goto('/sign-up');
  await page.locator('#name').fill('Mapping Test');
  await page.locator('#handle').fill(`mapping${stamp}`);
  await page.locator('#email').fill(`mapping-${stamp}@example.test`);
  await page.locator('#password').fill('password123');
  await page.locator('#create').click();
  await page.waitForURL('**/account');
  await page.goto('/make');
  await page.locator('#sheet-file').waitFor({ state: 'attached' });
  await uploadCompactSheet(page);
  const charset = page.getByLabel('Charset, one row of characters per line');
  await expect(charset).toHaveValue('ABCD\nEFGH\nIJKL\nMNOP\nQRST\nUVWX\nYZ□', { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'build with this mapping', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Row 2, cell 1 maps to E', { exact: true })).toBeVisible();
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByText('Review letters against the sheet', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`mapping-${width}.png`) });
  }
  await charset.fill(ROWS.join('\n'));
  await page.getByRole('button', { name: 'build with this mapping', exact: true }).click();
  await expect(page.getByRole('button', { name: 'download otf', exact: true })).toBeVisible({ timeout: 60_000 });
  const safe = page.getByRole('button', { name: 'use safe spacing', exact: true });
  const publish = page.getByRole('button', { name: /^publish/ });
  await expect(safe).toBeVisible();
  await page.getByRole('checkbox', { name: reviewed }).check();
  await expect(publish).toBeDisabled();
  await safe.click();
  await expect(safe).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'download otf', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: reviewed })).not.toBeChecked();
  await expect(publish).toBeDisabled();
  await page.getByRole('checkbox', { name: reviewed }).check();
  await expect(publish).toBeEnabled();
  // A mapping edit invalidates the old review and prevents a stale font publish.
  await charset.fill('ABCD\nEFGH\nIJKL\nMNOP\nQRST\nUVWX\nYZ?');
  await expect(page.getByRole('checkbox', { name: reviewed })).not.toBeChecked();
  await expect(publish).toBeDisabled();
  await charset.fill(ROWS.join('\n'));
  await page.getByRole('checkbox', { name: reviewed }).check();
  await expect(publish).toBeEnabled();
  await publish.click();
  await expect(page.getByRole('link', { name: /view the font page/ })).toBeVisible({ timeout: 30_000 });
});
