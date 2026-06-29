import { test, expect } from '@playwright/test';

// The maker onboarding: the walkthrough auto-shows on a first visit, dismisses,
// retriggers from the tutorial button, and closes on Escape. The generate-a-sheet
// prompt reflects the chosen or typed style. (Fresh context, so it is "first run".)
test('walkthrough shows, dismisses, retriggers; prompt builder reflects the style', async ({ page }) => {
  await page.goto('/make');

  const tour = page.locator('#maker-tour');
  await expect(tour).toBeVisible();

  await page.getByRole('button', { name: 'got it', exact: true }).click();
  await expect(tour).toBeHidden();

  // retrigger from the tutorial button, then close with Escape
  await page.getByRole('button', { name: 'tutorial', exact: true }).click();
  await expect(tour).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tour).toBeHidden();

  // a style chip fills the prompt (standard preset)
  await page.getByRole('button', { name: 'art deco', exact: true }).click();
  await expect(page.locator('#gen-prompt')).toContainText('condensed art deco display');

  // a typed style updates the prompt live
  await page.locator('#gen-extra').fill('pixel bitmap');
  await expect(page.locator('#gen-prompt')).toContainText('pixel bitmap');

  // switching preset swaps the whole prompt and its fill slot
  await page.getByRole('button', { name: 'flat color', exact: true }).click();
  await expect(page.locator('#gen-prompt')).toContainText('COLRv0 FLAT-LAYER builder');
  await page.locator('#gen-extra').fill('charcoal, red, cream');
  await expect(page.locator('#gen-prompt')).toContainText('charcoal, red, cream');

  // the script preset prompts for a cursive whose connecting stroke is on the
  // RIGHT side only, with a clean left start (the maker joins the letters)
  await page.getByRole('button', { name: 'script', exact: true }).click();
  await expect(page.locator('#gen-prompt')).toContainText('cursive');
  await expect(page.locator('#gen-prompt')).toContainText('RIGHT side only');
  await expect(page.locator('#gen-prompt')).toContainText('CLEAN START');
});
