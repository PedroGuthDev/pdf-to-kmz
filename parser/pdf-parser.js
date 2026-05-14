// parser/pdf-parser.js
// Top-level orchestrator. The only module with a pdf.js CDN import.
// Exports parsePdf(arrayBuffer) — the Phase 1 output contract consumed by Phase 2.
//
// Output contract (success):
//   { posts, distances, cableSegments, warnings, layerMap: { allNames } }
//
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
import { extractLayerText }                            from './text-extractor.js';
import { extractLayerGraphics }                        from './graphics-extractor.js';
import { assemblePostData, deduplicatePosts }          from './post-assembler.js';
import { associateDistances }                          from './distance-associator.js';
import { buildCableSegments }                          from './cable-builder.js';

// Normalized target layer names for textByLayer key lookup.
// We normalize because textByLayer keys are raw OCG names (e.g., 'Distância_Poste').
const NORM_TEXTO = normalizeName('TEXTO');
const NORM_DIST = normalizeName('Distância_Poste');

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

    // ── Page cache: avoid calling getPage() twice for the fallback path ────────
    const pageCache = [];

    // ── Process all pages (D-09) ─────────────────────────────────────────────
    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const pageHeight = page.view[3]; // PDF points
      if (pageNum === 1) console.debug('[parsePdf] page 1 view:', page.view);
      pageCache.push({ page, pageHeight });

      const textByLayer = await extractLayerText(page, idToName);
      // gfxResult: { circles: [{x,y}], cablePaths: [PathOp[]], byLayer: {} }
      // NOTE: NOT a flat byLayer dict — use gfxResult.circles and gfxResult.cablePaths.
      const gfxResult = await extractLayerGraphics(page, idToName);

      // ── Collect TEXTO items (normalize key lookup for accented names) ──────
      for (const [layerName, items] of Object.entries(textByLayer)) {
        if (normalizeName(layerName) === NORM_TEXTO) {
          for (const item of items) {
            // flipY: PDF origin = bottom-left; output origin = top-left.
            allTextoItems.push({ ...item, y: pageHeight - item.y });
          }
        }
      }

      // ── Collect Distância_Poste items ────────────────────────────────────
      for (const [layerName, items] of Object.entries(textByLayer)) {
        if (normalizeName(layerName) === NORM_DIST) {
          for (const item of items) {
            allDistItems.push({ ...item, y: pageHeight - item.y });
          }
        }
      }

      // ── Collect circle positions (apply flipY) ───────────────────────────
      for (const circle of gfxResult.circles) {
        allCircles.push({ x: circle.x, y: pageHeight - circle.y });
      }

      // ── Collect cable paths (apply flipY to all ops) ─────────────────────
      for (const pathOps of gfxResult.cablePaths) {
        allCablePaths.push(pathOps.map(op => flipYInOp(op, pageHeight)));
      }
    }

    // ── All-page text fallback ───────────────────────────────────────────────
    // CTM tracking fails for some pages (engineering coordinate transforms),
    // so we always scan all pages for distance labels to ensure full coverage.
    // TEXTO fallback only triggers when layer extraction found nothing.
    const needTextoFallback = allTextoItems.length === 0;
    if (needTextoFallback) {
      warnings.push(
        'Layer-specific text extraction yielded no results; using all-page text fallback.'
      );
    }
    for (const { page, pageHeight } of pageCache) {
      const textContent = await page.getTextContent();
      for (const item of textContent.items) {
        if (item.str == null) continue;
        const str = item.str.trim();
        if (!str) continue;
        const tx = item.transform[4];
        const ty = item.transform[5];
        const yFlipped = pageHeight - ty;
        if (needTextoFallback && /^\d{1,3}$/.test(str)) {
          allTextoItems.push({ str, x: tx, y: yFlipped });
        }
        // Always collect distances — CTM tracking misses some pages, so layer-
        // specific allDistItems may be incomplete. Proximity matching handles duplicates.
        const norm = str.replace(',', '.');
        if (/^\d+(\.\d+)?$/.test(norm)) {
          allDistItems.push({ str, x: tx, y: yFlipped });
        }
      }
    }

    // ── Assemble posts from TEXTO items + circle centroids ───────────────────
    // Filter NaN circles — CTM tracking may have failed for some Numero_Poste sections.
    const validCircles = allCircles.filter(c => isFinite(c.x) && isFinite(c.y));
    console.debug('[parsePdf] allCircles total:', allCircles.length, 'valid:', validCircles.length,
      'allTextoItems:', allTextoItems.length, 'allDistItems:', allDistItems.length);
    if (validCircles.length > 0)
      console.debug('[parsePdf] first 3 circles:', JSON.stringify(validCircles.slice(0, 3)));
    if (allTextoItems.length > 0)
      console.debug('[parsePdf] first 5 textoItems:', JSON.stringify(allTextoItems.slice(0, 5)));
    const { posts: rawPosts, warnings: aw } =
      assemblePostData(allTextoItems, validCircles, []);
    warnings.push(...aw);

    // ── Post fallback: if circle matching failed, use text positions directly ─
    // Happens when all circle CTMs were NaN (engineering coordinate sections).
    let posts;
    if (rawPosts.length === 0 && allTextoItems.length > 0) {
      warnings.push('Post-circle matching yielded no results; using text label positions as post locations.');
      const textPosts = [];
      for (const item of allTextoItems) {
        const trimmed = item.str.trim();
        if (!/^\d{1,3}$/.test(trimmed)) continue;
        textPosts.push({ number: parseInt(trimmed, 10), x: item.x, y: item.y });
      }
      posts = deduplicatePosts(textPosts);
    } else {
      posts = deduplicatePosts(rawPosts);
    }
    console.debug('[parsePdf] rawPosts:', rawPosts.length, '→ final posts:', posts.length,
      JSON.stringify(posts.map(p => p.number)));

    // ── Deduplicate posts across pages (D-13) already done in both branches ──

    // ── Associate inter-post distances (D-10) ────────────────────────────────
    const { distances, warnings: dw } =
      associateDistances(posts, allDistItems, []);
    warnings.push(...dw);

    // ── Build cable segments (D-04, D-12, D-16) ──────────────────────────────
    const { cableSegments, warnings: cw } =
      buildCableSegments(allCablePaths, []);
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
