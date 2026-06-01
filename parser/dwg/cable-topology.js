import { latLonToUtm } from "../geo/utm-calibrator.js";

/**
 * Derive post-to-post route topology from the DWG secondary-cable geometry
 * (TrechoSecundarioAereo) instead of from post numbering + distance labels.
 *
 * Why: at branch points post numbering lies (post 65 is numbered after 64 but sits
 * 22 m from 59 while cable-connecting to 64 over 160 m), and no single scalar signal
 * (numbering, GPS proximity, GPS span) separates real edges from numbering artifacts.
 * The cable polylines DO encode the real connectivity. This contracts the cable graph
 * down to the numbered posts, then bridges the few gaps where the drawing's cable is
 * fragmented. Fully generic — no post numbers, works on any project drawn this way.
 *
 * Algorithm:
 *  1. Build a vertex graph from cable polylines. Within one polyline, consecutive
 *     vertices link directly. Across polylines, only ENDPOINTS fuse (within mergeTol),
 *     so two distinct cables that merely cross/near-touch mid-span are NOT joined.
 *  2. Each post "owns" cable vertices within attachR (its attachment points).
 *  3. Contract: posts A,B are adjacent iff a cable path joins an A-owned vertex to a
 *     B-owned vertex through unowned vertices only.
 *  4. Bridge: the cable fragments into components; merge them with the shortest
 *     cross-component post pair (Kruskal over GPS distance) until one tree.
 *
 * @param {Array<{ number: number, lat?: number|null, lon?: number|null }>} posts
 * @param {Array<{ a: {x:number,y:number}, b: {x:number,y:number}, poly?: number }>} cableEdges
 * @param {{ mergeTol?: number, attachR?: number, zone?: number }} [opts]
 * @returns {{ edges: Array<{from:number,to:number}>, components: number, bridges: number } | null}
 */
