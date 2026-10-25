import { test, expect } from '@playwright/test';

// Requires a disposable local database and ADMIN_EMAILS containing this test
// address. Never create a test admin or collect synthetic activity on production.
test('admin analytics separate member uploads, samples and admin testing', async ({ browser, baseURL }) => {
  const adminEmail = process.env.FH_TEST_ADMIN_EMAIL;
  test.skip(!adminEmail || !baseURL?.startsWith('http://localhost:'), 'Needs a local synthetic admin allowlist');
  const admin = await browser.newContext({ baseURL });
  const member = await browser.newContext({ baseURL });
  const anon = await browser.newContext({ baseURL });
  const suffix = crypto.randomUUID().slice(0, 8);
  const memberName = `Analytics member ${suffix}`;
  const headers = { origin: baseURL!, 'cf-connecting-ip': `analytics-${suffix}` };
  const password = `Synthetic-only-${suffix}-2026!`;
  const memberEmail = `analytics-${suffix}@example.test`;
  let memberCreated = false;
  let adminCreated = false;
  try {
    expect((await anon.request.get('/admin')).status()).toBe(404);
    const create = async (context: typeof admin, email: string, name: string) => {
      const response = await context.request.post('/api/auth/sign-up/email', { headers, data: { email, password, name } });
      expect(response.ok(), await response.text()).toBe(true);
    };
    await create(admin, adminEmail!, 'Analytics test admin'); adminCreated = true;
    await create(member, memberEmail, memberName); memberCreated = true;
    expect((await member.request.get('/admin')).status()).toBe(404);
    const event = async (context: typeof admin, name: string, source: string) => {
      const response = await context.request.post('/_actions/trackFunnel', { headers, data: { event: name, source } });
      expect(response.ok()).toBe(true);
    };
    await event(anon, 'build_ok', 'upload');
    await event(admin, 'build_ok', 'upload');
    await event(member, 'build_ok', 'sample');
    await event(member, 'build_ok', 'unknown'); // Old clients must not become upload builds.
    await event(member, 'build_ok', 'upload');
    await event(member, 'build_fail', 'upload');
    await event(member, 'download', 'upload');
    const page = await admin.newPage();
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    const dashboard = await page.goto('/admin?days=7');
    expect(dashboard?.headers()['cache-control']).toBe('private, no-store');
    await expect(page.getByRole('heading', { name: 'Is the maker working for people?' })).toBeVisible();
    const activity = page.getByRole('region', { name: 'Member activity table', exact: true });
    const row = activity.getByRole('row').filter({ hasText: memberName });
    await expect(row).toBeVisible();
    expect(await row.getByRole('cell').allTextContents()).toEqual([new Date().toISOString().slice(0, 10), '1', '1', '1', '1']);
    await expect(activity).not.toContainText('Analytics test admin');
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.locator('.analytics').screenshot({ path: test.info().outputPath(`analytics-${width}.png`) });
    }
    const period = page.getByRole('navigation', { name: 'Analytics period' });
    await period.getByRole('link', { name: '90 days' }).focus();
    await expect(period.getByRole('link', { name: '90 days' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(period.getByRole('link', { name: '90 days' })).toHaveAttribute('aria-current', 'page');
    await page.getByText('Daily events · 90 days', { exact: true }).click();
    await expect(page.getByRole('region', { name: 'Daily analytics table' }).locator('tbody tr')).toHaveCount(90);
    expect(errors).toEqual([]);
    const removed = await member.request.post('/_actions/deleteAccount', { headers, data: { confirm: 'DELETE' } });
    expect(removed.ok()).toBe(true); memberCreated = false;
    await page.reload();
    await expect(page.locator('.member-panel')).not.toContainText(memberName);
  } finally {
    if (memberCreated) await member.request.post('/_actions/deleteAccount', { headers, data: { confirm: 'DELETE' } });
    if (adminCreated) await admin.request.post('/_actions/deleteAccount', { headers, data: { confirm: 'DELETE' } });
    await Promise.all([admin.close(), member.close(), anon.close()]);
  }
});
