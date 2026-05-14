// parser/cable-builder.js
// Builds cable segment objects from Cabo Projetado PathOp arrays.
// Optionally detects branch points where segments share endpoints.
//
// Named ESM exports only — no default export, no CommonJS require.

/**
 * Extract the first or last endpoint {x, y} from a PathOp array.
 * Only M (moveTo) and L (lineTo) ops carry absolute x,y endpoint positions.
 *
 * @param {Array<import('./construct-path-parser.js').PathOp>} ops
 * @param {'start'|'end'} which
 * @returns {{ x: number, y: number }|null}
 */
function endpointFromPath(ops, which) {
  const pts = ops.filter(op => op.type === 'M' || op.type === 'L');
  if (!pts.length) return null;
  const op = which === 'start' ? pts[0] : pts[pts.length - 1];
  return { x: op.x, y: op.y };
}

/**
 * Check whether two optional {x, y} points are within threshold distance.
 * Returns false if either point is null.
 *
 * @param {{ x: number, y: number }|null} a
 * @param {{ x: number, y: number }|null} b
 * @param {number} threshold  PDF points.
 * @returns {boolean}
 */
function pointsClose(a, b, threshold) {
  if (!a || !b) return false;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy) < threshold;
}

/**
 * Build cable segment objects from raw PathOp arrays extracted from Cabo Projetado.
 *
 * Each segment: { id: Number, ops: PathOp[], startPoint: {x,y}|null, endPoint: {x,y}|null }
 * startPoint and endPoint are the first and last M/L ops in the path (flipY already applied).
 *
 * Also detects branch segments (D-12) and records them as warnings.
 *
 * @param {Array<Array<import('./construct-path-parser.js').PathOp>>} cablePaths
 *   Array of PathOp[] arrays (flipY already applied by pdf-parser.js).
 * @param {string[]} warnings  Mutable warning accumulator (D-07).
 * @returns {{ cableSegments: Array<{ id: number, ops: PathOp[], startPoint: {x,y}|null, endPoint: {x,y}|null }>, warnings: string[] }}
 */
export function buildCableSegments(cablePaths, warnings = []) {
  const cableSegments = cablePaths.map((ops, idx) => ({
    id: idx,
    ops,
    startPoint: endpointFromPath(ops, 'start'),
    endPoint: endpointFromPath(ops, 'end'),
  }));

  // D-12: Detect branch pairs and record as informational warnings.
  const branches = detectBranches(cableSegments);
  for (const branch of branches) {
    warnings.push(
      `Branch detected: cable segments ${branch.segmentA} and ${branch.segmentB} share an endpoint`
    );
  }

  return { cableSegments, warnings };
}

/**
 * Find pairs of cable segments that share an endpoint within threshold PDF points.
 * Used for branch detection (D-12).
 *
 * @param {Array<{ id: number, startPoint: {x,y}|null, endPoint: {x,y}|null }>} cableSegments
 * @param {number} threshold  PDF points (default 5).
 * @returns {Array<{ segmentA: number, segmentB: number }>}
 */
export function detectBranches(cableSegments, threshold = 5) {
  const branches = [];

  for (let i = 0; i < cableSegments.length; i++) {
    for (let j = i + 1; j < cableSegments.length; j++) {
      const a = cableSegments[i];
      const b = cableSegments[j];

      if (
        pointsClose(a.endPoint, b.startPoint, threshold) ||
        pointsClose(a.startPoint, b.startPoint, threshold) ||
        pointsClose(a.endPoint, b.endPoint, threshold) ||
        pointsClose(a.startPoint, b.endPoint, threshold)
      ) {
        branches.push({ segmentA: i, segmentB: j });
      }
    }
  }

  return branches;
}
