// parser/pdf-parser.js
// Top-level orchestrator. The only module with a pdf.js CDN import.
// Exports parsePdf(arrayBuffer) — the Phase 1 output contract consumed by Phase 2.
//
// Output contract (success):
//   { posts, distances, cableSegments, warnings, layerMap: { allNames } }
//   posts[]: { number, x, y, pageNum?, postType? } — numbers from OCR/Numero_Poste labels;
//     x,y from Poste-layer pole symbol centroids (double circle, square+X). postType from Poste text.
// Output contract (error cases):
//   { error: 'missing_layers', missing: String[], allNames: String[] }
//   { error: 'parse_failed', message: String, warnings: String[] }
//
// Named ESM export only — no default export, no CommonJS require.

/** Browser CDN vs Node legacy build (debug-run-calc.mjs). */
let _pdfjsLibPromise = null;
async function getPdfjsLib() {
  if (!_pdfjsLibPromise) {
    _pdfjsLibPromise = (async () => {
      if (typeof process !== 'undefined' && process.versions?.node) {
        const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
        lib.GlobalWorkerOptions.workerSrc = new URL(
          '../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
          import.meta.url
        ).href;
        return lib;
      }
      const lib = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.mjs');
      lib.GlobalWorkerOptions.workerSrc =
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.worker.min.mjs';
      return lib;
    })();
  }
  return _pdfjsLibPromise;
}

import { buildOcgMap, validateLayers, normalizeName } from './ocg-map.js';
import { isPostLabelSourceLayerName, isDistanceSourceLayerName, isViewportRectLayerName, isUtmGridLayerName } from './layer-sources.js';
import { extractLayerText }                            from './text-extractor.js';
import { extractLayerGraphics }                        from './graphics-extractor.js';
import {
  deduplicatePostsPreferLowerPage,
  assemblePostsFromOcr,
} from './post-assembler.js';
import {
  assignPostPositionsFromPosteSymbols,
  assignPolesGloballyByLabels,
  attachMarkerAnchors,
  alignPostPositionsToRouteMarkers,
  assignPostsByRouteOrder,
} from './post-positioning.js';
import { ocrCircleNumbers, createOcrWorker }            from './ocr-extractor.js';
import { associateDistances }                          from './distance-associator.js';
import { computeScaleFactor }                          from './geo/utm-calibrator.js';
import { buildCableSegments, minDistancePointToCablesOnPage } from './cable-builder.js';
import {
  calculateCoordinates,
  parseCoordinateInput,
  validateBrazilBounds,
  detectRouteTopology,
  detectGaps,
  CALC_PIPELINE_ID,
} from './coordinate-calculator.js';
import { buildKml } from './kml-builder.js';
import { packageKmz } from './kmz-packager.js';
import { mergeOptions } from './kmz-defaults.js';

// Re-export coordinate calculator functions for single-entry-point imports (Phase 2).
export {
  calculateCoordinates,
  parseCoordinateInput,
  validateBrazilBounds,
  detectRouteTopology,
  detectGaps,
  CALC_PIPELINE_ID,
  buildKml,
  packageKmz,
  mergeOptions,
};

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
 * Extract an axis-aligned rectangle from a PathOp subpath.
 * Operates on raw PDF coords (pre-flipY). Converts to flipY on return.
 *
 * @param {Array<import('./construct-path-parser.js').PathOp>} ops
 * @param {number} pageHeight
 * @returns {{ x: number, y: number, w: number, h: number } | null}
 */
