// parser/coordinate-calculator.js
/** Bumped when multi-sheet calibration pipeline changes (shown in UI compare debug). */
export const CALC_PIPELINE_ID = "2026-05-corridor-nudge+detail-clamp";
// GPS coordinate calculation from PDF positions using per-page UTM-grid calibration (D-REV-01).
// Replaces sequential GPS chaining — each post's GPS is projected directly from its page's
// independently-calibrated UTM transform. No error accumulation between posts.
//
// Named ESM exports only — no default export, no CommonJS require.

import {
  computeScaleFactor,
  buildPageTransforms,
  gpsAtPostViaLabelWalk,
  lockPageOriginAtGps,
  projectPost,
  haversineMeters,
  gpsBearing,
  latLonToUtm,
  utmToLatLon,
  destinationPoint,
} from "./geo/utm-calibrator.js";
import {
  nearestPointOnCablesOnPage,
  buildCablesByPage,
  cableSegmentBearingDeg,
  cableExitBearingAtPost,
  bearingForDistanceLabelChain,
  isOffRouteCablePost,
  OFF_CABLE_FOR_LABEL_CHAIN_PT,
} from "./cable-builder.js";
import { placePostsOnCableByArcLength } from "./geo/cable-arc-placer.js";
import { supplementDistancesBesideAuxiliaryPosts } from "./distance-associator.js";
import { attachMarkerAnchors } from "./post-positioning.js";
import { deduplicatePostsPreferLowerPage } from "./post-assembler.js";
import {
  augmentCrossPageDistances,
  fillAdjacentMissingDistances,
  snapOffCableAuxiliaryPostsByLabelBracket,
  snapBifurcationTapPostsByLabelBracket,
  snapRoutePostsPdfByLabelBracket,
  refineGpsPastAuxiliaryPostsOnAnchorPage,
  refineAnchorPageByDownstreamChord,
  refineAnchorPageBySplitRegion,
  refineAnchorPageByDistortionZoneBias,
  refineAnchorPagePdfByLabelBracket,
  refinePageOriginsByLabelLsq,
  labelDistanceRmse,
} from "./geo/label-lsq-calibrator.js";
import { adjustPageOriginsByCableSimilarity } from "./geo/cable-boundary-calibrator.js";
import { applyGridAffineToTransforms } from "./geo/grid-affine-calibrator.js";
import {
  clampGpsToRouteCableCorridor,
  refineGpsAtSheetBreakCorridor,
  refineGpsToPdfRouteCorridor,
} from "./geo/route-corridor.js";
import {
  buildOverviewCompositeTransform,
  remapPostsToOverviewViaUtm,
} from "./geo/overview-composite.js";
import {
  detectSequenceFlipPages,
  flipBearingDeg,
} from "./geo/route-sequence.js";

const SEGMENT_SNAP_MAX_PT = 100;

/**
 * Lock sheet-break page origins from the previous page's UTM-projected last post +
 * in-page exit bearing + cross-page label (no cumulative walk from post #1).
 *
 * @returns {number} pages adjusted
 */
function lockPageOriginsAtSheetBreaksFromPriorProjection(
  transforms,
  sortedPosts,
  distMap,
  warnings,
) {
  if (transforms.size < 2 || !sortedPosts?.length || !distMap?.size) return 0;

  const sorted = [...sortedPosts].sort((a, b) => a.number - b.number);
  const pdfBearing = (from, to) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  };

  let adjusted = 0;

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (
      prev.pageNum == null ||
      curr.pageNum == null ||
      prev.pageNum === curr.pageNum
    ) {
      continue;
    }

    const prevTf = transforms.get(prev.pageNum);
    if (!prevTf || !transforms.has(curr.pageNum)) continue;

    const m =
      distMap.get(`${prev.number}->${curr.number}`) ??
      distMap.get(`${curr.number}->${prev.number}`);
    if (m == null || m <= 0) continue;

    const prevPrev = sorted[i - 2];
    let bearing;
    if (prevPrev && prevPrev.pageNum === prev.pageNum) {
      bearing = pdfBearing(prevPrev, prev);
    } else {
      const next = sorted[i + 1];
      if (!next || next.pageNum !== curr.pageNum) continue;
      bearing = pdfBearing(prev, next);
    }

    const gpsPrev = projectPost(prev.x, prev.y, prevTf);
    const gpsCurr = destinationPoint(gpsPrev.lat, gpsPrev.lon, bearing, m);

    if (
      lockPageOriginAtGps(
        transforms,
        curr.pageNum,
        curr.x,
        curr.y,
        gpsCurr.lat,
        gpsCurr.lon,
      )
    ) {
      adjusted++;
    }
  }

  if (adjusted > 0) {
    warnings.push(
      `[boundary-locked] ${adjusted} page origin(s) at sheet breaks from prior-page UTM exit bearing + label (not post-1 walk).`,
    );
  }
  return adjusted;
}

/**
 * After label GPS chain, re-lock sheet-break page origins using chained lat/lon at the
 * outgoing post (e.g. post 25 → lock page 5 at post 26).
 *
 * @returns {Set<number>} page numbers re-locked
 */
function lockSheetBreaksFromChainedGps(transforms, sorted, distMap, warnings) {
  /** @type {Set<number>} */
  const relockedPages = new Set();
  if (transforms.size < 2 || !sorted?.length || !distMap?.size)
    return relockedPages;

  const pdfBearing = (from, to) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  };

  let adjusted = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (
      prev.pageNum == null ||
      curr.pageNum == null ||
      prev.pageNum === curr.pageNum ||
      prev.lat == null ||
      curr.lat == null
    ) {
      continue;
    }

    const m =
      distMap.get(`${prev.number}->${curr.number}`) ??
      distMap.get(`${curr.number}->${prev.number}`);
    if (m == null || m <= 0) continue;

    const prevPrev = sorted[i - 2];
    let bearing;
    if (prevPrev && prevPrev.pageNum === prev.pageNum) {
      bearing = pdfBearing(prevPrev, prev);
    } else {
      const next = sorted[i + 1];
      if (!next || next.pageNum !== curr.pageNum) continue;
      bearing = pdfBearing(prev, next);
    }

    const gpsCurr = destinationPoint(prev.lat, prev.lon, bearing, m);
    if (
      lockPageOriginAtGps(
        transforms,
        curr.pageNum,
        curr.x,
        curr.y,
        gpsCurr.lat,
        gpsCurr.lon,
      )
    ) {
      adjusted++;
      relockedPages.add(curr.pageNum);
    }
  }

  if (adjusted > 0) {
    warnings.push(
      `[boundary-locked] ${adjusted} page origin(s) re-aligned after label chain at sheet breaks.`,
    );
  }
  return relockedPages;
}

/**
 * Re-lock the first cross-page sheet break using chained lat/lon on the outgoing post.
 *
 * @returns {number|null} page number re-locked, or null
 */
function lockFirstSheetBreakFromChainedGps(
  transforms,
  sorted,
  distMap,
  warnings,
) {
  const pdfBearing = (from, to) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  };

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (
      prev.pageNum == null ||
      curr.pageNum == null ||
      prev.pageNum === curr.pageNum ||
      prev.lat == null ||
      curr.lat == null
    ) {
      continue;
    }

    const m =
      distMap.get(`${prev.number}->${curr.number}`) ??
      distMap.get(`${curr.number}->${prev.number}`);
    if (m == null || m <= 0) continue;

    const prevPrev = sorted[i - 2];
    let bearing;
    if (prevPrev && prevPrev.pageNum === prev.pageNum) {
      bearing = pdfBearing(prevPrev, prev);
    } else {
      const next = sorted[i + 1];
      if (!next || next.pageNum !== curr.pageNum) continue;
      bearing = pdfBearing(prev, next);
    }

    const gpsCurr = destinationPoint(prev.lat, prev.lon, bearing, m);
    if (
      lockPageOriginAtGps(
        transforms,
        curr.pageNum,
        curr.x,
        curr.y,
        gpsCurr.lat,
        gpsCurr.lon,
      )
    ) {
      warnings.push(
        `[boundary-locked] page ${curr.pageNum} at post ${curr.number} from chained post ${prev.number} + label (first sheet break).`,
      );
      return curr.pageNum;
    }
    return null;
  }
  return null;
}

/**
 * Parse decimal-degree coordinate string (Google Maps paste support — D-13).
 * Accepts: "-27.645312, -48.671234" or "-27.645312 -48.671234"
 *
 * @param {string} input  Raw user input string.
 * @returns {{ lat: number, lon: number } | null}  Parsed coordinates or null if invalid.
 */
export function parseCoordinateInput(input) {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const hasComma = trimmed.includes(",");

  // Try comma-separated first, then space-separated
  let parts;
  if (hasComma) {
    parts = trimmed.split(",").map((s) => s.trim());
  } else {
    parts = trimmed.split(/\s+/);
  }

  if (parts.length !== 2) return null;

  // Validate each token as a strict signed decimal number.
  const DECIMAL_RE = /^-?\d+(\.\d+)?$/;
  if (!DECIMAL_RE.test(parts[0]) || !DECIMAL_RE.test(parts[1])) return null;

  const lat = parseFloat(parts[0]);
  const lon = parseFloat(parts[1]);

  if (isNaN(lat) || isNaN(lon)) return null;
  if (lat < -90 || lat > 90) return null;
  if (lon < -180 || lon > 180) return null;

  return { lat, lon };
}

/**
 * Brazil bounding-box validation (D-15).
 * Warns (does NOT reject) when coordinates fall outside approximate Brazil bounds.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {{ valid: boolean, message?: string }}
 */
export function validateBrazilBounds(lat, lon) {
  if (lat >= -34 && lat <= 5 && lon >= -74 && lon <= -35) {
    return { valid: true };
  }
  return {
    valid: false,
    message:
      "Coordenadas fora dos limites do Brasil (lat -34 a 5, lon -74 a -35)",
  };
}

