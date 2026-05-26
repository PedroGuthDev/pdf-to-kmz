// parser/geo/cable-boundary-calibrator.js
// Approach 6: align sheet boundaries using Cabo Projetado continuity.

import {
  nearestPointOnPathOps,
  pathTotalArcLength,
  cableTangentBearingDeg,
  pointAtArcLength,
} from '../cable-builder.js';
import {
  destinationPoint,
  lockPageOriginAtGps,
  projectPost,
  utmFromPdfPoint,
  utmToLatLon,
} from './utm-calibrator.js';
import { labelDistanceRmse } from './label-lsq-calibrator.js';

const CABLE_NEAR_POST_PT = 80;
const TAIL_METERS = 20;
const MIN_TAIL_METERS = 10;
const TAIL_SAMPLES = 5;
const RMSE_WORSE_LIMIT_M = 0.25;
const MAX_SIM_THETA_DEG = 12;
const MAX_SCALE_DEVIATION = 0.02;

/** @param {{ anchorX?: number, anchorY?: number, x: number, y: number }} post */
function postPdfPos(post) {
  return { x: post.x, y: post.y };
}

/**
 * 2D similarity: Q_i ≈ scale · R(θ) · P_i + t (least squares, no reflection).
 *
 * @param {number[][]} P  source UTM [e, n]
 * @param {number[][]} Q  target UTM [e, n]
 * @returns {{ scale: number, theta: number, tx: number, ty: number, c: number, s: number }|null}
 */
export function fitSimilarity2d(P, Q) {
  const n = P.length;
  if (n < 2 || Q.length !== n) return null;

  const muP = [0, 0];
  const muQ = [0, 0];
  for (let i = 0; i < n; i++) {
    muP[0] += P[i][0];
    muP[1] += P[i][1];
    muQ[0] += Q[i][0];
    muQ[1] += Q[i][1];
  }
  muP[0] /= n;
  muP[1] /= n;
  muQ[0] /= n;
  muQ[1] /= n;

  let a = 0;
  let b = 0;
  let varP = 0;
  for (let i = 0; i < n; i++) {
    const px = P[i][0] - muP[0];
    const py = P[i][1] - muP[1];
    const qx = Q[i][0] - muQ[0];
    const qy = Q[i][1] - muQ[1];
    a += qx * px + qy * py;
    b += qx * py - qy * px;
    varP += px * px + py * py;
  }
  if (varP < 1e-6) return null;

  const theta = Math.atan2(b, a);
  const c = Math.cos(theta);
  const s = Math.sin(theta);

  let num = 0;
  for (let i = 0; i < n; i++) {
    const px = P[i][0] - muP[0];
    const py = P[i][1] - muP[1];
    const qx = Q[i][0] - muQ[0];
    const qy = Q[i][1] - muQ[1];
    const rx = c * px + s * py;
    const ry = -s * px + c * py;
    num += qx * rx + qy * ry;
  }
  const scale = num / varP;
  if (!Number.isFinite(scale) || Math.abs(scale) < 1e-9) return null;

  const tx = muQ[0] - scale * (c * muP[0] + s * muP[1]);
  const ty = muQ[1] - scale * (-s * muP[0] + c * muP[1]);
  return { scale, theta, tx, ty, c, s };
}

/**
 * @param {number} e
 * @param {number} n
 * @param {{ scale: number, c: number, s: number, tx: number, ty: number }} sim
 */
function applySimilarityUtm(e, n, sim) {
  const rx = sim.c * e + sim.s * n;
  const ry = -sim.s * e + sim.c * n;
  return {
    easting: sim.scale * rx + sim.tx,
    northing: sim.scale * ry + sim.ty,
  };
}

/**
 * @param {number} pageNum
 * @param {Map<number, Array<Array<import('../construct-path-parser.js').PathOp>>>} cablesByPage
 * @param {number} refX
 * @param {number} refY
 * @returns {Array<import('../construct-path-parser.js').PathOp>|null}
 */
function selectRouteCableOps(pageNum, cablesByPage, refX, refY) {
  const paths = cablesByPage.get(pageNum) ?? [];
  let bestOps = null;
  let bestScore = -Infinity;
  for (const ops of paths) {
    const hit = nearestPointOnPathOps(refX, refY, ops);
    if (hit.d > CABLE_NEAR_POST_PT) continue;
    const score = hit.t - hit.d * 2;
    if (score > bestScore) {
      bestScore = score;
      bestOps = ops;
    }
  }
  return bestOps;
}

