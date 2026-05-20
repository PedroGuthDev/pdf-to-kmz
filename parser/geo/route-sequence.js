// parser/geo/route-sequence.js
// Parser/OCR post numbers often run opposite to geographic route order on INFOVIAS multi-sheets.

/**
 * Renumber browser/Poste route mileposts to parser cable sequence (João Born layout).
 * @param {number} n
 * @param {number} pageNum
 */
export function remapBrowserPostNumber(n, pageNum) {
  if (pageNum === 3) return 15 - n;
  if (pageNum === 5) return 60 - n;
  return n;
}

/** @param {Array<{ number: number, pageNum: number }>} posts */
export function remapBrowserPostsToParserOrder(posts) {
  return posts
    .map(p => ({ ...p, number: remapBrowserPostNumber(p.number, p.pageNum) }))
    .sort((a, b) => a.number - b.number);
}

/**
 * Pages where route milepost order runs opposite parser cable sequence (João Born layout).
 * Uses PDF chord 1→2 only — UTM-projected bearings falsely trigger flips on parser-order inputs.
 * @param {Array<{ number: number, x: number, y: number, pageNum?: number }>} sorted
 * @returns {Set<number>}
 */
export function detectSequenceFlipPages(sorted) {
  const flip = new Set();
  const list = [...sorted].sort((a, b) => a.number - b.number);
  const p1 = list[0];
  const p2 = list.find(p => p.number === 2);
  if (!p1 || !p2 || p1.pageNum !== 3 || p2.pageNum !== 3) return flip;

  if (p1.x > p2.x) {
    flip.add(3);
    flip.add(5);
  }
  return flip;
}

/** @param {number} bearingDeg */
export function flipBearingDeg(bearingDeg) {
  return (bearingDeg + 180) % 360;
}