/**
 * Detect route topology (main route vs branches) based on post numbering and spatial proximity.
 *
 * @param {Array<{ number: number, x: number, y: number }>} posts
 * @returns {{ mainRoute: number[], branches: Array<{ start: number, end: number, junctionPost: number|null }> }}
 */
export function detectRouteTopology(posts) {
  if (!posts || posts.length === 0) return { mainRoute: [], branches: [] };

  const sorted = [...posts].sort((a, b) => a.number - b.number);
  const mainRoute = [];
  const branches = [];

  let currentSequence = mainRoute;

  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    if (i === 0) {
      currentSequence.push(p.number);
      continue;
    }

    const prev = sorted[i - 1];

    // Check for a sequence gap
    if (p.number - prev.number > 1) {
      const dist = Math.hypot(p.x - prev.x, p.y - prev.y);
      // D-08: Branch boundary if spatially far apart (> 100pt). Otherwise it's an OCR miss.
      if (dist > 100) {
        const existingPosts = sorted.slice(0, i);
        let bestJunc = null;
        let minD = Infinity;
        // D-07: Junction is the nearest existing post in PDF space
        for (const ep of existingPosts) {
          const d = Math.hypot(ep.x - p.x, ep.y - p.y);
          if (d < minD) {
            minD = d;
            bestJunc = ep;
          }
        }
        const b = {
          start: p.number,
          end: p.number,
          junctionPost: bestJunc ? bestJunc.number : null,
          _posts: [],
        };
        branches.push(b);
        currentSequence = b._posts;
      }
    }

    currentSequence.push(p.number);
    if (currentSequence !== mainRoute) {
      branches[branches.length - 1].end = p.number;
    }
  }

  return {
    mainRoute,
    branches: branches.map((b) => ({
      start: b.start,
      end: b.end,
      junctionPost: b.junctionPost,
    })),
  };
}

/**
 * Detect gaps in the route where sequential posts lack a connecting cable.
 *
 * @param {Array<{ number: number, x: number, y: number, pageNum?: number }>} posts
 * @param {Array<{ from: number, to: number, meters: number|null }>} distances
 * @param {Array<{ ops: Array<{ x?: number, y?: number }>, pageNum?: number|null }>} cableSegments
 * @returns {Array<{ from: number, to: number }>}
 */
/**
 * Posts on technical / legend pages (no viewport box) cannot be projected. When the same
 * post number appears only on an uncalibrated page, interpolate PDF coords between calibrated
 * neighbors on the route (e.g. post 08 between 07 and 09 on page 4).
 *
 * @param {Array<{ number: number, x: number, y: number, pageNum?: number }>} posts
 * @param {Set<number>} calibratedPages
 * @param {string[]} warnings
 */
function repairPostsOnUncalibratedPages(posts, calibratedPages, warnings) {
  if (!calibratedPages.size) return;

  const byNum = new Map(posts.map((p) => [p.number, p]));
  const sortedNums = [...byNum.keys()].sort((a, b) => a - b);

  for (const num of sortedNums) {
    const post = byNum.get(num);
    const pg = post.pageNum ?? 1;
    if (calibratedPages.has(pg)) continue;

    const prev = byNum.get(num - 1);
    const next = byNum.get(num + 1);
    const prevOk = prev && calibratedPages.has(prev.pageNum ?? 0);
    const nextOk = next && calibratedPages.has(next.pageNum ?? 0);

    if (prevOk && nextOk && (prev.pageNum ?? 0) === (next.pageNum ?? 0)) {
      const targetPage = prev.pageNum;
      const span = next.number - prev.number;
      const t = span > 0 ? (num - prev.number) / span : 0.5;
      post.pageNum = targetPage;
      post.x = prev.x + (next.x - prev.x) * t;
      post.y = prev.y + (next.y - prev.y) * t;
      warnings.push(
        `[coordinate-calculator] Post ${num}: moved from uncalibrated page ${pg} to page ${targetPage} ` +
          `(interpolated PDF position between posts ${prev.number} and ${next.number}).`,
      );
      continue;
    }

    if (prevOk) {
      post.pageNum = prev.pageNum;
      warnings.push(
        `[coordinate-calculator] Post ${num}: reassigned from page ${pg} to calibrated page ${prev.pageNum} ` +
          `(PDF position unchanged — may be inaccurate).`,
      );
    } else if (nextOk) {
      post.pageNum = next.pageNum;
      warnings.push(
        `[coordinate-calculator] Post ${num}: reassigned from page ${pg} to calibrated page ${next.pageNum} ` +
          `(PDF position unchanged — may be inaccurate).`,
      );
    }
  }
}

/**
 * Refine projected GPS along the main route using Distância_Poste labels.
 * Bearings come from the UTM projection shape; segment lengths from PDF labels.
 * Post #1 stays at the user anchor. Requires most consecutive pairs to have labels.
 *
 * @param {Array<{ number: number, lat?: number|null, lon?: number|null }>} sorted
 * @param {Map<string, number|null>} distMap
 * @param {number} startLat
 * @param {number} startLon
 * @param {Set<number>} branchStarts
 * @returns {boolean}  true when chaining was applied
 */
function applyDistanceLabelGpsChain(
  sorted,
  distMap,
  startLat,
  startLon,
  branchStarts,
  opts = {},
) {
  const { cablesByPage, postByNum, multiSheetRoute, sequenceFlipPages } = opts;
  const utm = sorted.map((p) => ({ lat: p.lat, lon: p.lon }));
  let labeled = 0;
  let applied = 0;

  /** @type {Array<{ startIdx: number, endIdx: number }>} */
  const runs = [];
  let runStart = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const crossPage =
      prev.pageNum != null &&
      curr.pageNum != null &&
      prev.pageNum !== curr.pageNum;
    if (crossPage || branchStarts.has(curr.number)) {
      runs.push({ startIdx: runStart, endIdx: i - 1 });
      runStart = i;
    }
  }
  runs.push({ startIdx: runStart, endIdx: sorted.length - 1 });

  for (const { startIdx, endIdx } of runs) {
    if (endIdx <= startIdx) continue;

    const runPage = sorted[startIdx].pageNum;
    if (startIdx === 0 && runPage === sorted[endIdx].pageNum) {
      continue;
    }

    let lat;
    let lon;
    if (startIdx === 0) {
      lat = startLat;
      lon = startLon;
      sorted[0].lat = startLat;
      sorted[0].lon = startLon;
    } else {
      const prev = sorted[startIdx - 1];
      const first = sorted[startIdx];
      const crossBreak =
        prev.pageNum != null &&
        first.pageNum != null &&
        prev.pageNum !== first.pageNum;
      const mBreak =
        crossBreak &&
        (distMap.get(`${prev.number}->${first.number}`) ??
          distMap.get(`${first.number}->${prev.number}`));
      if (
        crossBreak &&
        mBreak != null &&
        mBreak > 0 &&
        utm[startIdx - 1].lat != null &&
        utm[startIdx - 1].lon != null
      ) {
        const bearing = bearingAtSheetBreakEntry(
          sorted,
          startIdx,
          cablesByPage,
        );
        const dest = destinationPoint(
          utm[startIdx - 1].lat,
          utm[startIdx - 1].lon,
          bearing,
          mBreak,
        );
        lat = dest.lat;
        lon = dest.lon;
        sorted[startIdx].lat = lat;
        sorted[startIdx].lon = lon;
        utm[startIdx] = { lat, lon };
        applied++;
      } else {
        const anchor = utm[startIdx];
        if (anchor.lat == null) continue;
        lat = anchor.lat;
        lon = anchor.lon;
        sorted[startIdx].lat = lat;
        sorted[startIdx].lon = lon;
      }
    }

    for (let i = startIdx + 1; i <= endIdx; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      // Chain bearing uses gpsBearing rather than cable tangent.
      const m = distMap.get(`${prev.number}->${curr.number}`);
      if (m == null || m <= 0 || utm[i - 1].lat == null || utm[i].lat == null) {
        lat = utm[i].lat;
        lon = utm[i].lon;
        sorted[i].lat = lat;
        sorted[i].lon = lon;
        continue;
      }
      labeled++;
      let bearing = null;
      if (cablesByPage && postByNum) {
        bearing =
          cableSegmentBearingDeg(prev, curr, cablesByPage) ??
          bearingForDistanceLabelChain(prev, curr, postByNum, cablesByPage);
        if (bearing == null && prev.pageNum !== curr.pageNum) {
          bearing = cableExitBearingAtPost(prev, cablesByPage);
        }
      }
      if (bearing == null) {
        bearing = gpsBearing(
          utm[i - 1].lat,
          utm[i - 1].lon,
          utm[i].lat,
          utm[i].lon,
        );
      }
      if (
        sequenceFlipPages?.has(curr.pageNum) &&
        prev.pageNum != null &&
        curr.pageNum === prev.pageNum
      ) {
        bearing = flipBearingDeg(bearing);
      }
      const next = destinationPoint(lat, lon, bearing, m);
      lat = next.lat;
      lon = next.lon;
      sorted[i].lat = lat;
      sorted[i].lon = lon;
      applied++;
    }
  }

  return labeled >= 3 && applied >= 3;
}

/**
 * Bearing along the route when entering a new detail sheet (exit direction on previous page).
 *
 * @param {Array} sorted
 * @param {number} startIdx first post index on the incoming page
 * @param {Map<number, Array>} [cablesByPage]
 */
