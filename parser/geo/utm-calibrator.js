// parser/geo/utm-calibrator.js
// UTM calibration math for per-page coordinate projection.
// Implements Snyder Transverse Mercator (forward + inverse) with WGS-84 / SIRGAS-2000 constants.
// All functions are browser-compatible (Math.* only, no Node.js APIs).
//
// Named ESM exports only — no default export, no CommonJS require.

// ── WGS-84 / SIRGAS-2000 constants (D-REV-06, D-REV hardcoded per RESEARCH.md §5) ──────────────
const a = 6378137.0;           // semi-major axis (m) — identical for WGS-84 and SIRGAS-2000
const f = 1 / 298.257223563;   // WGS-84 flattening (diff from GRS80 < 1mm in South America)
const k0 = 0.9996;             // UTM scale factor on central meridian
const E0 = 500000;             // false easting (m)
const N0_south = 10000000;     // false northing — southern hemisphere

// ── UTM forward projection (Snyder TM series, RESEARCH.md §5) ────────────────────────────────

/**
 * Convert geographic coordinates (WGS-84 / SIRGAS-2000) to UTM easting/northing.
 * Automatically determines the UTM zone from longitude.
 *
 * @param {number} lat_deg  Latitude in decimal degrees (negative = south)
 * @param {number} lon_deg  Longitude in decimal degrees (negative = west)
 * @returns {{ easting: number, northing: number, zone: number }}
 */
export function latLonToUtm(lat_deg, lon_deg) {
  const zone = Math.floor((lon_deg + 180) / 6) + 1;
  const lon0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;
  const phi = lat_deg * Math.PI / 180;
  const lambda = lon_deg * Math.PI / 180;
  const b = a * (1 - f);
  const e2 = 1 - (b * b) / (a * a);
  const e_p2 = e2 / (1 - e2);
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2;
  const C = e_p2 * Math.cos(phi) ** 2;
  const A = Math.cos(phi) * (lambda - lon0);
  const M = a * (
    (1 - e2/4 - 3*e2**2/64 - 5*e2**3/256)   * phi
    - (3*e2/8 + 3*e2**2/32 + 45*e2**3/1024) * Math.sin(2*phi)
    + (15*e2**2/256 + 45*e2**3/1024)         * Math.sin(4*phi)
    - (35*e2**3/3072)                         * Math.sin(6*phi)
  );
  const easting  = E0 + k0 * N * (A + (1 - T + C) * A**3/6
    + (5 - 18*T + T**2 + 72*C - 58*e_p2) * A**5/120);
  const northing = N0_south + k0 * (M + N * Math.tan(phi) * (A**2/2
    + (5 - T + 9*C + 4*C**2) * A**4/24
    + (61 - 58*T + T**2 + 600*C - 330*e_p2) * A**6/720));
  return { easting, northing, zone };
}

// ── UTM inverse projection (Snyder TM series, RESEARCH.md §5) ────────────────────────────────

/**
 * Convert UTM easting/northing back to geographic coordinates (WGS-84 / SIRGAS-2000).
 * Southern hemisphere assumed (false northing = 10,000,000 m).
 *
 * @param {number} easting   UTM easting (m)
 * @param {number} northing  UTM northing (m), with 10,000,000 false northing
 * @param {number} zone      UTM zone number
 * @returns {{ lat: number, lon: number }}  Decimal degrees
 */
