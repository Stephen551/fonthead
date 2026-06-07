import { test, expect, type Page } from '@playwright/test';

// Skip the maker onboarding modal so it does not block the build/publish flow.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('fh-maker-tour-seen', '1');
    } catch {
      /* private mode */
    }
  });
});

// Download counting: publishing a font, then clicking a download link on its page,
// bumps the per-font downloads count (best-effort, deduped per IP). Runs against
// the dev server's local D1 + R2.

async function signUp(page: Page) {
  const stamp = `${Date.now()}${Math.floor(performance.now())}`;
  await page.goto('/sign-up');
  await page.locator('#name').fill('E2E Downloader');
  await page.locator('#handle').fill(`e2edl${stamp}`);
  await page.locator('#email').fill(`e2e-dl-${stamp}@example.test`);
  await page.locator('#password').fill('password123');
  await page.locator('#create').click();
  await page.waitForURL('**/account', { timeout: 30_000 });
}

// The value next to the "downloads" label in the Details list.
const downloadsCount = (page: Page) =>
  page.getByText('downloads', { exact: true }).locator('xpath=following-sibling::span');

test('downloading from the font page increments the count', async ({ page }) => {
  await signUp(page);

  const fontName = `E2E Downloads ${Date.now()}`;
  await page.goto('/make');
  await page.getByRole('button', { name: 'try a sample sheet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'download otf' })).toBeVisible({ timeout: 60_000 });
  await page.getByPlaceholder("your font's name").fill(fontName);
  await page.getByRole('button', { name: /^publish/ }).click();

  const viewLink = page.getByRole('link', { name: /view the font page/ });
  await expect(viewLink).toBeVisible({ timeout: 30_000 });
  const href = await viewLink.getAttribute('href');
  await page.goto(href!);

  // a fresh font starts at zero downloads
  await expect(downloadsCount(page)).toHaveText('0');

  // click a real download link (Playwright catches the file download)
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.fh-dl[data-font-id]').first().click(),
  ]);
  await download.cancel().catch(() => {});

  // the best-effort count lands; reload until the Details row shows 1
  await expect(async () => {
    await page.reload();
    await expect(downloadsCount(page)).toHaveText('1');
  }).toPass({ timeout: 15_000 });
});