function bearingAtSheetBreakEntry(sorted, startIdx, cablesByPage) {
  const prev = sorted[startIdx - 1];
  const first = sorted[startIdx];
  if (cablesByPage) {
    const exit = cableExitBearingAtPost(prev, cablesByPage);
    if (exit != null) return exit;
  }
  const prevPrev = startIdx >= 2 ? sorted[startIdx - 2] : null;
  if (
    prevPrev &&
    prevPrev.pageNum === prev.pageNum &&
    prevPrev.lat != null &&
    prev.lat != null
  ) {
    return gpsBearing(prevPrev.lat, prevPrev.lon, prev.lat, prev.lon);
  }
  const dx = first.x - prev.x;
  const dy = first.y - prev.y;
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

/**
 * Legacy: snap posts to Cabo_Projetado polyline vertices. Not used in calculateCoordinates();
 * pole positions come from the Poste layer in parsePdf().
 * One-to-one greedy assignment by ascending distance prevents two posts from snapping to the same vertex.
 * Mutates posts in-place. Posts with no pageNum or no nearby vertex are left at their OCR position.
 *
 * D-ACC-01, D-ACC-02, D-ACC-03, D-ACC-05.
 *
 * @param {Array<{ number: number, x: number, y: number, pageNum?: number }>} posts
 * @param {Array<{ ops: Array, pageNum?: number }>} cableSegments
 * @param {string[]} warnings
 * @param {number} [threshold=30]  Max PDF-pt distance for a snap to count.
 */
export function snapPostsToPolyline(
  posts,
  cableSegments,
  warnings,
  threshold = 30,
) {
  if (
    !posts ||
    posts.length === 0 ||
    !cableSegments ||
    cableSegments.length === 0
  )
    return;

  attachMarkerAnchors(posts);

  // Build vertex pool grouped by pageNum.
  // Each vertex: { x, y, pageNum, id: `${pageNum}:${flatIndex}` }
  /** @type {Map<number, Array<{ x: number, y: number, id: string }>>} */
  const verticesByPage = new Map();
  let flatIndex = 0;

  for (let si = 0; si < cableSegments.length; si++) {
    const seg = cableSegments[si];
    const pageNum = seg.pageNum;
    if (pageNum == null) {
      flatIndex++;
      continue;
    }

    if (!verticesByPage.has(pageNum)) verticesByPage.set(pageNum, []);
    const bucket = verticesByPage.get(pageNum);

    for (const op of seg.ops || []) {
      if (op.type === "M" || op.type === "L") {
        bucket.push({ x: op.x, y: op.y, id: `${pageNum}:${flatIndex}` });
        flatIndex++;
      } else if (op.type === "C") {
        // Only endpoint — bezier interior points are NOT vertices (D-ACC-01, T-02-05-04)
        bucket.push({ x: op.x3, y: op.y3, id: `${pageNum}:${flatIndex}` });
        flatIndex++;
      } else if (op.type === "C2") {
        bucket.push({ x: op.x2, y: op.y2, id: `${pageNum}:${flatIndex}` });
        flatIndex++;
      }
      // Z ops skipped
    }
  }

  // Build candidate edges: { postIdx, vertex, d }
  /** @type {Array<{ postIdx: number, vertex: { x, y, id }, d: number }>} */
  const candidates = [];

  for (let pi = 0; pi < posts.length; pi++) {
    const post = posts[pi];
    const pageNum = post.pageNum;
    if (pageNum == null) continue;

    const bucket = verticesByPage.get(pageNum);
    if (!bucket || bucket.length === 0) continue;

    for (const v of bucket) {
      const d = Math.hypot(v.x - post.x, v.y - post.y);
      if (d <= threshold) {
        candidates.push({ postIdx: pi, vertex: v, d });
      }
    }
  }

  // One-to-one greedy assignment (D-ACC-03) — ascending distance
  candidates.sort((a, b) => a.d - b.d);

  const usedPost = new Set();
  const usedVertex = new Set();

  for (const { postIdx, vertex } of candidates) {
    if (usedPost.has(postIdx) || usedVertex.has(vertex.id)) continue;
    posts[postIdx].x = vertex.x;
    posts[postIdx].y = vertex.y;
    usedPost.add(postIdx);
    usedVertex.add(vertex.id);
  }

  // Emit warnings for missed snaps (D-ACC-02 fallback)
  for (let pi = 0; pi < posts.length; pi++) {
    if (usedPost.has(pi)) continue; // successfully snapped — no warning

    const post = posts[pi];
    const pageNum = post.pageNum;
    if (pageNum == null) continue;

    const bucket = verticesByPage.get(pageNum);
    if (!bucket || bucket.length === 0) {
      warnings.push(
        `[coordinate-calculator] snap: post ${post.number} (page ${pageNum}) had no Cabo_Projetado vertices on its page — OCR position retained.`,
      );
      continue;
    }

    // Find nearest vertex distance for diagnostic
    let dMin = Infinity;
    for (const v of bucket) {
      const d = Math.hypot(v.x - post.x, v.y - post.y);
      if (d < dMin) dMin = d;
    }
    warnings.push(
      `[coordinate-calculator] snap: post ${post.number} (page ${pageNum}) kept OCR position — nearest cable vertex was ${dMin.toFixed(2)} pt away (> ${threshold} pt threshold).`,
    );
  }

  // Second pass: snap to nearest point ON polyline segments (not just vertices).
  const cablesByPage = new Map();
  for (const seg of cableSegments) {
    const pageNum = seg.pageNum;
    if (pageNum == null) continue;
    if (!cablesByPage.has(pageNum)) cablesByPage.set(pageNum, []);
    cablesByPage.get(pageNum).push(seg.ops);
  }

  for (let pi = 0; pi < posts.length; pi++) {
    if (usedPost.has(pi)) continue;
    const post = posts[pi];
    const pageNum = post.pageNum;
    if (pageNum == null) continue;
    const anchor = { x: post.anchorX ?? post.x, y: post.anchorY ?? post.y };
    const near = nearestPointOnCablesOnPage(
      anchor.x,
      anchor.y,
      pageNum,
      cablesByPage,
    );
    if (near.d > SEGMENT_SNAP_MAX_PT) continue;
    const move = Math.hypot(near.x - anchor.x, near.y - anchor.y);
    if (move > SEGMENT_SNAP_MAX_PT) continue;
    post.x = near.x;
    post.y = near.y;
    usedPost.add(pi);
  }
}

/**
 * Labeled length for a main-route hop that may skip off-cable (auxiliary) posts.
 *
 * @param {Array} sorted
 * @param {Map<string, number>} distMap
 * @param {number} i index of route post `from`
 * @param {number} j index of route post `to`
 * @returns {number|null}
 */
function metersForRouteHop(sorted, distMap, i, j) {
  const from = sorted[i];
  const to = sorted[j];
  const direct = distMap.get(`${from.number}->${to.number}`);
  if (direct != null && direct > 0) return direct;
  let sum = 0;
  let any = false;
  for (let k = i; k < j; k++) {
    const m = distMap.get(`${sorted[k].number}->${sorted[k + 1].number}`);
    if (m != null && m > 0) {
      sum += m;
      any = true;
    }
  }
  return any ? sum : null;
}

/** Tap leg after a bifurcation: junction→tap + junction→main labels, tap→main cleared. */
function isBifurcationTapLeg(fromNum, toNum, distMap) {
  if (toNum !== fromNum + 1) return false;
  const junction = fromNum - 1;
  if (junction < 1) return false;
  const mTap =
    distMap.get(`${junction}->${fromNum}`) ??
    distMap.get(`${fromNum}->${junction}`);
  const mMain =
    distMap.get(`${junction}->${toNum}`) ??
    distMap.get(`${toNum}->${junction}`);
  const mWrong =
    distMap.get(`${fromNum}->${toNum}`) ?? distMap.get(`${toNum}->${fromNum}`);
  return (
    mTap != null &&
    mTap > 0 &&
    mMain != null &&
    mMain > 0 &&
    (mWrong == null || mWrong <= 0)
  );
}

/** @param {Array<{ from: number, to: number, meters?: number|null, source?: string }>} distances */
function buildDistanceLookup(distances) {
  /** @type {Map<string, { from: number, to: number, meters?: number|null, source?: string }>} */
  const lookup = new Map();
  for (const d of distances ?? []) {
    lookup.set(`${d.from}->${d.to}`, d);
    lookup.set(`${d.to}->${d.from}`, d);
  }
  return lookup;
}

function isBlockedCableEdge(d) {
  return (
    d != null &&
    d.meters == null &&
    (d.source === "jumpback-suppressed" || d.source === "bifurcation-cleared")
  );
}

function hasActiveMeters(d) {
  return d != null && d.meters != null && d.meters > 0;
}

/**
 * Branch return: cable leaves junction lo→lo+1, runs through lo+1..hi-1, rejoins at hi.
 * The bogus sequential edge (hi-1)→hi is jumpback-suppressed.
 *
 * @param {Array<{ number: number }>} sorted
 * @param {Map<string, { from: number, to: number, meters?: number|null, source?: string }>} distLookup
 */
function findBranchReturns(sorted, distLookup) {
  /** @type {Map<number, { junction: number, rejoin: number, tip: number }>} */
  const byRejoin = new Map();

  for (const p of sorted) {
    const J = p.number;
    const tapEdge = distLookup.get(`${J}->${J + 1}`);
    if (!hasActiveMeters(tapEdge)) continue;

    for (const d of distLookup.values()) {
      const lo = Math.min(d.from, d.to);
      const hi = Math.max(d.from, d.to);
      if (lo !== J || hi <= J + 1) continue;
      if (!hasActiveMeters(d)) continue;
      if (d.source !== "inferred-label" && d.source !== "bifurcation-main")
        continue;
      const penult = distLookup.get(`${hi - 1}->${hi}`);
      if (!isBlockedCableEdge(penult)) continue;
      let chainOk = true;
      for (let n = J + 1; n < hi - 1; n++) {
        if (!hasActiveMeters(distLookup.get(`${n}->${n + 1}`))) {
          chainOk = false;
          break;
        }
      }
      if (!chainOk) continue;
      const existing = byRejoin.get(hi);
      if (!existing || J > existing.junction) {
        byRejoin.set(hi, { junction: J, rejoin: hi, tip: hi - 1 });
      }
      break;
    }
  }
  return [...byRejoin.values()];
}

/**
 * Non-consecutive inferred chord is redundant when every consecutive hop already
 * carries an active label (e.g. 4→6 while 4→5 and 5→6 exist).
 */
function isRedundantInferredChord(from, to, distLookup) {
  if (to - from <= 1) return false;
  const d = distLookup.get(`${from}->${to}`);
  if (!d || d.source !== "inferred-label") return false;
  for (let n = from; n < to; n++) {
    const step = distLookup.get(`${n}->${n + 1}`);
    if (!hasActiveMeters(step)) return false;
  }
  return true;
}

/**
 * @param {Array<{ from: number, to: number, meters?: number, bearing?: number, gap?: boolean, implied?: boolean, cross_page?: boolean }>} connections
 * @param {Array<{ number: number, x: number, y: number, pageNum?: number, lat?: number|null, lon?: number|null }>} sorted
 * @param {Map<number, { number: number, x: number, y: number, pageNum?: number, lat?: number|null, lon?: number|null }>} postMap
 * @param {Map<string, { from: number, to: number, meters?: number|null, source?: string }>} distLookup
 * @param {Map<string, number|null>} distMap
 * @param {number|null} scaleFactor
 * @param {(from: object, to: object) => number} pdfBearing
 */
function finalizeBifurcationConnections(
  connections,
  sorted,
  postMap,
  distLookup,
  distMap,
  scaleFactor,
  pdfBearing,
) {
  const connKey = (from, to) => `${from}->${to}`;
  const hasConn = new Set(connections.map((c) => connKey(c.from, c.to)));

  const makeConn = (fromNum, toNum, metersOverride = null, source = undefined) => {
    const from = postMap.get(fromNum);
    const to = postMap.get(toNum);
    if (!from || !to) return null;
    const isCrossPage =
      from.pageNum != null && to.pageNum != null && from.pageNum !== to.pageNum;
    let meters = metersOverride;
    if (meters == null) {
      meters =
        distMap.get(connKey(fromNum, toNum)) ??
        distMap.get(connKey(toNum, fromNum)) ??
        null;
    }
    if (meters == null && scaleFactor != null) {
      meters = Math.hypot(to.x - from.x, to.y - from.y) * scaleFactor;
    }
    let bearing = 0;
    if (isCrossPage && from.lat != null && to.lat != null) {
      bearing = gpsBearing(from.lat, from.lon, to.lat, to.lon);
    } else {
      bearing = pdfBearing(from, to);
    }
    return {
      from: fromNum,
      to: toNum,
      meters: meters ?? 0,
      bearing,
      gap: false,
      ...(isCrossPage ? { cross_page: true } : {}),
      ...(source ? { source } : {}),
    };
  };

  /** @type {Set<string>} */
  const dropKeys = new Set();
  for (const [key, d] of distLookup) {
    if (isBlockedCableEdge(d)) dropKeys.add(key);
    const [a, b] = key.split("->").map(Number);
    if (isRedundantInferredChord(a, b, distLookup)) dropKeys.add(key);
  }

  for (const br of findBranchReturns(sorted, distLookup)) {
    dropKeys.add(connKey(br.tip, br.rejoin));
    for (const d of distLookup.values()) {
      if (d.source !== "inferred-label" || !hasActiveMeters(d)) continue;
      const lo = Math.min(d.from, d.to);
      const hi = Math.max(d.from, d.to);
      if (lo < br.junction && hi === br.rejoin) {
        dropKeys.add(connKey(lo, hi));
      }
    }
    const main = makeConn(
      br.junction,
      br.rejoin,
      distMap.get(connKey(br.junction, br.rejoin)),
      "inferred-label",
    );
    if (main && !hasConn.has(connKey(br.junction, br.rejoin))) {
      connections.push(main);
      hasConn.add(connKey(br.junction, br.rejoin));
    }
  }

  for (const d of distLookup.values()) {
    if (d.source !== "bifurcation-main" || !hasActiveMeters(d)) continue;
    const lo = Math.min(d.from, d.to);
    const hi = Math.max(d.from, d.to);
    const norm = connKey(lo, hi);
    if (dropKeys.has(norm) || isRedundantInferredChord(lo, hi, distLookup))
      continue;
    if (hi - lo === 2) {
      dropKeys.add(connKey(lo + 1, hi));
    }
    if (!hasConn.has(norm)) {
      const main = makeConn(lo, hi, d.meters, "bifurcation-main");
      if (main) {
        connections.push(main);
        hasConn.add(norm);
      }
    }
  }

  for (let i = connections.length - 1; i >= 0; i--) {
    const c = connections[i];
    if (dropKeys.has(connKey(c.from, c.to))) {
      connections.splice(i, 1);
    }
  }
}

export function detectGaps(posts, distances, cableSegments) {
  const gaps = [];
  const distMap = new Map();
  for (const d of distances) {
    distMap.set(`${d.from}->${d.to}`, d.meters);
    distMap.set(`${d.to}->${d.from}`, d.meters);
  }

  const topology = detectRouteTopology(posts);
  const branchStarts = new Set(topology.branches.map((b) => b.start));
  const sorted = [...posts].sort((a, b) => a.number - b.number);

  const nearPost = (op, post, threshold) =>
    Math.hypot(op.x - post.x, op.y - post.y) < threshold;

  for (let i = 0; i < sorted.length - 1; i++) {
    const curr = sorted[i];
    const next = sorted[i + 1];

    if (branchStarts.has(next.number)) {
      continue; // This pair crosses a branch boundary
    }

    // Check if ANY cable segment passes near both posts
    let connected = false;
    for (const segment of cableSegments || []) {
      // D-REV: Only test cables on the same page — cross-page coords are not comparable
      if (
        segment.pageNum != null &&
        curr.pageNum != null &&
        segment.pageNum !== curr.pageNum
      )
        continue;
      let nearA = false;
      let nearB = false;
      for (const op of segment.ops) {
        if (!nearA && op.x !== undefined && nearPost(op, curr, 50))
          nearA = true;
        if (!nearB && op.x !== undefined && nearPost(op, next, 50))
          nearB = true;
        if (nearA && nearB) {
          connected = true;
          break;
        }
      }
      if (connected) break;
    }

    const fwd = `${curr.number}->${next.number}`;
    const rev = `${next.number}->${curr.number}`;
    const distM = distMap.get(fwd) ?? distMap.get(rev);
    const hasDistance = distM != null && distM > 0;

    // D-10: It's a gap if no cable connects them AND there's no distance label
    if (!connected && !hasDistance) {
      gaps.push({ from: curr.number, to: next.number });
    }
  }

  return gaps;
}

/**
 * Calculate GPS coordinates for all posts using per-page UTM-grid calibration (D-REV-01).
 *
 * @param {Array<{ number, x, y, pageNum?, postType? }>} posts  flipY page-local coords
 * @param {Array<{ from, to, meters }>} distances  NOTE: mutated in place — auxiliary
 *   distance supplementation may write back augmented `meters` values into the
 *   caller's array. If the same array is reused (e.g. in the DWG cascade), the
 *   caller will see the updated meters values on the second pass.
 * @param {number} startLat  Latitude of post #1 (user-provided, D-14)
 * @param {number} startLon  Longitude of post #1
 * @param {Array<{ ops, pageNum? }>} cableSegments
 * @param {{ utmGridPathsPerPage: Map, viewportBoxes: Array, pageDimensions: Map, lastPostGps?: { lat: number, lon: number }, overviewComposite?: boolean }|null} opts
 * @returns {{ posts: Array, connections: Array, warnings: string[] }}
 */
export function calculateCoordinates(
  posts,
  distances,
  startLat,
  startLon,
  cableSegments = [],
  opts = null,
) {
  if (!posts || posts.length === 0)
    return { posts: [], connections: [], warnings: [] };

  const warnings = [];
  const sorted = deduplicatePostsPreferLowerPage(posts).sort(
    (a, b) => a.number - b.number,
  );

  // Post (x,y) must already be Poste-layer pole symbols from parsePdf(). Cable geometry is
  // used below for gaps/topology and connection bearings — not to override pole positions.

  // postMap entries are live refs into sorted; lat/lon are current.
  const postMap = new Map(sorted.map((p) => [p.number, p]));

  const distMap = new Map();
  for (const d of distances) {
    distMap.set(`${d.from}->${d.to}`, d.meters);
    distMap.set(`${d.to}->${d.from}`, d.meters);
  }

  // ── Detect topology and gaps ──────────────────────────────────────────────
  const topology = detectRouteTopology(sorted);
  const gaps = detectGaps(sorted, distances, cableSegments);
  const gapSet = new Set(gaps.map((g) => `${g.from}->${g.to}`));

  // ── UTM calibration setup (D-REV-01 through D-REV-12) ────────────────────
  let pageTransforms = new Map(); // Map<pageNum, { origin_e, origin_n, x_scale_sf, y_scale_sf, zone }>
  let scaleFactor = null;
  let utmZone = null;
  let augDistMapForSeams = distMap;

  const opts_ = opts || {};
  const {
    utmGridPathsPerPage,
    viewportBoxes,
    pageDimensions,
    lastPostGps,
    secondAnchorPostNumber,
    overviewComposite,
    disableCableArcPlacer,
    disableSeamLock,
    disableCableChainBearing,
    distanceLabelItems,
  } = opts_;

  if (
    opts_ &&
    utmGridPathsPerPage instanceof Map &&
    viewportBoxes &&
    pageDimensions instanceof Map
  ) {
    // Compute scale factor from page-2 UTM grid (D-REV-06, D-REV-07)
    // Fallback to any detail page if page 2 has no UTM grid
    const page2Paths = utmGridPathsPerPage.get(2) ?? [];
    scaleFactor = computeScaleFactor(page2Paths, warnings);
    if (scaleFactor === null) {
      // Try detail pages
      for (const [pn, paths] of utmGridPathsPerPage) {
        if (pn === 2) continue;
        scaleFactor = computeScaleFactor(paths, warnings);
        if (scaleFactor !== null) {
          warnings.push(
            `UTM scale factor computed from page ${pn} (page 2 had no measurable grid).`,
          );
          break;
        }
      }
    }

    // Fallback to distance-label scale (D-REV-16)
    if (scaleFactor === null) {
      warnings.push(
        "[coordinate-calculator] UTM grid not found on any page. Falling back to distance-label scale factor.",
      );
      let sumM = 0,
        sumPdf = 0;
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i],
          b = sorted[i + 1];
        if (a.pageNum !== b.pageNum) continue; // same-page only for scale
        if (topology.branches.some((br) => br.start === b.number)) continue;
        const m = distMap.get(`${a.number}->${b.number}`);
        if (m != null && m > 0) {
          sumM += m;
          sumPdf += Math.hypot(b.x - a.x, b.y - a.y);
        }
      }
      scaleFactor = sumPdf > 0 ? sumM / sumPdf : null;
    }

    const calibratedPages = overviewComposite
      ? new Set([2])
      : new Set(viewportBoxes.map((v) => v.pageNum));
    repairPostsOnUncalibratedPages(sorted, calibratedPages, warnings);

    const routeCablePlacer =
      !disableCableArcPlacer &&
      (overviewComposite || viewportBoxes.length >= 3) &&
      cableSegments?.length &&
      scaleFactor != null;
    if (routeCablePlacer) {
      const arcCablesByPage = buildCablesByPage(cableSegments);
      // D-N1-03: missing-label fallback for N1 = augmentCrossPageDistances (existing wiring; no new code).
      const { map: arcAugDistMap } = overviewComposite
        ? { map: distMap }
        : augmentCrossPageDistances(sorted, distMap);
      // The N1 walk follows the MAIN route line; a bifurcation-tap value is a
      // junction→tap ARM length, not a main-line span. Walking a through post
      // with one dead-reckons it onto the arm (JB 13→14: a false-bifurcation
      // tap of 10.9 m dragged post 14 to 9 m past post 13 — real span 36 m).
      // Removing the leg breaks the chain at the junction instead, which is
      // what the walk already does one step later at the cleared tap→main edge.
      const placerDistMap = new Map(arcAugDistMap);
      for (const d of distances) {
        if (d.source === "bifurcation-tap") {
          placerDistMap.delete(`${d.from}->${d.to}`);
          placerDistMap.delete(`${d.to}->${d.from}`);
        }
      }
      const placer = placePostsOnCableByArcLength({
        sortedPosts: sorted,
        distMap: placerDistMap,
        cablesByPage: arcCablesByPage,
        perPageScale: (pn) => {
          const paths = utmGridPathsPerPage?.get(pn);
          if (paths?.length) {
            const sf = computeScaleFactor(paths, warnings);
            if (sf != null) return sf;
          }
          return scaleFactor;
        },
        postByNum: postMap,
        warnings,
      });
      if (placer.placed.size > 0) {
        warnings.push(
          `[cable-arc-placer] Repositioned ${placer.placed.size} post(s) on ${placer.pagesPlaced.size} page(s) ` +
            `where PDF coords disagreed with Distância_Poste (single anchor via post #1 per page).`,
        );
      }
    }

    if (
      !overviewComposite &&
      viewportBoxes.length >= 3 &&
      cableSegments?.length &&
      distanceLabelItems?.length
    ) {
      const auxAssocCables = buildCablesByPage(cableSegments);
      const { map: auxDistMap, filled: auxDistFilled } =
        supplementDistancesBesideAuxiliaryPosts(
          sorted,
          distanceLabelItems,
          distMap,
          auxAssocCables,
          {
            warnings,
            perPageScale: (pn) => {
              const paths = utmGridPathsPerPage?.get(pn);
              if (paths?.length) {
                const sf = computeScaleFactor(paths, warnings);
                if (sf != null) return sf;
              }
              return scaleFactor;
            },
          },
        );
      if (auxDistFilled > 0) {
        for (const [k, v] of auxDistMap) distMap.set(k, v);
        for (const d of distances) {
          const v = auxDistMap.get(`${d.from}->${d.to}`);
          if (v > 0) d.meters = v;
        }
      }
    }

    // Build page transforms (D-REV-11, D-REV-12)
    if (
      scaleFactor !== null &&
      (overviewComposite || viewportBoxes.length > 0)
    ) {
      const post1 = sorted.find((p) => p.number === sorted[0].number);
      const { zone } = latLonToUtm(startLat, startLon);
      utmZone = zone;
      const post1WithGps = { ...post1, lat: startLat, lon: startLon };

      if (overviewComposite) {
        const multiTransforms = buildPageTransforms(
          post1WithGps,
          pageDimensions,
          viewportBoxes,
          scaleFactor,
          zone,
          warnings,
          utmGridPathsPerPage,
        );
        const draftOverview = buildOverviewCompositeTransform(
          post1WithGps,
          pageDimensions,
          scaleFactor,
          zone,
          warnings,
          utmGridPathsPerPage,
        );
        remapPostsToOverviewViaUtm(
          sorted,
          multiTransforms,
          draftOverview,
          warnings,
        );
        const post1Remapped = sorted.find((p) => p.number === sorted[0].number);
        pageTransforms = buildOverviewCompositeTransform(
          { ...post1Remapped, lat: startLat, lon: startLon },
          pageDimensions,
          scaleFactor,
          zone,
          warnings,
          utmGridPathsPerPage,
        );
      } else {
        pageTransforms = buildPageTransforms(
          post1WithGps,
          pageDimensions,
          viewportBoxes,
          scaleFactor,
          zone,
          warnings,
          utmGridPathsPerPage,
          false,
        );
        if (utmGridPathsPerPage?.size) {
          applyGridAffineToTransforms(
            pageTransforms,
            post1WithGps,
            utmGridPathsPerPage,
            warnings,
          );
        }
      }

      let augDistMap = distMap;
      // Global label LSQ + boundary lock on 3+ detail sheets (João Born, Siriu).
      // Valmor (2 sheets) stays on thumbnail + per-page UTM scale only (G-1).
      if (!overviewComposite && viewportBoxes.length >= 3) {
        const gapCablesByPage = cableSegments?.length
          ? buildCablesByPage(cableSegments)
          : null;
        const {
          map: distWithGaps,
          filled: gapFilled,
          filledKeys: gapFilledKeys,
        } = fillAdjacentMissingDistances(sorted, distMap, gapCablesByPage);
        if (gapFilled > 0) {
          warnings.push(
            `[label-lsq] Inferred ${gapFilled} same-page gap distance(s) from neighbors for global fit.`,
          );
        }
        const crossAug = augmentCrossPageDistances(sorted, distWithGaps);
        augDistMap = crossAug.map;
        augDistMapForSeams = augDistMap;
        if (crossAug.filled > 0) {
          warnings.push(
            `[label-lsq] Inferred ${crossAug.filled} cross-page distance label(s) from neighbors for global fit.`,
          );
        }
        let lsq = refinePageOriginsByLabelLsq(
          pageTransforms,
          sorted,
          augDistMap,
          { lat: startLat, lon: startLon },
          warnings,
        );
        let labelLsqImproved = Boolean(lsq.improved);
        const cablesByPage = buildCablesByPage(cableSegments);
        const n6 = adjustPageOriginsByCableSimilarity(
          pageTransforms,
          sorted,
          augDistMap,
          { lat: startLat, lon: startLon },
          cablesByPage,
          warnings,
        );
        const multiSheetDetail = viewportBoxes.length >= 3;
        // Boundary when global label-lsq did not run; LSQ already fit page 4–5 (do not stack boundary on top).
        const nBoundary =
          labelLsqImproved || n6 > 0
            ? 0
            : lockPageOriginsAtSheetBreaksFromPriorProjection(
                pageTransforms,
                sorted,
                augDistMap,
                warnings,
              );
        if (!labelLsqImproved && nBoundary > 0) {
          const lsq2 = refinePageOriginsByLabelLsq(
            pageTransforms,
            sorted,
            augDistMap,
            { lat: startLat, lon: startLon },
            warnings,
          );
          if (lsq2.improved) {
            labelLsqImproved = true;
            lsq = lsq2;
          }
        }
        // Post-1→15 seam-lock drifts ~55 m on João Born; never use on 3+ detail sheets.
        if (disableSeamLock) {
          /* seam-lock disabled by debug flag */
        } else if (multiSheetDetail) {
          warnings.push(
            "[seam-lock] Skipped — multi-sheet route" +
              (labelLsqImproved
                ? " (global label-lsq fit page origins)."
                : nBoundary > 0
                  ? " (boundary-locked at sheet breaks)."
                  : " (per-page UTM + label-lsq only)."),
          );
        } else if (nBoundary > 0) {
          /* boundary-locked at sheet breaks */
        } else {
          // Derive boundary post and page from the 2-sheet structure:
          // find the second (higher page-number) sheet and its first post.
          const seamPages = [...pageTransforms.keys()].sort((a, b) => a - b);
          const secondPage =
            seamPages.length >= 2 ? seamPages[seamPages.length - 1] : null;
          const boundaryPost = secondPage != null
            ? sorted.find((p) => p.pageNum === secondPage)
            : null;
          const sequenceFlipPages = detectSequenceFlipPages(sorted);
          if (sequenceFlipPages.size > 0) {
            warnings.push(
              `[route-sequence] Label bearing flipped on page(s) ${[
                ...sequenceFlipPages,
              ]
                .sort((a, b) => a - b)
                .join(", ")} (route vs parser order).`,
            );
          }
          const gpsBoundary =
            boundaryPost != null
              ? gpsAtPostViaLabelWalk(
                  sorted,
                  augDistMap,
                  { lat: startLat, lon: startLon },
                  boundaryPost.number,
                  sequenceFlipPages,
                )
              : null;
          if (
            boundaryPost &&
            gpsBoundary &&
            lockPageOriginAtGps(
              pageTransforms,
              secondPage,
              boundaryPost.x,
              boundaryPost.y,
              gpsBoundary.lat,
              gpsBoundary.lon,
            )
          ) {
            warnings.push(
              `[seam-locked] page ${secondPage} origin from post-1 label walk to post ${boundaryPost.number} at sheet break.`,
            );
          }
        }
      }
    } else if (scaleFactor === null) {
      warnings.push(
        "[coordinate-calculator] Cannot calibrate: no scale factor available. Posts will have lat: null, lon: null.",
      );
    } else {
      warnings.push(
        "[coordinate-calculator] Cannot calibrate: no viewport boxes found. Posts will have lat: null, lon: null.",
      );
    }
  } else {
    warnings.push(
      "[coordinate-calculator] opts not provided or incomplete. Posts will have lat: null, lon: null.",
    );
  }

  for (const w of warnings) console.warn(w);

  const multiSheetRouteEarly =
    !overviewComposite && (viewportBoxes?.length ?? 0) >= 3;
  if (multiSheetRouteEarly && augDistMapForSeams?.size) {
    refineAnchorPagePdfByLabelBracket(sorted, augDistMapForSeams, warnings);
  }

  // ── Project GPS for all posts (D-REV-01, D-REV-02) ───────────────────────
  for (const post of sorted) {
    const transform = pageTransforms.get(post.pageNum);
    if (transform) {
      const { lat, lon } = projectPost(post.x, post.y, transform);
      post.lat = lat;
      post.lon = lon;
    } else {
      post.lat = null;
      post.lon = null;
    }
  }

  const branchStarts = new Set(topology.branches.map((b) => b.start));

  const multiSheetRoute =
    !overviewComposite && (viewportBoxes?.length ?? 0) >= 3;

  const sequenceFlipPagesForSim =
    multiSheetRoute && sorted[0]?.lat != null
      ? detectSequenceFlipPages(sorted)
      : new Set();

  const pdfBearing = (from, to) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  };

  let tailAnchorUtmRestore = false;

  // ── Optional 2nd-anchor similarity refinement (D-ACC-07) ─────────────────
  // Runs BEFORE label chaining so the page-4 label chain starts from a
  // similarity-corrected anchor rather than the raw UTM position.
  if (
    lastPostGps &&
    typeof lastPostGps.lat === "number" &&
    isFinite(lastPostGps.lat) &&
    typeof lastPostGps.lon === "number" &&
    isFinite(lastPostGps.lon)
  ) {
    const boundsLast = validateBrazilBounds(lastPostGps.lat, lastPostGps.lon);
    if (!boundsLast.valid) {
      warnings.push(
        "[coordinate-calculator] 2nd anchor outside Brazil bounds — using single-anchor projection.",
      );
    } else {
      const post1 = sorted[0];
      const anchorPostNum =
        typeof secondAnchorPostNumber === "number" &&
        Number.isFinite(secondAnchorPostNumber)
          ? secondAnchorPostNumber
          : sorted[sorted.length - 1].number;
      const anchorPost = sorted.find((p) => p.number === anchorPostNum);

      if (post1.lat == null || !anchorPost || anchorPost.lat == null) {
        warnings.push(
          `[coordinate-calculator] 2nd anchor skipped — post 1 or post ${anchorPostNum} has null lat/lon from projection.`,
        );
      } else {
        // Ground-truth UTM for both anchors
        const {
          easting: e1g,
          northing: n1g,
          zone: anchorZone,
        } = latLonToUtm(startLat, startLon);
        const { easting: eNg, northing: nNg } = latLonToUtm(
          lastPostGps.lat,
          lastPostGps.lon,
        );

        // Projected UTM for both anchors
        const { easting: e1p, northing: n1p } = latLonToUtm(
          post1.lat,
          post1.lon,
        );
        const { easting: eNp, northing: nNp } = latLonToUtm(
          anchorPost.lat,
          anchorPost.lon,
        );

        const dxP = eNp - e1p;
        const dyP = nNp - n1p;
        const denomP = dxP * dxP + dyP * dyP;

        if (denomP < 1e-9) {
          warnings.push(
            "[coordinate-calculator] 2nd anchor coincides with post 1 in projection space — similarity undefined.",
          );
        } else {
          const dxG = eNg - e1g;
          const dyG = nNg - n1g;

          // s*cos(theta) and s*sin(theta) of the similarity transform
          const cosScale = (dxP * dxG + dyP * dyG) / denomP;
          const sinScale = (dxP * dyG - dyP * dxG) / denomP;

          const routeEnd = sorted[sorted.length - 1].number;
          const isTailAnchor =
            anchorPostNum === routeEnd &&
            multiSheetRoute &&
            post1.pageNum != null;
          const anchorPage = post1.pageNum;
          let skippedAnchorPage = 0;

          for (const p of sorted) {
            if (p.lat == null || p.lon == null) continue;
            if (
              isTailAnchor &&
              (p.number === post1.number || p.pageNum === anchorPage)
            ) {
              skippedAnchorPage++;
              continue;
            }
            const { easting: ep, northing: np } = latLonToUtm(p.lat, p.lon);
            const e = e1g + cosScale * (ep - e1p) - sinScale * (np - n1p);
            const n = n1g + sinScale * (ep - e1p) + cosScale * (np - n1p);
            const refined = utmToLatLon(e, n, anchorZone);
            p.lat = refined.lat;
            p.lon = refined.lon;
          }

          if (isTailAnchor && skippedAnchorPage > 1) {
            tailAnchorUtmRestore = true;
            warnings.push(
              `[coordinate-calculator] Tail 2nd-anchor: similarity on pages after ${anchorPage} only (${skippedAnchorPage - 1} post(s) on anchor sheet kept on per-page UTM).`,
            );
          }

          const scale = Math.hypot(cosScale, sinScale);
          const rotDeg = (Math.atan2(sinScale, cosScale) * 180) / Math.PI;
          warnings.push(
            `[coordinate-calculator] 2nd anchor applied at post ${anchorPostNum} — similarity refined: scale=${scale.toFixed(5)}, rot=${rotDeg.toFixed(2)}°.`,
          );
        }
      }
    }
  }

  if (
    tailAnchorUtmRestore &&
    pageTransforms.size > 0 &&
    augDistMapForSeams?.size
  ) {
    const firstRelocked = lockFirstSheetBreakFromChainedGps(
      pageTransforms,
      sorted,
      augDistMapForSeams,
      warnings,
    );
    if (firstRelocked != null) {
      for (const post of sorted) {
        if (post.pageNum !== firstRelocked) continue;
        const transform = pageTransforms.get(post.pageNum);
        if (transform) {
          const { lat, lon } = projectPost(post.x, post.y, transform);
          post.lat = lat;
          post.lon = lon;
        }
      }
    }
  }

  // ── Distance-label route chain (when Distância_Poste labels cover the route) ─
  // Runs after 2nd anchor so the page-4 label chain starts from a similarity-corrected anchor.
  if (pageTransforms.size > 0 && sorted[0].lat != null) {
    // Auto-disable cable-chain bearings when any active cable is fragmented (dashed-ribbon
    // polygon with many M sub-paths). Local tangents are unreliable on such cables.
    let cableFragmentedSomewhere = false;
    if (
      (overviewComposite || (viewportBoxes?.length ?? 0) >= 3) &&
      cableSegments?.length
    ) {
      for (const seg of cableSegments) {
        if (!seg?.ops) continue;
        let mCount = 0;
        for (const op of seg.ops) if (op.type === "M") mCount++;
        if (mCount >= 5) {
          cableFragmentedSomewhere = true;
          break;
        }
      }
    }
    const chainCables =
      disableCableChainBearing || cableFragmentedSomewhere
        ? null
        : (overviewComposite || (viewportBoxes?.length ?? 0) >= 3) &&
            cableSegments?.length
          ? buildCablesByPage(cableSegments)
          : null;
    if (cableFragmentedSomewhere && !disableCableChainBearing) {
      warnings.push(
        "[coordinate-calculator] Cable chain bearings disabled: cable is fragmented (dashed-ribbon polygon). Using gpsBearing from UTM-projected positions.",
      );
    }
    const sequenceFlipPages = sequenceFlipPagesForSim;
    const chained = applyDistanceLabelGpsChain(
      sorted,
      augDistMapForSeams,
      startLat,
      startLon,
      branchStarts,
      {
        cablesByPage: chainCables,
        postByNum: postMap,
        multiSheetRoute,
        sequenceFlipPages,
      },
    );
    if (chained) {
      warnings.push(
        "[coordinate-calculator] GPS refined along route using Distância_Poste segment lengths " +
          "(bearings from Cabo Projetado where available; post #1 anchor unchanged).",
      );
    }
    const hasSheetBreakDist =
      multiSheetRoute &&
      sorted.some((p, i) => {
        if (i === 0) return false;
        const prev = sorted[i - 1];
        if (
          prev.pageNum == null ||
          p.pageNum == null ||
          prev.pageNum === p.pageNum
        )
          return false;
        const m =
          augDistMapForSeams.get(`${prev.number}->${p.number}`) ??
          augDistMapForSeams.get(`${p.number}->${prev.number}`);
        return m != null && m > 0;
      });
    if ((chained || hasSheetBreakDist) && !tailAnchorUtmRestore) {
      const relockedPages = lockSheetBreaksFromChainedGps(
        pageTransforms,
        sorted,
        augDistMapForSeams,
        warnings,
      );
      for (const post of sorted) {
        if (!relockedPages.has(post.pageNum)) continue;
        const transform = pageTransforms.get(post.pageNum);
        if (transform) {
          const { lat, lon } = projectPost(post.x, post.y, transform);
          post.lat = lat;
          post.lon = lon;
        }
      }
    }
  }

  // ── Anchor-page refit (multi-sheet routes only) ──────────────────────────
  // The global label LSQ excludes the anchor page from optimization (its origin is
  // pinned to post 1's GPS). On multi-sheet detail drawings the anchor sheet often has
  // a 3–5° rotation against the UTM grid that labels alone cannot detect. Use the
  // chord (post 1 → first downstream post, refined by the chain) to extract the
  // anchor-sheet scale + theta via 2-point Procrustes. Runs AFTER the chain so the
  // first-downstream-post's GPS reflects the cross-sheet refinement.
  // Also runs after the 2nd-anchor similarity (when used) since that refines pages
  // AFTER the anchor sheet, leaving the anchor sheet on raw per-page UTM.
  if (
    multiSheetRoute &&
    pageTransforms.size > 0 &&
    sorted[0]?.lat != null &&
    augDistMapForSeams?.size
  ) {
    const refined = refineAnchorPageByDownstreamChord(
      pageTransforms,
      sorted,
      augDistMapForSeams,
      { lat: startLat, lon: startLon },
      warnings,
    );
    const anchorPage = sorted[0].pageNum;
    if (refined) {
      for (const post of sorted) {
        if (post.pageNum !== anchorPage) continue;
        const transform = pageTransforms.get(post.pageNum);
        if (transform) {
          const { lat, lon } = projectPost(post.x, post.y, transform);
          post.lat = lat;
          post.lon = lon;
        }
      }
    }
    const auxCablesEarly = cableSegments?.length
      ? buildCablesByPage(cableSegments)
      : null;
    if (auxCablesEarly?.size && augDistMapForSeams?.size) {
      refineGpsPastAuxiliaryPostsOnAnchorPage(
        pageTransforms,
        sorted,
        augDistMapForSeams,
        { lat: startLat, lon: startLon },
        auxCablesEarly,
        postMap,
        warnings,
      );
    }
  }

  // ── Sheet-separated run split — GATED-PARTIAL (260603-acc Task 1), NOT WIRED ─
  // Intent: page 4 of Luiz Carolino hosts two sheet-separated route runs (posts
  // 4–11 and 21–31, joined across page 5: post→page sequence p4→p5→p4). RESEARCH
  // Q3 hypothesised the single page-4 origin was a *compromise between the two
  // runs*, injecting ~179 m into 21–31, and that a per-run origin split would
  // recover them toward a ~10 m residual.
  //
  // FAILING CONDITION (empirically disproven this session, debug-lc-pageorigin-probe):
  //   Both page-4 runs are offset the SAME ~175 m @ 303° (run-A 4–11 and run-B
  //   21–31 agree in direction) — page 4's origin is NOT a compromise between
  //   them, it is globally translated exactly like every other non-anchor page
  //   (page 5 posts 12–20 are independently ~230 m @ 7° off). The only absolute
  //   reference is post 1 (page 3, ~0 m); the ~175–235 m offsets are accumulated
  //   label-chain drift across pages, i.e. a MULTI-PAGE ABSOLUTE-TRANSLATION
  //   problem, not a same-page two-run problem.
  //   Re-anchoring run-B to its seam neighbour (post 20) cannot help because
  //   post 20 is itself ~226 m @ 7° mis-placed; doing so pushed several 21–31
  //   posts to ~208 m @ 127° (WORSE), which would regress the LC baseline.
  // A correct fix must improve the multi-page absolute anchor (e.g. a second
  // trusted GPS anchor, or a global drift model) — out of scope for a pure
  // same-page calibration split. A prototype per-run re-anchor
  // (`refinePageOriginsBySheetSeparatedRuns`) was built and measured this session
  // and removed because it regressed the LC PDF 21–31 ceilings; see
  // 260603-acc-RESEARCH.md Q3 + the GATED-partial note in the task report for the
  // reproduction (debug-lc-pageorigin-probe.mjs). Do not re-attempt a same-page
  // origin split without first establishing a trusted absolute anchor for the
  // downstream pages.

  // ── Split-region calibration (multi-sheet routes only; D-P911-07..12) ─────
  // After the global anchor refit, post 9 on João Born page 3 still sits at its
  // Procrustes floor (~12m). A split-region transform applies separate similarity
  // fits to two sub-regions of the anchor page (post 1..K and K+1..last), where K is
  // the break post detected by per-post residual spike. Self-contained: writes
  // post.lat/post.lon directly, no caller reprojection needed.
  if (
    multiSheetRoute &&
    pageTransforms.size > 0 &&
    sorted[0]?.lat != null &&
    augDistMapForSeams?.size
  ) {
    refineAnchorPageBySplitRegion(
      pageTransforms,
      sorted,
      augDistMapForSeams,
      { lat: startLat, lon: startLon },
      warnings,
    );
  }

  // ── Distortion-zone per-post bias (multi-sheet routes only) ───────────────
  // After anchor refit (+ optional split-region), mid-page anchor posts can still
  // sit above the Procrustes floor. Nudge toward label-chain targets when forward
  // chain vs projection diverges and label−chord drift accumulates (GPS-relevant only).
  if (
    multiSheetRoute &&
    pageTransforms.size > 0 &&
    sorted[0]?.lat != null &&
    augDistMapForSeams?.size
  ) {
    refineAnchorPageByDistortionZoneBias(
      pageTransforms,
      sorted,
      augDistMapForSeams,
      { lat: startLat, lon: startLon },
      warnings,
    );
  }

  // ── Route corridor (multi-sheet): sheet breaks + per-post PDF vs GPS side ─
  if (multiSheetRoute && sorted.some((p) => p.lat != null)) {
    const auxCablesForCorridor = cableSegments?.length
      ? buildCablesByPage(cableSegments)
      : null;
    const skipAux = (post) =>
      auxCablesForCorridor != null &&
      isOffRouteCablePost(post, postMap, auxCablesForCorridor);
    let corridorFixed = 0;
    if (auxCablesForCorridor) {
      corridorFixed += refineGpsAtSheetBreakCorridor(
        sorted,
        auxCablesForCorridor,
        skipAux,
        warnings,
        { distMap: augDistMapForSeams },
      );
    }

    // Page-level origin nudge at sheet breaks (RMSE-gated):
    // If an incoming page has a consistent lateral drift from the cable corridor, shift the
    // entire page origin slightly toward the corridor.
    if (
      auxCablesForCorridor &&
      pageTransforms.size > 0 &&
      augDistMapForSeams?.size
    ) {
      const list = [...sorted].sort((a, b) => a.number - b.number);
      const incomingPages = new Set();
      for (let i = 1; i < list.length; i++) {
        const prev = list[i - 1];
        const curr = list[i];
        const pPrev = prev.pageNum ?? 1;
        const pCurr = curr.pageNum ?? 1;
        if (pPrev !== pCurr) incomingPages.add(pCurr);
      }

      const rmseBefore = labelDistanceRmse(
        pageTransforms,
        list,
        augDistMapForSeams,
      );
      const backups = new Map();
      let nudgedPages = 0;
      let maxShift = 0;

      for (const pg of incomingPages) {
        const tf = pageTransforms.get(pg);
        if (!tf) continue;
        backups.set(pg, { origin_e: tf.origin_e, origin_n: tf.origin_n });

        const onPage = list.filter(
          (p) =>
            (p.pageNum ?? 1) === pg &&
            p.lat != null &&
            p.lon != null &&
            !skipAux(p),
        );
        if (onPage.length < 4) continue;

        const midLat = onPage.reduce((s, p) => s + p.lat, 0) / onPage.length;
        const cosLat = Math.cos((midLat * Math.PI) / 180);
        let sumDx = 0;
        let sumDy = 0;
        let n = 0;
        for (const p of onPage) {
          const hit = nearestPointOnCablesOnPage(
            p.x,
            p.y,
            pg,
            auxCablesForCorridor,
          );
          if (!Number.isFinite(hit.d) || hit.d > OFF_CABLE_FOR_LABEL_CHAIN_PT)
            continue;
          const corridor = projectPost(hit.x, hit.y, tf);
          sumDx += (corridor.lon - p.lon) * 111320 * cosLat;
          sumDy += (corridor.lat - p.lat) * 110540;
          n++;
        }
        if (n < 4) continue;

        const meanDx = sumDx / n;
        const meanDy = sumDy / n;
        const meanMag = Math.hypot(meanDx, meanDy);
        if (meanMag < 0.5) continue;

        const cap = 18;
        const k = Math.min(1, cap / meanMag) * 0.7;
        tf.origin_e += meanDx * k;
        tf.origin_n += meanDy * k;

        nudgedPages++;
        maxShift = Math.max(maxShift, meanMag * k);
      }

      const rmseAfter = labelDistanceRmse(
        pageTransforms,
        list,
        augDistMapForSeams,
      );
      if (
        nudgedPages > 0 &&
        rmseBefore != null &&
        rmseAfter != null &&
        rmseAfter > rmseBefore + 0.75
      ) {
        for (const [pg, b] of backups) {
          const tf = pageTransforms.get(pg);
          if (!tf) continue;
          tf.origin_e = b.origin_e;
          tf.origin_n = b.origin_n;
        }
        warnings.push(
          `[route-corridor] Sheet-break page nudge skipped (label RMSE worsened ` +
            `${rmseBefore.toFixed(2)}→${rmseAfter.toFixed(2)} m).`,
        );
      } else if (nudgedPages > 0) {
        for (const post of sorted) {
          if (!incomingPages.has(post.pageNum ?? 1)) continue;
          const transform = pageTransforms.get(post.pageNum);
          if (transform) {
            const { lat, lon } = projectPost(post.x, post.y, transform);
            post.lat = lat;
            post.lon = lon;
          }
        }
        warnings.push(
          `[route-corridor] Sheet-break page nudge applied to ${nudgedPages} page(s) ` +
            `(max shift ≈ ${maxShift.toFixed(1)} m).`,
        );
      }
    }

    corridorFixed += refineGpsToPdfRouteCorridor(sorted, skipAux, warnings, {
      distMap: augDistMapForSeams,
    });
    if (auxCablesForCorridor && pageTransforms.size > 0) {
      corridorFixed += clampGpsToRouteCableCorridor(
        sorted,
        auxCablesForCorridor,
        pageTransforms,
        skipAux,
        warnings,
        { distMap: augDistMapForSeams, maxLateralM: 8, detailMaxLateralM: 4 },
      );
    }
    if (corridorFixed > 0) {
      warnings.push(
        `[route-corridor] Adjusted ${corridorFixed} post GPS position(s) to match plan corridor.`,
      );
    }

    if (augDistMapForSeams?.size && cableSegments?.length) {
      const auxSnapCables = buildCablesByPage(cableSegments);
      const snappedBifurcationNums = snapBifurcationTapPostsByLabelBracket(
        sorted,
        augDistMapForSeams,
        warnings,
      );
      const snappedAuxNums = snapOffCableAuxiliaryPostsByLabelBracket(
        sorted,
        augDistMapForSeams,
        auxSnapCables,
        warnings,
        { requireOnCableNeighbors: true },
      );
      const snappedRouteNums = snapRoutePostsPdfByLabelBracket(
        sorted,
        augDistMapForSeams,
        auxSnapCables,
        warnings,
        { requireOnCableNeighbors: true },
      );
      const snappedNums = [
        ...new Set([
          ...snappedBifurcationNums,
          ...snappedAuxNums,
          ...snappedRouteNums,
        ]),
      ];
      if (snappedNums.length > 0) {
        for (const num of snappedNums) {
          const post = postMap.get(num);
          const transform = post && pageTransforms.get(post.pageNum);
          if (!post || !transform) continue;
          const { lat, lon } = projectPost(post.x, post.y, transform);
          post.lat = lat;
          post.lon = lon;
        }
        warnings.push(
          `[label-lsq] Post(s) ${snappedNums.join(", ")} snapped ` +
            `along on-cable neighbor brackets (post-corridor GPS reproject).`,
        );
      }
    }
  }

  // ── Build connections array (D-REV-14, D-REV-15, D-04, D-17) ────────────
  const connections = [];
  const distLookup = buildDistanceLookup(distances);
  const cablesByPageForConn = cableSegments?.length
    ? buildCablesByPage(cableSegments)
    : new Map();
  const branchJunctionMap = new Map(
    topology.branches.map((b) => [b.start, b.junctionPost]),
  );

  // Process main route and branch junctions
  for (let i = 0; i < sorted.length; i++) {
    const curr = sorted[i];

    // Branch junction connection (D-REV-02: from junction GPS to branch start GPS)
    if (branchStarts.has(curr.number)) {
      const junctionId = branchJunctionMap.get(curr.number);
      if (junctionId != null) {
        const junc = postMap.get(junctionId);
        if (
          junc &&
          junc.lat != null &&
          junc.lon != null &&
          curr.lat != null &&
          curr.lon != null
        ) {
          const isCrossPage = junc.pageNum !== curr.pageNum;
          let meters, bearing;
          if (isCrossPage) {
            // D-REV-15: cross-page — use GPS-vector values
            meters = haversineMeters(junc.lat, junc.lon, curr.lat, curr.lon);
            bearing = gpsBearing(junc.lat, junc.lon, curr.lat, curr.lon);
          } else {
            // D-REV-14: same-page — use PDF-space values
            const pdfD = Math.hypot(curr.x - junc.x, curr.y - junc.y);
            meters =
              scaleFactor != null
                ? pdfD * scaleFactor
                : haversineMeters(junc.lat, junc.lon, curr.lat, curr.lon);
            bearing = pdfBearing(junc, curr);
          }
          connections.push({
            from: junc.number,
            to: curr.number,
            meters,
            bearing,
            gap: false,
            ...(isCrossPage ? { cross_page: true } : {}),
          });
        }
      }
    }

    // Forward connection along main route — skip off-cable auxiliary taps (e.g. 3→5, not 3→4→5)
    if (isOffRouteCablePost(curr, postMap, cablesByPageForConn)) continue;

    let j = i + 1;
    while (
      j < sorted.length &&
      isOffRouteCablePost(sorted[j], postMap, cablesByPageForConn)
    ) {
      j++;
    }
    if (j >= sorted.length) continue;

    const next = sorted[j];
    if (branchStarts.has(next.number)) continue; // branch starts handled above

    let isGap = false;
    for (let k = i; k < j; k++) {
      if (gapSet.has(`${sorted[k].number}->${sorted[k + 1].number}`)) {
        isGap = true;
        break;
      }
    }

    const isCrossPage =
      curr.pageNum != null &&
      next.pageNum != null &&
      curr.pageNum !== next.pageNum;

    let meters, bearing;
    if (isCrossPage) {
      // D-REV-15: cross-page — GPS-vector
      if (
        curr.lat != null &&
        curr.lon != null &&
        next.lat != null &&
        next.lon != null
      ) {
        meters = haversineMeters(curr.lat, curr.lon, next.lat, next.lon);
        bearing = gpsBearing(curr.lat, curr.lon, next.lat, next.lon);
      } else {
        meters = 0;
        bearing = 0;
      }
    } else {
      // D-REV-14: same-page — PDF-space; sum label hops through auxiliary posts when present
      const pdfD = Math.hypot(next.x - curr.x, next.y - curr.y);
      const m =
        metersForRouteHop(sorted, distMap, i, j) ??
        (scaleFactor != null ? pdfD * scaleFactor : 0);
      meters = m;
      bearing = pdfBearing(curr, next);
    }

    connections.push({
      from: curr.number,
      to: next.number,
      meters,
      bearing,
      gap: isGap,
      ...(isCrossPage ? { cross_page: true } : {}),
    });
  }

  // Ensure every consecutive post number has a connection entry.
  // This is required by DWG graph-walk pairing, which iterates by post numbering even when
  // `isOffRouteCablePost()` classifies a post as an auxiliary tap (and would otherwise skip it).
  const hasConn = new Set(connections.map((c) => `${c.from}->${c.to}`));
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const key = `${a.number}->${b.number}`;
    const rev = `${b.number}->${a.number}`;
    if (hasConn.has(key) || hasConn.has(rev)) continue;
    // NOTE: do NOT skip blocked cable edges here. The DWG graph-walk requires an
    // entry for every consecutive pair (the guarantee this loop exists to provide).
    // Blocked edges (jumpback-suppressed / bifurcation-cleared) are pruned from the
    // KMZ-facing `connections` later by finalizeBifurcationConnections, but they must
    // first be present so walkConnections (snapshotted pre-prune) sees the full topology.

    const isCrossPage =
      a.pageNum != null && b.pageNum != null && a.pageNum !== b.pageNum;

    let meters, bearing;
    if (isCrossPage) {
      if (a.lat != null && a.lon != null && b.lat != null && b.lon != null) {
        meters = haversineMeters(a.lat, a.lon, b.lat, b.lon);
        bearing = gpsBearing(a.lat, a.lon, b.lat, b.lon);
      } else {
        meters = 0;
        bearing = 0;
      }
    } else {
      const labelM = distMap.get(key) ?? distMap.get(rev) ?? null;
      const pdfD = Math.hypot(b.x - a.x, b.y - a.y);
      meters =
        labelM != null ? labelM : scaleFactor != null ? pdfD * scaleFactor : 0;
      bearing = pdfBearing(a, b);
    }

    let isGap = gapSet.has(key);
    if (isBifurcationTapLeg(a.number, b.number, distMap)) isGap = false;
    connections.push({
      from: a.number,
      to: b.number,
      meters,
      bearing,
      gap: isGap,
      implied: true,
      ...(isCrossPage ? { cross_page: true } : {}),
    });
    hasConn.add(key);
  }

  // The DWG graph-walk navigates posts in consecutive numeric order and requires
  // a connection entry for every consecutive pair (N→N+1). finalizeBifurcationConnections
  // prunes edges (jumpback-suppressed penults, redundant chords, branch-return tails)
  // for KMZ polyline rendering, which would otherwise leave the walk with no-connection
  // at branch-return rejoins (e.g. 9→10) and collapse it into pdf-fallback. Snapshot the
  // full consecutive topology BEFORE pruning so the walk and KMZ rendering stay decoupled.
  const walkConnections = connections.map((c) => ({ ...c }));

  finalizeBifurcationConnections(
    connections,
    sorted,
    postMap,
    distLookup,
    distMap,
    scaleFactor,
    pdfBearing,
  );

  // ── Label vs haversine sanity-check (D-ACC-08) ───────────────────────────
  // postMap entries are live refs into sorted — lat/lon reflect snap + projection + similarity.
  for (const c of connections) {
    if (c.gap !== false) continue;
    const labelM = distMap.get(`${c.from}->${c.to}`);
    if (labelM == null || labelM <= 0) continue;
    const a = postMap.get(c.from);
    const b = postMap.get(c.to);
    if (
      !a ||
      !b ||
      a.lat == null ||
      a.lon == null ||
      b.lat == null ||
      b.lon == null
    )
      continue;
    const hav = haversineMeters(a.lat, a.lon, b.lat, b.lon);
    const tolerance = Math.max(5, 0.1 * labelM);
    if (Math.abs(hav - labelM) > tolerance) {
      warnings.push(
        `[coordinate-calculator] label sanity-check: segment ${c.from}->${c.to} label=${labelM.toFixed(1)}m vs haversine=${hav.toFixed(1)}m (delta=${(hav - labelM).toFixed(1)}m, tol=${tolerance.toFixed(1)}m).`,
      );
    }
  }

  return { posts: sorted, connections, walkConnections, warnings };
}
