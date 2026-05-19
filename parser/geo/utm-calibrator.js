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

// ── Per-page PDF rotation (N4) ───────────────────────────────────────────────────────────────

/**
 * Rotate flipY PDF coords before UTM scale/offset (north = −y).
 *
 * @param {number} px
 * @param {number} py
 * @param {number} [theta]  radians
 * @returns {{ rx: number, ry: number }}
 */
export function rotatePdfPoint(px, py, theta = 0) {
  if (!theta) return { rx: px, ry: py };
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return {
    rx: cos * px + sin * py,
    ry: -sin * px + cos * py,
  };
}

/**
 * Dominant orientation of UTM grid linework (weighted circular mean, mod π).
 *
 * @param {Array<import('../construct-path-parser.js').PathOp>} pathOps
 * @param {number} [minSegments]
 * @returns {number} radians; 0 when grid is near axis-aligned or too few segments
 */
export function dominantLineOrientation(pathOps, minSegments = 10) {
  if (!pathOps?.length) return 0;
  let sumC = 0;
  let sumS = 0;
  let count = 0;
  let cur = null;

  for (const op of pathOps) {
    if (op.type === 'M') {
      cur = { x: op.x, y: op.y };
    } else if (op.type === 'L' && cur) {
      const dx = op.x - cur.x;
      const dy = op.y - cur.y;
      const len = Math.hypot(dx, dy);
      if (len >= 2 && Math.abs(dx) >= Math.abs(dy) * 0.35) {
        const ang = Math.atan2(dy, dx);
        sumC += len * Math.cos(ang);
        sumS += len * Math.sin(ang);
        count++;
      }
      cur = { x: op.x, y: op.y };
    }
  }

  if (count < minSegments) return 0;
  const theta = Math.atan2(sumS, sumC);
  const deg = Math.abs(theta) * (180 / Math.PI);
  return deg >= 1 ? theta : 0;
}

/**
 * @param {number} px
 * @param {number} py
 * @param {{ origin_e: number, origin_n: number, x_scale_sf: number, y_scale_sf: number, theta?: number }} t
 * @returns {{ easting: number, northing: number }}
 */
export function utmFromPdfPoint(px, py, t) {
  if (t.affine) {
    const { m00, m01, m10, m11 } = t.affine;
    const pyNeg = -py;
    return {
      easting: t.origin_e + m00 * px + m01 * pyNeg,
      northing: t.origin_n + m10 * px + m11 * pyNeg,
    };
  }
  const { rx, ry } = rotatePdfPoint(px, py, t.theta ?? 0);
  return {
    easting: t.origin_e + rx * t.x_scale_sf,
    northing: t.origin_n - ry * t.y_scale_sf,
  };
}

/**
 * Inverse of {@link utmFromPdfPoint} for isotropic/rotated transforms (no affine matrix).
 *
 * @param {number} easting
 * @param {number} northing
 * @param {{ origin_e: number, origin_n: number, x_scale_sf: number, y_scale_sf: number, theta?: number, affine?: object }} t
 * @returns {{ x: number, y: number }|null}
 */
export function pdfPointFromUtm(easting, northing, t) {
  if (t.affine) return null;
  const sx = t.x_scale_sf;
  const sy = t.y_scale_sf;
  if (!sx || !sy) return null;
  const rx = (easting - t.origin_e) / sx;
  const ry = -(northing - t.origin_n) / sy;
  const theta = -(t.theta ?? 0);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return {
    x: cos * rx - sin * ry,
    y: sin * rx + cos * ry,
  };
}

// ── Grid line classification (internal helper) ────────────────────────────────────────────────

/**
 * Classify UTM grid line PathOps into horizontal and vertical lines.
 * PathOps must already have flipY applied — do NOT flip again.
 * When gridTheta is set, endpoints are aligned to grid axes first (inverse rotation).
 *
 * @param {Array<import('../construct-path-parser.js').PathOp>} pathOps  flipY applied
 * @param {number} [gridTheta]  page rotation (radians); 0 = page axes
 * @returns {{ hLines: Array<{ y: number }>, vLines: Array<{ x: number }> }}
 */
