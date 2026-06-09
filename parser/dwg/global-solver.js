/**
 * Global PDF→DXF bipartite alignment (Phase 8 level-0).
 *
 * Anchor post 1 (D-07), rbush candidate prune k≤30 (D-03), D-02 cost matrix,
 * Hungarian assignment via munkres (SOLVE-01), topology gate (D-10/D-11), and
 * D-05 accept bar (residual trust + topology + 2s budget).
 *
 * Pure module: never mutates inputs (pristine walker fallback on demotion).
 */

import { munkres } from "munkres";
import { medianCrossValidate } from "./median-crossval.js";
import {
  applyResidualGate,
  computeAnchorGap,
  computeResiduals,
} from "./residual-gate.js";
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
const ACCEPT_BUDGET_MS = 2000;
/** Printed label rounding tolerance (fraction of printed meters, not absolute). */
const LABEL_ROUND_TOL_FRAC = 0.05;

const AUTHORITATIVE_EDGE_SOURCES = new Set([
  "bifurcation-main",
  "branch-arm-rehomed",
  "branch-arm-rehomed-cross-page",
  "branch-arm-rehomed-topology",
  "override",
]);

function normalizeJunctionSet(junctions) {
  if (!junctions) return new Set();
  if (junctions instanceof Set) return junctions;
  if (Array.isArray(junctions)) return new Set(junctions);
  if (junctions.junctions && typeof junctions.junctions === "object") {
    return new Set(Object.keys(junctions.junctions).map(Number));
  }
  return new Set();
}

function degreeClass(rawDegree) {
  if (rawDegree <= 1) return 1;
  if (rawDegree === 2) return 2;
  return 3;
}

function buildConnAdjFromConnections(connections, postSet) {
  const connAdj = new Map();
  for (const conn of connections ?? []) {
    if (!postSet.has(conn.from) || !postSet.has(conn.to)) continue;
    if (!connAdj.has(conn.from)) connAdj.set(conn.from, new Set());
    if (!connAdj.has(conn.to)) connAdj.set(conn.to, new Set());
    connAdj.get(conn.from).add(conn.to);
    connAdj.get(conn.to).add(conn.from);
  }
  return connAdj;
}

