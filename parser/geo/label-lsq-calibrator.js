// parser/geo/label-lsq-calibrator.js
// Approach 3: global least-squares fit of per-page UTM origins to Distância_Poste labels.

import { latLonToUtm, rotatePdfPoint, utmFromPdfPoint } from './utm-calibrator.js';

/** @param {{ anchorX?: number, anchorY?: number, x: number, y: number }} post */
function postPdfPos(post) {
  return { x: post.x, y: post.y };
}

/**
 * @param {{ x: number, y: number }} p
 * @param {{ x_scale_sf: number, y_scale_sf: number, theta?: number }} t
 * @param {{ origin_e: number, origin_n: number }} o
 */
function utmAtPost(p, t, o) {
  if (t.affine) {
    return utmFromPdfPoint(p.x, p.y, { ...t, origin_e: o.origin_e, origin_n: o.origin_n });
  }
  const { rx, ry } = rotatePdfPoint(p.x, p.y, t.theta ?? 0);
  return {
    easting: o.origin_e + rx * t.x_scale_sf,
    northing: o.origin_n - ry * t.y_scale_sf,
  };
}

/** ∂(easting,northing)/∂θ for rotatePdfPoint (N4). */
function utmThetaJacobian(px, py, theta, scale, axis) {
  const sin = Math.sin(theta);
  const cos = Math.cos(theta);
  const drx = -sin * px + cos * py;
  const dry = -cos * px - sin * py;
  if (axis === 'e') return drx * scale;
  return -dry * scale;
}

/**
 * Solve Ax = b by Gaussian elimination with partial pivoting.
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

function rmse(residuals) {
  if (residuals.length === 0) return 0;
  let s = 0;
  for (const v of residuals) s += v * v;
  return Math.sqrt(s / residuals.length);
}

/**
 * Refine per-page UTM origins so labeled segment lengths match UTM Euclidean distance.
 * Post #1 page origin stays fixed to the user anchor; other pages are free variables.
 *
 * @param {Map<number, { origin_e: number, origin_n: number, x_scale_sf: number, y_scale_sf: number, zone: number }>} transforms
 * @param {Array<{ number: number, x: number, y: number, pageNum?: number, anchorX?: number, anchorY?: number }>} sortedPosts
 * @param {Map<string, number>} distMap
 * @param {{ lat: number, lon: number }} post1Gps
 * @param {string[]} warnings
 * @returns {{ adjusted: number, rmseBefore: number|null, rmseAfter: number|null }}
 */
