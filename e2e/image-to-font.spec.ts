import { test, expect } from '@playwright/test';

// The image-to-font wedge: the landing page renders its steps, drawings, and
// structured data, routes to the maker, and is discoverable from the home page
// and the sitemap.

test('the image-to-font page renders its steps and routes to the maker', async ({ page }) => {
  await page.goto('/image-to-font');
  await expect(page).toHaveTitle('Image to Font — Make a Font From an Alphabet Image · fonthead.dev');
  await expect(page.getByRole('heading', { level: 1, name: 'Turn an image into a font' })).toBeVisible();
  for (const name of ['Pick a style', 'Make the prompt yours', 'Generate the image', 'Drop it into the maker']) {
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  }

  // every step carries its drawing, each with an accessible description
  await expect(page.locator('.itf-step figure[role="img"][aria-label]')).toHaveCount(4);

  // the HowTo + FAQPage JSON-LD is valid and mirrors the visible FAQs
  const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
  const types = ld.flatMap((t) => [JSON.parse(t)].flat()).map((n: { '@type'?: string }) => n['@type']);
  expect(types).toEqual(expect.arrayContaining(['HowTo', 'FAQPage']));
  await expect(page.getByRole('heading', { level: 3, name: 'What kind of image works?' })).toBeVisible();

  // the handwriting detour and the license link
  await expect(page.locator('#main').getByRole('link', { name: 'turn your handwriting into a font' })).toHaveAttribute('href', '/handwriting');
  await expect(page.getByRole('link', { name: 'font licensing' })).toHaveAttribute('href', '/licenses');

  await page.getByRole('link', { name: /make your font/i }).click();
  await page.waitForURL('**/make');
});

test('the image-to-font page is discoverable from home and the sitemap', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Turn an image into a font' })).toHaveAttribute('href', '/image-to-font');
  const sitemap = await (await page.request.get('/sitemap.xml')).text();
  expect(sitemap).toContain('/image-to-font</loc>');
});
