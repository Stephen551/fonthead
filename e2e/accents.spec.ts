import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import * as fontkit from 'fontkit';
import { verifySfntChecksums } from '../src/lib/sfnt';

export const ACCENT_ROWS = [
  'ÀÁÂÃÄÅĀĂĄÆÇĆČĎĐÈÉ', 'ÊËĒĖĘÌÍÎÏĪŁÑÒÓÔÕÖ', 'ØŒŔŘŚŠŤÙÚÛÜŪŮÝŸŽŻ',
  'àáâãäåāăąæçćčďðèé', 'êëēėęìíîïīłñòóôõö', 'øœŕřśšťùúûüūůýÿžż', '¡¿“”‘’«»–—…€£¥©®™',
];

test.beforeEach(async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    localStorage.setItem('fh-maker-tour-seen', '1');
    localStorage.setItem('fh-test-no-autoconnect', '1');
  });
});

async function download(page: Page, format: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: `download ${format}`, exact: true }).click();
  const path = test.info().outputPath(`accents.${format}`);
  await (await pending).saveAs(path);
  const bytes = readFileSync(path);
  if (format !== 'woff2') expect(verifySfntChecksums(bytes).ok).toBe(true);
  return { bytes, font: fontkit.create(bytes) as any };
}

test('the supplied extended Latin sheet keeps marks, Unicode mappings and baselines in every format', async ({ page }) => {
  await page.addInitScript(rows => localStorage.setItem('fh-gen-charset', JSON.stringify(rows)), ACCENT_ROWS.map(r => r.normalize('NFD')));
  await page.goto('/make');
  await page.locator('#sheet-file').setInputFiles('e2e/fixtures/extended-latin-sheet.png');
  await expect(page.getByRole('button', { name: 'download woff2', exact: true })).toBeVisible({ timeout: 120_000 });
  expect(await page.getByRole('alert').allTextContents()).toEqual([]);
  await expect(page.getByRole('listitem')).toHaveCount(119);
  let webBytes: Buffer = Buffer.alloc(0);
  for (const format of ['otf', 'ttf', 'woff2']) {
    const { font, bytes } = await download(page, format);
    if (format === 'woff2') webBytes = bytes;
    const ids = new Set<number>(), names = new Set<string>();
    for (const char of ACCENT_ROWS.join('')) {
      const g = font.glyphForCodePoint(char.codePointAt(0));
      expect(g.id, char).toBeGreaterThan(0);
      expect(g.path.commands.length, char).toBeGreaterThan(0);
      ids.add(g.id); if (format !== 'ttf') names.add(g.name);
    }
    expect(ids.size).toBe(119);
    if (format !== 'ttf') expect(names.size).toBe(119);
    // Widths are judged as if the tallest glyph stood at 800 units, so the
    // limit holds however the font is scaled (ADR 0072: accents no longer set
    // the scale, and this sheet's plain ink is only symbols).
    const tallest = Math.max(...[...ACCENT_ROWS.join('')].map(c => font.glyphForCodePoint(c.codePointAt(0)).bbox.maxY));
    for (const [char, count] of [['é', 3], ['ñ', 2], ['ü', 3], ['Å', 4], ['ď', 3], ['ť', 2]] as const) {
      const g = font.glyphForCodePoint(char.codePointAt(0));
      expect(g.path.commands.filter((c: any) => c.command === 'moveTo').length, `${format} ${char} contours`).toBe(count);
      expect((g.bbox.maxX - g.bbox.minX) * 800 / tallest, `${char} no foreign fragment`).toBeLessThan(700);
    }
    for (const char of 'ÀÁÂÃÄÅĀĂĆČĎÈÉÊËĒĖÌÍÎÏĪÑÒÓÔÕÖŔŘŚŠŤÙÚÛÜŪŮÝŸŽŻàáâãäåāăćčďèéêëēėìíîïīñòóôõöŕřśšťùúûüūůžż') {
      expect(Math.abs(font.glyphForCodePoint(char.codePointAt(0)).bbox.minY), `${format} ${char} baseline`).toBeLessThan(2);
    }
    for (const char of 'ĄÇĘąçęýÿ') expect(font.glyphForCodePoint(char.codePointAt(0)).bbox.minY, char).toBeLessThan(-60);
  }
  // Chromium shaping must render canonically equivalent text identically.
  const rendered = await page.evaluate(async b64 => {
    const face = await new FontFace('AccentProof', Uint8Array.from(atob(b64), c => c.charCodeAt(0))).load();
    document.fonts.add(face);
    const render = (text: string) => {
      const c = document.createElement('canvas'); c.width = 900; c.height = 160;
      const ctx = c.getContext('2d')!; ctx.font = '70px AccentProof'; ctx.fillText(text, 10, 100);
      return c.toDataURL();
    };
    return [render('éñüç'), render('éñüç'.normalize('NFD'))];
  }, webBytes.toString('base64'));
  expect(rendered[1]).toBe(rendered[0]);
  const group = page.getByRole('group', { name: 'Sheet 1 · base alphabet', exact: true });
  await group.getByRole('combobox').nth(3).selectOption('whitespace');
  await group.getByRole('button', { name: 're-slice', exact: true }).nth(3).click();
  await expect(group.getByRole('button', { name: 'slicing…', exact: true })).toHaveCount(0, { timeout: 120_000 });
  const after = (await download(page, 'woff2')).font;
  expect(after.glyphForCodePoint(0x010f).path.commands.filter((c: any) => c.command === 'moveTo')).toHaveLength(3);
});

