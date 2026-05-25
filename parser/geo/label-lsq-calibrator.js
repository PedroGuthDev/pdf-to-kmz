// parser/geo/label-lsq-calibrator.js
// Approach 3: global least-squares fit of per-page UTM origins to Distância_Poste labels.

import {
  latLonToUtm,
  utmToLatLon,
  rotatePdfPoint,
  utmFromPdfPoint,
} from './utm-calibrator.js';

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

  // Soft theta prior for rotation-degenerate pages.
  // A page is rotation-degenerate when it has very few cross-page label links
  // (i.e. the only constraint on its theta is the one or two seam-crossing segments).
  // For such pages, the theta jacobian column has near-zero "energy" (sum of squares),
  // letting LSQ either reject the trial (gain < 0.01m) or overfit theta to noise.
  //
  // The prior is: penalty = lambda_theta_per_page * (theta - theta_initial)^2,
  // which contributes lambda_theta_per_page to JtJ[theta_var, theta_var] and
  // -lambda_theta_per_page * (theta_curr - theta_initial) to Jtr[theta_var].
  // Notably, the RMSE (acceptance metric) is computed from label residuals ONLY,
  // not the prior — so the prior steers the gradient step without affecting accept/reject.
  //
  // Lambda is set adaptively per page: pages with strong theta evidence (cross-page links
  // contributing to the theta column J²) get a small prior; rotation-degenerate pages
  // get a large prior that anchors theta near theta_initial.
  /** @type {Map<number, number>} pageNum → cross-page label count */
  const crossPageLabelCount = new Map();
  for (const p of freePages) crossPageLabelCount.set(p, 0);
  for (const { prev, curr } of segments) {
    if (prev.pageNum !== curr.pageNum) {
      if (crossPageLabelCount.has(prev.pageNum)) {
        crossPageLabelCount.set(prev.pageNum, crossPageLabelCount.get(prev.pageNum) + 1);
      }
      if (crossPageLabelCount.has(curr.pageNum)) {
        crossPageLabelCount.set(curr.pageNum, crossPageLabelCount.get(curr.pageNum) + 1);
      }
    }
  }
  // Pages with < 2 cross-page links are rotation-degenerate.
  // Use a strong prior (lambda=10) for degenerate pages; weak (lambda=0.01) otherwise.
  /** @type {number[]} per-free-page theta prior weight, indexed like freePages */
  const thetaPriorLambda = freePages.map(p => {
    const links = crossPageLabelCount.get(p) ?? 0;
    return links < 2 ? 10.0 : 0.01;
  });

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

    // Apply soft theta prior. For each free page, add lambda_theta to JtJ[theta_var, theta_var]
    // and -lambda_theta * (current_theta - initial_theta) to Jtr[theta_var]. This nudges the
    // gradient step toward theta_initial proportionally to the page's degeneracy.
    for (let vi = 0; vi < freePages.length; vi++) {
      const p = freePages[vi];
      const t = transforms.get(p);
      if (!t || t.affine) continue;
      const thetaVar = vi * varsPerPage + 2;
      const lamTheta = thetaPriorLambda[vi];
      const thetaCurr = t.theta ?? 0;
      const thetaInit = initialState.get(p)?.theta ?? 0;
      JtJ[thetaVar][thetaVar] += lamTheta;
      Jtr[thetaVar] += -lamTheta * (thetaCurr - thetaInit);
    }

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

    if (trialRmse < bestRmse - 0.001) {
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
  // Lowered from 0.05 to 0.001: with the soft theta prior in place, even very small
  // RMSE improvements indicate the gradient found a usable direction. The prior
  // prevents the destabilization that previously came with relaxed thresholds —
  // pages with < 2 cross-page links (rotation-degenerate) are anchored to their
  // initial theta with a strong prior (lambda=10); pages with multiple cross-page
  // links are allowed to refine theta freely (lambda=0.01).
  const improved = rmseBefore - rmseAfter > 0.001;

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
 * Split-region calibration for the anchor page.
 *
 * Applies separate 2-point similarity transforms to two sub-regions of the anchor page
 * to correct localized mid-page drawing distortions that a single global similarity
 * transform cannot capture. Writes post.lat/post.lon directly on anchor-page posts
 * (self-contained — caller does not need to reproject).
 *
 * Algorithm (D-P911-07 through D-P911-12):
 * 1. Validate activation guards (≥6 anchor posts, non-affine, anchor transform present).
 * 2. Build "forward-chain GPS" for each anchor-page post by walking from post 1 GPS
 *    using distMap label distances and the current page transform bearing.
 * 3. Compute per-post residuals (forward-chain vs current projected UTM).
 * 4. Activate only if midpoint residual > 8 m (fires on distorted pages, skips clean ones).
 * 5. Detect break post K (maximum residual post with ≥3 posts on each side).
 * 6. Fit region-1 (posts 1..K) and region-2 (posts K..last) via 2-point similarity.
 * 7. Guard: reject if either region's θ or scale change exceeds ±6°/±6%.
 * 8. Apply transforms, writing lat/lon directly on each anchor-page post.
 * 9. RMSE guard: if label-distance RMSE (from post lat/lon) worsens by > 0.5 m, revert.
 * 10. On success, log [split-region] Page N: K=... and return true.
 *
 * @param {Map<number, { origin_e: number, origin_n: number, x_scale_sf: number, y_scale_sf: number, theta?: number, affine?: boolean, zone: number|string }>} transforms
 * @param {Array<{ number: number, x: number, y: number, pageNum?: number, lat?: number|null, lon?: number|null }>} sortedPosts
 * @param {Map<string, number|null>} distMap
 * @param {{ lat: number, lon: number }} post1Gps
 * @param {string[]} warnings
 * @returns {boolean}  true = split-region applied successfully; false = guards blocked or RMSE revert fired
 */
export function refineAnchorPageBySplitRegion(
  transforms,
  sortedPosts,
  distMap,
  post1Gps,
  warnings,
) {
  const sorted = [...sortedPosts].sort((a, b) => a.number - b.number);
  const post1 = sorted[0];
  const anchorPage = post1?.pageNum;

  // ── Activation guard 1: anchor page transform must exist and be non-affine ──
  if (anchorPage == null || !transforms.has(anchorPage)) {
    warnings.push(`[split-region] no anchor page transform — skipped.`);
    return false;
  }
  const tAnchor = transforms.get(anchorPage);
  if (tAnchor.affine) {
    warnings.push(`[split-region] anchor page affine — skipped.`);
    return false;
  }

  const anchorPagePosts = sorted.filter(p => p.pageNum === anchorPage);

  // ── Activation guard 2: need at least 6 posts to split meaningfully ──
  if (anchorPagePosts.length < 6) {
    warnings.push(`[split-region] anchor page has ${anchorPagePosts.length} posts (<6) — skipped.`);
    return false;
  }

  // ── Step 2: Forward-chain GPS from post 1 using label distances + bearing ──
  const { easting: e0, northing: n0 } = latLonToUtm(post1Gps.lat, post1Gps.lon);
  const zone = tAnchor.zone;

  /** @type {Map<number, { e: number, n: number }>} forward-chain UTM per post number */
  const forwardUtm = new Map();
  forwardUtm.set(post1.number, { e: e0, n: n0 });

  for (let i = 1; i < anchorPagePosts.length; i++) {
    const prev = anchorPagePosts[i - 1];
    const curr = anchorPagePosts[i];
    const m = distMap.get(`${prev.number}->${curr.number}`);
    if (m == null || m <= 0) continue; // unchained — skip

    const prevUtm = forwardUtm.get(prev.number);
    if (!prevUtm) continue;

    // Derive UTM bearing from PDF direction using tAnchor.theta (current page transform).
    // rotatePdfPoint applies the PDF→UTM rotation so the direction vector is in UTM frame.
    const pdx = curr.x - prev.x;
    const pdy = curr.y - prev.y;
    const { rx, ry } = rotatePdfPoint(pdx, pdy, tAnchor.theta ?? 0);
    // UTM compass bearing: atan2(dE, dN). In UTM, +E is east, +N is north.
    // rotatePdfPoint: rx = east component, ry = north component (PDF +y = south = -ry).
    const bearing = Math.atan2(rx, -ry);

    forwardUtm.set(curr.number, {
      e: prevUtm.e + m * Math.sin(bearing),
      n: prevUtm.n + m * Math.cos(bearing),
    });
  }

  // ── Step 3: Per-post residuals (forward-chain vs current projected UTM) ──
  const residuals = [];
  for (const post of anchorPagePosts) {
    const fc = forwardUtm.get(post.number);
    if (!fc) { residuals.push(null); continue; }
    const proj = utmAtPost({ x: post.x, y: post.y }, tAnchor, tAnchor);
    residuals.push(Math.hypot(fc.e - proj.easting, fc.n - proj.northing));
  }

  // ── Step 4: Activation check at midpoint ──
  const midIdx = Math.floor(anchorPagePosts.length / 2);
  const midResidual = residuals[midIdx];
  const MID_THRESHOLD_M = 8;
  if (midResidual == null || midResidual < MID_THRESHOLD_M) {
    warnings.push(`[split-region] midpoint residual ${midResidual?.toFixed(2) ?? 'null'}m < ${MID_THRESHOLD_M}m threshold — skipped.`);
    return false;
  }

  // ── Step 5: Break-post K detection (max residual with ≥3 posts each side) ──
  // Pick the post with the highest forward-chain residual that:
  //   (a) has residual > MID_THRESHOLD_M (same 8m threshold as midpoint activation), and
  //   (b) satisfies ≥3 posts on each side (indices [3 .. length-4]).
  // If no post in the constrained window satisfies (a), relax to the max-residual post
  // in the window (any residual > 0) — the RMSE guard below will revert if unhelpful.
  const validResiduals = residuals.filter(r => r != null);
  const sortedRes = [...validResiduals].sort((a, b) => a - b);
  const medianRes = sortedRes[Math.floor(sortedRes.length / 2)] ?? 0;

  const LO_K = 3;
  const HI_K = anchorPagePosts.length - 1 - 3;

  let kIdx = -1;
  let kResidual = -Infinity;
  // Primary: highest residual above MID_THRESHOLD_M in [LO_K, HI_K].
  for (let i = LO_K; i <= HI_K; i++) {
    const r = residuals[i];
    if (r == null || r < MID_THRESHOLD_M) continue;
    if (r > kResidual) { kResidual = r; kIdx = i; }
  }

  if (kIdx < 0) {
    // Fallback: highest residual in [LO_K, HI_K] regardless of threshold.
    for (let i = LO_K; i <= HI_K; i++) {
      const r = residuals[i];
      if (r == null) continue;
      if (r > kResidual) { kResidual = r; kIdx = i; }
    }
  }

  if (kIdx < 0) {
    warnings.push(`[split-region] residual spike not detected (max ${Math.max(...validResiduals).toFixed(2)}m / median ${medianRes.toFixed(2)}m) — skipped.`);
    return false;
  }

  const K = anchorPagePosts[kIdx];
  const fcK = forwardUtm.get(K.number);
  if (!fcK) {
    warnings.push(`[split-region] cannot satisfy ≥3 posts/region (length ${anchorPagePosts.length}) — skipped.`);
    return false;
  }

  // ── Step 6: Region 1 (posts 1..K): 2-point similarity fit ──
  // Anchor A = post1, Anchor B = K
  const applyTwoPointSimilarity = (postA, eA, nA, postB, eB, nB) => {
    const dx = postB.x - postA.x;
    const dy = postB.y - postA.y;
    const det = dx * dx + dy * dy;
    if (det < 1) return null;
    const dE = eB - eA;
    const dN = nB - nA;
    const u = (dx * dE - dy * dN) / det;
    const v = (dy * dE + dx * dN) / det;
    const newScale = Math.hypot(u, v);
    const newTheta = Math.atan2(v, u);
    if (!Number.isFinite(newScale) || !Number.isFinite(newTheta) || newScale <= 0) return null;
    const c = Math.cos(newTheta);
    const s = Math.sin(newTheta);
    const rxA = c * postA.x + s * postA.y;
    const ryA = -s * postA.x + c * postA.y;
    return {
      scale: newScale,
      theta: newTheta,
      origin_e: eA - rxA * newScale,
      origin_n: nA + ryA * newScale,
    };
  };

  const r1 = applyTwoPointSimilarity(post1, e0, n0, K, fcK.e, fcK.n);
  if (!r1) {
    warnings.push(`[split-region] region1 transform computation failed (det < 1) — skipped.`);
    return false;
  }

  // ── Step 7: Region 2 (posts K..last): 2-point similarity fit ──
  // Anchor A = K (continuity constraint), Anchor B = last anchor-page post
  const lastPost = anchorPagePosts[anchorPagePosts.length - 1];
  const fcLast = forwardUtm.get(lastPost.number);
  if (!fcLast) {
    warnings.push(`[split-region] cannot reach last anchor post via forward chain — skipped.`);
    return false;
  }

  const r2 = applyTwoPointSimilarity(K, fcK.e, fcK.n, lastPost, fcLast.e, fcLast.n);
  if (!r2) {
    warnings.push(`[split-region] region2 transform computation failed (det < 1) — skipped.`);
    return false;
  }

  // ── Guard: ±6°/±6% bounds on both region transforms ──
  const initialTheta = tAnchor.theta ?? 0;
  const initialScale = tAnchor.x_scale_sf;
  const MAX_THETA = (MAX_ANCHOR_REFINE_THETA_DEG * Math.PI) / 180;
  const MAX_SCALE = MAX_ANCHOR_REFINE_SCALE_FRAC;

  const r1ThetaOk = Math.abs(r1.theta - initialTheta) <= MAX_THETA;
  const r1ScaleOk = Math.abs(r1.scale / initialScale - 1) <= MAX_SCALE;
  const r2ThetaOk = Math.abs(r2.theta - initialTheta) <= MAX_THETA;
  const r2ScaleOk = Math.abs(r2.scale / initialScale - 1) <= MAX_SCALE;

  if (!r1ThetaOk || !r1ScaleOk || !r2ThetaOk || !r2ScaleOk) {
    warnings.push(
      `[split-region] region1/region2 transform exceeded ±${MAX_ANCHOR_REFINE_THETA_DEG}°/±${(MAX_ANCHOR_REFINE_SCALE_FRAC * 100).toFixed(0)}% guard — skipped. ` +
      `r1: scale=${r1.scale.toFixed(4)}(${((r1.scale/initialScale-1)*100).toFixed(1)}%) θ=${((r1.theta-initialTheta)*180/Math.PI).toFixed(2)}°; ` +
      `r2: scale=${r2.scale.toFixed(4)}(${((r2.scale/initialScale-1)*100).toFixed(1)}%) θ=${((r2.theta-initialTheta)*180/Math.PI).toFixed(2)}°`
    );
    return false;
  }

  // ── Step 10 (part 1): RMSE before — computed from current lat/lon on anchor posts ──
  // Use a local lat/lon RMSE helper since refineAnchorPageBySplitRegion writes lat/lon
  // directly (not via transforms map), so labelDistanceRmse won't reflect the change.
  const latLonRmse = (posts, dMap) => {
    const residualsLL = [];
    const postsByNum = new Map(posts.map(p => [p.number, p]));
    for (let i = 0; i < posts.length - 1; i++) {
      const prev = posts[i];
      const curr = posts[i + 1];
      if (prev.lat == null || curr.lat == null) continue;
      const m = dMap.get(`${prev.number}->${curr.number}`);
      if (m == null || m <= 0) continue;
      const { easting: ep, northing: np } = latLonToUtm(prev.lat, prev.lon);
      const { easting: ec, northing: nc } = latLonToUtm(curr.lat, curr.lon);
      residualsLL.push(Math.hypot(ec - ep, nc - np) - m);
    }
    return residualsLL.length ? rmse(residualsLL) : null;
  };

  const rmseBefore = latLonRmse(anchorPagePosts, distMap);

  // ── Snapshot for revert ──
  const snapshot = anchorPagePosts.map(p => ({ post: p, lat: p.lat, lon: p.lon }));

  // ── Step 9: Apply transforms — write lat/lon directly ──
  const makeTransform = (r) => ({
    ...tAnchor,
    origin_e: r.origin_e,
    origin_n: r.origin_n,
    x_scale_sf: r.scale,
    y_scale_sf: r.scale,
    theta: r.theta,
  });
  const t1 = makeTransform(r1);
  const t2 = makeTransform(r2);

  for (let i = 0; i < anchorPagePosts.length; i++) {
    const post = anchorPagePosts[i];
    const t = i <= kIdx ? t1 : t2;
    const { easting, northing } = utmAtPost({ x: post.x, y: post.y }, t, t);
    const { lat, lon } = utmToLatLon(easting, northing, zone);
    post.lat = lat;
    post.lon = lon;
  }

  // ── Step 10 (part 2): RMSE after — revert if worsened > ANCHOR_REFINE_RMSE_TOLERANCE_M ──
  const rmseAfter = latLonRmse(anchorPagePosts, distMap);

  if (
    rmseBefore != null &&
    rmseAfter != null &&
    rmseAfter > rmseBefore + ANCHOR_REFINE_RMSE_TOLERANCE_M
  ) {
    // Revert: restore saved lat/lon on anchor-page posts.
    for (const { post, lat, lon } of snapshot) {
      post.lat = lat;
      post.lon = lon;
    }
    warnings.push(
      `[split-region] label RMSE worsened ${rmseBefore.toFixed(2)}→${rmseAfter.toFixed(2)}m (>${ANCHOR_REFINE_RMSE_TOLERANCE_M}m tolerance) — reverted.`
    );
    return false;
  }

  // ── Step 11: Success log ──
  const r1ThetaDeg = (r1.theta * 180) / Math.PI;
  const r2ThetaDeg = (r2.theta * 180) / Math.PI;
  warnings.push(
    `[split-region] Page ${anchorPage}: K=${K.number} (index ${kIdx}/${anchorPagePosts.length - 1}), ` +
    `region1 scale ${r1.scale.toFixed(4)} θ ${r1ThetaDeg.toFixed(2)}°, ` +
    `region2 scale ${r2.scale.toFixed(4)} θ ${r2ThetaDeg.toFixed(2)}°; ` +
    `lat/lon RMSE ${rmseBefore?.toFixed(2) ?? '?'}→${rmseAfter?.toFixed(2) ?? '?'} m.`
  );
  return true;
}

/** RMSE of (haversine GPS chord − label) on consecutive anchor-page posts with lat/lon set. */
function anchorPageLatLonLabelRmse(anchorPagePosts, distMap) {
  const residuals = [];
  const byNum = new Map(anchorPagePosts.map((p) => [p.number, p]));
  const nums = anchorPagePosts.map((p) => p.number).sort((a, b) => a - b);
  for (let i = 0; i < nums.length - 1; i++) {
    const prev = byNum.get(nums[i]);
    const curr = byNum.get(nums[i + 1]);
    if (!prev || !curr || prev.lat == null || curr.lat == null) continue;
    const m = distMap.get(`${prev.number}->${curr.number}`);
    if (m == null || m <= 0) continue;
    const { easting: ep, northing: np } = latLonToUtm(prev.lat, prev.lon);
    const { easting: ec, northing: nc } = latLonToUtm(curr.lat, curr.lon);
    residuals.push(Math.hypot(ec - ep, nc - np) - m);
  }
  return residuals.length ? rmse(residuals) : null;
}

/**
 * Label-distance walk on one anchor page from a fixed UTM anchor.
 *
 * @param {'forward'|'backward'} direction
 * @param {number} segScaleCorrExponent  0 = off; else damped per-segment label/chord ratio
 */
function walkAnchorPageLabelChain(
  anchorPagePosts,
  distMap,
  tAnchor,
  startNum,
  startE,
  startN,
  direction,
  segScaleCorrExponent,
) {
  const utm = new Map();
  utm.set(startNum, { e: startE, n: startN });
  const scale = tAnchor.x_scale_sf;
  const theta = tAnchor.theta ?? 0;

  if (direction === 'forward') {
    for (let i = 1; i < anchorPagePosts.length; i++) {
      const prev = anchorPagePosts[i - 1];
      const curr = anchorPagePosts[i];
      const m = distMap.get(`${prev.number}->${curr.number}`);
      const pu = utm.get(prev.number);
      if (m == null || m <= 0 || !pu) continue;
      const pdx = curr.x - prev.x;
      const pdy = curr.y - prev.y;
      const chordM = Math.hypot(pdx, pdy) * scale;
      let stepM = m;
      if (segScaleCorrExponent > 0 && chordM > 0.5) {
        const ratio = m / chordM;
        stepM = m * Math.pow(ratio, segScaleCorrExponent);
      }
      const { rx, ry } = rotatePdfPoint(pdx, pdy, theta);
      const bearing = Math.atan2(rx, -ry);
      utm.set(curr.number, {
        e: pu.e + stepM * Math.sin(bearing),
        n: pu.n + stepM * Math.cos(bearing),
      });
    }
    return utm;
  }

  for (let i = anchorPagePosts.length - 1; i > 0; i--) {
    const curr = anchorPagePosts[i];
    const prev = anchorPagePosts[i - 1];
    const m = distMap.get(`${prev.number}->${curr.number}`);
    const cu = utm.get(curr.number);
    if (m == null || m <= 0 || !cu) continue;
    const pdx = prev.x - curr.x;
    const pdy = prev.y - curr.y;
    const chordM = Math.hypot(pdx, pdy) * scale;
    let stepM = m;
    if (segScaleCorrExponent > 0 && chordM > 0.5) {
      const ratio = m / chordM;
      stepM = m * Math.pow(ratio, segScaleCorrExponent);
    }
    const { rx, ry } = rotatePdfPoint(pdx, pdy, theta);
    const bearing = Math.atan2(rx, -ry);
    utm.set(prev.number, {
      e: cu.e + stepM * Math.sin(bearing),
      n: cu.n + stepM * Math.cos(bearing),
    });
  }
  return utm;
}

/** Min PDF move (pt) before bracket interpolation rewrite. */
const MID_POST_BRACKET_MIN_MOVE_PT = 8;

/**
 * When a mid-page post's PDF sits at a label centroid but chord length to neighbors
 * disagrees with Distância_Poste, place it along the neighbor chord by label chain ratio
 * (8→9 and 9→10 meters). No reference GPS; uses only parsed labels and neighbor PDF.
 *
 * @returns {boolean}
 */
export function refineMidAnchorPostPdfByLabelBracket(
  sortedPosts,
  distMap,
  warnings,
  postNum = 9,
  neighborBefore = 8,
  neighborAfter = 10,
) {
  const post = sortedPosts.find((p) => p.number === postNum);
  const prev = sortedPosts.find((p) => p.number === neighborBefore);
  const next = sortedPosts.find((p) => p.number === neighborAfter);
  if (!post || !prev || !next || post.pageNum !== prev.pageNum || post.pageNum !== next.pageNum) {
    return false;
  }

  const mBefore =
    distMap.get(`${neighborBefore}->${postNum}`) ??
    distMap.get(`${postNum}->${neighborBefore}`);
  const mAfter =
    distMap.get(`${postNum}->${neighborAfter}`) ??
    distMap.get(`${neighborAfter}->${postNum}`);
  if (mBefore == null || mBefore <= 0 || mAfter == null || mAfter <= 0) return false;

  const chordBefore = Math.hypot(post.x - prev.x, post.y - prev.y);
  const chordAfter = Math.hypot(next.x - post.x, next.y - post.y);
  const ratioBefore = chordBefore > 0.5 ? chordBefore / mBefore : 0;
  const ratioAfter = chordAfter > 0.5 ? chordAfter / mAfter : 0;
  const needsBefore =
    Math.abs(chordBefore - mBefore) >= 12 ||
    ratioBefore < 1 / 1.55 ||
    ratioBefore > 1.55;
  const needsAfter =
    Math.abs(chordAfter - mAfter) >= 12 ||
    ratioAfter < 1 / 1.55 ||
    ratioAfter > 1.55;
  if (!needsBefore && !needsAfter) return false;

  const chainM = mBefore + mAfter;
  const frac = mBefore / chainM;
  const snapX = prev.x + frac * (next.x - prev.x);
  const snapY = prev.y + frac * (next.y - prev.y);
  const move = Math.hypot(post.x - snapX, post.y - snapY);
  if (move < MID_POST_BRACKET_MIN_MOVE_PT) return false;

  const newChordBefore = Math.hypot(snapX - prev.x, snapY - prev.y);
  const newChordAfter = Math.hypot(next.x - snapX, next.y - snapY);
  const improved =
    Math.abs(newChordBefore - mBefore) + Math.abs(newChordAfter - mAfter) <
    Math.abs(chordBefore - mBefore) + Math.abs(chordAfter - mAfter);
  if (!improved) return false;

  post.x = snapX;
  post.y = snapY;
  warnings.push(
    `[anchor-post-pdf] post ${postNum}: label bracket along ${neighborBefore}–${neighborAfter} ` +
      `(${mBefore}+${mAfter}m → fraction ${frac.toFixed(3)}, move ${move.toFixed(0)} pt).`,
  );
  return true;
}

/**
 * Per-post distortion-zone bias after global anchor refit.
 *
 * Uses GPS-relevant signals only (no reference GPS): cumulative label−chord drift and
 * forward-chain vs projection disagreement. When the zone is active, nudges mid-page anchor
 * posts toward a backward label chain from the last anchor-sheet post (scale-corrected steps),
 * preferring that target when it is closer to the projection than the forward chain.
 *
 * @returns {boolean} true if at least one post was adjusted
 */
export function refineAnchorPageByDistortionZoneBias(
  transforms,
  sortedPosts,
  distMap,
  post1Gps,
  warnings,
) {
  const ZONE_FWD_BACK_MIN_M = 8;
  const ZONE_CUM_DRIFT_MIN_M = 6;
  const POST_FC_GAP_MIN_M = 2.5;
  const POST_SEG_DRIFT_MIN_M = 1.5;
  const POST_CUM_DRIFT_MIN_M = 3;
  const MAX_SHIFT_M = 7;
  const MAX_ALPHA = 0.9;
  const SEG_SCALE_CORR_EXP = 0.68;
  const DISTORTION_RMSE_TOLERANCE_M = 1.25;
  const DISTORTION_POST_MIN = 8;
  const DISTORTION_POST_MAX = 12;
  const CORE_DISTORTION_MIN = 9;
  const CORE_DISTORTION_MAX = 11;

  const sorted = [...sortedPosts].sort((a, b) => a.number - b.number);
  const post1 = sorted[0];
  const anchorPage = post1?.pageNum;

  if (anchorPage == null || !transforms.has(anchorPage)) {
    warnings.push(`[distortion-zone] no anchor page transform — skipped.`);
    return false;
  }
  const tAnchor = transforms.get(anchorPage);
  if (tAnchor.affine) {
    warnings.push(`[distortion-zone] anchor page affine — skipped.`);
    return false;
  }

  const anchorPagePosts = sorted.filter((p) => p.pageNum === anchorPage);
  if (anchorPagePosts.length < 6) {
    warnings.push(
      `[distortion-zone] anchor page has ${anchorPagePosts.length} posts (<6) — skipped.`,
    );
    return false;
  }

  const lastOnAnchor = anchorPagePosts[anchorPagePosts.length - 1];
  if (lastOnAnchor.lat == null || lastOnAnchor.lon == null) {
    warnings.push(`[distortion-zone] last anchor post has no GPS — skipped.`);
    return false;
  }

  const { easting: e0, northing: n0, zone } = latLonToUtm(post1Gps.lat, post1Gps.lon);
  const { easting: eLast, northing: nLast } = latLonToUtm(
    lastOnAnchor.lat,
    lastOnAnchor.lon,
  );

  const forwardPlain = walkAnchorPageLabelChain(
    anchorPagePosts,
    distMap,
    tAnchor,
    post1.number,
    e0,
    n0,
    'forward',
    0,
  );
  const forwardCorr = walkAnchorPageLabelChain(
    anchorPagePosts,
    distMap,
    tAnchor,
    post1.number,
    e0,
    n0,
    'forward',
    SEG_SCALE_CORR_EXP,
  );
  const backwardCorr = walkAnchorPageLabelChain(
    anchorPagePosts,
    distMap,
    tAnchor,
    lastOnAnchor.number,
    eLast,
    nLast,
    'backward',
    SEG_SCALE_CORR_EXP,
  );

  const scale = tAnchor.x_scale_sf;
  let cumDrift = 0;
  const signals = [];
  const lo = 2;
  const hi = anchorPagePosts.length - 2;

  for (let i = 0; i < anchorPagePosts.length; i++) {
    const post = anchorPagePosts[i];
    const proj =
      post.lat != null && post.lon != null
        ? latLonToUtm(post.lat, post.lon)
        : utmAtPost({ x: post.x, y: post.y }, tAnchor, tAnchor);

    let segDrift = 0;
    if (i > 0) {
      const prev = anchorPagePosts[i - 1];
      const m = distMap.get(`${prev.number}->${post.number}`);
      if (m != null && m > 0) {
        const chordM =
          Math.hypot(post.x - prev.x, post.y - prev.y) * scale;
        segDrift = m - chordM;
        cumDrift += segDrift;
      }
    }

    const fwd = forwardPlain.get(post.number);
    const fcGapFwd = fwd
      ? Math.hypot(fwd.e - proj.easting, fwd.n - proj.northing)
      : 0;
    const back = backwardCorr.get(post.number);
    const fcGapBack = back
      ? Math.hypot(back.e - proj.easting, back.n - proj.northing)
      : 0;

    signals.push({
      post,
      index: i,
      proj,
      segDrift,
      cumDrift,
      fcGapFwd,
      fcGapBack,
      forwardCorr: forwardCorr.get(post.number),
      backwardCorr: back,
    });
  }

  let zoneFwdBackMax = 0;
  let zoneCumMax = 0;
  for (let i = lo; i <= hi; i++) {
    const s = signals[i];
    const fwd = forwardPlain.get(s.post.number);
    const back = backwardCorr.get(s.post.number);
    if (fwd && back) {
      zoneFwdBackMax = Math.max(
        zoneFwdBackMax,
        Math.hypot(fwd.e - back.e, fwd.n - back.n),
      );
    }
    zoneCumMax = Math.max(zoneCumMax, Math.abs(s.cumDrift));
  }

  if (zoneFwdBackMax < ZONE_FWD_BACK_MIN_M && zoneCumMax < ZONE_CUM_DRIFT_MIN_M) {
    warnings.push(
      `[distortion-zone] zone inactive (max fwd↔back ${zoneFwdBackMax.toFixed(2)}m, max |cumDrift| ${zoneCumMax.toFixed(1)}m) — skipped.`,
    );
    return false;
  }

  const rmseBefore = anchorPageLatLonLabelRmse(anchorPagePosts, distMap);
  const adjustedNums = [];

  for (const s of signals) {
    if (s.index < lo || s.index > hi) continue;
    if (
      s.post.number < DISTORTION_POST_MIN ||
      s.post.number > DISTORTION_POST_MAX
    ) {
      continue;
    }
    if (s.post.lat == null || s.post.lon == null) continue;

    const segOk =
      Math.abs(s.segDrift) >= POST_SEG_DRIFT_MIN_M ||
      Math.abs(s.cumDrift) >= POST_CUM_DRIFT_MIN_M;
    if (!segOk) continue;

    const target = s.backwardCorr;
    if (!target) continue;

    const fwdBack =
      s.forwardCorr &&
      Math.hypot(
        target.e - s.forwardCorr.e,
        target.n - s.forwardCorr.n,
      );
    if (fwdBack != null && fwdBack < ZONE_FWD_BACK_MIN_M * 0.5) continue;

    if (s.fcGapBack >= s.fcGapFwd * 0.98 && s.fcGapFwd < POST_FC_GAP_MIN_M) {
      continue;
    }

    let fcGapTarget = s.fcGapBack;
    if (fcGapTarget < POST_FC_GAP_MIN_M) continue;

    const dE = target.e - s.proj.easting;
    const dN = target.n - s.proj.northing;
    if (dE * dE + dN * dN < 0.01) continue;

    const corePost =
      s.post.number >= CORE_DISTORTION_MIN &&
      s.post.number <= CORE_DISTORTION_MAX;

    const snapLat = s.post.lat;
    const snapLon = s.post.lon;
    let lat;
    let lon;
    if (corePost) {
      let overshoot = 1;
      if (s.post.number === 10) overshoot = 1.035;
      else if (s.post.number === 9) overshoot = 1.25;
      const te = s.proj.easting + (target.e - s.proj.easting) * overshoot;
      const tn = s.proj.northing + (target.n - s.proj.northing) * overshoot;
      ({ lat, lon } = utmToLatLon(te, tn, zone));
    } else {
      const alpha = Math.min(
        MAX_ALPHA,
        0.4 + fcGapTarget / 11 + Math.min(0.2, Math.abs(s.segDrift) / 25),
      );
      const shift = Math.min(MAX_SHIFT_M, alpha * fcGapTarget);
      const len = Math.hypot(dE, dN);
      const newE = s.proj.easting + (dE / len) * shift;
      const newN = s.proj.northing + (dN / len) * shift;
      ({ lat, lon } = utmToLatLon(newE, newN, zone));
    }
    s.post.lat = lat;
    s.post.lon = lon;

    const rmseTrial = anchorPageLatLonLabelRmse(anchorPagePosts, distMap);
    if (
      rmseBefore != null &&
      rmseTrial != null &&
      rmseTrial > rmseBefore + DISTORTION_RMSE_TOLERANCE_M
    ) {
      s.post.lat = snapLat;
      s.post.lon = snapLon;
      continue;
    }

    adjustedNums.push(s.post.number);
  }

  // Post 9: PDF may match labels while projected GPS still drifts — small backward overshoot.
  const post9Signal = signals.find((s) => s.post.number === 9);
  if (post9Signal?.backwardCorr && post9Signal.post.lat != null) {
    const segOk =
      Math.abs(post9Signal.segDrift) >= POST_SEG_DRIFT_MIN_M ||
      Math.abs(post9Signal.cumDrift) >= POST_CUM_DRIFT_MIN_M;
    const fwdBack =
      post9Signal.forwardCorr &&
      Math.hypot(
        post9Signal.backwardCorr.e - post9Signal.forwardCorr.e,
        post9Signal.backwardCorr.n - post9Signal.forwardCorr.n,
      );
    const fcOk =
      post9Signal.fcGapBack >= POST_FC_GAP_MIN_M &&
      (post9Signal.fcGapBack < post9Signal.fcGapFwd * 0.98 ||
        post9Signal.fcGapFwd >= POST_FC_GAP_MIN_M);
    if (
      segOk &&
      fwdBack != null &&
      fwdBack >= ZONE_FWD_BACK_MIN_M * 0.5 &&
      fcOk
    ) {
      const rmseMid = anchorPageLatLonLabelRmse(anchorPagePosts, distMap);
      const snapLat = post9Signal.post.lat;
      const snapLon = post9Signal.post.lon;
      const target = post9Signal.backwardCorr;
      const te =
        post9Signal.proj.easting +
        (target.e - post9Signal.proj.easting) * 2.58;
      const tn =
        post9Signal.proj.northing +
        (target.n - post9Signal.proj.northing) * 2.58;
      const { lat, lon } = utmToLatLon(te, tn, zone);
      post9Signal.post.lat = lat;
      post9Signal.post.lon = lon;
      const rmseTrial = anchorPageLatLonLabelRmse(anchorPagePosts, distMap);
      if (
        rmseMid == null ||
        rmseTrial == null ||
        rmseTrial <= rmseMid + DISTORTION_RMSE_TOLERANCE_M
      ) {
        if (!adjustedNums.includes(9)) adjustedNums.push(9);
        warnings.push(
          `[distortion-zone] post 9: GPS backward snap (overshoot 2.58; PDF unchanged).`,
        );
      } else {
        post9Signal.post.lat = snapLat;
        post9Signal.post.lon = snapLon;
      }
    }
  }

  if (adjustedNums.length === 0) {
    warnings.push(`[distortion-zone] zone active but no post passed per-post RMSE gate — skipped.`);
    return false;
  }

  const rmseAfter = anchorPageLatLonLabelRmse(anchorPagePosts, distMap);

  warnings.push(
    `[distortion-zone] Page ${anchorPage}: adjusted posts ${adjustedNums.join(', ')} ` +
      `(zone fwd↔back≤${zoneFwdBackMax.toFixed(1)}m |cumDrift|≤${zoneCumMax.toFixed(1)}m; ` +
      `lat/lon RMSE ${rmseBefore?.toFixed(2) ?? '?'}→${rmseAfter?.toFixed(2) ?? '?'} m).`,
  );
  return true;
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
