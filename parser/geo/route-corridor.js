/**
 * Keep GPS on the same side of the neighbor chord as PDF pole positions (plan corridor).
 * Fixes KMZ cable zig-zags when arc/label placement flips a post across the street.
 */

import {
  nearestCableHitOnPage,
  OFF_CABLE_FOR_LABEL_CHAIN_PT,
} from "../cable-builder.js";
import { haversineMeters, projectPost } from "./utm-calibrator.js";

const MIN_CORRIDOR_LATERAL_M = 0.75;
export const DEFAULT_ROUTE_CORRIDOR_CLAMP_M = 8;
const CLAMP_RMSE_TOLERANCE_M = 1.25;
const MIN_SIDE_PDF_PT = 2;
const MIN_SIDE_GPS_M = 0.15;
const MIN_CABLE_OFFSET_PT = 3;

/**
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 * @param {number} px
 * @param {number} py
 * @returns {-1|0|1}
 */
export function chordSideSign(ax, ay, bx, by, px, py) {
  const v = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  if (v > MIN_SIDE_PDF_PT) return 1;
  if (v < -MIN_SIDE_PDF_PT) return -1;
  return 0;
}

/**
 * @param {{ lat: number, lon: number }} origin
 * @param {{ lat: number, lon: number }} p
 * @param {number} cosLat
 */
function toLocalMeters(origin, p, cosLat) {
  return {
    x: (p.lon - origin.lon) * 111320 * cosLat,
    y: (p.lat - origin.lat) * 110540,
  };
}

/**
 * @param {{ lat: number, lon: number }} a
 * @param {{ lat: number, lon: number }} b
 * @param {{ lat: number, lon: number }} p
 */
export function lateralMetersChord(a, b, p) {
  const midLat = (a.lat + b.lat) / 2;
  const cosLat = Math.cos((midLat * Math.PI) / 180);
  const origin = a;
  const bm = toLocalMeters(origin, b, cosLat);
  const pm = toLocalMeters(origin, p, cosLat);
  const len2 = bm.x * bm.x + bm.y * bm.y;
  if (len2 < 0.01) return 0;
  const t = (pm.x * bm.x + pm.y * bm.y) / len2;
  return Math.hypot(pm.x - t * bm.x, pm.y - t * bm.y);
}

/**
 * @param {{ lat: number, lon: number }} a
 * @param {{ lat: number, lon: number }} b
 * @param {{ lat: number, lon: number }} p
 */
export function gpsChordSide(a, b, p) {
  const midLat = (a.lat + b.lat) / 2;
  const cosLat = Math.cos((midLat * Math.PI) / 180);
  const bm = toLocalMeters(a, b, cosLat);
  const pm = toLocalMeters(a, p, cosLat);
  const v = bm.x * pm.y - bm.y * pm.x;
  if (v > MIN_SIDE_GPS_M) return 1;
  if (v < -MIN_SIDE_GPS_M) return -1;
  return 0;
}

/**
 * @param {{ lat: number, lon: number }} a
 * @param {{ lat: number, lon: number }} b
 * @param {{ lat: number, lon: number }} p
 * @returns {{ lat: number, lon: number }}
 */
export function reflectGpsAcrossChord(a, b, p) {
  const midLat = (a.lat + b.lat) / 2;
  const cosLat = Math.cos((midLat * Math.PI) / 180);
  const origin = a;
  const bm = toLocalMeters(origin, b, cosLat);
  const pm = toLocalMeters(origin, p, cosLat);
  const len2 = bm.x * bm.x + bm.y * bm.y;
  if (len2 < 0.01) return { lat: p.lat, lon: p.lon };
  const t = (pm.x * bm.x + pm.y * bm.y) / len2;
  const qx = t * bm.x;
  const qy = t * bm.y;
  const rx = 2 * qx - pm.x;
  const ry = 2 * qy - pm.y;
  return {
    lat: origin.lat + ry / 110540,
    lon: origin.lon + rx / (111320 * cosLat),
  };
}

