/* ============================================================
 * singleline-core.js  (centerline / single-line pen-mode kernel)
 * ------------------------------------------------------------
 * Extracted verbatim from tracer.html (Tier 0 hardening) so the
 * kernel can be unit-tested in isolation and reused by the planned
 * standalone centerline tool. Pure number-in/number-out: no DOM, no
 * Potrace, no tracer 'state', no roundNum. The fail-safe filled trace
 * and SVG serialization (singleLineContourPathD) stay in tracer.html.
 *
 * Pipeline: distance transform -> Zhang-Suen thinning -> skeleton
 * graph walk -> fragment stitching -> Douglas-Peucker simplify ->
 * spur/seam cleanup -> corner-split -> Schneider cubic fit. Output is
 * { contours:[{points,closed,segments}], dots, strokeRadius }.
 *
 * Exposes window.SingleLineCore (browser) / module.exports (Node).
 * ============================================================ */
(function (global) {
  'use strict';

  // Zhang-Suen thinning is iterative over every pixel; an oversized cell would
  // stall the tab. Cap the pixel budget and fail-safe (empty -> caller falls
  // back to the filled Potrace trace, which scales fine). 6 Mpx ~ a 2450px
  // square — far above any real glyph cell, only a runaway single-glyph source
  // on the whole image trips it. Tunable.
  const MAX_SINGLELINE_PIXELS = 6_000_000;

  function traceCellSingleLine(binary, w, h, opts = {}) {
    if (!(w > 0) || !(h > 0) || !isFinite(w * h)) return { contours: [], dots: [], strokeRadius: 0 };
    if (w * h > MAX_SINGLELINE_PIXELS) {
      if (typeof console !== 'undefined') console.warn(`single-line: cell ${w}x${h} exceeds ${MAX_SINGLELINE_PIXELS}px budget; falling back to filled trace`);
      return { contours: [], dots: [], strokeRadius: 0, oversize: true };
    }
    const mask = new Uint8Array(w * h);
    let inkCount = 0;
    for (let i = 0; i < w * h; i++) {
      if (binary[i * 4] === 0) {
        mask[i] = 1;
        inkCount++;
      }
    }
    if (!inkCount) return { contours: [], dots: [], strokeRadius: 0 };

    const dist = distanceTransform(mask, w, h);
    let strokeRadius = 0;
    for (let i = 0; i < dist.length; i++) {
      if (dist[i] !== Infinity && dist[i] > strokeRadius) strokeRadius = dist[i];
    }
    if (!strokeRadius) strokeRadius = 1;

    const skel = destaircase(zhangSuenThin(mask, w, h), w, h, dist);
    const components = skeletonComponents(skel, w, h);
    const degree = new Uint8Array(w * h);
    for (let i = 0; i < skel.length; i++) {
      if (skel[i]) degree[i] = skeletonNeighborIndices(i, skel, w, h).length;
    }

    const dots = [];
    const dotExtent = Math.max(2, strokeRadius * 3);
    const pruneThreshold = Math.max(strokeRadius * 1.9, h * 0.04) * Math.max(0, opts.spurPrune == null ? 1 : opts.spurPrune);
    const simplifyTolerance = Math.max(0.5, strokeRadius * 0.35);
    const inkTest = makeInkTest(mask, w, h, 2);   // used by the pure-loop gate, finishing + scoring
    // router: null => ENSEMBLE (build both stitch + graph candidates, select the best per
    // component). opts.useGraph / opts.useStitch force a single router (measurement + the
    // graph-path guard test). Ensemble is the default product path.
    const router = opts.router || (opts.useGraph ? 'graph' : (opts.useStitch ? 'stitch' : null));
    const thresholds = { dotExtent, pruneThreshold, simplifyTolerance };
    const env = { skel, w, h, degree, strokeRadius, thresholds, inkTest, router };
    const labels = opts.debug ? [] : null;   // opts.debug -> result.labels records the winning candidate per component

    // Per-component candidate ensemble: each connected skeleton component is traced
    // independently. buildComponentCandidates returns one or more finished candidate
    // assemblies; selectComponentCandidate picks the best (currently the first = the
    // legacy single-router behaviour, so this restructure is output-identical). Step 5
    // adds the competing graph/stitch candidates + scoreAssembly here.
    const final = [];
    for (const comp of components) {
      const extent = Math.max(comp.maxX - comp.minX + 1, comp.maxY - comp.minY + 1);
      if (comp.pixels.length === 1 || extent <= dotExtent) {
        dots.push([comp.sumX / comp.pixels.length, comp.sumY / comp.pixels.length]);
        continue;
      }
      const cands = buildComponentCandidates(comp, env);
      const chosen = selectComponentCandidate(cands, comp, env);
      if (chosen) { for (const c of chosen.contours) final.push(c); if (labels) labels.push(chosen.label); }
    }

    // Pen-lift ordering: shorten the pen's air-travel between this glyph's strokes
    // (plotter/Cricut benefit). Reordering + direction-flip only — geometry, the
    // rendered shape, and the off-ink metric are unchanged. opts.penOrder === false
    // disables it (used to measure the gain).
    return { contours: opts.penOrder === false ? final : orderForPenPlot(final), dots, strokeRadius, labels };
  }

  /* Finish raw {points, closed} contours into shipped geometry: simplify -> Schneider
     curve-fit/cleanup (refine) -> ink-containment split. This is the identical downstream
     every candidate runs through, so candidate scores reflect real output. */
  function finishContours(raws, env) {
    const { strokeRadius, inkTest, thresholds } = env;
    const tol = thresholds.simplifyTolerance;
    const contours = [];
    for (const ch of raws) {
      const simplified = simplifyPolyline(ch.points, tol, ch.closed);
      if (ch.closed ? simplified.length >= 3 : simplified.length >= 2) contours.push({ points: simplified, closed: ch.closed });
    }
    for (const c of contours) refineSingleLineContour(c, strokeRadius, inkTest);
    const out = [];
    for (const c of contours) for (const o of enforceInkContainment(c, inkTest, tol, strokeRadius)) out.push(o);
    return out;
  }

  /* Pure-loop candidate (O, o, round bowls): a component with NO true endpoints (degree 1)
     and NO true junctions (Tn>=3) is one closed stroke. Walk it whole (staircase-aware),
     accept only if it covers most of the component AND survives refine+containment as a
     single on-ink contour — else null (the caller falls to the stitch/graph candidate).
     Returns FINISHED contours (the survival trial IS the result; no second trace). */
  function pureLoopCandidate(comp, env) {
    const { skel, w, h, degree, strokeRadius, thresholds, inkTest } = env;
    for (const p of comp.pixels) if (degree[p] === 1 || crossingNumber(p, skel, w, h) >= 3) return null;
    const ns0 = skeletonNeighborIndices(comp.pixels[0], skel, w, h);
    if (!ns0.length) return null;
    const loop = walkSkeletonLoop(comp.pixels[0], ns0[0], skel, w, h, new Set(), comp.pixels.length + 8);
    if (!(loop.closed && loop.points.length >= 3 && loop.points.length >= comp.pixels.length * 0.7)) return null;
    const finished = finishContours([{ points: loop.points, closed: true }], env);
    return finished.length === 1 ? finished : null;
  }

  /* Walk an OPEN simple path from one degree-1 endpoint, taking the straightest continuation
     at every step (staircase-aware, like the loop walk), until the other endpoint is reached
     or the walk dead-ends. Threads through crossing-number Tn==3 zigzag pixels (rasterization
     artifacts that aren't real branches) so a single open stroke isn't shattered at them.
     Returns the point list, or null if it didn't terminate at a degree-1 endpoint. */
  function walkSkeletonPath(start, skel, w, h, degree, guardLimit) {
    const ns = skeletonNeighborIndices(start, skel, w, h);
    if (!ns.length) return null;
    const points = [pointFromIndex(start, w)];
    const visited = new Set();
    let prev = start, cur = ns[0];
    visited.add(edgeKey(prev, cur));
    let guard = 0;
    while (guard++ < guardLimit) {
      points.push(pointFromIndex(cur, w));
      if (cur !== start && degree[cur] === 1) return points;     // reached the far endpoint
      const cands = skeletonNeighborIndices(cur, skel, w, h).filter(n => n !== prev && !visited.has(edgeKey(cur, n)));
      if (!cands.length) break;
      let n = cands[0];
      if (cands.length > 1) {
        const cp = pointFromIndex(cur, w), pp = pointFromIndex(prev, w);
        const arrive = Math.atan2(cp[1] - pp[1], cp[0] - pp[0]);
        let best = Infinity;
        for (const c of cands) {
          const np = pointFromIndex(c, w);
          let t = Math.abs(arrive - Math.atan2(np[1] - cp[1], np[0] - cp[0])) % (Math.PI * 2);
          if (t > Math.PI) t = Math.PI * 2 - t;
          if (t < best) { best = t; n = c; }
        }
      }
      visited.add(edgeKey(cur, n)); prev = cur; cur = n;
    }
    return null;
  }

  /* Open-path candidate (C, S, an e/s arc, any simple open stroke): a component with exactly
     TWO degree-1 endpoints is a single open stroke. Walk it end-to-end whole (staircase-aware)
     so residual Tn==3 zigzags don't fragment it into pieces the spur-prune then deletes (the
     real-sheet "C is 3 end-stubs, body gone" failure). Accept only if the whole-walk covers
     most of the component AND finishes as 1-2 on-ink contours; else null. This is the open
     analogue of pureLoopCandidate, and like it competes in the ensemble (selection picks the
     fewest-contours, on-ink candidate, so a clean 1-stroke open arc beats the fragmenting routers). */
  function openPathCandidate(comp, env) {
    const { skel, w, h, degree } = env;
    let e0 = -1, e1 = -1, ends = 0;
    for (const p of comp.pixels) { if (degree[p] === 1) { ends++; if (e0 < 0) e0 = p; else e1 = p; } }
    if (ends !== 2) return null;
    const path = walkSkeletonPath(e0, skel, w, h, degree, comp.pixels.length + 8);
    if (!path || path.length < 3 || path.length < comp.pixels.length * 0.7) return null;
    // must actually terminate at the OTHER endpoint (a clean simple path), not dead-end short
    const last = path[path.length - 1], te = pointFromIndex(e1, w);
    if (Math.abs(last[0] - te[0]) > 1 || Math.abs(last[1] - te[1]) > 1) return null;
    const finished = finishContours([{ points: path, closed: false }], env);
    return (finished.length >= 1 && finished.length <= 2) ? finished : null;
  }

  /* Stitch candidate: walk this component's open fragments + residual closed loops, stitch
     the fragments, prune spurs, finish. (A fresh visitedEdges per component is equivalent
     to the old global one — skeleton edges never cross components.) */
  function stitchCandidate(comp, env) {
    const { skel, w, h, degree, strokeRadius, thresholds } = env;
    const pruneThreshold = thresholds.pruneThreshold;
    const visited = new Set();
    const openFrags = [];
    for (const start of comp.pixels) {
      if (degree[start] === 2) continue;
      for (const next of skeletonNeighborIndices(start, skel, w, h)) {
        if (visited.has(edgeKey(start, next))) continue;
        const walked = walkSkeletonEdge(start, next, skel, degree, w, h, visited, comp.pixels.length + 8);
        if (walked.points.length < 2) continue;
        openFrags.push({ points: walked.points, startIdx: walked.start, endIdx: walked.end });
      }
    }
    const closedLoops = [];
    for (const start of comp.pixels) {
      if (degree[start] !== 2) continue;
      const openNeighbor = skeletonNeighborIndices(start, skel, w, h).find(n => !visited.has(edgeKey(start, n)));
      if (openNeighbor == null) continue;
      const walked = walkSkeletonLoop(start, openNeighbor, skel, w, h, visited, comp.pixels.length + 8);
      if (!walked.closed || walked.points.length < 3) continue;
      closedLoops.push(walked.points);
    }
    const raws = [];
    for (const ch of stitchFragments(openFrags, strokeRadius)) {
      const sd = degree[ch.startIdx] || 0, ed = degree[ch.endIdx] || 0;
      const len = polylineLength(ch.points);
      if (ch.closed) { if (pruneThreshold > 0 && len < pruneThreshold) continue; raws.push({ points: ch.points, closed: true }); continue; }
      if (pruneThreshold > 0 && len < pruneThreshold && (sd >= 3 || ed >= 3)) continue;
      raws.push({ points: ch.points, closed: false });
    }
    for (const pts of closedLoops) raws.push({ points: pts, closed: true });
    return { label: 'stitch', contours: finishContours(raws, env) };
  }

  /* Graph candidate: route this one component through the topology stroke-graph
     (Tn nodes + curvature-gated junction routing), restricted to the component's pixels. */
  function graphCandidate(comp, env) {
    const { skel, w, h, degree, strokeRadius, thresholds } = env;
    const restrict = new Set(comp.pixels);
    const strokes = traceSkeletonGraph(skel, w, h, degree, strokeRadius, thresholds.pruneThreshold, null, restrict);
    return { label: 'graph', contours: finishContours(strokes.map(s => ({ points: s.points, closed: s.closed })), env) };
  }

  /* Build the competing candidate assemblies for one component. A surviving pure loop is
     unambiguous (one closed on-ink stroke) and returned alone. Otherwise: the ENSEMBLE
     builds BOTH the stitch and graph candidates for scoreAssembly to choose between, so the
     right router is picked per glyph (graph de-fragments bowls; stitch wins sharp junctions)
     with no global flag. env.router forces a single candidate for measurement / the guard test. */
  function buildComponentCandidates(comp, env) {
    const loop = pureLoopCandidate(comp, env);
    if (loop) return [{ label: 'pure-loop', contours: loop }];
    // open-path competes in the ensemble (it can't make things worse — selection only adopts
    // it when it's the fewest-contours, on-ink, full-coverage candidate, i.e. a clean simple arc).
    const cands = [];
    const path = openPathCandidate(comp, env);
    if (path) cands.push({ label: 'open-path', contours: path });
    if (env.router === 'graph') { cands.push(graphCandidate(comp, env)); return cands; }
    if (env.router === 'stitch') { cands.push(stitchCandidate(comp, env)); return cands; }
    cands.push(stitchCandidate(comp, env));
    cands.push(graphCandidate(comp, env));
    return cands;
  }

  /* Densely sample a finished contour's rendered geometry (every cubic + L sub-pixel) so a
     candidate is scored on what actually ships. */
  function sampleContourGeometry(c) {
    const out = [];
    if (c.segments && c.segments.ops && c.segments.ops.length) {
      let cur = c.segments.start; out.push(cur);
      for (const op of c.segments.ops) {
        if (op.t === 'C') { for (let t = 0.1; t <= 1.0001; t += 0.1) out.push(bezEval([cur, op.c1, op.c2, op.p], t)); cur = op.p; }
        else { const n = Math.max(1, Math.ceil(v_len(v_sub(op.p, cur)))); for (let s = 1; s <= n; s++) out.push([cur[0] + (op.p[0] - cur[0]) * s / n, cur[1] + (op.p[1] - cur[1]) * s / n]); cur = op.p; }
      }
    } else for (const p of (c.points || [])) out.push(p);
    return out;
  }

  /* Score a candidate assembly against the component it traces:
     - count: contour count (fragmentation; lower is better).
     - coverage: fraction of the component's SKELETON pixels within tol of the candidate's
       rendered geometry. Set-based (a covered-cell grid), so overlapping/redundant strokes
       can't inflate it — that is why coverage, not summed length, is the completeness gate:
       length would make a redundant 4-stroke candidate look "more complete" than a clean
       2-stroke one and wrongly disqualify the good one.
     - offFrac: fraction of samples off the source ink (must stay on the spine). */
  function assemblyMetrics(contours, comp, env) {
    const { w, h, inkTest } = env;
    const tol = 2;
    const hit = new Uint8Array(w * h);
    let off = 0, tot = 0;
    for (const c of contours) {
      for (const p of sampleContourGeometry(c)) {
        const on = inkTest(p[0], p[1]); tot++; if (!on) off++;
        const cx = Math.round(p[0]), cy = Math.round(p[1]);
        for (let dy = -tol; dy <= tol; dy++) for (let dx = -tol; dx <= tol; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) hit[ny * w + nx] = 1;
        }
      }
    }
    let covered = 0; for (const p of comp.pixels) if (hit[p]) covered++;
    return { count: contours.length, coverage: comp.pixels.length ? covered / comp.pixels.length : 0, offFrac: tot ? off / tot : 1 };
  }

  /* Select the best candidate for a component. The guarantee that makes the ensemble safe:
     a candidate is DISQUALIFIED if it leaves the spine (off-ink > 5%), produces nothing, or
     drops coverage (< 80% of the component's skeleton) — so selection can never trade a glyph
     class away or ship a chord. Among survivors: FEWEST contours wins (de-fragmentation),
     tie-broken by higher coverage then a fixed label priority (deterministic, byte-stable).
     Wrong-merges (too few contours) are caught by the crossing-split harness gates. */
  function selectComponentCandidate(cands, comp, env) {
    if (cands.length <= 1) return cands[0] || null;
    const CEIL = 0.05, COVER_FLOOR = 0.8;
    const prio = { 'pure-loop': 0, 'open-path': 1, graph: 2, stitch: 3 };
    const scored = cands.map(c => ({ c, m: assemblyMetrics(c.contours, comp, env) }));
    let pool = scored.filter(x => x.c.contours.length > 0 && x.m.offFrac <= CEIL && x.m.coverage >= COVER_FLOOR);
    if (!pool.length) pool = scored.filter(x => x.c.contours.length > 0);
    if (!pool.length) return cands[0];
    pool.sort((A, B) =>
      A.c.contours.length - B.c.contours.length ||
      B.m.coverage - A.m.coverage ||
      ((prio[A.c.label] == null ? 9 : prio[A.c.label]) - (prio[B.c.label] == null ? 9 : prio[B.c.label]))
    );
    return pool[0].c;
  }

  /* ============================================================
   * SHIPPED — this is the `graph` candidate (graphCandidate), one of the four the
   * per-component ensemble selects between (measured share on a 21-glyph battery:
   * stitch 7, graph 6, open-path 5, pure-loop 3 — every type is load-bearing, which is
   * why none is deleted). It uses crossing-number (Tn) node classification + a
   * staircase-aware walk + greedy-best-first junction routing, and wins the bowls/
   * junctions where its de-fragmentation beats the stitcher. The off-ink it once risked
   * (chords across openings) is cleaned by enforceInkContainment's re-fit; off-ink on the
   * real cursive sheet is 0.00%. Earlier dead ends recorded for posterity: residual
   * 1px-thinning was a no-op (staircase, not 2px blobs — destaircase handles it now);
   * endpoint-snap collapse drew worse chords; degree-based nodes mis-classified staircases
   * as junctions (Tn fixes that). Routing was upgraded from the margin-gated pairing
   * described below to plain greedy-best-first (see the join block) — the margin gate
   * over-fragmented junctions.
   * ------------------------------------------------------------
   * Topology-aware stroke-graph tracer.
   * Builds an explicit node/edge graph from a skeleton and routes pen strokes
   * through junctions correctly:
   *   - NODES: junction-pixel blobs (degree>=3) collapse into one node via
   *     8-connected clustering — only genuinely-adjacent junction pixels merge,
   *     so opposite sides of an 'O' stay distinct nodes (no cross-glyph chord).
   *     Endpoints (degree 1) are their own nodes.
   *   - EDGES: the degree-2 chains between nodes, carrying their REAL skeleton
   *     points. Strokes are built by concatenating edges, never by synthesizing
   *     a straight bridge across empty space — so the bridge-chord artifact of
   *     the old stitcher cannot occur.
   *   - SPURS: a short edge to a leaf (degree-1) node is pruned.
   *   - ROUTING: at each node, edges are paired into through-strokes by curvature
   *     continuity, GATED by correctness — a pair is made only when it is each
   *     edge's mutual-best near-straight continuation and clearly beats the
   *     runner-up. Ambiguous junctions leave edges unpaired (an honest pen lift),
   *     per the v1 "separate strokes over merged paths, correctness first" rule.
   * Operates on `skel` excluding pixels in `excludeSet` (dots / pure loops, which
   * the caller handles). Returns [{ points, closed }] for node-bearing strokes.
   * ============================================================ */
  function traceSkeletonGraph(skel, w, h, degree, strokeRadius, pruneThreshold, excludeSet, restrictSet) {
    const N = w * h;
    const PX = i => i % w, PY = i => (i - i % w) / w;
    const live = i => skel[i] && !(excludeSet && excludeSet.has(i)) && !(restrictSet && !restrictSet.has(i));
    const nbrs = i => skeletonNeighborIndices(i, skel, w, h).filter(live);
    const liveAt = i => live(i);

    // ---- crossing number (branch count). degree (raw 8-neighbour count) is WRONG
    // for curved skeletons: a rasterized curve staircases, and each step's inner
    // pixel has 3 neighbours yet is a plain edge pixel. The Rutovitz crossing
    // number Tn (0->1 transitions around the 8-ring) is the true branch count:
    // Tn==1 endpoint-ish, Tn==2 edge (incl. staircases/corners), Tn>=3 junction.
    function crossing(i) {
      const x = i % w, y = (i - i % w) / w;
      const g = (xx, yy) => (xx < 0 || xx >= w || yy < 0 || yy >= h) ? 0 : (liveAt(yy * w + xx) ? 1 : 0);
      const r = [g(x, y - 1), g(x + 1, y - 1), g(x + 1, y), g(x + 1, y + 1), g(x, y + 1), g(x - 1, y + 1), g(x - 1, y), g(x - 1, y - 1)];
      let tn = 0; for (let k = 0; k < 8; k++) if (r[k] === 0 && r[(k + 1) % 8] === 1) tn++;
      return tn;
    }
    const bcount = i => nbrs(i).length;
    const isJunc = i => liveAt(i) && crossing(i) >= 3;
    const isEnd = i => liveAt(i) && bcount(i) === 1;
    const isNode = i => isJunc(i) || isEnd(i);

    // ---- nodes: cluster 8-adjacent junction pixels; each endpoint its own node ----
    const nodeOf = new Int32Array(N).fill(-1);
    const nodePix = [];
    const seen = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (!isJunc(i) || seen[i]) continue;
      const id = nodePix.length, pix = [], stack = [i]; seen[i] = 1;
      while (stack.length) {
        const p = stack.pop(); nodeOf[p] = id; pix.push(p);
        for (const nb of nbrs(p)) if (isJunc(nb) && !seen[nb]) { seen[nb] = 1; stack.push(nb); }
      }
      nodePix.push(pix);
    }
    for (let i = 0; i < N; i++) {
      if (isEnd(i) && nodeOf[i] < 0) { nodeOf[i] = nodePix.length; nodePix.push([i]); }
    }
    if (nodePix.length === 0) return [];

    // ---- edges: walk from each node pixel to the next node, threading through
    // Tn==2 pixels. Such a pixel can still have degree 3 (a staircase inner corner):
    // there is exactly ONE through-path, so pick the straightest non-prev neighbour
    // and let the diagonal-redundant pixel orphan (it isn't a node, never starts an
    // edge, and the chosen step already spans it). No straight bridge is synthesized. ----
    const edges = [];                 // { a, b, points }
    const walked = new Set();
    const ek = (p, q) => (p < q ? p + ':' + q : q + ':' + p);
    const dirOf = (a, b) => Math.atan2(PY(b) - PY(a), PX(b) - PX(a));
    const angDiff = (a, b) => { let d = Math.abs(a - b) % (Math.PI * 2); return d > Math.PI ? Math.PI * 2 - d : d; };
    for (let i = 0; i < N; i++) {
      if (nodeOf[i] < 0) continue;
      const myNode = nodeOf[i];
      for (const nb of nbrs(i)) {
        if (nodeOf[nb] === myNode) continue;            // internal to this cluster
        if (walked.has(ek(i, nb))) continue;
        const pts = [[PX(i), PY(i)]];
        let prev = i, cur = nb; walked.add(ek(prev, cur));
        let guard = 0;
        while (guard++ < N * 2) {
          pts.push([PX(cur), PY(cur)]);
          if (nodeOf[cur] >= 0) break;                  // reached a node
          const cand = nbrs(cur).filter(n => n !== prev && !walked.has(ek(cur, n)));
          if (cand.length === 0) break;
          // straightest continuation (smallest turn from the arrival direction)
          const arrive = dirOf(prev, cur);
          let nx = cand[0], best = Infinity;
          for (const n of cand) { const t = angDiff(arrive, dirOf(cur, n)); if (t < best) { best = t; nx = n; } }
          walked.add(ek(cur, nx)); prev = cur; cur = nx;
        }
        edges.push({ a: myNode, b: (nodeOf[cur] >= 0 ? nodeOf[cur] : -1), points: pts });
      }
    }
    if (edges.length === 0) return [];

    // ---- spur prune: short edge whose far node is a leaf (degree-1 endpoint) ----
    const nodeDeg = new Array(nodePix.length).fill(0);
    for (const e of edges) { if (e.a >= 0) nodeDeg[e.a]++; if (e.b >= 0) nodeDeg[e.b]++; }
    const isLeafNode = id => id >= 0 && nodePix[id].length === 1 && isEnd(nodePix[id][0]);
    const alive = edges.map(() => true);
    let pruned = true, pg = 0;
    while (pruned && pg++ < 50) {
      pruned = false;
      for (let ei = 0; ei < edges.length; ei++) {
        if (!alive[ei]) continue;
        const e = edges[ei];
        const len = polylineLength(e.points);
        if (len >= pruneThreshold) continue;
        const aLeaf = isLeafNode(e.a), bLeaf = isLeafNode(e.b);
        // a spur hangs off a junction and ends at a leaf (or open -1 end)
        const aJunc = e.a >= 0 && !isLeafNode(e.a) && nodeDeg[e.a] >= 3;
        const bJunc = e.b >= 0 && !isLeafNode(e.b) && nodeDeg[e.b] >= 3;
        if ((aJunc && (bLeaf || e.b < 0)) || (bJunc && (aLeaf || e.a < 0))) {
          alive[ei] = false; if (e.a >= 0) nodeDeg[e.a]--; if (e.b >= 0) nodeDeg[e.b]--; pruned = true;
        }
      }
    }
    const live2 = edges.filter((_, i) => alive[i]);

    // ---- routing: pair edge-ends at each node by gated straight continuation ----
    // edge-end id = ei*2 + side (0 = a-end, 1 = b-end)
    const M = live2.length;
    const endNode = new Array(M * 2);
    const leaveDir = new Array(M * 2);                  // unit angle leaving the node into the edge
    const kOf = p => Math.min(4, p.length - 1);
    for (let ei = 0; ei < M; ei++) {
      const p = live2[ei].points, k = kOf(p);
      endNode[ei * 2] = live2[ei].a;
      endNode[ei * 2 + 1] = live2[ei].b;
      leaveDir[ei * 2] = Math.atan2(p[k][1] - p[0][1], p[k][0] - p[0][0]);
      const L = p.length - 1;
      leaveDir[ei * 2 + 1] = Math.atan2(p[L - k][1] - p[L][1], p[L - k][0] - p[L][0]);
    }
    const angBetween = (a, b) => { let d = Math.abs(a - b) % (Math.PI * 2); return d > Math.PI ? Math.PI * 2 - d : d; };
    // group ends by node
    const endsByNode = new Map();
    for (let e = 0; e < M * 2; e++) {
      const n = endNode[e]; if (n < 0) continue;
      (endsByNode.get(n) || endsByNode.set(n, []).get(n)).push(e);
    }
    const partner = new Array(M * 2).fill(-1);
    const MAX_JOIN_TURN = Math.PI * 0.62;               // ~112deg of turn allowed at a join
    const W_CURV = 0.45;                                // curvature-continuity weight (below tangent)
    // Per-end curvature magnitude: how hard the edge bends near the node (rad / sample).
    // Pairing edges of similar curvature keeps a stem with a stem and a bowl-arc with a
    // bowl-arc, so the through-stroke a pen would draw is preferred among same-turn options.
    const curveOf = new Array(M * 2).fill(0);
    for (let ei = 0; ei < M; ei++) {
      const p = live2[ei].points, k = kOf(p), L = p.length - 1;
      curveOf[ei * 2] = edgeEndCurvature(p, 0, Math.min(k + 2, L));
      curveOf[ei * 2 + 1] = edgeEndCurvature(p, L, Math.max(L - k - 2, 0));
    }
    // Cost of joining two edge-ends through a node: a straight pass-through (the two edges
    // leave the node in OPPOSITE directions) costs ~0; a hairpin costs ~PI and is rejected.
    // A mild curvature-mismatch term breaks ties toward the smoother continuation.
    const joinCost = (e1, e2) => {
      const t = Math.PI - angBetween(leaveDir[e1], leaveDir[e2]);   // 0 = straight through
      if (t > MAX_JOIN_TURN) return null;
      return t + W_CURV * Math.abs(curveOf[e1] - curveOf[e2]);
    };
    // Greedy-best-first matching per node: take the lowest-cost allowed pair, mark its ends
    // used, repeat. No "must clearly beat the runner-up" margin gate (that refused a junction's
    // remaining arms and shattered k/Y/T into separate strokes). Leftover ends at an odd-valence
    // node stay unpaired -> an honest pen-lift / a spur the prune drops. A true crossing (x/+)
    // pairs its straight diagonals first, so its sharp adjacent pairs are never reached: the
    // crossing still splits. This single change de-fragments k and closes the residual-zigzag
    // loops while keeping crossings separate.
    for (const [, ends] of endsByNode) {
      if (ends.length < 2) continue;
      const cand = [];
      for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
        const c = joinCost(ends[i], ends[j]);
        if (c != null) cand.push({ e1: ends[i], e2: ends[j], c });
      }
      cand.sort((p, q) => p.c - q.c);
      const taken = new Set();
      for (const c of cand) {
        if (taken.has(c.e1) || taken.has(c.e2)) continue;
        partner[c.e1] = c.e2; partner[c.e2] = c.e1; taken.add(c.e1); taken.add(c.e2);
      }
    }

    // ---- assembly: follow partner links into strokes ----
    const usedEdge = new Array(M).fill(false);
    const strokes = [];
    const otherEnd = e => (e % 2 === 0 ? e + 1 : e - 1);
    // start from unpaired ends (true terminals) first, then any leftover (loops)
    const starts = [];
    for (let e = 0; e < M * 2; e++) if (partner[e] < 0) starts.push(e);
    function buildFrom(startEnd) {
      let pts = [], curEnd = startEnd, closed = false;
      while (true) {
        const ei = curEnd >> 1;
        if (usedEdge[ei]) { closed = true; break; }
        usedEdge[ei] = true;
        const ep = live2[ei].points;
        const seg = (curEnd % 2 === 0) ? ep : ep.slice().reverse(); // enter at a-end → forward
        if (pts.length && seg.length) {
          // drop duplicate joint point if coincident
          const last = pts[pts.length - 1], f = seg[0];
          pts = pts.concat(Math.abs(last[0] - f[0]) < 1e-6 && Math.abs(last[1] - f[1]) < 1e-6 ? seg.slice(1) : seg);
        } else pts = pts.concat(seg);
        const exit = otherEnd(curEnd);
        const nxt = partner[exit];
        if (nxt < 0) break;                  // terminal
        if ((nxt >> 1) === (startEnd >> 1)) { closed = true; break; } // back to start edge
        curEnd = nxt;
      }
      return { points: pts, closed };
    }
    for (const s of starts) { if (!usedEdge[s >> 1]) strokes.push(buildFrom(s)); }
    for (let ei = 0; ei < M; ei++) if (!usedEdge[ei]) strokes.push(buildFrom(ei * 2)); // leftover loops

    return strokes.filter(s => s.points.length >= 2);
  }

  /* Greedily chain open skeleton fragments that meet at a shared node, always
     extending toward the straightest continuation. Returns merged polylines, each
     tagged with the skeleton-pixel index at its two free ends (used for spur pruning).
     A near-reversal join (> MAX_TURN) is refused so a stroke never doubles back on
     itself, and at a T/X node the through-line wins over a perpendicular branch. */
  function stitchFragments(frags, strokeRadius) {
    const used = new Array(frags.length).fill(false);
    const MAX_TURN = Math.PI * 0.7;               // ~126deg; allows curves, blocks doubling back
    const ADJ2 = 1.5 * 1.5;                       // shared-node radius (squared)
    const BRIDGE = Math.max(3, (strokeRadius || 1) * 2.6); // span a junction cluster's width
    const BRIDGE2 = BRIDGE * BRIDGE;
    const BRIDGE_TURN = Math.PI * 0.22;           // ~40deg; bridge only near-collinear strokes
    const near = (a, b) => Math.abs(a[0] - b[0]) <= 1.5 && Math.abs(a[1] - b[1]) <= 1.5;
    const dist2 = (a, b) => { const dx = a[0] - b[0], dy = a[1] - b[1]; return dx * dx + dy * dy; };
    const dir = (p1, p2) => Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
    const kOf = pts => Math.min(4, pts.length - 1);
    const angDiff = (a, b) => { const d = Math.abs(a - b) % (Math.PI * 2); return d > Math.PI ? Math.PI * 2 - d : d; };
    const out = [];
    for (let i = 0; i < frags.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      let points = frags[i].points.slice();
      const ends = [frags[i].startIdx, frags[i].endIdx]; // [head, tail]
      for (let side = 0; side < 2; side++) {
        const atEnd = side === 0;
        let grew = true;
        while (grew) {
          grew = false;
          const n = points.length;
          const joint = atEnd ? points[n - 1] : points[0];
          const arrive = atEnd ? dir(points[n - 1 - kOf(points)], points[n - 1])
                               : dir(points[kOf(points)], points[0]);
          // Tier 1: a fragment sharing this exact node (adjacency). Tier 2 (fallback):
          // a near-collinear fragment a short hop away, to bridge straight through a
          // multi-pixel junction cluster (e.g. the centre of 'x'/'k') where the arms
          // terminate on different cluster pixels and never share one node.
          let best = -1, bestRev = false, bestTurn = MAX_TURN;
          let brBest = -1, brRev = false, brTurn = BRIDGE_TURN;
          for (let j = 0; j < frags.length; j++) {
            if (used[j]) continue;
            const p = frags[j].points, k = kOf(p), a = p[0], b = p[p.length - 1];
            const da = dist2(joint, a), db = dist2(joint, b);
            if (da <= ADJ2) { const t = angDiff(arrive, dir(a, p[k])); if (t < bestTurn) { bestTurn = t; best = j; bestRev = false; } }
            else if (da <= BRIDGE2) { const t = angDiff(arrive, dir(a, p[k])); if (t < brTurn) { brTurn = t; brBest = j; brRev = false; } }
            if (db <= ADJ2) { const t = angDiff(arrive, dir(b, p[p.length - 1 - k])); if (t < bestTurn) { bestTurn = t; best = j; bestRev = true; } }
            else if (db <= BRIDGE2) { const t = angDiff(arrive, dir(b, p[p.length - 1 - k])); if (t < brTurn) { brTurn = t; brBest = j; brRev = true; } }
          }
          let bridged = false;
          if (best < 0 && brBest >= 0) { best = brBest; bestRev = brRev; bridged = true; }
          if (best < 0) continue;
          used[best] = true;
          const f = frags[best];
          let cand = f.points.slice();
          let farIdx;
          if (bestRev) { cand.reverse(); farIdx = f.startIdx; } else { farIdx = f.endIdx; }
          // adjacency: cand[0] duplicates the joint, drop it. bridge: keep cand[0] so the
          // connecting segment is drawn straight across the junction gap.
          if (atEnd) {
            points = points.concat(bridged ? cand : cand.slice(1));
            ends[1] = farIdx;
          } else {
            cand.reverse();
            points = (bridged ? cand : cand.slice(0, -1)).concat(points);
            ends[0] = farIdx;
          }
          grew = true;
        }
      }
      const closed = points.length >= 4 && near(points[0], points[points.length - 1]);
      out.push({ points, startIdx: ends[0], endIdx: ends[1], closed });
    }
    return out;
  }

  function distanceTransform(mask, w, h) {
    const d = new Float32Array(w * h);
    const diag = Math.SQRT2;
    for (let i = 0; i < d.length; i++) d[i] = mask[i] ? Infinity : 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!mask[i]) continue;
        let v = d[i];
        if (x > 0) v = Math.min(v, d[i - 1] + 1);
        if (y > 0) v = Math.min(v, d[i - w] + 1);
        if (x > 0 && y > 0) v = Math.min(v, d[i - w - 1] + diag);
        if (x < w - 1 && y > 0) v = Math.min(v, d[i - w + 1] + diag);
        d[i] = v;
      }
    }
    for (let y = h - 1; y >= 0; y--) {
      for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x;
        if (!mask[i]) continue;
        let v = d[i];
        if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
        if (y < h - 1) v = Math.min(v, d[i + w] + 1);
        if (x < w - 1 && y < h - 1) v = Math.min(v, d[i + w + 1] + diag);
        if (x > 0 && y < h - 1) v = Math.min(v, d[i + w - 1] + diag);
        d[i] = v;
      }
    }
    return d;
  }

  function zhangSuenThin(mask, w, h) {
    const img = new Uint8Array(mask);
    if (w < 3 || h < 3) return img;
    let changed = true;
    const toRemove = [];
    while (changed) {
      changed = false;
      for (let pass = 0; pass < 2; pass++) {
        toRemove.length = 0;
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const i = y * w + x;
            if (!img[i]) continue;
            const p2 = img[i - w], p3 = img[i - w + 1], p4 = img[i + 1], p5 = img[i + w + 1];
            const p6 = img[i + w], p7 = img[i + w - 1], p8 = img[i - 1], p9 = img[i - w - 1];
            const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
            if (b < 2 || b > 6) continue;
            const a =
              (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) +
              (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
            if (a !== 1) continue;
            if (pass === 0) {
              if (p2 && p4 && p6) continue;
              if (p4 && p6 && p8) continue;
            } else {
              if (p2 && p4 && p8) continue;
              if (p2 && p6 && p8) continue;
            }
            toRemove.push(i);
          }
        }
        if (toRemove.length) {
          changed = true;
          for (const i of toRemove) img[i] = 0;
        }
      }
    }
    return img;
  }

  /* Destaircase: a connectivity-preserving post-thin pass that collapses the 2-wide
     diagonal staircases Zhang-Suen leaves (raw degree 3/4 but crossing-number Tn==2) to
     a true 1px ridge. Without it, a single rasterized curve reads as a fan of false
     junctions that fragment bowls and stop pure loops from closing (the live ring=7).
     A pixel is removed iff it is a SIMPLE POINT with >=3 ink neighbours: simple = its ink
     8-neighbours form exactly ONE 8-connected component, so deleting it cannot disconnect
     them (the simple-point theorem guarantees global topology is preserved — components,
     loops, and necks all survive). The >=3 floor protects clean 1px lines and corners
     (their pixels have <=2 neighbours) from erosion; a TRUE junction's neighbours fall in
     >=2 ring components, so junctions are never thinned. Iterated to a fixpoint -> idempotent.
     DT-CENTERING (when `dist`, the source-ink distance transform, is supplied): a 2-wide
     ridge has two centerline candidates; remove the one nearer the boundary (lower DT) and
     KEEP the ridge maximum, so the skeleton stays on the medial axis. Without this, naive
     simple-point removal strips one side and decenters the line, which makes the curve-fit's
     ink-guard facet the bowls (a smoothness regression). A pixel is removed only if it has an
     ink neighbour at >= its own DT (i.e. it is not a strict ridge max). */
  function destaircase(skel, w, h, dist) {
    if (w < 3 || h < 3) return new Uint8Array(skel);
    const s = new Uint8Array(skel);
    let changed = true, guard = 0;
    while (changed && guard++ < 64) {
      changed = false;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (!s[i]) continue;
          let n = 0, hasHigherOrEqual = false;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const j = (y + dy) * w + (x + dx);
            if (s[j]) { n++; if (dist && dist[j] >= dist[i] - 0.001) hasHigherOrEqual = true; }
          }
          if (n < 3 || n > 7) continue;                 // skip ends/lines/corners (<3) and full blobs (8: would punch a hole)
          if (dist && !hasHigherOrEqual) continue;       // strict ridge maximum -> keep it centered
          if (ringComponents8(x, y, s, w) !== 1) continue; // not a simple point -> junction or bridge; keep
          s[i] = 0; changed = true;
        }
      }
    }
    return s;
  }

  /* Count 8-connected components of the ink pixels in the 8-ring around (x,y), excluding
     the centre. ==1 means the centre is a simple point (removable without disconnecting
     its neighbours); >=2 means it bridges separate branches (a real junction/articulation). */
  function ringComponents8(x, y, s, w) {
    const ring = [
      [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0],
    ];
    const ink = ring.map(([dx, dy]) => !!s[(y + dy) * w + (x + dx)]);
    let comps = 0;
    const seen = [false, false, false, false, false, false, false, false];
    for (let start = 0; start < 8; start++) {
      if (!ink[start] || seen[start]) continue;
      comps++;
      const stack = [start];
      seen[start] = true;
      while (stack.length) {
        const k = stack.pop();
        const [kx, ky] = ring[k];
        for (let j = 0; j < 8; j++) {
          if (seen[j] || !ink[j]) continue;
          const [jx, jy] = ring[j];
          if (Math.abs(kx - jx) <= 1 && Math.abs(ky - jy) <= 1) { seen[j] = true; stack.push(j); }
        }
      }
    }
    return comps;
  }

  function skeletonComponents(skel, w, h) {
    const seen = new Uint8Array(w * h);
    const comps = [];
    const stack = [];
    for (let i = 0; i < skel.length; i++) {
      if (!skel[i] || seen[i]) continue;
      const comp = { pixels: [], minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, sumX: 0, sumY: 0 };
      seen[i] = 1;
      stack.push(i);
      while (stack.length) {
        const p = stack.pop();
        const x = p % w;
        const y = (p - x) / w;
        comp.pixels.push(p);
        comp.sumX += x;
        comp.sumY += y;
        if (x < comp.minX) comp.minX = x;
        if (x > comp.maxX) comp.maxX = x;
        if (y < comp.minY) comp.minY = y;
        if (y > comp.maxY) comp.maxY = y;
        for (const n of skeletonNeighborIndices(p, skel, w, h)) {
          if (!seen[n]) {
            seen[n] = 1;
            stack.push(n);
          }
        }
      }
      comps.push(comp);
    }
    return comps;
  }

  function skeletonNeighborIndices(i, skel, w, h) {
    const out = [];
    const x = i % w;
    const y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        if (nx < 0 || nx >= w) continue;
        const n = ny * w + nx;
        if (skel[n]) out.push(n);
      }
    }
    return out;
  }

  function edgeKey(a, b) {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
  }

  /* Rutovitz crossing number (Tn): count of 0->1 transitions around the 8-ring of a
     skeleton pixel = its true branch count. Unlike the raw 8-neighbour degree, a
     rasterized curve's staircase pixel scores Tn==2 (a plain edge) not 3, so loops and
     curves aren't mis-split at staircases. Tn==1 ~ endpoint, Tn==2 edge, Tn>=3 junction. */
  function crossingNumber(i, skel, w, h) {
    const x = i % w, y = (i - i % w) / w;
    const g = (xx, yy) => (xx < 0 || xx >= w || yy < 0 || yy >= h) ? 0 : (skel[yy * w + xx] ? 1 : 0);
    const r = [g(x, y - 1), g(x + 1, y - 1), g(x + 1, y), g(x + 1, y + 1), g(x, y + 1), g(x - 1, y + 1), g(x - 1, y), g(x - 1, y - 1)];
    let tn = 0; for (let k = 0; k < 8; k++) if (r[k] === 0 && r[(k + 1) % 8] === 1) tn++;
    return tn;
  }

  function pointFromIndex(i, w) {
    const x = i % w;
    return [x, (i - x) / w];
  }

  function markEdge(a, b, visitedEdges) {
    visitedEdges.add(edgeKey(a, b));
  }

  function walkSkeletonEdge(start, next, skel, degree, w, h, visitedEdges, guardLimit) {
    const points = [pointFromIndex(start, w)];
    let prev = start;
    let cur = next;
    markEdge(prev, cur, visitedEdges);
    let guard = 0;
    while (guard++ < guardLimit) {
      points.push(pointFromIndex(cur, w));
      if (degree[cur] !== 2) break;
      const ns = skeletonNeighborIndices(cur, skel, w, h).filter(n => n !== prev);
      if (!ns.length) break;
      const n = ns[0];
      if (visitedEdges.has(edgeKey(cur, n))) break;
      markEdge(cur, n, visitedEdges);
      prev = cur;
      cur = n;
    }
    return { start, end: cur, points };
  }

  function walkSkeletonLoop(start, next, skel, w, h, visitedEdges, guardLimit) {
    const points = [pointFromIndex(start, w)];
    let prev = start;
    let cur = next;
    let closed = false;
    markEdge(prev, cur, visitedEdges);
    let guard = 0;
    while (guard++ < guardLimit) {
      if (cur === start) {
        closed = true;
        break;
      }
      points.push(pointFromIndex(cur, w));
      const ns = skeletonNeighborIndices(cur, skel, w, h).filter(n => n !== prev);
      if (!ns.length) break;
      // Staircase-aware: a ring's deg-3 staircase pixel has two non-prev neighbours;
      // pick the straightest continuation (smallest turn from the arrival direction)
      // so the walk follows the loop instead of darting down the redundant diagonal.
      let n = ns[0];
      if (ns.length > 1) {
        const cp = pointFromIndex(cur, w), pp = pointFromIndex(prev, w);
        const arrive = Math.atan2(cp[1] - pp[1], cp[0] - pp[0]);
        let best = Infinity;
        for (const cand of ns) {
          if (cand !== start && visitedEdges.has(edgeKey(cur, cand))) continue;
          const np = pointFromIndex(cand, w);
          let t = Math.abs(arrive - Math.atan2(np[1] - cp[1], np[0] - cp[0])) % (Math.PI * 2);
          if (t > Math.PI) t = Math.PI * 2 - t;
          if (t < best) { best = t; n = cand; }
        }
      }
      if (visitedEdges.has(edgeKey(cur, n)) && n !== start) break;
      markEdge(cur, n, visitedEdges);
      prev = cur;
      cur = n;
    }
    return { points, closed };
  }

  function polylineLength(points) {
    let len = 0;
    for (let i = 1; i < points.length; i++) {
      const dx = points[i][0] - points[i - 1][0];
      const dy = points[i][1] - points[i - 1][1];
      len += Math.hypot(dx, dy);
    }
    return len;
  }

  /* Mean absolute turn per vertex (a curvature magnitude, rad/sample) over the window of
     `points` between indices a and b inclusive. Used by the graph router to prefer pairing
     edge-ends of similar bend (stem-with-stem, arc-with-arc) when their tangents tie. */
  function edgeEndCurvature(points, a, b) {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    if (hi - lo < 2) return 0;
    let total = 0, n = 0;
    for (let i = lo + 1; i < hi; i++) {
      const d1 = Math.atan2(points[i][1] - points[i - 1][1], points[i][0] - points[i - 1][0]);
      const d2 = Math.atan2(points[i + 1][1] - points[i][1], points[i + 1][0] - points[i][0]);
      let t = Math.abs(d2 - d1) % (Math.PI * 2); if (t > Math.PI) t = Math.PI * 2 - t;
      total += t; n++;
    }
    return n ? total / n : 0;
  }

  function simplifyPolyline(points, tolerance, closed) {
    if (points.length <= (closed ? 3 : 2)) return points;
    const simplified = douglasPeucker(points, tolerance);
    if (closed && simplified.length < 3) return points;
    if (!closed && simplified.length < 2) return points;
    return simplified;
  }

  function douglasPeucker(points, tolerance) {
    if (points.length <= 2) return points.slice();
    let maxDist = -1;
    let index = -1;
    const first = points[0];
    const last = points[points.length - 1];
    for (let i = 1; i < points.length - 1; i++) {
      const d = pointLineDistance(points[i], first, last);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (maxDist > tolerance && index > 0) {
      const left = douglasPeucker(points.slice(0, index + 1), tolerance);
      const right = douglasPeucker(points.slice(index), tolerance);
      return left.slice(0, -1).concat(right);
    }
    return [first, last];
  }

  function pointLineDistance(p, a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
    const x = a[0] + t * dx;
    const y = a[1] + t * dy;
    return Math.hypot(p[0] - x, p[1] - y);
  }

  /* ============================================================
   * SINGLE-LINE CURVE FITTING + CLEANUP (curve-fit-and-cleanup spec)
   * ------------------------------------------------------------
   * The single-line kernel emits clean simplified polylines; v1 serialized
   * them as M/L/Z only, so every bowl came out faceted. This pass fits cubic
   * beziers to the curved runs and cleans terminals/seams. It runs entirely
   * inside the single-line path (refineSingleLineContour, called at the end of
   * traceCellSingleLine) — the filled Potrace pipeline never sees any of it.
   * No dependencies: corner detection, classification, and the Schneider
   * least-squares fit are all small in-file functions.
   * ============================================================ */

  // --- tiny 2D vector helpers (operate on [x,y] arrays) ---
  function v_sub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
  function v_add(a, b) { return [a[0] + b[0], a[1] + b[1]]; }
  function v_scale(a, s) { return [a[0] * s, a[1] * s]; }
  function v_dot(a, b) { return a[0] * b[0] + a[1] * b[1]; }
  function v_len(a) { return Math.hypot(a[0], a[1]); }
  function v_norm(a) { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; }

  // Exterior turn angle at a vertex (0 = straight through, PI = full reversal).
  function turnAngle(prev, cur, next) {
    const a = v_sub(cur, prev), b = v_sub(next, cur);
    const la = v_len(a), lb = v_len(b);
    if (la < 1e-6 || lb < 1e-6) return 0;
    let c = v_dot(a, b) / (la * lb);
    c = Math.max(-1, Math.min(1, c));
    return Math.acos(c);
  }

  /* Schneider "fitCurve" (Graphics Gems): least-squares fit of one or more
     cubic beziers to a point run, recursively splitting at max error and
     reparameterizing. errSq is the SQUARED tolerance (compared against squared
     point-to-curve distance). Returns [[p0,c1,c2,p3], ...]. */
  function fitCurve(points, errSq) {
    const pts = [];
    for (const p of points) {
      const l = pts[pts.length - 1];
      if (!l || Math.abs(l[0] - p[0]) > 1e-9 || Math.abs(l[1] - p[1]) > 1e-9) pts.push(p);
    }
    if (pts.length < 2) return [];
    if (pts.length === 2) {
      const d = v_len(v_sub(pts[1], pts[0])) / 3;
      const t = v_norm(v_sub(pts[1], pts[0]));
      return [[pts[0], v_add(pts[0], v_scale(t, d)), v_add(pts[1], v_scale(t, -d)), pts[1]]];
    }
    const lt = v_norm(v_sub(pts[1], pts[0]));
    const rt = v_norm(v_sub(pts[pts.length - 2], pts[pts.length - 1]));
    return fitCubic(pts, lt, rt, errSq);
  }
  function fitCubic(points, leftTangent, rightTangent, errSq) {
    if (points.length === 2) {
      const d = v_len(v_sub(points[1], points[0])) / 3;
      return [[points[0], v_add(points[0], v_scale(leftTangent, d)),
               v_add(points[1], v_scale(rightTangent, d)), points[1]]];
    }
    let u = chordLengthParameterize(points);
    let bez = generateBezier(points, u, leftTangent, rightTangent);
    let [maxErr, split] = computeMaxError(points, bez, u);
    if (maxErr < errSq) return [bez];
    if (maxErr < errSq * errSq) {           // error not too large: try reparameterizing
      for (let i = 0; i < 20; i++) {
        u = reparameterize(bez, points, u);
        bez = generateBezier(points, u, leftTangent, rightTangent);
        [maxErr, split] = computeMaxError(points, bez, u);
        if (maxErr < errSq) return [bez];
      }
    }
    if (split <= 0) split = 1;
    if (split >= points.length - 1) split = points.length - 2;
    const center = v_norm(v_sub(points[split - 1], points[split + 1]));
    const left = fitCubic(points.slice(0, split + 1), leftTangent, center, errSq);
    const right = fitCubic(points.slice(split), v_scale(center, -1), rightTangent, errSq);
    return left.concat(right);
  }
  function chordLengthParameterize(points) {
    const u = [0];
    for (let i = 1; i < points.length; i++) u[i] = u[i - 1] + v_len(v_sub(points[i], points[i - 1]));
    const last = u[u.length - 1] || 1;
    for (let i = 0; i < u.length; i++) u[i] /= last;
    return u;
  }
  function bernstein(u) { const mt = 1 - u; return [mt * mt * mt, 3 * u * mt * mt, 3 * u * u * mt, u * u * u]; }
  function generateBezier(points, u, leftTangent, rightTangent) {
    const n = points.length, p0 = points[0], p3 = points[n - 1];
    let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
    for (let i = 0; i < n; i++) {
      const b = bernstein(u[i]);
      const a0 = v_scale(leftTangent, b[1]);
      const a1 = v_scale(rightTangent, b[2]);
      c00 += v_dot(a0, a0); c01 += v_dot(a0, a1); c11 += v_dot(a1, a1);
      const tmp = v_sub(points[i], v_add(v_scale(p0, b[0] + b[1]), v_scale(p3, b[2] + b[3])));
      x0 += v_dot(a0, tmp); x1 += v_dot(a1, tmp);
    }
    const det = c00 * c11 - c01 * c01;
    let alphaL = det === 0 ? 0 : (x0 * c11 - c01 * x1) / det;
    let alphaR = det === 0 ? 0 : (c00 * x1 - c01 * x0) / det;
    const chord = v_len(v_sub(p3, p0));
    let arc = 0;
    for (let i = 1; i < n; i++) arc += v_len(v_sub(points[i], points[i - 1]));
    const eps = 1e-6 * (chord || arc);
    // Handle runaway: a near-singular least-squares (parallel end tangents on an
    // arch, e.g. n/m/h) sends alpha huge and the cubic balloons off the spine
    // (containment, acceptance criterion 5). A control handle longer than the
    // run's own arc length is nonsensical — fall back to equal-thirds, which
    // makes the fit inaccurate enough that fitCubic recursively splits into
    // contained sub-curves. Also covers negative/degenerate alpha (Wu/Barsky).
    const maxAlpha = arc;
    if (!isFinite(alphaL) || !isFinite(alphaR) ||
        alphaL < eps || alphaR < eps || alphaL > maxAlpha || alphaR > maxAlpha) {
      const h = (chord > eps ? chord : arc) / 3;
      alphaL = alphaR = h;
    }
    return [p0, v_add(p0, v_scale(leftTangent, alphaL)),
            v_add(p3, v_scale(rightTangent, alphaR)), p3];
  }
  function bezEval(bez, t) {
    const b = bernstein(t);
    return [b[0] * bez[0][0] + b[1] * bez[1][0] + b[2] * bez[2][0] + b[3] * bez[3][0],
            b[0] * bez[0][1] + b[1] * bez[1][1] + b[2] * bez[2][1] + b[3] * bez[3][1]];
  }
  function bezPrime(bez, t) {
    const d0 = v_scale(v_sub(bez[1], bez[0]), 3), d1 = v_scale(v_sub(bez[2], bez[1]), 3), d2 = v_scale(v_sub(bez[3], bez[2]), 3);
    const mt = 1 - t;
    return [mt * mt * d0[0] + 2 * mt * t * d1[0] + t * t * d2[0],
            mt * mt * d0[1] + 2 * mt * t * d1[1] + t * t * d2[1]];
  }
  function bezPrime2(bez, t) {
    const a = v_scale(v_sub(v_sub(bez[2], bez[1]), v_sub(bez[1], bez[0])), 6);
    const b = v_scale(v_sub(v_sub(bez[3], bez[2]), v_sub(bez[2], bez[1])), 6);
    return [(1 - t) * a[0] + t * b[0], (1 - t) * a[1] + t * b[1]];
  }
  function reparameterize(bez, points, u) {
    return u.map((uu, i) => {
      const d = v_sub(bezEval(bez, uu), points[i]);
      const qp = bezPrime(bez, uu), qpp = bezPrime2(bez, uu);
      const num = d[0] * qp[0] + d[1] * qp[1];
      const den = (qp[0] * qp[0] + qp[1] * qp[1]) + (d[0] * qpp[0] + d[1] * qpp[1]);
      return den === 0 ? uu : uu - num / den;
    });
  }
  function computeMaxError(points, bez, u) {
    let maxD = 0, split = Math.floor(points.length / 2);
    for (let i = 0; i < points.length; i++) {
      const p = bezEval(bez, u[i]);
      const dx = p[0] - points[i][0], dy = p[1] - points[i][1];
      const d = dx * dx + dy * dy;
      if (d > maxD) { maxD = d; split = i; }
    }
    return [maxD, split];
  }

  // Run is "straight" if every interior point sits within `tol` of the chord.
  function runIsStraight(run, tol) {
    const a = run[0], b = run[run.length - 1];
    for (let i = 1; i < run.length - 1; i++) {
      if (pointLineDistance(run[i], a, b) > tol) return false;
    }
    return true;
  }

  /* Corner-split into contiguous runs (each run shares its end vertex with the
     next run's start, so the pen never lifts mid-contour). Open contours split
     at interior corners. Closed contours: a smooth loop with no corner stays
     one run (fitted as a closed bezier chain); a loop with corners is rotated
     to begin at its first corner so runs tile corner->corner around the seam.
     Returns { runs, points } — points may be the rotated point list. */
  function cornerSplit(pts, cornerTurn, closed) {
    if (!closed) {
      const n = pts.length;
      const runs = [];
      let start = 0;
      for (let i = 1; i < n - 1; i++) {
        if (turnAngle(pts[i - 1], pts[i], pts[i + 1]) > cornerTurn) { runs.push(pts.slice(start, i + 1)); start = i; }
      }
      runs.push(pts.slice(start));
      return { runs, points: pts };
    }
    // closed: pts[0] === pts[last]; work on the de-duplicated ring `base`.
    const base = pts.slice(0, pts.length - 1);
    const m = base.length;
    const cornerIdx = [];
    for (let i = 0; i < m; i++) {
      if (turnAngle(base[(i - 1 + m) % m], base[i], base[(i + 1) % m]) > cornerTurn) cornerIdx.push(i);
    }
    if (cornerIdx.length === 0) return { runs: [pts], points: pts };  // pure smooth loop
    const r = cornerIdx[0];
    const rot = base.slice(r).concat(base.slice(0, r));
    rot.push([rot[0][0], rot[0][1]]);                                 // re-close
    const n = rot.length;
    const runs = [];
    let start = 0;
    for (let i = 1; i < n - 1; i++) {
      if (turnAngle(rot[i - 1], rot[i], rot[i + 1]) > cornerTurn) { runs.push(rot.slice(start, i + 1)); start = i; }
    }
    runs.push(rot.slice(start));
    return { runs, points: rot };
  }

  /* Fix 2 item 3: snap a closed contour's endpoints together and drop a tiny
     tail segment near the seam so the O/a/d bowls close with no stub or
     crossing. */
  function snapClosedSeam(pts, strokeRadius) {
    if (pts.length < 4) return pts;
    const p = pts.slice();
    const tol = Math.max(1.0, strokeRadius * 0.9);
    p[p.length - 1] = [p[0][0], p[0][1]];
    while (p.length > 4 && v_len(v_sub(p[p.length - 2], p[0])) < tol) {
      p.splice(p.length - 2, 1);
      p[p.length - 1] = [p[0][0], p[0][1]];
    }
    return p;
  }

  /* Fix 2 item 2: trim a short hooked stub at an open stroke's terminal (the
     hook past the A apex, the little stubs on C/c terminals, the Q tail
     crossing). Only removes a final vertex when the last segment is BOTH short
     AND turns sharply away from the stroke direction — a structural overshoot,
     never real letter geometry. Both ends are trimmed. */
  function trimTerminalOvershoot(pts, strokeRadius) {
    if (pts.length < 4) return pts;
    let p = pts.slice();
    const shortLen = Math.max(1.5, strokeRadius * 1.2);
    const sharp = Math.PI * 0.5;            // >=90deg turn at the terminal = a hook
    const trimEnd = () => {
      const n = p.length;
      if (n < 4) return false;
      const seg = v_sub(p[n - 1], p[n - 2]);
      const prev = v_sub(p[n - 2], p[n - 3]);
      const ls = v_len(seg), lp = v_len(prev);
      if (ls >= shortLen || lp < 1e-6) return false;
      let c = v_dot(seg, prev) / (ls * lp || 1);
      c = Math.max(-1, Math.min(1, c));
      if (Math.acos(c) > sharp) { p.splice(n - 1, 1); return true; }
      return false;
    };
    let guard = 4; while (guard-- > 0 && trimEnd()) { /* repeat */ }
    p.reverse();
    guard = 4; while (guard-- > 0 && trimEnd()) { /* repeat */ }
    p.reverse();
    return p;
  }

  /* ===== INK CONTAINMENT (product gate) ============================================
     A single-line trace must stay on the glyph spine. These enforce it against the
     source ink (`mask`, 1 = ink), independent of which router produced the contour. */
  function makeInkTest(mask, w, h, tol) {
    return (x, y) => {
      const cx = Math.round(x), cy = Math.round(y);
      for (let dy = -tol; dy <= tol; dy++) for (let dx = -tol; dx <= tol; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h && mask[ny * w + nx]) return true;
      }
      return false;
    };
  }
  function segOnInk(a, b, inkTest) {
    const n = Math.max(2, Math.ceil(v_len(v_sub(b, a))));
    for (let s = 0; s <= n; s++) { const x = a[0] + (b[0] - a[0]) * s / n, y = a[1] + (b[1] - a[1]) * s / n; if (!inkTest(x, y)) return false; }
    return true;
  }
  /* Post-refine ink-containment guarantee. Densely samples a contour's FINAL rendered
     geometry (every cubic + every L sub-pixel) and flags each sample on/off the source
     ink. If all on-ink, the contour is returned untouched (curves preserved). Otherwise
     it is split into maximal on-ink runs (the off-ink chord/bulge spans become pen-lifts)
     and each run is emitted as an on-ink polyline (faceted but on the spine — correctness
     over smoothness). Operating on the rendered samples makes this bulletproof regardless
     of how the chord was produced (bridge tier, routing, or a residual fit bulge). */
  function enforceInkContainment(contour, inkTest, simpTol, strokeRadius) {
    const seg = contour.segments;
    const samples = [], flags = [];
    const push = p => { samples.push(p); flags.push(inkTest(p[0], p[1])); };
    if (seg && seg.ops && seg.ops.length) {
      let cur = seg.start; push(cur);
      for (const op of seg.ops) {
        if (op.t === 'C') { for (let t = 0.1; t <= 1.0001; t += 0.1) push(bezEval([cur, op.c1, op.c2, op.p], t)); cur = op.p; }
        else { const n = Math.max(1, Math.ceil(v_len(v_sub(op.p, cur)))); for (let s = 1; s <= n; s++) push([cur[0] + (op.p[0] - cur[0]) * s / n, cur[1] + (op.p[1] - cur[1]) * s / n]); cur = op.p; }
      }
      if (seg.closed) { const a = samples[samples.length - 1], b = seg.start, n = Math.max(1, Math.ceil(v_len(v_sub(b, a)))); for (let s = 1; s < n; s++) push([a[0] + (b[0] - a[0]) * s / n, a[1] + (b[1] - a[1]) * s / n]); }
    } else { for (const p of (contour.points || [])) push(p); }
    if (!samples.length) return [];
    let allOn = true; for (const f of flags) if (!f) { allOn = false; break; }
    if (allOn) return [contour];
    const out = [];
    let cur = [];
    for (let i = 0; i < samples.length; i++) {
      if (flags[i]) cur.push(samples[i]);
      else { if (cur.length >= 2) out.push(cur); cur = []; }
    }
    if (cur.length >= 2) out.push(cur);
    return out.map(run => {
      const s = simplifyPolyline(run, simpTol, false);
      const c = { points: s.length >= 2 ? s : run, closed: false, segments: null };
      // Re-FIT the on-ink run (corner-split + Schneider cubic) so a curved span keeps
      // its smoothness — only the off-ink chord became a pen-lift, not the whole stroke.
      // refine's own inkTest guard + containment box keep the fit on the spine; a
      // degenerate fit leaves segments null and serializes as the faceted polyline.
      // (strokeRadius omitted -> legacy faceted behavior, never the shipped call site.)
      if (strokeRadius) refineSingleLineContour(c, strokeRadius, inkTest);
      return c;
    });
  }

  /* Reverse a {start, ops, closed} segment list (the pen walks it the other way).
     L (a->b) reverses to L (b->a); C (a,c1,c2,b) reverses to C (b,c2,c1,a). Used by
     pen-lift ordering so a stroke can start at whichever end is nearer the pen. */
  function reverseSegments(seg) {
    const pts = [seg.start]; for (const o of seg.ops) pts.push(o.p);
    const ops = [];
    for (let i = seg.ops.length - 1; i >= 0; i--) {
      const o = seg.ops[i];
      if (o.t === 'C') ops.push({ t: 'C', c1: o.c2, c2: o.c1, p: pts[i] });
      else ops.push({ t: 'L', p: pts[i] });
    }
    return { start: pts[pts.length - 1], ops, closed: seg.closed };
  }
  function contourEnds(c) {
    const s = c.segments ? c.segments.start : (c.points && c.points[0]);
    const e = (c.segments && c.segments.ops && c.segments.ops.length) ? c.segments.ops[c.segments.ops.length - 1].p
            : (c.points && c.points[c.points.length - 1]);
    return [s || [0, 0], e || s || [0, 0]];
  }
  function reverseContour(c) {
    const r = { closed: c.closed };
    if (c.segments) r.segments = reverseSegments(c.segments);
    if (c.points) r.points = c.points.slice().reverse();
    return r;
  }
  /* Pen-lift ordering (Eulerian-ish, per glyph): greedily order a glyph's strokes so
     each starts at whichever free end is nearest the pen's last position, reversing
     open strokes as needed. Pure reordering + direction flip — geometry is untouched,
     so it can't change the rendered shape or the off-ink metric; it only shortens the
     pen's air-travel between strokes for plotter/Cricut output (and chains any strokes
     that already share an endpoint). Closed loops aren't reversed (a loop is a loop). */
  function orderForPenPlot(contours) {
    if (contours.length <= 1) return contours;
    const d2 = (a, b) => { const dx = a[0] - b[0], dy = a[1] - b[1]; return dx * dx + dy * dy; };
    const used = new Array(contours.length).fill(false);
    const out = [];
    let pen = contourEnds(contours[0])[0];   // anchor at the first stroke's start
    for (let k = 0; k < contours.length; k++) {
      let best = -1, bestD = Infinity, rev = false;
      for (let i = 0; i < contours.length; i++) {
        if (used[i]) continue;
        const [s, e] = contourEnds(contours[i]);
        const ds = d2(pen, s); if (ds < bestD) { bestD = ds; best = i; rev = false; }
        if (!contours[i].closed) { const de = d2(pen, e); if (de < bestD) { bestD = de; best = i; rev = true; } }
      }
      used[best] = true;
      const c = rev ? reverseContour(contours[best]) : contours[best];
      out.push(c);
      pen = contourEnds(c)[1];
    }
    return out;
  }

  /* Mutates `contour`: cleans the polyline (seam/overshoot), corner-splits,
     classifies each run, and attaches `contour.segments` = { start, ops, closed }
     where ops are {t:'L',p} or {t:'C',c1,c2,p}. singleLineContourPathD serializes
     these; if segments is null it falls back to the faceted polyline.
     `inkTest` (optional): a fitted cubic that bulges off the ink is replaced by the
     on-ink polyline for that run — the spine wins over smoothness. */
  function refineSingleLineContour(contour, strokeRadius, inkTest) {
    const closed = !!contour.closed;
    const cornerTurn = Math.PI / 3;                              // ~60deg = a corner
    const straightTol = Math.max(0.6, strokeRadius * 0.45);
    // Fit tolerance hugs the CENTERLINE, so it must NOT grow with stroke width. A thick
    // stroke scaled this to ~3.5px, which let fitCurve approximate a bowl with one 180deg
    // cubic per side — a cubic represents a >90deg arc badly, so it bulged off the thin
    // centerline, the ink-guard faceted it to a line, and a closed bowl collapsed into a
    // degenerate digon that containment then split into pieces. Capped at ~1.6px so the fit
    // always splits a large arc into enough cubics to stay on the spine, at any stroke width.
    const fitErrSq = Math.pow(Math.max(0.8, Math.min(1.6, strokeRadius * 0.5)), 2);
    const containMargin = Math.max(3, strokeRadius * 2);        // see containment note below

    let pts = closed ? snapClosedSeam(contour.points, strokeRadius)
                     : trimTerminalOvershoot(contour.points, strokeRadius);
    contour.points = pts;
    if (pts.length < (closed ? 4 : 3)) { contour.segments = null; return; }

    const split = cornerSplit(pts, cornerTurn, closed);
    contour.points = split.points;
    const ops = [];
    for (const run of split.runs) {
      if (run.length < 2) continue;
      if (run.length === 2 || runIsStraight(run, straightTol)) {
        ops.push({ t: 'L', p: run[run.length - 1] });
        continue;
      }
      const beziers = fitCurve(run, fitErrSq);
      if (!beziers.length) { ops.push({ t: 'L', p: run[run.length - 1] }); continue; }
      /* Emit the fitted cubics. We deliberately do NOT downgrade an off-ink or
         large-handle cubic to a straight L here: a single L chord across a curved
         span bulges FARTHER off the thin ink than the cubic it replaced (the cursive
         "C splits into 3" bug), and enforceInkContainment now RE-FITS any genuinely
         off-ink span into honest on-ink pieces. The only hard guard kept is the box
         clamp, and it splits the offending cubic at its own midpoint and re-fits each
         half (curvature-preserving) rather than chording across it. generateBezier
         already clamps the control-handle length to the run's arc, so a cubic can't
         balloon; this caps the rare residual overshoot without faceting the curve. */
      let rminX = Infinity, rminY = Infinity, rmaxX = -Infinity, rmaxY = -Infinity;
      for (const p of run) { if (p[0] < rminX) rminX = p[0]; if (p[0] > rmaxX) rmaxX = p[0]; if (p[1] < rminY) rminY = p[1]; if (p[1] > rmaxY) rmaxY = p[1]; }
      const inBox = q => q[0] >= rminX - containMargin && q[0] <= rmaxX + containMargin && q[1] >= rminY - containMargin && q[1] <= rmaxY + containMargin;
      const emit = (b, depth) => {
        if ((inBox(b[1]) && inBox(b[2])) || depth >= 3) { ops.push({ t: 'C', c1: b[1], c2: b[2], p: b[3] }); return; }
        // de Casteljau split at t=0.5, re-fit each half's handles toward the midpoint
        const mid = bezEval(b, 0.5);
        const m1 = bezEval(b, 0.25), m2 = bezEval(b, 0.75);
        const lt = v_norm(v_sub(b[1], b[0])), rt = v_norm(v_sub(b[2], b[3]));
        const dL = v_len(v_sub(mid, b[0])) / 3, dR = v_len(v_sub(mid, b[3])) / 3;
        emit([b[0], v_add(b[0], v_scale(lt, dL)), v_add(mid, v_scale(v_norm(v_sub(m1, mid)), dL)), mid], depth + 1);
        emit([mid, v_add(mid, v_scale(v_norm(v_sub(m2, mid)), dR)), v_add(b[3], v_scale(rt, dR)), b[3]], depth + 1);
      };
      for (const b of beziers) emit(b, 0);
    }

    /* Finite scrub: any non-finite coordinate (degenerate fit) abandons the
       fitted segments and falls back to the faceted-but-valid polyline. */
    let ok = !!split.points[0] && isFinite(split.points[0][0]) && isFinite(split.points[0][1]);
    for (const op of ops) {
      const cs = op.t === 'C' ? [op.c1, op.c2, op.p] : [op.p];
      for (const q of cs) if (!isFinite(q[0]) || !isFinite(q[1])) ok = false;
    }
    contour.segments = ok ? { start: split.points[0], ops, closed } : null;
  }

  global.SingleLineCore = {
    traceCellSingleLine, refineSingleLineContour, fitCurve, cornerSplit,
    snapClosedSeam, trimTerminalOvershoot, simplifyPolyline, runIsStraight,
    distanceTransform, zhangSuenThin, destaircase, polylineLength, reverseSegments, orderForPenPlot,
    enforceInkContainment, makeInkTest,
  };
})(typeof self !== 'undefined' ? self : globalThis);
