import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import * as fontkit from 'fontkit';
import { verifySfntChecksums } from '../src/lib/sfnt';
import { ACCENT_ROWS, LEGACY_ACCENT_ROWS as fixtureRows } from './extended-latin-fixture';

// The supplied image predates the paired D/eth + sharp-s preset. Map its art
// honestly; adding characters to the new preset must not relabel old drawings.
const basePath = 'e2e/fixtures/luxury-serif-sheet.png';

test.beforeEach(async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(rows => {
    localStorage.setItem('fh-maker-tour-seen', '1');
    localStorage.setItem('fh-test-no-autoconnect', '1');
    localStorage.setItem('fh-gen-charset-supplement', JSON.stringify(rows));
  }, fixtureRows);
});

async function ready(page: Page) {
  await expect(page.getByRole('button', { name: 'download woff2', exact: true })).toBeVisible({ timeout: 150_000 });
}
async function exported(page: Page, format: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: `download ${format}`, exact: true }).click();
  const path = test.info().outputPath(`combined.${format}`);
  await (await pending).saveAs(path);
  const bytes = readFileSync(path);
  if (format !== 'woff2') expect(verifySfntChecksums(bytes).ok).toBe(true);
  return fontkit.create(bytes) as any;
}
async function assertBodySizes(page: Page, font: any) {
  const paths: Record<string, string> = Object.fromEntries([...'eéEÉ'].map(c => [c, font.glyphForCodePoint(c.codePointAt(0)).path.toSVG()]));
  const heights = await page.evaluate(paths => Object.fromEntries(Object.entries(paths).map(([c, d]) => {
    const boxes = d.split(/(?=M)/).filter(Boolean).map(d => (window as any).svgPathToOpentypePath(d, (x: number, y: number) => [x, y], false).getBoundingBox());
    const main = boxes.reduce((a: any, b: any) => (a.x2-a.x1)*(a.y2-a.y1) > (b.x2-b.x1)*(b.y2-b.y1) ? a : b);
    return [c, main.y2-main.y1];
  })), paths);
  expect(Math.abs(heights['é'] / heights.e - 1), 'é body matches e').toBeLessThan(.02);
  expect(Math.abs(heights['É'] / heights.E - 1), 'É body matches E').toBeLessThan(.02);
}

test('separate supplement exports base plus all 119 characters, matches sizes and survives re-slicing', async ({ page }) => {
  const events: any[] = [];
  page.on('request', req => { if (req.url().includes('/_actions/trackFunnel')) events.push(req.postDataJSON()); });
  await page.goto('/make');
  await expect(page.getByRole('group', { name: 'Accents sheet', exact: true })).toBeVisible();
  await page.locator('#sheet-file').setInputFiles(basePath); await ready(page);
  await page.locator('#supplement-file').setInputFiles('e2e/fixtures/extended-latin-sheet.png'); await ready(page);
  await expect(page.getByLabel('Accents sheet character rows')).toHaveValue(fixtureRows.join('\n'));
  expect(await page.getByRole('alert').allTextContents()).toEqual([]);
  await expect(page.getByRole('group', { name: 'Sheet 2 · accents', exact: true }).getByRole('listitem')).toHaveCount(119);
  const chars = [...new Set('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' + fixtureRows.join(''))];
  for (const format of ['otf','ttf','woff2']) {
    const font = await exported(page, format);
    const glyphs = chars.map(c => font.glyphForCodePoint(c.codePointAt(0)));
    expect(glyphs.every(g => g.id > 0 && g.path.commands.length > 0)).toBe(true);
    expect(new Set(glyphs.map(g=>g.id)).size).toBe(chars.length);
    if (format !== 'ttf') expect(new Set(glyphs.map(g=>g.name)).size).toBe(chars.length);
    await assertBodySizes(page, font);
  }
  expect(events).toContainEqual(expect.objectContaining({event:'build_ok', meta:'mono+accents', source:'upload'}));
  const group = page.getByRole('group', {name:'Sheet 2 · accents', exact:true});
  await group.getByRole('combobox').nth(3).selectOption('whitespace');
  await group.getByRole('button', {name:'re-slice',exact:true}).nth(3).click();
  await expect(group.getByRole('button', {name:'slicing…',exact:true})).toHaveCount(0, {timeout:120_000});
  const after = await exported(page,'woff2');
  await assertBodySizes(page,after);
  expect(after.glyphForCodePoint(0xe9).id).toBeGreaterThan(0);
  await page.getByRole('button', {name:'Remove accents sheet', exact:true}).click(); await ready(page);
  expect((await exported(page,'woff2')).hasGlyphForCodePoint(0xe9)).toBe(false);
});