/**
 * @param {Array<{ number: number, x: number, y: number, pageNum?: number, lat?: number|null, lon?: number|null }>} sorted
 * @param {(post: { number: number }) => boolean} [skipPost]
 * @param {string[]} [warnings]
 * @returns {number} posts adjusted
 */
/**
 * Signed offset from Cabo Projetado tangent (PDF points).
 *
 * @param {{ x: number, y: number, pageNum?: number }} post
 * @param {Map<number, Array>} cablesByPage
 * @returns {number}
 */
export function signedCableOffsetPt(post, cablesByPage) {
  const pg = post.pageNum ?? 1;
  const hit = nearestCableHitOnPage(post.x, post.y, pg, cablesByPage);
  const probe = nearestCableHitOnPage(hit.x + 3, hit.y, pg, cablesByPage);
  const tx = probe.x - hit.x;
  const ty = probe.y - hit.y;
  const px = post.x - hit.x;
  const py = post.y - hit.y;
  return tx * py - ty * px;
}

/**
 * At a detail-sheet break, global label/UTM fit can mirror GPS to the opposite side of the
 * street while the plan keeps poles on the same cable side (João Born 25→26).
 *
 * @param {Array<{ number: number, x: number, y: number, pageNum?: number, lat?: number|null, lon?: number|null }>} sorted
 * @param {Map<number, Array>} cablesByPage
 * @param {(post: { number: number }) => boolean} [skipPost]
 * @param {string[]} [warnings]
 * @returns {number} posts adjusted
 */
export function refineGpsAtSheetBreakCorridor(
  sorted,
  cablesByPage,
  skipPost = () => false,
  warnings = [],
  opts = {},
) {
  if (!cablesByPage?.size) return 0;
  const list = [...sorted].sort((a, b) => a.number - b.number);
  const fixedPages = new Set();
  let fixed = 0;
  const distMap = opts.distMap ?? null;

  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1];
    const curr = list[i];
    const prevPage = prev.pageNum ?? 1;
    const currPage = curr.pageNum ?? 1;
    if (prevPage === currPage) continue;
    if (prev.lat == null || curr.lat == null) continue;
    if (fixedPages.has(currPage)) continue;

    let left = i - 2;
    while (left >= 0 && (list[left].pageNum ?? 1) !== prevPage) left--;
    let right = i + 1;
    while (right < list.length && (list[right].pageNum ?? 1) !== currPage) right++;
    if (left < 0 || right >= list.length) continue;
    if (list[left].lat == null || list[right].lat == null) continue;

    const offPrev = signedCableOffsetPt(prev, cablesByPage);
    const offCurr = signedCableOffsetPt(curr, cablesByPage);
    const signPrev =
      offPrev > MIN_CABLE_OFFSET_PT ? 1 : offPrev < -MIN_CABLE_OFFSET_PT ? -1 : 0;
    const signCurr =
      offCurr > MIN_CABLE_OFFSET_PT ? 1 : offCurr < -MIN_CABLE_OFFSET_PT ? -1 : 0;
    if (signPrev === 0 || signCurr === 0 || signPrev !== signCurr) continue;

    const a = { lat: list[left].lat, lon: list[left].lon };
    const b = { lat: list[right].lat, lon: list[right].lon };
    const gPrev = { lat: prev.lat, lon: prev.lon };
    const gCurr = { lat: curr.lat, lon: curr.lon };
    const sidePrev = gpsChordSide(a, b, gPrev);
    const sideCurr = gpsChordSide(a, b, gCurr);
    if (sidePrev === 0 || sideCurr === 0 || sidePrev === sideCurr) continue;

    if (distMap?.size) {
      const m =
        distMap.get(`${prev.number}->${curr.number}`) ??
        distMap.get(`${curr.number}->${prev.number}`);
      if (m != null && m > 0) {
        const dBefore = haversineMeters(prev.lat, prev.lon, curr.lat, curr.lon);
        const reflectedCurr = reflectGpsAcrossChord(a, b, gCurr);
        const dAfter = haversineMeters(
          prev.lat,
          prev.lon,
          reflectedCurr.lat,
          reflectedCurr.lon,
        );
        const errBefore = Math.abs(dBefore - m);
        const errAfter = Math.abs(dAfter - m);
        // Only reflect if it improves the seam distance match.
        if (!(errAfter < errBefore - 0.5)) continue;
      }
    }

    fixedPages.add(currPage);
    for (const p of list) {
      if ((p.pageNum ?? 1) !== currPage || p.lat == null || p.lon == null) continue;
      if (skipPost(p)) continue;
      const g = reflectGpsAcrossChord(a, b, { lat: p.lat, lon: p.lon });
      p.lat = g.lat;
      p.lon = g.lon;
      fixed++;
    }
    warnings.push(
      `[route-corridor] sheet break ${prev.number}→${curr.number}: reflected page ${currPage} GPS ` +
        `(plan same cable side; GPS had flipped across ${list[left].number}–${list[right].number} chord).`,
    );
  }
  return fixed;
}

