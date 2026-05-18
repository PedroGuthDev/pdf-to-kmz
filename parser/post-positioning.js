// parser/post-positioning.js
// Post PDF positions come from Poste-layer pole symbols (square+X, double circle, etc.).
// Numero_Poste / OCR only identify which post number belongs to which symbol.
// Matching uses label proximity + Cabo Projetado arc-length (not blind nearest-neighbor).

import { nearestCableHitOnPage, nearestPointOnPathOps } from './cable-builder.js';

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

/** Legacy merge radius — avoid for primary assignment (over-merges poles). */
export const POSTE_SYMBOL_CLUSTER_MERGE_PT = 88;

const ROUTE_KEY_TOLERANCE_PT = 12;
const CABLE_ARC_ORDER_TOLERANCE_PT = 15;
const SAME_COLUMN_X_PT = 10;

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

  for (let pi = 0; pi < posts.length; pi++) {
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
    if (snappedPosts.has(pi)) continue;
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
    if (snappedPosts.has(pi)) continue;
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

  for (let pi = 0; pi < posts.length; pi++) {
    if (snappedPosts.has(pi)) continue;
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
