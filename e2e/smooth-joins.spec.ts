import { test, expect } from '@playwright/test';
import * as fontkitNs from 'fontkit';
import { readFileSync, mkdirSync } from 'node:fs';
import { verifySfntChecksums } from '../src/lib/sfnt';

const fontkit: any = (fontkitNs as any).create ? fontkitNs : (fontkitNs as any).default;
const CHARSET = ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', 'abcdefghijklm', 'nopqrstuvwxyz', '0123456789', '.,!?:;\'"-&@#'];

for (const mode of ['auto', 'smooth'] as const) test(`${mode} join fit exports continuous contextual strokes`, async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript((charset) => {
    localStorage.setItem('fh-maker-tour-seen', '1');
    localStorage.setItem('fh-gen-charset', JSON.stringify(charset));
  }, CHARSET);
  await page.goto('/make');
  await page.getByRole('button', { name: 'advanced' }).click();
  await page.getByRole('button', { name: /connected cursive/ }).click();
  const smooth = page.getByLabel('Join style');
  await expect(smooth).toHaveValue('auto');
  if (mode === 'smooth') await smooth.selectOption('smooth');
  await page.locator('#font-name').fill('Elegant Script');
  const sheet = mode === 'auto' ? 'black-script' : 'elegant-script';
  await page.locator('#sheet-file').setInputFiles(`e2e/fixtures/${sheet}.png`);
  await page.waitForFunction(() => (window as any).__lastBuild || document.querySelector('[role="alert"]'), undefined, { timeout: 150_000 });
  expect(await page.getByRole('alert').allTextContents()).toEqual([]);
  await expect(page.getByRole('button', { name: 'download otf', exact: true })).toBeVisible({ timeout: 150_000 });
  const diag = await page.evaluate(() => (window as any).__lastSmooth);
  expect(diag.joined).toBe(26);
  expect(diag.compact).toBe(mode === 'auto');
  if (mode === 'auto') await expect(page.getByText('Lowercase joins tightened and smoothed.', { exact: true })).toBeVisible();
  const output = `test-results/${sheet}-export`;
  mkdirSync(output, { recursive: true });
  const bytes: Record<string, Buffer> = {};
  for (const format of ['otf', 'ttf', 'woff2']) {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: `download ${format}`, exact: true }).click(),
    ]);
    const path = `${output}/font.${format}`;
    await download.saveAs(path);
    bytes[format] = readFileSync(path);
    if (format !== 'woff2') expect(verifySfntChecksums(bytes[format]).errors).toEqual([]);
    const font = fontkit.create(bytes[format]);
    for (const c of CHARSET.join('')) expect(font.hasGlyphForCodePoint(c.codePointAt(0)), `${format} has ${c}`).toBe(true);
    // The TTF converter omits PostScript glyph names, but preserves GIDs.
    const named = fontkit.create(bytes.otf);
    const names = (text: string) => font.layout(text).glyphs.map((g: any) => named.getGlyph(g.id).name);
    expect(names('anna')).toEqual(['a.jn01', 'n.jn03', 'n.jn03', 'a.jn02']);
    expect(names('a n')).toEqual(['a', 'space', 'n']);
    expect(names('a,n')).toEqual(['a', 'comma', 'n']);
    if (mode === 'smooth') expect(names('El')).toEqual(['E.jn01', 'l.jn02']);
    if (mode === 'auto') {
      // Standard connected placement used 5.86 em on this specimen.
      const width = font.layout('Handmade').advanceWidth / font.unitsPerEm;
      expect(width).toBeGreaterThan(4.3);
      expect(width).toBeLessThan(5);
    }
    expect(names('a')).toEqual(['a']);
  }
  const font = fontkit.create(bytes.otf);
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const pairs = [...letters].flatMap(l => [...letters].map(r => {
    const run = font.layout(l + r);
    return { text: l + r, ids: run.glyphs.map((g: any) => g.id), advance: run.positions[0].xAdvance };
  }));
  const disconnected = await page.evaluate(({ b64, pairs }) => {
    const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const font = (window as any).opentype.parse(raw.buffer);
    const scale = 0.4, width = 900, height = 700;
    const raster = (id: number, x: number) => {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      font.glyphs.get(id).getPath(100 + x * scale, 430, font.unitsPerEm * scale).draw(ctx);
      return ctx.getImageData(0, 0, width, height).data;
    };
    // Each exit and entry is measured independently; overlap in their actual
    // exported outlines proves that the composed pair has no daylight seam.
    const leftCache = new Map<number, Uint8ClampedArray>();
    const missing: string[] = [];
    for (const pair of pairs) {
      if (!leftCache.has(pair.ids[0])) leftCache.set(pair.ids[0], raster(pair.ids[0], 0));
      const left = leftCache.get(pair.ids[0])!, right = raster(pair.ids[1], pair.advance);
      let touches = false;
      const seam = Math.round(100 + pair.advance * scale);
      for (let y = 300; y < 440 && !touches; y++) for (let x = seam - 6; x <= seam + 6; x++) {
        const i = (y * width + x) * 4 + 3;
        if (left[i] > 127 && right[i] > 127) { touches = true; break; }
      }
      if (!touches) missing.push(pair.text);
    }
    return missing;
  }, { b64: bytes.otf.toString('base64'), pairs });
  expect(disconnected, 'all 676 lowercase pairs overlap at their common join').toEqual([]);

  await page.getByRole('textbox', { name: 'Type to preview your font' }).fill('Elegant script flows beautifully');
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 1100 });
    await smooth.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/maker-${width}.png` });
    await expect.poll(() => page.evaluate(() => ({
      width: innerWidth,
      // Scope this feature's layout guard to the maker. The existing global
      // sign-in navigation overflows at 768px independently of this control.
      overflow: [...document.querySelectorAll<HTMLElement>('.fh-maker-grid *')]
        // Letter previews crop the full sheet inside a small SVG viewport.
        // The viewport participates in layout; its clipped bitmap does not.
        .filter(e => !(e instanceof SVGImageElement && e.ownerSVGElement && getComputedStyle(e.ownerSVGElement).overflow === 'hidden'))
        .filter(e => e.getBoundingClientRect().right > innerWidth + 1)
        .map(e => ({ tag: e.tagName, text: e.textContent?.slice(0, 60), right: e.getBoundingClientRect().right })),
    }))).toEqual({ width, overflow: [] });
  }
  if (mode === 'auto') {
    await smooth.selectOption('standard');
    await page.getByRole('button', { name: 'rebuild with these settings' }).click();
    await expect(page.getByText('Standard cursive placement applied.', { exact: true })).toBeVisible({ timeout: 90_000 });
    expect(await page.evaluate(() => (window as any).__lastSmooth)).toBeNull();
  }
});
