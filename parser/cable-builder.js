// parser/cable-builder.js
// Builds cable segment objects from Cabo Projetado PathOp arrays.
// Optionally detects branch points where segments share endpoints.
//
// Named ESM exports only — no default export, no CommonJS require.

/**
 * Shortest distance from point (px,py) to segment A–B (clamped).
 *
 * @param {number} px
 * @param {number} py
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 */
function distPointToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const ab2 = abx * abx + aby * aby;
  let t = ab2 > 1e-12 ? (apx * abx + apy * aby) / ab2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Minimum distance from a point to a polyline / curve path in flipped page space.
 * Used to tell whether a post marker lies near the drawn cable (route identification).
 *
 * @param {number} px
 * @param {number} py
 * @param {Array<import('./construct-path-parser.js').PathOp>} ops
 * @returns {number}
 */
export function minDistancePointToPathOps(px, py, ops) {
  if (!ops || ops.length === 0) return Infinity;
  let minD = Infinity;
  /** @type {{ x: number, y: number } | null} */
  let cur = null;
  /** @type {{ x: number, y: number } | null} */
  let subpathStart = null;

  for (const op of ops) {
    if (op.type === 'M') {
      cur = { x: op.x, y: op.y };
      subpathStart = cur;
    } else if (op.type === 'L' && cur) {
      minD = Math.min(minD, distPointToSegment(px, py, cur.x, cur.y, op.x, op.y));
      cur = { x: op.x, y: op.y };
    } else if (op.type === 'C' && cur) {
      const x0 = cur.x;
      const y0 = cur.y;
      const { x1, y1, x2, y2, x3, y3 } = op;
      let px0 = x0;
      let py0 = y0;
      const steps = 10;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const om = 1 - t;
        const bx =
          om * om * om * x0 +
          3 * om * om * t * x1 +
          3 * om * t * t * x2 +
          t * t * t * x3;
        const by =
          om * om * om * y0 +
          3 * om * om * t * y1 +
          3 * om * t * t * y2 +
          t * t * t * y3;
        minD = Math.min(minD, distPointToSegment(px, py, px0, py0, bx, by));
        px0 = bx;
        py0 = by;
      }
      cur = { x: op.x3, y: op.y3 };
    } else if (op.type === 'C2' && cur) {
      const x0 = cur.x;
      const y0 = cur.y;
      const { x1, y1, x2, y2 } = op;
      let px0 = x0;
      let py0 = y0;
      const steps = 8;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const om = 1 - t;
        const bx = om * om * x0 + 2 * om * t * x1 + t * t * x2;
        const by = om * om * y0 + 2 * om * t * y1 + t * t * y2;
        minD = Math.min(minD, distPointToSegment(px, py, px0, py0, bx, by));
        px0 = bx;
        py0 = by;
      }
      cur = { x: op.x2, y: op.y2 };
    } else if (op.type === 'Z' && cur && subpathStart) {
      minD = Math.min(minD, distPointToSegment(px, py, cur.x, cur.y, subpathStart.x, subpathStart.y));
      cur = { ...subpathStart };
    }
  }
  return minD;
}

/**
 * @param {number} px
 * @param {number} py
 * @param {number} pageNum
 * @param {Map<number, Array<Array<import('./construct-path-parser.js').PathOp>>>} cablesByPage
 * @returns {number}
 */
export function minDistancePointToCablesOnPage(px, py, pageNum, cablesByPage) {
  const paths = cablesByPage.get(pageNum) ?? [];
  if (paths.length === 0) return Infinity;
  let m = Infinity;
  for (const ops of paths) {
    m = Math.min(m, minDistancePointToPathOps(px, py, ops));
  }
  return m;
}

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
