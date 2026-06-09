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

// An author editing their OWN published font's details (name, specimen word,
// license) from its page. The binaries stay untouched; the og share card only
// resets when the specimen word changes. Runs against the dev server's local
// D1 + R2.

async function signUp(page: Page, prefix: string): Promise<void> {
  const stamp = `${Date.now()}${Math.floor(performance.now())}`;
  await page.goto('/sign-up');
  await page.locator('#name').fill('E2E Author');
  await page.locator('#handle').fill(`${prefix}${stamp}`);
  await page.locator('#email').fill(`e2e-${prefix}-${stamp}@example.test`);
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

test('an author can edit their own font, and the share card resets only on a specimen change', async ({ page }) => {
  await signUp(page, 'e2eeditfont');
  const fontName = `E2E Edit Me ${Date.now()}`;
  const id = await publishSampleFont(page, fontName);

  // the page shows the edit control and the freshly generated share card serves
  await page.goto(`/f/${id}`);
  await expect(page.locator('[data-edit-font]')).toBeVisible();
  expect((await page.request.get(`/cdn/og/${id}.png`)).status()).toBe(200);

  // rename only: the name updates everywhere, the card survives, the URL holds
  const renamed = `${fontName} v2`;
  await page.locator('[data-edit-font]').click();
  await expect(page.locator('#fh-edit')).toBeVisible();
  await page.locator('#fh-edit-name').fill(renamed);
  await page.locator('#fh-edit-save').click();
  // the page h1, by name: a bare h1 locator trips strict mode on the dev
  // toolbar's own headings
  await expect(page.getByRole('heading', { name: renamed })).toBeVisible({ timeout: 15_000 });
  expect(page.url()).toContain(`/f/${id}`);
  expect((await page.request.get(`/cdn/og/${id}.png`)).status()).toBe(200);

  // specimen + license edit: the specimen and license row update, the card resets
  await page.locator('[data-edit-font]').click();
  await page.locator('#fh-edit-specimen').fill('zap');
  await page.locator('#fh-edit [data-license-opt="cc0"]').click();
  await expect(page.locator('#fh-edit [data-license-opt="cc0"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#fh-edit-save').click();
  await expect(page.locator('#specimen')).toHaveText('zap', { timeout: 15_000 });
  await expect(page.locator('a[href="/licenses"]')).toHaveText('CC0');
  expect((await page.request.get(`/cdn/og/${id}.png`)).status()).toBe(404);
  const ogImage = await page.locator('meta[property="og:image"]').getAttribute('content');
  expect(ogImage).not.toContain(`/cdn/og/`);

  // the input refine still guards a direct post (maxlength can't cover it)
  const bad = await page.request.post('/_actions/updateOwnFont', {
    data: { fontId: id, name: 'a<b', specimenWord: '', license: 'ofl' },
  });
  expect(bad.status()).toBe(400);
});

test('editing is owner-gated', async ({ page, browser }) => {
  await signUp(page, 'e2eeditowner');
  const fontName = `E2E Not Yours ${Date.now()}`;
  const id = await publishSampleFont(page, fontName);

  // a second signed-in user sees report, not edit, and the action refuses them
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await signUp(other, 'e2eeditother');
  await other.goto(`/f/${id}`);
  await expect(other.locator('[data-report]')).toBeVisible();
  await expect(other.locator('[data-edit-font]')).toHaveCount(0);
  const res = await other.request.post('/_actions/updateOwnFont', {
    data: { fontId: id, name: 'Hijacked', specimenWord: '', license: 'cc0' },
  });
  expect(res.status()).toBe(403);
  await ctx.close();

  // the font is untouched
  await page.goto(`/f/${id}`);
  await expect(page.getByRole('heading', { name: fontName })).toBeVisible();
});
