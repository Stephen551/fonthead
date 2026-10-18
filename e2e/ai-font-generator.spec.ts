import { test, expect } from '@playwright/test';

// The AI font generator page: its reviewed copy renders with the copy's exact
// metadata and heading outline, the drawings and structured data are in place,
// it routes to the maker, and it is discoverable from the home footer and the
// sitemap.

test('the AI font generator page renders its copy and routes to the maker', async ({ page }) => {
  await page.goto('/ai-font-generator');
  await expect(page).toHaveTitle('Free AI Font Generator: Make a Real Font · fonthead.dev');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    'Make a font with AI for free. Generate an alphabet in ChatGPT or Gemini from our prompt, then download a real OTF, TTF or WOFF2 font. No account needed.',
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/ai-font-generator$/);

  // the copy's outline: one H1, then its H2s in order and nothing deeper
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('A free AI font generator that makes real fonts');
  await expect(page.locator('#main h2')).toHaveText([
    'How it works',
    'What you get',
    'Free from start to finish',
    'Where the AI comes in',
    'Tips for a cleaner AI-generated font',
    'Other ways to make a font',
    'Common questions',
  ]);
  await expect(page.locator('#main h3, #main h4')).toHaveCount(0);

  // four steps, each with its drawing and an accessible description
  await expect(page.locator('.aig-step')).toHaveCount(4);
  await expect(page.locator('.aig-step figure[role="img"][aria-label]')).toHaveCount(4);
  await expect(page.locator('.aig-step').first()).toContainText('Pick a style. Start from a sheet style');

  // the BreadcrumbList + FAQPage JSON-LD; the FAQ mirrors the visible questions
  const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
  const nodes = ld.flatMap((t) => [JSON.parse(t)].flat()) as { '@type'?: string; mainEntity?: { name: string }[] }[];
  expect(nodes.map((n) => n['@type'])).toEqual(expect.arrayContaining(['BreadcrumbList', 'FAQPage']));
  const faq = nodes.find((n) => n['@type'] === 'FAQPage')!;
  const questions = await page.locator('.aig-q').allTextContents();
  expect(faq.mainEntity!.map((q) => q.name)).toEqual(questions);
  expect(questions).toHaveLength(6);

  // the copy's links, with their exact text
  const main = page.locator('#main');
  await expect(main.getByRole('link', { name: 'font maker', exact: true })).toHaveAttribute('href', '/make');
  await expect(main.getByRole('link', { name: 'image to font', exact: true }).first()).toHaveAttribute('href', '/image-to-font');
  await expect(main.getByRole('link', { name: 'Turn your handwriting into a font', exact: true })).toHaveAttribute('href', '/handwriting');
  await expect(main.getByRole('link', { name: 'font licensing', exact: true })).toHaveAttribute('href', '/licenses');

  const ctas = main.getByRole('link', { name: 'Make your AI font', exact: true });
  await expect(ctas).toHaveCount(2);
  await ctas.first().click();
  await page.waitForURL('**/make');
});

test('the AI font generator page is discoverable from the home footer and the sitemap', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('footer').getByRole('link', { name: 'an AI font', exact: true })).toHaveAttribute('href', '/ai-font-generator');
  const sitemap = await (await page.request.get('/sitemap.xml')).text();
  expect(sitemap).toContain('/ai-font-generator</loc>');
});
