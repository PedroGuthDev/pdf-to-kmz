// parser/cable-builder.js
// Builds cable segment objects from Cabo Projetado PathOp arrays.
// Optionally detects branch points where segments share endpoints.
//
// Named ESM exports only — no default export, no CommonJS require.

/**
 * Shortest distance from point (px,py) to segment A–B (clamped).
 *
 * @param {number} px
 * @param {number} py
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 */
/**
 * @returns {{ d: number, cx: number, cy: number, t: number }}
 */
function distPointToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const ab2 = abx * abx + aby * aby;
  let t = ab2 > 1e-12 ? (apx * abx + apy * aby) / ab2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  return { d: Math.hypot(px - cx, py - cy), cx, cy, t };
}

/**
 * Minimum distance from a point to a polyline / curve path in flipped page space.
 * Used to tell whether a post marker lies near the drawn cable (route identification).
 *
 * @param {number} px
 * @param {number} py
 * @param {Array<import('./construct-path-parser.js').PathOp>} ops
 * @returns {number}
 */
/**
 * @param {number} px
 * @param {number} py
 * @param {Array<import('./construct-path-parser.js').PathOp>} ops
 * @returns {{ x: number, y: number, d: number }}
 */
export function nearestPointOnPathOps(px, py, ops) {
  if (!ops || ops.length === 0) return { x: px, y: py, d: Infinity };

  let minD = Infinity;
  let bestX = px;
  let bestY = py;
  let arcLen = 0;
  let bestT = 0;
  /** @type {{ x: number, y: number } | null} */
  let cur = null;
  /** @type {{ x: number, y: number } | null} */
  let subpathStart = null;

  const consider = (ax, ay, bx, by, segStart) => {
    const hit = distPointToSegment(px, py, ax, ay, bx, by);
    const at = segStart + hit.t * Math.hypot(bx - ax, by - ay);
    if (hit.d < minD) {
      minD = hit.d;
      bestX = hit.cx;
      bestY = hit.cy;
      bestT = at;
    }
  };

  for (const op of ops) {
    if (op.type === 'M') {
      cur = { x: op.x, y: op.y };
      subpathStart = cur;
    } else if (op.type === 'L' && cur) {
      const segStart = arcLen;
      const segLen = Math.hypot(op.x - cur.x, op.y - cur.y);
      consider(cur.x, cur.y, op.x, op.y, segStart);
      arcLen += segLen;
      cur = { x: op.x, y: op.y };
    } else if (op.type === 'C' && cur) {
      const x0 = cur.x;
      const y0 = cur.y;
      const { x1, y1, x2, y2, x3, y3 } = op;
      let px0 = x0;
      let py0 = y0;
      const steps = 10;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const om = 1 - t;
        const bx =
          om * om * om * x0 +
          3 * om * om * t * x1 +
          3 * om * t * t * x2 +
          t * t * t * x3;
        const by =
          om * om * om * y0 +
          3 * om * om * t * y1 +
          3 * om * t * t * y2 +
          t * t * t * y3;
        const segStart = arcLen;
        consider(px0, py0, bx, by, segStart);
        arcLen += Math.hypot(bx - px0, by - py0);
        px0 = bx;
        py0 = by;
      }
      cur = { x: op.x3, y: op.y3 };
    } else if (op.type === 'C2' && cur) {
      const x0 = cur.x;
      const y0 = cur.y;
      const { x1, y1, x2, y2 } = op;
      let px0 = x0;
      let py0 = y0;
      const steps = 8;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const om = 1 - t;
        const bx = om * om * x0 + 2 * om * t * x1 + t * t * x2;
        const by = om * om * y0 + 2 * om * t * y1 + t * t * y2;
        const segStart = arcLen;
        consider(px0, py0, bx, by, segStart);
        arcLen += Math.hypot(bx - px0, by - py0);
        px0 = bx;
        py0 = by;
      }
      cur = { x: op.x2, y: op.y2 };
    } else if (op.type === 'Z' && cur && subpathStart) {
      const segStart = arcLen;
      consider(cur.x, cur.y, subpathStart.x, subpathStart.y, segStart);
      arcLen += Math.hypot(subpathStart.x - cur.x, subpathStart.y - cur.y);
      cur = { ...subpathStart };
    }
  }
  return { x: bestX, y: bestY, d: minD, t: bestT };
}