export function refinePageOriginsByLabelLsq(transforms, sortedPosts, distMap, post1Gps, warnings) {
  const sorted = [...sortedPosts].sort((a, b) => a.number - b.number);
  if (sorted.length < 2 || transforms.size < 2) {
    return { adjusted: 0, rmseBefore: null, rmseAfter: null, improved: false };
  }

  /** @type {Array<{ prev: typeof sorted[0], curr: typeof sorted[0], m: number }>} */
  const segments = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const prev = sorted[i];
    const curr = sorted[i + 1];
    const m = distMap.get(`${prev.number}->${curr.number}`);
    if (m != null && m > 0) segments.push({ prev, curr, m });
  }

  if (segments.length < 3) {
    return { adjusted: 0, rmseBefore: null, rmseAfter: null, improved: false };
  }

  const post1 = sorted[0];
  const anchorPage = post1.pageNum;
  if (anchorPage == null || !transforms.has(anchorPage)) {
    return { adjusted: 0, rmseBefore: null, rmseAfter: null, improved: false };
  }

  const pos1 = postPdfPos(post1);
  const { easting: e1, northing: n1 } = latLonToUtm(post1Gps.lat, post1Gps.lon);
  const tAnchor = transforms.get(anchorPage);
  const { rx: rx1, ry: ry1 } = rotatePdfPoint(pos1.x, pos1.y, tAnchor.theta ?? 0);

  /** @type {Map<number, { origin_e: number, origin_n: number }>} */
  const origins = new Map();
  for (const [pn, t] of transforms) {
    if (pn === anchorPage) {
      origins.set(pn, {
        origin_e: e1 - rx1 * tAnchor.x_scale_sf,
        origin_n: n1 + ry1 * tAnchor.y_scale_sf,
      });
    } else {
      origins.set(pn, { origin_e: t.origin_e, origin_n: t.origin_n });
    }
  }

  const freePages = [...transforms.keys()].filter(p => p !== anchorPage).sort((a, b) => a - b);
  if (freePages.length === 0) {
    return { adjusted: 0, rmseBefore: null, rmseAfter: null, improved: false };
  }

  const pageIndex = new Map(freePages.map((p, i) => [p, i]));
  const varsPerPage = 3;

  function evalResiduals() {
    const r = new Array(segments.length);
    for (let k = 0; k < segments.length; k++) {
      const { prev, curr, m } = segments[k];
      const tp = transforms.get(prev.pageNum);
      const tc = transforms.get(curr.pageNum);
      const op = origins.get(prev.pageNum);
      const oc = origins.get(curr.pageNum);
      const uI = utmAtPost(postPdfPos(prev), tp, op);
      const uJ = utmAtPost(postPdfPos(curr), tc, oc);
      r[k] = Math.hypot(uJ.easting - uI.easting, uJ.northing - uI.northing) - m;
    }
    return r;
  }

  function evalResidualsAndJacobian() {
    const nSeg = segments.length;
    const nVar = freePages.length * varsPerPage;
    const r = new Array(nSeg);
    const J = Array.from({ length: nSeg }, () => new Float64Array(nVar));

    for (let k = 0; k < nSeg; k++) {
      const { prev, curr, m } = segments[k];
      const pp = postPdfPos(prev);
      const pc = postPdfPos(curr);
      const tp = transforms.get(prev.pageNum);
      const tc = transforms.get(curr.pageNum);
      const op = origins.get(prev.pageNum);
      const oc = origins.get(curr.pageNum);

      const uI = utmAtPost(pp, tp, op);
      const uJ = utmAtPost(pc, tc, oc);

      const dE = uJ.easting - uI.easting;
      const dN = uJ.northing - uI.northing;
      const d = Math.hypot(dE, dN);
      r[k] = d - m;
      if (d < 1e-6) continue;

      const uE = dE / d;
      const uN = dN / d;

      const pi = pageIndex.get(prev.pageNum);
      if (pi != null) {
        const vi = pi * varsPerPage;
        J[k][vi] = -uE;
        J[k][vi + 1] = -uN;
        if (!tp?.affine) {
          const th = tp.theta ?? 0;
          J[k][vi + 2] =
            -uE * utmThetaJacobian(pp.x, pp.y, th, tp.x_scale_sf, 'e') +
            -uN * utmThetaJacobian(pp.x, pp.y, th, tp.y_scale_sf, 'n');
        }
      }
      const pj = pageIndex.get(curr.pageNum);
      if (pj != null) {
        const vj = pj * varsPerPage;
        J[k][vj] += uE;
        J[k][vj + 1] += uN;
        if (!tc?.affine) {
          const th = tc.theta ?? 0;
          J[k][vj + 2] +=
            uE * utmThetaJacobian(pc.x, pc.y, th, tc.x_scale_sf, 'e') +
            uN * utmThetaJacobian(pc.x, pc.y, th, tc.y_scale_sf, 'n');
        }
      }
    }
    return { r, J };
  }

  const rmseBefore = rmse(evalResiduals());
  /** @type {Map<number, { origin_e: number, origin_n: number, theta: number }>} */
  const initialState = new Map();
  for (const [pn, t] of transforms) {
    initialState.set(pn, {
      origin_e: t.origin_e,
      origin_n: t.origin_n,
      theta: t.theta ?? 0,
    });
  }

  let lambda = 1e-3;
  const maxIter = 50;

  let bestRmse = rmseBefore;

  for (let iter = 0; iter < maxIter; iter++) {
    const { r, J } = evalResidualsAndJacobian();
    const nVar = freePages.length * varsPerPage;

    const JtJ = Array.from({ length: nVar }, () => new Array(nVar).fill(0));
    const Jtr = new Array(nVar).fill(0);

    for (let k = 0; k < segments.length; k++) {
      for (let a = 0; a < nVar; a++) {
        Jtr[a] += J[k][a] * (-r[k]);
        for (let b = 0; b < nVar; b++) {
          JtJ[a][b] += J[k][a] * J[k][b];
        }
      }
    }
    for (let a = 0; a < nVar; a++) JtJ[a][a] += lambda;

    const delta = solveLinear(JtJ, Jtr);
    if (!delta) {
      lambda *= 10;
      continue;
    }

    for (let vi = 0; vi < freePages.length; vi++) {
      const p = freePages[vi];
      const o = origins.get(p);
      const t = transforms.get(p);
      o.origin_e += delta[vi * varsPerPage];
      o.origin_n += delta[vi * varsPerPage + 1];
      if (t && !t.affine) {
        t.theta = (t.theta ?? 0) + delta[vi * varsPerPage + 2];
      }
    }

    const trialRmse = rmse(evalResiduals());

    if (trialRmse < bestRmse - 0.01) {
      bestRmse = trialRmse;
      lambda = Math.max(lambda * 0.5, 1e-6);
      if (bestRmse < 0.5) break;
    } else {
      for (let vi = 0; vi < freePages.length; vi++) {
        const p = freePages[vi];
        const o = origins.get(p);
        const t = transforms.get(p);
        o.origin_e -= delta[vi * varsPerPage];
        o.origin_n -= delta[vi * varsPerPage + 1];
        if (t && !t.affine) {
          t.theta = (t.theta ?? 0) - delta[vi * varsPerPage + 2];
        }
      }
      lambda = Math.min(lambda * 5, 1e6);
    }
  }

  const rmseAfter = bestRmse;
  const improved = rmseBefore - rmseAfter > 0.05;

  const maxLsqThetaRad = (3 * Math.PI) / 180;

  if (improved) {
    for (const [pn, o] of origins) {
      const t = transforms.get(pn);
      if (t) {
        let theta = t.theta ?? 0;
        const snap = initialState.get(pn);
        if (snap && Math.abs(snap.theta) < 1e-6 && Math.abs(theta) > maxLsqThetaRad) {
          theta = 0;
        }
        transforms.set(pn, {
          ...t,
          origin_e: o.origin_e,
          origin_n: o.origin_n,
          theta,
        });
      }
    }
  } else {
    for (const [pn, snap] of initialState) {
      const t = transforms.get(pn);
      if (t) {
        transforms.set(pn, {
          ...t,
          origin_e: snap.origin_e,
          origin_n: snap.origin_n,
          theta: snap.theta,
        });
      }
    }
  }

  if (improved) {
    const thetaNote = freePages
      .map(p => {
        const th = transforms.get(p)?.theta ?? 0;
        return `p${p}=${((th * 180) / Math.PI).toFixed(2)}°`;
      })
      .join(', ');
    warnings.push(
      `[label-lsq] Global label fit: RMSE ${rmseBefore.toFixed(2)} m → ${rmseAfter.toFixed(2)} m ` +
        `(${segments.length} segments, ${freePages.length} page(s) adjusted; θ: ${thetaNote}).`
    );
  }

  return {
    adjusted: improved ? freePages.length : 0,
    rmseBefore,
    rmseAfter: improved ? rmseAfter : rmseBefore,
    improved,
  };
}

