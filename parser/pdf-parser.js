// parser/pdf-parser.js
// Top-level orchestrator. The only module with a pdf.js CDN import.
// Exports parsePdf(arrayBuffer) — the Phase 1 output contract consumed by Phase 2.
//
// Output contract (success):
//   { posts, distances, cableSegments, warnings, layerMap: { allNames } }
//   posts[]: { number, x, y, pageNum?, postType? } — route numbers (01, 02…) extracted via
//     OCR (Tesseract.js) from rendered circle crops; x,y from circle centroids.
//     postType from Poste text (e.g. "10-300 (U)").
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
import { isPostLabelSourceLayerName, isDistanceSourceLayerName } from './layer-sources.js';
import { extractLayerText }                            from './text-extractor.js';
import { extractLayerGraphics }                        from './graphics-extractor.js';
import { deduplicatePostsPreferLowerPage } from './post-assembler.js';
import { ocrCircleNumbers }                            from './ocr-extractor.js';
import { assemblePostsFromOcr }                        from './post-assembler.js';
import { associateDistances }                          from './distance-associator.js';
import { buildCableSegments, minDistancePointToCablesOnPage } from './cable-builder.js';

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

/** Merge Poste-layer subpath centroids (e.g. square + X) into one pole anchor. */
const POSTE_SYMBOL_CLUSTER_MERGE_PT = 88;
/** Snap assembled post to Poste symbol when this close (same page). */
const SNAP_POST_TO_POSTE_SYMBOL_MAX_PT = 138;

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
    const allCablePaths = [];
    const allPosteRaw = [];

    // ── OCR collector (D-06) ─────────────────────────────────────────────────
    const allOcrResults = [];

    // Force all OCG layers visible for OCR rendering — post-number paths may be on a layer
    // that is off by default in the PDF's display state, causing blank crops.
    let ocrOcPromise = null;
    try {
      const ocConfig = await pdfDoc.getOptionalContentConfig();
      const flatOrder = arr => (arr ?? []).flatMap(item => Array.isArray(item) ? flatOrder(item) : [item]);
      for (const id of flatOrder(ocConfig.getOrder?.() ?? [])) {
        try { ocConfig.setVisibility(id, true); } catch (_) {}
      }
      ocrOcPromise = Promise.resolve(ocConfig);
    } catch (_) {}

    // ── Distance fallback collector ──────────────────────────────────────────
    const allDistItemsFallback = [];

    // ── Process all pages (D-09): each page is independent user space; results merged below ─
    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const pageHeight = page.view[3]; // PDF points
      if (pageNum === 1) console.info('[pdf-to-kmz] parse: page 1 view', page.view);

      const textByLayer = await extractLayerText(page, idToName);
      // gfxResult: { circles (union), namedLayerCircles, layer0Circles, cablePaths, byLayer }
      // NOTE: pdf-parser.js uses namedLayerCircles/layer0Circles for WR-01/WR-03 split logic.
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


      // ── Apply flipY to circle positions — split named-layer vs layer-0 (WR-01, WR-03) ──
      // circle.x unchanged; circle.y = pageHeight - rawY (y increases downward from top)
      const namedFlipped = (gfxResult.namedLayerCircles ?? []).map(circle => ({
        x: circle.x,
        y: pageHeight - circle.y,
        pageNum,
      }));
      const layer0Flipped = (gfxResult.layer0Circles ?? []).map(circle => ({
        x: circle.x,
        y: pageHeight - circle.y,
        pageNum,
      }));
      // WR-01: layer '0' is a fallback — only use it when no named-layer circles were found.
      const flippedCircles = namedFlipped.length > 0 ? namedFlipped : layer0Flipped;

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

      // ── Distance fallback: collect from getTextContent ───────────────────────
      const textContent = await page.getTextContent();
      for (const item of textContent.items) {
        if (item.str == null) continue;
        const str = item.str.trim();
        if (!str) continue;
        const tx = item.transform[4];
        const ty = item.transform[5];
        const yFlipped = pageHeight - ty;
        const norm = str.replace(',', '.');
        if (/^\d+(\.\d+)?$/.test(norm)) {
          const w = typeof item.width === 'number' && item.width > 0 ? item.width : 0;
          const xPos = w > 0 ? tx + w * 0.5 : tx;
          allDistItemsFallback.push({ str, x: xPos, y: yFlipped, pageNum, width: w || undefined });
        }
      }

      // ── D-10 bad-page CTM filter: skip pages where ALL named-layer circles cluster near origin ──
      // Raw PDF: degenerate CTM pushes paths to (x≈2, rawY≈2). After flipY: x≈2, y≈pageHeight-2.
      // WR-03: evaluate only named-layer circles — layer-0 centroids are linework and not relevant.
      const isBadCtmPage = namedFlipped.length > 0 &&
        namedFlipped.every(c => c.x < 10 && c.y > pageHeight - 10);
      if (isBadCtmPage) {
        warnings.push(
          `Page ${pageNum}: skipped — degenerate CTM positions (all circles at page origin); likely AutoCAD export bug`
        );
        continue; // skip this page for post extraction (distances/cable already collected)
      }

      // ── OCR post numbers for this page (D-06, D-08) ──────────────────────────
      if (flippedCircles.length > 0) {
        const pageOcrResults = await ocrCircleNumbers(page, pageHeight, flippedCircles, ocrOcPromise);
        allOcrResults.push(...pageOcrResults);
      }
    }

    // ── Merge distance fallback only when layer-filtered result is empty (CR-02) ─
    if (allDistItems.length === 0) {
      warnings.push(
        'Layer-specific distance extraction yielded no results; using all-page text fallback for distances.'
      );
      allDistItems.push(...allDistItemsFallback);
    }

    // ── Assemble posts from OCR results (D-06, D-07) ────────────────────────
    const { posts: rawPosts, warnings: postWarnings } = assemblePostsFromOcr(allOcrResults);
    warnings.push(...postWarnings);
    const posts = deduplicatePostsPreferLowerPage(rawPosts);

    console.info(
      '[pdf-to-kmz] parse: ocrResults=', allOcrResults.length,
      'rawPosts=', rawPosts.length, 'final posts=', posts.length,
      posts.map(p => p.number).join(',')
    );

    // ── Snap posts to Poste layer symbols ────────────────────────────────────
    const posteHints = clusterPosteSymbolHints(allPosteRaw, POSTE_SYMBOL_CLUSTER_MERGE_PT);
    snapPostsToPosteLayerSymbols(posts, posteHints, SNAP_POST_TO_POSTE_SYMBOL_MAX_PT);

    // ── Attach post type labels from Poste OCG layer ─────────────────────────
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
