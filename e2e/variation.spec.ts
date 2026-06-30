import { test, expect, type Page } from '@playwright/test';
import * as fontkitNs from 'fontkit';
import { writeFileSync } from 'node:fs';
import { verifySfntChecksums } from '../src/lib/sfnt';
import { isOtf } from '../src/lib/fontsig';

// Natural variation, end to end on a real 3-sheet same-hand palette: the maker
// merges the sheets into ONE valid font whose GSUB `calt` cycles a repeated
// letter through its variant glyphs. The headline proof shapes a repeated run
// with fontkit (a real shaper that applies calt) and asserts the run yields
// multiple distinct glyph ids — the variation actually happens, no pixels.

const BASE = 'e2e/fixtures/corpus/natural-variation-1.png';
const VAR2 = 'e2e/fixtures/corpus/natural-variation-2.png';
const VAR3 = 'e2e/fixtures/corpus/natural-variation-3.png';

const fontkit: any = (fontkitNs as any).create ? fontkitNs : (fontkitNs as any).default;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('fh-maker-tour-seen', '1');
      // No fh-test-no-autoconnect: the copperplate SHOULD auto-connect, so this
      // exercises the real path — connected cursive AND natural variation together
      // (the letters join AND a repeated letter cycles).
    } catch {
      /* private mode */
    }
  });
});

type LastBuild = { kind: string; glyphCount: number; otf: number; woff2: number; variants: number };
const buildDone = (page: Page) => expect(page.getByRole('button', { name: 'download otf' })).toBeVisible({ timeout: 120_000 });
const lastBuild = (page: Page) => page.evaluate(() => (window as unknown as { __lastBuild: LastBuild }).__lastBuild);

async function captureOtf(page: Page): Promise<Uint8Array> {
  const b64 = await page.evaluate(async () => {
    let blob: Blob | null = null;
    const orig = URL.createObjectURL;
    URL.createObjectURL = function (o: Blob | MediaSource) {
      if (o instanceof Blob) blob = o;
      return orig.call(URL, o);
    };
    const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'download otf');
    btn?.click();
    await new Promise((r) => setTimeout(r, 150));
    URL.createObjectURL = orig;
    if (!blob) return '';
    const buf = new Uint8Array(await (blob as Blob).arrayBuffer());
    let bin = '';
    const chunk = 8192;
    for (let i = 0; i < buf.length; i += chunk) bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)));
    return btoa(bin);
  });
  expect(b64.length, 'captured OTF bytes').toBeGreaterThan(0);
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

function assertValidFont(otf: Uint8Array, glyphCount: number) {
  expect(glyphCount).toBeGreaterThanOrEqual(60);
  expect(isOtf(otf), 'real OTF signature').toBe(true);
  const check = verifySfntChecksums(otf);
  expect(check.ok, `sfnt checksums valid: ${check.errors.join('; ')}`).toBe(true);
}

// Shape a run with fontkit, forcing `calt`, and return the glyph ids in order.
function shapeIds(otf: Uint8Array, text: string): number[] {
  const font = fontkit.create(Buffer.from(otf));
  const run = font.layout(text, ['calt']);
  return run.glyphs.map((g: any) => g.id);
}

test.describe('natural variation mode', () => {
  test('a 3-sheet palette cycles a repeated letter through variant glyphs', async ({ page }) => {
    test.setTimeout(220_000);
    await page.goto('/make');

    // enable natural variation (advanced panel) and reveal the variation slots
    await page.getByRole('button', { name: 'advanced' }).click();
    await page.getByRole('button', { name: /natural variation/ }).click();

    // base sheet builds a plain font first (no variants loaded yet)
    await page.locator('#sheet-file').setInputFiles(BASE);
    await buildDone(page);
    expect((await lastBuild(page)).variants, 'base build has no variants yet').toBe(0);

    // load the two extra same-hand sheets, then rebuild once -> merged palette
    await page.locator('#variation-file-0').setInputFiles(VAR2);
    await page.locator('#variation-file-1').setInputFiles(VAR3);
    await page.getByRole('button', { name: 'rebuild with these settings' }).click();
    await expect.poll(async () => (await lastBuild(page)).variants, { timeout: 150_000 }).toBe(2);

    const lb = await lastBuild(page);
    expect(lb.kind).toBe('mono');
    // connect ran on the MERGED palette, so the variant glyphs join too.
    const lc = await page.evaluate(() => (window as unknown as { __lastConnect?: { joined: number } }).__lastConnect);
    expect(lc?.joined ?? 0, 'connect joined the letters and their variants').toBeGreaterThan(20);
    const otf = await captureOtf(page);
    assertValidFont(otf, lb.glyphCount);
    writeFileSync('e2e/built-variation.otf', otf); // CI fontTools step asserts GSUB + calt on this

    // HEADLINE: a repeated run shapes to multiple distinct glyph ids. A plain
    // (no-calt) font would return the same id every time.
    const aIds = shapeIds(otf, 'aaaaaa');
    expect(new Set(aIds).size, `repeated a cycles (ids ${aIds.join(',')})`).toBeGreaterThanOrEqual(2);
    expect(aIds[0], 'second a differs from the first').not.toBe(aIds[1]);
    const mIds = shapeIds(otf, 'mmmmmm');
    expect(new Set(mIds).size, `repeated m cycles (ids ${mIds.join(',')})`).toBeGreaterThanOrEqual(2);
  });

  test('choosing all three sheets at once builds the cycling palette in one action', async ({ page }) => {
    test.setTimeout(220_000);
    await page.goto('/make');

    // No advanced panel, no toggle, no variation slots: selecting all three
    // same-hand sheets at once on the MAIN input loads the first as the base and
    // the next two as variations, auto-enables natural variation, and builds the
    // merged cycling palette in a single action.
    await page.locator('#sheet-file').setInputFiles([BASE, VAR2, VAR3]);
    // One build only (base + 2 variations merged in a single pass), so wait for
    // it to finish, then assert the palette merged — no intermediate plain build.
    await buildDone(page);
    const lb = await lastBuild(page);
    expect(lb.variants, 'one-shot load merged all three sheets').toBe(2);
    expect(lb.kind).toBe('mono');
    const otf = await captureOtf(page);
    assertValidFont(otf, lb.glyphCount);

    // Same headline proof: the one-shot build cycles a repeated letter.
    const aIds = shapeIds(otf, 'aaaaaa');
    expect(new Set(aIds).size, `repeated a cycles (ids ${aIds.join(',')})`).toBeGreaterThanOrEqual(2);
  });
});
