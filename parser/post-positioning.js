// parser/post-positioning.js
// Post PDF positions come from Poste-layer pole symbols (square+X, double circle, etc.).
// Numero_Poste / OCR only identify which post number belongs to which symbol.
// Matching uses label proximity + Cabo Projetado arc-length (not blind nearest-neighbor).

import {
  isOffRouteCablePost,
  nearestCableHitOnPage,
  nearestPointOnPathOps,
} from './cable-builder.js';

/** Max PDF-pt move from label anchor in refine-only mode. */
export const SNAP_POST_MAX_MOVE_FROM_ANCHOR_PT = 50;

/** Legacy wide radius for refine-mode snap without cable context. */
export const SNAP_POST_TO_POSTE_SYMBOL_MAX_PT = 220;

/** Tight dedupe for square+X subpath centroids (same pole, multiple strokes). */
export const POSTE_RAW_DEDUPE_PT = 12;

/** Max label anchor → pole symbol (PDF pt). */
export const POSTE_LABEL_MATCH_MAX_PT = 100;

/** Max label anchor → Cabo Projetado (pole symbol is often offset from the red line). */
export const POSTE_CABLE_ANCHOR_MAX_PT = 95;

/** Max |arc on cable| between label projection and symbol on the same polyline (PDF pt). */
export const POSTE_CABLE_ARC_MATCH_MAX_PT = 150;

/** Beam width for global label-residual pole assignment (N3). */
export const GLOBAL_POLE_BEAM_WIDTH = 8;

/** Top-K Poste candidates per post in global assignment (N3). */
export const GLOBAL_POLE_TOP_K = 4;

const GLOBAL_ROUTE_CABLE_NEAR_PT = 80;

/** Legacy merge radius — avoid for primary assignment (over-merges poles). */
export const POSTE_SYMBOL_CLUSTER_MERGE_PT = 88;

const ROUTE_KEY_TOLERANCE_PT = 12;
const CABLE_ARC_ORDER_TOLERANCE_PT = 15;
const SAME_COLUMN_X_PT = 10;

/** Label or pole farther than this from Cabo Projetado → candidate for between-neighbor fix. */
const OFF_CABLE_REPOSITION_PT = 36;

/** Along-segment fraction when placing a pole between two neighbors (not on the cable). */
const BETWEEN_NEIGHBOR_SEG_MIN = 0.12;
const BETWEEN_NEIGHBOR_SEG_MAX = 0.88;

/**
 * @param {{ x: number, y: number, anchorX?: number, anchorY?: number }} p
 */
function anchorOf(p) {
  return {
    x: p.anchorX ?? p.x,
    y: p.anchorY ?? p.y,
  };
}

/**
 * Store immutable PDF marker anchor on each post (Numero_Poste centroid or equivalent).
 *
 * @param {Array<{ number: number, x: number, y: number, pageNum?: number, anchorX?: number, anchorY?: number }>} posts
 */
export function attachMarkerAnchors(posts) {
  for (const p of posts) {
    if (p.anchorX == null) p.anchorX = p.x;
    if (p.anchorY == null) p.anchorY = p.y;
  }
}

/**
 * Tight proximity dedupe of raw Poste centroids (one point per drawn pole).
 *
 * @param {Array<{ x: number, y: number, pageNum?: number }>} allRaw
 * @param {number} [threshold]
 */
export function dedupePosteRawCentroids(allRaw, threshold = POSTE_RAW_DEDUPE_PT) {
  const byPage = new Map();
  for (const p of allRaw) {
    const pg = p.pageNum ?? 1;
    if (!byPage.has(pg)) byPage.set(pg, []);
    byPage.get(pg).push(p);
  }
  const out = [];
  for (const pts of byPage.values()) {
    const kept = [];
    for (const p of pts) {
      if (kept.some(k => Math.hypot(k.x - p.x, k.y - p.y) < threshold)) continue;
      kept.push({ x: p.x, y: p.y, pageNum: p.pageNum ?? 1 });
    }
    out.push(...kept);
  }
  return out;
}

/**
 * @param {Array<{ pageNum?: number, ops: Array }>} cablePaths
 * @returns {Map<number, Array<Array<import('./construct-path-parser.js').PathOp>>>}
 */
function buildCablesByPage(cablePaths) {
  const cablesByPage = new Map();
  for (const path of cablePaths || []) {
    const pageNum = path.pageNum;
    if (pageNum == null) continue;
    if (!cablesByPage.has(pageNum)) cablesByPage.set(pageNum, []);
    cablesByPage.get(pageNum).push(path.ops);
  }
  return cablesByPage;
}

/**
 * @param {Array<{ x: number, y: number, pageNum?: number }>} allRaw
 * @param {number} mergeRadius
 */