export function refineGpsToPdfRouteCorridor(sorted, skipPost = () => false, warnings = []) {
  let fixed = 0;
  for (let i = 1; i < sorted.length - 1; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const next = sorted[i + 1];
    if (skipPost(curr)) continue;
    if ((prev.pageNum ?? 1) !== (curr.pageNum ?? 1)) continue;
    if ((next.pageNum ?? 1) !== (curr.pageNum ?? 1)) continue;
    if (prev.lat == null || curr.lat == null || next.lat == null) continue;

    const pdfSide = chordSideSign(prev.x, prev.y, next.x, next.y, curr.x, curr.y);
    if (pdfSide === 0) continue;

    const gPrev = { lat: prev.lat, lon: prev.lon };
    const gNext = { lat: next.lat, lon: next.lon };
    const gCurr = { lat: curr.lat, lon: curr.lon };
    const latM = lateralMetersChord(gPrev, gNext, gCurr);
    if (latM < MIN_CORRIDOR_LATERAL_M) continue;

    const gpsSide = gpsChordSide(gPrev, gNext, gCurr);
    if (gpsSide === 0 || gpsSide === pdfSide) continue;

    const reflected = reflectGpsAcrossChord(gPrev, gNext, gCurr);
    curr.lat = reflected.lat;
    curr.lon = reflected.lon;
    fixed++;
    warnings.push(
      `[route-corridor] post ${curr.number}: reflected GPS across ${prev.number}–${next.number} chord ` +
        `(PDF vs GPS corridor side mismatch, ${latM.toFixed(1)} m off chord).`,
    );
  }
  return fixed;
}

/**
 * @param {{ lat: number, lon: number }} origin  corridor anchor
 * @param {{ lat: number, lon: number }} gps
 * @param {number} maxM
 */
function shrinkGpsLateralToMax(origin, gps, maxM) {
  const d = haversineMeters(origin.lat, origin.lon, gps.lat, gps.lon);
  if (d <= maxM) return gps;
  if (d < 1e-6) return { lat: origin.lat, lon: origin.lon };
  const t = maxM / d;
  return {
    lat: origin.lat + t * (gps.lat - origin.lat),
    lon: origin.lon + t * (gps.lon - origin.lon),
  };
}

/**
 * @param {{ lat: number, lon: number }} a
 * @param {{ lat: number, lon: number }} b
 * @param {{ lat: number, lon: number }} p
 */
function footOnChord(a, b, p) {
  const midLat = (a.lat + b.lat) / 2;
  const cosLat = Math.cos((midLat * Math.PI) / 180);
  const origin = a;
  const bm = toLocalMeters(origin, b, cosLat);
  const pm = toLocalMeters(origin, p, cosLat);
  const len2 = bm.x * bm.x + bm.y * bm.y;
  if (len2 < 0.01) return { lat: p.lat, lon: p.lon };
  const t = Math.max(0, Math.min(1, (pm.x * bm.x + pm.y * bm.y) / len2));
  return {
    lat: origin.lat + (t * bm.y) / 110540,
    lon: origin.lon + (t * bm.x) / (111320 * cosLat),
  };
}

/**
 * @param {{ number: number, lat?: number|null, lon?: number|null }} post
 * @param {Array<{ number: number, lat?: number|null, lon?: number|null }>} sorted
 * @param {Map<string, number>} distMap
 */
