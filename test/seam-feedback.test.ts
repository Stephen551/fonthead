import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { seamVerdict, decideSeamDrops } from '../src/lib/maker';
import type { SeamZoneRead } from '../src/lib/maker';

// The assembled seam feedback pass (ADR 0040's parked pass, built after the
// Stage F director gate): a fired exit alternate whose ASSEMBLED seams
// measure worse than the plain render at identical positions drops whole.
// The drop rule is calibrated on the banked Stage E sensor table — the
// fixtures here are the REAL seam-sensor JSONs from the 2026-07-03 corpus
// run, so every verdict below is a measured, director-confirmed case.

const FIX = join(__dirname, 'fixtures', 'seam-sensor');
type SeamRead = { seam: string; alt: SeamZoneRead; plain: SeamZoneRead };
const face = (name: string): SeamRead[] =>
  JSON.parse(readFileSync(join(FIX, `seam-sensor-connected-cursive-${name}.json`), 'utf-8'));

const zone = (over: Partial<SeamZoneRead>): SeamZoneRead => ({
  cols: 100,
  gapCols: 0,
  crossCols: 10,
  maxRuns: 2,
  poolRatio: 3,
  ...over,
});

describe('seamVerdict (the per-seam drop rule)', () => {
  it('an alternate that introduces daylight is worse, whatever else improved', () => {
    expect(seamVerdict(zone({ gapCols: 1, crossCols: 2 }), zone({ gapCols: 0, crossCols: 30 }))).toBe('worse');
  });
  it('crossings decide when they move past the tolerance (the knot metric)', () => {
    expect(seamVerdict(zone({ crossCols: 31 }), zone({ crossCols: 16 }))).toBe('worse');
    expect(seamVerdict(zone({ crossCols: 15 }), zone({ crossCols: 43 }))).toBe('better');
  });
  it('a crossing move inside the tolerance falls through to pooling', () => {
    expect(seamVerdict(zone({ crossCols: 12, poolRatio: 4.38 }), zone({ crossCols: 12, poolRatio: 2.16 }))).toBe('worse');
    expect(seamVerdict(zone({ crossCols: 11, poolRatio: 2.0 }), zone({ crossCols: 12, poolRatio: 4.7 }))).toBe('better');
  });
  it('inside every tolerance is a tie', () => {
    expect(seamVerdict(zone({ crossCols: 11, poolRatio: 3.3 }), zone({ crossCols: 12, poolRatio: 3.2 }))).toBe('tie');
  });
  it('crossings outrank pooling: a decisive crossing win is a win even when pooling regresses', () => {
    // smooth o.jn01|r.jn02: cross 12<-17, pool 4.08<-2.71 — the seam is better
    expect(seamVerdict(zone({ crossCols: 12, poolRatio: 4.08 }), zone({ crossCols: 17, poolRatio: 2.71 }))).toBe('better');
  });
});