export function clusterPosteSymbolHints(allRaw, mergeRadius = POSTE_SYMBOL_CLUSTER_MERGE_PT) {
  const byPage = new Map();
  for (const p of allRaw) {
    const pg = p.pageNum ?? 1;
    if (!byPage.has(pg)) byPage.set(pg, []);
    byPage.get(pg).push(p);
  }
  const hints = [];
  for (const pts of byPage.values()) {
    const n = pts.length;
    if (n === 0) continue;
    const parent = [...Array(n).keys()];
    const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const union = (a, b) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) <= mergeRadius) {
          union(i, j);
        }
      }
    }
    const groups = new Map();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(pts[i]);
    }
    for (const memb of groups.values()) {
      const sx = memb.reduce((s, q) => s + q.x, 0) / memb.length;
      const sy = memb.reduce((s, q) => s + q.y, 0) / memb.length;
      hints.push({ x: sx, y: sy, pageNum: memb[0].pageNum ?? 1 });
    }
  }
  return hints;
}

/**
 * Route sort key for a page: projection along the line from lowest-numbered post to highest.
 * Works for any route orientation (not hardcoded to X).
 *
 * @param {Array<{ number: number, anchorX?: number, anchorY?: number, x: number, y: number }>} postsOnPage
 * @returns {(p: { x: number, y: number, anchorX?: number, anchorY?: number }) => number}
 */
export function routeSortKeyForPage(postsOnPage) {
  if (!postsOnPage.length) return () => 0;
  const sorted = [...postsOnPage].sort((a, b) => a.number - b.number);
  const a0 = anchorOf(sorted[0]);
  const a1 = anchorOf(sorted[sorted.length - 1]);
  let ux = a1.x - a0.x;
  let uy = a1.y - a0.y;
  const len = Math.hypot(ux, uy);
  if (len < 1e-6) {
    ux = 1;
    uy = 0;
  } else {
    ux /= len;
    uy /= len;
  }
  return p => {
    const a = anchorOf(p);
    return a.x * ux + a.y * uy;
  };
}

/**
 * @param {number} hx
 * @param {number} hy
 * @param {{ number: number, pageNum?: number }} post
 * @param {{ number: number, pageNum?: number, x: number, y: number, anchorX?: number, anchorY?: number }|undefined} prev
 * @param {{ number: number, pageNum?: number, x: number, y: number, anchorX?: number, anchorY?: number }|undefined} next
 * @param {(p: { x: number, y: number, anchorX?: number, anchorY?: number }) => number} routeKey
 */
function snapViolatesRouteOrder(hx, hy, post, prev, next, routeKey) {
  const sk = routeKey({ x: hx, y: hy });
  if (prev) {
    const kPrev = routeKey(prev);
    const kNext = next ? routeKey(next) : kPrev;
    const lo = Math.min(kPrev, kNext);
    const hi = Math.max(kPrev, kNext);
    if (sk < lo - ROUTE_KEY_TOLERANCE_PT || sk > hi + ROUTE_KEY_TOLERANCE_PT) return true;
  } else if (next) {
    const kNext = routeKey(next);
    const increasing = routeKey(post) <= kNext;
    if (increasing && sk > kNext + ROUTE_KEY_TOLERANCE_PT) return true;
    if (!increasing && sk < kNext - ROUTE_KEY_TOLERANCE_PT) return true;
  }
  return false;
}

/**
 * @param {number} pi
 * @param {Array<{ number: number, x: number, y: number, pageNum?: number, anchorX?: number, anchorY?: number }>} posts
 * @param {Map<number, { number: number, x: number, y: number, pageNum?: number, anchorX?: number, anchorY?: number }>} postByNum
 */
/**
 * Best cable projection for a post (prefer snapped pole position over label anchor).
 *
 * @param {{ x: number, y: number, anchorX?: number, anchorY?: number }} post
 * @param {number} pageNum
 * @param {Map<number, Array<Array<import('./construct-path-parser.js').PathOp>>>} cablesByPage
 */
function cableHitForPost(post, pageNum, cablesByPage) {
  const posHit = nearestCableHitOnPage(post.x, post.y, pageNum, cablesByPage);
  const anchor = anchorOf(post);
  const anchorHit = nearestCableHitOnPage(anchor.x, anchor.y, pageNum, cablesByPage);
  return posHit.d <= anchorHit.d ? posHit : anchorHit;
}

/**
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 * @param {number} px
 * @param {number} py
 */
function segmentProjectionU(ax, ay, bx, by, px, py) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 4) return 0.5;
  return ((px - ax) * dx + (py - ay) * dy) / len2;
}

/**
 * Poles whose label is off the cable (or outside the arc between neighbors) are placed on
 * the Poste symbol between the previous and next post along the street (not on the cable).
 *
 * @param {Array<{ number: number, x: number, y: number, pageNum?: number, anchorX?: number, anchorY?: number }>} posts
 * @param {Array<{ x: number, y: number, pageNum?: number }>} symbols
 * @param {Map<number, Array<Array<import('./construct-path-parser.js').PathOp>>>} cablesByPage
 * @param {Set<number>} usedSymbol
 * @param {Set<number>} snappedPosts
 * @param {Map<number, { number: number, x: number, y: number, pageNum?: number }>} postByNum
 * @param {string[]} warnings
 */
