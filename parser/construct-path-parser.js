// parser/construct-path-parser.js
// Decodes fn=91 constructPath operator arguments into typed PathOp arrays.
// Named ESM exports only — no default export, no CommonJS require, no imports.

/**
 * Decode a constructPath args tuple into an array of typed PathOp objects.
 *
 * @param {[number[]|Uint8Array, number[]|Float32Array]} args
 *   args[0] — array of op codes (13-19)
 *   args[1] — flat array of coordinate values consumed per-op
 * @returns {Array<PathOp>}
 *
 * PathOp types:
 *   { type: 'M',  x, y }
 *   { type: 'L',  x, y }
 *   { type: 'C',  x1, y1, x2, y2, x3, y3 }
 *   { type: 'C2', x1, y1, x2, y2 }
 *   { type: 'C3', x1, y1, x2, y2 }
 *   { type: 'Z' }
 *   { type: 'R',  x, y, w, h }
 *
 * Op code → coord count:
 *   13 M  → 2
 *   14 L  → 2
 *   15 C  → 6
 *   16 C2 → 4
 *   17 C3 → 4
 *   18 Z  → 0
 *   19 R  → 4
 */
export function parseConstructPath(args) {
  const ops = args[0];
  const coords = args[1];
  const result = [];
  let ci = 0; // coordinate index — advanced per-op (NOT fixed stride)

  for (const op of ops) {
    switch (op) {
      case 13: // moveTo
        result.push({ type: 'M', x: coords[ci++], y: coords[ci++] });
        break;
      case 14: // lineTo
        result.push({ type: 'L', x: coords[ci++], y: coords[ci++] });
        break;
      case 15: // curveTo (cubic Bézier — 3 control points + end)
        result.push({
          type: 'C',
          x1: coords[ci++], y1: coords[ci++],
          x2: coords[ci++], y2: coords[ci++],
          x3: coords[ci++], y3: coords[ci++],
        });
        break;
      case 16: // curveTo1 (first control point = current; 2 provided)
        result.push({
          type: 'C2',
          x1: coords[ci++], y1: coords[ci++],
          x2: coords[ci++], y2: coords[ci++],
        });
        break;
      case 17: // curveTo2 (last control point = end; 2 provided)
        result.push({
          type: 'C3',
          x1: coords[ci++], y1: coords[ci++],
          x2: coords[ci++], y2: coords[ci++],
        });
        break;
      case 18: // closePath
        result.push({ type: 'Z' });
        break;
      case 19: // rectangle
        result.push({
          type: 'R',
          x: coords[ci++], y: coords[ci++],
          w: coords[ci++], h: coords[ci++],
        });
        break;
      // Unknown ops are silently skipped to remain forward-compatible.
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
