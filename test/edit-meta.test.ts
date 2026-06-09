import { describe, it, expect } from 'vitest';
import { editedFontMeta } from '../src/lib/fonts';

const base = {
  treat: 'normal',
  size: 96,
  italic: false,
  badge: 'color',
  family: 'Old Name',
  designer: 'maker',
  ofl: '',
  standIn: false,
  builtWith: 'fonthead maker',
  license: 'ofl',
  og: true,
  colorMode: 'gradient',
  grad: 'linear-gradient(#000,#fff)',
};

describe('editedFontMeta', () => {
  it('sets family and license, preserving every unrelated key', () => {
    const { meta } = editedFontMeta(JSON.stringify(base), {
      name: 'New Name',
      license: 'cc0',
      specimenChanged: false,
    });
    const m = JSON.parse(meta);
    expect(m.family).toBe('New Name');
    expect(m.license).toBe('cc0');
    expect(m).toMatchObject({
      treat: 'normal',
      badge: 'color',
      designer: 'maker',
      standIn: false,
      builtWith: 'fonthead maker',
      colorMode: 'gradient',
      grad: 'linear-gradient(#000,#fff)',
    });
  });

  it('leaves the ofl attribution text untouched', () => {
    const seeded = { ...base, ofl: 'Copyright 2020 The Example Project Authors' };
    const { meta } = editedFontMeta(JSON.stringify(seeded), {
      name: 'Renamed',
      license: 'personal',
      specimenChanged: true,
    });
    expect(JSON.parse(meta).ofl).toBe('Copyright 2020 The Example Project Authors');
  });

  it('drops the og card only when the specimen changed and a card exists', () => {
    const r = editedFontMeta(JSON.stringify(base), { name: 'N', license: 'ofl', specimenChanged: true });
    expect(r.dropOg).toBe(true);
    expect(JSON.parse(r.meta).og).toBe(false);
  });

  it('keeps the card on a rename alone', () => {
    const r = editedFontMeta(JSON.stringify(base), { name: 'N', license: 'ofl', specimenChanged: false });
    expect(r.dropOg).toBe(false);
    expect(JSON.parse(r.meta).og).toBe(true);
  });

  it('no card to drop means dropOg stays false even on a specimen change', () => {
    const noCard = { ...base, og: false };
    const r = editedFontMeta(JSON.stringify(noCard), { name: 'N', license: 'ofl', specimenChanged: true });
    expect(r.dropOg).toBe(false);
    expect(JSON.parse(r.meta).og).toBe(false);
  });

  it('a font with no og key at all (older publishes) never reports dropOg', () => {
    const legacy: Record<string, unknown> = { ...base };
    delete legacy.og;
    const r = editedFontMeta(JSON.stringify(legacy), { name: 'N', license: 'cc0', specimenChanged: true });
    expect(r.dropOg).toBe(false);
    expect('og' in JSON.parse(r.meta)).toBe(false);
  });

  it('malformed meta still returns valid JSON carrying the edit', () => {
    for (const raw of ['not json', '', 'null', '5', '[1,2]']) {
      const r = editedFontMeta(raw, { name: 'Fixed', license: 'cc0', specimenChanged: true });
      const m = JSON.parse(r.meta);
      expect(m.family).toBe('Fixed');
      expect(m.license).toBe('cc0');
      expect(r.dropOg).toBe(false);
    }
  });
});