export function minDistancePointToPathOps(px, py, ops) {
  return nearestPointOnPathOps(px, py, ops).d;
}

/**
 * @param {number} px
 * @param {number} py
 * @param {number} pageNum
 * @param {Map<number, Array<Array<import('./construct-path-parser.js').PathOp>>>} cablesByPage
 * @returns {number}
 */
export function minDistancePointToCablesOnPage(px, py, pageNum, cablesByPage) {
  return nearestPointOnCablesOnPage(px, py, pageNum, cablesByPage).d;
}

/**
 * @param {number} px
 * @param {number} py
 * @param {number} pageNum
 * @param {Map<number, Array<Array<import('./construct-path-parser.js').PathOp>>>} cablesByPage
 * @returns {{ x: number, y: number, d: number, t: number }}
 */
export function nearestPointOnCablesOnPage(px, py, pageNum, cablesByPage) {
  const hit = nearestCableHitOnPage(px, py, pageNum, cablesByPage);
  return { x: hit.x, y: hit.y, d: hit.d, t: hit.t };
}

/**
 * Nearest point on Cabo Projetado, including which polyline path was used (for arc-length compare).
 *
 * @returns {{ x: number, y: number, d: number, t: number, pathIndex: number }}
 */
export function nearestCableHitOnPage(px, py, pageNum, cablesByPage) {
  const paths = cablesByPage.get(pageNum) ?? [];
  if (paths.length === 0) return { x: px, y: py, d: Infinity, t: 0, pathIndex: -1 };
  let best = { x: px, y: py, d: Infinity, t: 0, pathIndex: 0 };
  for (let i = 0; i < paths.length; i++) {
    const hit = nearestPointOnPathOps(px, py, paths[i]);
    if (hit.d < best.d) best = { ...hit, pathIndex: i };
  }
  return best;
}

/** Pole farther than this from Cabo Projetado → label chain uses cable direction via neighbors. */
export const OFF_CABLE_FOR_LABEL_CHAIN_PT = 30;

const ROUTE_CABLE_ARC_PAD_PT = 20;

/** Tap pole vs immediate numbered neighbors (near cable, projection outside neighbor arc). */
function isTapPoleRaw(post, postByNum, cablesByPage) {
  const prev = postByNum.get(post.number - 1);
  const next = postByNum.get(post.number + 1);
  if (!prev || !next) return false;

  const pg = post.pageNum ?? 1;
  if ((prev.pageNum ?? 1) !== pg || (next.pageNum ?? 1) !== pg) return false;

  const hitP = nearestCableHitOnPage(post.x, post.y, pg, cablesByPage);
  if (hitP.d > OFF_CABLE_FOR_LABEL_CHAIN_PT) return false;

  const hitA = nearestCableHitOnPage(prev.x, prev.y, pg, cablesByPage);
  const hitB = nearestCableHitOnPage(next.x, next.y, pg, cablesByPage);
  if (hitP.pathIndex < 0 || hitA.pathIndex !== hitP.pathIndex || hitB.pathIndex !== hitP.pathIndex) {
    return false;
  }

  const tLo = Math.min(hitA.t, hitB.t) - ROUTE_CABLE_ARC_PAD_PT;
  const tHi = Math.max(hitA.t, hitB.t) + ROUTE_CABLE_ARC_PAD_PT;
  return hitP.t < tLo || hitP.t > tHi;
}

/** True when the pole is a tap / "N tem cabo" (off main cable between consecutive neighbors). */
export function isOffRouteCablePost(post, postByNum, cablesByPage) {
  return isTapPoleRaw(post, postByNum, cablesByPage);
}

/**
 * Main-route neighbors for span checks, skipping one adjacent tap pole on each side.
 *
 * @returns {{ left: { number: number, x: number, y: number, pageNum?: number }|null, right: { number: number, x: number, y: number, pageNum?: number }|null }}
 */
