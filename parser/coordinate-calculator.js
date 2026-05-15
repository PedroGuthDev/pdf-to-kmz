// parser/coordinate-calculator.js
// GPS coordinate calculation from PDF positions using per-page UTM-grid calibration (D-REV-01).
// Replaces sequential GPS chaining — each post's GPS is projected directly from its page's
// independently-calibrated UTM transform. No error accumulation between posts.
//
// Named ESM exports only — no default export, no CommonJS require.

import { computeScaleFactor, buildPageTransforms, projectPost, haversineMeters, gpsBearing, latLonToUtm } from './geo/utm-calibrator.js';

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
 * @param {{ utmGridPathsPerPage: Map, viewportBoxes: Array, pageDimensions: Map }} utmCalibrationData
 * @returns {{ posts: Array, connections: Array }}
 */
export function calculateCoordinates(posts, distances, startLat, startLon, cableSegments = [], utmCalibrationData = null) {
  if (!posts || posts.length === 0) return { posts: [], connections: [] };

  const warnings = [];
  const sorted = [...posts].sort((a, b) => a.number - b.number);
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

  if (utmCalibrationData &&
      utmCalibrationData.utmGridPathsPerPage instanceof Map &&
      utmCalibrationData.viewportBoxes &&
      utmCalibrationData.pageDimensions instanceof Map) {

    const { utmGridPathsPerPage, viewportBoxes, pageDimensions } = utmCalibrationData;

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

    // Build page transforms (D-REV-11, D-REV-12)
    if (scaleFactor !== null && viewportBoxes.length > 0) {
      const post1 = sorted.find(p => p.number === sorted[0].number);
      const { zone } = latLonToUtm(startLat, startLon);
      utmZone = zone;
      const post1WithGps = { ...post1, lat: startLat, lon: startLon };
      pageTransforms = buildPageTransforms(post1WithGps, pageDimensions, viewportBoxes, scaleFactor, zone);
    } else if (scaleFactor === null) {
      warnings.push('[coordinate-calculator] Cannot calibrate: no scale factor available. Posts will have lat: null, lon: null.');
    } else {
      warnings.push('[coordinate-calculator] Cannot calibrate: no viewport boxes found. Posts will have lat: null, lon: null.');
    }
  } else {
    warnings.push('[coordinate-calculator] utmCalibrationData not provided or incomplete. Posts will have lat: null, lon: null.');
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

  // ── Build connections array (D-REV-14, D-REV-15, D-04, D-17) ────────────
  const connections = [];
  const branchStarts = new Set(topology.branches.map(b => b.start));
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

  return { posts: sorted, connections };
}
