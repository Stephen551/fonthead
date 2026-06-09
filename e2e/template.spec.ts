import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

// Skip the maker onboarding modal so it does not block the flow.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('fh-maker-tour-seen', '1');
    } catch {
      /* private mode */
    }
  });
});

// The printable blank grid. The promise under test: the downloaded template's
// gray guides sit above the tracer's hard 128 threshold, so a sheet drawn into
// it traces ONLY the pen ink — the guides, baselines, hint letters, and margin
// instructions all vanish. Round-trips the real artifact: download the PNG,
// draw into it in-page, upload the drawn sheet, and check what the maker sees.

const ROWS = ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', 'abcdefghijklm', 'nopqrstuvwxyz', '0123456789', ".,!?:;'-&@#"];

test('the blank grid downloads, and a sheet drawn into it traces clean', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/make');

  // download the grid
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'print a blank grid', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('fonthead-grid.png');
  const gridPath = test.info().outputPath('fonthead-grid.png');
  await download.saveAs(gridPath);

  // draw "pen" letters into the template's cells, in the page (real canvas)
  const gridB64 = readFileSync(gridPath).toString('base64');
  const drawnB64 = await page.evaluate(
    async ({ b64, rows }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
      });
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      // the template's geometry: top margin 70, row height 265, baseline at 62%
      ctx.fillStyle = '#111111';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.font = '700 120px Arial, sans-serif';
      rows.forEach((row: string, r: number) => {
        const y = 70 + r * 265 + 265 * 0.62;
        const cellW = c.width / row.length;
        for (let i = 0; i < row.length; i++) {
          ctx.fillText(row[i], i * cellW + cellW / 2, y);
        }
      });
      return c.toDataURL('image/png').split(',')[1];
    },
    { b64: gridB64, rows: ROWS },
  );
  const drawnPath = test.info().outputPath('drawn-sheet.png');
  writeFileSync(drawnPath, Buffer.from(drawnB64, 'base64'));

  // upload the drawn sheet: the tracer must see exactly the 6 drawn rows (the
  // guides and margin instructions traced as nothing), and the charset guess
  // must land on the split layout the grid prints
  await page.locator('input[type="file"]').setInputFiles(drawnPath);
  await expect(page.getByText('6 rows · 13 cells in row 1')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'download otf' })).toBeVisible({ timeout: 60_000 });
  const charset = await page.getByLabel('Charset, one row of characters per line').inputValue();
  expect(charset.split('\n')[0]).toBe('ABCDEFGHIJKLM');
  expect(charset.split('\n')[1]).toBe('NOPQRSTUVWXYZ');
});
