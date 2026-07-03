import { describe, it, expect } from 'vitest';
import { synthesizeConnector, standardJoinFromEntries } from '../src/lib/maker';

// Stage B of the connector-reconstruction milestone (ADR 0049, plan
// 2026-07-02): connector synthesis. synthesizeConnector draws ONE closed
// outline path from measured parameters — a cubic centerline tangent-matched
// at the attachment, ending past the standard join point by an overlap with
// the standard tangent, stroked at ±width/2, round start cap buried inside
// the body ink, tapered tip. Pure geometry, cell coordinates (y grows down).
// standardJoinFromEntries reduces per-glyph entry terminals (Stage A output)
// to the face's standard join: median reach, median tip height, median
// tangent.

type Pt = { x: number; y: number };

// parse a closed M/L path into its vertex list (dedupes consecutive repeats)
const parsePath = (d: string): Pt[] => {
  expect(d.startsWith('M')).toBe(true);
  expect(d.trim().endsWith('Z')).toBe(true);
  const nums = d.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/g)!.map(Number);
  expect(nums.length % 2).toBe(0);
  const pts: Pt[] = [];
  for (let i = 0; i < nums.length; i += 2) {
    const p = { x: nums[i], y: nums[i + 1] };
    const last = pts[pts.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) pts.push(p);
  }
  return pts;
};

// proper segment crossing (interior intersection); shared endpoints and
// collinear touches do not count — the gate hunts real loop-backs.
const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
const properlyIntersects = (a: Pt, b: Pt, c: Pt, d: Pt): boolean => {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
};
const isSimplePolygon = (pts: Pt[]): boolean => {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent through the closure
      if (properlyIntersects(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return false;
    }
  }
  return true;
};

const norm = (dx: number, dy: number) => {
  const l = Math.hypot(dx, dy);
  return { dx: dx / l, dy: dy / l };
};