export function deriveCableTopology(posts, cableEdges, opts = {}) {
  const { mergeTol = 0.3, attachR = 7, zone = 22 } = opts;
  if (!Array.isArray(cableEdges) || cableEdges.length === 0) return null;

  /** @type {Map<number, {e:number,n:number}>} */
  const postUtm = new Map();
  for (const p of posts ?? []) {
    if (p?.number != null && p.lat != null && p.lon != null) {
      const u = latLonToUtm(p.lat, p.lon, zone);
      postUtm.set(p.number, { e: u.easting, n: u.northing });
    }
  }
  if (postUtm.size === 0) return null;

  // ── 1. vertex graph ────────────────────────────────────────────────────────
  // Exact-ish dedup so consecutive within-polyline vertices share node ids.
  const EPS = 0.05;
  const nodes = []; // {x,y,endpoint:boolean}
  const buckets = new Map();
  const cell = (x, y) => `${Math.floor(x / 5)}_${Math.floor(y / 5)}`;
  function vid(x, y) {
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const arr = buckets.get(`${Math.floor(x / 5) + dx}_${Math.floor(y / 5) + dy}`);
        if (!arr) continue;
        for (const id of arr) if (Math.hypot(nodes[id].x - x, nodes[id].y - y) <= EPS) return id;
      }
    const id = nodes.length;
    nodes.push({ x, y, endpoint: false });
    const k = cell(x, y);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(id);
    return id;
  }

  const adj = new Map();
  const link = (a, b) => {
    if (a === b) return;
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b);
    adj.get(b).add(a);
  };

  // Group edges by polyline so we know each span's endpoints.
  const byPoly = new Map();
  for (const e of cableEdges) {
    if (!e?.a || !e?.b) continue;
    const p = e.poly ?? -1;
    if (!byPoly.has(p)) byPoly.set(p, []);
    byPoly.get(p).push(e);
  }
  const endpointIds = [];
  for (const [, edges] of byPoly) {
    const ids = [];
    for (const e of edges) {
      const ia = vid(e.a.x, e.a.y);
      const ib = vid(e.b.x, e.b.y);
      link(ia, ib);
      ids.push(ia, ib);
    }
    // Endpoints = vertices used once within this polyline (the two ends).
    const count = new Map();
    for (const id of ids) count.set(id, (count.get(id) ?? 0) + 1);
    for (const [id, c] of count) if (c === 1) { nodes[id].endpoint = true; endpointIds.push(id); }
  }

  // Fuse only endpoints across polylines (within mergeTol) — spatial grid avoids O(n²).
  const epCell = mergeTol > 0 ? mergeTol : 0.3;
  const epBuckets = new Map();
  const epKey = (x, y) =>
    `${Math.floor(x / epCell)}_${Math.floor(y / epCell)}`;
  for (const a of endpointIds) {
    const ax = nodes[a].x;
    const ay = nodes[a].y;
    const ck = epKey(ax, ay);
    if (!epBuckets.has(ck)) epBuckets.set(ck, []);
    epBuckets.get(ck).push(a);
  }
  for (const a of endpointIds) {
    const ax = nodes[a].x;
    const ay = nodes[a].y;
    const cx = Math.floor(ax / epCell);
    const cy = Math.floor(ay / epCell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = epBuckets.get(`${cx + dx}_${cy + dy}`);
        if (!bucket) continue;
        for (const b of bucket) {
          if (b <= a) continue;
          if (Math.hypot(ax - nodes[b].x, ay - nodes[b].y) <= mergeTol) link(a, b);
        }
      }
    }
  }

  // ── 2. ownership: each vertex → nearest post within attachR ──────────────────
  const owner = new Map();
  const postNums = [...postUtm.keys()];
  const postAttachCell = attachR;
  const postBuckets = new Map();
  const postBucketKey = (e, n) =>
    `${Math.floor(e / postAttachCell)}_${Math.floor(n / postAttachCell)}`;
  for (const num of postNums) {
    const u = postUtm.get(num);
    const k = postBucketKey(u.e, u.n);
    if (!postBuckets.has(k)) postBuckets.set(k, []);
    postBuckets.get(k).push(num);
  }
  for (let i = 0; i < nodes.length; i++) {
    const nx = nodes[i].x;
    const ny = nodes[i].y;
    let bp = null;
    let bd = attachR;
    const cx = Math.floor(nx / postAttachCell);
    const cy = Math.floor(ny / postAttachCell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = postBuckets.get(`${cx + dx}_${cy + dy}`);
        if (!bucket) continue;
        for (const num of bucket) {
          const u = postUtm.get(num);
          const d = Math.hypot(nx - u.e, ny - u.n);
          if (d <= bd) {
            bd = d;
            bp = num;
          }
        }
      }
    }
    if (bp != null) owner.set(i, bp);
  }

  // ── 3. contract to post-to-post adjacency ───────────────────────────────────
  const postAdj = new Map();
  const addPA = (a, b) => {
    if (a === b) return;
    if (!postAdj.has(a)) postAdj.set(a, new Set());
    if (!postAdj.has(b)) postAdj.set(b, new Set());
    postAdj.get(a).add(b);
    postAdj.get(b).add(a);
  };
  for (let s = 0; s < nodes.length; s++) {
    const P = owner.get(s);
    if (P == null) continue;
    const seen = new Set([s]);
    const stack = [...(adj.get(s) ?? [])];
    for (const x of stack) seen.add(x);
    while (stack.length) {
      const cur = stack.pop();
      const O = owner.get(cur);
      if (O != null) { addPA(P, O); continue; } // reached another post — stop
      for (const nx of adj.get(cur) ?? []) { if (seen.has(nx)) continue; seen.add(nx); stack.push(nx); }
    }
  }

  // ── 4. bridge cable components via shortest cross-component post pair ─────────
  const allP = [...postUtm.keys()].sort((a, b) => a - b);
  const comp = new Map();
  let nc = 0;
  for (const p of allP) {
    if (comp.has(p)) continue;
    const stack = [p];
    comp.set(p, nc);
    while (stack.length) {
      const u = stack.pop();
      for (const v of postAdj.get(u) ?? []) if (!comp.has(v)) { comp.set(v, nc); stack.push(v); }
    }
    nc++;
  }
  let bridges = 0;
  if (nc > 1) {
    const cands = [];
    for (let i = 0; i < allP.length; i++)
      for (let k = i + 1; k < allP.length; k++) {
        const a = allP[i], b = allP[k];
        if (comp.get(a) === comp.get(b)) continue;
        const ua = postUtm.get(a), ub = postUtm.get(b);
        cands.push({ a, b, d: Math.hypot(ua.e - ub.e, ua.n - ub.n) });
      }
    cands.sort((x, y) => x.d - y.d);
    for (const c of cands) {
      if (comp.get(c.a) !== comp.get(c.b)) {
        const from = comp.get(c.b), to = comp.get(c.a);
        for (const [k, v] of comp) if (v === from) comp.set(k, to);
        addPA(c.a, c.b);
        bridges++;
      }
    }
  }

  // ── 5. emit undirected edges, rooted at the lowest post for stable direction ──
  const root = allP[0];
  const seen = new Set([root]);
  const edges = [];
  const queue = [root];
  while (queue.length) {
    const u = queue.shift();
    for (const v of [...(postAdj.get(u) ?? [])].sort((a, b) => a - b)) {
      if (seen.has(v)) continue;
      seen.add(v);
      edges.push({ from: u, to: v });
      queue.push(v);
    }
  }
  return { edges, components: nc, bridges };
}