export function classifyGridLinesFromOps(pathOps, gridTheta = 0) {
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
      const c0 = gridTheta ? rotatePdfPoint(cur.x, cur.y, -gridTheta) : cur;
      const c1 = gridTheta ? rotatePdfPoint(ex, ey, -gridTheta) : { x: ex, y: ey };
      const dx = Math.abs(c1.x - c0.x);
      const dy = Math.abs(c1.y - c0.y);
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
export function medianGridSpacing(lines, posKey) {
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
 * @param {number} [gridTheta]  optional page rotation for H/V classification (N4)
 * @returns {number|null}  Scale factor in meters/pt, or null if no valid grid found
 */
export function computeScaleFactor(utmPathArrays, warnings, gridTheta = 0) {
  if (!utmPathArrays || utmPathArrays.length === 0) return null;

  // Flatten all PathOps from all arrays
  const allOps = utmPathArrays.flat();

  const { hLines, vLines } = classifyGridLinesFromOps(allOps, gridTheta);

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
 * Isotropic scale for a detail page: prefer that page's own UTM grid (true easting/northing),
 * else viewport-width ratio × overview scale (D-ACC-06).
 *
 * @param {number} pageNum
 * @param {{ w: number, h: number }} box_K
 * @param {{ w: number, h: number }} pageDim_K
 * @param {number} overviewScaleFactor  m/pt from page-2 UTM grid
 * @param {Map<number, Array<Array<import('../construct-path-parser.js').PathOp>>>|null} utmGridPathsPerPage
 * @param {string[]} warnings
 */
function detailPageScale(
  pageNum,
  box_K,
  pageDim_K,
  overviewScaleFactor,
  utmGridPathsPerPage,
  warnings,
  gridTheta = 0
) {
  const paths = utmGridPathsPerPage?.get(pageNum);
  if (paths?.length) {
    const sf = computeScaleFactor(paths, warnings, gridTheta);
    if (sf != null) return sf;
  }
  // Viewport-width ratio fallback when the page has no UTM grid (D-ACC-06)
  return (box_K.w / pageDim_K.w) * overviewScaleFactor;
}

/**
 * Build per-detail-page UTM affine transforms from post #1 GPS and page-2 viewport geometry.
 * Returns a Map from pageNum to { origin_e, origin_n, x_scale_sf, y_scale_sf, zone }.
 *
 * Isotropic per-page UTM scale: prefer each detail page's own UTM grid; fall back to
 * viewport-width ratio × page-2 overview scale only when the page has no UTM grid paths (D-ACC-06).
 *
 * @param {{ x: number, y: number, pageNum: number, lat: number, lon: number }} post1
 * @param {Map<number, { w: number, h: number }>} pageDimensions
 * @param {Array<{ pageNum: number, rect: { x: number, y: number, w: number, h: number } }>} viewportBoxes
 * @param {number} scaleFactor  Meters per page-2 PDF point (overview UTM grid)
 * @param {number} zone
 * @param {string[]} [warnings]
 * @param {Map<number, Array<Array<import('../construct-path-parser.js').PathOp>>>} [utmGridPathsPerPage]
 * @returns {Map<number, { origin_e: number, origin_n: number, x_scale_sf: number, y_scale_sf: number, theta: number, zone: number }>}
 */
export function buildPageTransforms(
  post1,
  pageDimensions,
  viewportBoxes,
  scaleFactor,
  zone,
  warnings = [],
  utmGridPathsPerPage = null
) {
  const transforms = new Map();

  /** @type {Map<number, number>} */
  const pageTheta = new Map();
  for (const v of viewportBoxes) {
    const paths = utmGridPathsPerPage?.get(v.pageNum);
    const theta =
      paths?.length ? dominantLineOrientation(paths.flat()) : 0;
    pageTheta.set(v.pageNum, theta);
    if (theta !== 0) {
      warnings.push(
        `[utm-rotation] Page ${v.pageNum}: grid orientation θ=${((theta * 180) / Math.PI).toFixed(2)}° from UTM linework.`
      );
    }
  }
  const anchorTheta = pageTheta.get(post1.pageNum) ?? 0;

  console.debug('[utm-calibrator] buildPageTransforms called:',
    `post1.pageNum=${post1.pageNum} post1.x=${post1.x?.toFixed(2)} post1.y=${post1.y?.toFixed(2)}`,
    `scaleFactor=${scaleFactor?.toFixed(6)} zone=${zone}`,
    `viewportBoxes.length=${viewportBoxes?.length}`,
    `pageDimensions.size=${pageDimensions?.size}`
  );

  const { easting: e1, northing: n1 } = latLonToUtm(post1.lat, post1.lon);

  const box_pk = viewportBoxes.find(v => v.pageNum === post1.pageNum);
  if (!box_pk) {
    warnings.push(
      `buildPageTransforms: no viewport box found for post #1 page ${post1.pageNum}. ` +
      `Cannot establish page-2 UTM transform.`
    );
    return transforms;
  }

  const pageDim_pk = pageDimensions.get(post1.pageNum);
  if (!pageDim_pk) {
    warnings.push(`buildPageTransforms: no pageDimensions for post #1 page ${post1.pageNum}.`);
    return transforms;
  }

  const rect_pk = box_pk.rect;
  const scale_pk = detailPageScale(
    post1.pageNum,
    rect_pk,
    pageDim_pk,
    scaleFactor,
    utmGridPathsPerPage,
    warnings,
    anchorTheta
  );

  const { rx: rx1, ry: ry1 } = rotatePdfPoint(post1.x, post1.y, anchorTheta);
  const origin_e_pk = e1 - rx1 * scale_pk;
  const origin_n_pk = n1 + ry1 * scale_pk;

  for (const v of viewportBoxes) {
    const pageDim_K = pageDimensions.get(v.pageNum);
    if (!pageDim_K) {
      warnings.push(`buildPageTransforms: no pageDimensions for page ${v.pageNum}. Skipping.`);
      continue;
    }

    let theta = pageTheta.get(v.pageNum) ?? 0;
    if (theta === 0 && v.pageNum !== post1.pageNum) {
      theta = anchorTheta;
    }

    const box_K = v.rect;
    const scale_K = detailPageScale(
      v.pageNum,
      box_K,
      pageDim_K,
      scaleFactor,
      utmGridPathsPerPage,
      warnings,
      theta
    );
    const x_scale_sf = scale_K;
    const y_scale_sf = scale_K;

    const origin_e = origin_e_pk + (box_K.x - rect_pk.x) * scaleFactor;
    const origin_n = origin_n_pk - (box_K.y - rect_pk.y) * scaleFactor;

    console.debug(`[utm-calibrator] page ${v.pageNum} transform:`,
      `origin_e=${origin_e.toFixed(3)} origin_n=${origin_n.toFixed(3)}`,
      `iso_sf=${scale_K.toFixed(6)} theta=${theta.toFixed(4)}`
    );
    transforms.set(v.pageNum, {
      origin_e,
      origin_n,
      x_scale_sf,
      y_scale_sf,
      theta,
      zone,
    });
  }

  return transforms;
}

// ── Boundary-locked page origins (approach 1) ───────────────────────────────────────────────

/**
 * Re-anchor a detail page so `(px, py)` projects to the given GPS.
 *
 * @param {Map<number, object>} transforms
 * @param {number} pageNum
 * @param {number} px
 * @param {number} py
 * @param {number} lat
 * @param {number} lon
 * @returns {boolean}
 */
export function lockPageOriginAtGps(transforms, pageNum, px, py, lat, lon) {
  const t = transforms.get(pageNum);
  if (!t) return false;
  const { easting, northing, zone } = latLonToUtm(lat, lon);
  if (t.affine) {
    const { m00, m01, m10, m11 } = t.affine;
    const pyNeg = -py;
    transforms.set(pageNum, {
      ...t,
      origin_e: easting - (m00 * px + m01 * pyNeg),
      origin_n: northing - (m10 * px + m11 * pyNeg),
      zone,
    });
  } else {
    const { rx, ry } = rotatePdfPoint(px, py, t.theta ?? 0);
    transforms.set(pageNum, {
      ...t,
      origin_e: easting - rx * t.x_scale_sf,
      origin_n: northing + ry * t.y_scale_sf,
      zone,
    });
  }
  return true;
}

/** @param {{ anchorX?: number, anchorY?: number, x: number, y: number }} post */
function postPdfPos(post) {
  return { x: post.x, y: post.y };
}

/**
 * At each cross-page labeled segment, walk GPS from the previous sheet using in-page
 * exit bearing, then lock the incoming page origin so the first post on that sheet matches.
 *
 * @param {Map<number, object>} transforms
 * @param {Array} sortedPosts
 * @param {Map<string, number>} distMap
 * @param {{ lat: number, lon: number }} post1Gps
 * @param {string[]} warnings
 * @returns {number} pages adjusted
 */
export function adjustPageOriginsAtBoundaries(
  transforms,
  sortedPosts,
  distMap,
  post1Gps,
  warnings
) {
  if (transforms.size < 2 || !sortedPosts?.length || !distMap?.size) return 0;

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
      const prevPrev = sorted[i - 2];
      bearing =
        prevPrev && prevPrev.pageNum === prev.pageNum
          ? pdfBearing(prevPrev, prev)
          : pdfBearing(prev, curr);
    }

    const next = destinationPoint(lat, lon, bearing, m);
    lat = next.lat;
    lon = next.lon;

    if (!crossPage) continue;

    const pos = postPdfPos(curr);
    if (lockPageOriginAtGps(transforms, curr.pageNum, pos.x, pos.y, lat, lon)) {
      adjusted++;
    }
  }

  if (adjusted > 0) {
    warnings.push(
      `[boundary-locked] ${adjusted} page origin(s) aligned at sheet breaks using labeled distances.`
    );
  }
  return adjusted;
}

// ── Post GPS projection ───────────────────────────────────────────────────────────────────────

/**
 * Project a post from page-local flipY PDF coordinates to GPS (lat/lon).
 *
 * @param {number} px  Post x in page-local flipY coords
 * @param {number} py  Post y in page-local flipY coords
 * @param {{ origin_e: number, origin_n: number, x_scale_sf: number, y_scale_sf: number, theta?: number, zone: number }} pageTransform
 * @returns {{ lat: number, lon: number }}
 */
export function projectPost(px, py, pageTransform) {
  const { easting, northing } = utmFromPdfPoint(px, py, pageTransform);
  return utmToLatLon(easting, northing, pageTransform.zone);
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

/**
 * Destination point given start, initial bearing, and ground distance (haversine direct).
 *
 * @param {number} lat_deg
 * @param {number} lon_deg
 * @param {number} bearing_deg  0–360, 0 = north
 * @param {number} distance_m
 * @returns {{ lat: number, lon: number }}
 */
export function destinationPoint(lat_deg, lon_deg, bearing_deg, distance_m) {
  const R = 6371000;
  const br = bearing_deg * Math.PI / 180;
  const lat1 = lat_deg * Math.PI / 180;
  const lon1 = lon_deg * Math.PI / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(distance_m / R) +
    Math.cos(lat1) * Math.sin(distance_m / R) * Math.cos(br)
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(br) * Math.sin(distance_m / R) * Math.cos(lat1),
    Math.cos(distance_m / R) - Math.sin(lat1) * Math.sin(lat2)
  );
  return { lat: lat2 * 180 / Math.PI, lon: lon2 * 180 / Math.PI };
}