function edgeKey(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/**
 * Partition the route into linear runs between junctions (D-10).
 * Each junction spawns a new run per unused outgoing arm; the main spine is
 * walked first from post 1.
 */
function partitionLinearRuns(postNumbers, junctionSet, connections) {
  const postSet = new Set(postNumbers);
  const adj = buildConnAdjFromConnections(connections, postSet);
  const usedEdges = new Set();
  const runs = [];

  function extendChain(run, start, prev) {
    let current = start;
    let back = prev;
    while (true) {
      const neighbors = [...(adj.get(current) ?? [])].filter((n) => n !== back);
      const next = neighbors.find((n) => !usedEdges.has(edgeKey(current, n)));
      if (next == null) break;
      usedEdges.add(edgeKey(current, next));
      run.push(next);
      back = current;
      current = next;
      if (junctionSet.has(current)) break;
    }
  }

  const startPost = postNumbers[0];
  if (startPost != null) {
    const mainRun = [startPost];
    extendChain(mainRun, startPost, null);
    runs.push(mainRun);
  }

  for (const junc of [...junctionSet].sort((a, b) => a - b)) {
    for (const neighbor of [...(adj.get(junc) ?? [])].sort((a, b) => a - b)) {
      if (usedEdges.has(edgeKey(junc, neighbor))) continue;
      usedEdges.add(edgeKey(junc, neighbor));
      const armRun = [junc, neighbor];
      extendChain(armRun, neighbor, junc);
      runs.push(armRun);
    }
  }

  return runs;
}

function cableSpanAlongPath(fromIdx, toIdx, adjacencyGraph, regionPosts) {
  if (fromIdx == null || toIdx == null) return null;
  if (fromIdx === toIdx) return 0;

  // Dijkstra by accumulated Euclidean span (NOT hop-count BFS): a node's
  // distance is only finalized when it is popped as the current minimum, so the
  // returned span is the true shortest path even on graphs with junctions or
  // cycles. A linear-scan priority queue is adequate for these small graphs.
  const dist = new Map([[fromIdx, 0]]);
  const pq = [{ idx: fromIdx, d: 0 }];
  const settled = new Set();

  while (pq.length) {
    let best = 0;
    for (let i = 1; i < pq.length; i++) {
      if (pq[i].d < pq[best].d) best = i;
    }
    const { idx, d } = pq.splice(best, 1)[0];
    if (idx === toIdx) return d;
    if (settled.has(idx)) continue;
    settled.add(idx);
    for (const neighbor of adjacencyGraph.get(idx) ?? []) {
      if (settled.has(neighbor)) continue;
      const nd =
        d +
        Math.hypot(
          regionPosts[neighbor].x - regionPosts[idx].x,
          regionPosts[neighbor].y - regionPosts[idx].y,
        );
      if (nd < (dist.get(neighbor) ?? Infinity)) {
        dist.set(neighbor, nd);
        pq.push({ idx: neighbor, d: nd });
      }
    }
  }
  return null;
}

function resolveAuthoritativeDegree(postNum, authoritativeDegreeByPost, connAdj) {
  if (authoritativeDegreeByPost?.has(postNum)) {
    const auth = authoritativeDegreeByPost.get(postNum);
    if (auth > 0) return auth;
  }
  return (connAdj.get(postNum) ?? new Set()).size;
}

function hasAuthoritativeDistanceSources(distances) {
  for (const d of distances ?? []) {
    if (AUTHORITATIVE_EDGE_SOURCES.has(d.source)) return true;
  }
  return false;
}

function buildAuthoritativeDegreeByPost(distances, posts) {
  const postSet = new Set(posts.map((p) => p.number));
  const degree = new Map();
  for (const p of posts) degree.set(p.number, 0);
  for (const d of distances ?? []) {
    if (!AUTHORITATIVE_EDGE_SOURCES.has(d.source)) continue;
    if (!(d.meters > 0)) continue;
    if (postSet.has(d.from)) {
      degree.set(d.from, (degree.get(d.from) ?? 0) + 1);
    }
    if (postSet.has(d.to)) {
      degree.set(d.to, (degree.get(d.to) ?? 0) + 1);
    }
  }
  return degree;
}

/**
 * Post-hoc topology gate (D-10 arc-monotonicity + D-11 hub-degree class).
 *
 * @param {{
 *   coords: Array<{ postNumber: number }>,
 *   assignments: Map<number, { x: number, y: number }>,
 *   posts: Array<{ number: number }>,
 *   connections?: Array<{ from: number, to: number }>,
 *   junctions?: Set<number>|number[]|{ junctions: object },
 *   adjacencyGraph: Map<number, Set<number>>,
 *   regionPosts: Array<{ x: number, y: number }>,
 *   postToIdx?: Map<object, number>,
 *   tolerances: { spanTolM: number },
 *   authoritativeDegreeByPost?: Map<number, number>,
 * }} params
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function checkTopologyGate({
  coords,
  assignments,
  posts,
  connections,
  junctions,
  adjacencyGraph,
  regionPosts,
  postToIdx,
  tolerances,
  authoritativeDegreeByPost,
}) {
  const junctionSet = normalizeJunctionSet(junctions);
  const postNumbers = [...posts].map((p) => p.number).sort((a, b) => a - b);
  const postSet = new Set(postNumbers);
  const connAdj = buildConnAdjFromConnections(connections, postSet);

  const idxMap = postToIdx ?? new Map();
  if (!postToIdx) {
    for (let i = 0; i < regionPosts.length; i++) {
      idxMap.set(regionPosts[i], i);
    }
  }

  const monotonicTol = tolerances?.spanTolM ?? 0;
  const runs = partitionLinearRuns(postNumbers, junctionSet, connections);

  for (let runIdx = 0; runIdx < runs.length; runIdx++) {
    const run = runs[runIdx];
    if (run.length < 2) continue;
    const runStart = run[0];
    const startNode = assignments.get(runStart);
    const startIdx = idxMap.get(startNode);
    let prevArc = null;

    for (const postNum of run) {
      const node = assignments.get(postNum);
      if (!node) {
        return { ok: false, reason: `monotonicity:run${runIdx}` };
      }
      const nodeIdx = idxMap.get(node);
      const arcPos = cableSpanAlongPath(startIdx, nodeIdx, adjacencyGraph, regionPosts);
      if (arcPos == null) {
        return { ok: false, reason: `monotonicity:run${runIdx}` };
      }
      if (prevArc != null && arcPos < prevArc - monotonicTol) {
        return { ok: false, reason: `monotonicity:run${runIdx}` };
      }
      prevArc = arcPos;
    }
  }

  for (const postNum of postNumbers) {
    const node = assignments.get(postNum);
    if (!node) continue;
    const nodeIdx = idxMap.get(node);
    const dxfDegree = (adjacencyGraph.get(nodeIdx) ?? new Set()).size;
    const pdfDegree = resolveAuthoritativeDegree(
      postNum,
      authoritativeDegreeByPost,
      connAdj,
    );
    if (degreeClass(pdfDegree) !== degreeClass(dxfDegree)) {
      return { ok: false, reason: `hub-degree:${postNum}` };
    }
  }

  void coords;
  return { ok: true };
}

/** @internal Exported for unit tests — D-05 accept bar assembly. */
export function evaluateAcceptBar({
  coords,
  distances,
  gpsByPostNumber,
  posts,
  assignments,
  connections,
  junctions,
  adjacencyGraph,
  regionPosts,
  postToIdx,
  tolerances,
  authoritativeDegreeByPost,
  elapsedMs,
}) {
  if (elapsedMs >= ACCEPT_BUDGET_MS) {
    return { ok: false, reason: "budget" };
  }

  const shape = computeResiduals(coords, distances);
  const anchor = computeAnchorGap(coords, gpsByPostNumber ?? new Map());
  const residual = applyResidualGate(shape, anchor, {
    allPostNumbers: posts.map((p) => p.number),
  });
  if (residual.gateDecision !== "trust") {
    return { ok: false, reason: "residual-gate", solverScore: residual };
  }

  const topology = checkTopologyGate({
    coords,
    assignments,
    posts,
    connections,
    junctions,
    adjacencyGraph,
    regionPosts,
    postToIdx,
    tolerances,
    authoritativeDegreeByPost,
  });
  if (!topology.ok) {
    return { ok: false, reason: topology.reason, solverScore: residual };
  }

  return { ok: true, solverScore: residual };
}

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
  // Hop depth from the anchor. Colinear dead-reckoning accumulates angular
  // error with each hop, so the prune window is later widened proportionally
  // (WR-04) to avoid pruning the true DXF node on routes that turn.
  const hops = new Map([[anchorPostNum, 0]]);

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
      hops.set(neighbor, (hops.get(current) ?? 0) + 1);
      visited.add(neighbor);
      queue.push(neighbor);
    }
  }

  for (const p of posts) {
    if (!predicted.has(p.number)) {
      predicted.set(p.number, { x: anchorPos.x, y: anchorPos.y });
      hops.set(p.number, hops.get(p.number) ?? 0);
    }
  }

  return { predicted, hops };
}

