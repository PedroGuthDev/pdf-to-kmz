// parser/post-assembler.js
// Assembles post data by spatial proximity matching between TEXTO text items
// and Numero_Poste circle centroids. Deduplicates posts across pages.
//
// Named ESM exports only — no default export, no CommonJS require.

// 50 PDF points proximity threshold per Plan 01-02 Task 3.
// Circle radius ≈ 35.5 PDF points (from SKELETON.md A1 bounding box ±35.5).
// 50 pt gives enough margin to match the number label positioned near the circle.
const PROXIMITY_THRESHOLD = 50;

// Cross-page penalty: added to distance when text and circle are on different pages.
// Large enough to always prefer a same-page match over any cross-page match (CR-03).
const CROSS_PAGE_PENALTY = 1e6;

/**
 * Euclidean distance between two {x, y} points.
 * @param {{ x: number, y: number }} a
 * @param {{ x: number, y: number }} b
 * @returns {number}
 */
function distance2D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Match TEXTO text items to Numero_Poste circle centroids by spatial proximity.
 *
 * Only text items whose str matches /^\d{1,3}$/ (1-3 digit sequential numbers)
 * are considered. Each circle is consumed at most once (greedy nearest-first).
 *
 * @param {Array<{ str: string, x: number, y: number }>} textoItems
 *   Text items from the TEXTO layer (flipY already applied by pdf-parser.js).
 * @param {Array<{ x: number, y: number }>} circles
 *   Circle centroids from Numero_Poste layer (flipY already applied).
 * @param {string[]} warnings  Mutable warning accumulator (D-07).
 * @returns {{ posts: Array<{ number: number, x: number, y: number }>, warnings: string[] }}
 */
export function assemblePostData(textoItems, circles, warnings = []) {
  const posts = [];
  const usedCircles = new Set();

  for (const text of textoItems) {
    const trimmed = text.str.trim();

    // Filter to sequential post numbers only (1-3 digit integers).
    if (!/^\d{1,3}$/.test(trimmed)) continue;

    let nearestIdx = -1;
    let nearestDist = Infinity;      // raw geometric distance (for threshold check)
    let nearestScore = Infinity;     // penalised score (for ranking — same-page preferred)

    for (let i = 0; i < circles.length; i++) {
      if (usedCircles.has(i)) continue;
      const d = distance2D(text, circles[i]);
      // CR-03: penalise cross-page matches so same-page circles always win.
      const crossPagePenalty =
        (text.pageNum != null && circles[i].pageNum != null && text.pageNum !== circles[i].pageNum)
          ? CROSS_PAGE_PENALTY
          : 0;
      const score = d + crossPagePenalty;
      if (score < nearestScore) {
        nearestScore = score;
        nearestDist  = d;
        nearestIdx   = i;
      }
    }

    // WR-03: log nearest distance to help diagnose threshold issues.
    if (nearestIdx !== -1) {
      console.debug(`[postAssembler] "${trimmed}" nearest circle: ${nearestDist.toFixed(1)} pt` +
        (nearestScore > nearestDist ? ` (cross-page, score=${nearestScore.toFixed(0)})` : ''));
    }

    if (nearestIdx === -1 || nearestDist > PROXIMITY_THRESHOLD) {
      // D-07: skip element, push warning, continue.
      warnings.push(
        `Post number "${trimmed}" at (${text.x.toFixed(1)}, ${text.y.toFixed(1)}) ` +
        `has no nearby circle within ${PROXIMITY_THRESHOLD} PDF points` +
        (nearestIdx !== -1 ? ` (nearest: ${nearestDist.toFixed(1)} pt)` : '')
      );
      continue;
    }

    usedCircles.add(nearestIdx);
    posts.push({
      number: parseInt(trimmed, 10),
      x: circles[nearestIdx].x,
      y: circles[nearestIdx].y,
    });
  }

  return { posts, warnings };
}

/**
 * Deduplicate posts across pages, keeping first occurrence per sequential number.
 * Sorted by number ascending on return (D-13, D-11).
 *
 * @param {Array<{ number: number, x: number, y: number }>} allPosts
 * @returns {Array<{ number: number, x: number, y: number }>}
 */
export function deduplicatePosts(allPosts) {
  const seen = new Set();
  const deduped = allPosts.filter(p => {
    if (seen.has(p.number)) return false;
    seen.add(p.number);
    return true;
  });
  return deduped.sort((a, b) => a.number - b.number);
}
