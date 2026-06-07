import { test, expect, type Page } from '@playwright/test';

// The admin dashboard must be invisible to everyone but an allowlisted admin.
// These checks assert the lockout, which is env-independent (they hold in CI
// whether or not ADMIN_EMAILS is configured, since a non-allowlisted account is
// never an admin). The admin happy-path and the ban-to-read-only flow depend on
// a configured admin email and are verified manually on a dev server.

async function signUp(page: Page) {
  const stamp = `${Date.now()}${Math.floor(performance.now())}`;
  await page.goto('/sign-up');
  await page.locator('#name').fill('E2E User');
  await page.locator('#handle').fill(`e2e-${stamp}`);
  await page.locator('#email').fill(`e2e-${stamp}@example.test`);
  await page.locator('#password').fill('password123');
  await page.locator('#create').click();
  await page.waitForURL('**/account', { timeout: 30_000 });
}

test('the admin dashboard 404s for anonymous visitors', async ({ page }) => {
  const res = await page.goto('/admin');
  expect(res?.status()).toBe(404);
});

test('the admin dashboard 404s for a signed-in non-admin', async ({ page }) => {
  await signUp(page);
  const res = await page.goto('/admin');
  expect(res?.status()).toBe(404);
});