/**
 * Sample PDF points along cable arc from a post hit, up to `lengthMeters` (physical).
 *
 * @param {Array<import('../construct-path-parser.js').PathOp>} ops
 * @param {number} refX
 * @param {number} refY
 * @param {1|-1} direction  +1 = increasing arc from hit, -1 = decreasing
 * @param {number} lengthMeters
 * @param {number} scaleSf  meters per PDF point
 * @returns {Array<{ x: number, y: number }>}
 */
export function sampleCableArcFromPost(ops, refX, refY, direction, lengthMeters, scaleSf) {
  if (!ops?.length || !scaleSf || scaleSf <= 0 || lengthMeters < MIN_TAIL_METERS) {
    return [];
  }
  const hit = nearestPointOnPathOps(refX, refY, ops);
  const total = pathTotalArcLength(ops);
  if (total < 1) return [];

  const lengthPdf = lengthMeters / scaleSf;
  const available =
    direction > 0 ? total - hit.t : hit.t;
  const usePdf = Math.min(lengthPdf, available);
  if (usePdf * scaleSf < MIN_TAIL_METERS) return [];

  const samples = [];
  for (let i = 0; i < TAIL_SAMPLES; i++) {
    const frac = TAIL_SAMPLES === 1 ? 0 : i / (TAIL_SAMPLES - 1);
    const t = hit.t + direction * frac * usePdf;
    const p = pointAtArcLength(ops, Math.max(0, Math.min(total, t)));
    if (p) samples.push(p);
  }
  return samples;
}

/**
 * Deep-copy page transform map for RMSE-gated rollback.
 *
 * @param {Map<number, object>} transforms
 * @returns {Map<number, object>}
 */
export function clonePageTransforms(transforms) {
  return new Map([...transforms.entries()].map(([k, v]) => [k, { ...v }]));
}

/**
 * N6: fit 2D similarity from cable tail/head samples at cross-page seams (RMSE-gated).
 *
 * @param {Map<number, object>} transforms
 * @param {Array<{ number: number, x: number, y: number, pageNum?: number, anchorX?: number, anchorY?: number }>} sortedPosts
 * @param {Map<string, number|null>} distMap
 * @param {{ lat: number, lon: number }} post1Gps
 * @param {Map<number, Array<Array<import('../construct-path-parser.js').PathOp>>>} cablesByPage
 * @param {string[]} warnings
 * @returns {number}
 */
