import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Separate local/CI rate-limit buckets; production Cloudflare owns this header.
  await page.setExtraHTTPHeaders({ 'cf-connecting-ip': `reviews-${crypto.randomUUID()}` });
  await page.addInitScript(() => localStorage.setItem('fh-maker-tour-seen', '1'));
});

const reviewForm = (page: Page) => page.getByRole('form', { name: 'Review your font-making experience' });
async function build(page: Page) {
  await page.goto('/make');
  await page.locator('#sheet-file').setInputFiles('e2e/fixtures/graffiti-variation-1.png');
  await expect(page.getByRole('button', { name: 'download woff2', exact: true })).toBeVisible({ timeout: 120_000 });
}
async function download(page: Page, format = 'woff2') {
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: `download ${format}`, exact: true }).click(),
  ]);
  expect(await file.failure()).toBeNull();
}

test('first maker download asks once and submits a private review by default', async ({ page }) => {
  test.setTimeout(180_000);
  await build(page);
  await expect(reviewForm(page)).toHaveCount(0);
  await download(page);
  const form = reviewForm(page);
  await expect(form).toBeVisible();
  await expect(form.getByRole('checkbox')).not.toBeChecked();
  await expect(form.getByRole('radio', { checked: true })).toHaveCount(0);
  // A native required radio group prevents an unrated submission.
  await form.getByRole('button', { name: 'send review', exact: true }).click();
  await expect(form).toBeVisible();
  await expect(form.getByRole('radio', { name: '1 star', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(form.getByRole('radio', { name: '2 stars', exact: true })).toBeChecked();
  await form.getByLabel('Your review (optional)').fill('e2e review: private maker feedback');
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await form.screenshot({ path: test.info().outputPath(`review-${width}.png`) });
    expect(await form.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  const sent = page.waitForRequest(request => request.url().includes('/_actions/submitMakerReview'));
  await form.getByRole('button', { name: 'send review', exact: true }).click();
  const payload = (await sent).postDataJSON();
  expect(payload).toMatchObject({ rating: 2, allowPublic: false, message: 'e2e review: private maker feedback' });
  expect(Object.keys(payload).sort()).toEqual(['allowPublic', 'id', 'message', 'rating', 'website']);
  await expect(page.getByText('Thanks for reviewing Fonthead.', { exact: true })).toBeVisible();
  await download(page, 'otf');
  await expect(form).toHaveCount(0);
  await build(page); // Storage survives a real navigation and another build.
  await download(page);
  await expect(form).toHaveCount(0);
});

test('public permission is opt-in and a failed request keeps the review for retry', async ({ page }) => {
  test.setTimeout(120_000);
  await build(page);
  await download(page);
  const form = reviewForm(page);
  await form.getByRole('radio', { name: '4 stars', exact: true }).check();
  await form.getByLabel('Your review (optional)').fill('e2e review: permitted anonymous feedback');
  await form.getByRole('checkbox').check();
  await page.route('**/_actions/submitMakerReview**', route => route.abort(), { times: 1 });
  await form.getByRole('button', { name: 'send review', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('Could not send');
  await expect(form.getByRole('checkbox')).toBeChecked();
  await expect(form.getByLabel('Your review (optional)')).toHaveValue('e2e review: permitted anonymous feedback');
  const sent = page.waitForRequest(request => request.url().includes('/_actions/submitMakerReview'));
  await form.getByRole('button', { name: 'send review', exact: true }).click();
  const payload = (await sent).postDataJSON();
  expect(payload.allowPublic).toBe(true);
  await expect(page.getByText('Thanks for reviewing Fonthead.', { exact: true })).toBeVisible();
  // Replaying the same submission is safe after a lost response.
  const replay = await page.request.post('/_actions/submitMakerReview', {
    headers: { 'cf-connecting-ip': `reviews-replay-${payload.id}` }, data: payload,
  });
  expect(replay.ok()).toBe(true);
});

test('dismissing the review does not block downloads or ask again', async ({ page }) => {
  test.setTimeout(120_000);
  await build(page);
  await download(page);
  await reviewForm(page).getByRole('button', { name: 'no thanks' }).click();
  await expect(reviewForm(page)).toHaveCount(0);
  await download(page, 'ttf');
  await expect(reviewForm(page)).toHaveCount(0);
});

test('review action rejects invalid ratings and coerced public permission', async ({ request }) => {
  const headers = { 'cf-connecting-ip': `reviews-validation-${crypto.randomUUID()}` };
  for (const invalid of [{ rating: 0 }, { rating: 6 }, { rating: 2.5 }, { allowPublic: 'true' }, { message: 'x'.repeat(2001) }]) {
    const response = await request.post('/_actions/submitMakerReview', {
      headers,
      data: { id: crypto.randomUUID(), rating: 3, message: '', ...invalid },
    });
    expect(response.status()).toBe(400);
  }
  const response = await request.post('/_actions/submitMakerReview', {
    headers,
    data: { id: crypto.randomUUID(), rating: 3, message: 'e2e review: permission omitted' },
  });
  expect(response.ok()).toBe(true);
});

test('review action rate-limits repeated requests and accepts the honeypot without saving it', async ({ request }) => {
  const headers = { 'cf-connecting-ip': `reviews-limit-${crypto.randomUUID()}` };
  const data = { id: crypto.randomUUID(), rating: 3, message: 'e2e review: idempotent rate-limit probe' };
  for (let i = 0; i < 5; i++) {
    expect((await request.post('/_actions/submitMakerReview', { headers, data })).ok()).toBe(true);
  }
  expect((await request.post('/_actions/submitMakerReview', { headers, data })).status()).toBe(429);
  expect((await request.post('/_actions/submitMakerReview', { headers, data: { ...data, id: crypto.randomUUID(), website: 'bot.example', message: 'e2e review: honeypot must not be saved' } })).ok()).toBe(true);
});
