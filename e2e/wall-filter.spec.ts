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

// The wall's badge filter. Publish a color font, then confirm ?badge=color
// finds it, ?badge=variable does not, a junk badge value is ignored, and the
// hero steps aside while a filter is active. Runs against the dev server's
// local D1 + R2.

async function signUp(page: Page): Promise<void> {
  const stamp = `${Date.now()}${Math.floor(performance.now())}`;
  await page.goto('/sign-up');
  await page.locator('#name').fill('E2E Author');
  await page.locator('#handle').fill(`e2efilter${stamp}`);
  await page.locator('#email').fill(`e2e-filter-${stamp}@example.test`);
  await page.locator('#password').fill('password123');
  await page.locator('#create').click();
  await page.waitForURL('**/account', { timeout: 30_000 });
}

test('the wall filters by badge', async ({ page }) => {
  await signUp(page);

  // build + publish a gradient color sample, which earns the color badge
  const fontName = `E2E Tinted ${Date.now()}`;
  await page.goto('/make');
  await page.getByRole('button', { name: 'color · gradient', exact: true }).click();
  await page.getByRole('button', { name: 'try a sample sheet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'download otf' })).toBeVisible({ timeout: 60_000 });
  await page.getByPlaceholder("your font's name").fill(fontName);
  await page.getByRole('button', { name: /^publish/ }).click();
  await expect(page.getByRole('link', { name: /view the font page/ })).toBeVisible({ timeout: 30_000 });

  // the color filter finds it, the active chip is marked, the hero is gone
  await page.goto('/?sort=new&badge=color');
  await expect(page.getByRole('link', { name: fontName }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('a.fh-badge--color[aria-current="true"]')).toBeVisible();
  await expect(page.locator('#hero-spec')).toHaveCount(0);

  // the variable filter does not include it
  await page.goto('/?sort=new&badge=variable');
  await expect(page.getByRole('link', { name: fontName })).toHaveCount(0);

  // a junk badge value reads as no filter
  await page.goto('/?sort=new&badge=junk');
  await expect(page.getByRole('link', { name: fontName }).first()).toBeVisible({ timeout: 15_000 });
});
