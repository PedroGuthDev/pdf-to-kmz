// parser/geo/cable-arc-placer.js
// N1-v3: Direction-detected straight-line walk from cable tangent bearing.
//
// Algorithm:
//  1. For each page with a pageTransform, detect cable traversal direction using
//     linear regression of post-number vs arc-length t-value.
//  2. Compute cable tangent bearing using cableTangentBearingDeg with correct direction.
//  3. Skip pages where existing PDF coordinates are already consistent with labels
//     (consistency guard to protect Valmor and similar well-calibrated pages).
//  4. Walk straight-line from anchor post in both directions using labeled distances.
//     Taps are bridged: cumDist advances through tap labels even though taps themselves
//     are not placed. Label lookups chain through all intermediate posts.
//
// Browser-compatible (Math.* only). ESM named exports only.

import {
  nearestCableHitOnPage,
  nearestPointOnPathOps,
  cableTangentBearingDeg,
  isOffRouteCablePost,
  pathTotalArcLength,
  pointAtArcLength,
} from '../cable-builder.js';

/**
 * @typedef {{ number: number, x: number, y: number, pageNum?: number, postType?: string }} Post
 */

/**
 * Sum distance labels along a chain from post `fromNum` to post `toNum` (inclusive),
 * stepping +1 at a time. Returns null if any segment in the chain is missing.
 *
 * @param {number} fromNum
 * @param {number} toNum
 * @param {Map<string, number>} distMap
 * @returns {number|null}
 */
function sumChainLabels(fromNum, toNum, distMap) {
  if (fromNum === toNum) return 0;
  const step = fromNum < toNum ? 1 : -1;
  let total = 0;
  let cur = fromNum;
  while (cur !== toNum) {
    const next = cur + step;
    const m = distMap.get(`${Math.min(cur, next)}->${Math.max(cur, next)}`)
      ?? distMap.get(`${cur}->${next}`)
      ?? distMap.get(`${next}->${cur}`);
    if (m == null || m <= 0) return null;
    total += m;
    cur = next;
  }
  return total;
}

/**
 * Cable traversal direction on a page: +1 = arc length increases with post number.
 *
 * @param {Post[]} pagePosts sorted by number
 * @param {Array<import('../construct-path-parser.js').PathOp>} routeOps
 */
function detectCableDir(pagePosts, routeOps) {
  const samples = pagePosts
    .filter(p => routeOps.length)
    .map(p => ({
      n: p.number,
      t: nearestPointOnPathOps(p.x, p.y, routeOps).t,
    }));
  if (samples.length < 2) return 1;

  const nMean = samples.reduce((s, v) => s + v.n, 0) / samples.length;
  const tMean = samples.reduce((s, v) => s + v.t, 0) / samples.length;
  let num = 0;
  let den = 0;
  for (const v of samples) {
    const dn = v.n - nMean;
    num += dn * (v.t - tMean);
    den += dn * dn;
  }
  const slope = den > 1e-12 ? num / den : 0;
  return slope < 0 ? -1 : 1;
}

const ROUTE_CABLE_NEAR_PT = 80;

/** Skip N1 walk when this fraction of labeled same-page pairs match Distância_Poste chords. */
const N1_SKIP_CONSISTENCY_FRAC = 0.85;

/** Poste-symbol posts within this distance of route cable are treated as trusted snaps. */
const N1_POSTE_SNAP_CABLE_PT = 45;

/**
 * @param {number} pageNum
 * @param {number} refX
 * @param {number} refY
 * @param {Map<number, Array<Array<import('../construct-path-parser.js').PathOp>>>} cablesByPage
 */
function selectRouteCableOps(pageNum, refX, refY, cablesByPage) {
  const paths = cablesByPage.get(pageNum) ?? [];
  let bestOps = null;
  let bestScore = -Infinity;
  for (const ops of paths) {
    const hit = nearestPointOnPathOps(refX, refY, ops);
    if (hit.d > ROUTE_CABLE_NEAR_PT) continue;
    const score = hit.t - hit.d * 2;
    if (score > bestScore) {
      bestScore = score;
      bestOps = ops;
    }
  }
  return bestOps;
}

