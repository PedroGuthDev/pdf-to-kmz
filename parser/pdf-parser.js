// parser/pdf-parser.js
// Top-level orchestrator. The only module with a pdf.js CDN import.
// Exports parsePdf(arrayBuffer) — the Phase 1 output contract consumed by Phase 2.
//
// Output contract (success):
//   { posts, distances, cableSegments, warnings, layerMap: { allNames } }
//   posts[]: { number, x, y, pageNum?, postType? } — route numbers (01, 02…) from **TEXTO** or
//     **Numero_Poste** OCG text (TEXTO nested inside Numero_Poste) matched to circle geometry;
//     x,y from circle centroids then snap to Poste **graphics** (square/X from constructPath).
//     postType from Poste **text** (e.g. "10-300 (U)").
// Output contract (error cases):
//   { error: 'missing_layers', missing: String[], allNames: String[] }
//   { error: 'parse_failed', message: String, warnings: String[] }
//
// Named ESM export only — no default export, no CommonJS require.

import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.mjs';

// Set worker URL immediately after import (required before any getDocument() call).
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.worker.min.mjs';

import { buildOcgMap, validateLayers, normalizeName } from './ocg-map.js';
import { isPostLabelSourceLayerName, isDistanceSourceLayerName, isRouteSequentialNumberLayerName } from './layer-sources.js';
import { extractLayerText }                            from './text-extractor.js';
import { extractLayerGraphics }                        from './graphics-extractor.js';
import { assemblePostData, deduplicatePostsPreferLowerPage, PROXIMITY_THRESHOLD } from './post-assembler.js';
import { associateDistances }                          from './distance-associator.js';
import { buildCableSegments, minDistancePointToCablesOnPage } from './cable-builder.js';

/**
 * Keep only 1–3 digit strings whose position lies within `threshold` PDF points
 * of some post circle (same page when both sides carry pageNum).
 * Stops legend / table integers from competing with real post labels (see phase 01 UAT).
 *
 * @param {Array<{ str: string, x: number, y: number, pageNum?: number }>} items
 * @param {Array<{ x: number, y: number, pageNum?: number }>} circles
 * @param {number} threshold
 */
function integerTextsNearCircles(items, circles, threshold) {
  const circlesByPage = new Map();
  for (const c of circles) {
    const p = c.pageNum ?? 1;
    if (!circlesByPage.has(p)) circlesByPage.set(p, []);
    circlesByPage.get(p).push(c);
  }
  return items.filter((text) => {
    const ts = text.str.trim();
    if (!/^\d{1,3}$/.test(ts) || parseInt(ts, 10) < 1) return false;
    const tp = text.pageNum ?? 1;
    const onTextPage = circlesByPage.get(tp) ?? [];
    // PDF pages use separate user spaces — never match text to circles on other pages.
    if (onTextPage.length === 0) return false;
    const w = typeof text.width === 'number' && text.width > 0 ? text.width : 0;
    const ax = w > 0 ? text.x + w * 0.5 : text.x;
    for (const c of onTextPage) {
      const dx = ax - c.x;
      const dy = text.y - c.y;
      if (Math.hypot(dx, dy) <= threshold) return true;
    }
    return false;
  });
}

/**
 * Mask conductor / cable annotations so we do not split "10-150" into "10" + "150"
 * at the same anchor (creates duplicate false post numbers).
 *
 * @param {string} s
 * @returns {string}
 */
function maskConductorLikeSpecs(s) {
  return s
    .replace(/\b\d{1,3}\s*-\s*\d{1,3}\b/g, ' ')
    .replace(/\b\d{1,3}\s*[xX]\s*\d{1,4}\b/g, ' ');
}

/**
 * @param {Array<{ str: string, x: number, y: number, pageNum?: number }>} items
 */
