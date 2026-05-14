// parser/graphics-extractor.js
// CTM-tracked graphics layer extractor for pdf.js 5.x.
//
// Extracts:
//   - circles[] from Numero_Poste layer — {x, y} from CTM (e,f) at fn=91 call.
//     Per SKELETON.md A1: circle local center is (0,0); CTM translation IS the page position.
//   - cablePaths[] from Cabo Projetado layer — decoded PathOp[] arrays.
//   - byLayer{} for other layers (completeness).
//
// Named ESM exports only — no default export, no CommonJS require.

import { parseConstructPath } from './construct-path-parser.js';

// Read 6 matrix values from operator args — handles both standard (6 individual
// numbers) and packed (single Array/Float32Array in args[0]) formats.
let _diagMatrixFormat = null;
function readMatrix6(args) {
  if (typeof args[0] === 'number') return args;
  if (args[0] != null && typeof args[0].length === 'number') {
    if (_diagMatrixFormat !== 'packed') {
      _diagMatrixFormat = 'packed';
      console.debug('[gfxExtractor] packed matrix args detected — type:', args[0]?.constructor?.name, 'length:', args[0]?.length);
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
const LAYER_NUMERO_POSTE = 'Numero_Poste';
const LAYER_CABO_PROJETADO = 'Cabo Projetado';

/**
 * Extract layer graphics using CTM-tracked operator list walk.
 *
 * @param {import('pdfjs-dist').PDFPageProxy} page
 * @param {Object} idToName  Maps raw OCG ID strings to raw layer name strings.
 * @returns {Promise<{
 *   circles: Array<{ x: number, y: number }>,
 *   cablePaths: Array<import('./construct-path-parser.js').PathOp[]>,
 *   byLayer: Object
 * }>}
 *   circles and cablePaths contain raw PDF coordinates (flipY NOT applied — applied by pdf-parser.js).
 */
export async function extractLayerGraphics(page, idToName) {
  const opList = await page.getOperatorList();
  const { fnArray, argsArray } = opList;

  // CTM stack — initial identity matrix.
  const ctmStack = [];
  let ctm = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

  // Layer stack — replaces single activeLayer variable (fix for CR-01 / WR-01).
  // PDFs nest BMC (fn=69, anonymous) inside BDC (fn=70, OCG) operators for layout/artifacts.
  // Each BMC/BDC pushes to the stack; each EMC (fn=71) pops exactly one entry.
  // This preserves the outer BDC layer name when an inner BMC's EMC fires.
  const layerStack = [];

  const circles = [];
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
          const rawName = idToName[args[1].id];
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
          if (activeLayer === LAYER_NUMERO_POSTE) {
            // Per SKELETON.md A1: circle local center = (0, 0) in local coords.
            // CTM (e, f) at fn=91 call IS the page-space position of the circle center.
            // Only push when CTM is valid — NaN means CTM tracking failed for this section.
            if (isFinite(ctm.e) && isFinite(ctm.f)) {
              circles.push({ x: ctm.e, y: ctm.f });
            }
          } else if (activeLayer === LAYER_CABO_PROJETADO) {
            cablePaths.push(parseConstructPath(args));
          } else {
            // Collect other layer paths for completeness.
            if (!byLayer[activeLayer]) {
              byLayer[activeLayer] = [];
            }
            byLayer[activeLayer].push(parseConstructPath(args));
          }
        }
        break;
      }
    }
  }

  return { circles, cablePaths, byLayer };
}
