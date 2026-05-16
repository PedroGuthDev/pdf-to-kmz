// parser/graphics-extractor.js
// CTM-tracked graphics layer extractor for pdf.js 5.x.
//
// Extracts:
//   - circles[] from Numero_Poste layer — page-space centroids per closed subpath in each
//     fn=91 call (M…Z batches share one CTM; see circleCentroidsFromSubpaths), with CTM
//     (e,f) fallback when path decode yields nothing usable.
//   - posteSymbols[] from Poste layer — subpath centroids (e.g. square-with-X pole marks).
//   - cablePaths[] from Cabo Projetado layer — decoded PathOp[] arrays.
//   - byLayer{} for other layers (completeness).
//
// Named ESM exports only — no default export, no CommonJS require.

import { parseConstructPath, circleCentroidsFromSubpaths } from './construct-path-parser.js';
import { isCircleCentroidLayerName, isPosteGraphicsLayerName } from './layer-sources.js';

/**
 * Apply the current CTM to all coordinate fields of a PathOp array,
 * converting from local/CAD space to page space.
 * Required for byLayer and cablePaths so their coordinates are consistent
 * with circle centroids (which already go through circleCentroidsFromSubpaths+CTM).
 *
 * @param {Array<import('./construct-path-parser.js').PathOp>} ops
 * @param {{ a: number, b: number, c: number, d: number, e: number, f: number }} ctm
 * @returns {Array<import('./construct-path-parser.js').PathOp>}
 */