export function utmToLatLon(easting, northing, zone) {
  const lon0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;
  const b = a * (1 - f);
  const e2 = 1 - (b * b) / (a * a);
  const e_p2 = e2 / (1 - e2);
  const x = easting - E0;
  const y = northing - N0_south;
  const M1 = y / k0;
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const mu = M1 / (a * (1 - e2/4 - 3*e2**2/64 - 5*e2**3/256));
  const phi1 = mu
    + (3*e1/2 - 27*e1**3/32)       * Math.sin(2*mu)
    + (21*e1**2/16 - 55*e1**4/32)  * Math.sin(4*mu)
    + (151*e1**3/96)                * Math.sin(6*mu)
    + (1097*e1**4/512)              * Math.sin(8*mu);
  const N1 = a / Math.sqrt(1 - e2 * Math.sin(phi1) ** 2);
  const T1 = Math.tan(phi1) ** 2;
  const C1 = e_p2 * Math.cos(phi1) ** 2;
  const R1 = a * (1 - e2) / (1 - e2 * Math.sin(phi1) ** 2) ** 1.5;
  const D = x / (N1 * k0);
  const lat = phi1 - (N1 * Math.tan(phi1) / R1) * (
    D**2/2 - (5 + 3*T1 + 10*C1 - 4*C1**2 - 9*e_p2) * D**4/24);
  const lon = lon0 + (D - (1 + 2*T1 + C1) * D**3/6) / Math.cos(phi1);
  return { lat: lat * 180 / Math.PI, lon: lon * 180 / Math.PI };
}

// ── Grid line classification (internal helper) ────────────────────────────────────────────────

/**
 * Classify UTM grid line PathOps into horizontal and vertical lines.
 * PathOps must already have flipY applied — do NOT flip again.
 * Horizontal: |y_end - y_start| < 2 AND length >= 10
 * Vertical:   |x_end - x_start| < 2 AND length >= 10
 *
 * @param {Array<import('../construct-path-parser.js').PathOp>} pathOps  flipY applied
 * @returns {{ hLines: Array<{ y: number }>, vLines: Array<{ x: number }> }}
 */
function classifyGridLinesFromOps(pathOps) {
  const TOLERANCE = 2;  // PDF points — axis-aligned from AutoCAD export
  const MIN_LENGTH = 2; // PDF points — low threshold; dashed UTM grids have short segments
  const hLines = [];
  const vLines = [];
  let cur = null;

  for (const op of pathOps) {
    if (op.type === 'M') {
      cur = { x: op.x, y: op.y }; // flipY already applied
    } else if (op.type === 'L' && cur) {
      const ex = op.x;
      const ey = op.y; // flipY already applied
      const dx = Math.abs(ex - cur.x);
      const dy = Math.abs(ey - cur.y);
      const len = Math.hypot(dx, dy);
      if (len >= MIN_LENGTH) {
        if (dy <= TOLERANCE && dx > dy) {
          // Horizontal line — record average y for robustness
          hLines.push({ y: (cur.y + ey) / 2 });
        } else if (dx <= TOLERANCE && dy > dx) {
          // Vertical line — record average x for robustness
          vLines.push({ x: (cur.x + ex) / 2 });
        }
      }
      cur = { x: ex, y: ey };
    }
  }

  return { hLines, vLines };
}

// ── Median grid spacing (internal helper) ─────────────────────────────────────────────────────

/**
 * Compute median consecutive spacing for a sorted list of grid line positions.
 * Filters out near-zero spacings (< 5) caused by duplicate stroke+fill emissions.
 *
 * @param {Array<object>} lines  Array of objects with the position key
 * @param {string} posKey  Property name ('x' for vertical, 'y' for horizontal)
 * @returns {number|null}  Median spacing in PDF points, or null if < 2 lines
 */
function medianGridSpacing(lines, posKey) {
  if (lines.length < 2) return null;
  const sorted = [...lines].sort((a, b) => a[posKey] - b[posKey]);
  const spacings = [];
  for (let i = 1; i < sorted.length; i++) {
    spacings.push(sorted[i][posKey] - sorted[i - 1][posKey]);
  }
  // Filter near-zero spacings from duplicate emissions
  const valid = spacings.filter(s => s > 5);
  if (valid.length === 0) return null;
  valid.sort((a, b) => a - b);
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 === 0
    ? (valid[mid - 1] + valid[mid]) / 2
    : valid[mid];
}

// ── Scale factor computation ──────────────────────────────────────────────────────────────────

