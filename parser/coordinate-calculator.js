// parser/coordinate-calculator.js
// GPS coordinate calculation from PDF positions and inter-post distances.
// Implements bearing inference, flat-Earth GPS projection, and coordinate
// input parsing/validation for the Phase 2 pipeline.
//
// Named ESM exports only — no default export, no CommonJS require.

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
 * @param {Array<{ number: number, x: number, y: number }>} posts
 * @param {Array<{ from: number, to: number, meters: number|null }>} distances
 * @param {Array<{ ops: Array<{ x?: number, y?: number }> }>} cableSegments
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
 * Calculate GPS coordinates for all posts in the route graph (main route + branches).
 * Also outputs a connections array for KMZ drawing.
 *
 * @param {Array<{ number: number, x: number, y: number, pageNum?: number, postType?: string }>} posts
 * @param {Array<{ from: number, to: number, meters: number|null }>} distances
 * @param {number} startLat  Latitude of post #1.
 * @param {number} startLon  Longitude of post #1.
 * @param {Array<{ ops: Array<{ x?: number, y?: number }> }>} cableSegments
 * @returns {{ posts: Array, connections: Array }}
 */
export function calculateCoordinates(posts, distances, startLat, startLon, cableSegments = []) {
  if (!posts || posts.length === 0) return { posts: [], connections: [] };

  const sorted = [...posts].sort((a, b) => a.number - b.number);
  const postMap = new Map(sorted.map(p => [p.number, p]));

  const distMap = new Map();
  for (const d of distances) {
    distMap.set(`${d.from}->${d.to}`, d.meters);
    distMap.set(`${d.to}->${d.from}`, d.meters); // bidirectional lookup
  }

  const topology = detectRouteTopology(sorted);
  const gaps = detectGaps(sorted, distances, cableSegments);
  const gapSet = new Set(gaps.map(g => `${g.from}->${g.to}`));

  const connections = [];

  // Calculate scale factor (average meters / pdfDistance) for gap crossing (D-11)
  let sumMeters = 0;
  let sumPdf = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (topology.branches.some(br => br.start === b.number)) continue;
    const m = distMap.get(`${a.number}->${b.number}`);
    if (m != null && m > 0) {
      sumMeters += m;
      sumPdf += Math.hypot(b.x - a.x, b.y - a.y);
    }
  }
  const scaleFactor = sumPdf > 0 ? sumMeters / sumPdf : 0;

  if (scaleFactor === 0 && gaps.length > 0) {
    console.warn("[pdf-to-kmz] No known distances found. Gap estimation fallback to unscaled PDF points.");
  }

  // Assign starting coordinates
  sorted[0].lat = startLat;
  sorted[0].lon = startLon;

  const branchStarts = new Set(topology.branches.map(b => b.start));
  const branchJunctionMap = new Map(topology.branches.map(b => [b.start, b.junctionPost]));

  for (let i = 0; i < sorted.length; i++) {
    const curr = sorted[i];

    // Check if this is a branch start
    if (branchStarts.has(curr.number)) {
      const junctionId = branchJunctionMap.get(curr.number);
      if (junctionId != null) {
        const junc = postMap.get(junctionId);
        if (junc && junc.lat !== undefined && junc.lon !== undefined) {
          let m = distMap.get(`${junc.number}->${curr.number}`);
          const pdfD = Math.hypot(curr.x - junc.x, curr.y - junc.y);
          if (m == null) {
            m = pdfD * (scaleFactor || 1); // fallback to 1 if scaleFactor is 0
          }
          
          const dx = curr.x - junc.x;
          const dy = junc.y - curr.y;
          const bearingRad = Math.atan2(dx, dy);
          const bearingDeg = (bearingRad * 180 / Math.PI + 360) % 360;

          if (m > 0) {
            const dLat = (m * Math.cos(bearingRad)) / 111320;
            const dLon = (m * Math.sin(bearingRad)) / (111320 * Math.cos(junc.lat * Math.PI / 180));
            curr.lat = junc.lat + dLat;
            curr.lon = junc.lon + dLon;
          } else {
            curr.lat = junc.lat;
            curr.lon = junc.lon;
          }

          connections.push({
            from: junc.number,
            to: curr.number,
            meters: m,
            bearing: bearingDeg,
            gap: false // branch junction lines are always logically connected
          });
        }
      }
    }

    // Process forward connection within the same route sequence
    if (i < sorted.length - 1) {
      const next = sorted[i + 1];

      // Skip if the next post starts a new branch
      if (branchStarts.has(next.number)) continue;

      if (curr.lat !== undefined && curr.lon !== undefined) {
        let m = distMap.get(`${curr.number}->${next.number}`);
        const isGap = gapSet.has(`${curr.number}->${next.number}`);
        
        const pdfD = Math.hypot(next.x - curr.x, next.y - curr.y);
        
        if (m == null) {
          m = pdfD * (scaleFactor || 1);
        }

        const dx = next.x - curr.x;
        const dy = curr.y - next.y;
        const bearingRad = Math.atan2(dx, dy);
        const bearingDeg = (bearingRad * 180 / Math.PI + 360) % 360;

        if (m > 0) {
          const dLat = (m * Math.cos(bearingRad)) / 111320;
          const dLon = (m * Math.sin(bearingRad)) / (111320 * Math.cos(curr.lat * Math.PI / 180));
          
          next.lat = curr.lat + dLat;
          next.lon = curr.lon + dLon;
        } else {
          next.lat = curr.lat;
          next.lon = curr.lon;
        }

        connections.push({
          from: curr.number,
          to: next.number,
          meters: m,
          bearing: bearingDeg,
          gap: isGap
        });
      }
    }
  }

  return { posts: sorted, connections };
}