function worstAdjacentSpanError(post, sorted, distMap) {
  if (!distMap?.size) return null;
  const byNum = new Map(sorted.map((p) => [p.number, p]));
  let worst = 0;
  let any = false;
  for (const other of [post.number - 1, post.number + 1]) {
    const label =
      distMap.get(`${post.number}->${other}`) ??
      distMap.get(`${other}->${post.number}`);
    if (label == null || label <= 0) continue;
    const a = byNum.get(Math.min(post.number, other));
    const b = byNum.get(Math.max(post.number, other));
    if (!a?.lat || !b?.lat) continue;
    any = true;
    worst = Math.max(
      worst,
      Math.abs(haversineMeters(a.lat, a.lon, b.lat, b.lon) - label),
    );
  }
  return any ? worst : null;
}

/**
 * Pull GPS toward Cabo Projetado (and, when needed, the neighbor chord) when lateral
 * offset exceeds maxLateralM. Translation along lateral only; span RMSE-gated per post.
 *
 * @returns {number} posts adjusted
 */
export function clampGpsToRouteCableCorridor(
  sorted,
  cablesByPage,
  pageTransforms,
  skipPost = () => false,
  warnings = [],
  opts = {},
) {
  if (!pageTransforms?.size) return 0;
  const maxM = opts.maxLateralM ?? DEFAULT_ROUTE_CORRIDOR_CLAMP_M;
  const distMap = opts.distMap ?? null;
  const list = [...sorted].sort((a, b) => a.number - b.number);
  const byNum = new Map(list.map((p) => [p.number, p]));
  let fixed = 0;

  for (const post of list) {
    if (post.lat == null || post.lon == null) continue;
    if (skipPost(post)) continue;

    const gCurr = { lat: post.lat, lon: post.lon };
    let anchor = null;
    let lateral = 0;

    const pg = post.pageNum ?? 1;
    const transform = pageTransforms.get(pg);
    if (transform && cablesByPage?.size) {
      const hit = nearestCableHitOnPage(post.x, post.y, pg, cablesByPage);
      if (Number.isFinite(hit.d) && hit.d <= OFF_CABLE_FOR_LABEL_CHAIN_PT) {
        const corridor = projectPost(hit.x, hit.y, transform);
        const d = haversineMeters(gCurr.lat, gCurr.lon, corridor.lat, corridor.lon);
        if (d > lateral) {
          lateral = d;
          anchor = corridor;
        }
      }
    }

    const prev = byNum.get(post.number - 1);
    const next = byNum.get(post.number + 1);
    if (
      prev?.lat != null &&
      next?.lat != null &&
      (prev.pageNum ?? 1) === pg &&
      (next.pageNum ?? 1) === pg
    ) {
      const gPrev = { lat: prev.lat, lon: prev.lon };
      const gNext = { lat: next.lat, lon: next.lon };
      const foot = footOnChord(gPrev, gNext, gCurr);
      const d = haversineMeters(gCurr.lat, gCurr.lon, foot.lat, foot.lon);
      if (d > lateral) {
        lateral = d;
        anchor = foot;
      }
    }

    if (!anchor || lateral <= maxM) continue;

    const trial = shrinkGpsLateralToMax(anchor, gCurr, maxM);
    const spanBefore = worstAdjacentSpanError(post, list, distMap);
    const saved = { lat: post.lat, lon: post.lon };
    post.lat = trial.lat;
    post.lon = trial.lon;
    const spanAfter = worstAdjacentSpanError(post, list, distMap);
    if (
      spanBefore != null &&
      spanAfter != null &&
      spanAfter > spanBefore + CLAMP_RMSE_TOLERANCE_M
    ) {
      post.lat = saved.lat;
      post.lon = saved.lon;
      continue;
    }

    fixed++;
    warnings.push(
      `[route-corridor] post ${post.number}: lateral clamp ${lateral.toFixed(1)} m → ${maxM} m ` +
        `(route corridor).`,
    );
  }
  return fixed;
}