export function routeCableSpanPosts(post, postByNum, cablesByPage) {
  let leftNum = post.number - 1;
  const leftP = postByNum.get(leftNum);
  if (leftP && isTapPoleRaw(leftP, postByNum, cablesByPage)) leftNum--;

  let rightNum = post.number + 1;
  const rightP = postByNum.get(rightNum);
  if (rightP && isTapPoleRaw(rightP, postByNum, cablesByPage)) rightNum++;

  return {
    left: postByNum.get(leftNum) ?? null,
    right: postByNum.get(rightNum) ?? null,
  };
}

/**
 * Cable arc length in PDF points between two posts on the same Cabo Projetado path.
 *
 * @returns {number|null}
 */
export function cableArcLengthPt(from, to, cablesByPage) {
  const pg = from.pageNum ?? 1;
  if ((to.pageNum ?? 1) !== pg) return null;

  const hitA = nearestCableHitOnPage(from.x, from.y, pg, cablesByPage);
  const hitB = nearestCableHitOnPage(to.x, to.y, pg, cablesByPage);
  if (hitA.pathIndex < 0 || hitB.pathIndex !== hitA.pathIndex) return null;

  return Math.abs(hitB.t - hitA.t);
}

/**
 * @param {Array<{ pageNum?: number, ops: Array }>} cablePaths
 * @returns {Map<number, Array<Array<import('./construct-path-parser.js').PathOp>>>}
 */
export function buildCablesByPage(cablePaths) {
  const cablesByPage = new Map();
  for (const path of cablePaths || []) {
    const pageNum = path.pageNum;
    if (pageNum == null || !path.ops) continue;
    if (!cablesByPage.has(pageNum)) cablesByPage.set(pageNum, []);
    cablesByPage.get(pageNum).push(path.ops);
  }
  return cablesByPage;
}

/** Dashed-ribbon cables (many M sub-paths) need stitching before arc-length Viterbi. */
export const FRAGMENTED_CABLE_MIN_SUBPATHS = 5;

/**
 * @param {Array<import('./construct-path-parser.js').PathOp>} ops
 * @returns {number}
 */
export function countCableSubpaths(ops) {
  if (!ops?.length) return 0;
  return ops.filter(op => op.type === 'M').length;
}

/**
 * @param {Array<import('./construct-path-parser.js').PathOp>} ops
 * @returns {boolean}
 */
export function isFragmentedCableOps(ops) {
  return countCableSubpaths(ops) >= FRAGMENTED_CABLE_MIN_SUBPATHS;
}

/**
 * @param {Array<import('./construct-path-parser.js').PathOp>} ops
 * @returns {Array<Array<import('./construct-path-parser.js').PathOp>>}
 */
function splitCableSubpaths(ops) {
  /** @type {Array<Array<import('./construct-path-parser.js').PathOp>>} */
  const subpaths = [];
  /** @type {Array<import('./construct-path-parser.js').PathOp>} */
  let current = null;
  for (const op of ops) {
    if (op.type === 'M') {
      if (current?.length) subpaths.push(current);
      current = [op];
    } else if (current) {
      current.push(op);
    }
  }
  if (current?.length) subpaths.push(current);
  return subpaths;
}

/**
 * @param {Array<{ anchorX?: number, anchorY?: number, x: number, y: number }>} [routePosts]
 * @returns {{ ux: number, uy: number }|null}
 */
function routeAxisUnit(routePosts) {
  if (!routePosts || routePosts.length < 3) return null;
  const xs = routePosts.map(p => p.anchorX ?? p.x);
  const ys = routePosts.map(p => p.anchorY ?? p.y);
  const idx = routePosts.map((_, i) => i);
  const n = routePosts.length;
  const iMean = idx.reduce((s, v) => s + v, 0) / n;
  const xMean = xs.reduce((s, v) => s + v, 0) / n;
  const yMean = ys.reduce((s, v) => s + v, 0) / n;
  let sxn = 0;
  let syn = 0;
  let snn = 0;
  for (let i = 0; i < n; i++) {
    const di = idx[i] - iMean;
    sxn += di * (xs[i] - xMean);
    syn += di * (ys[i] - yMean);
    snn += di * di;
  }
  if (snn < 1e-9) return null;
  const dx = sxn / snn;
  const dy = syn / snn;
  const len = Math.hypot(dx, dy) || 1;
  return { ux: dx / len, uy: dy / len };
}

