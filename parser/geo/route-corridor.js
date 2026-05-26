/**
 * Keep GPS on the same side of the neighbor chord as PDF pole positions (plan corridor).
 * Fixes KMZ cable zig-zags when arc/label placement flips a post across the street.
 */

const MIN_CORRIDOR_LATERAL_M = 0.75;
const MIN_SIDE_PDF_PT = 2;
const MIN_SIDE_GPS_M = 0.15;

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