function repositionOffRoutePostsBetweenNeighbors(
  posts,
  symbols,
  cablesByPage,
  usedSymbol,
  snappedPosts,
  postByNum,
  warnings
) {
  for (let pi = 0; pi < posts.length; pi++) {
    const p = posts[pi];
    const prev = postByNum.get(p.number - 1);
    const next = postByNum.get(p.number + 1);
    if (!prev || !next) continue;

    const pg = p.pageNum ?? 1;
    if ((prev.pageNum ?? 1) !== pg || (next.pageNum ?? 1) !== pg) continue;

    const anchor = anchorOf(p);
    const anchorHit = nearestCableHitOnPage(anchor.x, anchor.y, pg, cablesByPage);
    const needsBetweenNeighbor =
      !snappedPosts.has(pi) || anchorHit.d > OFF_CABLE_REPOSITION_PT;
    if (!needsBetweenNeighbor) continue;

    let hasRawAtCircle = false;
    for (const sym of symbols) {
      if ((sym.pageNum ?? 1) !== pg) continue;
      if (Math.hypot(sym.x - p.x, sym.y - p.y) <= POSTE_RAW_DEDUPE_PT) {
        hasRawAtCircle = true;
        break;
      }
    }
    if (hasRawAtCircle) continue;

    for (let si = 0; si < symbols.length; si++) {
      if (!usedSymbol.has(si)) continue;
      const sym = symbols[si];
      if (Math.hypot(sym.x - p.x, sym.y - p.y) < 2) usedSymbol.delete(si);
    }
    snappedPosts.delete(pi);

    const ax = prev.x;
    const ay = prev.y;
    const bx = next.x;
    const by = next.y;
    const segLen = Math.hypot(bx - ax, by - ay);
    if (segLen < 20) continue;

    let bestSi = -1;
    let bestScore = Infinity;
    for (let si = 0; si < symbols.length; si++) {
      if (usedSymbol.has(si)) continue;
      const sym = symbols[si];
      if ((sym.pageNum ?? 1) !== pg) continue;
      const u = segmentProjectionU(ax, ay, bx, by, sym.x, sym.y);
      if (u < BETWEEN_NEIGHBOR_SEG_MIN || u > BETWEEN_NEIGHBOR_SEG_MAX) continue;
      const dLabel = Math.hypot(sym.x - anchor.x, sym.y - anchor.y);
      const dCircle = Math.hypot(sym.x - p.x, sym.y - p.y);
      const score = Math.min(dLabel, dCircle) + 0.2 * Math.abs(u - 0.5) * segLen;
      if (score < bestScore) {
        bestScore = score;
        bestSi = si;
      }
    }
    if (bestSi < 0) continue;

    const sym = symbols[bestSi];
    p.x = sym.x;
    p.y = sym.y;
    p.anchorX = sym.x;
    p.anchorY = sym.y;
    usedSymbol.add(bestSi);
    snappedPosts.add(pi);
    warnings.push(
      `[post-positioning] post ${p.number}: placed on pole symbol between posts ${prev.number} ` +
        `and ${next.number} (label off cable or outside route arc).`
    );
  }
}

function maxAllowedSnapMove(pi, posts, postByNum) {
  const p = posts[pi];
  const prev = postByNum.get(p.number - 1);
  const next = postByNum.get(p.number + 1);
  const anchor = anchorOf(p);
  let cap = SNAP_POST_MAX_MOVE_FROM_ANCHOR_PT;
  for (const neighbor of [prev, next]) {
    if (!neighbor || (neighbor.pageNum ?? 1) !== (p.pageNum ?? 1)) continue;
    const na = anchorOf(neighbor);
    const span = Math.hypot(na.x - anchor.x, na.y - anchor.y);
    if (span > 1) cap = Math.min(cap, span * 0.45);
  }
  return cap;
}

/**
 * Assign post (x,y) from Poste pole symbols using label proximity + cable arc-length.
 * Raw centroids (tight dedupe), not wide clustering — avoids merging unrelated junction graphics.
 *
 * @param {Array<{ x: number, y: number, pageNum?: number }>} posteRaw  flipY Poste centroids
 * @param {Array<{ pageNum?: number, ops: Array }>} cablePaths  Cabo Projetado per page
 * @param {string[]} [warnings]
 * @returns {Set<number>} indices of posts positioned on a Poste symbol
 */