test('base variations remain alternates while supplement letters stay ordinary', async ({ page }) => {
  await page.goto('/make');
  await expect(page.getByRole('group', {name:'Accents sheet',exact:true})).toBeVisible();
  await page.locator('#sheet-file').setInputFiles([basePath,basePath]); await ready(page);
  await page.locator('#supplement-file').setInputFiles('e2e/fixtures/extended-latin-sheet.png'); await ready(page);
  await expect(page.getByRole('group', {name:'Sheet 3 · accents',exact:true})).toBeVisible();
  const font = await exported(page,'woff2');
  expect(new Set(font.layout('aaaa').glyphs.map((g:any)=>g.name))).toEqual(new Set(['a','a.cv01']));
  expect(new Set(font.layout('éééé').glyphs.map((g:any)=>g.name))).toEqual(new Set(['uni00E9']));
  await page.getByRole('group', {name:'Sheet 1 · base alphabet',exact:true}).getByRole('button', {name:'re-slice',exact:true}).first().click();
  await expect(page.getByRole('button', {name:'slicing…',exact:true})).toHaveCount(0, {timeout:120_000});
  const after = await exported(page,'woff2');
  expect(new Set(after.layout('aaaa').glyphs.map((g:any)=>g.name))).toEqual(new Set(['a','a.cv01']));
  expect(new Set(after.layout('éééé').glyphs.map((g:any)=>g.name))).toEqual(new Set(['uni00E9']));
});

test('Extended Latin prompt arms its own paired charset and supplement controls fit all screen sizes', async ({ page }) => {
  await page.goto('/make');
  await page.locator('[data-preset="standard"]').click();
  const before = await page.evaluate(()=>localStorage.getItem('fh-gen-charset'));
  await expect(page.locator('[data-preset="latin-ext"]')).toBeVisible();
  await page.locator('[data-preset="latin-ext"]').click();
  await expect(page.locator('#gen-prompt')).toContainText('Attach your first alphabet sheet');
  await expect(page.locator('#gen-prompt')).toContainText('a full letter height of blank space between rows');
  const stored = await page.evaluate(()=>({base:localStorage.getItem('fh-gen-charset'),supp:JSON.parse(localStorage.getItem('fh-gen-charset-supplement')!)}));
  expect(stored.base).toBe(before);
  expect(stored.supp).toEqual(ACCENT_ROWS);
  expect(stored.supp.join('')).toContain('ĐÐ');
  expect(stored.supp.join('')).toContain('đð');
  expect(stored.supp.join('')).toContain('ß');
  expect(new Set(stored.supp.join('')).size).toBe(122);
  const slot = page.getByRole('group', {name:'Accents sheet',exact:true});
  for (const width of [375,768,1280]) {
    await page.setViewportSize({width,height:1000});
    await slot.scrollIntoViewIfNeeded();
    expect(await slot.evaluate(el=>{ const r=el.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth; })).toBe(true);
    await slot.screenshot({path:test.info().outputPath(`supplement-${width}.png`)});
  }
  const choose = page.getByRole('button',{name:'Choose accents sheet',exact:true});
  await choose.focus(); await expect(choose).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Accents sheet character rows')).toBeFocused();
  await page.getByRole('button', {name:'advanced'}).click();
  await page.getByRole('button', {name:'connected cursive', exact:true}).click();
  await expect(choose).toBeDisabled();
  await expect(slot).toContainText('Turn off connected cursive');
  await page.getByRole('button',{name:'color · flat',exact:true}).click();
  await expect(slot).toHaveCount(0);
});
