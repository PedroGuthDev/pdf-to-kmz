// parser/distance-associator.js
// Associates inter-post distances from the Distância_Poste layer to sequential
// post pairs by finding the nearest distance label to each pair's midpoint.
//
// Named ESM exports only — no default export, no CommonJS require.

/**
 * Shortest distance from point (px,py) to segment A–B (clamped).
 *
 * @param {number} px
 * @param {number} py
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 */
function distPointToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const ab2 = abx * abx + aby * aby;
  let t = ab2 > 1e-12 ? (apx * abx + apy * aby) / ab2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Pair sequential posts (N → N+1 by number) and associate each pair with the
 * nearest distance label from the Distância_Poste layer.
 *
 * IMPORTANT — Brazilian locale: distance values in the PDF use a comma as the
 * decimal separator (e.g., "40,2" instead of "40.2"). Commas are replaced with
 * dots before parseFloat.
 *
 * @param {Array<{ number: number, x: number, y: number }>} posts
 *   Deduplicated, sorted posts (flipY applied).
 * @param {Array<{ str: string, x: number, y: number, width?: number }>} distItems
 *   Text items from Distância_Poste layer (flipY applied). Optional `width` improves
 *   association when the label anchor is the glyph box left edge.
 * @param {string[]} warnings  Mutable warning accumulator (D-07).
 * @returns {{ distances: Array<{ from: number, to: number, meters: number|null }>, warnings: string[] }}
 */
export function associateDistances(posts, distItems, warnings = []) {
  const distances = [];

  // Sort posts by number to establish sequential pairs (D-10).
  const sortedPosts = [...posts].sort((a, b) => a.number - b.number);

  for (let i = 0; i < sortedPosts.length - 1; i++) {
    const from = sortedPosts[i];
    const to = sortedPosts[i + 1];

    let nearest = null;
    let nearestDist = Infinity;

    for (const dt of distItems) {
      const normalized = dt.str.trim().replace(/\s+/g, '').replace(',', '.');
      // Accept integer or decimal distance values (Brazilian comma included).
      if (!/^\d+(\.\d+)?$/.test(normalized)) continue;

      const w = typeof dt.width === 'number' && dt.width > 0 ? dt.width : 0;
      const lx = w > 0 ? dt.x + w * 0.5 : dt.x;
      const ly = dt.y;
      const d = distPointToSegment(lx, ly, from.x, from.y, to.x, to.y);

      if (d < nearestDist) {
        nearestDist = d;
        nearest = { item: dt, normalized };
      }
    }

    if (!nearest) {
      // D-07: push warning, record null distance, continue.
      warnings.push(
        `No distance label found between posts ${from.number} and ${to.number}`
      );
      distances.push({ from: from.number, to: to.number, meters: null });
    } else {
      distances.push({
        from: from.number,
        to: to.number,
        meters: parseFloat(nearest.normalized),
      });
    }
  }

  return { distances, warnings };
}
