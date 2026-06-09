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

// The discovery rail on a font page: a maker with more than one public font
// gets their other fonts under the page, so a font page is never a dead end.

async function signUp(page: Page): Promise<void> {
  const stamp = `${Date.now()}${Math.floor(performance.now())}`;
  await page.goto('/sign-up');
  await page.locator('#name').fill('E2E Author');
  await page.locator('#handle').fill(`e2erail${stamp}`);
  await page.locator('#email').fill(`e2e-rail-${stamp}@example.test`);
  await page.locator('#password').fill('password123');
  await page.locator('#create').click();
  await page.waitForURL('**/account', { timeout: 30_000 });
}

async function publishSampleFont(page: Page, fontName: string): Promise<string> {
  await page.goto('/make');
  await page.getByRole('button', { name: 'try a sample sheet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'download otf' })).toBeVisible({ timeout: 60_000 });
  await page.getByPlaceholder("your font's name").fill(fontName);
  await page.getByRole('button', { name: /^publish/ }).click();
  const viewLink = page.getByRole('link', { name: /view the font page/ });
  await expect(viewLink).toBeVisible({ timeout: 30_000 });
  return (await viewLink.getAttribute('href'))!.replace(/^\/f\//, '');
}

test("a font page shows the maker's other fonts in the rail", async ({ page }) => {
  test.setTimeout(150_000);
  await signUp(page);

  const stamp = Date.now();
  const first = `E2E Rail A ${stamp}`;
  const second = `E2E Rail B ${stamp}`;
  const firstId = await publishSampleFont(page, first);
  await publishSampleFont(page, second);

  // the first font's page offers the maker's second font
  await page.goto(`/f/${firstId}`);
  const rail = page.getByRole('region', { name: 'Related fonts' });
  await expect(rail).toBeVisible();
  await expect(rail.getByText(/more from @e2erail/)).toBeVisible();
  await expect(rail.getByRole('link', { name: second }).first()).toBeVisible();
  // and never lists the page's own font
  await expect(rail.getByRole('link', { name: first })).toHaveCount(0);
});
