import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

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

// GPOS auto-kerning. Two truths under test: an upright face gets a real
// cross-browser GPOS kern table that the browser applies (AVATAR pulls
// together), and a script face whose swash overhangs already overlap
// declines to double-kern (widths identical with kerning on or off).

function sfntTags(p: string): string[] {
  const b = readFileSync(p);
  const n = b.readUInt16BE(4);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(b.toString('ascii', 12 + i * 16, 16 + i * 16).trim());
  return out;
}

async function downloadFmt(page: Page, fmt: string, to: string): Promise<string> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: `download ${fmt}` }).click(),
  ]);
  const p = test.info().outputPath(to);
  await download.saveAs(p);
  return p;
}

/** Measure the rendered width of a kern-sensitive string with kerning on/off.
 *  FontFace.load doubles as the OTS gate: Chrome rejects malformed GPOS. */
async function kernWidths(page: Page, otfPath: string): Promise<{ on: number; off: number }> {
  const b64 = readFileSync(otfPath).toString('base64');
  return page.evaluate(async (b) => {
    const bin = atob(b);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ff = new FontFace('kerncheck', bytes.buffer);
    await ff.load();
    document.fonts.add(ff);
    const mk = (kern: string) => {
      const s = document.createElement('span');
      s.style.cssText = `font-family:kerncheck;font-size:100px;font-kerning:${kern};white-space:nowrap;`;
      s.textContent = 'To AVATAR Way Ta Yo';
      document.body.appendChild(s);
      const w = s.getBoundingClientRect().width;
      s.remove();
      return w;
    };
    const out = { off: mk('none'), on: mk('normal') };
    document.fonts.delete(ff);
    return out;
  }, b64);
}

test('an upright build carries GPOS kerning the browser applies', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/make');
  await page.getByRole('button', { name: 'try a sample sheet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'download otf' })).toBeVisible({ timeout: 60_000 });
  const otf = await downloadFmt(page, 'otf', 'anton.otf');
  const ttf = await downloadFmt(page, 'ttf', 'anton.ttf');

  // the table is in both formats
  expect(sfntTags(otf)).toContain('GPOS');
  expect(sfntTags(ttf)).toContain('GPOS');

  // and the browser actually moves the pairs (OTS accepted the font)
  const w = await kernWidths(page, otf);
  expect(w.on).toBeLessThan(w.off * 0.99);
  expect(w.on).toBeGreaterThan(w.off * 0.85); // kerned, not crushed
});

test('a script face with swash overhangs does not get double-kerned', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/make');
  await page.locator('#sheet-file').setInputFiles('e2e/fixtures/chancery-sheet.png');
  await expect(page.getByRole('button', { name: 'download otf' })).toBeVisible({ timeout: 120_000 });
  const otf = await downloadFmt(page, 'otf', 'chancery.otf');

  // the overhang-aware analyzer sees the built-in overlap and emits nothing
  // (or close to it): kerning on must not visibly move the line
  const w = await kernWidths(page, otf);
  expect(Math.abs(w.on - w.off)).toBeLessThanOrEqual(w.off * 0.01);
});
