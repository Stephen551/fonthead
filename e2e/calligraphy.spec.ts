import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import * as fontkit from 'fontkit';
import { verifySfntChecksums } from '../src/lib/sfnt';

test('calligraphy auto slicing keeps overlapping swashes and detached strokes in their own cells', async ({ page }) => {
  await page.goto('/make');
  const result = await page.evaluate(async b64 => {
    const moduleUrl = '/src/lib/maker.ts';
    const m = await import(/* @vite-ignore */ moduleUrl) as typeof import('../src/lib/maker');
    await m.waitForEngine();
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const rows = ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', 'abcdefghijklm', 'nopqrstuvwxyz', '0123456789', '!?@#$%^&*()-_+=[]', `{};:'",.<>/\\|`];
    const trace = await m.traceSheet(img, rows, { ...m.TRACE_PRESETS.glyph, fineDetail: true });
    const font = await m.buildFont(trace.glyphs, { family: 'Elegant Calligraphy', trimFlourishes: true, formats: ['otf', 'ttf', 'woff2'] });
    return { rows: trace.rows.map(r => ({ count: r.cellCount, slicer: r.slicer })),
      widths: Object.fromEntries(trace.glyphs.map(g => [g.char, g.cellW])), warning: trace.rowWarning,
      files: { otf: Array.from(font.otf!), ttf: Array.from(font.ttf!), woff2: Array.from(font.woff2!) },
      lContours: trace.glyphs.find(g => g.char === 'l')!.paths.join(' ').split(/(?=M)/).filter(s => s.trim()).length };
  }, readFileSync('e2e/fixtures/elegant-calligraphy-sheet.png').toString('base64'));
  expect(result.rows.map(r => r.count)).toEqual([13, 13, 13, 13, 10, 17, 13]);
  expect(result.rows.slice(0, 2).map(r => r.slicer)).toEqual(['components', 'components']);
  expect(result.rows[3].slicer).toBe('ownership');
  // A forced vertical cut used to include neighboring ink (E:138, r:165,
  // t:164px) and clip W's own swash (161px rather than 176px).
  expect(result.widths.E).toBe(96);
  expect(result.widths.W).toBe(176);
  expect(result.widths.r).toBe(94);
  expect(result.widths.t).toBe(83);
  expect(result.lContours).toBe(2); // outline + counter; no fragment from Y above
  expect(result.warning).toBe('');
  for (const [format, data] of Object.entries(result.files)) {
    const bytes = Buffer.from(data);
    if (format !== 'woff2') expect(verifySfntChecksums(bytes).ok).toBe(true);
    const font = fontkit.create(bytes);
    expect(font.characterSet.filter((cp: number) => ![0, 32, 65535].includes(cp))).toHaveLength(92);
    for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') {
      expect(font.glyphForCodePoint(c.codePointAt(0)!).path.commands.length, format + ' ' + c).toBeGreaterThan(0);
    }
    expect(font.glyphForCodePoint(108).path.commands.filter((c: { command: string }) => c.command === 'moveTo')).toHaveLength(2);
  }
});