export function adjustPageOriginsByCableSimilarity(
  transforms,
  sortedPosts,
  distMap,
  post1Gps,
  cablesByPage,
  warnings
) {
  if (transforms.size < 2 || !sortedPosts?.length || !distMap?.size || !cablesByPage?.size) {
    return 0;
  }

  const sorted = [...sortedPosts].sort((a, b) => a.number - b.number);
  let adjusted = 0;

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const m = distMap.get(`${prev.number}->${curr.number}`);
    if (m == null || m <= 0) continue;

    const crossPage =
      prev.pageNum != null && curr.pageNum != null && prev.pageNum !== curr.pageNum;
    if (!crossPage) continue;

    const tPrev = transforms.get(prev.pageNum);
    const tCurr = transforms.get(curr.pageNum);
    if (!tPrev || !tCurr) continue;

    const prevPos = postPdfPos(prev);
    const currPos = postPdfPos(curr);
    const opsPrev = selectRouteCableOps(prev.pageNum, cablesByPage, prevPos.x, prevPos.y);
    const opsNext = selectRouteCableOps(curr.pageNum, cablesByPage, currPos.x, currPos.y);
    if (!opsPrev || !opsNext) continue;

    const hitPrev = nearestPointOnPathOps(prevPos.x, prevPos.y, opsPrev);
    const towardEnd = hitPrev.t >= pathTotalArcLength(opsPrev) * 0.5 ? 1 : -1;
    const tailDir = towardEnd > 0 ? -1 : 1;

    const tailPdf = sampleCableArcFromPost(
      opsPrev,
      prevPos.x,
      prevPos.y,
      tailDir,
      TAIL_METERS,
      tPrev.x_scale_sf
    );
    const hitNext = nearestPointOnPathOps(currPos.x, currPos.y, opsNext);
    const totalNext = pathTotalArcLength(opsNext);
    const towardEndNext = hitNext.t >= totalNext * 0.5 ? 1 : -1;
    const headPdf = sampleCableArcFromPost(
      opsNext,
      currPos.x,
      currPos.y,
      towardEndNext,
      TAIL_METERS,
      tCurr.x_scale_sf
    );
    const nPairs = Math.min(tailPdf.length, headPdf.length);
    if (nPairs < 3) continue;

    const P = [];
    const Q = [];
    for (let k = 0; k < nPairs; k++) {
      const uB = utmFromPdfPoint(headPdf[k].x, headPdf[k].y, tCurr);
      const uA = utmFromPdfPoint(tailPdf[k].x, tailPdf[k].y, tPrev);
      P.push([uB.easting, uB.northing]);
      Q.push([uA.easting, uA.northing]);
    }

    let sim = fitSimilarity2d(P, Q);
    if (!sim) continue;

    if (Math.abs(sim.scale - 1) > MAX_SCALE_DEVIATION) {
      sim = { ...sim, scale: 1, tx: sim.tx, ty: sim.ty };
    }
    if (Math.abs(sim.theta) > (MAX_SIM_THETA_DEG * Math.PI) / 180) continue;

    const snap = clonePageTransforms(transforms);
    const tSnap = snap.get(curr.pageNum);
    if (!tSnap) continue;

    const lockPt = opsNext
      ? nearestPointOnPathOps(currPos.x, currPos.y, opsNext)
      : { x: currPos.x, y: currPos.y };
    const uLock = utmFromPdfPoint(lockPt.x, lockPt.y, tSnap);
    const uTarget = applySimilarityUtm(uLock.easting, uLock.northing, sim);
    const { lat, lon } = utmToLatLon(uTarget.easting, uTarget.northing, tSnap.zone);

    tSnap.theta = (tSnap.theta ?? 0) + sim.theta;
    if (
      !lockPageOriginAtGps(snap, curr.pageNum, lockPt.x, lockPt.y, lat, lon)
    ) {
      continue;
    }

    const rmseBefore = labelDistanceRmse(transforms, sorted, distMap);
    const rmseAfter = labelDistanceRmse(snap, sorted, distMap);
    if (
      rmseBefore != null &&
      rmseAfter != null &&
      rmseAfter > rmseBefore + RMSE_WORSE_LIMIT_M
    ) {
      continue;
    }

    transforms.set(curr.pageNum, { ...snap.get(curr.pageNum) });
    adjusted++;
    warnings.push(
      `[cable-boundary] Page ${curr.pageNum}: similarity seam fit ` +
        `(θ=${((sim.theta * 180) / Math.PI).toFixed(2)}°, scale=${sim.scale.toFixed(4)}, ` +
        `${nPairs} samples, label RMSE ${rmseBefore?.toFixed(2) ?? '?'}→${rmseAfter?.toFixed(2) ?? '?'} m).`
    );
  }

  if (adjusted > 0) {
    warnings.push(
      `[cable-boundary] ${adjusted} page origin(s) aligned via cable similarity at sheet breaks.`
    );
  }
  return adjusted;
}

/**
 * Cabo Projetado endpoint on a detail sheet (entry = low-X end, exit = high-X end).
 *
 * @param {number} pageNum
 * @param {'entry'|'exit'} edge
 * @param {Array<{ number: number, x: number, y: number, pageNum?: number }>} sortedPosts
 * @param {Map<number, Array<Array<import('../construct-path-parser.js').PathOp>>>} cablesByPage
 * @returns {{ x: number, y: number }|null}
 */
export function routeCableSheetEdgePoint(pageNum, edge, sortedPosts, cablesByPage) {
  const onPage = sortedPosts.filter((p) => (p.pageNum ?? 1) === pageNum);
  if (!onPage.length || !cablesByPage?.size) return null;

  const refPost = onPage.reduce((a, b) =>
    edge === 'entry'
      ? a.number < b.number
        ? a
        : b
      : a.number > b.number
        ? a
        : b,
  );
  const ops = selectRouteCableOps(pageNum, cablesByPage, refPost.x, refPost.y);
  if (!ops?.length) return null;

  const total = pathTotalArcLength(ops);
  const p0 = pointAtArcLength(ops, 0);
  const p1 = pointAtArcLength(ops, total);
  if (!p0 || !p1) return null;

  if (edge === 'entry') {
    return p0.x <= p1.x ? p0 : p1;
  }
  return p0.x >= p1.x ? p0 : p1;
}

