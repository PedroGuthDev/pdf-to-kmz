// parser/construct-path-parser.js
// Decodes fn=91 constructPath operator arguments into typed PathOp arrays.
// Named ESM exports only — no default export, no CommonJS require, no imports.

/**
 * Decode a constructPath args tuple into an array of typed PathOp objects.
 *
 * In pdf.js 5.x, constructPath argsArray[i] is: [renderOp, data, minMax]
 *   args[0] — rendering op (OPS.stroke=20, OPS.fill=22, etc.) — ignored here
 *   args[1] — Float32Array with INTERLEAVED DrawOPS codes + coordinates
 *   args[2] — Float32Array(4) bounding box [minX, minY, maxX, maxY] — ignored here
 *
 * DrawOPS interleaved format (from pdf.js DrawOPS enum):
 *   data[i] = op code, followed by its coordinate values:
 *   0 moveTo           → 2 coords: x, y
 *   1 lineTo           → 2 coords: x, y
 *   2 curveTo          → 6 coords: x1, y1, x2, y2, x3, y3
 *   3 quadraticCurveTo → 4 coords: x1, y1, x2, y2
 *   4 closePath        → 0 coords
 *
 * @param {[number, Float32Array, Float32Array]} args  constructPath argsArray entry
 * @returns {Array<PathOp>}
 *
 * PathOp types returned:
 *   { type: 'M',  x, y }
 *   { type: 'L',  x, y }
 *   { type: 'C',  x1, y1, x2, y2, x3, y3 }
 *   { type: 'C2', x1, y1, x2, y2 }
 *   { type: 'Z' }
 */
export function parseConstructPath(args) {
  const data = args[1]; // interleaved DrawOPS codes + coords
  const result = [];
  if (!data || data.length === 0) return result;

  for (let i = 0, ii = data.length; i < ii;) {
    const op = data[i++];
    switch (op) {
      case 0: // DrawOPS.moveTo
        result.push({ type: 'M', x: data[i++], y: data[i++] });
        break;
      case 1: // DrawOPS.lineTo
        result.push({ type: 'L', x: data[i++], y: data[i++] });
        break;
      case 2: // DrawOPS.curveTo (cubic Bézier)
        result.push({
          type: 'C',
          x1: data[i++], y1: data[i++],
          x2: data[i++], y2: data[i++],
          x3: data[i++], y3: data[i++],
        });
        break;
      case 3: // DrawOPS.quadraticCurveTo
        result.push({
          type: 'C2',
          x1: data[i++], y1: data[i++],
          x2: data[i++], y2: data[i++],
        });
        break;
      case 4: // DrawOPS.closePath
        result.push({ type: 'Z' });
        break;
      default:
        // Unknown op — skip to avoid infinite loop; data may be malformed.
        break;
    }
  }

  return result;
}

/**
 * Compute the bounding-box centroid of a PathOp array.
 *
 * NOTE — SKELETON.md A1 supersedes this for circle positions: the correct
 * centroid for Numero_Poste circles is the CTM (e, f) active at the fn=91
 * call, not the bounding box of the decoded path ops. This function is
 * exported for completeness and testing but is NOT called by pdf-parser.js.
 *
 * @param {Array<PathOp>} pathOps
 * @returns {{ x: number, y: number }}
 */
export function circleCentroid(pathOps) {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const op of pathOps) {
    const xs = [op.x, op.x1, op.x2, op.x3].filter(v => v !== undefined);
    const ys = [op.y, op.y1, op.y2, op.y3].filter(v => v !== undefined);
    for (const x of xs) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
    for (const y of ys) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
  };
}