export function assignPostPositionsFromPosteSymbols(
  posts,
  posteRaw,
  cablePaths,
  warnings = [],
  opts = {}
) {
  const postByNum = opts.postByNum ?? new Map(posts.map(p => [p.number, p]));
  const labelMax = opts.labelMaxPt ?? POSTE_LABEL_MATCH_MAX_PT;
  const cableAnchorMax = opts.cableAnchorMaxPt ?? POSTE_CABLE_ANCHOR_MAX_PT;
  const arcMax = opts.arcMaxPt ?? POSTE_CABLE_ARC_MATCH_MAX_PT;
  const symbols = dedupePosteRawCentroids(posteRaw, opts.dedupePt ?? POSTE_RAW_DEDUPE_PT);
  const cablesByPage = buildCablesByPage(cablePaths);

  if (!posts.length || !symbols.length) return new Set();

  attachMarkerAnchors(posts);

  /** @type {Map<number, ReturnType<typeof routeSortKeyForPage>>} */
  const routeKeyByPage = new Map();
  const routeKeyFor = post => {
    const pg = post.pageNum ?? 1;
    if (!routeKeyByPage.has(pg)) {
      const onPage = [...postByNum.values()].filter(p => (p.pageNum ?? 1) === pg);
      routeKeyByPage.set(pg, routeSortKeyForPage(onPage));
    }
    return routeKeyByPage.get(pg);
  };

  /** @type {Array<{ pi: number, si: number, score: number }>} */
  const candidates = [];

  const frozenPostIndices = opts.frozenPostIndices ?? null;

  for (let pi = 0; pi < posts.length; pi++) {
    if (frozenPostIndices?.has(pi)) continue;
    const p = posts[pi];
    const pg = p.pageNum ?? 1;
    const anchor = anchorOf(p);
    const cablePathsOnPage = cablesByPage.get(pg) ?? [];
    const hasCable = cablePathsOnPage.length > 0;
    const anchorCable = hasCable
      ? nearestCableHitOnPage(anchor.x, anchor.y, pg, cablesByPage)
      : { d: Infinity, t: 0, pathIndex: -1 };

    for (let si = 0; si < symbols.length; si++) {
      const sym = symbols[si];
      if ((sym.pageNum ?? 1) !== pg) continue;

      const dLabel = Math.hypot(sym.x - anchor.x, sym.y - anchor.y);
      if (dLabel > labelMax) continue;

      if (hasCable) {
        if (anchorCable.d > cableAnchorMax) continue;
        const routeOps = cablePathsOnPage[anchorCable.pathIndex];
        if (!routeOps) continue;
        const symCable = nearestPointOnPathOps(sym.x, sym.y, routeOps);
        const arcDelta = Math.abs(symCable.t - anchorCable.t);
        if (arcDelta > arcMax) continue;
        const score = dLabel + 0.35 * anchorCable.d + 1.5 * arcDelta;
        candidates.push({ pi, si, score });
      } else {
        const routeKey = routeKeyFor(p);
        const prev = postByNum.get(p.number - 1);
        const next = postByNum.get(p.number + 1);
        if (snapViolatesRouteOrder(sym.x, sym.y, p, prev, next, routeKey)) continue;
        candidates.push({ pi, si, score: dLabel });
      }
    }
  }

  candidates.sort((a, b) => a.score - b.score);

  const usedPost = new Set();
  const usedSymbol = new Set();
  const snappedPosts = new Set();

  for (const { pi, si } of candidates) {
    if (usedPost.has(pi) || usedSymbol.has(si)) continue;
    const p = posts[pi];
    const sym = symbols[si];
    p.x = sym.x;
    p.y = sym.y;
    usedPost.add(pi);
    usedSymbol.add(si);
    snappedPosts.add(pi);
  }

  // Second pass: label-near symbols for posts missed when arc window was tight (branch/junction).
  const arcMaxRelaxed = arcMax * 1.75;
  for (let pi = 0; pi < posts.length; pi++) {
    if (frozenPostIndices?.has(pi) || snappedPosts.has(pi)) continue;
    const p = posts[pi];
    const pg = p.pageNum ?? 1;
    const anchor = anchorOf(p);
    const cablePathsOnPage = cablesByPage.get(pg) ?? [];
    const hasCable = cablePathsOnPage.length > 0;
    const anchorCable = hasCable
      ? nearestCableHitOnPage(anchor.x, anchor.y, pg, cablesByPage)
      : { d: Infinity, t: 0, pathIndex: -1 };

    let bestSi = -1;
    let bestScore = Infinity;
    for (let si = 0; si < symbols.length; si++) {
      if (usedSymbol.has(si)) continue;
      const sym = symbols[si];
      if ((sym.pageNum ?? 1) !== pg) continue;
      const dLabel = Math.hypot(sym.x - anchor.x, sym.y - anchor.y);
      if (dLabel > labelMax) continue;
      if (hasCable) {
        if (anchorCable.d > cableAnchorMax) continue;
        const routeOps = cablePathsOnPage[anchorCable.pathIndex];
        if (!routeOps) continue;
        const symCable = nearestPointOnPathOps(sym.x, sym.y, routeOps);
        const arcDelta = Math.abs(symCable.t - anchorCable.t);
        if (arcDelta > arcMaxRelaxed) continue;
        const score = dLabel + 1.5 * arcDelta;
        if (score < bestScore) {
          bestScore = score;
          bestSi = si;
        }
      } else if (dLabel < bestScore) {
        bestScore = dLabel;
        bestSi = si;
      }
    }
    if (bestSi >= 0) {
      const sym = symbols[bestSi];
      p.x = sym.x;
      p.y = sym.y;
      usedSymbol.add(bestSi);
      snappedPosts.add(pi);
    }
  }

  // Third pass: nearest unused symbol to label (same page) when cable arc matching fails.
  const labelOnlyMax = Math.min(labelMax, 85);
  for (let pi = 0; pi < posts.length; pi++) {
    if (frozenPostIndices?.has(pi) || snappedPosts.has(pi)) continue;
    const p = posts[pi];
    const pg = p.pageNum ?? 1;
    const anchor = anchorOf(p);
    let bestSi = -1;
    let bestD = Infinity;
    for (let si = 0; si < symbols.length; si++) {
      if (usedSymbol.has(si)) continue;
      const sym = symbols[si];
      if ((sym.pageNum ?? 1) !== pg) continue;
      const d = Math.hypot(sym.x - anchor.x, sym.y - anchor.y);
      if (d < labelOnlyMax && d < bestD) {
        bestD = d;
        bestSi = si;
      }
    }
    if (bestSi >= 0) {
      const sym = symbols[bestSi];
      p.x = sym.x;
      p.y = sym.y;
      usedSymbol.add(bestSi);
      snappedPosts.add(pi);
    }
  }

  repositionOffRoutePostsBetweenNeighbors(
    posts,
    symbols,
    cablesByPage,
    usedSymbol,
    snappedPosts,
    postByNum,
    warnings
  );

  for (let pi = 0; pi < posts.length; pi++) {
    if (frozenPostIndices?.has(pi) || snappedPosts.has(pi)) continue;
    const p = posts[pi];
    warnings.push(
      `[post-positioning] post ${p.number} (page ${p.pageNum ?? '?'}) — no pole symbol matching ` +
        `label + cable (≤${labelMax} pt label, ≤${cableAnchorMax} pt anchor→cable, ≤${arcMax} pt arc); ` +
        'kept label position.'
    );
  }

  return snappedPosts;
}