/**
 * Bearing along the route cable on a page, using post number order on that sheet.
 *
 * @param {number} pageNum
 * @param {{ x: number, y: number }} pt
 * @param {Array<{ number: number, x: number, y: number, pageNum?: number }>} sortedPosts
 * @param {Map<number, Array<Array<import('../construct-path-parser.js').PathOp>>>} cablesByPage
 * @returns {number|null}
 */
export function cableBearingAlongRouteOnPage(pageNum, pt, sortedPosts, cablesByPage) {
  const onPage = sortedPosts
    .filter((p) => (p.pageNum ?? 1) === pageNum)
    .sort((a, b) => a.number - b.number);
  if (onPage.length < 2) return null;

  const ops = selectRouteCableOps(pageNum, cablesByPage, pt.x, pt.y);
  if (!ops?.length) return null;

  const hitA = nearestPointOnPathOps(onPage[0].x, onPage[0].y, ops);
  const hitB = nearestPointOnPathOps(
    onPage[onPage.length - 1].x,
    onPage[onPage.length - 1].y,
    ops,
  );
  const hit = nearestPointOnPathOps(pt.x, pt.y, ops);
  const dir = hitB.t >= hitA.t ? 1 : -1;
  return cableTangentBearingDeg(ops, hit.t, dir);
}

/**
 * Lock incoming detail pages at sheet breaks using Cabo Projetado exit/entry endpoints.
 * Does not require Distância_Poste at the break for PDF placement — only for span meters
 * when available in distMap (otherwise the segment is skipped).
 *
 * @param {Map<number, object>} transforms
 * @param {Array} sortedPosts
 * @param {Map<string, number>} distMap
 * @param {Map<number, Array>} cablesByPage
 * @param {string[]} warnings
 * @returns {number} pages adjusted
 */
export function lockSheetBreakPagesByCableEndpoints(
  transforms,
  sortedPosts,
  distMap,
  cablesByPage,
  warnings,
) {
  if (transforms.size < 2 || !sortedPosts?.length || !cablesByPage?.size) {
    return 0;
  }

  const sorted = [...sortedPosts].sort((a, b) => a.number - b.number);
  let adjusted = 0;

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (
      prev.pageNum == null ||
      curr.pageNum == null ||
      prev.pageNum === curr.pageNum ||
      curr.number !== prev.number + 1
    ) {
      continue;
    }

    const m =
      distMap.get(`${prev.number}->${curr.number}`) ??
      distMap.get(`${curr.number}->${prev.number}`);
    if (m == null || m <= 0) continue;

    const prevTf = transforms.get(prev.pageNum);
    if (!prevTf || !transforms.has(curr.pageNum)) continue;

    const exitPt = routeCableSheetEdgePoint(
      prev.pageNum,
      'exit',
      sorted,
      cablesByPage,
    );
    const entryPt = routeCableSheetEdgePoint(
      curr.pageNum,
      'entry',
      sorted,
      cablesByPage,
    );
    if (!exitPt || !entryPt) continue;

    const exitOps = selectRouteCableOps(
      prev.pageNum,
      cablesByPage,
      exitPt.x,
      exitPt.y,
    );
    if (exitOps) {
      let mOpCount = 0;
      for (const op of exitOps) if (op.type === 'M') mOpCount++;
      if (mOpCount >= 5) continue;
    }
    let bearing = cableBearingAlongRouteOnPage(
      prev.pageNum,
      exitPt,
      sorted,
      cablesByPage,
    );
    if (bearing == null && exitOps) {
      const hit = nearestPointOnPathOps(exitPt.x, exitPt.y, exitOps);
      const total = pathTotalArcLength(exitOps);
      const towardEnd = hit.t >= total * 0.5 ? 1 : -1;
      bearing = cableTangentBearingDeg(exitOps, hit.t, towardEnd);
    }
    if (bearing == null) continue;

    const entryOps = selectRouteCableOps(
      curr.pageNum,
      cablesByPage,
      entryPt.x,
      entryPt.y,
    );
    if (entryOps) {
      let mOpCount = 0;
      for (const op of entryOps) if (op.type === 'M') mOpCount++;
      if (mOpCount >= 5) continue;
    }

    const gpsPrev = projectPost(prev.x, prev.y, prevTf);
    const junction = destinationPoint(gpsPrev.lat, gpsPrev.lon, bearing, m);

    if (
      lockPageOriginAtGps(
        transforms,
        curr.pageNum,
        entryPt.x,
        entryPt.y,
        junction.lat,
        junction.lon,
      )
    ) {
      adjusted++;
    }
  }

  if (adjusted > 0) {
    warnings.push(
      `[cable-boundary] ${adjusted} page origin(s) locked at sheet breaks via Cabo Projetado entry/exit (span from labels when present).`,
    );
  }
  return adjusted;
}

