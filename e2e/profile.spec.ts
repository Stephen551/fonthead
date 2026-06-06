import { test, expect, type Page } from '@playwright/test';

// A tiny but real 1x1 PNG (~70 bytes), enough to pass the magic-byte + size gates.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function signUp(page: Page): Promise<string> {
  const stamp = `${Date.now()}${Math.floor(performance.now())}`;
  const handle = `pf${stamp}`;
  await page.goto('/sign-up');
  await page.locator('#name').fill('Profile Maker');
  await page.locator('#handle').fill(handle);
  await page.locator('#email').fill(`profile-${stamp}@example.test`);
  await page.locator('#password').fill('password123');
  await page.locator('#create').click();
  await page.waitForURL('**/account', { timeout: 30_000 });
  return handle;
}

test('edit name, bio, and avatar, then see them on the maker page', async ({ page }) => {
  const handle = await signUp(page);

  // the handle was claimed at sign-up, so on the account page it is locked: the
  // editable input is not rendered.
  await expect(page.locator('#handle')).toHaveCount(0);

  await page.locator('#name').fill('Profile Maker Edited');
  await page.locator('#bio').fill('I make blocky display faces.');
  await page.locator('#avatar').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: PNG_1x1 });
  await page.getByRole('button', { name: 'save profile', exact: true }).click();

  // save reloads the account page; wait for the persisted (server) avatar, whose
  // src points at the CDN (the pre-save preview is a blob: URL, which won't match).
  await expect(page.locator('#avatarwrap img')).toHaveAttribute('src', /\/cdn\/avatars\//, { timeout: 15_000 });

  // the public maker page shows the edits and the real avatar
  await page.goto(`/u/${handle}`);
  await expect(page.getByText('I make blocky display faces.')).toBeVisible();
  await expect(page.getByText('Profile Maker Edited')).toBeVisible();
  const avatar = page.locator('header img').first();
  await expect(avatar).toBeVisible();
  expect(await avatar.getAttribute('src')).toMatch(/^\/cdn\/avatars\//);
});