/**
 * @param {number} pageNum
 * @param {Map<number, Array<Array<import('./construct-path-parser.js').PathOp>>>} cablesByPage
 * @param {{ x: number, y: number }} ref
 * @returns {Array<import('./construct-path-parser.js').PathOp>|null}
 */
function selectRouteCableOps(pageNum, cablesByPage, ref) {
  const paths = cablesByPage.get(pageNum) ?? [];
  let bestOps = null;
  let bestScore = -Infinity;
  for (const ops of paths) {
    const hit = nearestPointOnPathOps(ref.x, ref.y, ops);
    if (hit.d > GLOBAL_ROUTE_CABLE_NEAR_PT) continue;
    const score = hit.t - hit.d * 2;
    if (score > bestScore) {
      bestScore = score;
      bestOps = ops;
    }
  }
  return bestOps;
}

/**
 * @typedef {{ si: number, t: number, x: number, y: number }} PoleCandidate
 */

/**
 * Top-K Poste symbols on the route cable for one post (ordered by arc distance to anchor).
 *
 * @param {{ anchorX?: number, anchorY?: number, x: number, y: number, pageNum?: number }} post
 * @param {number} pageNum
 * @param {Array<{ x: number, y: number, pageNum?: number }>} symbols
 * @param {Array<import('./construct-path-parser.js').PathOp>} routeOps
 * @param {number} labelMax
 * @param {number} cableAnchorMax
 * @param {number} arcMax
 * @returns {PoleCandidate[]}
 */
function topKRoutePoleCandidates(
  post,
  pageNum,
  symbols,
  routeOps,
  labelMax,
  cableAnchorMax,
  arcMax
) {
  const anchor = anchorOf(post);
  const anchorHit = nearestPointOnPathOps(anchor.x, anchor.y, routeOps);
  if (anchorHit.d > cableAnchorMax) return [];

  /** @type {PoleCandidate[]} */
  const raw = [];
  for (let si = 0; si < symbols.length; si++) {
    const sym = symbols[si];
    if ((sym.pageNum ?? 1) !== pageNum) continue;
    const dLabel = Math.hypot(sym.x - anchor.x, sym.y - anchor.y);
    if (dLabel > labelMax) continue;
    const symHit = nearestPointOnPathOps(sym.x, sym.y, routeOps);
    const arcDelta = Math.abs(symHit.t - anchorHit.t);
    if (arcDelta > arcMax) continue;
    raw.push({ si, t: symHit.t, x: sym.x, y: sym.y, _sort: arcDelta + dLabel * 0.01 });
  }
  raw.sort((a, b) => a._sort - b._sort);
  return raw.slice(0, GLOBAL_POLE_TOP_K).map(({ si, t, x, y }) => ({ si, t, x, y }));
}

/**
 * Beam search: minimise Σ |arc(i,i+1)×scale − label_m(i,i+1)| over one-to-one pole picks.
 *
 * @param {Array<{ number: number }>} routePosts
 * @param {PoleCandidate[][]} candidatesPerPost
 * @param {Map<string, number>} distMap
 * @param {number} scale
 * @returns {PoleCandidate[]|null}
 */
function beamSearchPoleAssignment(routePosts, candidatesPerPost, distMap, scale) {
  if (!routePosts.length) return null;
  if (candidatesPerPost.some(c => c.length === 0)) return null;

  /** @type {Array<{ picks: number[], cost: number }>} */
  let beam = candidatesPerPost[0].map((_, ci) => ({ picks: [ci], cost: 0 }));

  for (let i = 1; i < routePosts.length; i++) {
    /** @type {Array<{ picks: number[], cost: number }>} */
    const next = [];
    const prevNum = routePosts[i - 1].number;
    const currNum = routePosts[i].number;
    const labelM =
      distMap.get(`${prevNum}->${currNum}`) ??
      distMap.get(`${currNum}->${prevNum}`) ??
      null;

    for (const state of beam) {
      const prevCand = candidatesPerPost[i - 1][state.picks[i - 1]];
      for (let ci = 0; ci < candidatesPerPost[i].length; ci++) {
        const currCand = candidatesPerPost[i][ci];
        let edgeCost = 0;
        if (labelM != null && labelM > 0 && scale > 0) {
          const arcPt = Math.abs(currCand.t - prevCand.t);
          const predM = arcPt * scale;
          edgeCost = Math.abs(predM - labelM);
        }
        next.push({
          picks: [...state.picks, ci],
          cost: state.cost + edgeCost,
        });
      }
    }

    next.sort((a, b) => a.cost - b.cost);
    beam = next.slice(0, GLOBAL_POLE_BEAM_WIDTH);
    if (beam.length === 0) return null;
  }

  const best = beam[0];
  return best.picks.map((ci, i) => candidatesPerPost[i][ci]);
}