/**
 * Re-anchor incoming detail pages at cross-page boundaries: label-walk junction GPS
 * locked to the Cabo Projetado point nearest the first post on the new sheet (cable
 * tangent used for exit bearing on the previous sheet).
 *
 * @param {Map<number, { origin_e: number, origin_n: number, x_scale_sf: number, y_scale_sf: number, zone: number }>} transforms
 * @param {Array<{ number: number, x: number, y: number, pageNum?: number, anchorX?: number, anchorY?: number }>} sortedPosts
 * @param {Map<string, number|null>} distMap
 * @param {{ lat: number, lon: number }} post1Gps
 * @param {Map<number, Array<Array<import('../construct-path-parser.js').PathOp>>>} cablesByPage
 * @param {string[]} warnings
 * @returns {number}
 */
export function adjustPageOriginsByCableContinuity(
  transforms,
  sortedPosts,
  distMap,
  post1Gps,
  cablesByPage,
  warnings
) {
  if (transforms.size < 2 || !sortedPosts?.length || !distMap?.size || !cablesByPage?.size) {
    return 0;
  }

  const sorted = [...sortedPosts].sort((a, b) => a.number - b.number);
  const pdfBearing = (from, to) => {
    const a = postPdfPos(from);
    const b = postPdfPos(to);
    const dx = b.x - a.x;
    const dy = a.y - b.y;
    return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  };

  let lat = post1Gps.lat;
  let lon = post1Gps.lon;
  let adjusted = 0;

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const m = distMap.get(`${prev.number}->${curr.number}`);
    if (m == null || m <= 0) continue;

    const crossPage =
      prev.pageNum != null && curr.pageNum != null && prev.pageNum !== curr.pageNum;

    let bearing;
    if (!crossPage) {
      bearing = pdfBearing(prev, curr);
    } else {
      const prevPos = postPdfPos(prev);
      const opsPrev = selectRouteCableOps(prev.pageNum, cablesByPage, prevPos.x, prevPos.y);
      if (opsPrev) {
        const hit = nearestPointOnPathOps(prevPos.x, prevPos.y, opsPrev);
        const total = pathTotalArcLength(opsPrev);
        const towardEnd = hit.t >= total * 0.5 ? 1 : -1;
        bearing = cableTangentBearingDeg(opsPrev, hit.t, towardEnd);
      } else {
        const prevPrev = sorted[i - 2];
        bearing =
          prevPrev && prevPrev.pageNum === prev.pageNum
            ? pdfBearing(prevPrev, prev)
            : pdfBearing(prev, curr);
      }
    }

    const next = destinationPoint(lat, lon, bearing, m);
    lat = next.lat;
    lon = next.lon;

    if (!crossPage) continue;

    const entryPt =
      routeCableSheetEdgePoint(curr.pageNum, 'entry', sorted, cablesByPage) ??
      postPdfPos(curr);
    const opsNext = selectRouteCableOps(
      curr.pageNum,
      cablesByPage,
      entryPt.x,
      entryPt.y,
    );
    const lockPt = opsNext
      ? nearestPointOnPathOps(entryPt.x, entryPt.y, opsNext)
      : entryPt;

    if (
      lockPageOriginAtGps(transforms, curr.pageNum, lockPt.x, lockPt.y, lat, lon)
    ) {
      adjusted++;
    }
  }

  if (adjusted > 0) {
    warnings.push(
      `[cable-boundary] ${adjusted} page origin(s) aligned via Cabo Projetado at sheet breaks.`
    );
  }
  return adjusted;
}