function extractRectFromSubpath(ops, pageHeight) {
  // Extract path endpoints: M/L coords, plus bezier curve endpoints (C→x3/y3, C2→x2/y2).
  // AutoCAD exports sometimes use bezier arcs for rounded corners.
  const pts = [];
  for (const o of ops) {
    if (o.type === 'M' || o.type === 'L') pts.push({ x: o.x, y: o.y });
    else if (o.type === 'C')  pts.push({ x: o.x3, y: o.y3 });
    else if (o.type === 'C2') pts.push({ x: o.x2, y: o.y2 });
  }
  if (pts.length < 3) return null;
  const xs = pts.map(p => p.x).sort((a, b) => a - b);
  const ys = pts.map(p => p.y).sort((a, b) => a - b);
  // Tolerance-based distinct count: values within 3pt are the same cluster.
  // Math.round(v) produces wrong counts when corners differ by ~0.5–1pt (AutoCAD export noise).
  const clusterCount = (vals) => {
    let n = 1;
    for (let i = 1; i < vals.length; i++) if (vals[i] - vals[i - 1] > 3) n++;
    return n;
  };
  if (clusterCount(xs) !== 2 || clusterCount(ys) !== 2) return null;
  const minX = xs[0], maxX = xs[xs.length - 1];
  const minY = ys[0], maxY = ys[ys.length - 1];
  const w = maxX - minX, h = maxY - minY;
  if (w < 20 || h < 20) return null;
  // Convert from raw PDF (y-up) to flipY (y-down): top-left corner = (minX, pageHeight - maxY)
  return { x: minX, y: pageHeight - maxY, w, h };
}

/**
 * Pair viewport labels to rectangles by nearest centroid.
 * Labels use raw y (item.transform[5]); rect.y is flipY. Convert label.y to flipY for pairing.
 *
 * @param {Array<{ label: string, x: number, y: number }>} labels  raw PDF coords
 * @param {Array<{ rect: { x: number, y: number, w: number, h: number } }>} rects  flipY coords
 * @param {number} pageHeight
 * @returns {Array<{ pageNum: number, rect: { x: number, y: number, w: number, h: number } }>}
 */
