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

    // ── Process all pages (D-09) ─────────────────────────────────────────────
    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const pageHeight = page.view[3]; // PDF points

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

    // ── Assemble posts from TEXTO items + circle centroids ───────────────────
    const { posts: rawPosts, warnings: aw } =
      assemblePostData(allTextoItems, allCircles, []);
    warnings.push(...aw);

    // ── Deduplicate posts across pages (D-13) ────────────────────────────────
    const posts = deduplicatePosts(rawPosts);

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
