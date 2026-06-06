import { test, expect, type Page } from '@playwright/test';

// Flag 5: the auth + publish boundary, end to end. Sign up, build a font,
// publish it, and confirm it reaches a font page and the public wall. Runs
// against the dev server's local D1 + R2.

async function signUp(page: Page) {
  const stamp = `${Date.now()}${Math.floor(performance.now())}`;
  const email = `e2e-${stamp}@example.test`;
  await page.goto('/sign-up');
  await page.locator('#name').fill('E2E Maker');
  await page.locator('#handle').fill(`e2e-${stamp}`);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('password123');
  await page.locator('#create').click();
  // sign-up claims the handle, then redirects to /account on success
  await page.waitForURL('**/account', { timeout: 30_000 });
}

test('sign up, build, publish, and see it on the wall', async ({ page }) => {
  await signUp(page);

  const fontName = `E2E Peak ${Date.now()}`;
  await page.goto('/make');
  await page.getByRole('button', { name: 'try a sample sheet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'download otf' })).toBeVisible({ timeout: 60_000 });

  // name it, then publish (public is the default)
  await page.getByPlaceholder("your font's name").fill(fontName);
  await page.getByRole('button', { name: /^publish/ }).click();

  // the published state shows a link to the new font page
  const viewLink = page.getByRole('link', { name: /view the font page/ });
  await expect(viewLink).toBeVisible({ timeout: 30_000 });
  const href = await viewLink.getAttribute('href');
  expect(href).toMatch(/^\/f\//);

  // the font page renders
  await page.goto(href!);
  await expect(page.getByRole('heading', { name: fontName })).toBeVisible();

  // and it shows on the public wall (newest first)
  await page.goto('/?sort=new');
  await expect(page.getByRole('link', { name: fontName }).first()).toBeVisible({ timeout: 15_000 });
});
