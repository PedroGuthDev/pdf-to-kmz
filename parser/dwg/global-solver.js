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
/** D-05 accept bar: median |span−printed|/printed must beat this (the residual
 * gate's SHAPE_TRUST band) for the solver to replace the graph-walker. */
const SOLVER_SHAPE_ACCEPT = 0.05;
/** Viterbi refinement: per-edge span-misfit cap (m) so a single bad label
 * cannot dominate the path choice, and the emission (prediction-prior) weight
 * relative to span misfit. */
const VITERBI_SPAN_CAP = 30;
// Tie-breaker only: at 0.05, a full prediction drift of 60 m contributes 3 per
// post — the non-uniform pole-spacing fingerprint (span misfits of 10–30 m per
// wrong hop) always outvotes it, while parallel equally-spaced streets still
// resolve toward the prediction prior.
const VITERBI_EMISSION_W = 0.05;
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
    const inRun = new Set(run);
    let current = start;
    let back = prev;
    while (true) {
      const neighbors = [...(adj.get(current) ?? [])].filter((n) => n !== back);
      // Never revisit a post already in this run: a cycle edge (Valmor's DXF
      // topology links 2–4 alongside 2–3–4) would otherwise close the run
      // back onto its start, making arc-monotonicity unsatisfiable for a
      // CORRECT assignment. The closing edge is left for the junction loop
      // below, which checks it as its own two-post arm.
      const next = neighbors.find(
        (n) => !usedEdges.has(edgeKey(current, n)) && !inRun.has(n),
      );
      if (next == null) break;
      inRun.add(next);
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

  // Uniqueness: two route posts can never share one DXF pole. The Hungarian
  // guarantees this, but downstream refinement may not; a collided chain
  // still fits span data on uniform streets, so it must hard-demote here.
  const seenNodes = new Set();
  for (const postNum of postNumbers) {
    const node = assignments.get(postNum);
    if (!node) continue;
    if (seenNodes.has(node)) return { ok: false, reason: "collision" };
    seenNodes.add(node);
  }

  const runs = partitionLinearRuns(postNumbers, junctionSet, connections);

  for (let runIdx = 0; runIdx < runs.length; runIdx++) {
    const run = runs[runIdx];
    if (run.length < 2) continue;
    const runStart = run[0];
    const startNode = assignments.get(runStart);
    let startIdx = idxMap.get(startNode);
    let prevArc = null;

    for (const postNum of run) {
      const node = assignments.get(postNum);
      if (!node) {
        return { ok: false, reason: `monotonicity:run${runIdx}` };
      }
      const nodeIdx = idxMap.get(node);
      const arcPos = cableSpanAlongPath(startIdx, nodeIdx, adjacencyGraph, regionPosts);
      if (arcPos == null) {
        // Unreachable from the current chain start: the DXF region cable graph
        // is fragmented (real drawings have gaps between cable polylines), so
        // path distance is undefined across components. That is NOT evidence of
        // a wrong assignment — restart the monotonic chain in the new component
        // instead of failing. (Valmor's correct solve crosses such a gap at
        // post 5.) Cross-component misplacement is still caught by the residual
        // gate's shape sub-score; within-component swaps remain caught here.
        startIdx = nodeIdx;
        prevArc = null;
        continue;
      }
      if (prevArc != null && arcPos < prevArc - monotonicTol) {
        return { ok: false, reason: `monotonicity:run${runIdx}` };
      }
      prevArc = arcPos;
    }
  }

  for (const postNum of postNumbers) {
    // Only validate posts with an AUTHORITATIVE junction claim (D-11:
    // bifurcation-sourced degree). The connAdj fallback degree mixes in noisy
    // generic connection edges, and real DXF region graphs are fragmented —
    // a mid-cable node at a fragment boundary reads degree 1 — so comparing
    // heuristic degrees on both sides fails correct solves (Valmor post 2).
    const auth = authoritativeDegreeByPost?.get(postNum);
    if (!(auth > 0)) continue;
    const node = assignments.get(postNum);
    if (!node) continue;
    const nodeIdx = idxMap.get(node);
    const dxfDegree = (adjacencyGraph.get(nodeIdx) ?? new Set()).size;
    const pdfDegree = resolveAuthoritativeDegree(
      postNum,
      authoritativeDegreeByPost,
      connAdj,
    );
    // One-sided (see WR-02 note in solveGlobalGraphAlignment): the route
    // subgraph's degree is a LOWER bound on the DXF node's region degree —
    // through-poles legitimately carry side cables from other streets. Only a
    // DXF node with fewer arms than the route demands is a wrong assignment.
    if (degreeClass(dxfDegree) < degreeClass(pdfDegree)) {
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
  // The ACCEPT shape score excludes invented-source edges (jumpback-refill,
  // inferred-label): their meters are heuristic refills, not printed labels —
  // a correct solve scores relError ≈ 11 on LC's 20→21 jumpback (29.8 printed
  // across a 380 m numbering jump). The full-residual solverScore above keeps
  // them for downstream confidence tiering.
  const trustedShape = computeResiduals(
    coords,
    (distances ?? []).filter((d) => !INVENTED_DISTANCE_SOURCES.has(d.source)),
  );
  // Acceptance is SHAPE-driven (median relError of solver spans vs printed
  // labels), not anchor-driven. The anchor sub-score measures DWG-vs-PDF
  // disagreement; on routes where the PDF placement itself is deformed
  // (LC: ~80 m page-seam drift) a CORRECT solve inherits the PDF's error as
  // its anchor gap, so any anchor-based veto makes acceptance impossible
  // exactly where the solver is most needed. The wrong-solve risks the
  // anchor term guarded against are covered by: the shape bar below (a
  // one-pole-shifted assignment breaks span lengths), the topology gate
  // (monotonicity + hub degree), the post-1 hard-pin (a rigid offset cannot
  // include the pinned anchor), and the per-route txt-accuracy gates in CI.
  // The full residual (incl. anchor) still flows downstream as solverScore,
  // where the confidence gate uses BOTH sub-scores for tiering — acceptance
  // here never inflates the route's confidence tier.
  const shapeMedian = trustedShape?.medianRelError;
  if (shapeMedian == null || shapeMedian >= SOLVER_SHAPE_ACCEPT) {
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

/** Distance sources INVENTED by heuristics rather than read from a physical
 * label on that span. Their meters can be arbitrarily wrong (LC 20→21
 * jumpback-refill prints 29.8 across a 380 m numbering jump), so the
 * dead-reckoning magnitude prefers the PDF's drawn span for them. */
const INVENTED_DISTANCE_SOURCES = new Set(["jumpback-refill", "inferred-label"]);

function buildDistanceMap(distances) {
  const map = new Map();
  for (const d of distances ?? []) {
    if (d.meters > 0 && !Number.isNaN(d.meters)) {
      const entry = { meters: d.meters, source: d.source ?? null };
      map.set(`${d.from}-${d.to}`, entry);
      map.set(`${d.to}-${d.from}`, entry);
    }
  }
  return map;
}

function getPrintedMeters(distMap, a, b) {
  return distMap.get(`${a}-${b}`)?.meters ?? null;
}

function isInventedDistance(distMap, a, b) {
  const source = distMap.get(`${a}-${b}`)?.source;
  return source != null && INVENTED_DISTANCE_SOURCES.has(source);
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

/** Hop depth assigned to posts predicted from their PDF absolute position
 * (no chain reaches them). The PDF's absolute georeferencing error can be
 * hundreds of meters (LC 21–31 rigid offset), so these need the widest
 * prune window WR-04 can give. */
const PDF_ABSOLUTE_FALLBACK_HOPS = 20;

/** Snap-chain margin: the nearest DXF node must be this much closer than the
 * runner-up before the chain position locks onto it. */
const SNAP_MARGIN = 1.5;

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
  pdfUtmByPost,
  postIndex,
  routeTopologyNeighbors,
}) {
  const postSet = new Set(posts.map((p) => p.number));
  const predicted = new Map([[anchorPostNum, { x: anchorPos.x, y: anchorPos.y }]]);
  const parent = new Map([[anchorPostNum, null]]);
  // Hop depth from the anchor. Dead-reckoning accumulates angular error with
  // each hop, so the prune window is later widened proportionally (WR-04) to
  // avoid pruning the true DXF node on routes that turn.
  const hops = new Map([[anchorPostNum, 0]]);

  const connAdj = buildConnAdj(posts, connections);
  // Augment with DXF-topology route edges (e.g. the real spur entry 7→21):
  // the PDF connection list only links consecutive numbers, so a branch head
  // is otherwise reached through a numbering jump whose distance is invented.
  if (routeTopologyNeighbors?.size) {
    for (const [a, nbs] of routeTopologyNeighbors) {
      if (!postSet.has(a)) continue;
      for (const b of nbs) {
        if (!postSet.has(b) || Math.abs(b - a) <= 1) continue;
        if (!connAdj.has(a)) connAdj.set(a, []);
        if (!connAdj.has(b)) connAdj.set(b, []);
        if (!connAdj.get(a).includes(b)) connAdj.get(a).push(b);
        if (!connAdj.get(b).includes(a)) connAdj.get(b).push(a);
      }
    }
  }

  // Snap-chain: lock the chain position onto a DXF node when one is clearly
  // nearest, so dead-reckoning drift resets to zero at every confident hop
  // instead of accumulating. Ambiguous neighborhoods (junction clusters,
  // parallel streets) are left unsnapped — the prune window still covers them.
  const snapR = Math.max(2 * spanTolM, 10);
  const snapToNode = (pt) => {
    if (!postIndex) return pt;
    const raw = postIndex.search({
      minX: pt.x - snapR * SNAP_MARGIN,
      minY: pt.y - snapR * SNAP_MARGIN,
      maxX: pt.x + snapR * SNAP_MARGIN,
      maxY: pt.y + snapR * SNAP_MARGIN,
    });
    let best = null;
    let bestD = Infinity;
    let secondD = Infinity;
    for (const node of raw) {
      const d = Math.hypot(node.x - pt.x, node.y - pt.y);
      if (d < bestD) {
        secondD = bestD;
        bestD = d;
        best = node;
      } else if (d < secondD) {
        secondD = d;
      }
    }
    if (!best || bestD > snapR) return pt;
    if (secondD < bestD * SNAP_MARGIN) return pt; // ambiguous — do not lock
    return { x: best.x, y: best.y };
  };

  // Uncertainty-weighted Dijkstra (not FIFO BFS): each post is settled along
  // the LOWEST-uncertainty chain from the anchor. A trusted printed hop costs
  // 1; an invented/unlabeled hop costs 1 + d/medianSpan, so a short topology
  // arm (junction→spur head, ~30 m) beats a 400 m numbering-jump edge, and a
  // long trusted chain beats both. FIFO order let the spur's jumpback edge
  // reach the spine BACKWARD before the forward chain arrived (LC 15–20).
  const medianSpanM = Math.max(1, spanTolM / 0.15); // SPAN_TOL_FRAC of medianPDF
  const uncertainty = new Map([[anchorPostNum, 0]]);
  const queue = [{ post: anchorPostNum, u: 0 }];
  const visited = new Set();

  while (queue.length) {
    let bestIdx = 0;
    for (let i = 1; i < queue.length; i++) {
      if (queue[i].u < queue[bestIdx].u) bestIdx = i;
    }
    const { post: current } = queue.splice(bestIdx, 1)[0];
    if (visited.has(current)) continue;
    visited.add(current);
    const curPos = predicted.get(current);
    for (const neighbor of connAdj.get(current) ?? []) {
      if (visited.has(neighbor)) continue;
      const printed = getPrintedMeters(distMap, current, neighbor);

      // Per-hop displacement from the PDF's own drawn geometry: the PDF is
      // calibrated to UTM, so the vector between two posts' PDF positions
      // carries the street's true local bearing (turns included) even when
      // its absolute placement has drifted. Colinear continuation — the old
      // fallback below — assumes straight streets and diverges on real routes.
      const pdfCur = pdfUtmByPost?.get(current);
      const pdfNext = pdfUtmByPost?.get(neighbor);
      let pdfDx = 0;
      let pdfDy = 0;
      let pdfDist = 0;
      if (pdfCur && pdfNext) {
        pdfDx = pdfNext.x - pdfCur.x;
        pdfDy = pdfNext.y - pdfCur.y;
        pdfDist = Math.hypot(pdfDx, pdfDy);
      }

      // Magnitude: the printed label is the most precise signal and — after
      // the DWG-path label repairs (split-span merge, bifurcation revert) —
      // trustworthy wherever it came from a physical label. Fall back to the
      // PDF drawn span only when the label is missing (the chain must not
      // break) or the source is an invented heuristic (jumpback-refill,
      // inferred-label) whose meters can be arbitrarily wrong.
      const trustedPrinted =
        printed != null && !isInventedDistance(distMap, current, neighbor);
      let d = printed;
      if (pdfDist > 0 && !trustedPrinted) {
        d = pdfDist;
      }
      if (d == null) continue;

      const hopCost = trustedPrinted ? 1 : 1 + d / medianSpanM;
      const nextU = (uncertainty.get(current) ?? 0) + hopCost;
      if (nextU >= (uncertainty.get(neighbor) ?? Infinity)) continue;

      let dirX = 1;
      let dirY = 0;

      if (pdfDist > 0) {
        dirX = pdfDx / pdfDist;
        dirY = pdfDy / pdfDist;
      } else if (current === anchorPostNum) {
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

      predicted.set(
        neighbor,
        snapToNode({
          x: curPos.x + dirX * d,
          y: curPos.y + dirY * d,
        }),
      );
      parent.set(neighbor, current);
      // Window growth follows accumulated uncertainty, not raw hop count, so
      // posts past an unlabeled/invented hop get the wider window they need.
      hops.set(neighbor, Math.ceil(nextU));
      uncertainty.set(neighbor, nextU);
      queue.push({ post: neighbor, u: nextU });
    }
  }

  for (const p of posts) {
    if (!predicted.has(p.number)) {
      // No chain reaches this post. The PDF absolute position (with a wide
      // window) is a far better prior than the old anchor-position fallback,
      // which put the prediction at post 1 with the NARROWEST window — a
      // guaranteed coverage miss for every post past a chain break.
      const pdf = pdfUtmByPost?.get(p.number);
      if (pdf) {
        predicted.set(p.number, { x: pdf.x, y: pdf.y });
        hops.set(p.number, PDF_ABSOLUTE_FALLBACK_HOPS);
      } else {
        predicted.set(p.number, { x: anchorPos.x, y: anchorPos.y });
        hops.set(p.number, hops.get(p.number) ?? 0);
      }
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

/**
 * Route graph for the topology gate (D-10 monotonicity runs). The PDF
 * connection list links consecutive numbers even across numbering jumps
 * (LC 20→21 spans 380 m of street; the spur physically hangs off post 7), so
 * partitioning runs over it makes a correct solve look arc-backward. Drop
 * invented-source connections the DXF topology does not corroborate and
 * re-attach any orphaned endpoint through its topology arm.
 */
function buildGateConnections(connections, distMap, routeTopologyNeighbors, postSet) {
  if (!routeTopologyNeighbors?.size) return connections ?? [];
  const conns = [];
  const seen = new Set();
  const keyOf = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const push = (from, to) => {
    const k = keyOf(from, to);
    if (seen.has(k)) return;
    seen.add(k);
    conns.push({ from, to });
  };
  const dropped = [];
  for (const c of connections ?? []) {
    if (!postSet.has(c.from) || !postSet.has(c.to)) continue;
    const nonConsecutive = Math.abs(c.from - c.to) > 1;
    const topoAdj =
      routeTopologyNeighbors.get(c.from)?.has(c.to) ||
      routeTopologyNeighbors.get(c.to)?.has(c.from);
    const hasTrustedMeters =
      getPrintedMeters(distMap, c.from, c.to) != null &&
      !isInventedDistance(distMap, c.from, c.to);
    // Non-consecutive connections are route shortcuts the PDF pass invented
    // (numbering jumps, skip edges with no label at all). Unless the DXF
    // topology corroborates the link or a trusted printed label sits on it,
    // they corrupt the run partition (double-backs, cycles, orphaned tails).
    if (nonConsecutive && !topoAdj && !hasTrustedMeters) {
      dropped.push(c);
      continue;
    }
    if (isInventedDistance(distMap, c.from, c.to) && !topoAdj) {
      dropped.push(c);
      continue;
    }
    push(c.from, c.to);
  }
  // Re-attach via DXF topology arms: an endpoint that lost a jump link gets
  // its real arm instead (LC: dropping 20→21 attaches the spur head as 7→21).
  for (const c of dropped) {
    for (const n of [c.from, c.to]) {
      for (const nb of routeTopologyNeighbors.get(n) ?? []) {
        if (!postSet.has(nb) || Math.abs(nb - n) <= 1) continue;
        push(nb, n);
      }
    }
  }
  return conns;
}

/**
 * Single-source Dijkstra over the DXF region cable graph: arc distance from
 * startIdx to every reachable node. One pass per run replaces O(candidates)
 * point-to-point cableSpanAlongPath calls.
 */
function cableArcsFrom(startIdx, adjacencyGraph, regionPosts) {
  const dist = new Map([[startIdx, 0]]);
  const pq = [{ idx: startIdx, d: 0 }];
  const settled = new Set();
  while (pq.length) {
    let best = 0;
    for (let i = 1; i < pq.length; i++) {
      if (pq[i].d < pq[best].d) best = i;
    }
    const { idx, d } = pq.splice(best, 1)[0];
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
  return dist;
}

/**
 * Per-run Viterbi refinement of the munkres assignment (D-N2-01 precedent).
 *
 * The Hungarian cost is per-post (prediction distance + local span fit), so a
 * systematic prediction drift makes it pick poles shifted down-street — it
 * cannot weigh CHAIN consistency. The Viterbi pass re-assigns each linear run
 * as a whole: transition cost = capped |node span − expected span| (printed
 * label, else PDF drawn span), a no-backtrack constraint along the PDF street
 * bearing, a weak prediction-prior emission, AND the D-10 arc-monotonicity
 * invariant enforced as a hard transition constraint (the same check the
 * post-hoc topology gate applies). The arc constraint is what resolves the
 * LC 9–11 zone: there the printed labels are crossed AND the drawing is
 * drawn out of route order, so labels + drawing agree on a self-consistent
 * WRONG story whose only tell is that it walks BACKWARD along the DXF cable
 * arc. Only the real pole spacing+ordering can arbitrate, and it lives here.
 *
 * Mutates assignmentByPost in place; a run that cannot be chained (empty
 * candidate layer) keeps its munkres assignment.
 */
function refineAssignmentsByViterbi({
  sortedPosts,
  assignmentByPost,
  prunedByPost,
  predicted,
  distMap,
  pdfUtmByPost,
  gateConnections,
  junctionSet,
  adjacencyGraph,
  regionPosts,
  postToIdx,
  spanTolM,
}) {
  const postNumbers = sortedPosts.map((p) => p.number);
  const runs = partitionLinearRuns(postNumbers, junctionSet, gateConnections);
  const monotonicTol = spanTolM ?? 0;

  // Cost of an assignment along a run under the same model the DP optimizes —
  // used to keep the BETTER of munkres-vs-Viterbi per run, so a run whose
  // chain evidence is weak (untrusted entry edges, noise arms) can never make
  // the assignment worse than the Hungarian baseline. An arc-backward chain
  // costs Infinity: it is exactly what the topology gate will demote on, so
  // a monotonic Viterbi chain must always replace it.
  const runCost = (run, nodeOf, arcOf) => {
    let cost = 0;
    let prevArc = arcOf ? arcOf(nodeOf(run[0])) : null;
    for (let i = 1; i < run.length; i++) {
      const a = nodeOf(run[i - 1]);
      const b = nodeOf(run[i]);
      if (!a || !b) return Infinity;
      if (arcOf) {
        const arc = arcOf(b);
        if (arc == null) {
          // Different cable component — the gate restarts its chain here; we
          // drop the comparison baseline rather than fail a correct solve.
          prevArc = null;
        } else {
          if (prevArc != null && arc < prevArc - monotonicTol) return Infinity;
          prevArc = arc;
        }
      }
      const printed = getPrintedMeters(distMap, run[i - 1], run[i]);
      const trusted =
        printed != null && !isInventedDistance(distMap, run[i - 1], run[i]);
      let d = trusted ? printed : null;
      if (d == null) {
        const pdfA = pdfUtmByPost?.get(run[i - 1]);
        const pdfB = pdfUtmByPost?.get(run[i]);
        if (pdfA && pdfB) d = Math.hypot(pdfB.x - pdfA.x, pdfB.y - pdfA.y);
      }
      const span = Math.hypot(b.x - a.x, b.y - a.y);
      if (d != null) cost += Math.min(Math.abs(span - d), VITERBI_SPAN_CAP);
      const pred = predicted.get(run[i]);
      if (pred) {
        cost += VITERBI_EMISSION_W * Math.hypot(b.x - pred.x, b.y - pred.y);
      }
    }
    return cost;
  };

  for (const run of runs) {
    if (run.length < 2) continue;
    const startAssigned = assignmentByPost.get(run[0]);
    if (!startAssigned) continue;
    // Uniqueness frame: nodes held by posts OUTSIDE this run are off-limits —
    // the Hungarian guarantees one-pole-one-post and the refinement must
    // preserve it (per-run DP otherwise re-grabbed spine nodes for the spur:
    // LC-on-Palhoca assigned posts 10+12, 22+24, 28+31 identical nodes).
    const runSet = new Set(run);
    const usedOutsideRun = new Set();
    for (const [pn, node] of assignmentByPost) {
      if (node && !runSet.has(pn)) usedOutsideRun.add(node);
    }
    // Arc positions along the DXF cable graph, measured from this run's
    // start node — the D-10 monotonicity frame.
    const startIdx = postToIdx?.get(startAssigned);
    const arcs =
      startIdx != null && adjacencyGraph && regionPosts
        ? cableArcsFrom(startIdx, adjacencyGraph, regionPosts)
        : null;
    const arcOf = arcs
      ? (node) => {
          if (!node) return null;
          const i = postToIdx.get(node);
          return i == null ? null : (arcs.get(i) ?? null);
        }
      : null;
    // A run with no trusted printed span anywhere has zero chain evidence
    // (e.g. the single-hop artifact arm a crossing fuses into the topology);
    // refining it could only echo noise.
    const hasTrustedEvidence = run.some(
      (n, i) =>
        i > 0 &&
        getPrintedMeters(distMap, run[i - 1], n) != null &&
        !isInventedDistance(distMap, run[i - 1], n),
    );
    if (!hasTrustedEvidence) continue;

    let prevStates = [{ node: startAssigned, cost: 0, back: null }];
    const layers = [prevStates];
    let broken = false;

    for (let i = 1; i < run.length; i++) {
      const postNum = run[i];
      const prevNum = run[i - 1];
      const cands = (prunedByPost.get(postNum) ?? []).filter(
        (n) => !usedOutsideRun.has(n),
      );
      if (!cands.length) {
        broken = true;
        break;
      }
      const printed = getPrintedMeters(distMap, prevNum, postNum);
      const trusted =
        printed != null && !isInventedDistance(distMap, prevNum, postNum);
      let d = trusted ? printed : null;
      let bearing = null;
      const pdfA = pdfUtmByPost?.get(prevNum);
      const pdfB = pdfUtmByPost?.get(postNum);
      if (pdfA && pdfB) {
        const vx = pdfB.x - pdfA.x;
        const vy = pdfB.y - pdfA.y;
        const vd = Math.hypot(vx, vy);
        if (vd > 0) {
          // Constrain direction only when the PDF geometry corroborates the
          // printed span (within 30%). A corrupt drawn position (LC post 11:
          // PDF span 92 m vs printed 18.7 m) yields a bearing that would
          // FORBID the true transition and force the chain onto wrong poles.
          const corroborated =
            d == null || Math.abs(vd - d) <= 0.3 * Math.max(vd, d);
          if (corroborated) bearing = { x: vx / vd, y: vy / vd };
          if (d == null) d = vd;
        }
      }
      const pred = predicted.get(postNum);

      const layer = [];
      for (const node of cands) {
        const arcNode = arcOf ? arcOf(node) : null;
        let best = null;
        for (let s = 0; s < prevStates.length; s++) {
          const ps = prevStates[s];
          const span = Math.hypot(node.x - ps.node.x, node.y - ps.node.y);
          if (span < 0.5) continue; // node reuse within the run
          // D-10 arc-monotonicity as a hard transition constraint: the chain
          // may never walk backward along the DXF cable arc. This is the only
          // signal that rejects a wrong story the labels AND the drawing both
          // tell (LC 9–11). Nodes in another cable component (arc null) are
          // unconstrained, mirroring the gate's chain-restart behavior.
          if (arcNode != null && arcOf) {
            const arcPrev = arcOf(ps.node);
            if (arcPrev != null && arcNode < arcPrev - monotonicTol) continue;
          }
          if (bearing) {
            const dot =
              (node.x - ps.node.x) * bearing.x +
              (node.y - ps.node.y) * bearing.y;
            // No-backtrack along the street; small negative slack tolerates
            // bearing noise from imperfect PDF placement.
            if (dot < -0.2 * span) continue;
          }
          const spanCost =
            d != null ? Math.min(Math.abs(span - d), VITERBI_SPAN_CAP) : 0;
          const total = ps.cost + spanCost;
          if (!best || total < best.total) best = { total, back: s };
        }
        if (!best) continue;
        const emit = pred
          ? VITERBI_EMISSION_W * Math.hypot(node.x - pred.x, node.y - pred.y)
          : 0;
        layer.push({ node, cost: best.total + emit, back: best.back });
      }
      if (!layer.length) {
        broken = true;
        break;
      }
      layers.push(layer);
      prevStates = layer;
    }

    if (broken || layers.length !== run.length) continue;

    let idx = 0;
    for (let s = 1; s < prevStates.length; s++) {
      if (prevStates[s].cost < prevStates[idx].cost) idx = s;
    }
    const viterbiPath = new Map([[run[0], startAssigned]]);
    for (let i = layers.length - 1; i >= 1; i--) {
      const st = layers[i][idx];
      viterbiPath.set(run[i], st.node);
      idx = st.back;
    }

    // The DP's span<0.5 check only blocks CONSECUTIVE reuse; reject any path
    // that lands two run posts on one node (one pole = one post).
    if (new Set(viterbiPath.values()).size !== viterbiPath.size) continue;

    const currentCost = runCost(run, (n) => assignmentByPost.get(n), arcOf);
    const viterbiCost = runCost(run, (n) => viterbiPath.get(n), arcOf);
    if (viterbiCost >= currentCost) continue;
    for (const [n, node] of viterbiPath) assignmentByPost.set(n, node);
  }
}

/** Junctions per DXF topology: cable degree ≥3 with a non-consecutive arm. */
function deriveJunctionsFromTopology(routeTopologyNeighbors, postSet) {
  const out = new Set();
  for (const [n, nbs] of routeTopologyNeighbors ?? []) {
    if (!postSet.has(n)) continue;
    const inRoute = [...nbs].filter((b) => postSet.has(b));
    if (inRoute.length >= 3 && inRoute.some((b) => Math.abs(b - n) > 1)) {
      out.add(n);
    }
  }
  return out;
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
  routeTopologyNeighbors,
  testAssignments,
  _testAssignments,
  debugSink,
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

  // PDF post positions in UTM — the prediction prior for dead-reckoning
  // bearings and for posts unreachable through the printed-distance chain.
  const pdfUtmByPost = new Map();
  for (const [num, gps] of gpsByPostNumber ?? new Map()) {
    if (gps?.lat == null || gps?.lon == null) continue;
    const u = latLonToUtm(gps.lat, gps.lon);
    pdfUtmByPost.set(num, { x: u.easting, y: u.northing });
  }

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
    pdfUtmByPost,
    postIndex: tree,
    routeTopologyNeighbors,
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

  if (debugSink) {
    Object.assign(debugSink, {
      tolerances,
      anchorPostNum,
      anchorBest,
      anchorDist,
      predicted,
      hops,
      prunedByPost,
      sortedPosts,
      columnCount: columnNodes.length,
    });
  }

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

  // NOTE: 08-REVIEW WR-02 added a degree-class comparison here (PDF post-1
  // connection degree vs DXF anchor node degree) before hard-pinning. It was
  // REMOVED (2026-06-10): degree is unreliable in both directions at the route
  // boundary — the PDF route subgraph undercounts the pole's real arms (and can
  // overcount via label-graph noise edges at post 1, e.g. LC's 1→3), while the
  // clipped DXF region undercounts arms at the clip boundary where route starts
  // live (LC's anchor is a degree-1 tip in the region extract). In practice the
  // check demoted the solver on every real route. The wrong-spur-head risk
  // WR-02 targeted is bounded by the anchorDist <= DEFAULT_TOLERANCE_M
  // requirement above (the anchor is the user-provided post-1 GPS, typically
  // sub-meter from the true node) and by the D-05 accept bar downstream
  // (residual gate + topology), which is the designed protection against a
  // wrong pin poisoning the output.
  if (anchorRow >= 0 && anchorCol != null) {
    costMatrix[anchorRow][anchorCol] = -Infinity;
  }

  const munkresAssignments = munkres(costMatrix);
  const assignmentByPost = forcedAssignments ?? new Map();
  const assignedRows = new Set();

  const postSet = new Set(sortedPosts.map((p) => p.number));
  const gateConnections = buildGateConnections(
    connections,
    distMap,
    routeTopologyNeighbors,
    postSet,
  );
  const junctionSet = normalizeJunctionSet(
    junctions ?? deriveJunctionsFromTopology(routeTopologyNeighbors, postSet),
  );
  if (debugSink) {
    debugSink.gate = {
      junctions: [...junctionSet].sort((a, b) => a - b),
      runs: partitionLinearRuns(
        sortedPosts.map((p) => p.number),
        junctionSet,
        gateConnections,
      ),
    };
  }

  if (!forcedAssignments) {
    for (const [y, x] of munkresAssignments) {
      assignedRows.add(y);
      // Detect uncovered assignments structurally (WR-03): a cell is a real
      // candidate iff realCosts[y][x] != null. The forced anchor cell
      // (cost === -Infinity) is real by construction. This removes the fragile
      // magnitude check (sentinel * 0.999) and its SENTINEL_MULT coupling, which
      // could collide with a legitimately high real cost.
      const isForcedAnchor = y === anchorRow && x === anchorCol;
      if (!isForcedAnchor && realCosts[y][x] == null) {
        if (debugSink) {
          debugSink.coverageFailure = {
            kind: "sentinel-assignment",
            post: sortedPosts[y].number,
          };
        }
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

    if (assignedRows.size === nRows) {
      refineAssignmentsByViterbi({
        sortedPosts,
        assignmentByPost,
        prunedByPost,
        predicted,
        distMap,
        pdfUtmByPost,
        gateConnections,
        junctionSet,
        adjacencyGraph: graph,
        regionPosts,
        postToIdx: postToIndex,
        spanTolM,
      });
    }

    if (assignedRows.size < nRows) {
      if (debugSink) {
        debugSink.coverageFailure = {
          kind: "unassigned-rows",
          posts: sortedPosts
            .filter((_, ri) => !assignedRows.has(ri))
            .map((p) => p.number),
        };
      }
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
    connections: gateConnections,
    junctions: junctionSet,
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