/**
 * Refine the anchor-page transform (scale + theta) using post 1 (true GPS) and the first
 * post on the page AFTER the anchor sheet (projected GPS after the global LSQ on free pages).
 *
 * Rationale: the global label LSQ excludes the anchor page from optimization. On multi-sheet
 * route detail drawings, the anchor sheet often has a 3–5° rotation against the UTM grid that
 * cannot be detected from labels alone (rotation-degenerate per page) but IS visible from
 * the cross-page chord to the first downstream post (whose UTM position is now well-fit by
 * the LSQ). We approximate the post-1 → post-K UTM bearing as the bearing of the cross-page
 * step at the sheet boundary, walk back by the labeled distance to estimate the last
 * anchor-sheet post's UTM, then do a 2-point Procrustes (post 1 + last anchor post) to
 * compute the page's scale and theta. Origin is recomputed to keep post 1 exactly pinned.
 *
 * Guards:
 *  - Anchor page must have ≥ 4 same-page posts (needs spatial spread for fit to make sense).
 *  - First downstream post must exist with non-null lat/lon (LSQ-fit projection).
 *  - Resulting theta must be within ±MAX_ANCHOR_REFINE_THETA_DEG of the initial theta.
 *  - Scale change must be within ±MAX_ANCHOR_REFINE_SCALE_FRAC of the initial scale.
 *  - Result is only applied if the anchor-page label RMSE improves OR stays within
 *    `RMSE_TOLERANCE_M` of the original; otherwise reverted to keep Valmor-like cases safe.
 *
 * @param {Map<number, { origin_e: number, origin_n: number, x_scale_sf: number, y_scale_sf: number, theta?: number, zone: number }>} transforms
 * @param {Array<{ number: number, x: number, y: number, pageNum?: number, lat?: number|null, lon?: number|null }>} sortedPosts
 * @param {Map<string, number|null>} distMap
 * @param {{ lat: number, lon: number }} post1Gps
 * @param {string[]} warnings
 * @returns {boolean}  true if anchor page was refined
 */
