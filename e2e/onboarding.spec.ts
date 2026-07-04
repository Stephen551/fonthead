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

  // the script preset defaults to ONE sheet (a single cursive font), whose letters
  // stay SEPARATE with a clear gap (the maker joins them itself); the "three
  // versions" chip swaps to the natural-variation palette prompt
  await page.getByRole('button', { name: 'script', exact: true }).click();
  await expect(page.locator('#gen-prompt')).toContainText('cursive');
  await expect(page.locator('#gen-prompt')).toContainText('One sheet, exactly SIX rows');
  await expect(page.locator('#gen-prompt')).toContainText('SEPARATE');
  await page.getByRole('button', { name: 'three versions', exact: true }).click();
  await expect(page.locator('#gen-prompt')).toContainText('THREE versions of the SAME hand');
  // and re-entering the preset resets to the one-sheet default
  await page.getByRole('button', { name: 'standard', exact: true }).click();
  await page.getByRole('button', { name: 'script', exact: true }).click();
  await expect(page.locator('#gen-prompt')).toContainText('One sheet, exactly SIX rows');
});