/**
 * Midpoint of the longest L segment in one dash subpath (dashed-ribbon triangle).
 *
 * @param {Array<import('./construct-path-parser.js').PathOp>} subops
 * @returns {{ mx: number, my: number }|null}
 */
function dashSpineFromSubpath(subops) {
  /** @type {{ ax: number, ay: number, bx: number, by: number, len: number }[]} */
  const segments = [];
  /** @type {{ x: number, y: number } | null} */
  let cur = null;
  for (const op of subops) {
    if (op.type === 'M') cur = { x: op.x, y: op.y };
    else if (op.type === 'L' && cur) {
      const len = Math.hypot(op.x - cur.x, op.y - cur.y);
      segments.push({ ax: cur.x, ay: cur.y, bx: op.x, by: op.y, len });
      cur = { x: op.x, y: op.y };
    }
  }
  if (!segments.length) {
    const ep = endpointFromPath(subops, 'start');
    return ep ? { mx: ep.x, my: ep.y } : null;
  }
  const best = segments.reduce((a, b) => (b.len > a.len ? b : a));
  return { mx: (best.ax + best.bx) / 2, my: (best.ay + best.by) / 2 };
}

/**
 * Stitch dashed-ribbon cable dashes into one route polyline ordered along the span from ref.
 *
 * @param {Array<import('./construct-path-parser.js').PathOp>} ops
 * @param {number} refX
 * @param {number} refY
 * @param {Array<{ anchorX?: number, anchorY?: number, x: number, y: number }>} [routePosts]
 * @returns {Array<import('./construct-path-parser.js').PathOp>}
 */
export function consolidateFragmentedCableOps(ops, refX, refY, routePosts = null) {
  if (!isFragmentedCableOps(ops)) return ops;

  const subpaths = splitCableSubpaths(ops);
  const spines = subpaths.map(dashSpineFromSubpath).filter(Boolean);
  if (spines.length < 2) return ops;

  const axis =
    routeAxisUnit(routePosts) ??
    (() => {
      const cx = spines.reduce((s, p) => s + p.mx, 0) / spines.length;
      const cy = spines.reduce((s, p) => s + p.my, 0) / spines.length;
      const dx = cx - refX;
      const dy = cy - refY;
      const axisLen = Math.hypot(dx, dy) || 1;
      return { ux: dx / axisLen, uy: dy / axisLen };
    })();

  spines.sort((a, b) => {
    const pa = (a.mx - refX) * axis.ux + (a.my - refY) * axis.uy;
    const pb = (b.mx - refX) * axis.ux + (b.my - refY) * axis.uy;
    return pa - pb;
  });

  /** @type {Array<import('./construct-path-parser.js').PathOp>} */
  const out = [{ type: 'M', x: spines[0].mx, y: spines[0].my }];
  for (let i = 1; i < spines.length; i++) {
    out.push({ type: 'L', x: spines[i].mx, y: spines[i].my });
  }
  return out;
}

/**
 * Use consolidated polyline for fragmented route cables (Viterbi / arc-length matching).
 *
 * @param {Array<import('./construct-path-parser.js').PathOp>} ops
 * @param {number} refX
 * @param {number} refY
 * @param {Array<{ anchorX?: number, anchorY?: number, x: number, y: number }>} [routePosts]
 * @returns {Array<import('./construct-path-parser.js').PathOp>}
 */
export function prepareRouteCableOps(ops, refX, refY, routePosts = null) {
  return consolidateFragmentedCableOps(ops, refX, refY, routePosts);
}

