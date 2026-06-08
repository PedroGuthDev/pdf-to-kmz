/**
 * Global PDF→DXF bipartite alignment (Phase 8 level-0).
 *
 * Anchor post 1 (D-07), rbush candidate prune k≤30 (D-03), D-02 cost matrix,
 * Hungarian assignment via munkres (SOLVE-01). Wave 1 core only — no topology
 * gate or cascade wiring yet.
 *
 * Pure module: never mutates inputs (pristine walker fallback on demotion).
 */

import { munkres } from "munkres";
import { medianCrossValidate } from "./median-crossval.js";
import {
  DEFAULT_TOLERANCE_M,
  buildAdjacencyGraph,
  buildPostIndex,
} from "./region-pairing.js";
import { latLonToUtm, utmToLatLon } from "../geo/utm-calibrator.js";

const MAX_CANDIDATES = 30;
const SENTINEL_MULT = 10;
const W_POS = 1;
const W_SPAN = 1;
/** Printed label rounding tolerance (fraction of printed meters, not absolute). */
const LABEL_ROUND_TOL_FRAC = 0.05;

function buildDistanceMap(distances) {
  const map = new Map();
  for (const d of distances ?? []) {
    if (d.meters > 0 && !Number.isNaN(d.meters)) {
      map.set(`${d.from}-${d.to}`, d.meters);
      map.set(`${d.to}-${d.from}`, d.meters);
    }
  }
  return map;
}

function getPrintedMeters(distMap, a, b) {
  return distMap.get(`${a}-${b}`) ?? null;
}

function buildConnAdj(posts, connections) {
  const postSet = new Set(posts.map((p) => p.number));
  const connAdj = new Map();
  for (const conn of connections ?? []) {
    if (!postSet.has(conn.from) || !postSet.has(conn.to)) continue;
    if (!connAdj.has(conn.from)) connAdj.set(conn.from, []);
    if (!connAdj.has(conn.to)) connAdj.set(conn.to, []);
    connAdj.get(conn.from).push(conn.to);
    connAdj.get(conn.to).push(conn.from);
  }
  return connAdj;
}

function propagatePredictedPositions({
  posts,
  connections,
  distMap,
  anchorPostNum,
  anchorPos,
  anchorIdx,
  adjacencyGraph,
  regionPosts,
  spanTolM,
}) {
  const postSet = new Set(posts.map((p) => p.number));
  const predicted = new Map([[anchorPostNum, { x: anchorPos.x, y: anchorPos.y }]]);
  const parent = new Map([[anchorPostNum, null]]);

  const connAdj = buildConnAdj(posts, connections);
  const queue = [anchorPostNum];
  const visited = new Set([anchorPostNum]);

  while (queue.length) {
    const current = queue.shift();
    const curPos = predicted.get(current);
    for (const neighbor of connAdj.get(current) ?? []) {
      if (visited.has(neighbor)) continue;
      const d = getPrintedMeters(distMap, current, neighbor);
      if (d == null) continue;

      let dirX = 1;
      let dirY = 0;

      if (current === anchorPostNum) {
        const neighbors = adjacencyGraph.get(anchorIdx) ?? new Set();
        let bestNode = null;
        let bestDiff = Infinity;
        for (const ni of neighbors) {
          const node = regionPosts[ni];
          const span = Math.hypot(node.x - anchorPos.x, node.y - anchorPos.y);
          const diff = Math.abs(span - d);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestNode = node;
          }
        }
        if (bestNode && bestDiff <= spanTolM + d * LABEL_ROUND_TOL_FRAC) {
          const mag = Math.hypot(bestNode.x - anchorPos.x, bestNode.y - anchorPos.y);
          if (mag > 0) {
            dirX = (bestNode.x - anchorPos.x) / mag;
            dirY = (bestNode.y - anchorPos.y) / mag;
          }
        }
      } else {
        const par = parent.get(current);
        const parPos = predicted.get(par);
        if (parPos) {
          const mag = Math.hypot(curPos.x - parPos.x, curPos.y - parPos.y);
          if (mag > 0) {
            dirX = (curPos.x - parPos.x) / mag;
            dirY = (curPos.y - parPos.y) / mag;
          }
        }
      }

      predicted.set(neighbor, {
        x: curPos.x + dirX * d,
        y: curPos.y + dirY * d,
      });
      parent.set(neighbor, current);
      visited.add(neighbor);
      queue.push(neighbor);
    }
  }

  for (const p of posts) {
    if (!predicted.has(p.number)) {
      predicted.set(p.number, { x: anchorPos.x, y: anchorPos.y });
    }
  }

  return predicted;
}

