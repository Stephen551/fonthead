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

// Self-service account deletion, end to end. Sign up, publish a font, delete the
// account, then confirm the account is gone (session cleared) and the font is
// fully purged: its row (off the wall), its R2 binary, and its social card all
// stop serving. Runs against the dev server's local D1 + R2.

async function signUp(page: Page): Promise<string> {
  const stamp = `${Date.now()}${Math.floor(performance.now())}`;
  const email = `e2e-del-${stamp}@example.test`;
  await page.goto('/sign-up');
  await page.locator('#name').fill('E2E Deleter');
  await page.locator('#handle').fill(`e2edel${stamp}`);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('password123');
  await page.locator('#create').click();
  await page.waitForURL('**/account', { timeout: 30_000 });
  return email;
}

test('delete account purges the user, their font, its binary, and its social card', async ({ page }) => {
  await signUp(page);

  const fontName = `E2E Doomed ${Date.now()}`;
  await page.goto('/make');
  await page.getByRole('button', { name: 'try a sample sheet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'download otf' })).toBeVisible({ timeout: 60_000 });
  await page.getByPlaceholder("your font's name").fill(fontName);
  await page.getByRole('button', { name: /^publish/ }).click();

  const viewLink = page.getByRole('link', { name: /view the font page/ });
  await expect(viewLink).toBeVisible({ timeout: 30_000 });
  const href = await viewLink.getAttribute('href');
  expect(href).toMatch(/^\/f\//);
  const id = href!.replace(/^\/f\//, '');

  // the font's binary and social card serve while the account exists
  expect((await page.request.get(`/cdn/og/${id}.png`)).status()).toBe(200);
  expect((await page.request.get(`/cdn/fonts/${id}.woff2`)).status()).toBe(200);

  // delete the account from the account page: reveal, type DELETE, confirm
  await page.goto('/account');
  await page.locator('#del-open').click();
  await page.locator('#del-input').fill('DELETE');
  await page.locator('#del-go').click();

  // it signs out and lands on the home page
  await page.waitForURL((url) => url.pathname === '/', { timeout: 30_000 });

  // the session is gone: /account bounces to sign-in
  await page.goto('/account');
  await page.waitForURL('**/sign-in', { timeout: 15_000 });

  // the font is fully purged: off the wall, binary and card gone
  expect((await page.request.get(`/cdn/og/${id}.png`)).status()).toBe(404);
  expect((await page.request.get(`/cdn/fonts/${id}.woff2`)).status()).toBe(404);
  await page.goto('/?sort=new');
  await expect(page.getByRole('link', { name: fontName })).toHaveCount(0);
});