describe('synthesizeConnector (Stage B, ADR 0049)', () => {
  const straight = () =>
    synthesizeConnector(
      { x: 100, y: 80 },
      { dx: 1, dy: 0 },
      { x: 130, y: 80 },
      { dx: 1, dy: 0 },
      6,
      8,
    )!;

  it('emits one closed finite path', () => {
    const s = straight();
    expect(s).toBeTruthy();
    const pts = parsePath(s.d);
    expect(pts.length).toBeGreaterThan(10);
    for (const p of pts) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it('tip lands past the join point by the overlap, along the standard tangent', () => {
    const s = straight();
    expect(s.tip.x).toBeCloseTo(138, 0); // 130 + 8·(1,0)
    expect(s.tip.y).toBeCloseTo(80, 0);
    const pts = parsePath(s.d);
    expect(Math.max(...pts.map((p) => p.x))).toBeGreaterThanOrEqual(137.5);
  });

  it('carries the measured width at mid-stroke', () => {
    const s = straight();
    const mid = parsePath(s.d).filter((p) => Math.abs(p.x - 119) <= 1.5);
    expect(mid.length).toBeGreaterThan(0);
    const spread = Math.max(...mid.map((p) => p.y)) - Math.min(...mid.map((p) => p.y));
    expect(spread).toBeGreaterThan(5);
    expect(spread).toBeLessThan(7);
  });

  it('rounds the start cap behind the attachment, buried in body ink', () => {
    const s = straight();
    const minX = Math.min(...parsePath(s.d).map((p) => p.x));
    // half a width behind the attach point
    expect(minX).toBeGreaterThan(96.2);
    expect(minX).toBeLessThan(98.2);
  });

  it('tapers the tip below half the stroke width', () => {
    const s = straight();
    const tipPts = parsePath(s.d).filter((p) => p.x >= 137);
    expect(tipPts.length).toBeGreaterThan(0);
    const spread = Math.max(...tipPts.map((p) => p.y)) - Math.min(...tipPts.map((p) => p.y));
    expect(spread).toBeLessThan(3.6); // < 0.6·width; taper target 0.35
    expect(spread).toBeGreaterThan(0.5); // not starved into a needle
  });

  it('tangent-matches the attachment and the join approach', () => {
    const tIn = norm(0.6, 0.8); // descending out of the body
    const s = synthesizeConnector({ x: 100, y: 60 }, tIn, { x: 140, y: 85 }, { dx: 1, dy: 0 }, 5, 6)!;
    const c = s.centerline;
    const d0 = norm(c[1].x - c[0].x, c[1].y - c[0].y);
    expect(d0.dx * tIn.dx + d0.dy * tIn.dy).toBeGreaterThan(0.99);
    const dn = norm(c[c.length - 1].x - c[c.length - 2].x, c[c.length - 1].y - c[c.length - 2].y);
    expect(dn.dx).toBeGreaterThan(0.99); // arrives level, the standard tangent
    expect(s.tip.x).toBeCloseTo(146, 0);
    expect(s.tip.y).toBeCloseTo(85, 0);
  });

  it('survives max curvature without self-intersection', () => {
    // steep dive out of the body onto a level entry line, wide stroke:
    // the inner offset wants to loop; the outline must stay simple
    const s = synthesizeConnector({ x: 100, y: 50 }, norm(0.2, 0.98), { x: 118, y: 82 }, { dx: 1, dy: 0 }, 7, 8)!;
    expect(s).toBeTruthy();
    const pts = parsePath(s.d);
    expect(isSimplePolygon(pts)).toBe(true);
  });

  it('preserves the measured width through the tightest bend (no waist)', () => {
    // the Stage D panel's convergent finding: clamping BOTH rails under the
    // local curvature radius starved the trough to ~half the face width (the
    // needle-tendency waist on oc/ok). The stroke must carry its measured
    // width through the bend — the inner rail alone yields to the radius and
    // the outer rail swells by the remainder, like a brush on an under-turn.
    // real-hand proportions (smooth-script: widths 14-20px on dives of this
    // scale), where the bend radius approaches the half-width
    const w = 16;
    const s = synthesizeConnector({ x: 100, y: 50 }, norm(0.1, 0.995), { x: 116, y: 84 }, { dx: 1, dy: 0 }, w, 6)!;
    const outline = parsePath(s.d);
    const c = s.centerline;
    for (let i = Math.round(c.length * 0.15); i <= Math.round(c.length * 0.6); i++) {
      // local width ≈ twice the distance from the centerline to the nearest
      // outline vertex (mid-stroke only: the tip taper and cap are excluded)
      const dMin = Math.min(...outline.map((p) => Math.hypot(p.x - c[i].x, p.y - c[i].y)));
      expect(2 * dMin).toBeGreaterThan(0.85 * w);
    }
  });

  it('carries full width THROUGH the join point (the taper lives inside the overlap)', () => {
    // the Stage D panel's waists sat just above the junction: the taper began
    // at 0.65 of the whole stroke, so the connector was already starved when
    // it crossed the join. Full width to the join point; the taper hides in
    // the overlap, buried under the follower's entry ink.
    const s = straight(); // attach (100,80), join (130,80), width 6, overlap 8
    const outline = parsePath(s.d);
    const c = s.centerline;
    const atJoin = c.reduce((best, p) => (Math.abs(p.x - 130) < Math.abs(best.x - 130) ? p : best), c[0]);
    const dMin = Math.min(...outline.map((p) => Math.hypot(p.x - atJoin.x, p.y - atJoin.y)));
    expect(2 * dMin).toBeGreaterThan(0.85 * 6);
  });

  it('returns null when the span is too short to draw', () => {
    expect(synthesizeConnector({ x: 100, y: 80 }, { dx: 1, dy: 0 }, { x: 103, y: 80 }, { dx: 1, dy: 0 }, 6, 0)).toBeNull();
  });

  it('returns null on a degenerate tangent', () => {
    expect(synthesizeConnector({ x: 100, y: 80 }, { dx: 0, dy: 0 }, { x: 130, y: 80 }, { dx: 1, dy: 0 }, 6, 8)).toBeNull();
  });
});

describe('standardJoinFromEntries (Stage B, ADR 0049)', () => {
  const e = (reach: number, tipFrac: number, dx: number, dy: number) => ({ reach, tipFrac, tangent: { dx, dy } });

  it('reduces entries to component medians with a unit tangent', () => {
    const j = standardJoinFromEntries([
      e(10, 0.2, -0.9, 0.3),
      e(12, 0.25, -0.8, 0.4),
      e(14, 0.3, -0.7, 0.5),
      e(16, 0.35, -0.6, 0.6),
      e(18, 0.4, -0.5, 0.7),
    ])!;
    expect(j.reach).toBe(14);
    expect(j.tipFrac).toBeCloseTo(0.3, 5);
    expect(Math.hypot(j.tangent.dx, j.tangent.dy)).toBeCloseTo(1, 5);
    expect(j.tangent.dx).toBeCloseTo(-0.7 / Math.hypot(0.7, 0.5), 2);
  });

  it('returns null under the joiner minimum', () => {
    expect(standardJoinFromEntries([e(10, 0.2, -1, 0), e(12, 0.25, -1, 0), e(14, 0.3, -1, 0)])).toBeNull();
  });
});
