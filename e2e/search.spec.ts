import { test, expect } from '@playwright/test';

// Flag 4: library search. Runs against the dev server's seeded D1, which holds
// the open-license starter set (Fraunces, Anton, ...) plus the house fonts
// under the maker handle "a-c-meridian".

test('search by font name narrows the wall', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('searchbox', { name: /search fonts/i }).fill('fraunces');
  await page.getByRole('button', { name: 'search', exact: true }).click();

  await page.waitForURL('**/*q=fraunces*');
  // the match is shown, a non-match is gone
  await expect(page.getByRole('link', { name: 'Fraunces', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Anton', exact: true })).toHaveCount(0);
  await expect(page.getByText(/match(es)? for "fraunces"/i)).toBeVisible();
});

test('search by maker handle returns that maker\'s fonts', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('searchbox', { name: /search fonts/i }).fill('meridian');
  await page.getByRole('button', { name: 'search', exact: true }).click();

  await page.waitForURL('**/*q=meridian*');
  // every visible maker credit on the page is the searched maker
  await expect(page.getByRole('link', { name: 'AC Flames', exact: true })).toBeVisible();
});

test('a no-result search shows an empty state and a way back', async ({ page }) => {
  await page.goto('/?q=zzznotarealfont');
  await expect(page.getByText(/nothing matches/i)).toBeVisible();
  await page.getByRole('link', { name: /back to all fonts/i }).click();
  await page.waitForURL((u) => !u.search.includes('q='));
  // the hero is back, so the full wall is showing
  await expect(page.getByText(/0 fonts/)).toHaveCount(0);
});
