import { test, expect, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';

// Password reset, end to end. Sign up, request a reset, pull the token straight
// from the local D1 verification table (standing in for the emailed link, which
// goes through Resend), set a new password, and confirm the new one signs in and
// the old one no longer does. Runs against the dev server's local D1.

async function signUp(page: Page): Promise<string> {
  const stamp = `${Date.now()}${Math.floor(performance.now())}`;
  const email = `e2e-reset-${stamp}@example.test`;
  await page.goto('/sign-up');
  await page.locator('#name').fill('E2E Reset');
  await page.locator('#handle').fill(`e2ereset${stamp}`);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('password123');
  await page.locator('#create').click();
  await page.waitForURL('**/account', { timeout: 30_000 });
  return email;
}

// The most recent reset token from local D1. Better Auth stores it as the
// verification identifier `reset-password:<token>`.
function latestResetToken(): string {
  const out = execSync(
    `npx wrangler d1 execute DB --local --json --command "SELECT identifier FROM verification WHERE identifier LIKE 'reset-password:%' ORDER BY rowid DESC LIMIT 1"`,
    { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const rows = JSON.parse(out.slice(out.indexOf('[')))[0].results as Array<{ identifier: string }>;
  expect(rows.length, 'a reset token was created').toBeGreaterThan(0);
  return rows[0].identifier.replace(/^reset-password:/, '');
}

async function signOut(page: Page) {
  await page.goto('/account');
  await page.getByRole('button', { name: 'sign out' }).click();
  await page.waitForURL((u) => u.pathname === '/', { timeout: 15_000 });
}

test('request a reset, set a new password, and sign in with it', async ({ page }) => {
  const email = await signUp(page);

  // request the reset; the response is generic either way (no account enumeration)
  await page.goto('/forgot-password');
  await page.locator('#email').fill(email);
  await page.getByRole('button', { name: 'send reset link' }).click();
  await expect(page.locator('#msg')).toContainText('on its way', { timeout: 15_000 });

  // follow the link the email would carry: /reset-password with the token
  const token = latestResetToken();
  await page.goto(`/reset-password?token=${token}`);
  await page.locator('#password').fill('newpassword456');
  await page.locator('#confirm').fill('newpassword456');
  await page.getByRole('button', { name: 'set password' }).click();
  await expect(page.locator('#lead')).toContainText('Password updated', { timeout: 15_000 });

  // the new password signs in
  await signOut(page);
  await page.goto('/sign-in');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('newpassword456');
  await page.getByRole('button', { name: 'sign in', exact: true }).click();
  await page.waitForURL('**/account', { timeout: 30_000 });

  // the old password no longer works
  await signOut(page);
  await page.goto('/sign-in');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('password123');
  await page.getByRole('button', { name: 'sign in', exact: true }).click();
  await expect(page.locator('#msg')).not.toHaveText('', { timeout: 15_000 });
  await expect(page).toHaveURL(/\/sign-in/);
});
