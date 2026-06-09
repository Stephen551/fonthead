import { test, expect } from '@playwright/test';

// The /support form: a visitor (no account needed) sends a bug report or idea,
// the action emails the support inbox via Resend, and the form confirms. We test
// the user-visible flow; the action returns ok regardless of the send result, so
// this passes in CI without a Resend key (where the send is a no-op).

test('support form submits and confirms', async ({ page }) => {
  await page.goto('/support');
  await page.locator('#kind').selectOption('bug');
  await page
    .locator('#message')
    .fill('e2e support test: please ignore. Confirming the support form reaches the inbox.');
  await page.locator('#email').fill('e2e-support@example.test');
  await page.getByRole('button', { name: 'send', exact: true }).click();

  const done = page.locator('#done');
  await expect(done).toBeVisible({ timeout: 15_000 });
  await expect(done).toContainText('we got it');
  // the form is replaced by the confirmation
  await expect(page.locator('#feedbackform')).toBeHidden();
});