function pairLabelsToRects(labels, rects, pageHeight, maxPageNum) {
  /** @type {Array<{ pageNum: number, rect: object, dist: number }>} */
  const candidates = [];
  for (const lbl of labels) {
    const pageNum = parseInt(lbl.label, 10);
    if (!Number.isFinite(pageNum) || pageNum < 3 || pageNum > maxPageNum) continue;

    const lblY_flipY = pageHeight - lbl.y; // convert label raw y to flipY
    for (const r of rects) {
      const cx = r.rect.x + r.rect.w / 2;
      const cy = r.rect.y + r.rect.h / 2; // rect already in flipY
      const d = Math.hypot(lbl.x - cx, lblY_flipY - cy);
      candidates.push({ pageNum, rect: r.rect, dist: d });
    }
  }

  // One-to-one: closest label–rect pairs first (avoids duplicate pageNum from shared rects).
  candidates.sort((a, b) => a.dist - b.dist);
  const usedRects = new Set();
  const usedPages = new Set();
  const paired = [];
  for (const c of candidates) {
    const rectKey = `${c.rect.x},${c.rect.y},${c.rect.w},${c.rect.h}`;
    if (usedRects.has(rectKey) || usedPages.has(c.pageNum)) continue;
    usedRects.add(rectKey);
    usedPages.add(c.pageNum);
    paired.push({ pageNum: c.pageNum, rect: c.rect });
  }
  return paired;
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
    const pdfjsLib = await getPdfjsLib();
    const isNode = typeof process !== 'undefined' && process.versions?.node;
    const docOpts = { data: arrayBuffer };
    if (isNode) {
      docOpts.standardFontDataUrl = new URL(
        '../node_modules/pdfjs-dist/standard_fonts/',
        import.meta.url
      ).href;
    }
    // ── Load PDF ────────────────────────────────────────────────────────────
    const pdfDoc = await pdfjsLib.getDocument(docOpts).promise;

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
    const utmGridPathsPerPage = new Map();   // Map<pageNum, PathOp[][]> — UTM layer, flipY applied
    const viewportBoxes = [];                // Array<{ pageNum, rect }> — page-2 boxes in flipY space
    const viewportLabels = [];               // Array<{ label, x, y }> — raw PDF coords (pre-flipY)
    const pageDimensions = new Map();        // Map<pageNum, { w, h }>

    // ── OCR collector (D-06) — run after viewport pairing (calibrated pages only) ─
    const pendingOcrBatches = [];

    // Selective OCG visibility for OCR rendering (F-01) — browser only.
    // Node: pdf.js + node-canvas currently rasterizes blank pages; OCR is skipped and
    // post numbers fall back to route-order assignment after assembly.
    let ocrOcPromise = null;
    try {
      const ocConfig = await pdfDoc.getOptionalContentConfig();
      if (!isNode) {
        const OCR_LAYER_NAMES = [
          normalizeName('Numero_Poste'),
          normalizeName('TEXTO'),
        ];
        const flatOrder = arr => (arr ?? []).flatMap(item => Array.isArray(item) ? flatOrder(item) : [item]);
        for (const id of flatOrder(ocConfig.getOrder?.() ?? [])) {
          try {
            const layerName = idToName[id] ?? idToName[String(id)] ?? '';
            const isOcrLayer = OCR_LAYER_NAMES.includes(normalizeName(layerName));
            ocConfig.setVisibility(id, isOcrLayer);
          } catch (_) {}
        }
        ocrOcPromise = Promise.resolve(ocConfig);
      }
    } catch (_) {}

    // ── Distance fallback collector ──────────────────────────────────────────
    const allDistItemsFallback = [];


    // ── WR-05: Create Tesseract worker once before page loop ─────────────────
    // Creating a worker per page caused N CDN imports and N WASM inits on multi-page PDFs.
    // The worker is shared across all pages and terminated after the loop.
    const ocrWorker = isNode ? null : await createOcrWorker();

    // ── Process all pages (D-09): each page is independent user space; results merged below ─
    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const pageHeight = page.view[3]; // PDF points
      const pageWidth = page.view[2];
      pageDimensions.set(pageNum, { w: pageWidth, h: pageHeight });
      if (pageNum === 1) console.info('[pdf-to-kmz] parse: page 1 view', page.view);

      const textByLayer = await extractLayerText(page, idToName);
      // gfxResult: { circles (union), namedLayerCircles, layer0Circles, cablePaths, byLayer }
      // NOTE: pdf-parser.js uses namedLayerCircles/layer0Circles for WR-01/WR-03 split logic.
      const gfxResult = await extractLayerGraphics(page, idToName);
      console.info(
        `[pdf-to-kmz] parse: page ${pageNum}/${pdfDoc.numPages}` +
        ` namedCircles=${(gfxResult.namedLayerCircles ?? []).length}` +
        ` layer0Circles=${(gfxResult.layer0Circles ?? []).length}` +
        ` posteGfx=${(gfxResult.posteSymbols ?? []).length}` +
        ` cablePaths=${gfxResult.cablePaths.length}`
      );
      // ── Collect UTM grid paths for this page (flipY applied) ────────────────
      {
        const utmLayerPaths = [];
        for (const [layerName, pathArrays] of Object.entries(gfxResult.byLayer)) {
          if (isUtmGridLayerName(layerName)) {
            for (const pathOps of pathArrays) {
              utmLayerPaths.push(pathOps.map(op => flipYInOp(op, pageHeight)));
            }
          }
        }
        utmGridPathsPerPage.set(pageNum, utmLayerPaths);
      }

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

      // ── Page-2 overview: collect viewport rectangles and labels ─────────────
      if (pageNum === 2) {
        // Collect viewport rectangle boxes from "Padrão" layer.
        // Two strategies:
        //   Pass 1 — each constructPath call is a complete closed rectangle (M L L L Z)
        //   Pass 2 — rectangles drawn as 4 separate line segments; reconstruct from H/V segments
        // After CTM fix, coords are page-space. Filter out rects that span ≥60% of
        // the page — those are the drawing border, not viewport thumbnails.
        const maxVpW = pageWidth * 0.60;
        const maxVpH = pageHeight * 0.60;
        for (const [layerName, pathArrays] of Object.entries(gfxResult.byLayer)) {
          if (!isViewportRectLayerName(layerName)) continue;
          // Pass 1: single-path rectangles
          for (const pathOps of pathArrays) {
            const rect = extractRectFromSubpath(pathOps, pageHeight);
            if (rect && rect.w < maxVpW && rect.h < maxVpH) viewportBoxes.push({ rect });
          }
          // Pass 2: aggregate all H/V segments and reconstruct rectangles
          if (viewportBoxes.length === 0) {
            const hSegs = [], vSegs = [];
            for (const pathOps of pathArrays) {
              let prev = null;
              for (const op of pathOps) {
                if (op.type === 'M') { prev = op; continue; }
                if (op.type === 'L' && prev) {
                  const dx = Math.abs(op.x - prev.x), dy = Math.abs(op.y - prev.y);
                  if (Math.hypot(dx, dy) >= 5) {
                    if (dy <= 3) hSegs.push({ y: (prev.y + op.y) / 2, x1: Math.min(prev.x, op.x), x2: Math.max(prev.x, op.x) });
                    else if (dx <= 3) vSegs.push({ x: (prev.x + op.x) / 2, y1: Math.min(prev.y, op.y), y2: Math.max(prev.y, op.y) });
                  }
                  prev = op;
                }
              }
            }
            const T = 8; // snap tolerance
            for (let i = 0; i < hSegs.length; i++) {
              for (let j = i + 1; j < hSegs.length; j++) {
                const h1 = hSegs[i], h2 = hSegs[j];
                if (Math.abs(h1.x1 - h2.x1) > T || Math.abs(h1.x2 - h2.x2) > T) continue;
                const minX = Math.min(h1.x1, h2.x1), maxX = Math.max(h1.x2, h2.x2);
                const minY = Math.min(h1.y, h2.y),   maxY = Math.max(h1.y, h2.y);
                const w = maxX - minX, h = maxY - minY;
                if (w < 20 || h < 20) continue;
                const lv = vSegs.find(v => Math.abs(v.x - minX) <= T);
                const rv = vSegs.find(v => Math.abs(v.x - maxX) <= T);
                if (lv && rv) viewportBoxes.push({ rect: { x: minX, y: pageHeight - maxY, w, h } });
              }
            }
          }
        }
        // Collect viewport labels "03", "04", "05" via getTextContent (no OCR needed).
        // Reject values > numPages — long routes put Distância_Poste labels (e.g. "34") on page 2.
        for (const item of textContent.items) {
          const s = (item.str ?? '').trim();
          if (!/^\d{2}$/.test(s)) continue;
          const n = parseInt(s, 10);
          if (n >= 3 && n <= pdfDoc.numPages) {
            viewportLabels.push({ label: s, x: item.transform[4], y: item.transform[5] });
          }
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

      // ── Queue OCR (runs only on viewport-calibrated detail pages after pairing) ─
      if (flippedCircles.length > 0) {
        pendingOcrBatches.push({ page, pageHeight, circles: flippedCircles });
      }
    }

    // ── Pair page-2 viewport labels to rectangles ────────────────────────────
    const page2Height = pageDimensions.get(2)?.h ?? 0;
    const pairedViewportBoxes = pairLabelsToRects(
      viewportLabels,
      viewportBoxes,
      page2Height,
      pdfDoc.numPages
    );
    const calibratedPageNums = pairedViewportBoxes.map(v => v.pageNum);
    const calibratedPageSet = new Set(calibratedPageNums);

    const allOcrResults = [];
    for (const batch of pendingOcrBatches) {
      const pageNum = batch.circles[0]?.pageNum;
      if (!calibratedPageSet.has(pageNum)) {
        warnings.push(
          `Page ${pageNum}: skipped post OCR — not a viewport-calibrated route detail page`
        );
        continue;
      }
      let pageOcrResults;
      if (isNode) {
        pageOcrResults = batch.circles.map(circle => ({ circle, number: null, ringCenter: null }));
      } else {
        pageOcrResults = await ocrCircleNumbers(
          batch.page,
          batch.pageHeight,
          batch.circles,
          ocrOcPromise,
          ocrWorker
        );
      }
      allOcrResults.push(...pageOcrResults);
    }

    // ── WR-05: Terminate shared OCR worker after all pages are processed ──────
    if (ocrWorker) await ocrWorker.terminate();

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
    let posts = deduplicatePostsPreferLowerPage(rawPosts, calibratedPageNums);

    if (posts.length === 0 && allOcrResults.length > 0) {
      warnings.push(
        'All OCR reads failed — assigning post numbers 1..N from route order on Numero_Poste circles ' +
        `(viewport-calibrated pages ${calibratedPageNums.join(', ')}).`
      );
      const circles = allOcrResults.map(r => ({
        x: r.circle.x,
        y: r.circle.y,
        pageNum: r.circle.pageNum,
      }));
      posts = assignPostsByRouteOrder(circles, allCablePaths);
      attachMarkerAnchors(posts);
    }

    // ── WR-04: Sanity-check post numbers vs total count ──────────────────────
    // If the maximum post number greatly exceeds the count, OCR likely read
    // coordinate values or label numbers as post numbers.
    if (posts.length > 0) {
      const maxNum = Math.max(...posts.map(p => p.number));
      if (maxNum > posts.length * 3) {
        warnings.push(
          `Suspicious post numbers: highest number ${maxNum} is more than 3× the ` +
          `post count ${posts.length}. OCR may have read coordinate or label values ` +
          `as post numbers. Check graphics layer filtering (layer '0' span filter).`
        );
      }
    }

    console.info(
      '[pdf-to-kmz] parse: ocrResults=', allOcrResults.length,
      'rawPosts=', rawPosts.length, 'final posts=', posts.length,
      posts.map(p => p.number).join(',')
    );

    attachMarkerAnchors(posts);

    // ── Associate inter-post distances before pole assignment (N3 needs labels) ─
    let overviewScale = computeScaleFactor(utmGridPathsPerPage.get(2) ?? [], []);
    if (overviewScale == null) {
      for (const [pn, paths] of utmGridPathsPerPage) {
        if (pn === 2) continue;
        overviewScale = computeScaleFactor(paths, []);
        if (overviewScale != null) break;
      }
    }
    const perPageScale = pageNum => {
      const paths = utmGridPathsPerPage.get(pageNum);
      if (paths?.length) {
        const sf = computeScaleFactor(paths, []);
        if (sf != null) return sf;
      }
      return overviewScale ?? null;
    };

    const { distances, warnings: dw } = associateDistances(posts, allDistItems, [], {
      scaleFactor: overviewScale ?? undefined,
      perPageScale,
    });
    warnings.push(...dw);

    // ── Canonical PDF position: Poste pole symbol (N3 on multi-sheet, else greedy) ─
    const multiSheetRoute = pairedViewportBoxes.length >= 3;
    if (allPosteRaw.length > 0) {
      if (multiSheetRoute) {
        assignPolesGloballyByLabels(posts, allPosteRaw, allCablePaths, distances, warnings, {
          postByNum: new Map(posts.map(p => [p.number, p])),
          perPageScale,
        });
      } else {
        assignPostPositionsFromPosteSymbols(posts, allPosteRaw, allCablePaths, warnings, {
          postByNum: new Map(posts.map(p => [p.number, p])),
        });
      }
    } else {
      warnings.push(
        'No Poste-layer pole symbols extracted — using Numero_Poste circle positions for (x,y).'
      );
      if (posts.length > 0 && allOcrResults.length > 0) {
        alignPostPositionsToRouteMarkers(posts, allOcrResults, allCablePaths);
      }
    }

    // ── Attach post type labels from Poste OCG layer ─────────────────────────
    attachPostTypeLabels(posts, allTextoItems, warnings);

    if (rawPosts.length > posts.length) {
      warnings.push(
        `Merged ${rawPosts.length - posts.length} duplicate post marker(s) across pages (kept viewport-calibrated detail page per post).`
      );
    }

    // ── Build cable segments (D-04, D-12, D-16) ──────────────────────────────
    const { cableSegments, warnings: cw } =
      buildCableSegments(allCablePaths.map(r => r.ops), []);
    warnings.push(...cw);
    // Re-attach pageNum to cableSegments for same-page gap detection (RESEARCH.md §8)
    allCablePaths.forEach((path, idx) => {
      if (cableSegments[idx]) cableSegments[idx].pageNum = path.pageNum;
    });

    // ── Return success contract (D-16) ───────────────────────────────────────
    return {
      posts,
      distances,
      cableSegments,
      warnings,
      layerMap: { allNames },
      utmGridPathsPerPage,
      viewportBoxes: pairedViewportBoxes,
      pageDimensions,
      distanceLabelItems: allDistItems,
      posteRawCentroids: allPosteRaw,
      cablePaths: allCablePaths,
    };

  } catch (err) {
    // T-02-01 / Security V5: any thrown error returns structured error, not crash.
    return { error: 'parse_failed', message: err.message, warnings };
  }
}
