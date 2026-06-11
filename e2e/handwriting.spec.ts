import { test, expect } from '@playwright/test';

// The handwriting wedge: the landing page renders with its grid download and
// maker CTA, the committed grid asset is the real template (right dimensions,
// served as PNG), and the maker exposes the straight-to-camera input.

test('the handwriting page serves the grid and routes to the maker', async ({ page }) => {
  await page.goto('/handwriting');
  await expect(page.getByRole('heading', { name: 'Turn your handwriting into a font' })).toBeVisible();

  // the grid asset: a real PNG with the template's dimensions
  const res = await page.request.get('/grid.png');
  expect(res.status()).toBe(200);
  const body = await res.body();
  expect(body.subarray(1, 4).toString('ascii')).toBe('PNG');
  expect(body.readUInt32BE(16)).toBe(2200); // width
  expect(body.readUInt32BE(20)).toBe(1700); // height

  // the download affordance and the maker CTA
  await expect(page.getByRole('link', { name: 'download the grid' })).toHaveAttribute('href', '/grid.png');
  await page
    .getByRole('link', { name: /make your handwriting font/ })
    .click();
  await page.waitForURL('**/make');
});

test('the handwriting page is discoverable from nav, hero, and maker', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('nav').getByRole('link', { name: 'handwriting' })).toHaveAttribute('href', '/handwriting');
  await expect(page.locator('#main').getByRole('link', { name: 'your own handwriting' })).toHaveAttribute('href', '/handwriting');
  await page.goto('/make');
  await expect(page.getByRole('link', { name: 'Turn your handwriting into a font' })).toHaveAttribute('href', '/handwriting');
});

test('the maker offers the camera path', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('fh-maker-tour-seen', '1');
    } catch {
      /* private mode */
    }
  });
  await page.goto('/make');
  // present in the DOM for every device; CSS reveals it on coarse pointers
  await expect(page.locator('input[capture="environment"]')).toHaveCount(1);
});