function pruneCandidates({ posts, predicted, postIndex, candidateWindowM, warnings }) {
  const prunedByPost = new Map();
  for (const p of posts) {
    const pred = predicted.get(p.number);
    const raw = postIndex.search({
      minX: pred.x - candidateWindowM,
      minY: pred.y - candidateWindowM,
      maxX: pred.x + candidateWindowM,
      maxY: pred.y + candidateWindowM,
    });
    const sorted = raw
      .map((node) => ({
        node,
        d: Math.hypot(node.x - pred.x, node.y - pred.y),
      }))
      .sort((a, b) => a.d - b.d);

    if (sorted.length > MAX_CANDIDATES) {
      warnings.push({
        kind: "global-solver-candidate-prune",
        post: p.number,
        unpruned: sorted.length,
        kept: MAX_CANDIDATES,
      });
    }
    prunedByPost.set(
      p.number,
      sorted.slice(0, MAX_CANDIDATES).map((s) => s.node),
    );
  }
  return prunedByPost;
}

function buildCandidateColumns(prunedByPost, posts) {
  const columnNodes = [];
  const nodeToCol = new Map();
  const postToCols = new Map();

  for (const p of posts) {
    const cols = [];
    for (const node of prunedByPost.get(p.number) ?? []) {
      let col = nodeToCol.get(node);
      if (col == null) {
        col = columnNodes.length;
        columnNodes.push(node);
        nodeToCol.set(node, col);
      }
      cols.push(col);
    }
    postToCols.set(p.number, cols);
  }
  return { columnNodes, nodeToCol, postToCols };
}

function spanFitCost(postNum, colNode, predicted, distMap, connAdj) {
  let sum = 0;
  for (const neighbor of connAdj.get(postNum) ?? []) {
    const d = getPrintedMeters(distMap, postNum, neighbor);
    if (d == null) continue;
    const neighborPred = predicted.get(neighbor);
    if (!neighborPred) continue;
    const span = Math.hypot(
      colNode.x - neighborPred.x,
      colNode.y - neighborPred.y,
    );
    const diff = Math.abs(d - span);
    const tol = LABEL_ROUND_TOL_FRAC * d;
    sum += Math.max(0, diff - tol);
  }
  return sum;
}

function buildPartialCoords(sortedPosts, assignmentByPost, zoneExpected) {
  const coords = [];
  for (const p of sortedPosts) {
    const node = assignmentByPost.get(p.number);
    if (!node) break;
    const { lat, lon } = utmToLatLon(node.x, node.y, zoneExpected);
    coords.push({
      postNumber: p.number,
      lat,
      lon,
      source: "dwg",
      dwg_block: node.block,
    });
  }
  return coords;
}

/**
 * @param {{
 *   posts: Array<{ number: number, x?: number, y?: number, page?: number }>,
 *   distances: Array<{ from: number, to: number, meters: number }>,
 *   connections: Array<{ from: number, to: number }>,
 *   startLat: number,
 *   startLon: number,
 *   regionData: { crs?: { zone?: number } },
 *   regionPosts: Array<{ x: number, y: number, block?: string }>,
 *   regionEdges: Array<{ a: { x: number, y: number }, b: { x: number, y: number } }>,
 *   postIndex?: import("./region-pairing.js").PostIndex,
 *   adjacencyGraph?: Map<number, Set<number>>,
 *   gpsByPostNumber?: Map<number, { lat: number, lon: number }>,
 * }} params
 */