/** Per-hop widening of the prune window to absorb accumulated dead-reckoning drift (WR-04). */
const HOP_WINDOW_GROWTH = 0.25;

function pruneCandidates({ posts, predicted, hops, postIndex, candidateWindowM, warnings }) {
  const prunedByPost = new Map();
  for (const p of posts) {
    const pred = predicted.get(p.number);
    // Widen the window proportional to hop count: each colinear hop adds
    // angular drift, so a node N hops from the anchor needs a larger window
    // than the anchor's immediate neighbor (WR-04).
    const hopCount = hops?.get(p.number) ?? 0;
    const windowM = candidateWindowM * (1 + HOP_WINDOW_GROWTH * hopCount);
    const raw = postIndex.search({
      minX: pred.x - windowM,
      minY: pred.y - windowM,
      maxX: pred.x + windowM,
      maxY: pred.y + windowM,
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
 *   junctions?: Set<number>|number[]|{ junctions: object },
 *   authoritativeDegreeByPost?: Map<number, number>,
 *   testAssignments?: Map<number, object>,
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
  junctions,
  authoritativeDegreeByPost,
  testAssignments,
  _testAssignments,
}) {
  const forcedAssignments = testAssignments ?? _testAssignments;
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
  const { predicted, hops } = propagatePredictedPositions({
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
    hops,
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

  const munkresAssignments = munkres(costMatrix);
  const assignmentByPost = forcedAssignments ?? new Map();
  const assignedRows = new Set();

  if (!forcedAssignments) {
    for (const [y, x] of munkresAssignments) {
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
  }

  const coords = buildPartialCoords(sortedPosts, assignmentByPost, zoneExpected);
  const elapsedMs = performance.now() - t0;
  const authDegree =
    authoritativeDegreeByPost ??
    (hasAuthoritativeDistanceSources(distances)
      ? buildAuthoritativeDegreeByPost(distances, sortedPosts)
      : undefined);

  const accept = evaluateAcceptBar({
    coords,
    distances,
    gpsByPostNumber,
    posts: sortedPosts,
    assignments: assignmentByPost,
    connections,
    junctions,
    adjacencyGraph: graph,
    regionPosts,
    postToIdx: postToIndex,
    tolerances,
    authoritativeDegreeByPost: authDegree,
    elapsedMs,
  });

  if (!accept.ok) {
    return {
      ok: false,
      reason: accept.reason,
      elapsedMs,
      partialCoords: coords,
      solverScore: accept.solverScore,
      warnings,
    };
  }

  return {
    ok: true,
    coords,
    elapsedMs,
    partialCoords: coords,
    solverScore: accept.solverScore,
    warnings,
  };
}
