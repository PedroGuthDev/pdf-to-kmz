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

import { isOffRouteCablePost } from "./cable-builder.js";
import { deduplicatePostsPreferLowerPage } from "./post-assembler.js";

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