/**
 * Bearing for Distância_Poste GPS chaining when a pole is off the cable (tap / no-cable post).
 * Uses Cabo Projetado direction between on-route neighbors (e.g. 3→5 past off-route post 4).
 *
 * @param {{ number: number, x: number, y: number, pageNum?: number }} from
 * @param {{ number: number, x: number, y: number, pageNum?: number }} to
 * @param {Map<number, { number: number, x: number, y: number, pageNum?: number }>} postByNum
 * @param {Map<number, Array<Array<import('./construct-path-parser.js').PathOp>>>} cablesByPage
 * @returns {number|null}  Degrees clockwise from north, or null to use pole/label geometry.
 */
/**
 * Bearing along Cabo Projetado between two on-route posts on the same page.
 *
 * @returns {number|null}  Degrees clockwise from north
 */
/**
 * Cable exit bearing at a post (for cross-page label chains).
 *
 * @returns {number|null}
 */
export function cableExitBearingAtPost(post, cablesByPage) {
  const pg = post.pageNum ?? 1;
  const paths = cablesByPage.get(pg);
  if (!paths?.length) return null;

  const hit = nearestCableHitOnPage(post.x, post.y, pg, cablesByPage);
  if (hit.pathIndex < 0 || hit.d > 80) return null;

  const ops = paths[hit.pathIndex];
  const total = pathTotalArcLength(ops);
  const towardEnd = hit.t >= total * 0.5 ? 1 : -1;
  return cableTangentBearingDeg(ops, hit.t, towardEnd);
}

export function cableSegmentBearingDeg(from, to, cablesByPage) {
  const pg = from.pageNum ?? 1;
  if ((to.pageNum ?? 1) !== pg) return null;

  const paths = cablesByPage.get(pg);
  if (!paths?.length) return null;

  const hitA = nearestCableHitOnPage(from.x, from.y, pg, cablesByPage);
  const hitB = nearestCableHitOnPage(to.x, to.y, pg, cablesByPage);
  if (hitA.pathIndex < 0 || hitA.pathIndex !== hitB.pathIndex) return null;
  if (hitA.d > 80 || hitB.d > 80) return null;

  const ops = paths[hitA.pathIndex];
  const dir = hitB.t >= hitA.t ? 1 : -1;
  return cableTangentBearingDeg(ops, hitA.t, dir);
}