/**
 * Place posts on cable pages using direction-detected straight-line walk.
 *
 * @param {{
 *   sortedPosts: Post[],
 *   distMap: Map<string, number>,
 *   cablesByPage: Map<number, Array<Array<import('../construct-path-parser.js').PathOp>>>,
 *   perPageScale: (pageNum: number) => number|null,
 *   postByNum: Map<number, Post>,
 *   warnings: string[],
 * }} opts
 * @returns {{ placed: Map<number, Post>, skipped: Array<{ number: number, reason: string }>, pagesPlaced: Set<number> }}
 */
export function placePostsOnCableByArcLength({
  sortedPosts,
  distMap,
  cablesByPage,
  perPageScale,
  postByNum,
  warnings,
}) {
  /** @type {Map<number, Post>} */
  const placed = new Map();
  /** @type {Array<{ number: number, reason: string }>} */
  const skipped = [];
  /** @type {Set<number>} */
  const pagesPlaced = new Set();

  /** @type {Map<number, Post[]>} */
  const byPage = new Map();
  for (const post of sortedPosts) {
    const pn = post.pageNum;
    if (pn == null) continue;
    if (!byPage.has(pn)) byPage.set(pn, []);
    byPage.get(pn).push(post);
  }

  // D-N1-04: each page anchors and walks independently — no cross-page arc chaining.
  for (const [pageNum, pagePosts] of byPage) {
    const scale = perPageScale(pageNum);
    if (scale == null) continue;

    const sorted = [...pagePosts].sort((a, b) => a.number - b.number);
    // D-N1-05: tap poles are excluded from N1 walk; isOffRouteCablePost is the canonical detector.
    const nonTapPosts = sorted.filter(p => !isOffRouteCablePost(p, postByNum, cablesByPage));
    if (nonTapPosts.length === 0) {
      for (const p of sorted) skipped.push({ number: p.number, reason: 'all-tap' });
      continue;
    }

    const routePost1 = sortedPosts.find(p => p.number === 1);
    const anchorPost =
      routePost1 &&
      (routePost1.pageNum ?? 1) === pageNum &&
      !isOffRouteCablePost(routePost1, postByNum, cablesByPage)
        ? routePost1
        : nonTapPosts[0];
    // D-N1-02: anchor input is the Viterbi-assigned pole position (post.x/post.y), not the label centroid (anchorX/anchorY).
    const anchorHit = nearestCableHitOnPage(anchorPost.x, anchorPost.y, pageNum, cablesByPage);
    if (anchorHit.d > ROUTE_CABLE_NEAR_PT) {
      for (const p of sorted) skipped.push({ number: p.number, reason: 'no-route-cable' });
      continue;
    }

    const paths = cablesByPage.get(pageNum) ?? [];
    if (paths.length === 0 || anchorHit.pathIndex < 0) {
      for (const p of sorted) skipped.push({ number: p.number, reason: 'no-cable-ops' });
      continue;
    }
    const routeOps = paths[anchorHit.pathIndex];
    const anchorT = nearestPointOnPathOps(anchorPost.x, anchorPost.y, routeOps).t;

    const cableDir = detectCableDir(nonTapPosts, routeOps);
    const bearingDeg = cableTangentBearingDeg(routeOps, anchorT, cableDir);

    let consistentPairs = 0;
    let totalLabeledPairs = 0;
    /** @type {number[]} */
    const labelRatios = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const p1 = sorted[i];
      const p2 = sorted[i + 1];
      if (isOffRouteCablePost(p1, postByNum, cablesByPage)) continue;
      if (isOffRouteCablePost(p2, postByNum, cablesByPage)) continue;
      const mLabel = sumChainLabels(p1.number, p2.number, distMap);
      if (mLabel == null || mLabel <= 0) continue;
      totalLabeledPairs++;
      const actualDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const expectedDist = mLabel / scale;
      if (expectedDist < 1e-6) continue;
      const ratio = actualDist / expectedDist;
      labelRatios.push(ratio);
      if (ratio >= 0.88 && ratio <= 1.12) consistentPairs++;
    }

    const consistencyFrac =
      totalLabeledPairs > 0 ? consistentPairs / totalLabeledPairs : 1;
    const sortedRatios = [...labelRatios].sort((a, b) => a - b);
    const medianRatio =
      sortedRatios.length > 0
        ? sortedRatios[Math.floor(sortedRatios.length / 2)]
        : 1;
    const medianOk = medianRatio >= 0.88 && medianRatio <= 1.12;

    let nearCableCount = 0;
    for (const p of nonTapPosts) {
      const hit = nearestCableHitOnPage(p.x, p.y, pageNum, cablesByPage);
      if (hit && hit.d <= N1_POSTE_SNAP_CABLE_PT) nearCableCount++;
    }
    const posteSnapMajority =
      nonTapPosts.length > 0 &&
      nearCableCount / nonTapPosts.length >= 0.6;
    const anchorOnCable = anchorHit.d <= N1_POSTE_SNAP_CABLE_PT;

    if (
      totalLabeledPairs >= 2 &&
      (consistencyFrac >= N1_SKIP_CONSISTENCY_FRAC ||
        (medianOk && consistencyFrac >= 0.75))
    ) {
      continue;
    }

    if (
      pageNum >= 5 &&
      posteSnapMajority &&
      anchorOnCable &&
      consistencyFrac >= N1_SKIP_CONSISTENCY_FRAC
    ) {
      continue;
    }

    const brg = (bearingDeg * Math.PI) / 180;
    const revBrg = ((bearingDeg + 180) * Math.PI) / 180;
    const anchorIdx = sorted.indexOf(anchorPost);
    let pageCount = 0;

    placed.set(anchorPost.number, { ...anchorPost });
    pageCount++;

    {
      let cumDist = 0;
      let prevNum = anchorPost.number;
      for (let i = anchorIdx + 1; i < sorted.length; i++) {
        const curr = sorted[i];
        const isTap = isOffRouteCablePost(curr, postByNum, cablesByPage);
        const chainM = sumChainLabels(prevNum, curr.number, distMap);
        if (chainM == null || chainM <= 0) {
          skipped.push({ number: curr.number, reason: isTap ? 'tap' : 'no-label' });
          prevNum = curr.number;
          continue;
        }
        cumDist += chainM / scale;
        prevNum = curr.number;
        if (isTap) {
          skipped.push({ number: curr.number, reason: 'tap' });
          continue;
        }
        curr.x = anchorPost.x + cumDist * Math.sin(brg);
        curr.y = anchorPost.y - cumDist * Math.cos(brg);
        if (curr.anchorX != null) {
          curr.anchorX = curr.x;
          curr.anchorY = curr.y;
        }
        placed.set(curr.number, { ...curr });
        pageCount++;
      }
    }

    if (anchorIdx > 0) {
      let cumDist = 0;
      let prevNum = anchorPost.number;
      for (let i = anchorIdx - 1; i >= 0; i--) {
        const curr = sorted[i];
        const isTap = isOffRouteCablePost(curr, postByNum, cablesByPage);
        const chainM = sumChainLabels(curr.number, prevNum, distMap);
        if (chainM == null || chainM <= 0) {
          skipped.push({ number: curr.number, reason: isTap ? 'tap' : 'no-label' });
          prevNum = curr.number;
          continue;
        }
        cumDist += chainM / scale;
        prevNum = curr.number;
        if (isTap) {
          skipped.push({ number: curr.number, reason: 'tap' });
          continue;
        }
        curr.x = anchorPost.x + cumDist * Math.sin(revBrg);
        curr.y = anchorPost.y - cumDist * Math.cos(revBrg);
        if (curr.anchorX != null) {
          curr.anchorX = curr.x;
          curr.anchorY = curr.y;
        }
        placed.set(curr.number, { ...curr });
        pageCount++;
      }
    }

    if (pageCount >= 2) pagesPlaced.add(pageNum);
  }

  return { placed, skipped, pagesPlaced };
}

