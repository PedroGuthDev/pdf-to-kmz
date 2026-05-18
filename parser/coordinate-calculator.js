// parser/coordinate-calculator.js
// GPS coordinate calculation from PDF positions using per-page UTM-grid calibration (D-REV-01).
// Replaces sequential GPS chaining — each post's GPS is projected directly from its page's
// independently-calibrated UTM transform. No error accumulation between posts.
//
// Named ESM exports only — no default export, no CommonJS require.

import {
  computeScaleFactor,
  buildPageTransforms,
  projectPost,
  haversineMeters,
  gpsBearing,
  latLonToUtm,
  utmToLatLon,
  destinationPoint,
} from './geo/utm-calibrator.js';

/**
 * Parse decimal-degree coordinate string (Google Maps paste support — D-13).
 * Accepts: "-27.645312, -48.671234" or "-27.645312 -48.671234"
 *
 * @param {string} input  Raw user input string.
 * @returns {{ lat: number, lon: number } | null}  Parsed coordinates or null if invalid.
 */
export function parseCoordinateInput(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Try comma-separated first, then space-separated
  let parts;
  if (trimmed.includes(',')) {
    parts = trimmed.split(',').map(s => s.trim());
  } else {
    parts = trimmed.split(/\s+/);
  }

  if (parts.length !== 2) return null;

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
    message: 'Coordinates outside Brazil bounds (lat -34 to 5, lon -74 to -35)',
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
          _posts: []
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
    branches: branches.map(b => ({ start: b.start, end: b.end, junctionPost: b.junctionPost }))
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

  const byNum = new Map(posts.map(p => [p.number, p]));
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
          `(interpolated PDF position between posts ${prev.number} and ${next.number}).`
      );
      continue;
    }

    if (prevOk) {
      post.pageNum = prev.pageNum;
      warnings.push(
        `[coordinate-calculator] Post ${num}: reassigned from page ${pg} to calibrated page ${prev.pageNum} ` +
          `(PDF position unchanged — may be inaccurate).`
      );
    } else if (nextOk) {
      post.pageNum = next.pageNum;
      warnings.push(
        `[coordinate-calculator] Post ${num}: reassigned from page ${pg} to calibrated page ${next.pageNum} ` +
          `(PDF position unchanged — may be inaccurate).`
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
function applyDistanceLabelGpsChain(sorted, distMap, startLat, startLon, branchStarts) {
  const utm = sorted.map(p => ({ lat: p.lat, lon: p.lon }));
  let labeled = 0;
  let applied = 0;

  /** @type {Array<{ startIdx: number, endIdx: number }>} */
  const runs = [];
  let runStart = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const crossPage =
      prev.pageNum != null && curr.pageNum != null && prev.pageNum !== curr.pageNum;
    if (crossPage || branchStarts.has(curr.number)) {
      runs.push({ startIdx: runStart, endIdx: i - 1 });
      runStart = i;
    }
  }
  runs.push({ startIdx: runStart, endIdx: sorted.length - 1 });

  for (const { startIdx, endIdx } of runs) {
    if (endIdx <= startIdx) continue;

    // Page-3 UTM projection is usually closer than label chaining; page-4 benefits from chaining.
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
      const anchor = utm[startIdx];
      if (anchor.lat == null) continue;
      lat = anchor.lat;
      lon = anchor.lon;
      sorted[startIdx].lat = lat;
      sorted[startIdx].lon = lon;
    }

    for (let i = startIdx + 1; i <= endIdx; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const m = distMap.get(`${prev.number}->${curr.number}`);
      if (m == null || m <= 0 || utm[i - 1].lat == null || utm[i].lat == null) {
        lat = utm[i].lat;
        lon = utm[i].lon;
        sorted[i].lat = lat;
        sorted[i].lon = lon;
        continue;
      }
      labeled++;
      const bearing = gpsBearing(utm[i - 1].lat, utm[i - 1].lon, utm[i].lat, utm[i].lon);
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
 * Snap post OCR-centroid positions to the nearest Cabo_Projetado polyline vertex on the same page.
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
export function snapPostsToPolyline(posts, cableSegments, warnings, threshold = 30) {
  if (!posts || posts.length === 0 || !cableSegments || cableSegments.length === 0) return;

  // Build vertex pool grouped by pageNum.
  // Each vertex: { x, y, pageNum, id: `${pageNum}:${flatIndex}` }
  /** @type {Map<number, Array<{ x: number, y: number, id: string }>>} */
  const verticesByPage = new Map();
  let flatIndex = 0;

  for (let si = 0; si < cableSegments.length; si++) {
    const seg = cableSegments[si];
    const pageNum = seg.pageNum;
    if (pageNum == null) { flatIndex++; continue; }

    if (!verticesByPage.has(pageNum)) verticesByPage.set(pageNum, []);
    const bucket = verticesByPage.get(pageNum);

    for (const op of (seg.ops || [])) {
      if (op.type === 'M' || op.type === 'L') {
        bucket.push({ x: op.x, y: op.y, id: `${pageNum}:${flatIndex}` });
        flatIndex++;
      } else if (op.type === 'C') {
        // Only endpoint — bezier interior points are NOT vertices (D-ACC-01, T-02-05-04)
        bucket.push({ x: op.x3, y: op.y3, id: `${pageNum}:${flatIndex}` });
        flatIndex++;
      } else if (op.type === 'C2') {
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
    if (usedPost.has(pi)) continue;  // successfully snapped — no warning

    const post = posts[pi];
    const pageNum = post.pageNum;
    if (pageNum == null) continue;

    const bucket = verticesByPage.get(pageNum);
    if (!bucket || bucket.length === 0) {
      warnings.push(
        `[coordinate-calculator] snap: post ${post.number} (page ${pageNum}) had no Cabo_Projetado vertices on its page — OCR position retained.`
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
      `[coordinate-calculator] snap: post ${post.number} (page ${pageNum}) kept OCR position — nearest cable vertex was ${dMin.toFixed(2)} pt away (> ${threshold} pt threshold).`
    );
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
  const branchStarts = new Set(topology.branches.map(b => b.start));
  const sorted = [...posts].sort((a, b) => a.number - b.number);

  const nearPost = (op, post, threshold) => Math.hypot(op.x - post.x, op.y - post.y) < threshold;

  for (let i = 0; i < sorted.length - 1; i++) {
    const curr = sorted[i];
    const next = sorted[i + 1];

    if (branchStarts.has(next.number)) {
      continue; // This pair crosses a branch boundary
    }

    // Check if ANY cable segment passes near both posts
    let connected = false;
    for (const segment of (cableSegments || [])) {
      // D-REV: Only test cables on the same page — cross-page coords are not comparable
      if (segment.pageNum != null && curr.pageNum != null && segment.pageNum !== curr.pageNum) continue;
      let nearA = false;
      let nearB = false;
      for (const op of segment.ops) {
        if (!nearA && op.x !== undefined && nearPost(op, curr, 50)) nearA = true;
        if (!nearB && op.x !== undefined && nearPost(op, next, 50)) nearB = true;
        if (nearA && nearB) {
          connected = true;
          break;
        }
      }
      if (connected) break;
    }

    const hasDistance = distMap.get(`${curr.number}->${next.number}`) != null;

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
 * @param {Array<{ from, to, meters }>} distances
 * @param {number} startLat  Latitude of post #1 (user-provided, D-14)
 * @param {number} startLon  Longitude of post #1
 * @param {Array<{ ops, pageNum? }>} cableSegments
 * @param {{ utmGridPathsPerPage: Map, viewportBoxes: Array, pageDimensions: Map, lastPostGps?: { lat: number, lon: number } }|null} opts
 * @returns {{ posts: Array, connections: Array, warnings: string[] }}
 */
export function calculateCoordinates(posts, distances, startLat, startLon, cableSegments = [], opts = null) {
  if (!posts || posts.length === 0) return { posts: [], connections: [], warnings: [] };

  const warnings = [];
  const sorted = [...posts].sort((a, b) => a.number - b.number);

  // ── Snap post positions to nearest Cabo_Projetado polyline vertex (D-ACC-01, D-ACC-05) ────────
  snapPostsToPolyline(sorted, cableSegments, warnings);

  // postMap entries are live refs into sorted; lat/lon are current.
  const postMap = new Map(sorted.map(p => [p.number, p]));

  const distMap = new Map();
  for (const d of distances) {
    distMap.set(`${d.from}->${d.to}`, d.meters);
    distMap.set(`${d.to}->${d.from}`, d.meters);
  }

  // ── Detect topology and gaps ──────────────────────────────────────────────
  const topology = detectRouteTopology(sorted);
  const gaps = detectGaps(sorted, distances, cableSegments);
  const gapSet = new Set(gaps.map(g => `${g.from}->${g.to}`));

  // ── UTM calibration setup (D-REV-01 through D-REV-12) ────────────────────
  let pageTransforms = new Map();  // Map<pageNum, { origin_e, origin_n, x_scale_sf, y_scale_sf, zone }>
  let scaleFactor = null;
  let utmZone = null;

  const opts_ = opts || {};
  const { utmGridPathsPerPage, viewportBoxes, pageDimensions, lastPostGps } = opts_;

  if (opts_ &&
      utmGridPathsPerPage instanceof Map &&
      viewportBoxes &&
      pageDimensions instanceof Map) {

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
          warnings.push(`UTM scale factor computed from page ${pn} (page 2 had no measurable grid).`);
          break;
        }
      }
    }

    // Fallback to distance-label scale (D-REV-16)
    if (scaleFactor === null) {
      warnings.push('[coordinate-calculator] UTM grid not found on any page. Falling back to distance-label scale factor.');
      let sumM = 0, sumPdf = 0;
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i], b = sorted[i + 1];
        if (a.pageNum !== b.pageNum) continue;  // same-page only for scale
        if (topology.branches.some(br => br.start === b.number)) continue;
        const m = distMap.get(`${a.number}->${b.number}`);
        if (m != null && m > 0) {
          sumM += m;
          sumPdf += Math.hypot(b.x - a.x, b.y - a.y);
        }
      }
      scaleFactor = sumPdf > 0 ? sumM / sumPdf : null;
    }

    const calibratedPages = new Set(viewportBoxes.map(v => v.pageNum));
    repairPostsOnUncalibratedPages(sorted, calibratedPages, warnings);

    // Build page transforms (D-REV-11, D-REV-12)
    if (scaleFactor !== null && viewportBoxes.length > 0) {
      const post1 = sorted.find(p => p.number === sorted[0].number);
      const { zone } = latLonToUtm(startLat, startLon);
      utmZone = zone;
      const post1WithGps = { ...post1, lat: startLat, lon: startLon };
      pageTransforms = buildPageTransforms(
        post1WithGps,
        pageDimensions,
        viewportBoxes,
        scaleFactor,
        zone,
        warnings,
        utmGridPathsPerPage
      );
    } else if (scaleFactor === null) {
      warnings.push('[coordinate-calculator] Cannot calibrate: no scale factor available. Posts will have lat: null, lon: null.');
    } else {
      warnings.push('[coordinate-calculator] Cannot calibrate: no viewport boxes found. Posts will have lat: null, lon: null.');
    }
  } else {
    warnings.push('[coordinate-calculator] opts not provided or incomplete. Posts will have lat: null, lon: null.');
  }

  for (const w of warnings) console.warn(w);

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

  // ── Optional 2nd-anchor similarity refinement (D-ACC-07) ─────────────────
  if (lastPostGps &&
      typeof lastPostGps.lat === 'number' && isFinite(lastPostGps.lat) &&
      typeof lastPostGps.lon === 'number' && isFinite(lastPostGps.lon)) {

    const boundsLast = validateBrazilBounds(lastPostGps.lat, lastPostGps.lon);
    if (!boundsLast.valid) {
      warnings.push('[coordinate-calculator] 2nd anchor outside Brazil bounds — using single-anchor projection.');
    } else {
      const post1 = sorted[0];
      const lastPost = sorted[sorted.length - 1];

      if (post1.lat == null || lastPost.lat == null) {
        warnings.push('[coordinate-calculator] 2nd anchor skipped — post 1 or last post has null lat/lon from projection.');
      } else {
        // Ground-truth UTM for both anchors
        const { easting: e1g, northing: n1g, zone: anchorZone } = latLonToUtm(startLat, startLon);
        const { easting: eNg, northing: nNg } = latLonToUtm(lastPostGps.lat, lastPostGps.lon);

        // Projected UTM for both anchors
        const { easting: e1p, northing: n1p } = latLonToUtm(post1.lat, post1.lon);
        const { easting: eNp, northing: nNp } = latLonToUtm(lastPost.lat, lastPost.lon);

        const dxP = eNp - e1p;
        const dyP = nNp - n1p;
        const denomP = dxP * dxP + dyP * dyP;

        if (denomP < 1e-9) {
          warnings.push('[coordinate-calculator] 2nd anchor coincides with post 1 in projection space — similarity undefined.');
        } else {
          const dxG = eNg - e1g;
          const dyG = nNg - n1g;

          // s*cos(theta) and s*sin(theta) of the similarity transform
          const cosScale = (dxP * dxG + dyP * dyG) / denomP;
          const sinScale = (dxP * dyG - dyP * dxG) / denomP;

          // Apply similarity to every post with non-null lat/lon
          for (const p of sorted) {
            if (p.lat == null || p.lon == null) continue;
            const { easting: ep, northing: np } = latLonToUtm(p.lat, p.lon);
            const e = e1g + cosScale * (ep - e1p) - sinScale * (np - n1p);
            const n = n1g + sinScale * (ep - e1p) + cosScale * (np - n1p);
            const refined = utmToLatLon(e, n, anchorZone);
            p.lat = refined.lat;
            p.lon = refined.lon;
          }

          const scale = Math.hypot(cosScale, sinScale);
          const rotDeg = Math.atan2(sinScale, cosScale) * 180 / Math.PI;
          warnings.push(
            `[coordinate-calculator] 2nd anchor applied — similarity refined: scale=${scale.toFixed(5)}, rot=${rotDeg.toFixed(2)}°.`
          );
        }
      }
    }
  }

  // ── Build connections array (D-REV-14, D-REV-15, D-04, D-17) ────────────
  const connections = [];
  const branchStarts = new Set(topology.branches.map(b => b.start));

  // ── Distance-label route chain (when Distância_Poste labels cover the route) ─
  if (pageTransforms.size > 0 && sorted[0].lat != null) {
    const chained = applyDistanceLabelGpsChain(
      sorted,
      distMap,
      startLat,
      startLon,
      branchStarts
    );
    if (chained) {
      warnings.push(
        '[coordinate-calculator] GPS refined along route using Distância_Poste segment lengths ' +
          '(bearings from UTM projection; post #1 anchor unchanged).'
      );
    }
  }
  const branchJunctionMap = new Map(topology.branches.map(b => [b.start, b.junctionPost]));

  // Helper: same-page bearing from PDF coords (D-02, D-REV-14)
  const pdfBearing = (from, to) => {
    const dx = to.x - from.x;
    const dy = from.y - to.y;  // flipY: up=North means dy = curr.y - next.y
    return ((Math.atan2(dx, dy) * 180 / Math.PI) + 360) % 360;
  };

  // Process main route and branch junctions
  for (let i = 0; i < sorted.length; i++) {
    const curr = sorted[i];

    // Branch junction connection (D-REV-02: from junction GPS to branch start GPS)
    if (branchStarts.has(curr.number)) {
      const junctionId = branchJunctionMap.get(curr.number);
      if (junctionId != null) {
        const junc = postMap.get(junctionId);
        if (junc && junc.lat != null && junc.lon != null && curr.lat != null && curr.lon != null) {
          const isCrossPage = (junc.pageNum !== curr.pageNum);
          let meters, bearing;
          if (isCrossPage) {
            // D-REV-15: cross-page — use GPS-vector values
            meters = haversineMeters(junc.lat, junc.lon, curr.lat, curr.lon);
            bearing = gpsBearing(junc.lat, junc.lon, curr.lat, curr.lon);
          } else {
            // D-REV-14: same-page — use PDF-space values
            const pdfD = Math.hypot(curr.x - junc.x, curr.y - junc.y);
            meters = scaleFactor != null ? pdfD * scaleFactor : haversineMeters(junc.lat, junc.lon, curr.lat, curr.lon);
            bearing = pdfBearing(junc, curr);
          }
          connections.push({
            from: junc.number, to: curr.number,
            meters, bearing, gap: false,
            ...(isCrossPage ? { cross_page: true } : {}),
          });
        }
      }
    }

    // Forward connection to next post in sequence
    if (i < sorted.length - 1) {
      const next = sorted[i + 1];
      if (branchStarts.has(next.number)) continue;  // branch starts handled above

      const isGap = gapSet.has(`${curr.number}->${next.number}`);
      const isCrossPage = (curr.pageNum != null && next.pageNum != null && curr.pageNum !== next.pageNum);

      let meters, bearing;
      if (isCrossPage) {
        // D-REV-15: cross-page — GPS-vector
        if (curr.lat != null && curr.lon != null && next.lat != null && next.lon != null) {
          meters = haversineMeters(curr.lat, curr.lon, next.lat, next.lon);
          bearing = gpsBearing(curr.lat, curr.lon, next.lat, next.lon);
        } else {
          meters = 0;
          bearing = 0;
        }
      } else {
        // D-REV-14: same-page — PDF-space
        const pdfD = Math.hypot(next.x - curr.x, next.y - curr.y);
        const m = distMap.get(`${curr.number}->${next.number}`);
        meters = m != null ? m : (scaleFactor != null ? pdfD * scaleFactor : 0);
        bearing = pdfBearing(curr, next);
      }

      connections.push({
        from: curr.number, to: next.number,
        meters, bearing, gap: isGap,
        ...(isCrossPage ? { cross_page: true } : {}),
      });
    }
  }

  // ── Label vs haversine sanity-check (D-ACC-08) ───────────────────────────
  // postMap entries are live refs into sorted — lat/lon reflect snap + projection + similarity.
  for (const c of connections) {
    if (c.gap !== false) continue;
    const labelM = distMap.get(`${c.from}->${c.to}`);
    if (labelM == null || labelM <= 0) continue;
    const a = postMap.get(c.from);
    const b = postMap.get(c.to);
    if (!a || !b || a.lat == null || a.lon == null || b.lat == null || b.lon == null) continue;
    const hav = haversineMeters(a.lat, a.lon, b.lat, b.lon);
    const tolerance = Math.max(5, 0.10 * labelM);
    if (Math.abs(hav - labelM) > tolerance) {
      warnings.push(
        `[coordinate-calculator] label sanity-check: segment ${c.from}->${c.to} label=${labelM.toFixed(1)}m vs haversine=${hav.toFixed(1)}m (delta=${(hav - labelM).toFixed(1)}m, tol=${tolerance.toFixed(1)}m).`
      );
    }
  }

  return { posts: sorted, connections, warnings };
}
