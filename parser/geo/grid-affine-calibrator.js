// parser/geo/grid-affine-calibrator.js
// N5: per-page 2×2 affine from UTM grid intersections (relative 50 m indexing).

import {
  classifyGridLinesFromOps,
  medianGridSpacing,
  computeScaleFactor,
  utmFromPdfPoint,
  latLonToUtm,
} from './utm-calibrator.js';

const GRID_METERS = 50;
const DEDUPE_PT = 2;
const MIN_INTERSECTIONS = 4;
const MAX_RMSE_PER_POINT_M = 2;

/**
 * @param {Array<{ x?: number, y?: number }>} lines
 * @param {'x'|'y'} posKey
 * @param {number} tolerance
 */
function dedupeLinePositions(lines, posKey, tolerance = DEDUPE_PT) {
  const sorted = [...lines].sort((a, b) => a[posKey] - b[posKey]);
  /** @type {Array<{ x?: number, y?: number }>} */
  const merged = [];
  for (const line of sorted) {
    const val = line[posKey];
    if (val == null) continue;
    if (
      merged.length &&
      Math.abs(val - merged[merged.length - 1][posKey]) <= tolerance
    ) {
      continue;
    }
    merged.push({ [posKey]: val });
  }
  return merged;
}

/**
 * @param {Array<{ x: number, y: number, eRel: number, nRel: number }>} points
 * @param {number} tolerance
 */
function dedupeIntersections(points, tolerance = DEDUPE_PT) {
  /** @type {typeof points} */
  const out = [];
  for (const p of points) {
    if (out.some(q => Math.hypot(q.x - p.x, q.y - p.y) <= tolerance)) continue;
    out.push(p);
  }
  return out;
}

/**
 * @param {Array<Array<import('../construct-path-parser.js').PathOp>>} utmPathArrays
 * @param {number} gridTheta
 * @returns {Array<{ x: number, y: number, eRel: number, nRel: number }>}
 */
export function buildGridControlPoints(utmPathArrays, gridTheta = 0) {
  if (!utmPathArrays?.length) return [];
  const allOps = utmPathArrays.flat();
  const { hLines, vLines } = classifyGridLinesFromOps(allOps, gridTheta);
  const hDedup = dedupeLinePositions(hLines, 'y');
  const vDedup = dedupeLinePositions(vLines, 'x');
  if (hDedup.length < 2 || vDedup.length < 2) return [];

  const hSpacing = medianGridSpacing(hDedup, 'y');
  const vSpacing = medianGridSpacing(vDedup, 'x');
  if (hSpacing == null || vSpacing == null) return [];

  const hSorted = [...hDedup].sort((a, b) => a.y - b.y);
  const vSorted = [...vDedup].sort((a, b) => a.x - b.x);
  const y0 = hSorted[0].y;
  const x0 = vSorted[0].x;

  /** @type {Array<{ x: number, y: number, eRel: number, nRel: number }>} */
  const raw = [];
  for (let vi = 0; vi < vSorted.length; vi++) {
    const vx = vSorted[vi].x;
    const eRel = ((vx - x0) / vSpacing) * GRID_METERS;
    for (let hi = 0; hi < hSorted.length; hi++) {
      const hy = hSorted[hi].y;
      const nRel = ((hy - y0) / hSpacing) * GRID_METERS;
      raw.push({ x: vx, y: hy, eRel, nRel });
    }
  }
  return dedupeIntersections(raw);
}

/**
 * @param {number[][]} A
 * @param {number[]} b
 * @returns {number[]|null}
 */
function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];

    for (let row = col + 1; row < n; row++) {
      const f = M[row][col] / M[col][col];
      for (let j = col; j <= n; j++) M[row][j] -= f * M[col][j];
    }
  }

  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

/**
 * [e,n]_rel = M · [px, -py]  (4 unknowns: m00, m01, m10, m11).
 *
 * @param {Array<{ x: number, y: number, eRel: number, nRel: number }>} controls
 * @returns {{ m00: number, m01: number, m10: number, m11: number }|null}
 */
export function solveAffinePdfToUtm(controls) {
  if (controls.length < MIN_INTERSECTIONS) return null;

  const rows = controls.length * 2;
  const A = Array.from({ length: rows }, () => new Array(4).fill(0));
  const b = new Array(rows).fill(0);

  for (let i = 0; i < controls.length; i++) {
    const { x, y, eRel, nRel } = controls[i];
    const py = -y;
    A[i * 2] = [x, py, 0, 0];
    b[i * 2] = eRel;
    A[i * 2 + 1] = [0, 0, x, py];
    b[i * 2 + 1] = nRel;
  }

  const AtA = Array.from({ length: 4 }, () => new Array(4).fill(0));
  const Atb = new Array(4).fill(0);
  for (let r = 0; r < rows; r++) {
    for (let j = 0; j < 4; j++) {
      Atb[j] += A[r][j] * b[r];
      for (let k = 0; k < 4; k++) AtA[j][k] += A[r][j] * A[r][k];
    }
  }

  const x = solveLinear(AtA, Atb);
  if (!x) return null;
  const [m00, m01, m10, m11] = x;
  if (![m00, m01, m10, m11].every(Number.isFinite)) return null;
  return { m00, m01, m10, m11 };
}

/**
 * @param {Array<{ x: number, y: number, eRel: number, nRel: number }>} controls
 * @param {{ m00: number, m01: number, m10: number, m11: number }} M
 */
function affineFitRmse(controls, M) {
  let sum = 0;
  for (const { x, y, eRel, nRel } of controls) {
    const py = -y;
    const e = M.m00 * x + M.m01 * py;
    const n = M.m10 * x + M.m11 * py;
    sum += (e - eRel) ** 2 + (n - nRel) ** 2;
  }
  return Math.sqrt(sum / controls.length);
}

