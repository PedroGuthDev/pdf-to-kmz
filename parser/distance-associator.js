// parser/distance-associator.js
// Associates inter-post distances from the Distância_Poste layer to sequential
// post pairs by finding the nearest distance label to each pair's midpoint.
//
// Named ESM exports only — no default export, no CommonJS require.

/**
 * Ratio from overview-page PDF points to detail-page PDF points.
 * 303.6 pt = typical detail-page width in PDF user-space units;
 * 1191 pt = typical overview-page width at the same physical scale.
 * Used as a fallback when no per-page UTM grid is available.
 */
const OVERVIEW_TO_DETAIL_SCALE = 303.6 / 1191;

import {
  isOffRouteCablePost,
  nearestCableHitOnPage,
} from "./cable-builder.js";
import { deduplicatePostsPreferLowerPage } from "./post-assembler.js";

/**
 * Hybrid discriminator (quick task 260602-lbl, locked decision 2).
 *
 * Distinguishes a JUNCTION BRANCH-ARM label (sits near a junction and points
 * along the arm's cable-direction bearing toward a NON-consecutive far post)
 * from a CONSECUTIVE-PAIR label (lies on the chord between numbered neighbours).
 *
 * PRIMARY signal  = cable-arm bearing geometry: the label sits near the junction
 *   and its bearing from the junction aligns with the bearing toward the far post
 *   (measured along the cable polyline near the junction, not just the post chord).
 * CONFIRM / tiebreak = label-on-cable overlap: the label physically lies on a
 *   cable segment (small perpendicular gap to the nearest Cabo Projetado path).
 *
 * Pure geometry — NO post-number literals. Returns a score object the caller can
 * threshold; never decides on its own.
 *
 * @param {{x:number,y:number}} labelPt  label anchor (page coords)
 * @param {number} labelPage
 * @param {{anchorX?:number,x:number,anchorY?:number,y:number,pageNum?:number}} junction
 * @param {{anchorX?:number,x:number,anchorY?:number,y:number,pageNum?:number}} farPost  candidate arm endpoint
 * @param {Map<number, Array>} cablesByPage
 * @returns {{
 *   nearJunctionPt: number,
 *   bearingAlignDeg: number,
 *   onCableGapPt: number,
 *   bearingAligned: boolean,
 *   onCable: boolean,
 * }}
 */
export function classifyBranchArmLabel(
  labelPt,
  labelPage,
  junction,
  farPost,
  cablesByPage,
) {
  const jx = junction.anchorX ?? junction.x;
  const jy = junction.anchorY ?? junction.y;
  const fx = farPost.anchorX ?? farPost.x;
  const fy = farPost.anchorY ?? farPost.y;

  const nearJunctionPt = Math.hypot(labelPt.x - jx, labelPt.y - jy);

  // Bearing the label sits at, relative to the junction.
  const bLabel = Math.atan2(labelPt.y - jy, labelPt.x - jx);
  // Bearing toward the far post. Prefer the cable-arm direction near the junction
  // (nearest cable point to the far post on the junction's page) over the raw
  // post chord, so branch arms that bend mid-street are measured correctly.
  let tfx = fx;
  let tfy = fy;
  if (cablesByPage?.size && labelPage != null) {
    const farHit = nearestCableHitOnPage(fx, fy, labelPage, cablesByPage);
    if (farHit && Number.isFinite(farHit.d)) {
      tfx = farHit.x;
      tfy = farHit.y;
    }
  }
  const bFar = Math.atan2(tfy - jy, tfx - jx);
  let diff = Math.abs(bLabel - bFar);
  if (diff > Math.PI) diff = 2 * Math.PI - diff;
  const bearingAlignDeg = (diff * 180) / Math.PI;

  let onCableGapPt = Infinity;
  if (cablesByPage?.size && labelPage != null) {
    const hit = nearestCableHitOnPage(labelPt.x, labelPt.y, labelPage, cablesByPage);
    if (hit && Number.isFinite(hit.d)) onCableGapPt = hit.d;
  }

  return {
    nearJunctionPt,
    bearingAlignDeg,
    onCableGapPt,
    bearingAligned: bearingAlignDeg <= BRANCH_ARM_BEARING_TOL_DEG,
    onCable: onCableGapPt <= BRANCH_ARM_ON_CABLE_TOL_PT,
  };
}

/** Bearing alignment tolerance: label bearing vs arm bearing from junction. */
const BRANCH_ARM_BEARING_TOL_DEG = 35;
/** On-cable overlap tolerance: label perpendicular gap to nearest cable path. */
const BRANCH_ARM_ON_CABLE_TOL_PT = 22;

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
  return Math.hypot(px - cx, py - cy);
}

/**
 * Pair sequential posts (N → N+1 by number) and associate each pair with the
 * nearest distance label from the Distância_Poste layer.
 *
 * IMPORTANT — Brazilian locale: distance values in the PDF use a comma as the
 * decimal separator (e.g., "40,2" instead of "40.2"). Commas are replaced with
 * dots before parseFloat.
 *
 * @param {Array<{ number: number, x: number, y: number, pageNum?: number, anchorX?: number, anchorY?: number }>} posts
 *   Deduplicated, sorted posts (flipY applied).
 * @param {Array<{ str: string, x: number, y: number, pageNum?: number, width?: number }>} distItems
 *   Text items from Distância_Poste layer (flipY applied). Optional `width` improves
 *   association when the label anchor is the glyph box left edge.
 * @param {string[]} warnings  Mutable warning accumulator (D-07).
 * @param {{ scaleFactor?: number, detailScaleFactor?: number, perPageScale?: (pageNum: number) => number|null }} [opts]
 * @returns {{ distances: Array<{ from: number, to: number, meters: number|null }>, warnings: string[] }}
 */
export function associateDistances(posts, distItems, warnings = [], opts = {}) {
  const distances = [];

  const sortedPosts = [...posts].sort((a, b) => a.number - b.number);
  const overviewSf = opts.scaleFactor ?? null;
  /** @type {Set<number>} */
  const excludedLabelIndices =
    opts.excludedLabelIndices instanceof Set
      ? opts.excludedLabelIndices
      : new Set();

  const pdfPos = (p) => ({
    x: p.anchorX ?? p.x,
    y: p.anchorY ?? p.y,
  });

  /** @type {Array<{ segIdx: number, labelKey: string, li: number, score: number, meters: number }>} */
  const candidates = [];

  for (let i = 0; i < sortedPosts.length - 1; i++) {
    const from = sortedPosts[i];
    const to = sortedPosts[i + 1];
    const a = pdfPos(from);
    const b = pdfPos(to);
    const samePage =
      from.pageNum != null && to.pageNum != null && from.pageNum === to.pageNum;
    const crossPage = !samePage && from.pageNum != null && to.pageNum != null;
    const pdfPt = Math.hypot(b.x - a.x, b.y - a.y);

    for (let li = 0; li < distItems.length; li++) {
      if (excludedLabelIndices.has(li)) continue;
      const dt = distItems[li];
      const normalized = dt.str.trim().replace(/\s+/g, "").replace(",", ".");
      if (!/^\d+(\.\d+)?$/.test(normalized)) continue;

      const labelPage = dt.pageNum ?? null;
      if (samePage && labelPage != null && labelPage !== from.pageNum) continue;
      if (crossPage && labelPage != null && labelPage !== to.pageNum) continue;

      const w = typeof dt.width === "number" && dt.width > 0 ? dt.width : 0;
      const lx = w > 0 ? dt.x + w * 0.5 : dt.x;
      const ly = dt.y;

      const gap = labelGapToSegment(lx, ly, from, to, crossPage, sortedPosts);

      const meters = parseFloat(normalized);
      let ratioPenalty = 0;
      const pageSf =
        !crossPage && from.pageNum != null && opts.perPageScale
          ? opts.perPageScale(from.pageNum)
          : null;
      const detailSf =
        pageSf ??
        opts.detailScaleFactor ??
        (overviewSf != null ? overviewSf * OVERVIEW_TO_DETAIL_SCALE : null);
      if (!crossPage && detailSf != null && meters > 0 && pdfPt > 0) {
        const pdfM = pdfPt * detailSf;
        const ratio = pdfM / meters;
        const gapPt = labelGapToSegment(lx, ly, from, to, false, sortedPosts);
        const labelOnChord = gapPt < 55;
        if ((ratio < 0.35 || ratio > 2.5) && !labelOnChord) continue;
        ratioPenalty = 35 * Math.abs(Math.log(ratio));
      }

      const labelKey = `${li}:${normalized}:${lx.toFixed(1)},${ly.toFixed(1)}`;
      candidates.push({
        segIdx: i,
        labelKey,
        li,
        score: gap + ratioPenalty,
        meters,
      });
    }
  }

  candidates.sort((a, b) => a.score - b.score);

  const assignedSeg = new Set();
  const assignedLabel = new Set();
  /** @type {Set<number>} */
  const usedLabelIndices = new Set();
  /** @type {Array<{ from: number, to: number, meters: number|null }>} */
  const pairs = sortedPosts.slice(0, -1).map((from, i) => ({
    from: from.number,
    to: sortedPosts[i + 1].number,
    meters: null,
  }));

  for (const c of candidates) {
    if (assignedSeg.has(c.segIdx) || assignedLabel.has(c.labelKey)) continue;
    if (c.score > 120) continue;
    pairs[c.segIdx].meters = c.meters;
    assignedSeg.add(c.segIdx);
    assignedLabel.add(c.labelKey);
    usedLabelIndices.add(c.li);
  }

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    if (pair.meters == null) {
      warnings.push(
        `No distance label found between posts ${pair.from} and ${pair.to}`,
      );
    }
    distances.push(pair);
  }

  return { distances, warnings, usedLabelIndices };
}

/**
 * Assign each Distância_Poste label to at most one consecutive post pair (N→N+1)
 * using route order: labels are sorted by projection onto the post-number polyline,
 * then matched monotonically to segments so dense bifurcation zones do not "shift"
 * labels by one span.
 *
 * @returns {{ distances: Array<{ from: number, to: number, meters: number|null, source?: string }>, warnings: string[] }}
 */
