import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const sheets = [1, 2, 3].map((n) => `e2e/fixtures/corpus/natural-variation-${n}.png`);
const wrangler = resolve('node_modules/wrangler/bin/wrangler.js');

test('publishing saves the exact sheets used by the build privately in R2', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => localStorage.setItem('fh-maker-tour-seen', '1'));
  const stamp = Date.now();
  await page.goto('/sign-up');
  await page.locator('#name').fill('Sheet Archive Test');
  await page.locator('#handle').fill(`e2esheets${stamp}`);
  await page.locator('#email').fill(`e2e-sheets-${stamp}@example.test`);
  await page.locator('#password').fill('password123');
  await page.locator('#create').click();
  await page.waitForURL('**/account');
  await page.goto('/make');
  await page.locator('#sheet-file').setInputFiles(sheets);
  await expect(page.getByRole('button', { name: 'download otf' })).toBeVisible({ timeout: 90_000 });
  await page.getByPlaceholder("your font's name").fill(`Saved Sheets ${stamp}`);

  // Variation changes rebuild automatically. Archive the files used by the
  // replacement build and require its mapping to be reviewed again.
  await page.getByRole('button', { name: 'advanced' }).click();
  await page.locator('#variation-file-0').setInputFiles(sheets[0]);
  await expect(page.locator('#variation-file-0').locator('..')).toContainText('natural-variation-1.png');
  await expect(page.getByRole('button', { name: 'download otf' })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole('checkbox', { name: 'I checked that each assigned key matches its letter on the sheet.' })).not.toBeChecked();
  const notice = page.getByText('Publishing saves your original sheets privately with this font.', { exact: false });
  await expect(notice).toBeVisible();
  await page.getByRole('checkbox', { name: 'I checked that each assigned key matches its letter on the sheet.' }).check();
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await notice.scrollIntoViewIfNeeded();
    const box = (await notice.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await notice.locator('..').screenshot({ path: testInfo.outputPath(`publish-notice-${width}.png`) });
  }
  await page.getByRole('button', { name: /^publish/ }).click();
  const link = page.getByRole('link', { name: /view the font page/ });
  await expect(link).toBeVisible({ timeout: 30_000 });
  const id = (await link.getAttribute('href'))!.replace(/^\/f\//, '');

  const usedSheets = [sheets[0], sheets[0], sheets[2]];
  for (const [index, path] of usedSheets.entries()) {
    const role = index === 0 ? 'base' : `variation-${index}`;
    const key = `sources/${id}/${role}.png`;
    const destination = testInfo.outputPath(`${role}.png`);
    execFileSync(process.execPath, [wrangler, 'r2', 'object', 'get', `fonthead-fonts/${key}`, '--local', '--file', destination], { stdio: 'pipe' });
    expect(Buffer.compare(readFileSync(destination), readFileSync(path))).toBe(0);
    expect((await page.request.get(`/cdn/${key}`)).status()).toBe(404);
  }

  await page.goto(`/f/${id}`);
  const remove = page.locator('[data-del-font]');
  await remove.click();
  await remove.click();
  await page.waitForURL('**/account');
  const result = spawnSync(process.execPath, [wrangler, 'r2', 'object', 'get', `fonthead-fonts/sources/${id}/base.png`, '--local', '--file', testInfo.outputPath('deleted.png')], { encoding: 'utf8' });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(/does not exist|not found/i);
});