export function bearingForDistanceLabelChain(from, to, postByNum, cablesByPage) {
  const pg = from.pageNum ?? 1;
  if ((to.pageNum ?? 1) !== pg) return null;

  const paths = cablesByPage.get(pg);
  if (!paths?.length) return null;

  const fromHit = nearestCableHitOnPage(from.x, from.y, pg, cablesByPage);
  const toHit = nearestCableHitOnPage(to.x, to.y, pg, cablesByPage);
  const fromOff =
    fromHit.d > OFF_CABLE_FOR_LABEL_CHAIN_PT ||
    isOffRouteCablePost(from, postByNum, cablesByPage);
  const toOff =
    toHit.d > OFF_CABLE_FOR_LABEL_CHAIN_PT ||
    isOffRouteCablePost(to, postByNum, cablesByPage);
  if (!fromOff && !toOff) return null;

  const anchorFrom = fromOff ? postByNum.get(from.number - 1) ?? from : from;
  const anchorTo = toOff ? postByNum.get(to.number + 1) ?? to : to;
  const hitA = nearestCableHitOnPage(anchorFrom.x, anchorFrom.y, pg, cablesByPage);
  const hitB = nearestCableHitOnPage(anchorTo.x, anchorTo.y, pg, cablesByPage);
  if (hitA.pathIndex < 0 || hitB.pathIndex !== hitA.pathIndex) return null;

  const dx = hitB.x - hitA.x;
  const dy = hitA.y - hitB.y;
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

/**
 * Extract the first or last endpoint {x, y} from a PathOp array.
 * Only M (moveTo) and L (lineTo) ops carry absolute x,y endpoint positions.
 *
 * @param {Array<import('./construct-path-parser.js').PathOp>} ops
 * @param {'start'|'end'} which
 * @returns {{ x: number, y: number }|null}
 */
function endpointFromPath(ops, which) {
  const pts = ops.filter(op => op.type === 'M' || op.type === 'L');
  if (!pts.length) return null;
  const op = which === 'start' ? pts[0] : pts[pts.length - 1];
  return { x: op.x, y: op.y };
}

/**
 * Total polyline arc length in PDF points (M/L/C/C2/Z), same metric as nearestPointOnPathOps `t`.
 *
 * @param {Array<import('./construct-path-parser.js').PathOp>} ops
 * @returns {number}
 */
export function pathTotalArcLength(ops) {
  if (!ops?.length) return 0;
  const far = pointAtArcLength(ops, 1e15);
  if (!far) return 0;
  return nearestPointOnPathOps(far.x, far.y, ops).t;
}

/**
 * Point at arc length `t` (PDF pt) from path start.
 *
 * @param {Array<import('./construct-path-parser.js').PathOp>} ops
 * @param {number} targetT
 * @returns {{ x: number, y: number }|null}
 */
export function pointAtArcLength(ops, targetT) {
  if (!ops?.length || targetT < 0) return null;

  let arcLen = 0;
  /** @type {{ x: number, y: number } | null} */
  let cur = null;
  /** @type {{ x: number, y: number } | null} */
  let subpathStart = null;

  const lerp = (ax, ay, bx, by, t0, t1, target) => {
    const len = t1 - t0;
    if (len < 1e-12) return { x: ax, y: ay };
    const f = Math.max(0, Math.min(1, (target - t0) / len));
    return { x: ax + (bx - ax) * f, y: ay + (by - ay) * f };
  };

  for (const op of ops) {
    if (op.type === 'M') {
      cur = { x: op.x, y: op.y };
      subpathStart = cur;
      if (targetT <= 0) return { ...cur };
    } else if (op.type === 'L' && cur) {
      const segStart = arcLen;
      const segLen = Math.hypot(op.x - cur.x, op.y - cur.y);
      if (targetT <= segStart + segLen) {
        return lerp(cur.x, cur.y, op.x, op.y, segStart, segStart + segLen, targetT);
      }
      arcLen += segLen;
      cur = { x: op.x, y: op.y };
    } else if (op.type === 'C' && cur) {
      const x0 = cur.x;
      const y0 = cur.y;
      const { x1, y1, x2, y2, x3, y3 } = op;
      let px0 = x0;
      let py0 = y0;
      const steps = 10;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const om = 1 - t;
        const bx =
          om * om * om * x0 + 3 * om * om * t * x1 + 3 * om * t * t * x2 + t * t * t * x3;
        const by =
          om * om * om * y0 + 3 * om * om * t * y1 + 3 * om * t * t * y2 + t * t * t * y3;
        const segStart = arcLen;
        const segLen = Math.hypot(bx - px0, by - py0);
        if (targetT <= segStart + segLen) {
          return lerp(px0, py0, bx, by, segStart, segStart + segLen, targetT);
        }
        arcLen += segLen;
        px0 = bx;
        py0 = by;
      }
      cur = { x: op.x3, y: op.y3 };
    } else if (op.type === 'C2' && cur) {
      const x0 = cur.x;
      const y0 = cur.y;
      const { x1, y1, x2, y2 } = op;
      let px0 = x0;
      let py0 = y0;
      const steps = 8;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const om = 1 - t;
        const bx = om * om * x0 + 2 * om * t * x1 + t * t * x2;
        const by = om * om * y0 + 2 * om * t * y1 + t * t * y2;
        const segStart = arcLen;
        const segLen = Math.hypot(bx - px0, by - py0);
        if (targetT <= segStart + segLen) {
          return lerp(px0, py0, bx, by, segStart, segStart + segLen, targetT);
        }
        arcLen += segLen;
        px0 = bx;
        py0 = by;
      }
      cur = { x: op.x2, y: op.y2 };
    } else if (op.type === 'Z' && cur && subpathStart) {
      const segStart = arcLen;
      const segLen = Math.hypot(subpathStart.x - cur.x, subpathStart.y - cur.y);
      if (targetT <= segStart + segLen) {
        return lerp(cur.x, cur.y, subpathStart.x, subpathStart.y, segStart, segStart + segLen, targetT);
      }
      arcLen += segLen;
      cur = { ...subpathStart };
    }
  }
  return cur ? { ...cur } : null;
}