/**
 * N3: global pole-to-label assignment minimising distance-label residual per page.
 * Falls back to greedy `assignPostPositionsFromPosteSymbols` when labels or candidates are sparse.
 *
 * @param {Array<{ number: number, x: number, y: number, pageNum?: number, anchorX?: number, anchorY?: number }>} posts
 * @param {Array<{ x: number, y: number, pageNum?: number }>} posteRaw
 * @param {Array<{ pageNum?: number, ops: Array }>} cablePaths
 * @param {Array<{ from: number, to: number, meters: number|null }>} distances
 * @param {string[]} [warnings]
 * @param {object} [opts]
 * @param {(pageNum: number) => number|null} [opts.perPageScale]
 * @returns {Set<number>} indices of posts positioned on a Poste symbol
 */
export function assignPolesGloballyByLabels(
  posts,
  posteRaw,
  cablePaths,
  distances,
  warnings = [],
  opts = {}
) {
  const distMap = new Map();
  for (const d of distances || []) {
    if (d.meters == null || d.meters <= 0) continue;
    distMap.set(`${d.from}->${d.to}`, d.meters);
    distMap.set(`${d.to}->${d.from}`, d.meters);
  }

  if (!posts.length || !posteRaw?.length) {
    return assignPostPositionsFromPosteSymbols(posts, posteRaw, cablePaths, warnings, opts);
  }
  if (distMap.size === 0) {
    warnings.push('[post-positioning] N3 skipped — no distance labels; using greedy pole match.');
    return assignPostPositionsFromPosteSymbols(posts, posteRaw, cablePaths, warnings, opts);
  }

  const postByNum = opts.postByNum ?? new Map(posts.map(p => [p.number, p]));
  const labelMax = opts.labelMaxPt ?? POSTE_LABEL_MATCH_MAX_PT;
  const cableAnchorMax = opts.cableAnchorMaxPt ?? POSTE_CABLE_ANCHOR_MAX_PT;
  const arcMax = opts.arcMaxPt ?? POSTE_CABLE_ARC_MATCH_MAX_PT;
  const perPageScale = opts.perPageScale ?? (() => null);
  const symbols = dedupePosteRawCentroids(posteRaw, opts.dedupePt ?? POSTE_RAW_DEDUPE_PT);
  const cablesByPage = buildCablesByPage(cablePaths);

  attachMarkerAnchors(posts);

  const globallySnapped = new Set();
  const usedSymbol = new Set();

  /** @type {Map<number, Array<{ posts: typeof posts, pathIndex: number }>>} */
  const partitionsByPage = new Map();

  for (const post of posts) {
    const pageNum = post.pageNum ?? 1;
    if (!partitionsByPage.has(pageNum)) partitionsByPage.set(pageNum, []);
    const list = partitionsByPage.get(pageNum);
    const anchor = anchorOf(post);
    const hit = nearestCableHitOnPage(anchor.x, anchor.y, pageNum, cablesByPage);
    const pathIndex = hit.pathIndex >= 0 ? hit.pathIndex : 0;
    let part = list.find(p => p.pathIndex === pathIndex);
    if (!part) {
      part = { pathIndex, posts: [] };
      list.push(part);
    }
    part.posts.push(post);
  }

  for (const [pageNum, partitions] of partitionsByPage) {
    const scale = perPageScale(pageNum);
    if (scale == null || scale <= 0) {
      warnings.push(`[post-positioning] N3 page ${pageNum}: no scale — greedy fallback for page.`);
      continue;
    }

    const symbolsOnPage = symbols.filter(s => (s.pageNum ?? 1) === pageNum);

    for (const { pathIndex, posts: partPosts } of partitions) {
      const routePosts = [...partPosts]
        .sort((a, b) => a.number - b.number)
        .filter(p => !isOffRouteCablePost(p, postByNum, cablesByPage));

      if (routePosts.length < 2) continue;

      if (symbolsOnPage.length < routePosts.length * 1.5) {
        warnings.push(
          `[post-positioning] N3 page ${pageNum} path ${pathIndex}: insufficient symbols ` +
            `(${symbolsOnPage.length} vs ${routePosts.length} posts) — greedy fallback.`
        );
        continue;
      }

      const paths = cablesByPage.get(pageNum) ?? [];
      const routeOps = paths[pathIndex] ?? selectRouteCableOps(pageNum, cablesByPage, anchorOf(routePosts[0]));
      if (!routeOps) {
        warnings.push(`[post-positioning] N3 page ${pageNum}: no route cable — greedy fallback.`);
        continue;
      }

      const candidatesPerPost = routePosts.map(p =>
        topKRoutePoleCandidates(p, pageNum, symbols, routeOps, labelMax, cableAnchorMax, arcMax)
      );

      const assignment = beamSearchPoleAssignment(routePosts, candidatesPerPost, distMap, scale);
      if (!assignment) {
        warnings.push(
          `[post-positioning] N3 page ${pageNum} path ${pathIndex}: beam search failed — greedy fallback.`
        );
        continue;
      }

      const siSeen = new Set();
      let symbolConflict = false;
      for (const pick of assignment) {
        if (usedSymbol.has(pick.si) || siSeen.has(pick.si)) {
          symbolConflict = true;
          break;
        }
        siSeen.add(pick.si);
      }
      if (symbolConflict) {
        warnings.push(
          `[post-positioning] N3 page ${pageNum} path ${pathIndex}: duplicate symbol in beam — greedy fallback.`
        );
        continue;
      }

      let residualSum = 0;
      let labeledEdges = 0;
      for (let i = 0; i < routePosts.length - 1; i++) {
        const m =
          distMap.get(`${routePosts[i].number}->${routePosts[i + 1].number}`) ??
          distMap.get(`${routePosts[i + 1].number}->${routePosts[i].number}`);
        if (m == null || m <= 0) continue;
        labeledEdges++;
        const arcPt = Math.abs(assignment[i + 1].t - assignment[i].t);
        residualSum += Math.abs(arcPt * scale - m);
      }

      for (let i = 0; i < routePosts.length; i++) {
        const post = routePosts[i];
        const pick = assignment[i];
        if (usedSymbol.has(pick.si)) continue;
        post.x = pick.x;
        post.y = pick.y;
        usedSymbol.add(pick.si);
        const pi = posts.indexOf(post);
        if (pi >= 0) globallySnapped.add(pi);
      }

      const rmse = labeledEdges > 0 ? Math.sqrt(residualSum / labeledEdges) : 0;
      warnings.push(
        `[post-positioning] N3 page ${pageNum} path ${pathIndex}: beam assigned ${routePosts.length} posts ` +
          `(${labeledEdges} labeled edges, label RMSE ≈ ${rmse.toFixed(1)} m).`
      );
    }
  }

  const greedySnapped = assignPostPositionsFromPosteSymbols(posts, posteRaw, cablePaths, warnings, {
    ...opts,
    postByNum,
    frozenPostIndices: globallySnapped,
  });
  for (const pi of greedySnapped) globallySnapped.add(pi);

  const snappedPosts = globallySnapped;
  repositionOffRoutePostsBetweenNeighbors(
    posts,
    symbols,
    cablesByPage,
    usedSymbol,
    snappedPosts,
    postByNum,
    warnings
  );

  return snappedPosts;
}