/**
 * Compute scale factor (meters per PDF point) from UTM grid line spacing.
 * Formula: scaleFactor = 50 / medianGridSpacing (50m UTM grid at any PDF scale).
 * Uses median of h+v spacings combined to reject outliers (D-REV-07).
 *
 * @param {Array<Array<import('../construct-path-parser.js').PathOp>>} utmPathArrays
 *   All UTM layer path arrays for one page. PathOps must have flipY already applied.
 * @param {string[]} warnings  Mutable warnings accumulator
 * @returns {number|null}  Scale factor in meters/pt, or null if no valid grid found
 */
export function computeScaleFactor(utmPathArrays, warnings) {
  if (!utmPathArrays || utmPathArrays.length === 0) return null;

  // Flatten all PathOps from all arrays
  const allOps = utmPathArrays.flat();

  const { hLines, vLines } = classifyGridLinesFromOps(allOps);

  const spacings = [];
  const hSpacing = medianGridSpacing(hLines, 'y');
  const vSpacing = medianGridSpacing(vLines, 'x');

  if (hSpacing !== null) spacings.push(hSpacing);
  if (vSpacing !== null) spacings.push(vSpacing);

  if (spacings.length === 0) return null;

  // Median of h + v spacings combined
  spacings.sort((a, b) => a - b);
  const mid = Math.floor(spacings.length / 2);
  const medianSpacing = spacings.length % 2 === 0
    ? (spacings[mid - 1] + spacings[mid]) / 2
    : spacings[mid];

  // Range check (T-02-03-01): reject clearly degenerate spacings.
  // Lower bound 5pt: avoids duplicate-stroke false positives (after >5 filter in medianGridSpacing).
  // Upper bound 5000pt: handles any realistic PDF scale for a 50m UTM grid.
  if (medianSpacing < 5 || medianSpacing > 5000) {
    warnings.push(
      `UTM grid spacing out of expected range: ${medianSpacing.toFixed(2)} PDF pts ` +
      `(expected 5–5000 pts for 50m grid at any PDF scale). Scale factor not computed.`
    );
    return null;
  }

  return 50 / medianSpacing;
}

// ── Per-page affine transforms ────────────────────────────────────────────────────────────────

/**
 * Build per-detail-page UTM affine transforms from post #1 GPS and page-2 viewport geometry.
 * Returns a Map from pageNum to { origin_e, origin_n, x_scale_sf, y_scale_sf, zone }.
 *
 * @param {{ x: number, y: number, pageNum: number, lat: number, lon: number }} post1
 *   Post #1 with GPS (user-provided) and page-local flipY coords.
 * @param {Map<number, { w: number, h: number }>} pageDimensions  page.view[2]/[3] per page
 * @param {Array<{ pageNum: number, rect: { x: number, y: number, w: number, h: number } }>} viewportBoxes
 *   Page-2 viewport boxes in flipY space, keyed by detail page number.
 * @param {number} scaleFactor  Meters per page-2 PDF point (from computeScaleFactor)
 * @param {number} zone  UTM zone (auto-detected from post1 longitude)
 * @param {string[]} [warnings]  Optional mutable warnings accumulator
 * @returns {Map<number, { origin_e: number, origin_n: number, x_scale_sf: number, y_scale_sf: number, zone: number }>}
 */
