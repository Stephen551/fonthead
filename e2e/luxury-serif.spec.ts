import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import * as fontkit from 'fontkit';
import { auditAlphabet } from './alphabet-audit';
import { verifySfntChecksums } from '../src/lib/sfnt';

test('luxury serif keeps the y hook, complete hairline bearings and working kerning', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => localStorage.setItem('fh-maker-tour-seen', '1'));
  await page.goto('/make');
  await page.getByRole('button', { name: /advanced/ }).click();
  await page.getByLabel('spacing', { exact: true }).fill('5');
  await page.locator('#sheet-file').setInputFiles('e2e/fixtures/luxury-serif-sheet.png');
  await expect(page.getByRole('button', { name: 'download otf', exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('button', { name: /connected cursive/ })).toHaveAttribute('aria-pressed', 'false');
  const fonts: any[] = [];
  for (const format of ['otf', 'ttf', 'woff2']) {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: `download ${format}`, exact: true }).click();
    const file = test.info().outputPath(`elegant-display.${format}`);
    await (await pending).saveAs(file);
    const bytes = readFileSync(file);
    if (format !== 'woff2') expect(verifySfntChecksums(new Uint8Array(bytes)).ok).toBe(true);
    const font = fontkit.create(bytes); fonts.push(font);
    const y = font.glyphForCodePoint(121).bbox, x = font.glyphForCodePoint(120).bbox;
    // The supplied y is 107px high against a ~71px x-height. The old valley
    // crop reduced it to ~97px and removed the curled terminal (ratio ~1.37).
    expect((y.maxY - y.minY) / (x.maxY - x.minY)).toBeGreaterThan(1.48);
    expect((y.maxY - y.minY) / (x.maxY - x.minY)).toBeLessThan(1.56);
    expect(y.minY).toBeLessThan(-210);
    expect(font.characterSet.filter((cp: number) => ![0, 32, 65535].includes(cp))).toHaveLength(92);
    for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') {
      const g = font.glyphForCodePoint(c.codePointAt(0)!);
      const left = g.bbox.minX, right = g.advanceWidth - g.bbox.maxX;
      expect(Math.abs(left - right), `${format} ${c} balanced complete-ink bearings`).toBeLessThan(3);
      expect(left, `${format} ${c} side bearing`).toBeGreaterThan(40);
    }
    const kerned = font.layout('AVATAR To VOGUE', ['kern']).positions.reduce((n: number, p: any) => n + p.xAdvance, 0);
    const plain = [...'AVATAR To VOGUE'].reduce((n, c) => n + font.glyphForCodePoint(c.codePointAt(0)!).advanceWidth, 0);
    expect(kerned).toBeLessThan(plain - 30);
  }
  const audit = await auditAlphabet(page, fonts[2]);
  writeFileSync(test.info().outputPath('alphabet-audit.json'), JSON.stringify(audit, null, 2));
  for (const pair of audit.pairs) expect(pair.clearance, `${pair.pair} does not collide`).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as any).__lastBuild.glyphCount)).toBe(92);
});