/**
 * Snap posts to Poste-layer pole graphics.
 * @param {object} [opts]
 * @param {boolean} [opts.primary]  When true, symbol centroid is canonical (no move cap).
 * @returns {Set<number>} indices of posts that were snapped
 */
export function snapPostsToPosteLayerSymbols(posts, hints, maxSnapPt, opts = {}) {
  const primary = opts.primary === true;
  const skipped = opts.skipPostIndices ?? new Set();
  const usedHint = opts.usedHintIndices ?? new Set();
  const snappedPosts = opts.snappedPostIndices ?? new Set();
  const postByNum = opts.postByNum ?? new Map(posts.map(p => [p.number, p]));
  if (!posts.length || !hints.length) return snappedPosts;

  attachMarkerAnchors(posts);

  /** @type {Map<number, ReturnType<typeof routeSortKeyForPage>>} */
  const routeKeyByPage = new Map();
  const routeKeyFor = post => {
    const pg = post.pageNum ?? 1;
    if (!routeKeyByPage.has(pg)) {
      const onPage = [...postByNum.values()].filter(p => (p.pageNum ?? 1) === pg);
      routeKeyByPage.set(pg, routeSortKeyForPage(onPage));
    }
    return routeKeyByPage.get(pg);
  };

  const candidates = [];
  for (let pi = 0; pi < posts.length; pi++) {
    if (skipped.has(pi)) continue;
    const p = posts[pi];
    const pg = p.pageNum ?? 1;
    const anchor = anchorOf(p);
    for (let hi = 0; hi < hints.length; hi++) {
      if (usedHint.has(hi)) continue;
      if ((hints[hi].pageNum ?? 1) !== pg) continue;
      const d = Math.hypot(hints[hi].x - anchor.x, hints[hi].y - anchor.y);
      if (d < maxSnapPt) candidates.push({ pi, hi, d });
    }
  }
  candidates.sort((a, b) => a.d - b.d);

  for (const { pi, hi } of candidates) {
    if (snappedPosts.has(pi) || usedHint.has(hi)) continue;
    const p = posts[pi];
    const hx = hints[hi].x;
    const hy = hints[hi].y;
    const anchor = anchorOf(p);
    const move = Math.hypot(hx - anchor.x, hy - anchor.y);
    if (!primary) {
      const maxMove = maxAllowedSnapMove(pi, posts, postByNum);
      if (move > maxMove) continue;
    }

    const prev = postByNum.get(p.number - 1);
    const next = postByNum.get(p.number + 1);
    const routeKey = routeKeyFor(p);
    if (snapViolatesRouteOrder(hx, hy, p, prev, next, routeKey)) continue;

    if (!primary && prev && (p.pageNum ?? 1) === (prev.pageNum ?? 1)) {
      const maxMove = maxAllowedSnapMove(pi, posts, postByNum);
      const before = Math.hypot(anchor.x - anchorOf(prev).x, anchor.y - anchorOf(prev).y);
      const after = Math.hypot(hx - anchorOf(prev).x, hy - anchorOf(prev).y);
      if (after > before + maxMove) continue;
    }

    p.x = hx;
    p.y = hy;
    snappedPosts.add(pi);
    usedHint.add(hi);
  }
  return snappedPosts;
}