describe('decideSeamDrops (per-offender majority over its assembled exit seams)', () => {
  it('attributes a seam to the LEFT glyph when it carries the exit reconstruction (.jn01/.jn03)', () => {
    // a|n.jn01 (alternate as follower: its left side is the base outline) and
    // m.jn02|a (entry collapse: its exit side is the base outline) carry no
    // exit information — they must not vote.
    const drops = decideSeamDrops([
      { seam: 'a|n.jn01', alt: zone({ crossCols: 45 }), plain: zone({ crossCols: 38 }) },
      { seam: 'm.jn02|a', alt: zone({ crossCols: 20 }), plain: zone({ crossCols: 10 }) },
    ]);
    expect(drops).toEqual([]);
  });
  it('dedupes repeated seams (a pair sensed in two probe texts votes once)', () => {
    const worse = { alt: zone({ crossCols: 31 }), plain: zone({ crossCols: 16 }) };
    const better = { alt: zone({ crossCols: 5 }), plain: zone({ crossCols: 30 }) };
    // one worse seam counted twice must not outvote two distinct better seams
    const drops = decideSeamDrops([
      { seam: 'o.jn01|w', ...worse },
      { seam: 'o.jn01|w', ...worse },
      { seam: 'o.jn01|r', ...better },
      { seam: 'o.jn01|e', ...better },
    ]);
    expect(drops).toEqual([]);
  });

  it('rare pairs carry no crossing vote: exhaustive wins never rescue a common-bigram loser', () => {
    // the validation catch: the signature o measured worse on all five banked
    // common-bigram seams but better on 21 rare pairs (ox, ob, oa) — the
    // reader sees ou/ow/on overwhelmingly more often, so those decide
    const worse = { alt: zone({ crossCols: 31 }), plain: zone({ crossCols: 16 }) };
    const better = { alt: zone({ crossCols: 5 }), plain: zone({ crossCols: 30 }) };
    const drops = decideSeamDrops([
      { seam: 'o.jn01|w', ...worse },
      { seam: 'o.jn01|u', ...worse },
      { seam: 'o.jn01|n', ...worse },
      { seam: 'o.jn01|x', ...better },
      { seam: 'o.jn01|b', ...better },
      { seam: 'o.jn01|q', ...better },
      { seam: 'o.jn01|j', ...better },
      { seam: 'o.jn01|z', ...better },
    ]);
    expect(drops).toEqual(['o']);
  });
  it('the gap veto reads every base-follower seam: daylight on a third of them drops the offender', () => {
    // the cc-3 p catch: no common bigram starts with p, but its alternate
    // introduced a 2-column gap on every one of its seams
    const gapped = { alt: zone({ gapCols: 2 }), plain: zone({ gapCols: 0 }) };
    const clean = { alt: zone({}), plain: zone({}) };
    const drops = decideSeamDrops([
      { seam: 'p.jn01|a', ...gapped },
      { seam: 'p.jn01|e', ...gapped },
      { seam: 'p.jn01|i', ...clean },
      { seam: 'p.jn01|s', ...clean },
    ]);
    expect(drops).toEqual(['p']);
  });
  it('a collapsed .jn02 follower answers for its own missing hook ink: its gaps never veto the left glyph', () => {
    // smooth r|w: the w.jn02 collapse removes the floating lead-in, daylight
    // appears where the hook was — not the r reconstruction's doing
    const gapped = { alt: zone({ gapCols: 8 }), plain: zone({ gapCols: 0 }) };
    const clean = { alt: zone({}), plain: zone({}) };
    const drops = decideSeamDrops([
      { seam: 'r.jn01|w.jn02', ...gapped },
      { seam: 'r.jn01|v.jn02', ...gapped },
      { seam: 'r.jn01|a', ...clean },
      { seam: 'r.jn01|o', ...clean },
      { seam: 'r.jn01|e', ...clean },
    ]);
    expect(drops).toEqual([]);
  });

  // The banked calibration table: real sensor data, director-confirmed.
  it('signature: o drops (the ow/ov/own strips the director failed)', () => {
    expect(decideSeamDrops(face('signature'))).toEqual(['o']);
  });
  it('cc-3: c, o, r drop; the big winners n, v, w keep', () => {
    expect(decideSeamDrops(face('3'))).toEqual(['c', 'o', 'r']);
  });
  it('cc-4: nothing drops (the corpus-best o wins keep firing)', () => {
    expect(decideSeamDrops(face('4'))).toEqual([]);
  });
  it('handmade: o (pooling class) and v (introduced gap) drop; b and w keep', () => {
    expect(decideSeamDrops(face('handmade'))).toEqual(['o', 'v']);
  });
  it('light: o drops (the alternate introduces gap columns the plain render lacks)', () => {
    expect(decideSeamDrops(face('light'))).toEqual(['o']);
  });
  it('smooth: nothing drops (the milestone face keeps every win)', () => {
    expect(decideSeamDrops(face('smooth'))).toEqual([]);
  });
  it('nano family and the base cursive: the w wins keep firing', () => {
    for (const f of ['nano', 'nano-v2', 'nano-v3', ''] as const) {
      const seams: SeamRead[] = f === ''
        ? JSON.parse(readFileSync(join(FIX, 'seam-sensor-connected-cursive.json'), 'utf-8'))
        : face(f);
      expect(decideSeamDrops(seams), f || 'base').toEqual([]);
    }
  });
  it('cc-6 and cc-7: no drops (ties and entry-side seams never vote an exit out)', () => {
    expect(decideSeamDrops(face('6'))).toEqual([]);
    expect(decideSeamDrops(face('7'))).toEqual([]);
  });
});