const MAX_ANCHOR_REFINE_THETA_DEG = 6;
const MAX_ANCHOR_REFINE_SCALE_FRAC = 0.06;
const ANCHOR_REFINE_RMSE_TOLERANCE_M = 0.5;

export function refineAnchorPageByDownstreamChord(
  transforms,
  sortedPosts,
  distMap,
  post1Gps,
  warnings,
) {
  const sorted = [...sortedPosts].sort((a, b) => a.number - b.number);
  if (sorted.length < 4) return false;

  const post1 = sorted[0];
  const anchorPage = post1.pageNum;
  if (anchorPage == null || !transforms.has(anchorPage)) return false;
  const tAnchor = transforms.get(anchorPage);
  if (tAnchor.affine) return false;

  const anchorPagePosts = sorted.filter(p => p.pageNum === anchorPage);
  if (anchorPagePosts.length < 4) return false;

  // Find the last post on the anchor page and the first post on the next page.
  // They MUST be consecutive in the route (post number K and K+1) to use the label.
  const lastOnAnchor = anchorPagePosts[anchorPagePosts.length - 1];
  const lastIdx = sorted.findIndex(p => p.number === lastOnAnchor.number);
  const firstDownstream = sorted[lastIdx + 1];
  if (
    !firstDownstream ||
    firstDownstream.pageNum === anchorPage ||
    firstDownstream.lat == null ||
    firstDownstream.lon == null
  ) {
    return false;
  }
  const labelKtoK1 = distMap.get(`${lastOnAnchor.number}->${firstDownstream.number}`);
  if (labelKtoK1 == null || labelKtoK1 <= 0) return false;

  // True UTM for post 1 (exact) and projected UTM for first-downstream (post-chain).
  const { easting: e1, northing: n1, zone: zone1 } = latLonToUtm(post1Gps.lat, post1Gps.lon);
  const { easting: eK1, northing: nK1 } = latLonToUtm(firstDownstream.lat, firstDownstream.lon);

  // Estimate UTM bearing of the chord (post 1 → post K+1), which approximates the chord
  // (post 1 → post K) on the anchor sheet (route nearly continues straight at the seam).
  const chordE = eK1 - e1;
  const chordN = nK1 - n1;
  const chordLen = Math.hypot(chordE, chordN);
  if (chordLen < labelKtoK1) return false;  // sanity: chord must be longer than the last segment
  const utmBrgRad = Math.atan2(chordE, chordN);

  // Walk back from first-downstream's UTM by label distance to estimate post K's UTM.
  const eKest = eK1 - labelKtoK1 * Math.sin(utmBrgRad);
  const nKest = nK1 - labelKtoK1 * Math.cos(utmBrgRad);

  // 2-point similarity fit on (post 1, post K):
  //   ΔE = u*Δx + v*Δy
  //   ΔN = -u*Δy + v*Δx           (utm-calibrator convention)
  // where (u, v) = (s*cosθ, s*sinθ).
  const dx = lastOnAnchor.x - post1.x;
  const dy = lastOnAnchor.y - post1.y;
  const det = dx * dx + dy * dy;
  if (det < 1) return false;
  const dE = eKest - e1;
  const dN = nKest - n1;
  const u = (dx * dE - dy * dN) / det;
  const v = (dy * dE + dx * dN) / det;
  const newScale = Math.hypot(u, v);
  const newTheta = Math.atan2(v, u);

  // Sanity check: don't accept extreme rotations or scale changes.
  const initialTheta = tAnchor.theta ?? 0;
  const initialScale = tAnchor.x_scale_sf;
  if (
    !Number.isFinite(newScale) ||
    !Number.isFinite(newTheta) ||
    newScale <= 0
  ) {
    return false;
  }
  if (Math.abs(newTheta - initialTheta) > (MAX_ANCHOR_REFINE_THETA_DEG * Math.PI) / 180) {
    warnings.push(
      `[anchor-refit] Page ${anchorPage}: theta change ${(((newTheta - initialTheta) * 180) / Math.PI).toFixed(2)}° exceeds ±${MAX_ANCHOR_REFINE_THETA_DEG}° guard — skipped.`,
    );
    return false;
  }
  if (Math.abs(newScale / initialScale - 1) > MAX_ANCHOR_REFINE_SCALE_FRAC) {
    warnings.push(
      `[anchor-refit] Page ${anchorPage}: scale change ${((newScale / initialScale - 1) * 100).toFixed(2)}% exceeds ±${(MAX_ANCHOR_REFINE_SCALE_FRAC * 100).toFixed(0)}% guard — skipped.`,
    );
    return false;
  }

  // Compute new origin so post 1's PDF projects exactly to (e1, n1).
  const c = Math.cos(newTheta);
  const s = Math.sin(newTheta);
  const rx1 = c * post1.x + s * post1.y;
  const ry1 = -s * post1.x + c * post1.y;
  const newOriginE = e1 - rx1 * newScale;
  const newOriginN = n1 + ry1 * newScale;

  // Trial: snapshot transforms, apply change, check label RMSE.
  const snapTransform = { ...tAnchor };
  const trial = {
    ...tAnchor,
    origin_e: newOriginE,
    origin_n: newOriginN,
    x_scale_sf: newScale,
    y_scale_sf: newScale,
    theta: newTheta,
    zone: zone1,
  };
  const rmseBefore = labelDistanceRmse(transforms, sorted, distMap);
  transforms.set(anchorPage, trial);
  const rmseAfter = labelDistanceRmse(transforms, sorted, distMap);
  if (
    rmseBefore != null &&
    rmseAfter != null &&
    rmseAfter > rmseBefore + ANCHOR_REFINE_RMSE_TOLERANCE_M
  ) {
    // Revert: refit worsened label residuals beyond tolerance.
    transforms.set(anchorPage, snapTransform);
    warnings.push(
      `[anchor-refit] Page ${anchorPage}: label RMSE worsened ${rmseBefore.toFixed(2)}→${rmseAfter.toFixed(2)}m (>${ANCHOR_REFINE_RMSE_TOLERANCE_M}m tolerance) — reverted.`,
    );
    return false;
  }

  warnings.push(
    `[anchor-refit] Page ${anchorPage}: refined scale ${initialScale.toFixed(6)}→${newScale.toFixed(6)} ` +
      `(×${(newScale / initialScale).toFixed(4)}), θ ${((initialTheta * 180) / Math.PI).toFixed(2)}°→${((newTheta * 180) / Math.PI).toFixed(2)}° ` +
      `using post 1 + post ${firstDownstream.number} chord (${chordLen.toFixed(1)}m); ` +
      `label RMSE ${rmseBefore?.toFixed(2) ?? '?'}→${rmseAfter?.toFixed(2) ?? '?'} m.`
  );
  return true;
}

