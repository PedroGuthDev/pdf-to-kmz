/**
 * Convert CSS hex colors to KML aabbggrr byte order.
 */

/**
 * @param {string} hex - `#RRGGBB` or `RRGGBB`
 * @param {number} [alpha=255] - 0–255
 * @returns {string} lowercase `aabbggrr`
 */
export function hexToKmlColor(hex, alpha = 0xff) {
  const raw = String(hex).trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) {
    throw new Error(`invalid hex color: ${hex}`);
  }
  const a = Math.max(0, Math.min(255, alpha | 0));
  const aa = a.toString(16).padStart(2, '0');
  const rr = raw.slice(0, 2);
  const gg = raw.slice(2, 4);
  const bb = raw.slice(4, 6);
  return `${aa}${bb}${gg}${rr}`.toLowerCase();
}
