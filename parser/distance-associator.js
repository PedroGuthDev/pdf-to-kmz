// parser/distance-associator.js
// Associates inter-post distances from the Distância_Poste layer to sequential
// post pairs by finding the nearest distance label to each pair's midpoint.
//
// Named ESM exports only — no default export, no CommonJS require.

import { isOffRouteCablePost } from './cable-builder.js';

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

  const pdfPos = (p) => ({
    x: p.anchorX ?? p.x,
    y: p.anchorY ?? p.y,
  });

  /** @type {Array<{ segIdx: number, labelKey: string, score: number, meters: number }>} */
  const candidates = [];

  for (let i = 0; i < sortedPosts.length - 1; i++) {
    const from = sortedPosts[i];
    const to = sortedPosts[i + 1];
    const a = pdfPos(from);
    const b = pdfPos(to);
    const samePage =
      from.pageNum != null &&
      to.pageNum != null &&
      from.pageNum === to.pageNum;
    const crossPage = !samePage && from.pageNum != null && to.pageNum != null;
    const pdfPt = Math.hypot(b.x - a.x, b.y - a.y);

    for (let li = 0; li < distItems.length; li++) {
      const dt = distItems[li];
      const normalized = dt.str.trim().replace(/\s+/g, '').replace(',', '.');
      if (!/^\d+(\.\d+)?$/.test(normalized)) continue;

      const labelPage = dt.pageNum ?? null;
      if (samePage && labelPage != null && labelPage !== from.pageNum) continue;
      if (crossPage && labelPage != null && labelPage !== to.pageNum) continue;

      const w = typeof dt.width === 'number' && dt.width > 0 ? dt.width : 0;
      const lx = w > 0 ? dt.x + w * 0.5 : dt.x;
      const ly = dt.y;

      let gap;
      if (crossPage) {
        gap = Math.hypot(lx - b.x, ly - b.y);
      } else {
        gap = distPointToSegment(lx, ly, a.x, a.y, b.x, b.y);
      }

      const meters = parseFloat(normalized);
      let ratioPenalty = 0;
      const pageSf =
        !crossPage && from.pageNum != null && opts.perPageScale
          ? opts.perPageScale(from.pageNum)
          : null;
      const detailSf =
        pageSf ??
        opts.detailScaleFactor ??
        (overviewSf != null ? overviewSf * (303.6 / 1191) : null);
      if (!crossPage && detailSf != null && meters > 0 && pdfPt > 0) {
        const pdfM = pdfPt * detailSf;
        const ratio = pdfM / meters;
        if (ratio < 0.35 || ratio > 2.5) continue;
        ratioPenalty = 35 * Math.abs(Math.log(ratio));
      }

      const labelKey = `${li}:${normalized}:${lx.toFixed(1)},${ly.toFixed(1)}`;
      candidates.push({
        segIdx: i,
        labelKey,
        score: gap + ratioPenalty,
        meters,
      });
    }
  }

  candidates.sort((a, b) => a.score - b.score);

  const assignedSeg = new Set();
  const assignedLabel = new Set();
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
  }

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    if (pair.meters == null) {
      warnings.push(
        `No distance label found between posts ${pair.from} and ${pair.to}`
      );
    }
    distances.push(pair);
  }

  return { distances, warnings };
}

/**
 * Parse a distance label string (Brazilian comma decimals).
 * @returns {number|null}
 */
function parseDistanceMeters(str) {
  const normalized = str.trim().replace(/\s+/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const meters = parseFloat(normalized);
  return Number.isFinite(meters) && meters > 0 ? meters : null;
}

/**
 * Gap from label anchor to segment (same-page); cross-page uses distance to "to" post.
 */
function labelGapToSegment(lx, ly, from, to, crossPage) {
  const ax = from.anchorX ?? from.x;
  const ay = from.anchorY ?? from.y;
  const bx = to.anchorX ?? to.x;
  const by = to.anchorY ?? to.y;
  if (crossPage) return Math.hypot(lx - bx, ly - by);
  return distPointToSegment(lx, ly, ax, ay, bx, by);
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
    const w = typeof dt.width === 'number' && dt.width > 0 ? dt.width : 0;
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

      const gap = labelGapToSegment(lx, ly, from, to, crossPage);
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
    if (from.pageNum == null || to.pageNum == null || from.pageNum !== to.pageNum) {
      continue;
    }

    const off =
      isOffRouteCablePost(from, postByNum, cablesByPage) ||
      isOffRouteCablePost(to, postByNum, cablesByPage);
    if (!off) continue;

    let pick = null;
    for (const hit of labelHits) {
      if (usedLabel.has(hit.li)) continue;

      const gapToSeg = labelGapToSegment(hit.lx, hit.ly, from, to, false);
      if (gapToSeg > GAP_PT) continue;

      let nearestAssignedGap = Infinity;
      for (let j = 0; j < sorted.length - 1; j++) {
        const fj = sorted[j];
        const tj = sorted[j + 1];
        const kj = `${fj.number}->${tj.number}`;
        if (!(map.get(kj) > 0)) continue;
        const g = labelGapToSegment(hit.lx, hit.ly, fj, tj, false);
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
