import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import * as fontkit from 'fontkit';
import { verifySfntChecksums } from '../src/lib/sfnt';
import { auditAlphabet } from './alphabet-audit';

test('auto-levels the uneven serif sheet in the exported font', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('fh-maker-tour-seen', '1');
  });
  await page.goto('/make');
  await page.getByRole('button', { name: 'advanced' }).click();
  await expect(page.getByRole('button', { name: /connected cursive/ })).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#sheet-file').setInputFiles('e2e/fixtures/uneven-serif-sheet.png');
  await expect(page.getByRole('button', { name: 'download otf' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: /connected cursive/ })).toHaveAttribute('aria-pressed', 'false');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'download otf' }).click(),
  ]);
  const file = test.info().outputPath('aligned.otf');
  await download.saveAs(file);
  const bytes = new Uint8Array(readFileSync(file));
  expect(verifySfntChecksums(bytes).ok).toBe(true);
  const metrics = await page.evaluate((b64) => {
    const w = window as any;
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const font = w.opentype.parse(bytes.buffer);
    const boxes = Object.fromEntries(Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', (c) => [c, font.charToGlyph(c).getBoundingBox()]));
    return { boxes, alignment: w.__lastBaseline, glyphCount: w.__lastBuild.glyphCount };
  }, Buffer.from(bytes).toString('base64'));
  writeFileSync(test.info().outputPath('metrics.json'), JSON.stringify(metrics, null, 2));
  expect(metrics.glyphCount).toBeGreaterThanOrEqual(62);
  const xh = metrics.boxes.x.y2 - metrics.boxes.x.y1;
  // A subpixel source-space dead zone still becomes a visible one-pixel
  // step at the maker's 60px preview size (notably d beside a/n/m/e).
  for (const c of 'Handmade') expect(Math.abs(metrics.boxes[c].y1), `${c} exact baseline`).toBeLessThan(1);
  // The original sheet puts v/w ~75 units below the baseline and 8 ~87
  // units below. All non-descending lowercase and digits should now sit.
  for (const c of 'ABCDEFGHIJKLMNOPSTUVWXYZabcdefhiklmnorstuvwxz0123456789') {
    expect(Math.abs(metrics.boxes[c].y1), `${c} bottom`).toBeLessThan(1);
  }
  for (const c of 'gjpqyQR') expect(metrics.boxes[c].y1, `${c} descent`).toBeLessThan(-xh * 0.15);
  expect(metrics.alignment.adjustments.some((a: any) => a.shift > 1)).toBe(true);
  expect(metrics.alignment.adjustments.some((a: any) => a.shift < -1)).toBe(true);

  // Verify the webfont the user actually installs on a site, using a second
  // font parser rather than the engine that generated it.
  const [webfont] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'download woff2' }).click(),
  ]);
  const webfile = test.info().outputPath('aligned.woff2');
  await webfont.saveAs(webfile);
  const font = fontkit.create(readFileSync(webfile));
  for (const c of 'aefgjpqrvwxy08') {
    const box = font.glyphForCodePoint(c.codePointAt(0)!).bbox;
    expect(box.minY, `${c} WOFF2 baseline`).toBeCloseTo(metrics.boxes[c].y1, 0);
    expect(box.maxY, `${c} WOFF2 top`).toBeCloseTo(metrics.boxes[c].y2, 0);
  }
  const audit = await auditAlphabet(page, font);
  writeFileSync(test.info().outputPath('alphabet-audit.json'), JSON.stringify(audit, null, 2));
  expect(audit.letters).toHaveLength(52);
  expect(audit.pairs).toHaveLength(2704);
  for (const g of audit.letters) {
    expect(g.advance, `${g.char} positive advance`).toBeGreaterThan(0);
    if (!'QRgjpqy'.includes(g.char)) expect(Math.abs(g.bottom), `${g.char} baseline`).toBeLessThan(1);
  }
  // R's left stem sits on the baseline; its right leg deliberately descends.
  expect(Math.abs(audit.stemBottoms.R), 'R stem baseline').toBeLessThanOrEqual(2);
  for (const c of 'pqy') expect(Math.abs(metrics.boxes[c].y2 - xh), `${c} body on x-height`).toBeLessThan(xh * 0.06);
  expect(Math.abs(audit.bodyTops.g - audit.bodyTops.o), 'g bowl on lowercase body line').toBeLessThan(xh * 0.08);
  expect(Math.abs(metrics.boxes.j.y2 - metrics.boxes.i.y2), 'j dot aligns with i').toBeLessThan(xh * 0.06);
  expect(Math.abs(metrics.boxes.Q.y2 - metrics.boxes.H.y2), 'Q body on cap line').toBeLessThan(xh * 0.06);
  for (const pair of audit.pairs) {
    expect(pair.clearance, `${pair.pair} ink clearance`).toBeGreaterThan(0);
    expect(pair.clearance, `${pair.pair} excessive gap`).toBeLessThan(xh * 0.4);
  }
});