/**
 * RMSE of (UTM chord length − label) over labeled consecutive post pairs.
 *
 * @param {Map<number, { origin_e: number, origin_n: number, x_scale_sf: number, y_scale_sf: number }>} transforms
 * @param {Array} sortedPosts
 * @param {Map<string, number|null>} distMap
 * @returns {number|null}
 */
export function labelDistanceRmse(transforms, sortedPosts, distMap) {
  const sorted = [...sortedPosts].sort((a, b) => a.number - b.number);
  if (sorted.length < 2 || transforms.size < 1) return null;

  const residuals = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const prev = sorted[i];
    const curr = sorted[i + 1];
    const m = distMap.get(`${prev.number}->${curr.number}`);
    if (m == null || m <= 0) continue;

    const tp = transforms.get(prev.pageNum);
    const tc = transforms.get(curr.pageNum);
    if (!tp || !tc) continue;

    const op = { origin_e: tp.origin_e, origin_n: tp.origin_n };
    const oc = { origin_e: tc.origin_e, origin_n: tc.origin_n };
    const uI = utmAtPost(postPdfPos(prev), tp, op);
    const uJ = utmAtPost(postPdfPos(curr), tc, oc);
    residuals.push(Math.hypot(uJ.easting - uI.easting, uJ.northing - uI.northing) - m);
  }
  return residuals.length ? rmse(residuals) : null;
}