for (const mode of ['flat', 'gradient'] as const) test(`${mode} color keeps accents and aligns their bodies after edits`, async ({ page }) => {
  await page.goto('/make');
  const result = await page.evaluate(async mode => {
    const makerPath = '/src/lib/maker.ts'; const m = await import(makerPath);
    await m.waitForEngine(); await m.waitForColorEngine();
    const rows = ['HBE', 'mnxzencu', 'éñüç'];
    const canvas = document.createElement('canvas'); canvas.width = 1100; canvas.height = 600;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1100, 600);
    ctx.font = '100px Georgia';
    rows.forEach((row, r) => [...row].forEach((char, i) => {
      const y = 140 + r * 180 + (r === 2 ? [18, -12, 10, 20][i] : 0);
      const gradient = ctx.createLinearGradient(0, y - 100, 0, y); gradient.addColorStop(0, '#b6183b'); gradient.addColorStop(1, '#184cbd');
      ctx.fillStyle = gradient; ctx.fillText(char, 25 + i * 130, y);
    }));
    const built = await m.buildColorFontFromImage(await m.canvasToImage(canvas), mode, 'Accent Color', rows.map(r => r.normalize('NFD')), { K: 3, stops: 3, bgDist: 20, fineDetail: true });
    const edited = await (window as any).ColorMaker.editGlyph('exclude', 0, { excluded: true });
    return { before: Array.from(built.otf as Uint8Array), after: Array.from(edited.otf as Uint8Array), warning: built.rowWarning };
  }, mode);
  expect(result.warning).toBeFalsy();
  for (const bytes of [result.before, result.after]) {
    const font: any = fontkit.create(Buffer.from(bytes));
    // Fontkit caches COLR wrappers in getGlyph. Read fallback CFF contours
    // from an independent instance so that cache cannot hide the base paths.
    const baseFont: any = fontkit.create(Buffer.from(bytes));
    for (const char of 'éñüç') expect(font.glyphForCodePoint(char.codePointAt(0)).id, char).toBeGreaterThan(0);
    for (const [char, count] of [['é', 3], ['ñ', 2], ['ü', 3]] as const) {
      const g = baseFont._getBaseGlyph(font.glyphForCodePoint(char.codePointAt(0)).id);
      expect(g.path.commands.filter((c: any) => c.command === 'moveTo').length, char).toBe(count);
      expect(Math.abs(g.bbox.minY), char).toBeLessThan(5);
    }
    const c = baseFont._getBaseGlyph(font.glyphForCodePoint(0x00e7).id), e = baseFont._getBaseGlyph(font.glyphForCodePoint(0x00e9).id);
    expect(c.bbox.minY).toBeLessThan(-60);
    expect(c.bbox.maxY).toBeLessThan(e.bbox.maxY - 50);
  }
});

test('accented natural variation substitutes only the matching character', async ({ page }) => {
  await page.goto('/make');
  const bytes = await page.evaluate(async () => {
    const makerPath = '/src/lib/maker.ts'; const m = await import(makerPath); await m.waitForEngine();
    const base = [...'éñüç'].map((char, i) => ({ char, italic: false, cellW: 80, cellH: 120, baselineYInCell: 100,
      paths: [`M10 30L${40 + i * 5} 30L${40 + i * 5} 100L10 100Z M20 5L30 5L30 15L20 15Z`] }));
    const variants = base.map(g => ({ ...g, paths: g.paths.map(d => m.translatePathX(d, 2)) }));
    const built = await m.buildFont(m.mergeVariantSheets([base, variants]), { family: 'Accented Variants', naturalVariation: true });
    return Array.from(built.woff2 as Uint8Array);
  });
  const font: any = fontkit.create(Buffer.from(bytes));
  for (const char of 'éñüç') {
    const name = `uni${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;
    const names = font.layout(char.repeat(4)).glyphs.map((g: any) => g.name);
    expect(new Set(names)).toEqual(new Set([name, `${name}.cv01`]));
  }
});
