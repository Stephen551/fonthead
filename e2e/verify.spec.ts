import { test, expect, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';

// Email confirmation, the gate that lets a Google sign-in attach to an existing
// password account. Soft mode: signup never blocks on it, but until the email is
// confirmed the account page nudges for it and a same-email Google sign-in is
// refused by Better Auth. These run against the dev server's local D1.

async function signUp(page: Page): Promise<string> {
  const stamp = `${Date.now()}${Math.floor(performance.now())}`;
  const email = `e2e-verify-${stamp}@example.test`;
  await page.goto('/sign-up');
  await page.locator('#name').fill('E2E Verify');
  await page.locator('#handle').fill(`e2everify${stamp}`);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('password123');
  await page.locator('#create').click();
  await page.waitForURL('**/account', { timeout: 30_000 });
  return email;
}

// Stand in for clicking the emailed confirm link (a self-contained JWT, not a row
// we can read): flip the flag the link would set, straight in local D1.
function markVerified(email: string) {
  // [user] is SQLite's bracket-quoted identifier form (user is a keyword); it
  // sidesteps nesting double quotes inside the double-quoted --command argument.
  execSync(
    `npx wrangler d1 execute DB --local --command "UPDATE [user] SET emailVerified = 1 WHERE email = '${email}'"`,
    { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
}

test('a new account is unconfirmed and the confirm banner can resend the link', async ({ page }) => {
  const email = await signUp(page);

  // fresh email/password account: unconfirmed, so the banner is up
  const banner = page.locator('#verifybanner');
  await expect(banner).toBeVisible();

  // resend works even without Resend wired locally (the send is best-effort, the
  // endpoint still reports success), so the user gets clear feedback
  await page.getByRole('button', { name: 'send confirmation link' }).click();
  await expect(page.locator('#verifymsg')).toContainText('sent', { timeout: 15_000 });

  // confirm the email (as the link would), reload: the banner is gone
  markVerified(email);
  await page.goto('/account');
  await expect(page.locator('#verifybanner')).toHaveCount(0);
});

test('a refused Google link explains how to connect and offers a resend', async ({ page }) => {
  // arrive as Better Auth would after refusing to link Google to an unconfirmed
  // same-email account: back on sign-in with ?error=account_not_linked
  await page.goto('/sign-in?error=account_not_linked');
  const help = page.locator('#linkhelp');
  await expect(help).toBeVisible();
  await expect(help).toContainText('Confirm your email to connect Google');

  // the resend needs the email; with it filled, it reports the link was sent
  await page.locator('#email').fill('someone@example.test');
  await page.getByRole('button', { name: 'send confirmation link' }).click();
  await expect(page.locator('#linkhelp-msg')).toContainText('sent', { timeout: 15_000 });
});

test('a generic OAuth error shows a plain retry message, not the link help', async ({ page }) => {
  await page.goto('/sign-in?error=invalid_code');
  await expect(page.locator('#linkhelp')).toBeHidden();
  await expect(page.locator('#msg')).toContainText('did not go through');
});