/**
 * Bearing (deg clockwise from north) along cable at arc length `t`.
 *
 * @param {Array<import('./construct-path-parser.js').PathOp>} ops
 * @param {number} t
 * @param {1|-1} direction  +1 = increasing arc, -1 = decreasing
 * @returns {number}
 */
export function cableTangentBearingDeg(ops, t, direction = 1) {
  const dt = 3;
  const total = pathTotalArcLength(ops);
  const t0 = Math.max(0, Math.min(total, t));
  const t1 = Math.max(0, Math.min(total, t0 + direction * dt));
  const p0 = pointAtArcLength(ops, t0);
  const p1 = pointAtArcLength(ops, t1);
  if (!p0 || !p1) return 0;
  const dx = p1.x - p0.x;
  const dy = p0.y - p1.y;
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

/**
 * Check whether two optional {x, y} points are within threshold distance.
 * Returns false if either point is null.
 *
 * @param {{ x: number, y: number }|null} a
 * @param {{ x: number, y: number }|null} b
 * @param {number} threshold  PDF points.
 * @returns {boolean}
 */
function pointsClose(a, b, threshold) {
  if (!a || !b) return false;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy) < threshold;
}

/**
 * Build cable segment objects from raw PathOp arrays extracted from Cabo Projetado.
 *
 * Each segment: { id: Number, ops: PathOp[], startPoint: {x,y}|null, endPoint: {x,y}|null }
 * startPoint and endPoint are the first and last M/L ops in the path (flipY already applied).
 *
 * Also detects branch segments (D-12) and records them as warnings.
 *
 * @param {Array<Array<import('./construct-path-parser.js').PathOp>>} cablePaths
 *   Array of PathOp[] arrays (flipY already applied by pdf-parser.js).
 * @param {string[]} warnings  Mutable warning accumulator (D-07).
 * @returns {{ cableSegments: Array<{ id: number, ops: PathOp[], startPoint: {x,y}|null, endPoint: {x,y}|null }>, warnings: string[] }}
 */
export function buildCableSegments(cablePaths, warnings = []) {
  const cableSegments = cablePaths.map((ops, idx) => ({
    id: idx,
    ops,
    startPoint: endpointFromPath(ops, 'start'),
    endPoint: endpointFromPath(ops, 'end'),
  }));

  // D-12: Detect branch pairs and record as informational warnings.
  const branches = detectBranches(cableSegments);
  for (const branch of branches) {
    warnings.push(
      `Branch detected: cable segments ${branch.segmentA} and ${branch.segmentB} share an endpoint`
    );
  }

  return { cableSegments, warnings };
}

/**
 * Find pairs of cable segments that share an endpoint within threshold PDF points.
 * Used for branch detection (D-12).
 *
 * @param {Array<{ id: number, startPoint: {x,y}|null, endPoint: {x,y}|null }>} cableSegments
 * @param {number} threshold  PDF points (default 5).
 * @returns {Array<{ segmentA: number, segmentB: number }>}
 */
export function detectBranches(cableSegments, threshold = 5) {
  const branches = [];

  for (let i = 0; i < cableSegments.length; i++) {
    for (let j = i + 1; j < cableSegments.length; j++) {
      const a = cableSegments[i];
      const b = cableSegments[j];

      if (
        pointsClose(a.endPoint, b.startPoint, threshold) ||
        pointsClose(a.startPoint, b.startPoint, threshold) ||
        pointsClose(a.endPoint, b.endPoint, threshold) ||
        pointsClose(a.startPoint, b.endPoint, threshold)
      ) {
        branches.push({ segmentA: i, segmentB: j });
      }
    }
  }

  return branches;
}