/**
 * Add synthetic cross-page segment lengths from neighbor labels (e.g. missing 14→15).
 * @param {Array} sorted
 * @param {Map<string, number>} distMap
 * @returns {{ map: Map<string, number>, filled: number }}
 */
/**
 * Infer missing same-page consecutive labels (e.g. 4→5) from PDF chord × neighbor scale.
 * @param {Array} sorted
 * @param {Map<string, number>} distMap
 * @returns {{ map: Map<string, number>, filled: number }}
 */
/**
 * Infer one missing consecutive segment from PDF chord × neighbor label scale.
 * @returns {number|null}
 */
export function inferMissingSegmentMeters(sorted, distMap, fromNum, toNum) {
  const list = [...sorted].sort((a, b) => a.number - b.number);
  const i = list.findIndex(p => p.number === toNum);
  if (i < 1 || list[i - 1].number !== fromNum) return null;

  const prev = list[i - 1];
  const curr = list[i];
  const key = `${fromNum}->${toNum}`;
  const existing = distMap.get(key);
  if (existing > 0) return existing;

  const pdfM = Math.hypot(curr.x - prev.x, prev.y - curr.y);
  if (pdfM < 1e-6) return null;

  const next = list[i + 1];
  if (next) {
    const mOut = distMap.get(`${curr.number}->${next.number}`);
    if (mOut > 0) {
      const pdfOut = Math.hypot(next.x - curr.x, curr.y - next.y);
      if (pdfOut > 1e-6) return mOut * (pdfM / pdfOut);
    }
  }
  const prevPrev = list[i - 2];
  if (prevPrev) {
    const mIn = distMap.get(`${prevPrev.number}->${prev.number}`);
    if (mIn > 0) {
      const pdfIn = Math.hypot(prev.x - prevPrev.x, prevPrev.y - prev.y);
      if (pdfIn > 1e-6) return mIn * (pdfM / pdfIn);
    }
  }
  return null;
}

