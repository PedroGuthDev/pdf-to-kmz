// parser/layer-sources.js
// Maps real-world optional-content names (AutoCAD / civil exports) onto parser roles.
// Keep in sync with debug-pdf.mjs heuristic filters if you change rules here.

import { normalizeName } from './ocg-map.js';

/**
 * Layers whose text we treat as post number / label candidates (same pipeline as TEXTO).
 * Canonical names plus common variants (e.g. Palhoça sample: txt_moldura_intelig, Texto_3).
 *
 * @param {string} rawName  OCG name from BDC / textByLayer key
 * @returns {boolean}
 */
export function isPostLabelSourceLayerName(rawName) {
  const n = normalizeName(rawName);
  if (n === normalizeName('TEXTO')) return true;
  if (n === normalizeName('Numero_Poste')) return true;
  // Poste: pole visuals + type labels (e.g. 10-300 (U)) — not route sequential numbers (01, 02…).
  if (n === normalizeName('Poste')) return true;
  if (n.includes('moldura') && n.includes('intelig')) return true;
  if (n.startsWith('texto_')) return true;
  return false;
}

/**
 * Layers that carry sequential post numbers (01, 02…) for **legacy / multi-vendor** text paths
 * (TEXTO, Numero_Poste text, txt_moldura_intelig, Texto_3, etc.). Excludes `Poste` (pole specs only).
 *
 * @param {string} rawName
 * @returns {boolean}
 */
export function isSequentialPostNumberLayerName(rawName) {
  if (rawName == null || rawName === '') return false;
  if (!isPostLabelSourceLayerName(rawName)) return false;
  const n = normalizeName(rawName);
  if (n === normalizeName('Poste')) return false;
  return true;
}

/**
 * OCG layers whose text carries route sequential post numbers (01, 02…).
 * Alias of {@link isSequentialPostNumberLayerName} — post-label text **except** `Poste`.
 *
 * @param {string} rawName
 * @returns {boolean}
 */
export function isRouteSequentialNumberLayerName(rawName) {
  return isSequentialPostNumberLayerName(rawName);
}

/**
 * Layers whose text we treat as inter-post distance labels.
 *
 * @param {string} rawName
 * @returns {boolean}
 */
export function isDistanceSourceLayerName(rawName) {
  const n = normalizeName(rawName);
  if (n === normalizeName('Distância_Poste')) return true;
  return false;
}

/**
 * Layers whose constructPath calls define Numero_Poste circle centroids (CTM e,f).
 * Some civil exports use the literal "0" for the post geometry group.
 *
 * @param {string|null|undefined} rawName
 * @returns {boolean}
 */
export function isCircleCentroidLayerName(rawName) {
  if (rawName == null || rawName === '') return false;
  if (rawName === '0') return true;
  const n = normalizeName(rawName);
  if (n === normalizeName('Numero_Poste')) return true;
  if (n.includes('numero') && n.includes('poste')) return true;
  return false;
}

/**
 * Poste OCG layer: pole graphics (e.g. square with X) — not the Numero_Poste circle layer.
 *
 * @param {string|null|undefined} rawName
 * @returns {boolean}
 */
export function isPosteGraphicsLayerName(rawName) {
  if (rawName == null || rawName === '') return false;
  return normalizeName(rawName) === normalizeName('Poste');
}

/**
 * Layers containing the 50m UTM grid lines used for per-page coordinate calibration.
 * Canonical name: "UTM" (confirmed from INFOVIAS PDF metadata).
 *
 * @param {string|null|undefined} rawName
 * @returns {boolean}
 */
export function isUtmGridLayerName(rawName) {
  if (rawName == null || rawName === '') return false;
  return normalizeName(rawName) === 'utm';
}

/**
 * Layer containing viewport rectangle boundaries on page 2 (overview).
 * Canonical name: "Padrão" — confirmed by user inspection of real INFOVIAS PDF (2026-05-15).
 *
 * @param {string|null|undefined} rawName
 * @returns {boolean}
 */
export function isViewportRectLayerName(rawName) {
  if (rawName == null || rawName === '') return false;
  return normalizeName(rawName) === normalizeName('Padrão');
}
