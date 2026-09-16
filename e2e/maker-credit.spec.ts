import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const stamp = `${Date.now()}`;
const live = `credit-live-${stamp}`;
const deleted = `credit-deleted-${stamp}`;
const ids = [`credit-feature-${stamp}`, `credit-card-${stamp}`, `credit-active-${stamp}`, `credit-related-${stamp}`];

function localSql(sql: string) {
  execFileSync(process.execPath, [
    'node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'DB', '--local', '--command', sql,
  ], { stdio: 'pipe' });
}

test.beforeAll(() => {
  // Owned fixtures in the local database only. Deleting the author directly
  // models retained historical fonts, without changing self-service deletion.
  localSql(`
    INSERT INTO "user" (id, name, email, handle, createdAt, updatedAt)
    VALUES ('${live}', 'Credit Live', '${live}@example.test', '${live}', datetime('now'), datetime('now')),
           ('${deleted}', 'Credit Deleted', '${deleted}@example.test', '${deleted}', datetime('now'), datetime('now'));
    INSERT INTO fonts (id, owner_id, name, maker_handle, specimen_word, visibility, votes_count)
    VALUES ('${ids[0]}', '${deleted}', 'Credit Feature', '${deleted}', 'Feature', 'public', 900003),
           ('${ids[1]}', '${deleted}', 'Credit Card', '${deleted}', 'Card', 'public', 900002),
           ('${ids[2]}', '${live}', 'Credit Active', '${live}', 'Active', 'public', 900001),
           ('${ids[3]}', '${live}', 'Credit Related', '${live}', 'Related', 'public', 900000);
    DELETE FROM "user" WHERE id = '${deleted}';
  `);
});

test.afterAll(() => {
  localSql(`DELETE FROM fonts WHERE id IN (${ids.map((id) => `'${id}'`).join(',')});
    DELETE FROM "user" WHERE id IN ('${live}', '${deleted}');`);
});

test('retained fonts render plain author credits in featured cards, grid cards and font pages', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.fh-feature').getByText(`by ${deleted}`, { exact: true })).toBeVisible();
  await expect(page.locator('.fh-card').getByText(`by ${deleted}`, { exact: true })).toBeVisible();
  await expect(page.locator(`a[href="/u/${deleted}"]`)).toHaveCount(0);
  await expect(page.locator(`.fh-card a[href="/u/${live}"]`)).toHaveCount(2);

  for (const id of ids.slice(0, 2)) {
    const response = await page.goto(`/f/${id}`);
    expect(response?.status()).toBe(200);
    await expect(page.locator('main').getByText(`by ${deleted}`, { exact: true }).first()).toBeVisible();
    await expect(page.locator(`a[href="/u/${deleted}"]`)).toHaveCount(0);
    const schemas = (await page.locator('script[type="application/ld+json"]').allTextContents()).flatMap((s) => JSON.parse(s));
    const font = schemas.find((s) => s['@type'] === 'CreativeWork');
    expect(font.creator).toEqual({ '@type': 'Person', name: deleted });
    expect(font.author).toEqual(font.creator);
  }
});

test('active author links, related fonts and sitemap profile URLs still work', async ({ page }) => {
  await page.goto(`/f/${ids[2]}`);
  await expect(page.locator(`a[href="/u/${live}"]`).first()).toBeVisible();
  const rail = page.getByRole('region', { name: 'Related fonts' });
  await expect(rail.getByRole('link', { name: 'Credit Related', exact: true })).toBeVisible();
  await expect(rail.getByRole('link', { name: `by ${live}`, exact: true })).toHaveAttribute('href', `/u/${live}`);
  await page.locator(`a[href="/u/${live}"]`).first().click();
  await expect(page.getByRole('heading', { name: `@${live}`, exact: true })).toBeVisible();

  const xml = await (await page.request.get('/sitemap.xml')).text();
  for (const id of ids) expect(xml).toContain(`/f/${id}`);
  expect(xml).toContain(`/u/${live}`);
  expect(xml).not.toContain(`/u/${deleted}`);
});
