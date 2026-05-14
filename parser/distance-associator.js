// parser/distance-associator.js
// Associates inter-post distances from the Distância_Poste layer to sequential
// post pairs by finding the nearest distance label to each pair's midpoint.
//
// Named ESM exports only — no default export, no CommonJS require.

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
 * @param {Array<{ str: string, x: number, y: number }>} distItems
 *   Text items from Distância_Poste layer (flipY applied).
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

    // Midpoint between the two post circle positions.
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;

    let nearest = null;
    let nearestDist = Infinity;

    for (const dt of distItems) {
      const normalized = dt.str.trim().replace(',', '.');
      // Accept integer or decimal distance values (Brazilian comma included).
      if (!/^\d+(\.\d+)?$/.test(normalized)) continue;

      const dx = dt.x - midX;
      const dy = dt.y - midY;
      const d = Math.sqrt(dx * dx + dy * dy);

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
