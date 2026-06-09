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

// An author deleting one of their OWN fonts (not the whole account). Sign up,
// publish a font, then delete it from its page with the two-stage confirm and
// confirm it is fully purged: off the wall, its binary and social card gone.
// Runs against the dev server's local D1 + R2.

async function signUp(page: Page): Promise<void> {
  const stamp = `${Date.now()}${Math.floor(performance.now())}`;
  await page.goto('/sign-up');
  await page.locator('#name').fill('E2E Author');
  await page.locator('#handle').fill(`e2edelfont${stamp}`);
  await page.locator('#email').fill(`e2e-delfont-${stamp}@example.test`);
  await page.locator('#password').fill('password123');
  await page.locator('#create').click();
  await page.waitForURL('**/account', { timeout: 30_000 });
}

test('an author can delete their own font from its page', async ({ page }) => {
  await signUp(page);

  const fontName = `E2E Mine ${Date.now()}`;
  await page.goto('/make');
  await page.getByRole('button', { name: 'try a sample sheet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'download otf' })).toBeVisible({ timeout: 60_000 });
  await page.getByPlaceholder("your font's name").fill(fontName);
  await page.getByRole('button', { name: /^publish/ }).click();

  const viewLink = page.getByRole('link', { name: /view the font page/ });
  await expect(viewLink).toBeVisible({ timeout: 30_000 });
  const id = (await viewLink.getAttribute('href'))!.replace(/^\/f\//, '');

  // on its page the owner sees a delete control, and not the report one
  await page.goto(`/f/${id}`);
  const del = page.locator('[data-del-font]');
  await expect(del).toBeVisible();
  await expect(page.locator('[data-report]')).toHaveCount(0);
  expect((await page.request.get(`/cdn/fonts/${id}.woff2`)).status()).toBe(200);

  // two-stage confirm: first click arms, second within the window deletes
  await del.click();
  await expect(del).toHaveText(/click again/i);
  await del.click();
  await page.waitForURL('**/account', { timeout: 30_000 });

  // purged: the binary and social card stop serving, and it is off the wall
  expect((await page.request.get(`/cdn/fonts/${id}.woff2`)).status()).toBe(404);
  expect((await page.request.get(`/cdn/og/${id}.png`)).status()).toBe(404);
  await page.goto('/?sort=new');
  await expect(page.getByRole('link', { name: fontName })).toHaveCount(0);
});
