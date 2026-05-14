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
const OPS_BEGIN_MARKED = 70;
const OPS_END_MARKED = 71;
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
  let activeLayer = null;

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
        if (!m) break;
        const [na, nb, nc, nd, ne, nf] = m;
        const prevA = ctm.a, prevB = ctm.b;
        const prevC = ctm.c, prevD = ctm.d;
        const prevE = ctm.e, prevF = ctm.f;
        ctm = {
          a: prevA * na + prevB * nc,
          b: prevA * nb + prevB * nd,
          c: prevC * na + prevD * nc,
          d: prevC * nb + prevD * nd,
          e: prevE * na + prevF * nc + ne,
          f: prevE * nb + prevF * nd + nf,
        };
        break;
      }

      case OPS_BEGIN_MARKED: {
        if (args && args[1] && args[1].id != null) {
          const rawName = idToName[args[1].id];
          if (rawName !== undefined) activeLayer = rawName;
        }
        break;
      }

      case OPS_END_MARKED:
        activeLayer = null;
        break;

      case OPS_CONSTRUCT_PATH:
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

  return { circles, cablePaths, byLayer };
}
