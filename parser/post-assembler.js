// parser/post-assembler.js
// Assembles post data by spatial proximity matching between TEXTO text items
// and Numero_Poste circle centroids. Deduplicates posts across pages.
//
// Named ESM exports only — no default export, no CommonJS require.

// ~200 pt: Poste anchors are often on the label block, not at the circle centroid.
export const PROXIMITY_THRESHOLD = 200;

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
 * Horizontal anchor closer to visual center of a text run (pdf.js width).
 *
 * @param {{ x: number, y: number, width?: number }} t
 * @returns {{ x: number, y: number }}
 */
function textAnchor(t) {
  const w = typeof t.width === 'number' && t.width > 0 ? t.width : 0;
  return { x: w > 0 ? t.x + w * 0.5 : t.x, y: t.y };
}

/**
 * Match TEXTO text items to Numero_Poste circle centroids by spatial proximity.
 *
 * Only text items whose str matches /^\d{1,3}$/ (1-3 digit sequential numbers)
 * are considered. Each circle and each text is used at most once. Pairs are
 * chosen iteratively by the globally shortest edge within PROXIMITY_THRESHOLD
 * (with cross-page penalty for ranking), avoiding order bias from text-only greedy matching.
 *
 * @param {Array<{ str: string, x: number, y: number }>} textoItems
 *   Text items from the TEXTO layer (flipY already applied by pdf-parser.js).
 * @param {Array<{ x: number, y: number }>} circles
 *   Circle centroids from Numero_Poste layer (flipY already applied).
 * @param {string[]} warnings  Mutable warning accumulator (D-07).
 * @returns {{ posts: Array<{ number: number, x: number, y: number, pageNum?: number }>, warnings: string[] }}
 */
export function assemblePostData(textoItems, circles, warnings = []) {
  const posts = [];

  const digitItems = textoItems.filter(t => {
    const s = t.str.trim();
    return /^\d{1,3}$/.test(s) && parseInt(s, 10) >= 1;
  });
  const usedCircle = new Set();
  const usedText = new Set();

  // Greedy by globally shortest text–circle edge first (within threshold).
  // Text-ordered greedy caused under-matching when two labels “competed” for the same
  // nearest circle — the first text consumed it and the second fell outside 50 pt.
  while (true) {
    let bestTi = -1;
    let bestCi = -1;
    let bestDist = Infinity;
    let bestScore = Infinity;

    for (let ti = 0; ti < digitItems.length; ti++) {
      if (usedText.has(ti)) continue;
      const text = digitItems[ti];
      const anchor = textAnchor(text);
      for (let ci = 0; ci < circles.length; ci++) {
        if (usedCircle.has(ci)) continue;
        const d = distance2D(anchor, circles[ci]);
        const crossPagePenalty =
          (text.pageNum != null && circles[ci].pageNum != null && text.pageNum !== circles[ci].pageNum)
            ? CROSS_PAGE_PENALTY
            : 0;
        const score = d + crossPagePenalty;
        if (score < bestScore || (score === bestScore && d < bestDist)) {
          bestScore = score;
          bestDist = d;
          bestTi = ti;
          bestCi = ci;
        }
      }
    }

    if (bestTi === -1 || bestDist > PROXIMITY_THRESHOLD) break;

    const text = digitItems[bestTi];
    const trimmed = text.str.trim();
    console.debug(`[postAssembler] "${trimmed}" → circle ${bestCi}: ${bestDist.toFixed(1)} pt` +
      (bestScore > bestDist ? ` (cross-page, score=${bestScore.toFixed(0)})` : ''));

    usedText.add(bestTi);
    usedCircle.add(bestCi);
    const c = circles[bestCi];
    posts.push({
      number: parseInt(trimmed, 10),
      x: c.x,
      y: c.y,
      pageNum: c.pageNum,
    });
  }

  for (let ti = 0; ti < digitItems.length; ti++) {
    if (usedText.has(ti)) continue;
    const text = digitItems[ti];
    const trimmed = text.str.trim();
    const anchor = textAnchor(text);
    let nearestIdx = -1;
    let nearestDist = Infinity;
    for (let ci = 0; ci < circles.length; ci++) {
      const d = distance2D(anchor, circles[ci]);
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = ci;
      }
    }
    warnings.push(
      `Post number "${trimmed}" at (${anchor.x.toFixed(1)}, ${anchor.y.toFixed(1)}) ` +
        `has no nearby circle within ${PROXIMITY_THRESHOLD} PDF points` +
        (nearestIdx !== -1 ? ` (nearest: ${nearestDist.toFixed(1)} pt)` : '')
    );
  }

  return { posts, warnings };
}

/**
 * Deduplicate posts across pages, keeping first occurrence per sequential number.
 * Sorted by number ascending on return (D-13, D-11).
 *
 * @param {Array<{ number: number, x: number, y: number, pageNum?: number, postType?: string }>} allPosts
 * @returns {Array<{ number: number, x: number, y: number, pageNum?: number, postType?: string }>}
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

/**
 * One post per sequential number: keep the occurrence on the **lowest page number**
 * (overview sheets are usually earlier than zoom/detail duplicates).
 *
 * @param {Array<{ number: number, x: number, y: number, pageNum?: number, postType?: string }>} allPosts
 * @returns {Array<{ number: number, x: number, y: number, pageNum?: number, postType?: string }>}
 */
export function deduplicatePostsPreferLowerPage(allPosts) {
  const byNum = new Map();
  for (const p of allPosts) {
    const n = p.number;
    const prev = byNum.get(n);
    const pPage = p.pageNum ?? 9999;
    const prevPage = prev?.pageNum ?? 9999;
    if (!prev || pPage < prevPage) byNum.set(n, p);
  }
  return [...byNum.values()].sort((a, b) => a.number - b.number);
}