function applyCtmToPathOps(ops, ctm) {
  const tx = (x, y) => ({
    x: x * ctm.a + y * ctm.c + ctm.e,
    y: x * ctm.b + y * ctm.d + ctm.f,
  });
  return ops.map(op => {
    if (op.type === 'M' || op.type === 'L') {
      const p = tx(op.x, op.y);
      return { type: op.type, x: p.x, y: p.y };
    }
    if (op.type === 'C') {
      const p1 = tx(op.x1, op.y1), p2 = tx(op.x2, op.y2), p3 = tx(op.x3, op.y3);
      return { type: 'C', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x3: p3.x, y3: p3.y };
    }
    if (op.type === 'C2') {
      const p1 = tx(op.x1, op.y1), p2 = tx(op.x2, op.y2);
      return { type: 'C2', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
    }
    return op; // Z or unknown — no coords
  });
}

// Read 6 matrix values from operator args — handles both standard (6 individual
// numbers) and packed (single Array/Float32Array in args[0]) formats.
let _diagMatrixFormat = null;
function readMatrix6(args) {
  if (typeof args[0] === 'number') return args;
  if (args[0] != null && typeof args[0].length === 'number') {
    if (_diagMatrixFormat !== 'packed') {
      _diagMatrixFormat = 'packed';
      console.info('[pdf-to-kmz] gfx: packed matrix args —', args[0]?.constructor?.name, 'len', args[0]?.length);
    }
    return args[0];
  }
  return null;
}

// pdf.js OPS constants (same as text-extractor.js):
const OPS_SAVE = 10;
const OPS_RESTORE = 11;
const OPS_TRANSFORM = 12;
const OPS_BEGIN_MARKED_CONTENT = 69;  // BMC — anonymous marked content (no OCG ID)
const OPS_BEGIN_MARKED = 70;          // BDC — marked content with properties (carries OCG ID)
const OPS_END_MARKED = 71;            // EMC — closes both BMC and BDC
const OPS_CONSTRUCT_PATH = 91;

// Raw layer names as they appear in the OCG map (case-sensitive, including accents).
const LAYER_CABO_PROJETADO = 'Cabo Projetado';

/**
 * Extract layer graphics using CTM-tracked operator list walk.
 *
 * @param {import('pdfjs-dist').PDFPageProxy} page
 * @param {Object} idToName  Maps raw OCG ID strings to raw layer name strings.
 * @returns {Promise<{
 *   circles: Array<{ x: number, y: number }>,          // merged union (namedLayer + layer0)
 *   namedLayerCircles: Array<{ x: number, y: number }>, // from Numero_Poste etc.
 *   layer0Circles: Array<{ x: number, y: number }>,     // from AutoCAD layer "0" only
 *   posteSymbols: Array<{ x: number, y: number }>,
 *   cablePaths: Array<import('./construct-path-parser.js').PathOp[]>,
 *   byLayer: Object
 * }>}
 *   circles and cablePaths contain raw PDF coordinates (flipY NOT applied — applied by pdf-parser.js).
 */
// intent: 'any' — default 'display' can drop operators for OCG layers that are
// off in the PDF default view; circles would then never reach our walker.
export async function extractLayerGraphics(page, idToName) {
  const opList = await page.getOperatorList({ intent: 'any' });
  const { fnArray, argsArray } = opList;

  // CTM stack — initial identity matrix.
  const ctmStack = [];
  let ctm = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

  // Layer stack — replaces single activeLayer variable (fix for CR-01 / WR-01).
  // PDFs nest BMC (fn=69, anonymous) inside BDC (fn=70, OCG) operators for layout/artifacts.
  // Each BMC/BDC pushes to the stack; each EMC (fn=71) pops exactly one entry.
  // This preserves the outer BDC layer name when an inner BMC's EMC fires.
  const layerStack = [];

  // Split circle centroids by source for WR-01 (layer-0 fallback) and WR-03 (D-10 filter).
  const namedLayerCircles = []; // circles from named layers (Numero_Poste, etc.)
  const layer0Circles = [];     // circles from AutoCAD default layer "0"
  /** Centroids of closed subpaths on Poste layer (square + X, etc.) — raw PDF space. */
  const posteSymbols = [];
  const cablePaths = [];
  const byLayer = {};

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];

    switch (fn) {
      case OPS_SAVE:
        ctmStack.push({ ...ctm });
        break;

      case OPS_RESTORE:
        if (ctmStack.length > 0) {
          ctm = ctmStack.pop();
        }
        break;

      case OPS_TRANSFORM: {
        const m = readMatrix6(args);
        if (!m) {
          console.warn('[gfxExtractor] OPS_TRANSFORM: unreadable matrix args at i=', i, args);
          break;
        }
        const [na, nb, nc, nd, ne, nf] = m;
        // new_CTM = old_CTM × M (column-vector right-multiply, pdf.js / Canvas 2D convention)
        // M = [[na,nc,ne],[nb,nd,nf],[0,0,1]]
        const { a, b, c, d, e, f } = ctm;
        ctm = {
          a: a * na + c * nb,
          b: b * na + d * nb,
          c: a * nc + c * nd,
          d: b * nc + d * nd,
          e: a * ne + c * nf + e,
          f: b * ne + d * nf + f,
        };
        break;
      }

      case OPS_BEGIN_MARKED_CONTENT:
        // BMC: anonymous marked content — push null so EMC pops correctly.
        layerStack.push(null);
        break;

      case OPS_BEGIN_MARKED: {
        // BDC: push the OCG layer name (or null if id not found in map).
        if (args && args[1] && args[1].id != null) {
          const gid = args[1].id;
          const rawName = idToName[gid] ?? idToName[String(gid)];
          layerStack.push(rawName !== undefined ? rawName : null);
        } else {
          layerStack.push(null);
        }
        break;
      }

      case OPS_END_MARKED:
        // EMC: pop one entry regardless of whether it was pushed by BMC or BDC.
        if (layerStack.length > 0) layerStack.pop();
        break;

      case OPS_CONSTRUCT_PATH: {
        const activeLayer = layerStack.length > 0 ? layerStack[layerStack.length - 1] : null;
        if (activeLayer !== null) {
          if (isCircleCentroidLayerName(activeLayer)) {
            if (!isFinite(ctm.e) || !isFinite(ctm.f)) break;
            const pathOps = parseConstructPath(args);
            // Layer "0" is AutoCAD default — it carries almost all linework; only keep
            // subpaths whose page-space size matches a post marker (~35 pt radius → ~70–90 pt).
            // Tightened from [16,360] to [50,120] to exclude cable segments and dimension geometry.
            const layer0Span =
              activeLayer === '0' ? { min: 50, max: 120 } : null;
            const fromPath = circleCentroidsFromSubpaths(pathOps, ctm, layer0Span);
            if (fromPath.length > 0) {
              if (fromPath.length > 1) {
                console.info('[pdf-to-kmz] gfx: batched constructPath →', fromPath.length, 'centroids');
              }
              for (const p of fromPath) {
                const target = activeLayer === '0' ? layer0Circles : namedLayerCircles;
                if (isFinite(p.x) && isFinite(p.y)) target.push(p);
              }
            } else if (activeLayer !== '0') {
              namedLayerCircles.push({ x: ctm.e, y: ctm.f });
            }
          } else if (isPosteGraphicsLayerName(activeLayer)) {
            if (!isFinite(ctm.e) || !isFinite(ctm.f)) break;
            const pathOps = parseConstructPath(args);
            const posteSpan = { min: 3, max: 320 };
            const fromPath = circleCentroidsFromSubpaths(pathOps, ctm, posteSpan);
            if (fromPath.length > 0) {
              for (const p of fromPath) {
                if (isFinite(p.x) && isFinite(p.y)) posteSymbols.push(p);
              }
            }
          } else if (activeLayer === LAYER_CABO_PROJETADO) {
            cablePaths.push(applyCtmToPathOps(parseConstructPath(args), ctm));
          } else {
            // Collect other layer paths for completeness.
            // CTM applied so coordinates are in page-space (consistent with circle positions).
            if (!byLayer[activeLayer]) {
              byLayer[activeLayer] = [];
            }
            byLayer[activeLayer].push(applyCtmToPathOps(parseConstructPath(args), ctm));
          }
        }
        break;
      }
    }
  }

  // Deduplicate circles by proximity — AutoCAD often emits fill + stroke as two separate
  // constructPath calls on the same layer, both with the same centroid. Without dedup,
  // the OCR loop runs twice per circle and sequence inference produces spurious posts.
  const dedupeByProximity = (pts, threshold = 8) => {
    const kept = [];
    for (const c of pts) {
      if (!kept.some(k => Math.hypot(k.x - c.x, k.y - c.y) < threshold)) kept.push(c);
    }
    return kept;
  };
  const dedupedNamed = dedupeByProximity(namedLayerCircles);
  const dedupedLayer0 = dedupeByProximity(layer0Circles);
  if (dedupedNamed.length !== namedLayerCircles.length) {
    console.info(
      `[pdf-to-kmz] gfx: deduped namedLayer circles ${namedLayerCircles.length} → ${dedupedNamed.length}`
    );
  }

  // circles = merged union for backward compat; pdf-parser.js uses namedLayerCircles/layer0Circles
  // for WR-01 (layer-0 fallback) and WR-03 (D-10 named-layer-only filter).
  const circles = [...dedupedNamed, ...dedupedLayer0];
  return { circles, namedLayerCircles: dedupedNamed, layer0Circles: dedupedLayer0, posteSymbols, cablePaths, byLayer };
}