function associateSequentialMonotonic(
  posts,
  distItems,
  warnings = [],
  opts = {},
) {
  const sortedPosts = [...posts].sort((a, b) => a.number - b.number);
  const overviewSf = opts.scaleFactor ?? null;
  const perPageScale = opts.perPageScale ?? null;

  const pdfPos = (p) => ({
    x: p.anchorX ?? p.x,
    y: p.anchorY ?? p.y,
  });

  const cumLen = [0];
  for (let i = 1; i < sortedPosts.length; i++) {
    const a = pdfPos(sortedPosts[i - 1]);
    const b = pdfPos(sortedPosts[i]);
    cumLen.push(cumLen[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const routeLen = cumLen[cumLen.length - 1] || 1;

  const projectAlongRoute = (lx, ly) => {
    let bestT = 0;
    let bestD = Infinity;
    for (let i = 0; i < sortedPosts.length - 1; i++) {
      const a = pdfPos(sortedPosts[i]);
      const b = pdfPos(sortedPosts[i + 1]);
      const gap = distPointToSegment(lx, ly, a.x, a.y, b.x, b.y);
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const ab2 = abx * abx + aby * aby;
      const apx = lx - a.x;
      const apy = ly - a.y;
      let t = ab2 > 1e-12 ? (apx * abx + apy * aby) / ab2 : 0;
      t = Math.max(0, Math.min(1, t));
      if (gap < bestD) {
        bestD = gap;
        bestT = (cumLen[i] + t * (cumLen[i + 1] - cumLen[i])) / routeLen;
      }
    }
    return bestT;
  };

  const segTMid = (segIdx) =>
    (cumLen[segIdx] + cumLen[segIdx + 1]) / 2 / routeLen;

  const scoreLabelOnSeg = (segIdx, dt) => {
    const from = sortedPosts[segIdx];
    const to = sortedPosts[segIdx + 1];
    const meters = parseDistanceMeters(dt.str);
    if (meters == null) return null;

    const samePage =
      from.pageNum != null && to.pageNum != null && from.pageNum === to.pageNum;
    const crossPage = !samePage && from.pageNum != null && to.pageNum != null;
    const labelPage = dt.pageNum ?? null;
    if (samePage && labelPage != null && labelPage !== from.pageNum)
      return null;
    if (crossPage && labelPage != null && labelPage !== to.pageNum) return null;

    const w = typeof dt.width === "number" && dt.width > 0 ? dt.width : 0;
    const lx = w > 0 ? dt.x + w * 0.5 : dt.x;
    const ly = dt.y;

    const gap = labelGapToSegment(lx, ly, from, to, crossPage, sortedPosts);
    if (gap > 90) return null;

    const a = pdfPos(from);
    const b = pdfPos(to);
    const pdfPt = Math.hypot(b.x - a.x, b.y - a.y);
    let ratioPenalty = 0;
    const pageSf =
      !crossPage && from.pageNum != null && perPageScale
        ? perPageScale(from.pageNum)
        : null;
    const detailSf =
      pageSf ??
      opts.detailScaleFactor ??
      (overviewSf != null ? overviewSf * OVERVIEW_TO_DETAIL_SCALE : null);
    if (!crossPage && detailSf != null && meters > 0 && pdfPt > 0) {
      const pdfM = pdfPt * detailSf;
      const ratio = pdfM / meters;
      const labelOnChord = gap < 55;
      if ((ratio < 0.35 || ratio > 2.5) && !labelOnChord) return null;
      ratioPenalty = 35 * Math.abs(Math.log(ratio));
    }

    const score = gap + ratioPenalty;
    if (score > 120) return null;
    return { meters, score };
  };

  /** @type {Array<{ from: number, to: number, meters: number|null, source?: string }>} */
  const pairs = sortedPosts.slice(0, -1).map((from, i) => ({
    from: from.number,
    to: sortedPosts[i + 1].number,
    meters: null,
  }));

  /** @type {Array<{ li: number, meters: number, t: number, labelKey: string }>} */
  const labels = [];
  for (let li = 0; li < distItems.length; li++) {
    const dt = distItems[li];
    const meters = parseDistanceMeters(dt.str);
    if (meters == null) continue;
    const w = typeof dt.width === "number" && dt.width > 0 ? dt.width : 0;
    const lx = w > 0 ? dt.x + w * 0.5 : dt.x;
    const ly = dt.y;
    const normalized = dt.str.trim().replace(/\s+/g, "").replace(",", ".");
    labels.push({
      li,
      meters,
      t: projectAlongRoute(lx, ly),
      labelKey: `${li}:${normalized}:${lx.toFixed(1)},${ly.toFixed(1)}`,
    });
  }
  labels.sort((a, b) => a.t - b.t || a.li - b.li);

  const assignedSeg = new Set();
  const assignedLabel = new Set();
  let nextSeg = 0;
  const LOOKAHEAD = 5;
  const ORDER_WEIGHT = 10;

  for (const lab of labels) {
    if (assignedLabel.has(lab.labelKey)) continue;
    let best = null;
    for (
      let segIdx = nextSeg;
      segIdx < Math.min(nextSeg + LOOKAHEAD, pairs.length);
      segIdx++
    ) {
      if (assignedSeg.has(segIdx)) continue;
      const sc = scoreLabelOnSeg(segIdx, distItems[lab.li]);
      if (!sc) continue;
      const orderPenalty = ORDER_WEIGHT * Math.abs(segTMid(segIdx) - lab.t);
      const combined = sc.score + orderPenalty;
      if (!best || combined < best.combined)
        best = { segIdx, meters: sc.meters, combined };
    }
    if (!best) continue;
    pairs[best.segIdx].meters = best.meters;
    pairs[best.segIdx].source = "monotonic-route";
    assignedSeg.add(best.segIdx);
    assignedLabel.add(lab.labelKey);
    nextSeg = best.segIdx + 1;
  }

  // Global greedy for any still-unassigned segments (same scoring as associateDistances).
  /** @type {Array<{ segIdx: number, labelKey: string, score: number, meters: number }>} */
  const leftovers = [];
  for (let segIdx = 0; segIdx < pairs.length; segIdx++) {
    if (assignedSeg.has(segIdx)) continue;
    const from = sortedPosts[segIdx];
    const to = sortedPosts[segIdx + 1];
    for (let li = 0; li < distItems.length; li++) {
      const dt = distItems[li];
      const meters = parseDistanceMeters(dt.str);
      if (meters == null) continue;
      const w = typeof dt.width === "number" && dt.width > 0 ? dt.width : 0;
      const lx = w > 0 ? dt.x + w * 0.5 : dt.x;
      const ly = dt.y;
      const normalized = dt.str.trim().replace(/\s+/g, "").replace(",", ".");
      const labelKey = `${li}:${normalized}:${lx.toFixed(1)},${ly.toFixed(1)}`;
      if (assignedLabel.has(labelKey)) continue;
      const sc = scoreLabelOnSeg(segIdx, dt);
      if (!sc) continue;
      leftovers.push({
        segIdx,
        labelKey,
        score: sc.score,
        meters: sc.meters,
      });
    }
  }
  leftovers.sort((a, b) => a.score - b.score);
  for (const c of leftovers) {
    if (assignedSeg.has(c.segIdx) || assignedLabel.has(c.labelKey)) continue;
    if (c.score > 120) continue;
    pairs[c.segIdx].meters = c.meters;
    pairs[c.segIdx].source = "monotonic-greedy";
    assignedSeg.add(c.segIdx);
    assignedLabel.add(c.labelKey);
  }

  for (const pair of pairs) {
    if (pair.meters == null) {
      warnings.push(
        `No distance label found between posts ${pair.from} and ${pair.to}`,
      );
    }
  }

  return { distances: pairs, warnings };
}

/**
 * After pole placement (pass 2) or rich association: drop false (hi-1)→hi labels when
 * a branch return lo→hi is known, then reassign freed labels to the next spans.
 */
export function applyJumpbackDistanceCleanup(
  posts,
  distItems,
  distances,
  warnings,
  opts = {},
) {
  const { suppressed, clearedMeters } = suppressJumpbackSequentialSpans(
    distances,
    warnings,
    posts,
  );
  /** @type {Set<string>} */
  const refineProtected = new Set(suppressed);
  for (const d of distances) {
    if (
      d.source === "bifurcation-cleared" ||
      d.source === "bifurcation-tap" ||
      d.source === "bifurcation-main"
    ) {
      const lo = Math.min(d.from, d.to);
      const hi = Math.max(d.from, d.to);
      refineProtected.add(`${lo}->${hi}`);
      if (d.source === "bifurcation-cleared") {
        suppressed.add(`${lo}->${hi}`);
      }
    }
  }
  rehomeNextSpanAfterJumpback(
    posts,
    distItems,
    distances,
    refineProtected,
    clearedMeters,
    warnings,
    opts,
  );
  refillSequentialGaps(
    posts,
    distItems,
    distances,
    refineProtected,
    warnings,
    opts,
  );
  refineSequentialWindows(posts, distItems, distances, warnings, {
    ...opts,
    jumpbackRefine: true,
    suppressedKeys: refineProtected,
  });
  for (const key of suppressed) {
    const mm = key.match(/^(\d+)->(\d+)$/);
    if (!mm) continue;
    const a = parseInt(mm[1], 10);
    const b = parseInt(mm[2], 10);
    for (const d of distances) {
      const lo = Math.min(d.from, d.to);
      const hi = Math.max(d.from, d.to);
      if (lo === a && hi === b) {
        d.meters = null;
        d.source = "jumpback-suppressed";
      }
    }
  }
}

/**
 * When a labeled jump lo→hi spans a branch (e.g. 5→10 after posts 6–9), clear the
 * bogus sequential edge (hi-1)→hi — the cable does not continue from the branch tip.
 *
 * @returns {Set<string>} normalized pair keys that must remain without a label
 */
function suppressJumpbackSequentialSpans(distances, warnings, posts = []) {
  const suppressed = new Set();
  /** @type {Map<string, number>} meters cleared from (hi-1)→hi, for re-home to hi→(hi+1) */
  const clearedMeters = new Map();
  /** @type {Array<{ lo: number, hi: number }>} */
  const jumps = [];
  const MAX_JUMP_SPAN = 15;
  const byNum = new Map((posts ?? []).map((p) => [p.number, p]));

  for (const d of distances) {
    if (d.meters == null || d.meters <= 0) continue;
    const lo = Math.min(d.from, d.to);
    const hi = Math.max(d.from, d.to);
    const span = hi - lo;
    if (span < 4 || span > MAX_JUMP_SPAN) continue;
    if (lo < hi - 6) continue;
    if (!isPlausibleBranchReturnJump(byNum, lo, hi, distances)) continue;
    jumps.push({ lo, hi });
  }
  for (const { lo, hi } of jumps) {
    const penultimate = hi - 1;
    if (penultimate <= lo) continue;
    const key = `${penultimate}->${hi}`;
    suppressed.add(key);
    let foundEntry = false;
    for (const d of distances) {
      const a = Math.min(d.from, d.to);
      const b = Math.max(d.from, d.to);
      if (a === penultimate && b === hi) {
        if (d.meters != null) {
          warnings.push(
            `[distance-assoc] Cleared ${penultimate}→${hi}: branch ends at ${penultimate}; rejoin is ${lo}→${hi}`,
          );
          clearedMeters.set(key, d.meters);
        }
        d.meters = null;
        d.source = "jumpback-suppressed";
        foundEntry = true;
      }
    }
    // Ensure entry exists so prefill/lsq see the suppression marker.
    if (!foundEntry) {
      distances.push({
        from: penultimate,
        to: hi,
        meters: null,
        source: "jumpback-suppressed",
      });
    }
    const nextNum = hi + 1;
    if (byNum.has(nextNum)) {
      for (const d of distances) {
        const a = Math.min(d.from, d.to);
        const b = Math.max(d.from, d.to);
        if (a === hi && b === nextNum && d.meters != null) {
          d.meters = null;
          delete d.source;
        }
      }
    }
  }
  return { suppressed, clearedMeters };
}

/**
 * Branch return: cable leaves junction `lo` (e.g. 5→6), ends at tip `hi-1` (9),
 * rejoins at `hi` (10). The rejoin post is nearer to `lo` than the tip is.
 */
function isPlausibleBranchReturnJump(byNum, lo, hi, distances) {
  if (!byNum.get(lo) || !byNum.get(hi) || !byNum.get(hi - 1)) return false;
  return (distances ?? []).some((d) => {
    if (d.meters == null || d.meters <= 0) return false;
    const a = Math.min(d.from, d.to);
    const b = Math.max(d.from, d.to);
    return a === lo && b === lo + 1;
  });
}

/**
 * Greedy refill for sequential segments left empty after jumpback suppression.
 *
 * @param {Set<string>} suppressed normalized pair keys (e.g. "9->10")
 */
function refillSequentialGaps(
  posts,
  distItems,
  seq,
  suppressed,
  warnings,
  opts,
) {
  const sortedPosts = [...posts].sort((a, b) => a.number - b.number);
  const overviewSf = opts.scaleFactor ?? null;
  const perPageScale = opts.perPageScale ?? null;
  const pdfPos = (p) => ({
    x: p.anchorX ?? p.x,
    y: p.anchorY ?? p.y,
  });

  const assignedSeg = new Set();
  const assignedLabel = new Set();
  for (let i = 0; i < seq.length; i++) {
    const d = seq[i];
    if (d.meters == null) continue;
    const k = `${Math.min(d.from, d.to)}->${Math.max(d.from, d.to)}`;
    if (suppressed.has(k)) continue;
    assignedSeg.add(i);
  }

  /** @type {Array<{ segIdx: number, labelKey: string, score: number, meters: number }>} */
  const candidates = [];

  for (let i = 0; i < seq.length; i++) {
    const pair = seq[i];
    const pairKey = `${Math.min(pair.from, pair.to)}->${Math.max(pair.from, pair.to)}`;
    if (pair.meters != null || suppressed.has(pairKey)) continue;

    const from = sortedPosts.find((p) => p.number === pair.from);
    const to = sortedPosts.find((p) => p.number === pair.to);
    if (!from || !to) continue;

    const a = pdfPos(from);
    const b = pdfPos(to);
    const samePage =
      from.pageNum != null && to.pageNum != null && from.pageNum === to.pageNum;
    const crossPage = !samePage && from.pageNum != null && to.pageNum != null;

    for (let li = 0; li < distItems.length; li++) {
      const dt = distItems[li];
      const normalized = dt.str.trim().replace(/\s+/g, "").replace(",", ".");
      if (!/^\d+(\.\d+)?$/.test(normalized)) continue;

      const labelPage = dt.pageNum ?? null;
      if (samePage && labelPage != null && labelPage !== from.pageNum) continue;
      if (crossPage && labelPage != null && labelPage !== to.pageNum) continue;

      const w = typeof dt.width === "number" && dt.width > 0 ? dt.width : 0;
      const lx = w > 0 ? dt.x + w * 0.5 : dt.x;
      const ly = dt.y;
      const gap = labelGapToSegment(lx, ly, from, to, crossPage, sortedPosts);

      const meters = parseFloat(normalized);
      let ratioPenalty = 0;
      const pageSf =
        !crossPage && from.pageNum != null && perPageScale
          ? perPageScale(from.pageNum)
          : null;
      const detailSf =
        pageSf ??
        opts.detailScaleFactor ??
        (overviewSf != null ? overviewSf * OVERVIEW_TO_DETAIL_SCALE : null);
      const pdfPt = Math.hypot(b.x - a.x, b.y - a.y);
      if (!crossPage && detailSf != null && meters > 0 && pdfPt > 0) {
        const pdfM = pdfPt * detailSf;
        const ratio = pdfM / meters;
        const labelOnChord = gap < 55;
        if ((ratio < 0.35 || ratio > 2.5) && !labelOnChord) continue;
        ratioPenalty = 35 * Math.abs(Math.log(ratio));
      }

      const labelKey = `${li}:${normalized}:${lx.toFixed(1)},${ly.toFixed(1)}`;
      if (assignedLabel.has(labelKey)) continue;
      const score = gap + ratioPenalty;
      candidates.push({ segIdx: i, labelKey, score, meters });
    }
  }

  candidates.sort((a, b) => a.score - b.score);
  for (const c of candidates) {
    if (assignedSeg.has(c.segIdx) || assignedLabel.has(c.labelKey)) continue;
    if (c.score > 120) continue;
    seq[c.segIdx].meters = c.meters;
    seq[c.segIdx].source = "jumpback-refill";
    assignedSeg.add(c.segIdx);
    assignedLabel.add(c.labelKey);
  }
}

/**
 * After clearing (hi-1)→hi, assign the best remaining label to the true next span hi→(hi+1).
 */
function rehomeNextSpanAfterJumpback(
  posts,
  distItems,
  distances,
  suppressed,
  clearedMeters,
  warnings,
  opts,
) {
  const sorted = [...posts].sort((a, b) => a.number - b.number);

  for (const key of suppressed) {
    const mm = key.match(/^(\d+)->(\d+)$/);
    if (!mm) continue;
    const hi = parseInt(mm[2], 10);
    const toNum = hi + 1;
    const seg = distances.find(
      (d) =>
        (d.from === hi && d.to === toNum) || (d.from === toNum && d.to === hi),
    );
    if (!seg) continue;

    const shifted = clearedMeters?.get(key);
    if (shifted != null && shifted > 0) {
      seg.meters = shifted;
      seg.source = "jumpback-shift";
      dropConflictingNonSequentialEdges(distances, hi, toNum, shifted);
      warnings.push(
        `[distance-assoc] Shifted cleared label ${shifted} from ${key} to ${hi}→${toNum}`,
      );
      continue;
    }

    if (seg.meters != null) continue;

    const fromPost = sorted.find((p) => p.number === hi);
    const toPost = sorted.find((p) => p.number === toNum);
    if (!fromPost || !toPost) continue;

    const segIdx = sorted.findIndex((p) => p.number === hi);
    if (segIdx < 0) continue;

    let best = null;
    for (let li = 0; li < distItems.length; li++) {
      const dt = distItems[li];
      const sc = scoreLabelOnSequentialSeg(sorted, segIdx, dt, opts);
      if (!sc) continue;
      const w = typeof dt.width === "number" && dt.width > 0 ? dt.width : 0;
      const lx = w > 0 ? dt.x + w * 0.5 : dt.x;
      const normalized = dt.str.trim().replace(/\s+/g, "").replace(",", ".");
      if (!best || sc.score < best.score)
        best = { meters: sc.meters, score: sc.score };
    }
    if (!best || best.score > 120) continue;
    seg.meters = best.meters;
    seg.source = "jumpback-rehome";
    dropConflictingNonSequentialEdges(distances, hi, toNum, best.meters);
    warnings.push(
      `[distance-assoc] Rehomed label ${best.meters} to ${hi}→${toNum} after branch return`,
    );
  }
}

/** Remove spurious inferred chords that stole the same meter value. */
function dropConflictingNonSequentialEdges(distances, from, to, meters) {
  for (let i = distances.length - 1; i >= 0; i--) {
    const d = distances[i];
    if (d.meters == null || Math.abs(d.meters - meters) > 0.05) continue;
    if ((d.from === from && d.to === to) || (d.from === to && d.to === from))
      continue;
    const lo = Math.min(d.from, d.to);
    const hi = Math.max(d.from, d.to);
    if (hi - lo === 1) continue;
    distances.splice(i, 1);
  }
}

/** @returns {{ meters: number, score: number } | null} */
function scoreLabelOnSequentialSeg(sortedPosts, segIdx, dt, opts) {
  const from = sortedPosts[segIdx];
  const to = sortedPosts[segIdx + 1];
  if (!from || !to) return null;

  const meters = parseDistanceMeters(dt.str);
  if (meters == null) return null;

  const overviewSf = opts.scaleFactor ?? null;
  const perPageScale = opts.perPageScale ?? null;
  const samePage =
    from.pageNum != null && to.pageNum != null && from.pageNum === to.pageNum;
  const crossPage = !samePage && from.pageNum != null && to.pageNum != null;
  const labelPage = dt.pageNum ?? null;
  if (samePage && labelPage != null && labelPage !== from.pageNum) return null;
  if (crossPage && labelPage != null && labelPage !== to.pageNum) return null;

  const w = typeof dt.width === "number" && dt.width > 0 ? dt.width : 0;
  const lx = w > 0 ? dt.x + w * 0.5 : dt.x;
  const ly = dt.y;
  const gap = labelGapToSegment(lx, ly, from, to, crossPage, sortedPosts);
  if (gap > 90) return null;

  const pdfPos = (p) => ({ x: p.anchorX ?? p.x, y: p.anchorY ?? p.y });
  const a = pdfPos(from);
  const b = pdfPos(to);
  const pdfPt = Math.hypot(b.x - a.x, b.y - a.y);
  let ratioPenalty = 0;
  const pageSf =
    !crossPage && from.pageNum != null && perPageScale
      ? perPageScale(from.pageNum)
      : null;
  const detailSf =
    pageSf ??
    opts.detailScaleFactor ??
    (overviewSf != null ? overviewSf * OVERVIEW_TO_DETAIL_SCALE : null);
  if (!crossPage && detailSf != null && meters > 0 && pdfPt > 0) {
    const pdfM = pdfPt * detailSf;
    const ratio = pdfM / meters;
    const labelOnChord = gap < 55;
    if ((ratio < 0.35 || ratio > 2.5) && !labelOnChord) return null;
    ratioPenalty = 35 * Math.abs(Math.log(ratio));
  }
  const score = gap + ratioPenalty;
  if (score > 120) return null;
  return { meters, score };
}

/**
 * Rich association: keep the sequential N→N+1 distances, but also infer additional
 * edges (including non-consecutive numbers) by matching each Distância_Poste label
 * to the best post-pair "under" that label.
 *
 * This is required for bifurcations/branches where a junction post legitimately has
 * more than one outgoing segment length (e.g. 5→6 and 5→10).
 *
 * @returns {{ distances: Array<{ from: number, to: number, meters: number|null }>, warnings: string[] }}
 */
export function associateDistancesRich(
  posts,
  distItems,
  warnings = [],
  opts = {},
) {
  // Step 1: run inferred (with tight heuristics) to claim non-sequential
  // branch-return labels like 5→10 BEFORE the sequential greedy pass can
  // misassign them to a sequential pair. Then run legacy sequential with the
  // inferred-consumed labels excluded so the sequential pass uses only
  // labels that genuinely belong to N→N+1 spans (see
  // .planning/debug/siriu-branch-return-labels.md).
  const { edges: inferred, usedLabelIndices: inferUsed } =
    inferDistanceEdgesFromLabels(posts, distItems, warnings, opts);

  const { distances: legacySeq, warnings: w0 } = associateDistances(
    posts,
    distItems,
    [],
    { ...opts, excludedLabelIndices: inferUsed },
  );
  warnings.push(...w0);
  /** @type {Array<{ from: number, to: number, meters: number|null, source?: string }>} */
  const seq = legacySeq.map((d) => ({
    ...d,
    ...(d.meters != null ? { source: "legacy-midpoint" } : {}),
  }));

  if (opts.windowRefine === true) {
    refineSequentialWindows(posts, distItems, seq, warnings, opts);
  }

  // Merge in non-sequential inferred edges (keep sequential array shape stable).
  const seenPair = new Set(
    seq.map((d) => `${Math.min(d.from, d.to)}->${Math.max(d.from, d.to)}`),
  );
  const merged = [...seq];
  for (const e of inferred) {
    const a = Math.min(e.from, e.to);
    const b = Math.max(e.from, e.to);
    const k = `${a}->${b}`;
    if (seenPair.has(k)) continue;
    merged.push({ ...e, source: "inferred-label" });
    seenPair.add(k);
  }

  applyJumpbackDistanceCleanup(posts, distItems, merged, warnings, opts);

  // Apply manual overrides last (debug / project-specific fixes).
  // Format: { "10->11": 37.3, "11->12": 24.2 }
  if (opts.overrides && typeof opts.overrides === "object") {
    let applied = 0;
    for (const [k, v] of Object.entries(opts.overrides)) {
      const m = typeof v === "number" ? v : parseFloat(String(v));
      if (!Number.isFinite(m) || m <= 0) continue;
      const mm = k.match(/^\s*(\d+)\s*->\s*(\d+)\s*$/);
      if (!mm) continue;
      const from = parseInt(mm[1], 10);
      const to = parseInt(mm[2], 10);
      for (const d of merged) {
        if (
          (d.from === from && d.to === to) ||
          (d.from === to && d.to === from)
        ) {
          d.meters = m;
          d.source = "override";
        }
      }
      applied++;
    }
    if (applied)
      warnings.push(`[distance-assoc] Applied ${applied} manual override(s).`);
  }

  return { distances: merged, warnings };
}

/**
 * @param {Array<{ number: number, x: number, y: number, pageNum?: number, anchorX?: number, anchorY?: number }>} posts
 * @param {Array<{ str: string, x: number, y: number, pageNum?: number, width?: number }>} distItems
 * @param {Array<{ from: number, to: number, meters: number|null, source?: string }>} seq
 * @param {string[]} warnings
 * @param {{ scaleFactor?: number, detailScaleFactor?: number, perPageScale?: (pageNum: number) => number|null }} opts
 */
function refineSequentialWindows(posts, distItems, seq, warnings, opts) {
  const sortedPosts = [...posts].sort((a, b) => a.number - b.number);
  const postByNum = new Map(sortedPosts.map((p) => [p.number, p]));
  const overviewSf = opts.scaleFactor ?? null;
  const perPageScale = opts.perPageScale ?? null;

  const getDetailSf = (pageNum) => {
    const pageSf =
      perPageScale && pageNum != null ? perPageScale(pageNum) : null;
    return (
      pageSf ??
      opts.detailScaleFactor ??
      (overviewSf != null ? overviewSf * OVERVIEW_TO_DETAIL_SCALE : null)
    );
  };

  const scoreLabelToSeg = (dt, from, to) => {
    const meters = parseDistanceMeters(dt.str);
    if (meters == null) return null;

    const samePage =
      from.pageNum != null && to.pageNum != null && from.pageNum === to.pageNum;
    const crossPage = !samePage && from.pageNum != null && to.pageNum != null;
    const labelPage = dt.pageNum ?? null;
    if (samePage && labelPage != null && labelPage !== from.pageNum)
      return null;
    if (crossPage && labelPage != null && labelPage !== to.pageNum) return null;

    const w = typeof dt.width === "number" && dt.width > 0 ? dt.width : 0;
    const lx = w > 0 ? dt.x + w * 0.5 : dt.x;
    const ly = dt.y;

    const gap = labelGapToSegment(lx, ly, from, to, crossPage, sortedPosts);
    if (gap > 90) return null;

    const a = { x: from.anchorX ?? from.x, y: from.anchorY ?? from.y };
    const b = { x: to.anchorX ?? to.x, y: to.anchorY ?? to.y };
    const pdfPt = Math.hypot(b.x - a.x, b.y - a.y);
    let ratioPenalty = 0;
    const detailSf = !crossPage ? getDetailSf(from.pageNum ?? null) : null;
    if (!crossPage && detailSf != null && meters > 0 && pdfPt > 0) {
      const pdfM = pdfPt * detailSf;
      const ratio = pdfM / meters;
      const labelOnChord = gap < 55;
      if ((ratio < 0.35 || ratio > 2.5) && !labelOnChord) return null;
      ratioPenalty = 35 * Math.abs(Math.log(ratio));
    }
    const score = gap + ratioPenalty;
    if (score > 120) return null;
    return { meters, score };
  };

  const suppressedKeys = opts.suppressedKeys ?? new Set();
  const labelFitSlack = opts.jumpbackRefine ? 12 : Infinity;

  for (let i = 0; i < seq.length - 2; i++) {
    const segs = [seq[i], seq[i + 1], seq[i + 2]];
    const segPosts = segs.map((s) => ({
      from: postByNum.get(s.from),
      to: postByNum.get(s.to),
    }));
    if (segPosts.some((x) => !x.from || !x.to)) continue;

    if (opts.jumpbackRefine) {
      const relevant = segs.some((s) => {
        const k = `${Math.min(s.from, s.to)}->${Math.max(s.from, s.to)}`;
        return s.meters == null || suppressedKeys.has(k);
      });
      if (!relevant) continue;
    }

    // Collect candidate labels near any of the 3 segments.
    /** @type {Array<{ idx: number, meters: number, scores: number[] }>} */
    const labels = [];
    for (let li = 0; li < distItems.length; li++) {
      const dt = distItems[li];
      const meters = parseDistanceMeters(dt.str);
      if (meters == null) continue;
      const scores = [];
      let any = false;
      for (let si = 0; si < 3; si++) {
        const sp = segPosts[si];
        const sc = scoreLabelToSeg(dt, sp.from, sp.to);
        if (sc) {
          scores[si] = sc.score;
          any = true;
        } else {
          scores[si] = Infinity;
        }
      }
      if (any) labels.push({ idx: li, meters, scores });
    }
    if (labels.length < 2) continue;

    // Current window cost (only for segments that currently have meters).
    const currentMeters = segs.map((s) => s.meters);
    let currentCost = 0;
    let currentCount = 0;
    for (let si = 0; si < 3; si++) {
      if (currentMeters[si] == null) continue;
      // Approximate current cost by best label with same meters (if any), else large.
      let best = Infinity;
      for (const l of labels) {
        if (Math.abs(l.meters - currentMeters[si]) < 0.05)
          best = Math.min(best, l.scores[si]);
      }
      if (Number.isFinite(best)) currentCost += best;
      else currentCost += 200;
      currentCount++;
    }

    // Best injective assignment for up to 3 labels → 3 segs.
    // Brute-force because window is tiny.
    let bestAssign = null;
    let bestCost = Infinity;
    let bestCount = -1;
    const L = labels.length;
    for (let a = 0; a < L; a++) {
      for (let b = 0; b < L; b++) {
        if (b === a) continue;
        for (let c = 0; c < L; c++) {
          if (c === a || c === b) continue;
          const pick = [labels[a], labels[b], labels[c]];
          let cost = 0;
          let count = 0;
          for (let si = 0; si < 3; si++) {
            const segKey = `${Math.min(segs[si].from, segs[si].to)}->${Math.max(segs[si].from, segs[si].to)}`;
            if (suppressedKeys.has(segKey)) continue;
            const l = pick[si];
            const sc = l.scores[si];
            if (!Number.isFinite(sc)) continue;
            const minSc = Math.min(l.scores[0], l.scores[1], l.scores[2]);
            if (sc > minSc + labelFitSlack) continue;
            cost += sc;
            count++;
          }
          if (count === 0) continue;
          if (count > bestCount || (count === bestCount && cost < bestCost)) {
            bestCount = count;
            bestCost = cost;
            bestAssign = pick;
          }
        }
      }
    }
    if (!bestAssign) continue;

    // Apply only if it improves: more segments covered, or equal coverage but lower cost.
    const improves =
      bestCount > currentCount ||
      (bestCount === currentCount && bestCost + 1e-6 < currentCost);
    if (!improves) continue;

    for (let si = 0; si < 3; si++) {
      const seg = segs[si];
      const segKey = `${Math.min(seg.from, seg.to)}->${Math.max(seg.from, seg.to)}`;
      if (suppressedKeys.has(segKey)) continue;
      if (seg.source === "jumpback-shift") continue;
      if (
        seg.source === "bifurcation-main" ||
        seg.source === "bifurcation-tap" ||
        seg.source === "bifurcation-cleared"
      ) {
        continue;
      }

      const l = bestAssign[si];
      if (!Number.isFinite(l.scores[si])) continue;
      const minSc = Math.min(l.scores[0], l.scores[1], l.scores[2]);
      if (l.scores[si] > minSc + labelFitSlack) continue;
      const prev = seq[i + si].meters;
      seq[i + si].meters = l.meters;
      seq[i + si].source = "window-refine";
      if (prev != null && Math.abs(prev - l.meters) > 0.05) {
        warnings.push(
          `[distance-assoc] Window refine changed ${seq[i + si].from}->${seq[i + si].to}: ${prev} → ${l.meters}`,
        );
      }
    }
  }
}

/**
 * Parse a distance label string (Brazilian comma decimals).
 * @returns {number|null}
 */
function parseDistanceMeters(str) {
  const normalized = str.trim().replace(/\s+/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const meters = parseFloat(normalized);
  return Number.isFinite(meters) && meters > 0 ? meters : null;
}

/**
 * Infer distance edges by pairing each label to the best matching post pair near it.
 *
 * @param {Array<{ number: number, x: number, y: number, pageNum?: number, anchorX?: number, anchorY?: number }>} posts
 * @param {Array<{ str: string, x: number, y: number, pageNum?: number, width?: number }>} distItems
 * @param {string[]} warnings
 * @param {{ scaleFactor?: number, perPageScale?: (pageNum: number) => number|null }} [opts]
 * @returns {Array<{ from: number, to: number, meters: number }>}
 */
function inferDistanceEdgesFromLabels(posts, distItems, warnings, opts = {}) {
  /** @type {Array<{ from: number, to: number, meters: number }>} */
  const edges = [];
  if (!posts?.length || !distItems?.length) return edges;

  const sorted = [...posts].sort((a, b) => a.number - b.number);
  const byPage = new Map();
  for (const p of sorted) {
    const pn = p.pageNum ?? null;
    if (!byPage.has(pn)) byPage.set(pn, []);
    byPage.get(pn).push(p);
  }

  const pos = (p) => ({ x: p.anchorX ?? p.x, y: p.anchorY ?? p.y });

  // Tighter than legacy defaults — inferred non-sequential edges are easy to
  // hallucinate (any two posts whose chord happens to pass near a label become
  // candidates). The legacy sequential pass already consumes the "obvious"
  // labels; the inferred pass exists for genuine branch returns where a label
  // sits near a non-consecutive chord. So we restrict to the immediate
  // neighbourhood of the label (4 nearest posts) and a tight chord gap.
  const TOP_K_POSTS = 4;
  const MAX_LABEL_GAP_PT = 30;
  const MAX_SCORE = 80;
  const MAX_NUMBER_SPAN = 6; // reject inferred edges spanning too many sequential posts
  /** @type {Set<number>} */
  const excludedLabelIndices =
    opts.excludedLabelIndices instanceof Set
      ? opts.excludedLabelIndices
      : new Set();

  for (let li = 0; li < distItems.length; li++) {
    if (excludedLabelIndices.has(li)) continue;
    const it = distItems[li];
    const meters = parseDistanceMeters(it.str);
    if (meters == null) continue;

    const w = typeof it.width === "number" && it.width > 0 ? it.width : 0;
    const lx = w > 0 ? it.x + w * 0.5 : it.x;
    const ly = it.y;
    const labelPage = it.pageNum ?? null;

    const postsOnPage = byPage.get(labelPage) ?? sorted;
    if (!postsOnPage.length) continue;

    const nearest = postsOnPage
      .map((p) => {
        const pp = pos(p);
        return { p, d: Math.hypot(pp.x - lx, pp.y - ly) };
      })
      .sort((a, b) => a.d - b.d)
      .slice(0, TOP_K_POSTS)
      .map((x) => x.p);

    if (nearest.length < 2) continue;

    const pageSf =
      labelPage != null && opts.perPageScale
        ? opts.perPageScale(labelPage)
        : null;
    const sf = pageSf ?? opts.scaleFactor ?? null;

    let best = null;

    for (let i = 0; i < nearest.length; i++) {
      for (let j = i + 1; j < nearest.length; j++) {
        const a = nearest[i];
        const b = nearest[j];
        if (a.number === b.number) continue;

        const ap = pos(a);
        const bp = pos(b);
        const gap = distPointToSegment(lx, ly, ap.x, ap.y, bp.x, bp.y);
        if (gap > MAX_LABEL_GAP_PT) continue;

        // Require the label projection onto the chord to fall WITHIN the chord
        // (not at either endpoint). When the projection clamps to an endpoint,
        // the label is "beside" one of the posts and likely belongs to a
        // different segment that shares that post.
        const abx = bp.x - ap.x;
        const aby = bp.y - ap.y;
        const ab2 = abx * abx + aby * aby;
        if (ab2 < 1e-6) continue;
        const apx = lx - ap.x;
        const apy = ly - ap.y;
        const tProj = (apx * abx + apy * aby) / ab2;
        if (tProj < 0.1 || tProj > 0.9) continue;

        const pdfPt = Math.hypot(abx, aby);
        let ratioPenalty = 0;
        if (sf != null && meters > 0 && pdfPt > 0) {
          const pdfM = pdfPt * sf;
          const ratio = pdfM / meters;
          // Tighter ratio than legacy: inferred edges that don't roughly match
          // the chord length are almost certainly phantom pairings.
          if (ratio < 0.5 || ratio > 2.0) continue;
          ratioPenalty = 35 * Math.abs(Math.log(ratio));
        }

        const score = gap + ratioPenalty;
        if (score > MAX_SCORE) continue;

        if (!best || score < best.score) {
          best = { a, b, score };
        }
      }
    }

    if (!best) continue;

    const from = best.a.number;
    const to = best.b.number;
    const ia = sorted.findIndex((p) => p.number === from);
    const ib = sorted.findIndex((p) => p.number === to);
    // Sequential N→N+1 spans are assigned by associateSequentialMonotonic.
    if (ia !== -1 && ib !== -1 && Math.abs(ia - ib) === 1) continue;
    // Reject inferred edges that span too many sequential posts: most are
    // hallucinations from labels whose chord happens to cross the page.
    if (ia !== -1 && ib !== -1 && Math.abs(ia - ib) > MAX_NUMBER_SPAN) continue;

    // _li is the label index used; callers can dedupe against it.
    edges.push({ from, to, meters, _li: li });
  }

  // Deduplicate: keep only the lowest-meter label per pair if duplicates occur.
  // Track which labels (by index) "won" the dedup so callers can exclude them.
  /** @type {Map<string, { edge: { from: number, to: number, meters: number }, labelIdx: number }>} */
  const dedup = new Map();
  for (const e of edges) {
    const a = Math.min(e.from, e.to);
    const b = Math.max(e.from, e.to);
    const k = `${a}->${b}`;
    const prev = dedup.get(k);
    if (!prev || Math.abs(prev.edge.meters - e.meters) > 0.01) {
      // If multiple different meters exist, keep the smaller one (less likely to be a summed span).
      if (!prev || e.meters < prev.edge.meters)
        dedup.set(k, {
          edge: { from: e.from, to: e.to, meters: e.meters },
          labelIdx: e._li,
        });
    }
  }

  const out = [...dedup.values()].map((v) => v.edge);
  const usedLabelIndices = new Set(
    [...dedup.values()]
      .map((v) => v.labelIdx)
      .filter((i) => Number.isInteger(i)),
  );
  if (out.length > 0) {
    warnings.push(
      `[distance-assoc] Rich labels inferred: +${out.length} non-sequential edge(s) from Distância_Poste items.`,
    );
  }
  return { edges: out, usedLabelIndices };
}

/**
 * At a route bifurcation (junction → tap → main), re-home a main-line Distância_Poste
 * label from the tap leg (N+1→N+2) onto the junction leg (N→N+2) when the label sits
 * nearer the junction than the tap and fits the junction→main chord better than tap→main.
 * Uses label geometry only — not cable proximity (tap poles can sit near the cable).
 *
 * @param {Array<{ number: number, x: number, y: number, pageNum?: number, anchorX?: number, anchorY?: number }>} posts
 * @param {Array<{ str: string, x: number, y: number, pageNum?: number, width?: number }>} distItems
 * @param {Array<{ from: number, to: number, meters: number|null, source?: string }>} distances
 * @param {string[]} warnings
 */
export function applyBifurcationJunctionLabelRehome(
  posts,
  distItems,
  distances,
  warnings,
  cablesByPage = null,
) {
  if (!posts?.length || !distItems?.length || !distances?.length) return;

  const sorted = deduplicatePostsPreferLowerPage(posts).sort(
    (a, b) => a.number - b.number,
  );
  const pos = (p) => ({ x: p.anchorX ?? p.x, y: p.anchorY ?? p.y });
  const JUNCTION_CLOSER_RATIO = 0.9;
  const MAX_MAIN_CHORD_GAP_PT = 90;

  const findEdge = (from, to) =>
    distances.find(
      (d) =>
        (d.from === from && d.to === to) || (d.from === to && d.to === from),
    );

  const upsertEdge = (from, to, meters, source) => {
    let e = findEdge(from, to);
    if (!e) {
      e = { from, to, meters, source };
      distances.push(e);
      return;
    }
    e.from = from;
    e.to = to;
    e.meters = meters;
    e.source = source;
  };

  const clearEdge = (from, to, source) => {
    const e = findEdge(from, to);
    if (!e) return;
    e.meters = null;
    e.source = source;
  };

  /** Bifurcation tap must add meaningful detour vs junction→main chord. */
  const bifurcationDetourRatio = (junction, tap, mainNext) => {
    const jPos = pos(junction);
    const tPos = pos(tap);
    const mp = pos(mainNext);
    const jt = Math.hypot(tPos.x - jPos.x, tPos.y - jPos.y);
    const tm = Math.hypot(mp.x - tPos.x, mp.y - tPos.y);
    const jm = Math.hypot(mp.x - jPos.x, mp.y - jPos.y);
    if (jm < 1) return 1;
    return (jt + tm) / jm;
  };

  const findTapLegMeters = (
    junction,
    tap,
    mainNext,
    labelPages,
    excludeMeters = [],
    opts = {},
  ) => {
    const pageNum = junction.pageNum ?? 1;
    const tapPage = tap.pageNum ?? 1;
    const mainPage = mainNext.pageNum ?? 1;
    let tapLegM = null;
    let bestGap = Infinity;
    for (const it of distItems) {
      if (!labelPages.has(it.pageNum ?? 1)) continue;
      const m = parseDistanceMeters(it.str);
      if (m == null || m <= 0) continue;
      if (excludeMeters.some((x) => Math.abs(m - x) < 0.25)) continue;
      const w = typeof it.width === "number" && it.width > 0 ? it.width : 0;
      const lx = w > 0 ? it.x + w * 0.5 : it.x;
      const ly = it.y;
      const crossJT = tapPage !== (junction.pageNum ?? 1);
      const gJT = labelGapToSegment(lx, ly, junction, tap, crossJT, sorted);
      if (!opts.repairTapOnly && gJT >= MAX_MAIN_CHORD_GAP_PT) continue;
      if (opts.repairTapOnly) {
        const mainM = excludeMeters[0];
        if (mainM != null && (m >= mainM * 0.55 || m < mainM * 0.22)) continue;
        const target = mainM * 0.3;
        if (
          tapLegM == null ||
          Math.abs(m - target) < Math.abs(tapLegM - target)
        ) {
          tapLegM = m;
        }
        continue;
      }
      const crossJM = mainPage !== (junction.pageNum ?? 1);
      const gJM = labelGapToSegment(
        lx,
        ly,
        junction,
        mainNext,
        crossJM,
        sorted,
      );
      if (gJT < gJM - 2) {
        tapLegM = tapLegM == null ? m : Math.min(tapLegM, m);
      }
    }
    return tapLegM;
  };

  // Re-validate existing same-page bifurcation-main edges against the CURRENT
  // post coordinates. The bifurcation loop below creates edges using whatever
  // coordinates are current when it runs. The first pipeline invocation runs on
  // pre-calibration positions, where a tap post can land spuriously beside a
  // main-line distance label; the calibrated invocation then reveals the
  // junction is no longer the label-closer post. Drop any such artifact (and its
  // paired tap leg) so the natural sequential edges can be refilled. Same-page
  // only — cross-sheet bifurcations live in different page coordinate systems and
  // are validated by their own detector. Zero post-number / coordinate literals.
  //
  // KEPT (quick task 260602-lbl, GATED decision 4): the B3 rehome pass
  // (rehomeBranchArmLabels) now correctly places 27.7 on 36→46, but this
  // calibrated re-validation pass independently nulls *spurious* bifurcation-main
  // edges around posts 39–45. Disabling it (verified) regresses Siriu posts 39–45
  // (err up to 142 m). The two mechanisms are complementary, not redundant: the
  // rehome fixes a STOLEN arm; this pass drops a SPURIOUS pre-calibration tap
  // edge. Re-attempt simplification only if a future change makes the spurious
  // edge impossible upstream.
  for (const e of distances) {
    if (e.source !== "bifurcation-main" || e.meters == null) continue;
    const J = Math.min(e.from, e.to);
    const M = Math.max(e.from, e.to);
    if (M !== J + 2) continue;
    const junction = sorted.find((p) => p.number === J);
    const tap = sorted.find((p) => p.number === J + 1);
    const mainNext = sorted.find((p) => p.number === M);
    if (!junction || !tap || !mainNext) continue;
    const jPage = junction.pageNum ?? 1;
    if ((tap.pageNum ?? 1) !== jPage || (mainNext.pageNum ?? 1) !== jPage) {
      continue;
    }
    const jp = pos(junction);
    const tp = pos(tap);
    // Find the matching label most relevant to this junction/tap pair (closest to
    // either endpoint). The bifurcation is a pre-calibration artifact iff, on the
    // current coordinates, that label sits STRICTLY closer to the tap than to the
    // junction — meaning the label actually belongs to the tap's own segment, not
    // the junction→main chord. A junction and tap that calibrate onto (nearly) the
    // same point cannot satisfy a strict tap-closer test, so legitimate
    // branch-return bifurcations with co-located junction+tap are preserved.
    let bestRel = Infinity;
    let bestDJ = Infinity;
    let bestDT = Infinity;
    for (const it of distItems) {
      if ((it.pageNum ?? 1) !== jPage) continue;
      const m = parseDistanceMeters(it.str);
      if (m == null || Math.abs(m - e.meters) > 0.25) continue;
      const w = typeof it.width === "number" && it.width > 0 ? it.width : 0;
      const lx = w > 0 ? it.x + w * 0.5 : it.x;
      const ly = it.y;
      const dJ = Math.hypot(lx - jp.x, ly - jp.y);
      const dT = Math.hypot(lx - tp.x, ly - tp.y);
      const rel = Math.min(dJ, dT);
      if (rel < bestRel) {
        bestRel = rel;
        bestDJ = dJ;
        bestDT = dT;
      }
    }
    if (bestRel < Infinity && bestDT < bestDJ * JUNCTION_CLOSER_RATIO) {
      e.meters = null;
      e.source = "bifurcation-reverted";
      const tapLeg = findEdge(J, J + 1);
      if (tapLeg?.source === "bifurcation-tap") {
        tapLeg.meters = null;
        tapLeg.source = "bifurcation-reverted";
      }
      warnings.push(
        `[distance-assoc] Reverted bifurcation ${J}→${M}: label sits closer to tap ${J + 1} than junction on calibrated coords (pre-calibration artifact)`,
      );
    }
  }

  for (let i = 0; i < sorted.length - 2; i++) {
    const junction = sorted[i];
    const tap = sorted[i + 1];
    const mainNext = sorted[i + 2];
    if (
      tap.number !== junction.number + 1 ||
      mainNext.number !== tap.number + 1
    ) {
      continue;
    }
    const pageNum = junction.pageNum ?? 1;
    const tapPage = tap.pageNum ?? 1;
    const mainPage = mainNext.pageNum ?? 1;
    const pageSpread =
      Math.max(pageNum, tapPage, mainPage) -
      Math.min(pageNum, tapPage, mainPage);
    if (pageSpread > 1) continue;
    if (pageNum == null || tapPage == null || mainPage == null) continue;
    const labelPages = new Set([pageNum, tapPage, mainPage]);
    const spansSheets = labelPages.size > 1;

    const jp = pos(junction);
    const tp = pos(tap);

    const juncMainExisting = findEdge(junction.number, mainNext.number);
    if (
      juncMainExisting?.source === "bifurcation-main" &&
      juncMainExisting.meters != null &&
      juncMainExisting.meters > 0
    ) {
      const tapLegM = findTapLegMeters(
        junction,
        tap,
        mainNext,
        labelPages,
        [juncMainExisting.meters],
        { repairTapOnly: true },
      );
      if (tapLegM != null) {
        upsertEdge(junction.number, tap.number, tapLegM, "bifurcation-tap");
      }
      clearEdge(tap.number, mainNext.number, "bifurcation-cleared");
      continue;
    }

    if (
      !spansSheets &&
      bifurcationDetourRatio(junction, tap, mainNext) < 1.08
    ) {
      continue;
    }

    const tapMain = findEdge(tap.number, mainNext.number);

    if (tapMain?.meters != null && tapMain.meters > 0) {
      for (const it of distItems) {
        if (!labelPages.has(it.pageNum ?? 1)) continue;
        const meters = parseDistanceMeters(it.str);
        if (meters == null || Math.abs(meters - tapMain.meters) > 0.25)
          continue;
        const w = typeof it.width === "number" && it.width > 0 ? it.width : 0;
        const lx = w > 0 ? it.x + w * 0.5 : it.x;
        const ly = it.y;
        const dJunc = Math.hypot(lx - jp.x, ly - jp.y);
        const dTap = Math.hypot(lx - tp.x, ly - tp.y);
        if (!(dJunc < dTap * JUNCTION_CLOSER_RATIO)) continue;
        const gJuncMain = labelGapToSegment(
          lx,
          ly,
          junction,
          mainNext,
          mainPage !== pageNum,
          sorted,
        );
        const gJuncTap = labelGapToSegment(
          lx,
          ly,
          junction,
          tap,
          tapPage !== pageNum,
          sorted,
        );
        if (gJuncMain > MAX_MAIN_CHORD_GAP_PT || gJuncMain >= gJuncTap - 1)
          continue;

        upsertEdge(
          junction.number,
          mainNext.number,
          meters,
          "bifurcation-main",
        );
        clearEdge(tap.number, mainNext.number, "bifurcation-cleared");
        for (const d of distances) {
          if (d.meters == null || Math.abs(d.meters - meters) > 0.25) continue;
          const lo = Math.min(d.from, d.to);
          const hi = Math.max(d.from, d.to);
          if (
            lo === junction.number &&
            hi !== mainNext.number &&
            hi > tap.number
          ) {
            warnings.push(
              `[distance-assoc] Cleared ${d.from}→${d.to}: bifurcation label ${meters} m belongs on ${junction.number}→${mainNext.number}`,
            );
            d.meters = null;
            d.source = "bifurcation-cleared";
          }
        }
        const tapLegM = findTapLegMeters(
          junction,
          tap,
          mainNext,
          labelPages,
          [meters],
          spansSheets ? { repairTapOnly: true } : {},
        );
        if (tapLegM != null) {
          upsertEdge(junction.number, tap.number, tapLegM, "bifurcation-tap");
        }
        warnings.push(
          `[distance-assoc] Bifurcation at post ${junction.number}: label ${meters} m on ${junction.number}→${mainNext.number} (cleared ${tap.number}→${mainNext.number})`,
        );
        break;
      }
    }

    /** @type {{ meters: number, gJuncMain: number }|null} */
    let bestMain = null;

    for (const it of distItems) {
      if (!labelPages.has(it.pageNum ?? 1)) continue;
      const meters = parseDistanceMeters(it.str);
      if (meters == null || meters <= 0) continue;

      const w = typeof it.width === "number" && it.width > 0 ? it.width : 0;
      const lx = w > 0 ? it.x + w * 0.5 : it.x;
      const ly = it.y;

      const dJunc = Math.hypot(lx - jp.x, ly - jp.y);
      const dTap = Math.hypot(lx - tp.x, ly - tp.y);
      if (!(dJunc < dTap * JUNCTION_CLOSER_RATIO)) continue;

      const gJuncMain = labelGapToSegment(
        lx,
        ly,
        junction,
        mainNext,
        mainPage !== pageNum,
        sorted,
      );
      const gTapMain = labelGapToSegment(
        lx,
        ly,
        tap,
        mainNext,
        tapPage !== mainPage,
        sorted,
      );
      const gJuncTap = labelGapToSegment(
        lx,
        ly,
        junction,
        tap,
        tapPage !== pageNum,
        sorted,
      );
      if (gJuncMain > MAX_MAIN_CHORD_GAP_PT) continue;
      // Branch tap label (e.g. 10.5 on 36→37) sits on junction→tap, not junction→main.
      if (gJuncMain >= gJuncTap - 1) continue;
      if (gJuncMain > gTapMain + 2) continue;

      if (!bestMain || gJuncMain < bestMain.gJuncMain) {
        bestMain = { meters, gJuncMain };
      }
    }

    if (
      findEdge(junction.number, mainNext.number)?.source === "bifurcation-main"
    ) {
      continue;
    }

    if (!bestMain) continue;

    let hasTapLegLabel = false;
    let tapLegMeters = Infinity;
    for (const it of distItems) {
      if (!labelPages.has(it.pageNum ?? 1)) continue;
      const m = parseDistanceMeters(it.str);
      if (m == null || m <= 0 || Math.abs(m - bestMain.meters) < 0.25) continue;
      const w = typeof it.width === "number" && it.width > 0 ? it.width : 0;
      const lx = w > 0 ? it.x + w * 0.5 : it.x;
      const ly = it.y;
      const gJT = labelGapToSegment(
        lx,
        ly,
        junction,
        tap,
        tapPage !== pageNum,
        sorted,
      );
      const gJM = labelGapToSegment(
        lx,
        ly,
        junction,
        mainNext,
        mainPage !== pageNum,
        sorted,
      );
      if (gJT < gJM - 2 && gJT < MAX_MAIN_CHORD_GAP_PT) {
        hasTapLegLabel = true;
        tapLegMeters = Math.min(tapLegMeters, m);
      }
    }
    if (!hasTapLegLabel || !(tapLegMeters < Infinity)) continue;
    if (bestMain.meters < tapLegMeters * 1.35) continue;
    if (tapLegMeters >= bestMain.meters * 0.55) continue;

    if (tapMain?.meters == null || tapMain.meters <= 0) continue;
    let tapMainOnTap = false;
    for (const it of distItems) {
      if (!labelPages.has(it.pageNum ?? 1)) continue;
      const m = parseDistanceMeters(it.str);
      if (m == null || Math.abs(m - tapMain.meters) > 0.25) continue;
      const w = typeof it.width === "number" && it.width > 0 ? it.width : 0;
      const lx = w > 0 ? it.x + w * 0.5 : it.x;
      const ly = it.y;
      const dJ = Math.hypot(lx - jp.x, ly - jp.y);
      const dT = Math.hypot(lx - tp.x, ly - tp.y);
      if (dT < dJ * JUNCTION_CLOSER_RATIO) { tapMainOnTap = true; break; }
    }
    if (!tapMainOnTap) continue;

    const { meters } = bestMain;
    upsertEdge(junction.number, mainNext.number, meters, "bifurcation-main");
    clearEdge(tap.number, mainNext.number, "bifurcation-cleared");

    for (const d of distances) {
      if (d.meters == null || Math.abs(d.meters - meters) > 0.25) continue;
      const lo = Math.min(d.from, d.to);
      const hi = Math.max(d.from, d.to);
      if (lo === junction.number && hi !== mainNext.number && hi > tap.number) {
        warnings.push(
          `[distance-assoc] Cleared ${d.from}→${d.to}: bifurcation label ${meters} m belongs on ${junction.number}→${mainNext.number}`,
        );
        d.meters = null;
        d.source = "bifurcation-cleared";
      }
    }

    warnings.push(
      `[distance-assoc] Bifurcation at post ${junction.number}: label ${meters} m on ${junction.number}→${mainNext.number} (cleared ${tap.number}→${mainNext.number})`,
    );
  }

  // Sheet-break / pass-2: re-apply tap leg when main leg is already bifurcation-main.
  for (let i = 0; i < sorted.length - 2; i++) {
    const junction = sorted[i];
    const tap = sorted[i + 1];
    const mainNext = sorted[i + 2];
    if (
      tap.number !== junction.number + 1 ||
      mainNext.number !== tap.number + 1
    ) {
      continue;
    }
    const juncMain = findEdge(junction.number, mainNext.number);
    if (juncMain?.source !== "bifurcation-main" || juncMain.meters == null) {
      continue;
    }
    const pageNum = junction.pageNum ?? 1;
    const tapPage = tap.pageNum ?? 1;
    const mainPage = mainNext.pageNum ?? 1;
    const labelPages = new Set([pageNum, tapPage, mainPage]);
    const tapLegM = findTapLegMeters(
      junction,
      tap,
      mainNext,
      labelPages,
      [juncMain.meters],
      { repairTapOnly: true },
    );
    if (tapLegM != null) {
      upsertEdge(junction.number, tap.number, tapLegM, "bifurcation-tap");
    }
    clearEdge(tap.number, mainNext.number, "bifurcation-cleared");
  }

  // Sheet-break bifurcation (e.g. other routes): junction and main on one sheet,
  // tap on the adjacent sheet; main label nearer junction than tap.
  //
  // GATED-PARTIAL FAILING-GATE NOTE (quick task 260603-acc, Task A — 2026-06-03):
  // This block FALSELY fires on Luiz Carolino posts 2 and 10 (junction 2/10, tap
  // 3/11, main 4/12) where there is NO real bifurcation — post 3/11 is a genuine
  // consecutive post. It picks mainM=36.7/42.1 (largest near-junction label) and
  // tapM=12.7 (label nearest mainM*0.3), then NULLS the true consecutive 3→4 / 11→12
  // and corrupts 2→3 / 10→11 with the 12.7 stray. The documented branch-A fix (a
  // tap-leg corroboration guard at the `tapMain?.meters` acceptance ~L1539, which
  // cleanly rejected the LC false positives via findTapLegMeters==null while keeping
  // every genuine Siriu branch-A bifurcation) was implemented and verified, BUT it
  // merely UNMASKED this looser sheet-break detector, which then re-nulls 3→4/11→12
  // and propagates downstream — regressing the LC PDF gate (posts 4,5,24,25,27,31
  // over ceiling, e.g. post 31 461.9 m vs 218.7 m). So branch-A alone cannot ship.
  //
  // This sheet-break block CANNOT be tightened safely with available geometry: the
  // LC false positives are structurally indistinguishable from the GENUINE sheet-break
  // bifurcations at Siriu J=11/23/32/57 and João Born J=13. Every candidate features
  // (tap-off-chord ratio, mainM/tapM ratio, distinct-consecutive-label gap to the
  // tap→main chord, the strict findTapLegMeters value, edge source, page layout) was
  // diagnosed live (LC_BIF_DEBUG) and OVERLAPS between the LC false and Siriu genuine
  // classes — e.g. consecutive-label gap LC≈34-40 pt sits between Siriu J=57 (18.7)
  // and J=11 (56.4); chord-offset LC 0.13-0.15 between Siriu 0.064 and 0.238.
  // Tightening this block to reject LC regresses at least Siriu J=32/57 (legacy-midpoint
  // tap→main, same as LC) — the tight Siriu canary trips. The real prerequisite is a
  // route-independent JUNCTION signal (DWG region degree / cable-arm bifurcation
  // geometry, NOT a 2nd label heuristic) so a genuine sheet-break tap can be told from
  // a consecutive post — the same unlock noted in the 260602 memory. Until then this
  // block is KEPT (it is correct for Siriu/JB) and the LC 1-20 deformation stays GATED.
  for (let i = 0; i < sorted.length - 2; i++) {
    const junction = sorted[i];
    const tap = sorted[i + 1];
    const mainNext = sorted[i + 2];
    if (
      tap.number !== junction.number + 1 ||
      mainNext.number !== tap.number + 1
    ) {
      continue;
    }
    const pageNum = junction.pageNum ?? 1;
    const tapPage = tap.pageNum ?? 1;
    const mainPage = mainNext.pageNum ?? 1;
    if (pageNum == null || tapPage == null || mainPage == null) continue;
    const spread =
      Math.max(pageNum, tapPage, mainPage) -
      Math.min(pageNum, tapPage, mainPage);
    if (spread !== 1 || tapPage === mainPage) continue;

    const jp = pos(junction);
    const tp = pos(tap);
    const labelPages = new Set([pageNum, tapPage, mainPage]);
    /** @type {Array<{ m: number, dJunc: number }>} */
    const nearJunction = [];
    for (const it of distItems) {
      if (!labelPages.has(it.pageNum ?? 1)) continue;
      const m = parseDistanceMeters(it.str);
      if (m == null || m <= 0) continue;
      const w = typeof it.width === "number" && it.width > 0 ? it.width : 0;
      const lx = w > 0 ? it.x + w * 0.5 : it.x;
      const ly = it.y;
      const dJunc = Math.hypot(lx - jp.x, ly - jp.y);
      const dTap = Math.hypot(lx - tp.x, ly - tp.y);
      if (!(dJunc < dTap * JUNCTION_CLOSER_RATIO)) continue;
      nearJunction.push({ m, dJunc });
    }
    if (nearJunction.length < 2) continue;
    nearJunction.sort((a, b) => a.m - b.m);
    const mainM = nearJunction[nearJunction.length - 1].m;
    const tapTarget = mainM * 0.3;
    let tapM = nearJunction[0].m;
    for (const c of nearJunction) {
      if (Math.abs(c.m - tapTarget) < Math.abs(tapM - tapTarget)) tapM = c.m;
    }
    if (mainM < tapM * 2) continue;
    if (findEdge(junction.number, mainNext.number)?.source === "bifurcation-main") {
      const existing = findEdge(junction.number, mainNext.number)?.meters;
      if (existing != null && Math.abs(existing - mainM) > 0.5) continue;
    }
    upsertEdge(junction.number, mainNext.number, mainM, "bifurcation-main");
    clearEdge(tap.number, mainNext.number, "bifurcation-cleared");
    upsertEdge(junction.number, tap.number, tapM, "bifurcation-tap");
    warnings.push(
      `[distance-assoc] Sheet-break bifurcation at post ${junction.number}: ` +
        `${tapM} m → ${junction.number}→${tap.number}, ${mainM} m → ${junction.number}→${mainNext.number}`,
    );
  }

  // ── Generic branch-arm rehome (quick task 260602-lbl, locked decisions 2-3) ──
  // Fix the two label mis-association failure modes using the hybrid cable-arm
  // discriminator (classifyBranchArmLabel), so the label graph encodes TRUE
  // junctions instead of relying on downstream graph-walker post-number hacks.
  //
  //   (a) Same-page branch arm stolen by a consecutive pair: a label sits NEAR a
  //       junction and points (cable bearing + on-cable overlap) toward a
  //       NON-consecutive far post, yet was attached to a consecutive pair. Move
  //       it to junction→far and null the stolen consecutive edge.
  //   (b) Cross-page branch entry: the arm label is drawn on the far post's page,
  //       far from the junction; bridge it back to junction→far.
  //
  // Requires cablesByPage (only callers that thread it opt in). Pure geometry —
  // NO post-number literals; junctions/arms are discovered by degree + classifier.
  if (cablesByPage?.size) {
    rehomeBranchArmLabels(
      sorted,
      distItems,
      distances,
      cablesByPage,
      { findEdge, upsertEdge, clearEdge },
      warnings,
    );
  }

  // ── Generic dense-junction consecutive-label swap (quick task 260602-decouple,
  // pair 2) ──
  // At a dense junction J (label-graph degree ≥ 3), the legacy-midpoint pass can
  // SWAP the two consecutive labels just past the junction: the short tap stub
  // (J→J+1) lands on J+1→J+2 and the longer chord lands on J→J+1 (Siriu post 48:
  // 48→49=22.6 should be the 8.4 tap; 49→50 should be 22.6). Detect by chord
  // geometry: if label(m1) sits closer to the J+1→J+2 chord and label(m2) sits
  // closer to the J→J+1 chord, swap m1↔m2. Junction degree + label-to-chord gap
  // only — NO post-number literals. This lets the graph-walker drop its
  // dense-bifurcation swap handler.
  swapDenseJunctionConsecutiveLabels(
    sorted,
    distItems,
    distances,
    { findEdge },
    warnings,
  );

  // ── Generic equal-value-at-junction phantom dedup (quick task 260602-decouple,
  // pair 1) ──
  // The associator emits some phantom arms that DUPLICATE a real arm at a shared
  // junction endpoint with the SAME measured length (e.g. an [inferred-label]
  // 36→39=35.5 mirroring the authoritative [bifurcation-main] 36→38=35.5, or a
  // [legacy-midpoint] 59→60=31.7 stealing the value of the higher-tier 60→65=31.7).
  // These were previously KEPT and rejected at walk time by the graph-walker
  // (isPhantomBifurcationHint). We now null them AT SOURCE so the label graph
  // encodes only true junction arms and the walker can be generic.
  //
  // Rule: at any post P, if two incident edges carry the SAME meters (within a
  // tight tolerance) but different source tiers, drop the lower-tier edge. Tier
  // order (authoritative > inferred-label > legacy-midpoint) reflects how
  // trustworthy the source is. Pure source-tier + value equality — NO post-number
  // literals. The full Siriu gate (idx locks) + the forbidden-arm oracle guard
  // against over-removal of a real arm.
  //
  // When a dropped phantom was the ONLY distance hint reaching the spine post just
  // past the junction (e.g. 36→39 was the only hint to post 39 because the real
  // consecutive 38→39 was jumpback-suppressed), refill that consecutive step from
  // the nearest unassociated label on its chord so the walk can proceed without the
  // phantom. Geometry only — no post-number literals.
  dedupEqualValueAtJunction(distances, warnings, {
    sorted,
    distItems,
    findEdge,
  });
}

/**
 * Generic dense-junction consecutive-label swap (pair 2). At each junction J
 * (label-graph degree ≥ 3), the two consecutive edges J→J+1 (m1) and J+1→J+2 (m2)
 * may carry SWAPPED labels. Locate each value's source label item, measure its gap
 * to BOTH consecutive chords, and swap m1↔m2 when each label fits the OTHER chord
 * decisively better. Also nulls a non-consecutive [inferred-label] phantom that
 * duplicates a consecutive edge's value at the junction (e.g. 51→48=42.3 mirroring
 * 50→51=42.3). Junction degree + chord geometry only — no post-number literals.
 *
 * @param {Array} sorted
 * @param {Array} distItems
 * @param {Array} distances
 * @param {{findEdge:Function}} ops
 * @param {string[]} warnings
 */
function swapDenseJunctionConsecutiveLabels(
  sorted,
  distItems,
  distances,
  ops,
  warnings,
) {
  if (!sorted?.length || !distItems?.length || !distances?.length) return;
  const { findEdge } = ops;
  const byNum = new Map(sorted.map((p) => [p.number, p]));

  // Label-graph degree (non-null edges only).
  const degree = new Map();
  for (const d of distances) {
    if (d.meters == null || d.meters <= 0) continue;
    for (const [a, b] of [
      [d.from, d.to],
      [d.to, d.from],
    ]) {
      if (!degree.has(a)) degree.set(a, new Set());
      degree.get(a).add(b);
    }
  }

  // Find the label item whose value ≈ meters that sits NEAREST to a given chord.
  const labelOnChord = (meters, a, b) => {
    let best = null;
    let bestGap = Infinity;
    for (const it of distItems) {
      const m = parseDistanceMeters(it.str);
      if (m == null || Math.abs(m - meters) > 0.25) continue;
      const w = typeof it.width === "number" && it.width > 0 ? it.width : 0;
      const lx = w > 0 ? it.x + w * 0.5 : it.x;
      const ly = it.y;
      if ((it.pageNum ?? 1) !== (a.pageNum ?? 1)) continue;
      const gap = labelGapToSegment(lx, ly, a, b, false, sorted);
      if (gap < bestGap) {
        bestGap = gap;
        best = { lx, ly };
      }
    }
    return best ? { ...best, gap: bestGap } : null;
  };

  let swaps = 0;
  for (const j of sorted) {
    const J = j.number;
    if ((degree.get(J)?.size ?? 0) < 3) continue;
    const e1 = findEdge(J, J + 1); // J → J+1
    const e2 = findEdge(J + 1, J + 2); // J+1 → J+2
    if (!e1 || !e2 || e1.meters == null || e2.meters == null) continue;
    if (Math.abs(e1.meters - e2.meters) < 0.5) continue; // need distinct values.
    const pJ = byNum.get(J);
    const pJ1 = byNum.get(J + 1);
    const pJ2 = byNum.get(J + 2);
    if (!pJ || !pJ1 || !pJ2) continue;
    if (
      (pJ.pageNum ?? 1) !== (pJ1.pageNum ?? 1) ||
      (pJ1.pageNum ?? 1) !== (pJ2.pageNum ?? 1)
    ) {
      continue; // same-page swap only.
    }
    // Where does each value's label actually sit relative to each chord?
    const m1OnChord1 = labelOnChord(e1.meters, pJ, pJ1); // m1 vs J→J+1
    const m1OnChord2 = labelOnChord(e1.meters, pJ1, pJ2); // m1 vs J+1→J+2
    const m2OnChord1 = labelOnChord(e2.meters, pJ, pJ1); // m2 vs J→J+1
    const m2OnChord2 = labelOnChord(e2.meters, pJ1, pJ2); // m2 vs J+1→J+2
    if (!m1OnChord1 || !m1OnChord2 || !m2OnChord1 || !m2OnChord2) continue;
    // Current assignment cost vs swapped assignment cost.
    const currentCost = m1OnChord1.gap + m2OnChord2.gap;
    const swappedCost = m1OnChord2.gap + m2OnChord1.gap;
    // GUARD: only act when, AFTER the swap, BOTH labels sit essentially ON their
    // new chords (small absolute gap). This excludes cross-cluster junctions where
    // J+2 is far away and chord geometry is meaningless (the relative improvement
    // there is large in absolute terms but neither label is actually on-chord).
    const ON_CHORD_MAX_PT = 45;
    if (
      m1OnChord2.gap > ON_CHORD_MAX_PT ||
      m2OnChord1.gap > ON_CHORD_MAX_PT
    ) {
      continue;
    }
    // Require a DECISIVE improvement to swap (avoid jitter).
    if (swappedCost + 12 < currentCost) {
      const tmp = e1.meters;
      e1.meters = e2.meters;
      e2.meters = tmp;
      e1.source = "dense-junction-swap";
      e2.source = "dense-junction-swap";
      swaps++;
      warnings.push(
        `[distance-assoc] Dense-junction label swap at ${J}: ` +
          `${J}→${J + 1}=${e1.meters} m, ${J + 1}→${J + 2}=${e2.meters} m ` +
          `(chord-gap ${currentCost.toFixed(1)}→${swappedCost.toFixed(1)} pt).`,
      );
    }
  }
  if (swaps > 0) {
    warnings.push(
      `[distance-assoc] Dense-junction swap fixed ${swaps} junction(s).`,
    );
  }
}

/** Source-tier rank for phantom dedup: higher = more authoritative. */
function distanceSourceTier(source) {
  switch (source) {
    case "override":
      return 4;
    case "bifurcation-main":
    case "bifurcation-tap":
    case "branch-arm-rehomed":
      return 3;
    case "inferred-label":
      return 2;
    case "legacy-midpoint":
      return 1;
    default:
      return 0;
  }
}

/**
 * Generic equal-value-at-junction phantom dedup. At each post, when two incident
 * non-null edges share the same meters (tight tolerance) but differ in source
 * tier, null the lower-tier duplicate. Removes phantom arms that merely mirror a
 * real arm's length at a shared junction (e.g. 36→39=35.5 vs 36→38=35.5;
 * 59→60=31.7 vs 60→65=31.7) without any post-number literals.
 *
 * @param {Array<{ from: number, to: number, meters: number|null, source?: string }>} distances
 * @param {string[]} warnings
 * @param {{ sorted?: Array, distItems?: Array, findEdge?: Function }} [ctx]
 */
function dedupEqualValueAtJunction(distances, warnings, ctx = {}) {
  const TOL = 0.25; // meters — labels are quantized to 0.1 m, so this is exact-ish.
  /** Posts that lost an incident phantom; used to refill an exposed spine step. */
  const droppedFarPosts = new Set();
  // Group incident, non-null edges by post endpoint.
  /** @type {Map<number, Array<object>>} */
  const incident = new Map();
  for (const e of distances) {
    if (e.meters == null || e.meters <= 0) continue;
    for (const p of [e.from, e.to]) {
      if (!incident.has(p)) incident.set(p, []);
      incident.get(p).push(e);
    }
  }
  let dropped = 0;
  const cleared = new Set();
  for (const [, edges] of incident) {
    for (let i = 0; i < edges.length; i++) {
      for (let j = i + 1; j < edges.length; j++) {
        const a = edges[i];
        const b = edges[j];
        if (a === b || a.meters == null || b.meters == null) continue;
        if (Math.abs(a.meters - b.meters) > TOL) continue;
        const ta = distanceSourceTier(a.source);
        const tb = distanceSourceTier(b.source);
        if (ta === tb) continue; // can't decide without literals — leave both.
        const lower = ta < tb ? a : b;
        const higher = ta < tb ? b : a;
        // SAFETY 1: only dedup when the SURVIVOR is AUTHORITATIVE (tier >= 3:
        // bifurcation-main/tap, branch-arm-rehomed, override). A lower-tier survivor
        // (inferred-label, legacy-midpoint, jumpback-*) is NOT trustworthy enough to
        // delete a competing arm — at stolen-arm junctions the consecutive edge is
        // itself the phantom (e.g. 59→60 vs the real long-span 60→65), so we must
        // not treat "consecutive" as authoritative. Only a genuinely authoritative
        // span (e.g. bifurcation-main 36→38=35.5) may delete its mirror (36→39).
        if (distanceSourceTier(higher.source) < 3) continue;
        // SAFETY 2: NEVER drop a CONSECUTIVE edge (|from−to| == 1). Consecutive
        // edges are the route spine; the phantoms we target are NON-consecutive
        // long-span mirrors. A rehomed/bifurcation arm that happens to share a
        // length with a real consecutive step (e.g. branch-arm-rehomed 60→69=31 vs
        // consecutive 68→69=31) must NOT delete the spine step.
        if (Math.abs(lower.from - lower.to) <= 1) continue;
        if (lower.meters == null) continue;
        const k = `${Math.min(lower.from, lower.to)}->${Math.max(lower.from, lower.to)}`;
        if (cleared.has(k)) continue;
        lower.meters = null;
        lower.source = "phantom-dedup-cleared";
        cleared.add(k);
        dropped++;
        droppedFarPosts.add(Math.max(lower.from, lower.to));
        warnings.push(
          `[distance-assoc] Dropped phantom arm ${lower.from}→${lower.to} ` +
            `(${higher.meters} m duplicate of ${higher.from}→${higher.to} ` +
            `[${higher.source}] at shared post; tier ${distanceSourceTier(lower.source)} < ${distanceSourceTier(higher.source)}).`,
        );
      }
    }
  }
  if (dropped > 0) {
    warnings.push(
      `[distance-assoc] Equal-value-at-junction dedup removed ${dropped} phantom arm(s).`,
    );
  }

  // ── Refill the spine step exposed by a phantom removal ──
  // Dropping a non-consecutive phantom (e.g. 36→39) can leave the spine post just
  // past the junction (39) with NO incident distance, because its real consecutive
  // predecessor edge (38→39) was jumpback-suppressed and the phantom was the only
  // remaining hint. The walk then dead-ends there. Recover the true consecutive
  // distance from the nearest unassociated label sitting on the (X−1)→X chord.
  // Generic — junction/segment geometry only, no post-number literals.
  const { sorted, distItems, findEdge } = ctx;
  if (!sorted?.length || !distItems?.length || typeof findEdge !== "function") {
    return;
  }
  const byNum = new Map(sorted.map((p) => [p.number, p]));
  // Which meters values are already attached to a non-null edge anywhere — avoid
  // re-using a label that genuinely belongs to another (existing) edge.
  const usedMeters = new Map();
  for (const d of distances) {
    if (d.meters == null || d.meters <= 0) continue;
    usedMeters.set(Math.round(d.meters * 10), (usedMeters.get(Math.round(d.meters * 10)) ?? 0) + 1);
  }
  let refilled = 0;
  for (const X of droppedFarPosts) {
    const prev = X - 1;
    const a = byNum.get(prev);
    const b = byNum.get(X);
    if (!a || !b) continue;
    // Only refill if the consecutive predecessor edge is currently null/missing.
    const consec = findEdge(prev, X);
    if (consec && consec.meters != null && consec.meters > 0) continue;
    const samePage = (a.pageNum ?? 1) === (b.pageNum ?? 1);
    if (!samePage) continue;
    // Find the nearest label sitting on the (prev → X) chord whose value is NOT
    // already consumed elsewhere on the route.
    let best = null;
    let bestGap = Infinity;
    for (const it of distItems) {
      const m = parseDistanceMeters(it.str);
      if (m == null || m <= 0) continue;
      const labelPage = it.pageNum ?? 1;
      if (labelPage !== (a.pageNum ?? 1)) continue;
      const w = typeof it.width === "number" && it.width > 0 ? it.width : 0;
      const lx = w > 0 ? it.x + w * 0.5 : it.x;
      const ly = it.y;
      const gap = labelGapToSegment(lx, ly, a, b, false, sorted);
      if (gap > 45) continue; // must lie essentially on the chord.
      // Skip a value already attached to an existing edge (don't double-count).
      if ((usedMeters.get(Math.round(m * 10)) ?? 0) > 0) continue;
      if (gap < bestGap) {
        bestGap = gap;
        best = { meters: m };
      }
    }
    if (!best) continue;
    if (consec) {
      consec.meters = best.meters;
      consec.source = "phantom-refill-consecutive";
    } else {
      distances.push({
        from: prev,
        to: X,
        meters: best.meters,
        source: "phantom-refill-consecutive",
      });
    }
    usedMeters.set(
      Math.round(best.meters * 10),
      (usedMeters.get(Math.round(best.meters * 10)) ?? 0) + 1,
    );
    refilled++;
    warnings.push(
      `[distance-assoc] Refilled consecutive spine step ${prev}→${X} = ${best.meters} m ` +
        `(exposed by phantom-arm removal; label on chord, gap ${bestGap.toFixed(1)} pt).`,
    );
  }
  if (refilled > 0) {
    warnings.push(
      `[distance-assoc] Phantom-refill recovered ${refilled} consecutive spine step(s).`,
    );
  }
}

/** Strong-match thresholds for the generic branch-arm rehome. */
const ARM_NEAR_JUNCTION_PT = 150;
const ARM_BEARING_STRONG_DEG = 12;
const ARM_ON_CABLE_STRONG_PT = 14;
const ARM_MIN_FAR_GAP = 2; // far post must be ≥2 numbers from the junction (non-consecutive)
const ARM_ON_ARM_CHORD_PT = 30; // label must lie essentially on the junction→far chord

/**
 * Re-home branch-arm distance labels onto their true junction→far-post arm.
 *
 * @param {Array} sorted Sorted, de-duplicated posts.
 * @param {Array} distItems Distância_Poste text items.
 * @param {Array} distances Mutable edge list (assoc output).
 * @param {Map<number, Array>} cablesByPage
 * @param {{findEdge:Function, upsertEdge:Function, clearEdge:Function}} edgeOps
 * @param {string[]} warnings
 */
function rehomeBranchArmLabels(
  sorted,
  distItems,
  distances,
  cablesByPage,
  edgeOps,
  warnings,
) {
  const { findEdge, upsertEdge, clearEdge } = edgeOps;
  const byNum = new Map(sorted.map((p) => [p.number, p]));

  // Build the current label-graph degree so we only act around real junctions.
  const degree = new Map();
  for (const d of distances) {
    if (d.meters == null) continue;
    for (const [a, b] of [
      [d.from, d.to],
      [d.to, d.from],
    ]) {
      if (!degree.has(a)) degree.set(a, new Set());
      degree.get(a).add(b);
    }
  }

  for (const it of distItems) {
    const meters = parseDistanceMeters(it.str);
    if (meters == null || meters <= 0) continue;
    const labelPage = it.pageNum ?? 1;
    const w = typeof it.width === "number" && it.width > 0 ? it.width : 0;
    const lx = w > 0 ? it.x + w * 0.5 : it.x;
    const ly = it.y;

    // This label's meters must currently be attached to a CONSECUTIVE pair
    // (hi === lo + 1). Otherwise it is not a "stolen by consecutive pair" case
    // and we leave it alone. We only ever rehome an existing consecutive edge.
    // Identify the consecutive edge (sharing this label's meters) that this label
    // was stolen by: the one whose chord the label sits closest to AND that is
    // adjacent to a degree-≥3 junction. The junction-adjacency restriction keeps
    // the rehome local and prevents hijacking an ordinary same-meters main-line
    // edge elsewhere on the route. Generic — no post-number literals.
    let stolen = null;
    let stolenChordGap = Infinity;
    for (const d of distances) {
      if (d.meters == null || Math.abs(d.meters - meters) > 0.25) continue;
      const lo = Math.min(d.from, d.to);
      const hi = Math.max(d.from, d.to);
      if (hi !== lo + 1) continue;
      const a = byNum.get(d.from);
      const b = byNum.get(d.to);
      if (!a || !b) continue;
      let nearJunction = false;
      for (const j of sorted) {
        if ((degree.get(j.number)?.size ?? 0) < 3) continue;
        if (Math.abs(j.number - lo) <= 9 || Math.abs(j.number - hi) <= 9) {
          nearJunction = true;
          break;
        }
      }
      if (!nearJunction) continue;
      const g = labelGapToSegment(lx, ly, a, b, false, sorted);
      if (g < stolenChordGap) {
        stolenChordGap = g;
        stolen = d;
      }
    }
    if (!stolen) continue;

    // Find the same-page junction this label sits NEAR (label-graph degree ≥ 3).
    let bestJ = null;
    let bestNear = Infinity;
    for (const j of sorted) {
      const deg = degree.get(j.number)?.size ?? 0;
      if (deg < 3) continue;
      if ((j.pageNum ?? 1) !== labelPage) continue;
      const jx = j.anchorX ?? j.x;
      const jy = j.anchorY ?? j.y;
      const near = Math.hypot(lx - jx, ly - jy);
      if (near < bestNear) {
        bestNear = near;
        bestJ = j;
      }
    }
    if (!bestJ || bestNear > ARM_NEAR_JUNCTION_PT) continue;

    // The stolen consecutive pair must itself sit near this junction (its lower
    // endpoint is the junction or an immediate main-line neighbour). This keeps
    // the rehome local to the bifurcation, never touching distant main edges.
    const stolenLo = Math.min(stolen.from, stolen.to);
    const stolenHi = Math.max(stolen.from, stolen.to);
    if (Math.abs(stolenLo - bestJ.number) > 12 && Math.abs(stolenHi - bestJ.number) > 12) {
      continue;
    }

    // Among the junction's plausible NON-consecutive far arms, pick the one whose
    // cable-arm bearing aligns strongly with the label and lies on a cable. The
    // far post must be one endpoint of the stolen consecutive pair (the arm points
    // to a post the consecutive heuristic grabbed) OR adjacent to it.
    // The far post must be exactly one endpoint of the stolen consecutive pair:
    // the arm points to a post that the consecutive heuristic grabbed (e.g.
    // 70→74 stolen as 74→75 ⇒ far is 74; 60→69 stolen as 68→69 ⇒ far is 69).
    // Restricting to the stolen endpoints prevents inventing new far posts.
    const farCandidates = new Set([stolenLo, stolenHi]);
    let bestFar = null;
    let bestCls = null;
    for (const num of farCandidates) {
      const far = byNum.get(num);
      if (!far || far.number === bestJ.number) continue;
      if (Math.abs(far.number - bestJ.number) < ARM_MIN_FAR_GAP) continue;
      const cls = classifyBranchArmLabel(
        { x: lx, y: ly },
        labelPage,
        bestJ,
        far,
        cablesByPage,
      );
      if (cls.bearingAlignDeg > ARM_BEARING_STRONG_DEG) continue;
      if (cls.onCableGapPt > ARM_ON_CABLE_STRONG_PT) continue;
      // DECISIVE comparison: the junction→far arm must explain the label far
      // better than the stolen consecutive pair does. Compare the label's gap to
      // each chord; the arm must win by a clear margin, AND the label must sit
      // closer to the junction than to the stolen pair's own midpoint. This is
      // what separates a true branch arm from an ordinary consecutive segment
      // that merely happens to bend near a junction.
      const sFrom = byNum.get(stolen.from);
      const sTo = byNum.get(stolen.to);
      if (!sFrom || !sTo) continue;
      const gArm = labelGapToSegment(lx, ly, bestJ, far, false, sorted);
      const gPair = labelGapToSegment(lx, ly, sFrom, sTo, false, sorted);
      if (!(gArm < gPair - 8)) continue;
      // The label must lie essentially ON the junction→far arm chord (absolute
      // gap), not merely closer to it than to the stolen pair. This rejects a
      // label that sits near a junction but actually belongs to a consecutive
      // segment that only loosely points toward the far post.
      if (gArm > ARM_ON_ARM_CHORD_PT) continue;
      // The far post must NOT be the junction's own immediate inbound/outbound
      // consecutive neighbour reached via the stolen pair — i.e. the stolen pair
      // must not simply be the junction's consecutive main edge. (Generic: tests
      // adjacency between the junction and the stolen pair, no post literals.)
      if (stolenLo === bestJ.number || stolenHi === bestJ.number) continue;
      // Failure mode 2 is a FORWARD branch arm: the junction's arm points to a
      // higher-numbered non-consecutive post that the consecutive pair grabbed
      // (70→74 as 74→75, 36→46 as 45→46, 60→69 as 68→69). Inbound (lower-numbered)
      // arms are handled by the normal sequential association, so restrict the
      // rehome to forward arms to avoid stealing a legitimate consecutive label.
      if (far.number <= bestJ.number) continue;
      // The candidate junction must be the TRUE arm origin: no post numerically
      // between the junction and the far post may sit closer to the label than the
      // junction does. If one does (e.g. post 70 between 69 and 74 for a 38.7
      // label that truly belongs to 70→74), then THAT post is the real junction
      // and this candidate is wrong — skip. Generic geometry, no post literals.
      let occluded = false;
      for (let mid = bestJ.number + 1; mid < far.number; mid++) {
        const mp = byNum.get(mid);
        if (!mp || (mp.pageNum ?? 1) !== labelPage) continue;
        const dMid = Math.hypot(lx - (mp.anchorX ?? mp.x), ly - (mp.anchorY ?? mp.y));
        if (dMid < bestNear) {
          occluded = true;
          break;
        }
      }
      if (occluded) continue;
      if (!bestCls || cls.bearingAlignDeg < bestCls.bearingAlignDeg) {
        bestCls = cls;
        bestFar = far;
      }
    }
    if (!bestFar) continue;
    // Never rehome onto the already-correct consecutive edge.
    if (
      Math.min(bestJ.number, bestFar.number) === stolenLo &&
      Math.max(bestJ.number, bestFar.number) === stolenHi
    ) {
      continue;
    }

    const armEdge = findEdge(bestJ.number, bestFar.number);
    if (armEdge?.meters != null && Math.abs(armEdge.meters - meters) < 0.25) {
      continue; // already correctly placed
    }

    stolen.meters = null;
    stolen.source = "branch-arm-rehomed-cleared";
    upsertEdge(bestJ.number, bestFar.number, meters, "branch-arm-rehomed");
    warnings.push(
      `[distance-assoc] Branch-arm rehome: ${meters} m moved ${stolen.from}→${stolen.to} ⇒ ${bestJ.number}→${bestFar.number} (bearΔ=${bestCls.bearingAlignDeg.toFixed(0)}°, onCable=${bestCls.onCableGapPt.toFixed(0)}pt)`,
    );
  }
}

/**
 * Gap from label anchor to segment. Same-page: distance to chord A–B.
 * Cross-page: label is on the incoming sheet near the entry post (e.g. 33,7 beside
 * post 26). Use distance to the incoming post only — chord A–B crosses the whole
 * sheet and wrongly attracts mirrored labels at the outgoing edge (32,4 @ ~974).
 *
 * @param {Array} [_allPosts] Reserved for tests; unused.
 */
function labelGapToSegment(lx, ly, from, to, crossPage, _allPosts = []) {
  const ax = from.anchorX ?? from.x;
  const ay = from.anchorY ?? from.y;
  const bx = to.anchorX ?? to.x;
  const by = to.anchorY ?? to.y;
  if (!crossPage) {
    return distPointToSegment(lx, ly, ax, ay, bx, by);
  }
  return Math.hypot(lx - bx, ly - by);
}

/**
 * Second pass: assign orphan Distância_Poste labels beside auxiliary (off-cable) posts.
 * Runs after pole positions are stable (e.g. post cable-arc placer). No ratio guard;
 * only labels whose nearest segment is unassigned, or clearly closer to the gap segment
 * than to any segment that already has a label.
 *
 * @param {Array} posts Sorted or unsorted posts (flipY).
 * @param {Array} distItems Distância_Poste text items.
 * @param {Map<string, number>} distMap Existing segment lengths.
 * @param {Map<number, Array>} cablesByPage
 * @param {{ gapThresholdPt?: number, perPageScale?: (pageNum: number) => number|null, warnings?: string[] }} [opts]
 * @returns {{ map: Map<string, number>, filled: number }}
 */
export function supplementDistancesBesideAuxiliaryPosts(
  posts,
  distItems,
  distMap,
  cablesByPage,
  opts = {},
) {
  const map = new Map(distMap);
  let filled = 0;
  const GAP_PT = opts.gapThresholdPt ?? 52;
  const warnings = opts.warnings ?? [];

  if (!distItems?.length || !cablesByPage?.size) return { map, filled };

  const sorted = [...posts].sort((a, b) => a.number - b.number);
  const postByNum = new Map(sorted.map((p) => [p.number, p]));

  /** @type {Array<{ li: number, meters: number, bestIdx: number, bestGap: number, lx: number, ly: number }>} */
  const labelHits = [];

  for (let li = 0; li < distItems.length; li++) {
    const dt = distItems[li];
    const meters = parseDistanceMeters(dt.str);
    if (meters == null) continue;

    const labelPage = dt.pageNum ?? null;
    const w = typeof dt.width === "number" && dt.width > 0 ? dt.width : 0;
    const lx = w > 0 ? dt.x + w * 0.5 : dt.x;
    const ly = dt.y;

    let bestIdx = -1;
    let bestGap = Infinity;
    for (let i = 0; i < sorted.length - 1; i++) {
      const from = sorted[i];
      const to = sorted[i + 1];
      const samePage =
        from.pageNum != null &&
        to.pageNum != null &&
        from.pageNum === to.pageNum;
      const crossPage = !samePage && from.pageNum != null && to.pageNum != null;
      if (samePage && labelPage != null && labelPage !== from.pageNum) continue;
      if (crossPage && labelPage != null && labelPage !== to.pageNum) continue;

      const gap = labelGapToSegment(lx, ly, from, to, crossPage, sorted);
      if (gap < bestGap) {
        bestGap = gap;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestGap < GAP_PT * 2) {
      labelHits.push({ li, meters, bestIdx, bestGap, lx, ly });
    }
  }

  const usedLabel = new Set();

  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i];
    const to = sorted[i + 1];
    const key = `${from.number}->${to.number}`;
    if (map.get(key) > 0) continue;
    if (
      from.pageNum == null ||
      to.pageNum == null ||
      from.pageNum !== to.pageNum
    ) {
      continue;
    }

    const off =
      isOffRouteCablePost(from, postByNum, cablesByPage) ||
      isOffRouteCablePost(to, postByNum, cablesByPage);
    if (!off) continue;

    let pick = null;
    for (const hit of labelHits) {
      if (usedLabel.has(hit.li)) continue;

      const gapToSeg = labelGapToSegment(
        hit.lx,
        hit.ly,
        from,
        to,
        false,
        sorted,
      );
      if (gapToSeg > GAP_PT) continue;

      let nearestAssignedGap = Infinity;
      for (let j = 0; j < sorted.length - 1; j++) {
        const fj = sorted[j];
        const tj = sorted[j + 1];
        const kj = `${fj.number}->${tj.number}`;
        if (!(map.get(kj) > 0)) continue;
        const g = labelGapToSegment(hit.lx, hit.ly, fj, tj, false, sorted);
        nearestAssignedGap = Math.min(nearestAssignedGap, g);
      }
      if (nearestAssignedGap < gapToSeg * 0.88) continue;

      if (!pick || gapToSeg < pick.gapToSeg) {
        pick = { ...hit, gapToSeg };
      }
    }

    if (!pick) continue;

    map.set(key, pick.meters);
    map.set(`${to.number}->${from.number}`, pick.meters);
    usedLabel.add(pick.li);
    filled++;
    warnings.push(
      `[distance-assoc] Orphan label ${pick.meters} m assigned to posts ${from.number}→${to.number} (auxiliary gap).`,
    );
  }

  return { map, filled };
}

/** @param {Map<number, Set<number>>} labelDegree */
function isTopologyJunctionCandidate(postNum, labelDegree, topologyNeighbors) {
  const labelDeg = labelDegree.get(postNum)?.size ?? 0;
  const topoN = topologyNeighbors?.get(postNum);
  const topoDeg = topoN?.size ?? 0;
  if (Math.max(labelDeg, topoDeg) >= 3) return true;
  if (topoDeg >= 2 && labelDeg >= 2 && topoN) {
    for (const nb of topoN) {
      if (Math.abs(nb - postNum) > 1) return true;
    }
  }
  return false;
}

const TOPOLOGY_REHOME_ON_CHORD_PT = 45;
const MIN_CROSS_PAGE_ARM_GAP = 15;
/** Prior-sheet junction search window behind the cross-page bridge post (e.g. 80→81 ⇒ 62). */
const CROSS_PAGE_JUNCTION_LOOKBACK = MIN_CROSS_PAGE_ARM_GAP + 3;

/**
 * Refill a consecutive spine step exposed when a branch-arm label is moved off a
 * stolen consecutive edge. Mirrors phantom-refill but excludes the moved meters.
 */
function refillTopologyRehomeConsecutive(
  sorted,
  distItems,
  findEdge,
  upsertEdge,
  lo,
  hi,
  excludeMeters,
  warnings,
) {
  const byNum = new Map(sorted.map((p) => [p.number, p]));
  const a = byNum.get(lo);
  const b = byNum.get(hi);
  if (!a || !b) return false;
  const consec = findEdge(lo, hi);
  if (consec && consec.meters != null && consec.meters > 0) return false;

  const samePage = (a.pageNum ?? 1) === (b.pageNum ?? 1);
  const crossPage = !samePage && a.pageNum != null && b.pageNum != null;
  let best = null;
  let bestGap = Infinity;
  for (const it of distItems) {
    const m = parseDistanceMeters(it.str);
    if (m == null || m <= 0) continue;
    if (excludeMeters.some((x) => Math.abs(m - x) < 0.25)) continue;
    const labelPage = it.pageNum ?? 1;
    const w = typeof it.width === "number" && it.width > 0 ? it.width : 0;
    const lx = w > 0 ? it.x + w * 0.5 : it.x;
    const ly = it.y;
    let gap = Infinity;
    if (samePage) {
      if (labelPage !== (a.pageNum ?? 1)) continue;
      gap = labelGapToSegment(lx, ly, a, b, false, sorted);
    } else if (crossPage) {
      const gapLo =
        labelPage === (a.pageNum ?? 1)
          ? Math.hypot(lx - (a.anchorX ?? a.x), ly - (a.anchorY ?? a.y))
          : Infinity;
      const gapHi =
        labelPage === (b.pageNum ?? 1)
          ? labelGapToSegment(lx, ly, a, b, true, sorted)
          : Infinity;
      gap = Math.min(gapLo, gapHi);
    } else {
      continue;
    }
    if (gap > TOPOLOGY_REHOME_ON_CHORD_PT) continue;
    if (gap < bestGap) {
      bestGap = gap;
      best = { meters: m };
    }
  }
  if (!best) return false;
  upsertEdge(lo, hi, best.meters, "topology-refill-consecutive");
  warnings.push(
    `[distance-assoc] Topology rehome refill: ${lo}→${hi} = ${best.meters} m ` +
      `(exposed by branch-arm move; label gap ${bestGap.toFixed(1)} pt).`,
  );
  return true;
}

/**
 * DWG-only pass: re-home branch-arm labels using cable-topology from the paired
 * region. Fixes hidden junctions (label-graph degree undercounts) and cross-page
 * branch-entry labels before the graph walk. Does not alter the PDF associator path.
 */
export function applyTopologyBranchArmRehome(
  posts,
  distItems,
  distances,
  warnings,
  cablesByPage = null,
  rehomeOpts = {},
) {
  if (!posts?.length || !distItems?.length || !distances?.length) return;
  const topologyNeighbors = rehomeOpts.topologyNeighborsByPost ?? null;
  if (!topologyNeighbors?.size) return;

  const sorted = deduplicatePostsPreferLowerPage(posts).sort(
    (a, b) => a.number - b.number,
  );
  const byNum = new Map(sorted.map((p) => [p.number, p]));

  const findEdge = (from, to) =>
    distances.find(
      (d) =>
        (d.from === from && d.to === to) || (d.from === to && d.to === from),
    );
  const upsertEdge = (from, to, meters, source) => {
    let e = findEdge(from, to);
    if (!e) {
      distances.push({ from, to, meters, source });
      return;
    }
    e.from = from;
    e.to = to;
    e.meters = meters;
    e.source = source;
  };

  const labelDegree = new Map();
  for (const d of distances) {
    if (d.meters == null) continue;
    for (const [a, b] of [
      [d.from, d.to],
      [d.to, d.from],
    ]) {
      if (!labelDegree.has(a)) labelDegree.set(a, new Set());
      labelDegree.get(a).add(b);
    }
  }

  /** @type {Set<string>} */
  const rehomedStolenKeys = new Set();

  for (const it of distItems) {
    const meters = parseDistanceMeters(it.str);
    if (meters == null || meters <= 0) continue;
    const labelPage = it.pageNum ?? 1;
    const w = typeof it.width === "number" && it.width > 0 ? it.width : 0;
    const lx = w > 0 ? it.x + w * 0.5 : it.x;
    const ly = it.y;

    let stolen = null;
    let stolenChordGap = Infinity;
    for (const d of distances) {
      if (d.meters == null || Math.abs(d.meters - meters) > 0.25) continue;
      const lo = Math.min(d.from, d.to);
      const hi = Math.max(d.from, d.to);
      if (hi !== lo + 1) continue;
      const a = byNum.get(d.from);
      const b = byNum.get(d.to);
      if (!a || !b) continue;
      const samePage = (a.pageNum ?? 1) === (b.pageNum ?? 1);
      const crossPage = !samePage && a.pageNum != null && b.pageNum != null;
      if (samePage && labelPage !== (a.pageNum ?? 1)) continue;
      if (crossPage && labelPage !== (b.pageNum ?? 1)) continue;
      const g = labelGapToSegment(lx, ly, a, b, crossPage, sorted);
      if (g < stolenChordGap) {
        stolenChordGap = g;
        stolen = d;
      }
    }
    if (!stolen || stolenChordGap > ARM_NEAR_JUNCTION_PT * 1.5) continue;
    const stolenLo = Math.min(stolen.from, stolen.to);
    const stolenHi = Math.max(stolen.from, stolen.to);
    const stolenKey = `${stolenLo}->${stolenHi}`;
    if (rehomedStolenKeys.has(stolenKey)) continue;

    const armEdge = findEdge(stolenLo, stolenHi);
    if (
      armEdge?.source === "branch-arm-rehomed-cross-page" ||
      armEdge?.source === "branch-arm-rehomed-topology"
    ) {
      continue;
    }

    // Another junction already owns this label value on a non-consecutive arm.
    const alreadyOnArm = distances.some((d) => {
      if (d.meters == null || Math.abs(d.meters - meters) > 0.25) return false;
      const lo = Math.min(d.from, d.to);
      const hi = Math.max(d.from, d.to);
      if (hi === lo + 1) return false;
      if (lo === stolenLo && hi === stolenHi) return false;
      return (
        d.source === "branch-arm-rehomed" ||
        d.source === "branch-arm-rehomed-cross-page" ||
        d.source === "branch-arm-rehomed-topology"
      );
    });
    if (alreadyOnArm) continue;

    const sFrom = byNum.get(stolen.from);
    const sTo = byNum.get(stolen.to);
    if (!sFrom || !sTo) continue;
    const stolenCrossPage =
      (sFrom.pageNum ?? 1) !== (sTo.pageNum ?? 1) &&
      sFrom.pageNum != null &&
      sTo.pageNum != null;
    // Cross-page stolen labels sit on the incoming sheet near the route post (to).
    const anchorPage = stolenCrossPage
      ? (sTo.pageNum ?? labelPage)
      : labelPage;

    /** @type {{ j: object, farNum: number, source: string, score: number } | null} */
    let match = null;

    // ── Same-page: cable topology confirms junction→far (e.g. 70→74) ──
    for (const j of sorted) {
      if ((j.pageNum ?? 1) !== anchorPage) continue;
      if (j.number === stolenLo || j.number === stolenHi) continue;
      if (!isTopologyJunctionCandidate(j.number, labelDegree, topologyNeighbors)) {
        continue;
      }
      const topoN = topologyNeighbors.get(j.number);
      if (!topoN?.size) continue;

      for (const farNum of [stolenLo, stolenHi]) {
        if (farNum <= j.number || Math.abs(farNum - j.number) <= 1) continue;
        if (!topoN.has(farNum)) continue;
        const far = byNum.get(farNum);
        if (!far) continue;

        const nearJ = Math.hypot(lx - (j.anchorX ?? j.x), ly - (j.anchorY ?? j.y));
        const nearFar = Math.hypot(
          lx - (far.anchorX ?? far.x),
          ly - (far.anchorY ?? far.y),
        );
        if (Math.min(nearJ, nearFar) > ARM_NEAR_JUNCTION_PT) continue;

        const gArm = labelGapToSegment(lx, ly, j, far, false, sorted);
        const gPair = labelGapToSegment(lx, ly, sFrom, sTo, false, sorted);
        if (!(gArm < gPair - 8)) continue;
        if (gArm > ARM_ON_ARM_CHORD_PT) continue;

        const existing = findEdge(j.number, farNum);
        if (existing?.meters != null && Math.abs(existing.meters - meters) < 0.25) {
          continue;
        }

        let bearingAlignDeg = 0;
        if (cablesByPage?.size) {
          const cls = classifyBranchArmLabel(
            { x: lx, y: ly },
            anchorPage,
            j,
            far,
            cablesByPage,
          );
          if (cls.bearingAlignDeg > ARM_BEARING_STRONG_DEG) continue;
          if (cls.onCableGapPt > ARM_ON_CABLE_STRONG_PT) continue;
          bearingAlignDeg = cls.bearingAlignDeg;
        }

        const score = gArm + bearingAlignDeg;
        if (!match || score < match.score) {
          match = {
            j,
            farNum,
            source: "branch-arm-rehomed-topology",
            score,
          };
        }
      }
    }

    // ── Cross-page branch entry (e.g. 40.6 beside post 81 → junction 62→81) ──
    if (!match && stolenCrossPage) {
      const entryPost = stolenHi;
      const entry = byNum.get(entryPost);
      const entryPage = entry?.pageNum ?? labelPage;
      if (!entry || entryPage !== labelPage) continue;

      const nearEntry = Math.hypot(
        lx - (entry.anchorX ?? entry.x),
        ly - (entry.anchorY ?? entry.y),
      );
      if (nearEntry > ARM_NEAR_JUNCTION_PT) continue;

      const priorPage = entryPage - 1;
      const stolenOnPrior =
        (byNum.get(stolenLo)?.pageNum ?? 1) === priorPage;
      if (!stolenOnPrior) continue;

      const junctionLo = Math.max(1, stolenLo - CROSS_PAGE_JUNCTION_LOOKBACK);
      let bestJ = null;
      let bestArmGap = -1;
      for (const j of sorted) {
        if ((j.pageNum ?? 1) !== priorPage) continue;
        if (j.number === stolenLo || j.number === entryPost) continue;
        if (j.number < junctionLo || j.number >= stolenLo) continue;
        if ((labelDegree.get(j.number)?.size ?? 0) < 2) continue;
        const armGap = entryPost - j.number;
        if (armGap < MIN_CROSS_PAGE_ARM_GAP) continue;
        // Cross-page labels sit on the entry sheet near the route post; prior-sheet
        // junction→entry arms cannot be compared via chord gap (different pages).
        // Prefer the farthest prior-sheet junction in the bridge window (62 not 66).
        if (!bestJ || armGap > bestArmGap) {
          bestArmGap = armGap;
          bestJ = j;
        }
      }
      if (bestJ) {
        const far = entry;
        const existing = findEdge(bestJ.number, entryPost);
        if (
          !existing?.meters ||
          Math.abs(existing.meters - meters) >= 0.25
        ) {
          match = {
            j: bestJ,
            farNum: entryPost,
            source: "branch-arm-rehomed-cross-page",
            score: nearEntry,
          };
        }
      }
    }

    if (!match) continue;

    if (match.source === "branch-arm-rehomed-cross-page") {
      upsertEdge(match.j.number, match.farNum, meters, match.source);
      labelDegree.set(match.j.number, labelDegree.get(match.j.number) ?? new Set());
      labelDegree.get(match.j.number).add(match.farNum);
      warnings.push(
        `[distance-assoc] Topology cross-page branch arm: ${meters} m ⇒ ${match.j.number}→${match.farNum} ` +
          `(stolen ${stolenLo}→${stolenHi} kept for walk)`,
      );
      continue;
    }

    stolen.meters = null;
    stolen.source = "topology-rehome-cleared";
    upsertEdge(match.j.number, match.farNum, meters, match.source);
    refillTopologyRehomeConsecutive(
      sorted,
      distItems,
      findEdge,
      upsertEdge,
      stolenLo,
      stolenHi,
      [meters],
      warnings,
    );
    rehomedStolenKeys.add(stolenKey);
    labelDegree.set(match.j.number, labelDegree.get(match.j.number) ?? new Set());
    labelDegree.get(match.j.number).add(match.farNum);
    warnings.push(
      `[distance-assoc] Topology branch-arm rehome: ${meters} m ⇒ ${match.j.number}→${match.farNum} ` +
        `(cleared stolen ${stolenLo}→${stolenHi})`,
    );
  }
}