export function fillAdjacentMissingDistances(sorted, distMap) {
  const map = new Map(distMap);
  let filled = 0;
  const list = [...sorted].sort((a, b) => a.number - b.number);

  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1];
    const curr = list[i];
    if (curr.number !== prev.number + 1) continue;
    if (prev.pageNum == null || curr.pageNum == null || prev.pageNum !== curr.pageNum) {
      continue;
    }

    const key = `${prev.number}->${curr.number}`;
    if (map.get(key) > 0) continue;

    const pdfM = Math.hypot(curr.x - prev.x, prev.y - curr.y);
    if (pdfM < 1e-6) continue;

    let inferred = null;
    const next = list[i + 1];
    if (next && next.pageNum === curr.pageNum) {
      const mOut = map.get(`${curr.number}->${next.number}`);
      if (mOut > 0) {
        const pdfOut = Math.hypot(next.x - curr.x, curr.y - next.y);
        if (pdfOut > 1e-6) inferred = mOut * (pdfM / pdfOut);
      }
    }
    if (inferred == null && i >= 2) {
      const prevPrev = list[i - 2];
      if (prevPrev.pageNum === prev.pageNum) {
        const mIn = map.get(`${prevPrev.number}->${prev.number}`);
        if (mIn > 0) {
          const pdfIn = Math.hypot(prev.x - prevPrev.x, prevPrev.y - prev.y);
          if (pdfIn > 1e-6) inferred = mIn * (pdfM / pdfIn);
        }
      }
    }
    if (inferred == null || inferred <= 0) continue;

    map.set(key, inferred);
    map.set(`${curr.number}->${prev.number}`, inferred);
    filled++;
  }

  return { map, filled };
}

export function augmentCrossPageDistances(sorted, distMap) {
  const map = new Map(distMap);
  let filled = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (prev.pageNum == null || curr.pageNum == null || prev.pageNum === curr.pageNum) {
      continue;
    }
    const key = `${prev.number}->${curr.number}`;
    if (map.get(key) > 0) continue;

    const parts = [];
    if (i >= 2) {
      const mIn = map.get(`${sorted[i - 2].number}->${prev.number}`);
      if (mIn > 0) parts.push(mIn);
    }
    if (i + 1 < sorted.length) {
      const mOut = map.get(`${curr.number}->${sorted[i + 1].number}`);
      if (mOut > 0) parts.push(mOut);
    }
    if (parts.length === 0) continue;
    const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
    map.set(key, avg);
    map.set(`${curr.number}->${prev.number}`, avg);
    filled++;
  }
  return { map, filled };
}

/**
 * Approach 3 entry: augment cross-page labels, then Gauss–Newton LSQ on page origins.
 */
export function refinePageOriginsByLabelCalibration(
  transforms,
  sortedPosts,
  distMap,
  post1Gps,
  warnings
) {
  const sorted = [...sortedPosts].sort((a, b) => a.number - b.number);
  const { map: augMap, filled } = augmentCrossPageDistances(sorted, distMap);
  const lsq = refinePageOriginsByLabelLsq(
    transforms,
    sortedPosts,
    augMap,
    post1Gps,
    warnings
  );
  return {
    adjusted: lsq.adjusted,
    improved: lsq.improved,
    rmseBefore: lsq.rmseBefore,
    rmseAfter: lsq.rmseAfter,
    augDistMap: augMap,
    crossPageFilled: filled,
  };
}