/**
 * Segment-wise cable arc placement from post #1 along the full route (single GPS anchor).
 * Walks along Cabo Projetado on each page using detected cable direction.
 *
 * @param {{
 *   sortedPosts: Post[],
 *   distMap: Map<string, number>,
 *   cablesByPage: Map<number, Array<Array<import('../construct-path-parser.js').PathOp>>>,
 *   perPageScale: (pageNum: number) => number|null,
 *   postByNum: Map<number, Post>,
 *   warnings: string[],
 * }} opts
 * @returns {{ placed: number, skipped: number }}
 */
export function placePostsAlongRouteCable({
  sortedPosts,
  distMap,
  cablesByPage,
  perPageScale,
  postByNum,
  warnings,
}) {
  if (!sortedPosts?.length || !cablesByPage?.size) {
    return { placed: 0, skipped: 0 };
  }

  const sorted = [...sortedPosts].sort((a, b) => a.number - b.number);
  const post1 = sorted[0];
  const pg1 = post1.pageNum;
  if (pg1 == null) return { placed: 0, skipped: 0 };

  const ops1 = selectRouteCableOps(pg1, post1.x, post1.y, cablesByPage);
  if (!ops1) {
    warnings.push('[route-cable] Post 1 has no nearby Cabo Projetado — skipped.');
    return { placed: 0, skipped: sorted.length };
  }

  const hit1 = nearestPointOnPathOps(post1.x, post1.y, ops1);
  const scale1 = perPageScale(pg1);
  if (scale1 == null || scale1 <= 0) return { placed: 0, skipped: 0 };

  /** @type {Map<number, { ops: Array, lastT: number }>} */
  const pageState = new Map();
  pageState.set(pg1, { ops: ops1, lastT: hit1.t });

  let placed = 0;
  let skipped = 0;

  for (let i = 0; i < sorted.length; i++) {
    const post = sorted[i];
    if (isOffRouteCablePost(post, postByNum, cablesByPage)) {
      skipped++;
      continue;
    }

    const pg = post.pageNum;
    if (pg == null) {
      skipped++;
      continue;
    }

    const scale = perPageScale(pg);
    if (scale == null || scale <= 0) {
      skipped++;
      continue;
    }

    if (!pageState.has(pg)) {
      const ops = selectRouteCableOps(pg, post.x, post.y, cablesByPage);
      if (!ops) {
        skipped++;
        continue;
      }
      const hit = nearestPointOnPathOps(post.x, post.y, ops);
      pageState.set(pg, { ops, lastT: hit.t });
      const pt = pointAtArcLength(ops, hit.t);
      if (pt) {
        post.x = pt.x;
        post.y = pt.y;
        if (post.anchorX != null) {
          post.anchorX = pt.x;
          post.anchorY = pt.y;
        }
        placed++;
      }
      continue;
    }

    if (i === 0) {
      placed++;
      continue;
    }

    const prev = sorted[i - 1];
    const m =
      distMap.get(`${prev.number}->${post.number}`) ??
      distMap.get(`${post.number}->${prev.number}`);
    if (m == null || m <= 0) {
      skipped++;
      continue;
    }

    const { ops, lastT } = pageState.get(pg);
    const pagePosts = sorted.filter(p => (p.pageNum ?? 0) === pg);
    const cableDir = detectCableDir(pagePosts, ops);
    const newT = lastT + cableDir * (m / scale);
    const pt = pointAtArcLength(ops, Math.max(0, newT));
    if (!pt) {
      skipped++;
      continue;
    }

    post.x = pt.x;
    post.y = pt.y;
    if (post.anchorX != null) {
      post.anchorX = pt.x;
      post.anchorY = pt.y;
    }
    pageState.set(pg, { ops, lastT: newT });
    placed++;
  }

  if (placed >= 3) {
    warnings.push(
      `[route-cable] Segment cable placement: ${placed} posts from post #1 (${skipped} skipped).`
    );
  }

  return { placed, skipped };
}
