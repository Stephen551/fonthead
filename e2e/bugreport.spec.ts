import { test, expect, type Page } from '@playwright/test';

// The in-maker bug report (ADR 0060). The promises under test: the quiet link
// opens a report that sends with a note; a failed build opens the report on its
// own; and the sheet goes along only when the box is ticked. The action stores
// the report and returns ok whether or not the support email sends (in CI there
// is no Resend key), so the user-visible confirmation is the signal.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('fh-maker-tour-seen', '1');
    } catch {
      /* private mode */
    }
  });
});

// A blank white sheet: nothing to trace, so the build fails the way a bad scan does.
// Built and dropped in the page itself, so the spec needs no fixture file.
async function dropBlankSheet(page: Page) {
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 800;
    c.height = 600;
    const cx = c.getContext('2d')!;
    cx.fillStyle = '#fff';
    cx.fillRect(0, 0, c.width, c.height);
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'));
    const input = document.querySelector('#sheet-file') as HTMLInputElement;
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'blank.png', { type: 'image/png' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

test('the report link opens a form that sends with a note', async ({ page }) => {
  await page.goto('/make');
  await page.getByRole('button', { name: 'something wrong? tell us' }).click();
  await page.getByLabel('What went wrong').fill('e2e bug report test: please ignore.');
  // nothing dropped yet, so the sheet cannot be attached
  await expect(page.getByRole('checkbox')).toBeDisabled();
  await page.getByRole('button', { name: 'send report' }).click();
  await expect(page.getByTestId('bug-done')).toBeVisible({ timeout: 15_000 });
});

test('a failed build opens the report, and the sheet goes only when ticked', async ({ page }) => {
  await page.goto('/make');
  await dropBlankSheet(page);
  const form = page.getByRole('form', { name: 'Report a problem' });
  await expect(form).toBeVisible({ timeout: 60_000 });
  await expect(form).toContainText("That didn't build");

  // the box starts unticked: the sheet is never sent by default
  const box = form.getByRole('checkbox');
  await expect(box).toBeEnabled();
  await expect(box).not.toBeChecked();
  await box.check();

  await form.getByRole('button', { name: 'send report' }).click();
  await expect(page.getByTestId('bug-done')).toBeVisible({ timeout: 15_000 });
  // Chromium does not expose a multipart body that carries a file, so read what
  // the page handed to fetch instead (recorded by the wrapper installed below)
  const sent = await page.evaluate(() => (window as unknown as { __bugSent: BugSent[] }).__bugSent);
  expect(sent).toHaveLength(1);
  expect(sent[0].sheetType).toBe('image/jpeg');
  expect(sent[0].sheetBytes).toBeGreaterThan(64);
  expect(JSON.parse(sent[0].context)).toMatchObject({ where: 'maker', phase: 'error' });
});

test('without the tick, no sheet is sent', async ({ page }) => {
  await page.goto('/make');
  await dropBlankSheet(page);
  const form = page.getByRole('form', { name: 'Report a problem' });
  await expect(form).toBeVisible({ timeout: 60_000 });
  await form.getByRole('button', { name: 'send report' }).click();
  await expect(page.getByTestId('bug-done')).toBeVisible({ timeout: 15_000 });
  const sent = await page.evaluate(() => (window as unknown as { __bugSent: BugSent[] }).__bugSent);
  expect(sent).toHaveLength(1);
  expect(sent[0].sheetType).toBeNull();
});

type BugSent = { context: string; sheetType: string | null; sheetBytes: number };

// Record every bug report the page sends: whether it carried a sheet, and the context.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __bugSent: BugSent[] };
    w.__bugSent = [];
    const orig = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('submitBugReport') && init?.body instanceof FormData) {
        const sheet = init.body.get('sheet');
        w.__bugSent.push({
          context: String(init.body.get('context') ?? ''),
          sheetType: sheet instanceof File ? sheet.type : null,
          sheetBytes: sheet instanceof File ? sheet.size : 0,
        });
      }
      return orig(input, init);
    };
  });
});