/**
 * @param {Array<{ x: number, y: number, eRel: number, nRel: number }>} controls
 * @param {{ origin_e: number, origin_n: number, x_scale_sf: number, y_scale_sf: number, theta?: number }} thumb
 */
function thumbnailFitRmse(controls, thumb) {
  const u0 = utmFromPdfPoint(controls[0].x, controls[0].y, thumb);
  let sum = 0;
  for (const { x, y, eRel, nRel } of controls) {
    const u = utmFromPdfPoint(x, y, thumb);
    const de = u.easting - u0.easting - eRel;
    const dn = u.northing - u0.northing - nRel;
    sum += de * de + dn * dn;
  }
  return Math.sqrt(sum / controls.length);
}

/**
 * @param {Array<Array<import('../construct-path-parser.js').PathOp>>} utmPathArrays
 * @param {number} gridTheta
 * @param {{ x: number, y: number }|null} anchorPdf  post #1 on anchor page, else grid corner via thumb
 * @param {{ easting: number, northing: number }|null} anchorUtm
 * @param {{ origin_e: number, origin_n: number, x_scale_sf: number, y_scale_sf: number, theta?: number, zone: number }} thumbTransform
 * @param {string[]} warnings
 * @returns {{ transform: object, rmse: number, thumbRmse: number, maxErr: number }|null}
 */
export function calibratePageFromGridAffine(
  utmPathArrays,
  gridTheta,
  anchorPdf,
  anchorUtm,
  thumbTransform,
  warnings
) {
  const controls = buildGridControlPoints(utmPathArrays, gridTheta);
  if (controls.length < MIN_INTERSECTIONS) return null;

  const M = solveAffinePdfToUtm(controls);
  if (!M) return null;

  let origin_e;
  let origin_n;
  if (anchorPdf && anchorUtm) {
    const py1 = -anchorPdf.y;
    origin_e = anchorUtm.easting - (M.m00 * anchorPdf.x + M.m01 * py1);
    origin_n = anchorUtm.northing - (M.m10 * anchorPdf.x + M.m11 * py1);
  } else {
    const c0 = controls[0];
    const py0 = -c0.y;
    const u0 = utmFromPdfPoint(c0.x, c0.y, thumbTransform);
    origin_e = u0.easting - (M.m00 * c0.x + M.m01 * py0);
    origin_n = u0.northing - (M.m10 * c0.x + M.m11 * py0);
  }

  const iso =
    thumbTransform.x_scale_sf ??
    computeScaleFactor(utmPathArrays, warnings, gridTheta) ??
    0.2;

  const transform = {
    origin_e,
    origin_n,
    x_scale_sf: iso,
    y_scale_sf: iso,
    theta: 0,
    zone: thumbTransform.zone,
    affine: M,
  };

  let maxErr = 0;
  for (const c of controls) {
    const py = -c.y;
    const e = M.m00 * c.x + M.m01 * py;
    const n = M.m10 * c.x + M.m11 * py;
    maxErr = Math.max(maxErr, Math.hypot(e - c.eRel, n - c.nRel));
  }
  if (anchorPdf && anchorUtm) {
    const u1 = utmFromPdfPoint(anchorPdf.x, anchorPdf.y, transform);
    maxErr = Math.max(
      maxErr,
      Math.hypot(u1.easting - anchorUtm.easting, u1.northing - anchorUtm.northing)
    );
  }

  const rmse = affineFitRmse(controls, M);
  const thumbRmse = thumbnailFitRmse(controls, thumbTransform);

  if (rmse >= thumbRmse || maxErr > MAX_RMSE_PER_POINT_M) return null;

  return {
    transform,
    rmse,
    thumbRmse,
    maxErr,
    controlCount: controls.length,
  };
}

/**
 * Try N5 affine per page; replaces thumbnail transform when residual is lower (G-1 safe).
 *
 * @param {Map<number, object>} transforms
 * @param {{ x: number, y: number, pageNum: number, lat: number, lon: number }} post1
 * @param {Map<number, Array<Array<import('../construct-path-parser.js').PathOp>>>} utmGridPathsPerPage
 * @param {string[]} warnings
 * @returns {number} pages upgraded to affine
 */
export function applyGridAffineToTransforms(
  transforms,
  post1,
  utmGridPathsPerPage,
  warnings
) {
  if (!transforms?.size || !utmGridPathsPerPage?.size) return 0;

  const { easting: e1, northing: n1 } = latLonToUtm(post1.lat, post1.lon);
  let upgraded = 0;

  for (const [pageNum, thumbTransform] of transforms) {
    const paths = utmGridPathsPerPage.get(pageNum);
    if (!paths?.length) continue;

    const theta = thumbTransform.theta ?? 0;
    const isAnchorPage = pageNum === post1.pageNum;
    const n5 = calibratePageFromGridAffine(
      paths,
      theta,
      isAnchorPage ? { x: post1.x, y: post1.y } : null,
      isAnchorPage ? { easting: e1, northing: n1 } : null,
      thumbTransform,
      warnings
    );
    if (!n5) continue;

    transforms.set(pageNum, n5.transform);
    upgraded++;
    warnings.push(
      `[grid-affine] Page ${pageNum}: N5 affine fit RMSE ${n5.rmse.toFixed(3)} m ` +
        `(thumbnail ${n5.thumbRmse.toFixed(3)} m, max ${n5.maxErr.toFixed(3)} m, ` +
        `${n5.controlCount} grid intersections).`
    );
  }

  return upgraded;
}
