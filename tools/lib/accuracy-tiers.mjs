/**
 * Shared four-tier GPS accuracy classifier (D-03).
 *
 * perfect ≤5 m · good ≤10 m · acceptable ≤15 m · bad >15 m
 *
 * @module accuracy-tiers
 */

/** @param {number} m error in metres */
export const tierOf = (m) =>
  m <= 5 ? "perfect" : m <= 10 ? "good" : m <= 15 ? "acceptable" : "bad";

/**
 * Count posts per tier.
 *
 * @param {Map<number, number>} errorsByPost post number → metres
 * @returns {{ perfect: number, good: number, acceptable: number, bad: number }}
 */
export function histogram(errorsByPost) {
  const counts = { perfect: 0, good: 0, acceptable: 0, bad: 0 };
  for (const [, m] of errorsByPost) {
    counts[tierOf(m)]++;
  }
  return counts;
}

/**
 * Posts exceeding the bad-tier floor (>15 m).
 *
 * @param {Map<number, number>} errorsByPost
 * @returns {[number, number][]} sorted [postNumber, metres]
 */
export function badPosts(errorsByPost) {
  return [...errorsByPost]
    .filter(([, m]) => m > 15)
    .sort((a, b) => a[0] - b[0]);
}

/**
 * @param {{ perfect: number, good: number, acceptable: number, bad: number }} counts
 */
export function formatHistogramLine(counts) {
  return (
    `perfect (≤5 m)=${counts.perfect}, ` +
    `good (≤10 m)=${counts.good}, ` +
    `acceptable (≤15 m)=${counts.acceptable}, ` +
    `bad (>15 m)=${counts.bad}`
  );
}