export function solveGlobalGraphAlignment({
  posts,
  distances,
  connections,
  startLat,
  startLon,
  regionData,
  regionPosts,
  regionEdges,
  postIndex,
  adjacencyGraph,
  gpsByPostNumber,
}) {
  void gpsByPostNumber;
  const t0 = performance.now();
  const warnings = [];

  const scale = medianCrossValidate({ distances, regionEdges });
  if (!scale.ok) {
    return {
      ok: false,
      reason: scale.reason,
      elapsedMs: performance.now() - t0,
    };
  }

  const { tolerances } = scale;
  const spanTolM = tolerances.spanTolM;
  const candidateWindowM = tolerances.candidateWindowM;

  const zoneExpected = regionData?.crs?.zone ?? 22;
  const sortedPosts = [...posts].sort((a, b) => a.number - b.number);

  const tree = postIndex ?? buildPostIndex(regionPosts);
  const postToIndex = new Map();
  for (let i = 0; i < regionPosts.length; i++) {
    postToIndex.set(regionPosts[i], i);
  }
  const graph =
    adjacencyGraph ??
    buildAdjacencyGraph(regionPosts, regionEdges, {
      postIndex: tree,
      postToIdx: postToIndex,
    });

  const anchorUtm = latLonToUtm(startLat, startLon);
  const anchorCandidates = tree.search({
    minX: anchorUtm.easting - DEFAULT_TOLERANCE_M,
    minY: anchorUtm.northing - DEFAULT_TOLERANCE_M,
    maxX: anchorUtm.easting + DEFAULT_TOLERANCE_M,
    maxY: anchorUtm.northing + DEFAULT_TOLERANCE_M,
  });

  if (!anchorCandidates.length) {
    return { ok: false, reason: "no-anchor", elapsedMs: performance.now() - t0 };
  }

  let anchorBest = null;
  let anchorDist = Infinity;
  for (const c of anchorCandidates) {
    const d = Math.hypot(c.x - anchorUtm.easting, c.y - anchorUtm.northing);
    if (d < anchorDist) {
      anchorDist = d;
      anchorBest = c;
    }
  }

  if (!anchorBest || anchorDist > DEFAULT_TOLERANCE_M) {
    return { ok: false, reason: "no-anchor", elapsedMs: performance.now() - t0 };
  }

  const anchorIdx = postToIndex.get(anchorBest);
  const anchorPostNum = sortedPosts[0]?.number ?? 1;

  const distMap = buildDistanceMap(distances);
  const predicted = propagatePredictedPositions({
    posts: sortedPosts,
    connections,
    distMap,
    anchorPostNum,
    anchorPos: anchorBest,
    anchorIdx,
    adjacencyGraph: graph,
    regionPosts,
    spanTolM,
  });

  const prunedByPost = pruneCandidates({
    posts: sortedPosts,
    predicted,
    postIndex: tree,
    candidateWindowM,
    warnings,
  });

  const { columnNodes, nodeToCol, postToCols } = buildCandidateColumns(
    prunedByPost,
    sortedPosts,
  );

  if (columnNodes.length === 0) {
    return { ok: false, reason: "coverage", elapsedMs: performance.now() - t0, warnings };
  }

  const connAdj = buildConnAdj(sortedPosts, connections);
  const nRows = sortedPosts.length;
  const nCols = columnNodes.length;

  let maxRealCost = 1;
  const realCosts = Array.from({ length: nRows }, () => new Array(nCols).fill(null));

  for (let ri = 0; ri < nRows; ri++) {
    const postNum = sortedPosts[ri].number;
    const pred = predicted.get(postNum);
    const allowedCols = new Set(postToCols.get(postNum) ?? []);

    for (let ci = 0; ci < nCols; ci++) {
      if (!allowedCols.has(ci)) continue;
      const node = columnNodes[ci];
      const posResidual = Math.hypot(node.x - pred.x, node.y - pred.y);
      const spanFit = spanFitCost(postNum, node, predicted, distMap, connAdj);
      const cost = W_POS * posResidual + W_SPAN * spanFit;
      realCosts[ri][ci] = cost;
      if (cost > maxRealCost) maxRealCost = cost;
    }
  }

  const sentinel = SENTINEL_MULT * maxRealCost;
  const costMatrix = Array.from({ length: nRows }, () =>
    new Array(nCols).fill(sentinel),
  );

  for (let ri = 0; ri < nRows; ri++) {
    for (let ci = 0; ci < nCols; ci++) {
      if (realCosts[ri][ci] != null) {
        costMatrix[ri][ci] = realCosts[ri][ci];
      }
    }
  }

  const anchorCol = nodeToCol.get(anchorBest);
  const anchorRow = sortedPosts.findIndex((p) => p.number === anchorPostNum);
  if (anchorRow >= 0 && anchorCol != null) {
    costMatrix[anchorRow][anchorCol] = -Infinity;
  }

  const assignments = munkres(costMatrix);
  const assignmentByPost = new Map();
  const assignedRows = new Set();

  for (const [y, x] of assignments) {
    assignedRows.add(y);
    const cost = costMatrix[y][x];
    if (cost !== -Infinity && cost >= sentinel * 0.999) {
      return {
        ok: false,
        reason: "coverage",
        elapsedMs: performance.now() - t0,
        partialCoords: buildPartialCoords(
          sortedPosts,
          assignmentByPost,
          zoneExpected,
        ),
        warnings,
      };
    }
    const postNum = sortedPosts[y].number;
    assignmentByPost.set(postNum, columnNodes[x]);
  }

  if (assignedRows.size < nRows) {
    return {
      ok: false,
      reason: "coverage",
      elapsedMs: performance.now() - t0,
      partialCoords: buildPartialCoords(
        sortedPosts,
        assignmentByPost,
        zoneExpected,
      ),
      warnings,
    };
  }

  const coords = buildPartialCoords(sortedPosts, assignmentByPost, zoneExpected);
  const elapsedMs = performance.now() - t0;

  return {
    ok: true,
    coords,
    elapsedMs,
    partialCoords: coords,
    warnings,
  };
}
