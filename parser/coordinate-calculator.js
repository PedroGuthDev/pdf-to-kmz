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
 * Calculate GPS coordinates for all posts in a linear sequence.
 *
 * Algorithm:
 * 1. Sort posts by number ascending
 * 2. Assign startLat/startLon to post #1 (lowest-numbered — D-14)
 * 3. For each sequential pair, calculate bearing from PDF coords and project GPS
 *
 * Bearing formula (D-02, RESEARCH Section 1):
 *   After flipY: +x = east, +y = south (y increases downward)
 *   bearingRad = atan2(dx, northward) where northward = curr.y - next.y
 *   CRITICAL: Do NOT double-negate. See 02-RESEARCH.md double-negation trap.
 *
 * GPS projection (D-05, RESEARCH Section 2):
 *   Flat-Earth approximation with cos(lat) correction.
 *   Error < 0.01m over full route at street-level distances.
 *
 * @param {Array<{ number: number, x: number, y: number, pageNum?: number, postType?: string }>} posts
 * @param {Array<{ from: number, to: number, meters: number|null }>} distances
 * @param {number} startLat  Latitude of post #1.
 * @param {number} startLon  Longitude of post #1.
 * @returns {Array<{ number: number, x: number, y: number, lat: number, lon: number, pageNum?: number, postType?: string }>}
 *   Posts enriched with lat/lon fields (D-16). Posts with no distance get undefined lat/lon.
 */
export function calculateCoordinates(posts, distances, startLat, startLon) {
  if (!posts || posts.length === 0) return [];

  // 1. Sort posts by number ascending
  const sorted = [...posts].sort((a, b) => a.number - b.number);

  // Build a lookup map: distance from post A -> post B
  const distMap = new Map();
  for (const d of distances) {
    distMap.set(`${d.from}->${d.to}`, d.meters);
    distMap.set(`${d.to}->${d.from}`, d.meters); // bidirectional lookup
  }

  // 2. Assign starting coordinates to post #1 (D-14)
  sorted[0].lat = startLat;
  sorted[0].lon = startLon;

  // 3. Propagate coordinates for each sequential pair
  for (let i = 0; i < sorted.length - 1; i++) {
    const curr = sorted[i];
    const next = sorted[i + 1];

    // Skip if current post has no coordinates (gap from earlier)
    if (curr.lat === undefined || curr.lon === undefined) continue;

    // Calculate bearing from PDF x,y positions
    // After flipY: +x = east, y increases downward = south
    // North component = curr.y - next.y (smaller y = further north)
    const dx = next.x - curr.x;
    const northward = curr.y - next.y;
    const bearingRad = Math.atan2(dx, northward);
    const bearingDeg = (bearingRad * 180 / Math.PI + 360) % 360;

    // Look up distance between this pair
    const meters = distMap.get(`${curr.number}->${next.number}`);

    if (meters != null && meters > 0) {
      // Project GPS using flat-Earth approximation (D-05)
      // 111320 meters ≈ 1 degree of latitude at WGS-84
      const dLat = (meters * Math.cos(bearingRad)) / 111320;
      const dLon = (meters * Math.sin(bearingRad)) / (111320 * Math.cos(curr.lat * Math.PI / 180));

      next.lat = curr.lat + dLat;
      next.lon = curr.lon + dLon;
    }
    // If meters is null (gap), leave lat/lon undefined — Plan 02-02 handles gaps.
  }

  return sorted;
}
