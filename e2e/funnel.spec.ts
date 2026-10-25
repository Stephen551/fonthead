import { test, expect } from '@playwright/test';

// Skip the maker onboarding modal so it does not block the flow.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('fh-maker-tour-seen', '1');
    } catch {
      /* private mode */
    }
  });
});

// The funnel instrument panel. Asserts at the wire: the maker fires the
// anonymous counters for view, sample, build, and download, and the action
// rejects junk events (so the table can only ever hold the known enum).

test('the maker fires funnel events through its happy path', async ({ page }) => {
  test.setTimeout(120_000);
  const events: string[] = [];
  const sources: { event?: string; source?: string }[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/_actions/trackFunnel')) {
      try {
        const body = req.postDataJSON() as { event?: string; meta?: string };
        sources.push(req.postDataJSON());
        events.push(`${body.event}${body.meta ? ':' + body.meta : ''}`);
      } catch {
        /* non-JSON */
      }
    }
  });

  await page.goto('/make');
  await page.getByRole('button', { name: 'try a sample sheet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'download otf' })).toBeVisible({ timeout: 60_000 });
  await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'download otf' }).click()]);
  await expect.poll(() => events.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(4);

  expect(events).toContain('make_view');
  expect(events).toContain('sample_try');
  expect(events.some((e) => e.startsWith('build_ok:mono'))).toBe(true);
  expect(events).toContain('download:otf');
  expect(sources).toContainEqual(expect.objectContaining({ event: 'build_ok', source: 'sample' }));
  expect(sources).toContainEqual(expect.objectContaining({ event: 'download', source: 'sample' }));
});

test('the funnel action rejects unknown events', async ({ page }) => {
  await page.goto('/');
  const res = await page.request.post('/_actions/trackFunnel', {
    data: { event: 'made_up_event' },
  });
  expect(res.status()).toBe(400);
  const invalidSource = await page.request.post('/_actions/trackFunnel', {
    data: { event: 'build_ok', source: 'arbitrary-private-filename' },
  });
  expect(invalidSource.status()).toBe(400);
  const ok = await page.request.post('/_actions/trackFunnel', {
    data: { event: 'make_view' },
  });
  expect(ok.status()).toBe(200);
});

test('an uploaded sheet marks its build and download as upload activity', async ({ page }) => {
  test.setTimeout(120_000);
  const payloads: Record<string, unknown>[] = [];
  page.on('request', req => {
    if (req.url().includes('/_actions/trackFunnel')) payloads.push(req.postDataJSON());
  });
  await page.goto('/make');
  await page.locator('#sheet-file').setInputFiles('e2e/fixtures/graffiti-variation-1.png');
  await expect(page.getByRole('button', { name: 'download woff2', exact: true })).toBeVisible({ timeout: 90_000 });
  await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'download woff2', exact: true }).click()]);
  await expect.poll(() => payloads.some(p => p.event === 'download')).toBe(true);
  expect(payloads).toContainEqual(expect.objectContaining({ event: 'build_ok', source: 'upload' }));
  expect(payloads).toContainEqual({ event: 'download', source: 'upload', meta: 'woff2' });
  for (const payload of payloads) expect(Object.keys(payload).every(key => ['event', 'source', 'meta'].includes(key))).toBe(true);
});