export function buildPageTransforms(post1, pageDimensions, viewportBoxes, scaleFactor, zone, warnings = []) {
  const transforms = new Map();

  // Step 1: Convert post #1 GPS to UTM
  const { easting: e1, northing: n1 } = latLonToUtm(post1.lat, post1.lon);

  // Step 2: Find viewport box for post1's detail page
  const box_pk = viewportBoxes.find(v => v.pageNum === post1.pageNum);
  if (!box_pk) {
    warnings.push(
      `buildPageTransforms: no viewport box found for post #1 page ${post1.pageNum}. ` +
      `Cannot establish page-2 UTM transform.`
    );
    return transforms; // empty Map
  }

  // Step 3: Project post1 from its page-local coords into page-2 flipY space
  const pageDim_pk = pageDimensions.get(post1.pageNum);
  if (!pageDim_pk) {
    warnings.push(
      `buildPageTransforms: no pageDimensions for post #1 page ${post1.pageNum}.`
    );
    return transforms;
  }

  const x1_p2 = box_pk.rect.x + (post1.x / pageDim_pk.w) * box_pk.rect.w;
  const y1_p2 = box_pk.rect.y + (post1.y / pageDim_pk.h) * box_pk.rect.h;

  // Step 4: For each viewport box (each detail page K), compute UTM origin
  for (const v of viewportBoxes) {
    const pageDim_K = pageDimensions.get(v.pageNum);
    if (!pageDim_K) {
      warnings.push(
        `buildPageTransforms: no pageDimensions for page ${v.pageNum}. Skipping.`
      );
      continue;
    }

    const box_K = v.rect;
    // UTM origin at top-left of page K's viewport box (in page-2 flipY space)
    const origin_e = e1 + (box_K.x - x1_p2) * scaleFactor;
    const origin_n = n1 - (box_K.y - y1_p2) * scaleFactor; // negative: down = south

    // Combined scale: page-K local coords → page-2 coords → meters
    const x_scale_sf = (box_K.w / pageDim_K.w) * scaleFactor;
    const y_scale_sf = (box_K.h / pageDim_K.h) * scaleFactor;

    transforms.set(v.pageNum, { origin_e, origin_n, x_scale_sf, y_scale_sf, zone });
  }

  return transforms;
}

// ── Post GPS projection ───────────────────────────────────────────────────────────────────────

/**
 * Project a post from page-local flipY PDF coordinates to GPS (lat/lon).
 *
 * @param {number} px  Post x in page-local flipY coords
 * @param {number} py  Post y in page-local flipY coords
 * @param {{ origin_e: number, origin_n: number, x_scale_sf: number, y_scale_sf: number, zone: number }} pageTransform
 * @returns {{ lat: number, lon: number }}
 */
export function projectPost(px, py, pageTransform) {
  const { origin_e, origin_n, x_scale_sf, y_scale_sf, zone } = pageTransform;
  const e = origin_e + px * x_scale_sf;
  const n = origin_n - py * y_scale_sf; // negative: down page = south = less northing
  return utmToLatLon(e, n, zone);
}

// ── Haversine distance ────────────────────────────────────────────────────────────────────────

/**
 * Great-circle distance between two GPS points using the haversine formula.
 * Accurate to < 0.5% for distances up to a few hundred km.
 *
 * @param {number} lat1  Decimal degrees
 * @param {number} lon1  Decimal degrees
 * @param {number} lat2  Decimal degrees
 * @param {number} lon2  Decimal degrees
 * @returns {number}  Distance in meters
 */
export function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const dPhi   = (lat2 - lat1) * Math.PI / 180;
  const dLambda = (lon2 - lon1) * Math.PI / 180;
  // Use a2 to avoid shadowing the WGS-84 semi-major axis constant 'a'
  const a2 = Math.sin(dPhi/2)**2 + Math.cos(phi1)*Math.cos(phi2)*Math.sin(dLambda/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a2), Math.sqrt(1 - a2));
}

// ── GPS bearing ───────────────────────────────────────────────────────────────────────────────

/**
 * Initial bearing from point 1 to point 2 (GPS vector bearing, 0–360°).
 * 0° = North, 90° = East, 180° = South, 270° = West.
 *
 * @param {number} lat1  Decimal degrees
 * @param {number} lon1  Decimal degrees
 * @param {number} lat2  Decimal degrees
 * @param {number} lon2  Decimal degrees
 * @returns {number}  Bearing in degrees (0–360)
 */
export function gpsBearing(lat1, lon1, lat2, lon2) {
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const dLambda = (lon2 - lon1) * Math.PI / 180;
  // Use y2/x2 to avoid shadowing globals
  const y2 = Math.sin(dLambda) * Math.cos(phi2);
  const x2 = Math.cos(phi1)*Math.sin(phi2) - Math.sin(phi1)*Math.cos(phi2)*Math.cos(dLambda);
  return ((Math.atan2(y2, x2) * 180 / Math.PI) + 360) % 360;
}
