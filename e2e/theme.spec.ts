import { test, expect } from '@playwright/test';

// Dark mode. The resolved theme lives on <html data-theme>, set pre-paint by
// the inline script in Base.astro: a saved choice wins, else the OS
// preference. The nav toggle flips and saves; ClientRouter swaps re-apply it.

test.describe('with a dark OS preference', () => {
  test.use({ colorScheme: 'dark' });

  test('the site follows the OS, survives client navigation, and a toggle override sticks', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(22, 21, 17)');

    // a client-side navigation (View Transitions) keeps the theme
    await page.locator('nav').getByRole('link', { name: 'faq', exact: true }).click();
    await page.waitForURL('**/faq');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // the toggle flips to light and the choice beats the OS on reload
    await page.locator('[data-theme-toggle]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(255, 255, 255)');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });
});

test.describe('with a light OS preference', () => {
  test.use({ colorScheme: 'light' });

  test('the site renders light and the toggle goes dark', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.locator('[data-theme-toggle]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(22, 21, 17)');
  });
});