/**
 * Order route markers on one page along the principal layout axis (vendor-neutral).
 * Cable geometry is used later for position snap, not for post numbering — arc-length
 * order can run opposite to numeric labels on some sheets.
 *
 * @param {Array<{ x: number, y: number, pageNum?: number }>} markers
 */
export function orderMarkersOnPage(markers) {
  if (markers.length <= 1) return [...markers];

  // Sort along principal axis (variance-major direction)
  const mx = markers.reduce((s, m) => s + m.x, 0) / markers.length;
  const my = markers.reduce((s, m) => s + m.y, 0) / markers.length;
  let cxx = 0;
  let cyy = 0;
  let cxy = 0;
  for (const m of markers) {
    const dx = m.x - mx;
    const dy = m.y - my;
    cxx += dx * dx;
    cyy += dy * dy;
    cxy += dx * dy;
  }
  const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  const ux = Math.cos(theta);
  const uy = Math.sin(theta);
  return [...markers].sort((a, b) => {
    const ta = a.x * ux + a.y * uy;
    const tb = b.x * ux + b.y * uy;
    if (Math.abs(ta - tb) > SAME_COLUMN_X_PT) return ta - tb;
    return a.y - b.y;
  });
}

/**
 * Assign post numbers 1..N along the route across pages (viewport detail sheets).
 *
 * @param {Array<{ x: number, y: number, pageNum?: number }>} markers
 * @param {Array<{ pageNum?: number, ops: Array }>} [_cablePaths]  Reserved; not used for numbering.
 * @param {{ reverseRoute?: boolean }} [opts]  When true, flip order within each page.
 */
export function assignPostsByRouteOrder(markers, _cablePaths = [], opts = {}) {
  const byPage = new Map();
  for (const m of markers) {
    const pg = m.pageNum ?? 1;
    if (!byPage.has(pg)) byPage.set(pg, []);
    byPage.get(pg).push(m);
  }

  const pages = [...byPage.keys()].sort((a, b) => a - b);
  const ordered = [];
  for (const pg of pages) {
    let pageMarkers = orderMarkersOnPage(byPage.get(pg));
    if (opts.reverseRoute) {
      pageMarkers = pageMarkers.reverse();
    } else if (pageMarkers.length >= 2) {
      // Default: post 01 is usually at the feeder/source end of the detail sheet, which in many
      // CAD exports is the high-X side of the page. Reverse when cable order runs low→high X.
      const first = pageMarkers[0];
      const last = pageMarkers[pageMarkers.length - 1];
      if (last.x - first.x > SAME_COLUMN_X_PT) pageMarkers = pageMarkers.reverse();
    }
    ordered.push(...pageMarkers);
  }

  return ordered.map((c, i) => ({
    number: i + 1,
    x: c.x,
    y: c.y,
    anchorX: c.x,
    anchorY: c.y,
    ...(c.pageNum !== undefined ? { pageNum: c.pageNum } : {}),
  }));
}

/**
 * Fallback when no Poste symbols were extracted: set PDF positions from Numero_Poste circles.
 * OCR numbers are kept; only used when assignPostPositionsFromPosteSymbols had no hints.
 *
 * @param {Array<{ number: number, x: number, y: number, pageNum?: number, anchorX?: number, anchorY?: number }>} posts
 * @param {Array<{ circle: { x: number, y: number, pageNum?: number } }>} ocrResults
 * @param {Array<{ pageNum?: number, ops: Array }>} [_cablePaths]
 */
export function alignPostPositionsToRouteMarkers(posts, ocrResults, _cablePaths = []) {
  if (!posts.length || !ocrResults.length) return;

  const markers = ocrResults.map(r => ({
    x: r.circle.x,
    y: r.circle.y,
    pageNum: r.circle.pageNum,
  }));
  const routePosts = assignPostsByRouteOrder(markers, _cablePaths);
  const byNum = new Map(routePosts.map(p => [p.number, p]));

  for (const p of posts) {
    const m = byNum.get(p.number);
    if (!m) continue;
    p.x = m.x;
    p.y = m.y;
    p.anchorX = m.x;
    p.anchorY = m.y;
    if (m.pageNum !== undefined) p.pageNum = m.pageNum;
  }
}