function dedupePostIntCandidates(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const k = `${it.pageNum ?? 1}|${it.str.trim()}|${Math.round(it.x * 4)}|${Math.round(it.y * 4)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

/**
 * Text anchor for post digit candidates (same convention as post-assembler).
 *
 * @param {{ x: number, y: number, width?: number }} it
 */
function postCandidateAnchorXY(it) {
  const w = typeof it.width === 'number' && it.width > 0 ? it.width : 0;
  return { x: w > 0 ? it.x + w * 0.5 : it.x, y: it.y };
}

/**
 * For duplicate post digit (same page + same string), keep the anchor closest to any
 * post circle on that page. Does **not** discard labels by numeric index vs circle count
 * (that heuristic misclassified real post numbers on some INFOVIAS exports).
 *
 * @param {Array<{ str: string, x: number, y: number, pageNum?: number, width?: number }>} candidates
 * @param {Array<{ x: number, y: number, pageNum?: number }>} circles
 */
function dedupePostDigitCandidatesNearestCircle(candidates, circles) {
  if (!candidates.length || !circles.length) return candidates;

  const countByPage = new Map();
  for (const c of circles) {
    const p = c.pageNum ?? 1;
    countByPage.set(p, (countByPage.get(p) ?? 0) + 1);
  }

  const onCirclePage = [];
  const orphanPage = [];
  for (const it of candidates) {
    const p = it.pageNum ?? 1;
    if ((countByPage.get(p) ?? 0) < 1) orphanPage.push(it);
    else onCirclePage.push(it);
  }

  const byKey = new Map();
  for (const it of onCirclePage) {
    const p = it.pageNum ?? 1;
    const key = `${p}|${String(it.str).trim()}`;
    const pageCircles = circles.filter(c => (c.pageNum ?? 1) === p);
    const pt = postCandidateAnchorXY(it);
    let minD = Infinity;
    for (const c of pageCircles) {
      const d = Math.hypot(pt.x - c.x, pt.y - c.y);
      if (d < minD) minD = d;
    }
    const prev = byKey.get(key);
    if (!prev || minD < prev.minD) byKey.set(key, { it, minD });
  }
  const deduped = [...byKey.values()].map(v => v.it);
  return deduped.concat(orphanPage);
}

// Centroid vs PDF text origin: use width/2 and a generous band — strict whole-item
// checks still miss when "01" shares a TJ with other glyphs.
const INSIDE_POST_STRICT_MAX_PT = 118;
const INSIDE_POST_MASKED_MAX_PT = 102;
/** When circle set is already restricted to drawing sheets, masked hits use a tighter cap. */
const INSIDE_POST_MASKED_TIGHT_PT = 56;
/** Max distance from circle to a route digit on **TEXTO** or **Numero_Poste** OCG text (layer-anchor filter). */
const LAYER_ANCHOR_TO_CIRCLE_MAX_PT = 195;
/** Minimum anchored circles before trusting layer-only filter over distance-page fallback. */
const MIN_LAYER_ANCHORED_CIRCLES = 6;
/** Whole-item digit (getTextContent) within this distance counts as a strict anchor for page scoring. */
const GETTEXT_STRICT_ANCHOR_PT = 195;
/**
 * After strict pass: first masked isolated 1–3 digit within this distance also counts for
 * **page-level** scoring only (tighter than assembly masked path — limits junk-sheet inflation).
 */
const GETTEXT_MASKED_ANCHOR_PT = 50;

/**
 * Keep pages whose anchor ratio is at least this fraction of the best page (primary rule).
 */
const ANCHOR_PAGE_REL_TO_BEST = 0.42;
/** Floor blended with relative rule when the best page is mediocre. */
const ANCHOR_PAGE_RATIO_FLOOR = 0.026;
/** When best vs worst page spread is at least this, allow a stricter relative cut. */
const ANCHOR_PAGE_SPREAD_TRIGGER = 0.034;
/** Stricter relative cut when spread trigger fires. */
const ANCHOR_PAGE_REL_STRICT = 0.62;
/** Outlier: page with this many circles and ratio below best×this is dropped. */
const ANCHOR_OUTLIER_HEAVY_CIRCLES = 13;
const ANCHOR_OUTLIER_REL_MAX = 0.52;
/** Outlier: page ratio this far below best can be dropped only if that page is clearly weak. */
const ANCHOR_OUTLIER_GAP = 0.22;

/**
 * Circles that sit near a whole-item sequential route number on **TEXTO** or **Numero_Poste**
 * OCG text (TEXTO nested inside Numero_Poste — text may be tagged with either name).
 *
 * @param {Array<{ x: number, y: number, pageNum?: number }>} circles
 * @param {Array<{ str: string, x: number, y: number, pageNum?: number, layerName?: string, width?: number }>} textoItems
 * @param {number} maxPt
 */
function circlesNearLayerSequentialDigits(circles, textoItems, maxPt) {
  const seqItems = textoItems.filter(
    it =>
      it.layerName != null &&
      isRouteSequentialNumberLayerName(it.layerName) &&
      /^\d{1,3}$/.test(String(it.str).trim())
  );
  return circles.filter(c => {
    const p = c.pageNum ?? 1;
    for (const it of seqItems) {
      if ((it.pageNum ?? 1) !== p) continue;
      const w = typeof it.width === 'number' && it.width > 0 ? it.width : 0;
      const ax = w > 0 ? it.x + w * 0.5 : it.x;
      if (Math.hypot(ax - c.x, it.y - c.y) <= maxPt) return true;
    }
    return false;
  });
}

/**
 * Per-page: share of circles that have a nearby post digit from getTextContent — first
 * a whole-item 1–3 digit within `strictDist`, else (if still no hit) the first masked isolated
 * digit within the tighter `maskedDist` (page scoring only).
 *
 * @param {Array<{ page: import('pdfjs-dist').PDFPageProxy, pageHeight: number, pageNum: number }>} pageCache
 * @param {Array<{ x: number, y: number, pageNum?: number }>} validCircles
 * @param {number} strictDist
 * @param {number} maskedDist  Secondary hit using masked first digit (tighter).
 * @returns {Promise<Map<number, { circles: number, anchored: number, ratio: number }>>}
 */
async function computePageCircleAnchorStats(pageCache, validCircles, strictDist, maskedDist) {
  /** @type {Map<number, { circles: number, anchored: number, ratio: number }>} */
  const stats = new Map();
  const reMasked = /(?<!\d)(\d{1,3})(?!\d)/;
  for (const { page, pageHeight, pageNum } of pageCache) {
    const pageCircles = validCircles.filter(c => (c.pageNum ?? 1) === pageNum);
    const nc = pageCircles.length;
    if (nc === 0) continue;
    const textContent = await page.getTextContent();
    let anchored = 0;
    for (const c of pageCircles) {
      let hit = false;
      for (const item of textContent.items) {
        if (item.str == null) continue;
        const str = String(item.str).trim();
        if (!/^\d{1,3}$/.test(str)) continue;
        const n = parseInt(str, 10);
        if (n < 1) continue;
        const tx = item.transform[4];
        const w = typeof item.width === 'number' && item.width > 0 ? item.width : 0;
        const xPos = w > 0 ? tx + w * 0.5 : tx;
        const yFlipped = pageHeight - item.transform[5];
        if (Math.hypot(xPos - c.x, yFlipped - c.y) <= strictDist) {
          hit = true;
          break;
        }
      }
      if (!hit) {
        for (const item of textContent.items) {
          if (item.str == null) continue;
          const strTrim = String(item.str).trim();
          if (!strTrim || looksLikeDistanceLabel(strTrim)) continue;
          if (looksLikeEngineeringAnnotation(strTrim)) continue;
          const masked = maskConductorLikeSpecs(strTrim);
          const m = reMasked.exec(masked);
          if (!m) continue;
          const postNum = parseInt(m[1], 10);
          if (postNum < 1) continue;
          const tx = item.transform[4];
          const w = typeof item.width === 'number' && item.width > 0 ? item.width : 0;
          const xPos = w > 0 ? tx + w * 0.5 : tx;
          const yFlipped = pageHeight - item.transform[5];
          if (Math.hypot(xPos - c.x, yFlipped - c.y) <= maskedDist) {
            hit = true;
            break;
          }
        }
      }
      if (hit) anchored++;
    }
    stats.set(pageNum, { circles: nc, anchored, ratio: nc > 0 ? anchored / nc : 0 });
  }
  return stats;
}

/**
 * Drop route sheets that are clearly weaker than the best page (relative + outlier rules).
 * No absolute “min best ratio” gate — works when every page looks mediocre in absolute terms.
 *
 * @returns {{ circles: typeof validCircles | null, maxRatio: number, minRatio: number }}
 */
function circlesFromAnchorDensityPages(validCircles, stats, warnings) {
  if (stats.size === 0) {
    return { circles: null, maxRatio: 0, minRatio: 0 };
  }

  let maxRatio = 0;
  let minRatio = 2;
  for (const s of stats.values()) {
    if (s.ratio > maxRatio) maxRatio = s.ratio;
    if (s.ratio < minRatio) minRatio = s.ratio;
  }
  const spread = maxRatio - minRatio;

  /** @type {Set<number>} */
  let accepted = new Set();

  // 1) Primary: keep pages close to the best sheet’s anchor ratio. When the best sheet is
  // already very strong, use a gentler relative bar so zoom/detail pages (~30–50% anchored)
  // are not cut off while a 0% decorative page still fails vs a 100% overview.
  if (maxRatio >= 0.012) {
    const rel =
      maxRatio >= 0.85 ? 0.24 : maxRatio >= 0.58 ? 0.32 : ANCHOR_PAGE_REL_TO_BEST;
    const cutoff = Math.max(ANCHOR_PAGE_RATIO_FLOOR, maxRatio * rel);
    for (const [pageNum, s] of stats) {
      if (s.ratio >= cutoff) accepted.add(pageNum);
    }
  }

  // 2) If everyone tied **low**, use spread to tighten — do NOT run when the best sheet is
  // already strong (e.g. 100% vs 90% detail pages), or we would drop legitimate zoom sheets.
  if (
    accepted.size === stats.size &&
    spread >= ANCHOR_PAGE_SPREAD_TRIGGER &&
    maxRatio < 0.42
  ) {
    accepted = new Set();
    const tight = Math.max(ANCHOR_PAGE_RATIO_FLOOR * 1.15, maxRatio * ANCHOR_PAGE_REL_STRICT);
    for (const [pageNum, s] of stats) {
      if (s.ratio >= tight) accepted.add(pageNum);
    }
  }

  // 3) If still everyone or empty, drop obvious outliers (many circles + weak anchors vs best).
  if (accepted.size === 0 || accepted.size === stats.size) {
    const outlier = new Set();
    for (const [pageNum, s] of stats) {
      const heavyWeak =
        s.circles >= ANCHOR_OUTLIER_HEAVY_CIRCLES && s.ratio < maxRatio * ANCHOR_OUTLIER_REL_MAX;
      const gapWeak =
        maxRatio - s.ratio >= ANCHOR_OUTLIER_GAP && maxRatio >= 0.03 && s.ratio < 0.22;
      if (heavyWeak || gapWeak) outlier.add(pageNum);
    }
    if (outlier.size > 0 && outlier.size < stats.size) {
      accepted = new Set();
      for (const [pageNum] of stats) {
        if (!outlier.has(pageNum)) accepted.add(pageNum);
      }
    }
  }

  if (accepted.size === 0) {
    return { circles: null, maxRatio, minRatio };
  }

  const filtered = validCircles.filter(c => accepted.has(c.pageNum ?? 1));

  // 4) If every page still passes but the worst sheet is far below the best and circle-heavy, drop worst.
  if (filtered.length === validCircles.length && stats.size >= 2) {
    const sorted = [...stats.entries()].sort((a, b) => a[1].ratio - b[1].ratio);
    const [worstPage, worstS] = sorted[0];
    const bestS = sorted[sorted.length - 1][1];
    if (
      bestS.ratio - worstS.ratio >= 0.065 &&
      worstS.circles >= ANCHOR_OUTLIER_HEAVY_CIRCLES &&
      worstS.ratio < bestS.ratio * 0.68
    ) {
      accepted.delete(worstPage);
    }
  }

  const filtered2 = validCircles.filter(c => accepted.has(c.pageNum ?? 1));
  if (filtered2.length < validCircles.length) {
    warnings.push(
      `Dropped circle marker(s) on weaker sheet(s) by digit↔circle anchor score ` +
        `(best page ${(maxRatio * 100).toFixed(0)}% anchored, weakest ${(minRatio * 100).toFixed(0)}%). ` +
        `Kept ${filtered2.length} of ${validCircles.length} circles.`
    );
  }
  return { circles: filtered2, maxRatio, minRatio };
}

/**
 * Choose the circle set used for post assembly / masked digit search: route sheets
 * whose circles align with nearby digit labels (OCG layer when possible, else
 * getTextContent anchor-density vs the busiest sheet — no fixed post count cap).
 *
 * @returns {Promise<{ circles: typeof validCircles, mode: 'layer_anchor' | 'anchor_density' | 'all' }>}
 */
async function selectPostAssemblyCircles(validCircles, textoItems, pageCache, warnings) {
  const layerAnchored = circlesNearLayerSequentialDigits(
    validCircles,
    textoItems,
    LAYER_ANCHOR_TO_CIRCLE_MAX_PT
  );
  if (layerAnchored.length >= MIN_LAYER_ANCHORED_CIRCLES) {
    if (layerAnchored.length < validCircles.length) {
      warnings.push(
        `Restricted Numero_Poste circles to ${layerAnchored.length} marker(s) near route digits (TEXTO or Numero_Poste OCG) ` +
          `(${validCircles.length} raw circles before filter).`
      );
    }
    return { circles: layerAnchored, mode: 'layer_anchor' };
  }

  const stats = await computePageCircleAnchorStats(
    pageCache,
    validCircles,
    GETTEXT_STRICT_ANCHOR_PT,
    GETTEXT_MASKED_ANCHOR_PT
  );
  const { circles: densityCircles, maxRatio, minRatio } = circlesFromAnchorDensityPages(validCircles, stats, warnings);
  if (densityCircles != null && densityCircles.length > 0) {
    if (densityCircles.length < validCircles.length) {
      return { circles: densityCircles, mode: 'anchor_density' };
    }
    if (maxRatio >= 0.095 || (maxRatio - minRatio >= 0.045 && maxRatio >= 0.045)) {
      return { circles: densityCircles, mode: 'anchor_density' };
    }
  }

  if (validCircles.length > 0) {
    warnings.push(
      'Could not separate route sheets from decorative circles (layer digits + anchor-density signals weak). ' +
        'Using all circle geometry — expect possible false post candidates on non-route pages.'
    );
  }
  return { circles: validCircles, mode: 'all' };
}

function looksLikeDistanceLabel(s) {
  const t = s.trim().replace(/\s+/g, '');
  return /^\d{1,3},\d+$/.test(t) || /^\d{1,3}\.\d+$/.test(t);
}

/**
 * Skip getTextContent runs that are clearly engineering annotations (tension "daN",
 * degree-bearing formulas) so masked digit extraction does not steal post numbers.
 *
 * @param {string} s
 */
function looksLikeEngineeringAnnotation(s) {
  const t = String(s);
  if (/daN\b/i.test(t) || /dan\b/i.test(t)) return true;
  if (/°/.test(t) && /[=,]/.test(t)) return true;
  if (/\d\s*,\s*\d+/.test(t) && /[=]/.test(t)) return true;
  return false;
}

/** Poste-layer engineering label under the red circle, e.g. "10-300 (U)" / "10-150 (U)". */
const POST_TYPE_LABEL_RE = /\b\d{1,3}\s*-\s*\d{1,4}\b(?:\s*\([^)]{0,24}\))?/;

/**
 * @param {string} s
 * @returns {string|null}
 */
function extractPostTypeLabel(s) {
  const m = String(s).match(POST_TYPE_LABEL_RE);
  return m ? m[0].replace(/\s+/g, ' ').trim() : null;
}

/**
 * Attach `postType` from the Poste OCG layer (dd-ddd pattern) to each assembled post.
 *
 * @param {Array<{ number: number, x: number, y: number, pageNum?: number, postType?: string }>} posts
 * @param {Array<{ str: string, x: number, y: number, pageNum?: number, layerName?: string, width?: number }>} textoItems
 * @param {string[]} warnings
 */
function attachPostTypeLabels(posts, textoItems, warnings) {
  const posteNorm = normalizeName('Poste');
  const BELOW_MIN = 1;
  const BELOW_MAX = 150;
  const H_MAX = 130;
  let missing = 0;

  for (const p of posts) {
    const page = p.pageNum ?? 1;
    let bestLabel = null;
    let bestD = Infinity;
    for (const it of textoItems) {
      if ((it.pageNum ?? 1) !== page) continue;
      if (it.layerName == null || normalizeName(it.layerName) !== posteNorm) continue;
      const label = extractPostTypeLabel(it.str || '');
      if (!label) continue;
      const w = typeof it.width === 'number' && it.width > 0 ? it.width : 0;
      const ax = w > 0 ? it.x + w * 0.5 : it.x;
      const dy = it.y - p.y;
      if (dy < BELOW_MIN || dy > BELOW_MAX) continue;
      if (Math.abs(ax - p.x) > H_MAX) continue;
      const d = Math.hypot(ax - p.x, it.y - p.y);
      if (d < bestD) {
        bestD = d;
        bestLabel = label;
      }
    }
    if (bestLabel) p.postType = bestLabel;
    else missing++;
  }

  if (missing > 0) {
    warnings.push(
      `${missing} post(s) had no nearby Poste-layer type label (pattern dd-ddd like 10-300 (U)).`
    );
  }
}

/**
 * Whole-item `getTextContent` strings that are exactly 1–3 digits; position uses
 * horizontal advance midpoint when `width` is present (closer to visual center).
 *
 * @param {Array<{ page: import('pdfjs-dist').PDFPageProxy, pageHeight: number, pageNum: number }>} pageCache
 * @param {Array<{ x: number, y: number, pageNum?: number }>} circles
 * @param {number} maxDist
 */
async function strictDigitsNearCircleCentroids(pageCache, circles, maxDist) {
  const out = [];
  for (const { page, pageHeight, pageNum } of pageCache) {
    const pageCircles = circles.filter(c => (c.pageNum ?? 1) === pageNum);
    if (!pageCircles.length) continue;
    const textContent = await page.getTextContent();
    for (const item of textContent.items) {
      if (item.str == null) continue;
      const str = item.str.trim();
      if (!/^\d{1,3}$/.test(str)) continue;
      if (parseInt(str, 10) < 1) continue;
      const tx = item.transform[4];
      const w = typeof item.width === 'number' && item.width > 0 ? item.width : 0;
      const xPos = w > 0 ? tx + w * 0.5 : tx;
      const yFlipped = pageHeight - item.transform[5];
      for (const c of pageCircles) {
        if (Math.hypot(xPos - c.x, yFlipped - c.y) <= maxDist) {
          out.push({ str, x: xPos, y: yFlipped, pageNum });
          break;
        }
      }
    }
  }
  return dedupePostIntCandidates(out);
}

/**
 * First isolated 1–3 digit run per text item after cable masking, if the item is
 * not a comma/decimal distance label and its midpoint lies near a circle centroid.
 *
 * @param {Array<{ page: import('pdfjs-dist').PDFPageProxy, pageHeight: number, pageNum: number }>} pageCache
 * @param {Array<{ x: number, y: number, pageNum?: number }>} circles
 * @param {number} maxDist
 */
async function maskedDigitsNearCentroids(pageCache, circles, maxDist) {
  const out = [];
  const re = /(?<!\d)(\d{1,3})(?!\d)/;
  for (const { page, pageHeight, pageNum } of pageCache) {
    const pageCircles = circles.filter(c => (c.pageNum ?? 1) === pageNum);
    if (!pageCircles.length) continue;
    const textContent = await page.getTextContent();
    for (const item of textContent.items) {
      if (item.str == null) continue;
      const strTrim = String(item.str).trim();
      if (!strTrim || looksLikeDistanceLabel(strTrim)) continue;
      if (looksLikeEngineeringAnnotation(strTrim)) continue;
      const masked = maskConductorLikeSpecs(strTrim);
      const m = re.exec(masked);
      if (!m) continue;
      const postNum = parseInt(m[1], 10);
      if (postNum < 1) continue;
      const tx = item.transform[4];
      const w = typeof item.width === 'number' && item.width > 0 ? item.width : 0;
      const xPos = w > 0 ? tx + w * 0.5 : tx;
      const yFlipped = pageHeight - item.transform[5];
      let minD = Infinity;
      for (const c of pageCircles) {
        const d = Math.hypot(xPos - c.x, yFlipped - c.y);
        if (d < minD) minD = d;
      }
      if (minD <= maxDist) {
        out.push({ str: m[1], x: xPos, y: yFlipped, pageNum });
      }
    }
  }
  return dedupePostIntCandidates(out);
}

/** Max distance from circle centre to route digit (layer OCG or whole-item gettext) = “inside”. */
const SEQUENTIAL_TEXT_INSIDE_CIRCLE_PT = 72;
/** Circle centre must be within this distance of Cabo geometry (when that page has cable paths). */
const POST_MARKER_TO_CABLE_MAX_PT = 158;
/** Merge Poste-layer subpath centroids (e.g. square + X) into one pole anchor. */
const POSTE_SYMBOL_CLUSTER_MERGE_PT = 88;
/** Snap assembled post to Poste symbol when this close (same page). */
const SNAP_POST_TO_POSTE_SYMBOL_MAX_PT = 138;

/**
 * @param {{ x: number, y: number, pageNum?: number }} c
 */
function circleLocKey(c) {
  return `${c.pageNum ?? 1}|${Math.round(c.x * 4)}|${Math.round(c.y * 4)}`;
}

/**
 * @param {Array<{ pageNum?: number, ops: Array<import('./construct-path-parser.js').PathOp> }>} allCableRows
 * @returns {Map<number, Array<Array<import('./construct-path-parser.js').PathOp>>>}
 */
function buildCablesByPage(allCableRows) {
  const m = new Map();
  for (const row of allCableRows) {
    const pg = row.pageNum ?? 1;
    if (!m.has(pg)) m.set(pg, []);
    m.get(pg).push(row.ops);
  }
  return m;
}

/**
 * @param {{ x: number, y: number, pageNum?: number }} c
 * @param {Map<number, Array<Array<import('./construct-path-parser.js').PathOp>>>} cablesByPage
 * @param {number} maxPt
 */
function circleSatisfiesCableProximity(c, cablesByPage, maxPt) {
  const pg = c.pageNum ?? 1;
  const paths = cablesByPage.get(pg) ?? [];
  if (paths.length === 0) return true;
  const d = minDistancePointToCablesOnPage(c.x, c.y, pg, cablesByPage);
  return d <= maxPt;
}

/**
 * @param {Array<{ x: number, y: number, pageNum?: number }>} circles
 * @param {Array<{ str: string, x: number, y: number, pageNum?: number, layerName?: string, width?: number }>} textoItems
 * @param {number} insidePt
 * @returns {Set<string>}
 */
function circlesWithSequentialTextInsideFromLayers(circles, textoItems, insidePt) {
  const keys = new Set();
  const seqItems = textoItems.filter(
    it =>
      it.layerName != null &&
      isRouteSequentialNumberLayerName(it.layerName) &&
      /^\d{1,3}$/.test(String(it.str).trim()) &&
      parseInt(String(it.str).trim(), 10) >= 1
  );
  for (const c of circles) {
    const p = c.pageNum ?? 1;
    for (const it of seqItems) {
      if ((it.pageNum ?? 1) !== p) continue;
      const w = typeof it.width === 'number' && it.width > 0 ? it.width : 0;
      const ax = w > 0 ? it.x + w * 0.5 : it.x;
      if (Math.hypot(ax - c.x, it.y - c.y) <= insidePt) {
        keys.add(circleLocKey(c));
        break;
      }
    }
  }
  return keys;
}

/**
 * Circle keys where a route-label OCG item’s **masked** first isolated 1–3 digit lies within
 * `insidePt` of the centroid. Uses only `textoItems` (CTM-correlated), not unscoped getTextContent.
 *
 * @param {Array<{ x: number, y: number, pageNum?: number }>} circles
 * @param {Array<{ str: string, x: number, y: number, pageNum?: number, layerName?: string, width?: number }>} textoItems
 * @param {number} insidePt
 * @returns {Set<string>}
 */
function circlesWithMaskedRouteTextInsideFromLayers(circles, textoItems, insidePt) {
  const keys = new Set();
  const re = /(?<!\d)(\d{1,3})(?!\d)/;
  const routeItems = textoItems.filter(
    it => it.layerName != null && isRouteSequentialNumberLayerName(it.layerName)
  );
  for (const c of circles) {
    const p = c.pageNum ?? 1;
    for (const it of routeItems) {
      if ((it.pageNum ?? 1) !== p) continue;
      const s = String(it.str ?? '').trim();
      if (!s || looksLikeDistanceLabel(s)) continue;
      if (looksLikeEngineeringAnnotation(s)) continue;
      const masked = maskConductorLikeSpecs(s);
      const m = re.exec(masked);
      if (!m) continue;
      if (parseInt(m[1], 10) < 1) continue;
      const w = typeof it.width === 'number' && it.width > 0 ? it.width : 0;
      const ax = w > 0 ? it.x + w * 0.5 : it.x;
      if (Math.hypot(ax - c.x, it.y - c.y) <= insidePt) {
        keys.add(circleLocKey(c));
        break;
      }
    }
  }
  return keys;
}

/**
 * @param {Array<{ page: import('pdfjs-dist').PDFPageProxy, pageHeight: number, pageNum: number }>} pageCache
 * @param {Array<{ x: number, y: number, pageNum?: number }>} circles
 * @param {number} insidePt
 * @returns {Promise<Set<string>>}
 */
async function circlesWithStrictWholeDigitInsideFromGettext(pageCache, circles, insidePt) {
  const keys = new Set();
  for (const { page, pageHeight, pageNum } of pageCache) {
    const pageCircles = circles.filter(c => (c.pageNum ?? 1) === pageNum);
    if (!pageCircles.length) continue;
    const textContent = await page.getTextContent();
    for (const item of textContent.items) {
      if (item.str == null) continue;
      const str = String(item.str).trim();
      if (!/^\d{1,3}$/.test(str) || parseInt(str, 10) < 1) continue;
      const tx = item.transform[4];
      const w = typeof item.width === 'number' && item.width > 0 ? item.width : 0;
      const xPos = w > 0 ? tx + w * 0.5 : tx;
      const yFlipped = pageHeight - item.transform[5];
      for (const c of pageCircles) {
        if (Math.hypot(xPos - c.x, yFlipped - c.y) <= insidePt) {
          keys.add(circleLocKey(c));
        }
      }
    }
  }
  return keys;
}

/**
 * Restrict Numero_Poste circles to route posts: sequential digits inside marker + near cable.
 *
 * @param {Array<{ x: number, y: number, pageNum?: number }>} circles
 * @param {Map<number, Array<Array<import('./construct-path-parser.js').PathOp>>>} cablesByPage
 */
async function refinePostMarkersByInsideDigitsAndCable(
  circles,
  textoItems,
  pageCache,
  cablesByPage,
  warnings
) {
  if (circles.length === 0) return circles;

  const insidePt = SEQUENTIAL_TEXT_INSIDE_CIRCLE_PT;
  const cableMax = POST_MARKER_TO_CABLE_MAX_PT;

  const layerKeys = circlesWithSequentialTextInsideFromLayers(circles, textoItems, insidePt);
  const gettextKeys = await circlesWithStrictWholeDigitInsideFromGettext(pageCache, circles, insidePt);
  const maskedLayerKeys = circlesWithMaskedRouteTextInsideFromLayers(circles, textoItems, insidePt);
  const insideKeys = new Set([...layerKeys, ...gettextKeys, ...maskedLayerKeys]);

  if (insideKeys.size === 0) {
    warnings.push(
      'No Numero_Poste circles matched route digits inside (OCG post-label layers: whole or masked, ' +
        'or whole-item getTextContent, ≤' +
        SEQUENTIAL_TEXT_INSIDE_CIRCLE_PT +
        ' pt). Keeping pre-filter circle set — check text↔circle alignment or loosen SEQUENTIAL_TEXT_INSIDE_CIRCLE_PT.'
    );
    return circles;
  }

  const withInside = circles.filter(c => insideKeys.has(circleLocKey(c)));
  const withCableAndInside = withInside.filter(c =>
    circleSatisfiesCableProximity(c, cablesByPage, cableMax)
  );

  const minKeep = Math.max(3, Math.floor(0.28 * circles.length));

  if (withCableAndInside.length >= minKeep) {
    if (withCableAndInside.length < circles.length) {
      warnings.push(
        `Post markers: ${withCableAndInside.length} circle(s) with digits inside (≤${insidePt} pt) ` +
          `and near Cabo (≤${cableMax} pt where cable exists).`
      );
    }
    return withCableAndInside;
  }

  if (withInside.length >= minKeep) {
    warnings.push(
      `Cable proximity relaxed: using ${withInside.length} circle(s) with inside sequential digits only.`
    );
    return withInside;
  }

  if (withInside.length > 0) {
    warnings.push(
      `Inside-digit matches (${withInside.length}) below stability threshold (${minKeep}); ` +
        `keeping all ${circles.length} pre-filter circles.`
    );
  }
  return circles;
}

/**
 * @param {Array<{ x: number, y: number, pageNum?: number }>} allRaw
 * @param {number} mergeRadius
 */
function clusterPosteSymbolHints(allRaw, mergeRadius) {
  const byPage = new Map();
  for (const p of allRaw) {
    const pg = p.pageNum ?? 1;
    if (!byPage.has(pg)) byPage.set(pg, []);
    byPage.get(pg).push(p);
  }
  const hints = [];
  for (const pts of byPage.values()) {
    const n = pts.length;
    if (n === 0) continue;
    const parent = [...Array(n).keys()];
    const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const union = (a, b) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) <= mergeRadius) {
          union(i, j);
        }
      }
    }
    const groups = new Map();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(pts[i]);
    }
    for (const memb of groups.values()) {
      const sx = memb.reduce((s, q) => s + q.x, 0) / memb.length;
      const sy = memb.reduce((s, q) => s + q.y, 0) / memb.length;
      hints.push({ x: sx, y: sy, pageNum: memb[0].pageNum ?? 1 });
    }
  }
  return hints;
}

/**
 * @param {Array<{ number: number, x: number, y: number, pageNum?: number, postType?: string }>} posts
 * @param {Array<{ x: number, y: number, pageNum?: number }>} hints
 * @param {number} maxSnapPt
 */
function snapPostsToPosteLayerSymbols(posts, hints, maxSnapPt) {
  if (!posts.length || !hints.length) return;
  for (const p of posts) {
    const pg = p.pageNum ?? 1;
    let best = null;
    let bestD = maxSnapPt;
    for (const h of hints) {
      if ((h.pageNum ?? 1) !== pg) continue;
      const d = Math.hypot(h.x - p.x, h.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    if (best) {
      p.x = best.x;
      p.y = best.y;
    }
  }
}

/**
 * Apply Y-axis inversion to all y-coordinate fields in a PathOp.
 * PDF origin is bottom-left; screen/output origin is top-left.
 *
 * @param {import('./construct-path-parser.js').PathOp} op
 * @param {number} pageHeight  Page height in PDF points (page.view[3]).
 * @returns {import('./construct-path-parser.js').PathOp}
 */
function flipYInOp(op, pageHeight) {
  const f = { ...op };
  if (f.y  !== undefined) f.y  = pageHeight - f.y;
  if (f.y1 !== undefined) f.y1 = pageHeight - f.y1;
  if (f.y2 !== undefined) f.y2 = pageHeight - f.y2;
  if (f.y3 !== undefined) f.y3 = pageHeight - f.y3;
  return f;
}

/**
 * Parse an INFOVIAS PDF and return structured post, distance, and cable data.
 *
 * @param {ArrayBuffer} arrayBuffer  PDF file contents from FileReader.arrayBuffer().
 * @returns {Promise<
 *   | { posts: Array, distances: Array, cableSegments: Array, warnings: string[], layerMap: { allNames: string[] } }
 *   | { error: 'missing_layers', missing: string[], allNames: string[] }
 *   | { error: 'parse_failed', message: string, warnings: string[] }
 * >}
 */
export async function parsePdf(arrayBuffer) {
  const warnings = [];

  try {
    // ── Load PDF ────────────────────────────────────────────────────────────
    const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    // ── Build OCG layer map ──────────────────────────────────────────────────
    const { idToName, allNames } = await buildOcgMap(pdfDoc);

    // ── Validate required layers (D-08) ──────────────────────────────────────
    const { valid, missing } = validateLayers(allNames);
    if (!valid) {
      return { error: 'missing_layers', missing, allNames };
    }

    // ── Cross-page collectors ────────────────────────────────────────────────
    const allTextoItems = [];
    const allDistItems = [];
    const allCircles = [];
    const allCablePaths = [];
    const allPosteRaw = [];

    // ── Page cache: avoid calling getPage() twice for the fallback path ────────
    const pageCache = [];

    // ── Process all pages (D-09): each page is independent user space; results merged below ─
    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const pageHeight = page.view[3]; // PDF points
      if (pageNum === 1) console.info('[pdf-to-kmz] parse: page 1 view', page.view);
      pageCache.push({ page, pageHeight, pageNum });

      const textByLayer = await extractLayerText(page, idToName);
      // gfxResult: { circles: [{x,y}], cablePaths: [PathOp[]], byLayer: {} }
      // NOTE: NOT a flat byLayer dict — use gfxResult.circles and gfxResult.cablePaths.
      const gfxResult = await extractLayerGraphics(page, idToName);
      console.info(
        `[pdf-to-kmz] parse: page ${pageNum}/${pdfDoc.numPages} circles=${gfxResult.circles.length} ` +
          `posteGfx=${(gfxResult.posteSymbols ?? []).length} cablePaths=${gfxResult.cablePaths.length}`
      );

      // ── Collect post-label text (canonical TEXTO / Numero_Poste + vendor OCG aliases) ─
      for (const [layerName, items] of Object.entries(textByLayer)) {
        if (isPostLabelSourceLayerName(layerName)) {
          for (const item of items) {
            // flipY: PDF origin = bottom-left; output origin = top-left.
            // pageNum attached for cross-page coordinate disambiguation (CR-03).
            allTextoItems.push({
              ...item,
              y: pageHeight - item.y,
              pageNum,
              layerName,
            });
          }
        }
      }

      // ── Collect distance-label text (canonical + aliases in layer-sources.js) ─
      for (const [layerName, items] of Object.entries(textByLayer)) {
        if (isDistanceSourceLayerName(layerName)) {
          for (const item of items) {
            allDistItems.push({ ...item, y: pageHeight - item.y, pageNum });
          }
        }
      }

      // ── Collect circle positions (apply flipY) ───────────────────────────
      for (const circle of gfxResult.circles) {
        // pageNum attached for cross-page coordinate disambiguation (CR-03).
        allCircles.push({ x: circle.x, y: pageHeight - circle.y, pageNum });
      }

      for (const sym of gfxResult.posteSymbols ?? []) {
        allPosteRaw.push({ x: sym.x, y: pageHeight - sym.y, pageNum });
      }

      // ── Collect cable paths (apply flipY to all ops) + page index for proximity checks ─
      for (const pathOps of gfxResult.cablePaths) {
        allCablePaths.push({
          pageNum,
          ops: pathOps.map(op => flipYInOp(op, pageHeight)),
        });
      }
    }

    // ── All-page text scan ───────────────────────────────────────────────────
    // Collect allIntItems (post number candidates) and allDistItemsFallback
    // (distance candidates) from raw getTextContent — no CTM correlation needed.
    // allIntItems is always populated regardless of allTextoItems (CR-04).
    //
    // allDistItemsFallback is only merged into allDistItems if the layer-filtered
    // extraction yielded nothing, to avoid doubling distance entries (CR-02).
    const allIntItems = [];
    const allDistItemsFallback = [];
    for (const { page, pageHeight, pageNum } of pageCache) {
      const textContent = await page.getTextContent();
      for (const item of textContent.items) {
        if (item.str == null) continue;
        const str = item.str.trim();
        if (!str) continue;
        const tx = item.transform[4];
        const ty = item.transform[5];
        const yFlipped = pageHeight - ty;
        if (/^\d{1,3}$/.test(str)) {
          const n = parseInt(str, 10);
          if (n < 1) continue;
          const w = typeof item.width === 'number' && item.width > 0 ? item.width : 0;
          const xPos = w > 0 ? tx + w * 0.5 : tx;
          // pageNum attached for cross-page coordinate disambiguation (CR-03).
          allIntItems.push({ str, x: xPos, y: yFlipped, pageNum, width: w || undefined });
        }
        const norm = str.replace(',', '.');
        if (/^\d+(\.\d+)?$/.test(norm)) {
          const w = typeof item.width === 'number' && item.width > 0 ? item.width : 0;
          const xPos = w > 0 ? tx + w * 0.5 : tx;
          allDistItemsFallback.push({ str, x: xPos, y: yFlipped, pageNum, width: w || undefined });
        }
      }
    }

    // Merge distance fallback only when layer-filtered result is empty (CR-02).
    if (allDistItems.length === 0) {
      warnings.push(
        'Layer-specific distance extraction yielded no results; using all-page text fallback for distances.'
      );
      allDistItems.push(...allDistItemsFallback);
    }

    // ── Assemble posts from circle centroids + filtered integer labels ───────
    // Build candidates from: full-page ints near circles, pure-digit layer text,
    // and Poste anchors within PROXIMITY_THRESHOLD of any same-page circle.
    const validCircles = allCircles.filter(c => isFinite(c.x) && isFinite(c.y));
    const cablesByPage = buildCablesByPage(allCablePaths);
    let { circles: postAssemblyCircles, mode: postCircleMode } = await selectPostAssemblyCircles(
      validCircles,
      allTextoItems,
      pageCache,
      warnings
    );
    postAssemblyCircles = await refinePostMarkersByInsideDigitsAndCable(
      postAssemblyCircles,
      allTextoItems,
      pageCache,
      cablesByPage,
      warnings
    );
    const maskedMaxPt =
      postAssemblyCircles.length < validCircles.length
        ? INSIDE_POST_MASKED_TIGHT_PT
        : INSIDE_POST_MASKED_MAX_PT;

    const intCandidatePool = dedupePostIntCandidates([...allIntItems]);

    const textoNumeric = allTextoItems.filter(it => {
      if (it.layerName == null || !isRouteSequentialNumberLayerName(it.layerName)) return false;
      const s = it.str.trim();
      return /^\d{1,3}$/.test(s) && parseInt(s, 10) >= 1;
    });
    const intNearCircles =
      postAssemblyCircles.length > 0
        ? integerTextsNearCircles(intCandidatePool, postAssemblyCircles, PROXIMITY_THRESHOLD)
        : [];
    const textoNearCircles =
      postAssemblyCircles.length > 0
        ? integerTextsNearCircles(textoNumeric, postAssemblyCircles, PROXIMITY_THRESHOLD)
        : [];

    const insideStrict = await strictDigitsNearCircleCentroids(
      pageCache,
      postAssemblyCircles,
      INSIDE_POST_STRICT_MAX_PT
    );
    const insideMasked = await maskedDigitsNearCentroids(
      pageCache,
      postAssemblyCircles,
      maskedMaxPt
    );

    let postCandidates;
    const mergedNear = dedupePostIntCandidates([
      ...intNearCircles,
      ...textoNearCircles,
      ...insideStrict,
      ...insideMasked,
    ]);

    if (mergedNear.length > 0) {
      postCandidates =
        postAssemblyCircles.length > 0
          ? dedupePostIntCandidates(
              dedupePostDigitCandidatesNearestCircle(mergedNear, postAssemblyCircles)
            )
          : mergedNear;
      if (
        intNearCircles.length > textoNearCircles.length &&
        intNearCircles.length > 0
      ) {
        warnings.push(
          'Post labels: merged full-page integers near circles with layer text; ' +
            `full-scan had more proximity hits (≤${PROXIMITY_THRESHOLD} pt) than layer-only.`
        );
      }
    } else if (postAssemblyCircles.length > 0) {
      postCandidates = [];
      warnings.push(
        'No post labels within range of circle geometry (getTextContent + TEXTO near-circle). ' +
          'Skipped legend/table integer fallback to avoid wrong coordinates.'
      );
    } else {
      postCandidates = allIntItems.length > 0 ? allIntItems : allTextoItems;
      if (postCandidates.length > 0) {
        warnings.push(
          'No circles on any page; using full-page integer text for posts (degraded mode).'
        );
      }
    }

    // CR-04: explicit diagnostic when both candidate sources are empty.
    if (allIntItems.length === 0 && allTextoItems.length === 0) {
      warnings.push(
        'CRITICAL: No post number candidates found from any source. ' +
        'Check that the TEXTO and Numero_Poste layers exist and contain readable text.'
      );
    }
    console.info(
      '[pdf-to-kmz] parse: totals circlesRaw=', validCircles.length,
      'circlesPost=', postAssemblyCircles.length, 'postCircleMode=', postCircleMode,
      'intItems=', allIntItems.length, 'distLayerItems=', allDistItems.length,
      'textoItems=', allTextoItems.length,
      'insideStrict=', insideStrict.length, 'insideMasked=', insideMasked.length, 'textoNear=', textoNearCircles.length,
      'intNear=', intNearCircles.length, 'postCandidates=', postCandidates.length,
      'maskedMaxPt=', maskedMaxPt
    );
    if (validCircles.length > 0)
      console.info('[pdf-to-kmz] parse: sample circles', JSON.stringify(validCircles.slice(0, 3)));
    if (postCandidates.length > 0)
      console.info('[pdf-to-kmz] parse: sample postCandidates', JSON.stringify(postCandidates.slice(0, 5)));
    const { posts: rawPosts, warnings: aw } =
      assemblePostData(postCandidates, postAssemblyCircles, []);
    warnings.push(...aw);

    // ── Post fallback: use text label positions when no circle matches found ──
    let posts;
    if (rawPosts.length === 0 && postCandidates.length > 0) {
      warnings.push('Post-circle matching yielded no results; using text label positions as post locations.');
      const textPosts = postCandidates.map(item => ({
        number: parseInt(item.str.trim(), 10),
        x: item.x,
        y: item.y,
        pageNum: item.pageNum,
      }));
      posts = deduplicatePostsPreferLowerPage(textPosts);
    } else {
      posts = deduplicatePostsPreferLowerPage(rawPosts);
    }
    console.info('[pdf-to-kmz] parse: rawPosts=', rawPosts.length, 'final posts=', posts.length, posts.map(p => p.number).join(','));

    const posteHints = clusterPosteSymbolHints(allPosteRaw, POSTE_SYMBOL_CLUSTER_MERGE_PT);
    snapPostsToPosteLayerSymbols(posts, posteHints, SNAP_POST_TO_POSTE_SYMBOL_MAX_PT);

    // ── Deduplicate posts across pages (D-13) already done in both branches ──

    attachPostTypeLabels(posts, allTextoItems, warnings);

    if (rawPosts.length > posts.length) {
      warnings.push(
        `Merged ${rawPosts.length - posts.length} duplicate post marker(s) across overview/detail pages (kept lowest page number per post).`
      );
    }

    // ── Associate inter-post distances (D-10) ────────────────────────────────
    const { distances, warnings: dw } =
      associateDistances(posts, allDistItems, []);
    warnings.push(...dw);

    // ── Build cable segments (D-04, D-12, D-16) ──────────────────────────────
    const { cableSegments, warnings: cw } =
      buildCableSegments(allCablePaths.map(r => r.ops), []);
    warnings.push(...cw);

    // ── Return success contract (D-16) ───────────────────────────────────────
    return {
      posts,
      distances,
      cableSegments,
      warnings,
      layerMap: { allNames },
    };

  } catch (err) {
    // T-02-01 / Security V5: any thrown error returns structured error, not crash.
    return { error: 'parse_failed', message: err.message, warnings };
  }
}
