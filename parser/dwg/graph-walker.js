import {
  buildAdjacencyGraph,
  buildPostIndex,
  DEFAULT_TOLERANCE_M,
} from "./region-pairing.js";
import { latLonToUtm, utmToLatLon } from "../geo/utm-calibrator.js";

const SPAN_TOL_FLOOR_M = 2;
const SPAN_TOL_CEIL_M = 10;
const SPAN_TOL_FRAC = 0.15;

function spanToleranceFor(labelM) {
  return Math.min(
    SPAN_TOL_CEIL_M,
    Math.max(SPAN_TOL_FLOOR_M, SPAN_TOL_FRAC * labelM),
  );
}

function buildDistanceMap(distances) {
  const m = new Map();
  for (const d of distances ?? []) {
    if (!d) continue;
    if (typeof d.from !== "number" || typeof d.to !== "number") continue;
    if (typeof d.meters !== "number") continue;
    m.set(`${d.from}->${d.to}`, d.meters);
  }
  return m;
}

function buildConnectionMap(connections) {
  const m = new Map();
  for (const c of connections ?? []) {
    if (!c) continue;
    if (typeof c.from !== "number" || typeof c.to !== "number") continue;
    m.set(`${c.from}->${c.to}`, { gap: Boolean(c.gap) });
  }
  return m;
}

function buildPostByNumber(posts) {
  const m = new Map();
  for (const p of posts ?? []) {
    if (p && typeof p.number === "number") m.set(p.number, p);
  }
  return m;
}

function getDistLabel(distMap, fromNum, toNum) {
  return (
    distMap.get(`${fromNum}->${toNum}`) ??
    distMap.get(`${toNum}->${fromNum}`) ??
    null
  );
}

function unclaimedCableNeighbors(idx, adjacencyGraph, claimed) {
  const neighbors = adjacencyGraph.get(idx);
  if (!neighbors) return [];
  const result = [];
  for (const n of neighbors) {
    if (!claimed.has(n)) result.push(n);
  }
  return result;
}

function junctionSetFromVisited(visitedIdxArr, adjacencyGraph) {
  const result = [];
  for (const i of visitedIdxArr) {
    const neighbors = adjacencyGraph.get(i);
    if (neighbors && neighbors.size > 2) result.push(i);
  }
  return result;
}

function lastVisitedJunction(visitedIdxArr, adjacencyGraph) {
  for (let i = visitedIdxArr.length - 1; i >= 0; i--) {
    const idx = visitedIdxArr[i];
    const neighbors = adjacencyGraph.get(idx);
    if (neighbors && neighbors.size > 2) return idx;
  }
  return null;
}

function jumpbackCandidates(junctionSet, adjacencyGraph, claimed) {
  const seen = new Set();
  const result = [];
  for (const j of junctionSet) {
    const neighbors = adjacencyGraph.get(j);
    if (!neighbors) continue;
    for (const n of neighbors) {
      if (!claimed.has(n) && !seen.has(n)) {
        seen.add(n);
        result.push(n);
      }
    }
  }
  return result;
}

function spanBetween(regionPosts, fromIdx, toIdx) {
  const a = regionPosts[fromIdx];
  const b = regionPosts[toIdx];
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function debugBfsSpanCandidates({
  fromIdx,
  graph,
  claimed,
  regionPosts,
  maxHops = 6,
  maxStates = 5000,
}) {
  const q = [{ at: fromIdx, prev: -1, hops: 0, span: 0 }];
  let qi = 0;
  let states = 0;
  const out = [];

  while (qi < q.length && states < maxStates) {
    const cur = q[qi++];
    states++;
    if (cur.hops >= maxHops) continue;
    const neigh = graph.get(cur.at);
    if (!neigh) continue;
    for (const nxt of neigh) {
      if (nxt === cur.prev) continue;
      if (claimed.has(nxt)) continue;
      const edge = spanBetween(regionPosts, cur.at, nxt);
      const nextSpan = cur.span + edge;
      const nextHops = cur.hops + 1;
      out.push({ endpoint: nxt, hops: nextHops, totalSpan: nextSpan });
      q.push({ at: nxt, prev: cur.at, hops: nextHops, span: nextSpan });
    }
  }
  return out;
}

/**
 * Private replica of region-pairing's buildAdjacencyGraph with a tunable
 * snap tolerance. The frozen region-pairing module pins ADJACENCY_SNAP_M=3,
 * which fragments the cable graph at junctions whose nearest INSERT sits
 * more than 3m away (e.g. siriu.dxf has a 4-edge junction 6.86m off-INSERT).
 * Graph-walker needs a richer graph for navigation, so we rebuild it here
 * with a larger snap.
 */
function nearestRegionPostWithin(posts, x, y, tol) {
  let bestIdx = -1;
  let bestD = Infinity;
  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= tol && d < bestD) {
      bestD = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function buildRichAdjacency(regionPosts, cableEdges, snapTol) {
  const adjacency = new Map();
  if (!Array.isArray(regionPosts) || regionPosts.length === 0) return adjacency;

  const ensure = (idx) => {
    let s = adjacency.get(idx);
    if (!s) {
      s = new Set();
      adjacency.set(idx, s);
    }
    return s;
  };

  for (const e of cableEdges ?? []) {
    const a = e?.a;
    const b = e?.b;
    if (!a || !b) continue;
    if (typeof a.x !== "number" || typeof a.y !== "number") continue;
    if (typeof b.x !== "number" || typeof b.y !== "number") continue;

    const iA = nearestRegionPostWithin(regionPosts, a.x, a.y, snapTol);
    const iB = nearestRegionPostWithin(regionPosts, b.x, b.y, snapTol);
    if (iA < 0 || iB < 0 || iA === iB) continue;
    ensure(iA).add(iB);
    ensure(iB).add(iA);
  }

  return adjacency;
}

function unionAdjacency(a, b) {
  /** @type {Map<number, Set<number>>} */
  const out = new Map();
  const ensure = (idx) => {
    let s = out.get(idx);
    if (!s) {
      s = new Set();
      out.set(idx, s);
    }
    return s;
  };
  for (const src of [a, b]) {
    for (const [k, set] of src ?? []) {
      const s = ensure(k);
      for (const v of set) s.add(v);
    }
  }
  return out;
}

/**
 * DFS up to maxHops intermediate degree-2 nodes from fromIdx looking for an
 * endpoint INSERT whose accumulated cable-span best matches labelM.
 * Returns { endpoint, intermediates, totalSpan, delta } or null if no
 * candidate path falls within tol.
 */
function findMultiHopByLabel({
  fromIdx,
  labelM,
  tol,
  richGraph,
  claimed,
  regionPosts,
  maxHops,
}) {
  let best = null;

  // Traversal rule: at each step we may step into any unclaimed neighbor.
  // The endpoint of a path is the unclaimed neighbor reached at that step;
  // its delta vs labelM is the score. We may continue deeper through that
  // node as long as we still have hops remaining. We DO NOT require
  // intermediates to be degree-2 — real DWG data has junctions (degree>2)
  // sitting between numbered posts (the next numbered post may sit on the
  // far side of a junction whose INSERT isn't itself a numbered post).
  // The depth cap (maxHops) is what prevents combinatorial explosion.
  //
  // Scoring: prefer (a) shorter intermediate chains, (b) endpoints whose
  // degree allows forward continuation (degree >= 2 — numbered posts live
  // on the main backbone, not on degree-1 stub branches), and only then
  // (c) lower delta. This avoids picking a dead-end-stub chain like
  // junction → stub-1 over a backbone path like junction → backbone-1.
  const scoreBetter = (a, b) => {
    if (!b) return true;
    // Prefer endpoint with degree >= 2 (forward progression possible).
    const aDeg = richGraph.get(a.endpoint)?.size ?? 0;
    const bDeg = richGraph.get(b.endpoint)?.size ?? 0;
    const aBackbone = aDeg >= 2 ? 1 : 0;
    const bBackbone = bDeg >= 2 ? 1 : 0;
    if (aBackbone !== bBackbone) return aBackbone > bBackbone;
    // Prefer shorter intermediate chain.
    if (a.intermediates.length !== b.intermediates.length) {
      return a.intermediates.length < b.intermediates.length;
    }
    // Finally, prefer lower delta.
    return a.delta < b.delta;
  };

  const visit = (current, prev, accumSpan, intermediates) => {
    const neighbors = richGraph.get(current);
    if (!neighbors) return;
    for (const next of neighbors) {
      if (next === prev) continue;
      if (claimed.has(next)) continue;
      if (intermediates.includes(next)) continue; // avoid loops within a path
      const span = spanBetween(regionPosts, current, next);
      const total = accumSpan + span;
      const delta = Math.abs(total - labelM);
      // Candidate endpoint: any unclaimed neighbor at any depth >= 1.
      if (delta <= tol) {
        const candidate = {
          endpoint: next,
          intermediates: intermediates.slice(),
          totalSpan: total,
          delta,
        };
        if (scoreBetter(candidate, best)) best = candidate;
      }
      // Continue DFS if we still have hops budget.
      if (intermediates.length < maxHops) {
        intermediates.push(next);
        visit(next, current, total, intermediates);
        intermediates.pop();
      }
    }
  };

  visit(fromIdx, -1, 0, []);
  return best;
}

export function pairPostsByGraphWalk({
  posts,
  distances,
  connections,
  startLat,
  startLon,
  region,
  postIndex,
  adjacencyGraph,
  warnings,
  gpsByPostNumber: _gpsByPostNumber,
}) {
  const warn = (w) => {
    if (Array.isArray(warnings)) warnings.push(w);
  };

  if (!Array.isArray(posts) || posts.length === 0) {
    return { ok: true, coords: [] };
  }

  const regionPosts = region?.posts ?? [];
  const zoneExpected = region?.crs?.zone ?? 22;
  const tree = postIndex ?? buildPostIndex(regionPosts);
  // Build a richer adjacency graph (snap=8m) than the frozen region-pairing
  // default (3m). The frozen module's snap is too tight and drops cable
  // edges at junctions whose nearest INSERT sits >3m away — that fragments
  // the graph and breaks navigation. We replace the passed-in adjacencyGraph
  // for walk navigation, but leave region-pairing.js itself untouched.
  // The original `adjacencyGraph` argument is intentionally ignored here.
  void adjacencyGraph;
  void buildAdjacencyGraph;
  // Two-tier union: 8m captures most edges without spurious merges; 14m recovers
  // junctions whose nearest INSERT is far from the cable vertex (seen in siriu).
  const graph8 = buildRichAdjacency(regionPosts, region?.cableEdges ?? [], 8);
  const graph14 = buildRichAdjacency(regionPosts, region?.cableEdges ?? [], 14);
  const graph = unionAdjacency(graph8, graph14);

  const postToIndex = new Map();
  for (let i = 0; i < regionPosts.length; i++)
    postToIndex.set(regionPosts[i], i);

  // Step 1 — Anchor poste 1
  const anchorUtm = latLonToUtm(startLat, startLon);
  if (anchorUtm.zone !== zoneExpected) {
    warn({
      kind: "dwg-zone-mismatch",
      expected: zoneExpected,
      got: anchorUtm.zone,
    });
    return {
      ok: false,
      failedAt: posts[0].number,
      nearestDistance: null,
      ...(process.env.GW_RETURN_IDX === "1"
        ? { idxByPostNumber: Object.fromEntries(idxByNum) }
        : {}),
    };
  }

  const anchorCandidates = tree.search({
    minX: anchorUtm.easting - DEFAULT_TOLERANCE_M,
    minY: anchorUtm.northing - DEFAULT_TOLERANCE_M,
    maxX: anchorUtm.easting + DEFAULT_TOLERANCE_M,
    maxY: anchorUtm.northing + DEFAULT_TOLERANCE_M,
  });

  if (!anchorCandidates.length) {
    warn({
      kind: "dwg-graph-walk-fail",
      at_post: posts[0].number,
      reason: "no-anchor",
    });
    return {
      ok: false,
      failedAt: posts[0].number,
      nearestDistance: null,
      ...(process.env.GW_RETURN_IDX === "1"
        ? { idxByPostNumber: Object.fromEntries(idxByNum) }
        : {}),
    };
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
    warn({
      kind: "dwg-graph-walk-fail",
      at_post: posts[0].number,
      reason: "no-anchor",
    });
    return {
      ok: false,
      failedAt: posts[0].number,
      nearestDistance: Number.isFinite(anchorDist) ? anchorDist : null,
      ...(process.env.GW_RETURN_IDX === "1"
        ? { idxByPostNumber: Object.fromEntries(idxByNum) }
        : {}),
    };
  }

  const anchorIdx = postToIndex.get(anchorBest);
  const claimed = new Set([anchorIdx]);
  const dwgByNum = new Map([[posts[0].number, anchorBest]]);
  const idxByNum = new Map([[posts[0].number, anchorIdx]]);
  const visitedIdx = [anchorIdx];
  const visitedPostNums = [posts[0].number];

  const buildPartialCoords = () => {
    const coords = [];
    for (const p of posts) {
      const dwg = dwgByNum.get(p.number);
      if (!dwg) break;
      const { lat, lon } = utmToLatLon(dwg.x, dwg.y, zoneExpected);
      coords.push({
        postNumber: p.number,
        lat,
        lon,
        source: "dwg",
        dwg_block: dwg.block,
      });
    }
    return coords;
  };

  // Step 2 — Pre-compute lookups
  const distMap = buildDistanceMap(distances);
  const connMap = buildConnectionMap(connections);
  buildPostByNumber(posts); // validate; result unused in graph-walk

  // Step 3 — Walk N → N+1
  for (let i = 0; i < posts.length - 1; i++) {
    const curPost = posts[i];
    const nextPost = posts[i + 1];
    const fromNum = curPost.number;
    const toNum = nextPost.number;

    const conn =
      connMap.get(`${fromNum}->${toNum}`) ??
      connMap.get(`${toNum}->${fromNum}`);
    if (conn == null) {
      warn({
        kind: "dwg-graph-walk-fail",
        at_post: toNum,
        reason: "no-connection",
      });
      return {
        ok: false,
        failedAt: toNum,
        nearestDistance: null,
        ...(process.env.GW_RETURN_PARTIAL === "1"
          ? { partialCoords: buildPartialCoords() }
          : {}),
        ...(process.env.GW_RETURN_IDX === "1"
          ? { idxByPostNumber: Object.fromEntries(idxByNum) }
          : {}),
      };
    }

    const labelM = getDistLabel(distMap, fromNum, toNum);
    const fromDwg = dwgByNum.get(fromNum);
    const fromIdx = postToIndex.get(fromDwg);

    let chosenIdx;
    let chainIntermediates = null;
    // Track the best direct-neighbor span if Case A is attempted; used for
    // tolerance-exceeded warnings when no path matches.
    let caseADirectBestSpan = null;
    let caseADirectBestIdx = null;
    let caseADirectBestDelta = null;
    let caseAAttempted = false;
    let caseAStuckNoNeighbors = false;

    // === Case A — cable-adjacent walk (direct + multi-hop) ===
    // The rich graph (snap=8) reveals many cable paths that the input's
    // gap-flag (computed from the frozen snap=3 graph) miscategorized as
    // "gap". So we ALWAYS try Case A first, regardless of conn.gap. If it
    // can't find a match within tolerance, fall back to Case B (only when
    // conn.gap is set, for genuine cross-page gaps).
    {
      caseAAttempted = true;
      const neighbors = unclaimedCableNeighbors(fromIdx, graph, claimed);
      if (neighbors.length === 0) caseAStuckNoNeighbors = true;

      if (neighbors.length === 1 && labelM == null) {
        chosenIdx = neighbors[0];
      } else if (labelM != null) {
        const tol = spanToleranceFor(labelM);
        // In Siriu, 9→10 is a “return to main route” branch jump with label ≈137m.
        // Treat large gap-labeled edges as jumpbacks: Case A can pick a far direct
        // neighbor that matches the chord span but stays on the wrong branch.
        const LARGE_GAP_LABEL_M = 100;
        const forceJumpback = Boolean(conn.gap) && labelM >= LARGE_GAP_LABEL_M;

        // Branch return helper: if we have a non-consecutive label from a previously
        // visited post to the target (e.g. 5→10), try to place the target by that label
        // before trusting the consecutive edge label (e.g. 9→10).
        //
        // Note: this intentionally does NOT require conn.gap because the upstream gap flag
        // can be wrong (snap-3 artifacts), but the non-consecutive label is an explicit hint.
        if (!forceJumpback) {
          let hintOriginNumForHop = null;
          for (let k = visitedPostNums.length - 1; k >= 0; k--) {
            const vNum = visitedPostNums[k];
            if (vNum === fromNum || vNum === toNum) continue;
            if (idxByNum.get(vNum) == null) continue;
            if (getDistLabel(distMap, vNum, toNum) != null) {
              hintOriginNumForHop = vNum;
              break;
            }
          }
          if (hintOriginNumForHop != null) {
            const hintOriginIdxForHop = idxByNum.get(hintOriginNumForHop);
            const hintLabelForHop = getDistLabel(distMap, hintOriginNumForHop, toNum);
            if (
              hintOriginIdxForHop != null &&
              hintLabelForHop != null &&
              hintLabelForHop > 0
            ) {
              const hintTolForHop = spanToleranceFor(hintLabelForHop);
              const hop = findMultiHopByLabel({
                fromIdx: hintOriginIdxForHop,
                labelM: hintLabelForHop,
                tol: Math.max(hintTolForHop, 10, 0.35 * hintLabelForHop),
                richGraph: graph,
                claimed,
                regionPosts,
                maxHops: 6,
              });
              if (hop) {
                chosenIdx = hop.endpoint;
                chainIntermediates = hop.intermediates;
              }
            }
          }
        }

        if (chosenIdx !== undefined) {
          // Hint-based placement succeeded; skip remaining Case A selection.
        } else {
        // Direct-neighbor span match, with a 1-hop lookahead to avoid dead ends.
        // A too-aggressive adjacency union can introduce “leaf” candidates whose span
        // matches labelM but cannot continue to the next post (degree 0/1 after claiming).
        const nextNextPost = posts[i + 2];
        const nextLabel =
          nextNextPost != null
            ? (distMap.get(`${toNum}->${nextNextPost.number}`) ??
              distMap.get(`${nextNextPost.number}->${toNum}`))
            : null;

        /** @type {Array<{ idx: number, span: number, delta: number, deg: number, nextDelta: number|null }>} */
        const direct = [];

        // If there is a non-consecutive Distância_Poste label from any already-visited post
        // directly to the target post (e.g. 5→10), use it to bias the endpoint selection.
        // This helps branch returns: a parallel segment can rejoin the spine and the
        // consecutive label (9→10) may be noisy/ambiguous, while (5→10) anchors the re-entry.
        let hintOriginNum = null;
        for (let k = visitedPostNums.length - 1; k >= 0; k--) {
          const vNum = visitedPostNums[k];
          if (vNum === fromNum || vNum === toNum) continue;
          if (getDistLabel(distMap, vNum, toNum) != null && idxByNum.get(vNum) != null) {
            hintOriginNum = vNum;
            break;
          }
        }
        const hintOriginIdx = hintOriginNum != null ? idxByNum.get(hintOriginNum) : null;
        const hintLabelM =
          hintOriginNum != null ? getDistLabel(distMap, hintOriginNum, toNum) : null;
        const hintTol =
          hintLabelM != null && hintLabelM > 0 ? spanToleranceFor(hintLabelM) : null;

        for (const nIdx of neighbors) {
          const span = spanBetween(regionPosts, fromIdx, nIdx);
          const delta = Math.abs(span - labelM);
          const deg = graph.get(nIdx)?.size ?? 0;
          let nextDelta = null;
          if (nextLabel != null) {
            // Compute best next-step span delta from this candidate (excluding stepping back).
            let best = Infinity;
            for (const nn of unclaimedCableNeighbors(
              nIdx,
              graph,
              new Set([...claimed, nIdx]),
            )) {
              if (nn === fromIdx) continue;
              const s2 = spanBetween(regionPosts, nIdx, nn);
              const d2 = Math.abs(s2 - nextLabel);
              if (d2 < best) best = d2;
            }
            if (Number.isFinite(best)) nextDelta = best;
          }
          let hintDelta = null;
          if (
            hintOriginIdx != null &&
            hintLabelM != null &&
            hintLabelM > 0 &&
            hintTol != null &&
            Number.isFinite(hintTol)
          ) {
            const hSpan = spanBetween(regionPosts, hintOriginIdx, nIdx);
            hintDelta = Math.abs(hSpan - hintLabelM);
          }
          direct.push({ idx: nIdx, span, delta, deg, nextDelta, hintDelta });
        }

        // Track best raw span for diagnostics.
        if (direct.length) {
          direct.sort((a, b) => a.delta - b.delta);
          caseADirectBestSpan = direct[0].span;
          caseADirectBestIdx = direct[0].idx;
          caseADirectBestDelta = direct[0].delta;
        }

        const viable = direct.filter((c) => c.delta <= tol);
        let directBestIdx = -1;
        let directBestDelta = Infinity;
        let directBestSpan = null;
        /** @type {number|null} */
        let directBestNextDelta = null;
        /** @type {number} */
        let directBestDeg = 0;
        if (viable.length) {
          viable.sort((a, b) => {
            // When available, prefer endpoints consistent with an existing non-consecutive
            // label from a visited spine post (e.g. 5→10).
            if (a.hintDelta != null && b.hintDelta != null && a.hintDelta !== b.hintDelta) {
              // Strongly prefer hint-consistent candidates within tolerance.
              const aOk = hintTol != null ? a.hintDelta <= hintTol : false;
              const bOk = hintTol != null ? b.hintDelta <= hintTol : false;
              if (aOk !== bOk) return aOk ? -1 : 1;
              return a.hintDelta - b.hintDelta;
            }
            if (a.hintDelta != null && b.hintDelta == null) return -1;
            if (a.hintDelta == null && b.hintDelta != null) return 1;

            // Prefer candidates that can continue (degree >= 2) and that match nextLabel.
            const aCan = a.deg >= 2 ? 1 : 0;
            const bCan = b.deg >= 2 ? 1 : 0;
            if (aCan !== bCan) return bCan - aCan;
            if (
              a.nextDelta != null &&
              b.nextDelta != null &&
              a.nextDelta !== b.nextDelta
            ) {
              return a.nextDelta - b.nextDelta;
            }
            if (a.delta !== b.delta) return a.delta - b.delta;
            return a.idx - b.idx;
          });
          directBestIdx = viable[0].idx;
          directBestDelta = viable[0].delta;
          directBestSpan = viable[0].span;
          directBestNextDelta = viable[0].nextDelta ?? null;
          directBestDeg = viable[0].deg ?? 0;
        }

        // Multi-hop fallback eligibility:
        //  - Always for non-gap edges.
        //  - For gap edges only when labelM is "small" (< 100m): such
        //    "gaps" are usually snap-3 artifacts from the frozen
        //    adjacency, not true cross-page jumps. True gaps have labels
        //    >= 100m and should defer to Case B's junction jumpback.
        const multiHopAllowed = !conn.gap || labelM < LARGE_GAP_LABEL_M;

        const directIsDeadEnd =
          directBestIdx >= 0 &&
          (directBestDeg === 0 ||
            (nextLabel != null &&
              (directBestNextDelta == null ||
                !Number.isFinite(directBestNextDelta))));

        if (
          !forceJumpback &&
          directBestIdx >= 0 &&
          directBestDelta <= tol &&
          !directIsDeadEnd
        ) {
          chosenIdx = directBestIdx;
        } else if (multiHopAllowed) {
          // DFS up to K=2 intermediate hops in the rich graph. The
          // endpoint INSERT plus all intermediate nodes along the chosen
          // chain are claimed.
          const multiTol = Math.max(tol, 10, 0.35 * labelM);
          const hop = findMultiHopByLabel({
            fromIdx,
            labelM,
            tol: multiTol,
            richGraph: graph,
            claimed,
            regionPosts,
            maxHops: neighbors.length <= 1 ? 6 : neighbors.length <= 2 ? 4 : 2,
          });
          if (hop) {
            chosenIdx = hop.endpoint;
            chainIntermediates = hop.intermediates;
          }
          // If no multi-hop found but we *did* have a direct span match, accept it as last resort
          // (even if it looks like a dead end) — otherwise we’d fail earlier than necessary.
          if (
            !forceJumpback &&
            chosenIdx === undefined &&
            directBestIdx >= 0 &&
            directBestDelta <= tol
          ) {
            chosenIdx = directBestIdx;
          }
        }
        // else: chosenIdx stays undefined — for gap edges fall through to
        // Case B; for non-gap fall to tolerance-exceeded warning.
        }
      } else if (neighbors.length === 0) {
        // No direct neighbor and no label — Case A can't proceed.
      } else {
        // neighbors.length > 1 and labelM == null — ambiguous direct walk;
        // let Case B try (it does jumpback by 1-hop lookahead).
      }
    }

    // === Case B — jumpback via junction re-entry ===
    // Only run when Case A failed AND the input flagged this as a gap.
    // Additionally, when the rich graph has no unclaimed neighbors from the current node,
    // we must treat it like a gap even if the upstream (snap=3) adjacency said otherwise.
    // Also run when the PDF provides a direct non-consecutive label from some already-visited
    // post to the target post (e.g. 5→10): this often indicates a branch return-to-spine.
    let hasHintJumpback = false;
    if (chosenIdx === undefined) {
      for (let k = visitedPostNums.length - 1; k >= 0; k--) {
        const vNum = visitedPostNums[k];
        if (vNum === fromNum || vNum === toNum) continue;
        if (idxByNum.get(vNum) == null) continue;
        if (getDistLabel(distMap, vNum, toNum) != null) {
          hasHintJumpback = true;
          break;
        }
      }
    }

    if (chosenIdx === undefined && (conn.gap || caseAStuckNoNeighbors || hasHintJumpback)) {
      // Prefer a numbering-hint origin: most recent visited post that has an explicit
      // Distância_Poste label directly to the target post (e.g. 5→10).
      let hintOriginNum = null;
      for (let k = visitedPostNums.length - 1; k >= 0; k--) {
        const vNum = visitedPostNums[k];
        if (vNum === toNum) continue;
        if (getDistLabel(distMap, vNum, toNum) != null) {
          hintOriginNum = vNum;
          break;
        }
      }

      if (hintOriginNum != null) {
        const hintOriginIdx = idxByNum.get(hintOriginNum);
        const hintLabelM = getDistLabel(distMap, hintOriginNum, toNum);
        if (hintOriginIdx != null && hintLabelM != null && hintLabelM > 0) {
          const hintTol = spanToleranceFor(hintLabelM);
          const hop = findMultiHopByLabel({
            fromIdx: hintOriginIdx,
            labelM: hintLabelM,
            tol: Math.max(hintTol, 10, 0.35 * hintLabelM),
            richGraph: graph,
            claimed,
            regionPosts,
            maxHops: 6,
          });
          if (hop) {
            chosenIdx = hop.endpoint;
            chainIntermediates = hop.intermediates;
          }
        }
      }

      // Use the most recent junction on the walked path (branch return), not *all* junctions.
      // Using all junctions causes spurious “jump” options far earlier in the route.
      const lastJ = lastVisitedJunction(visitedIdx, graph);
      const junctions =
        lastJ != null ? [lastJ] : junctionSetFromVisited(visitedIdx, graph);
      const candidates = jumpbackCandidates(junctions, graph, claimed);

      if (candidates.length === 0) {
        // fall through to common failure handling below
      } else if (candidates.length === 1) {
        chosenIdx = candidates[0];
      } else {
        // Tie-break by 1-hop look-ahead
        const nextNextPost = posts[i + 2];
        if (!nextNextPost) {
          warn({
            kind: "dwg-graph-walk-tiebreak",
            at_post: toNum,
            reason: "lookahead-unavailable",
            candidates: candidates.length,
          });
          let bestCount = Infinity;
          let bestC = candidates[0];
          for (const c of candidates) {
            const count = unclaimedCableNeighbors(c, graph, claimed).length;
            if (count > 0 && count < bestCount) {
              bestCount = count;
              bestC = c;
            } else if (count === bestCount && c < bestC) {
              bestC = c;
            }
          }
          chosenIdx = bestC;
        } else {
          const lookaheadLabel = getDistLabel(
            distMap,
            toNum,
            nextNextPost.number,
          );
          if (lookaheadLabel != null) {
            let bestC = -1;
            let bestDelta = Infinity;
            for (const c of candidates) {
              const cNeighbors = unclaimedCableNeighbors(c, graph, claimed);
              for (const n of cNeighbors) {
                const span = spanBetween(regionPosts, c, n);
                const delta = Math.abs(span - lookaheadLabel);
                if (delta < bestDelta) {
                  bestDelta = delta;
                  bestC = c;
                }
              }
            }
            if (bestC !== -1) chosenIdx = bestC;
          }
        }
      }
    }

    // Recovery: if there is exactly one unclaimed neighbor but its span mismatches the
    // sequential label (common at bifurcations), force progress instead of failing.
    if (chosenIdx === undefined && caseADirectBestIdx != null && labelM != null) {
      const neighbors = unclaimedCableNeighbors(fromIdx, graph, claimed);
      if (neighbors.length === 1 && neighbors[0] === caseADirectBestIdx) {
        const span = caseADirectBestSpan;
        if (span != null && labelM > 0) {
          const ratio = span / labelM;
          if (ratio <= 2.5) {
            chosenIdx = caseADirectBestIdx;
            warn({
              kind: "dwg-tolerance-relaxed",
              at_post: toNum,
              base_tol_m: spanToleranceFor(labelM),
              tol_m: spanToleranceFor(labelM),
              picked_distance_m: span,
              note: "forced-single-neighbor",
              label_m: labelM,
              delta_m: caseADirectBestDelta,
            });
          }
        }
      }
    }

    // Final failure handling if neither case found a chosenIdx
    if (chosenIdx === undefined) {
      if (process.env.GW_TRACE) {
        const neighbors = unclaimedCableNeighbors(fromIdx, graph, claimed);
        const junctions = junctionSetFromVisited(visitedIdx, graph);
        const jumpCands = conn?.gap
          ? jumpbackCandidates(junctions, graph, claimed)
          : [];
        let bestBfs = [];
        if (labelM != null) {
          const bfs = debugBfsSpanCandidates({
            fromIdx,
            graph,
            claimed,
            regionPosts,
            maxHops: 7,
            maxStates: 8000,
          });
          bfs.sort(
            (a, b) =>
              Math.abs(a.totalSpan - labelM) - Math.abs(b.totalSpan - labelM),
          );
          bestBfs = bfs.slice(0, 8).map((c) => ({
            endpoint: c.endpoint,
            hops: c.hops,
            span: +c.totalSpan.toFixed(2),
            delta: +Math.abs(c.totalSpan - labelM).toFixed(2),
            deg: graph.get(c.endpoint)?.size ?? 0,
          }));
        }
        // eslint-disable-next-line no-console
        console.error(
          `[gw-fail] ${fromNum}->${toNum} ` +
            JSON.stringify({
              fromIdx,
              gap: Boolean(conn?.gap),
              labelM,
              tolM: labelM != null ? spanToleranceFor(labelM) : null,
              unclaimedNeighbors: neighbors.length,
              visited: visitedIdx.length,
              visitedJunctions: junctions.length,
              jumpbackCandidates: jumpCands.length,
              directBestSpan: caseADirectBestSpan,
              bfsBest: bestBfs,
            }),
        );
      }
      if (caseAAttempted && caseADirectBestSpan != null) {
        warn({
          kind: "dwg-graph-walk-fail",
          at_post: toNum,
          reason: "tolerance-exceeded",
        });
        return {
          ok: false,
          failedAt: toNum,
          nearestDistance: caseADirectBestSpan,
          ...(process.env.GW_RETURN_PARTIAL === "1"
            ? { partialCoords: buildPartialCoords() }
            : {}),
          ...(process.env.GW_RETURN_IDX === "1"
            ? { idxByPostNumber: Object.fromEntries(idxByNum) }
            : {}),
        };
      }
      if (labelM == null) {
        warn({ kind: "dwg-missing-distance", from: fromNum, to: toNum });
        warn({
          kind: "dwg-graph-walk-fail",
          at_post: toNum,
          reason: "ambiguous",
        });
      } else {
        warn({
          kind: "dwg-graph-walk-fail",
          at_post: toNum,
          reason: "no-candidate",
        });
      }
      return {
        ok: false,
        failedAt: toNum,
        nearestDistance: null,
        ...(process.env.GW_RETURN_PARTIAL === "1"
          ? { partialCoords: buildPartialCoords() }
          : {}),
        ...(process.env.GW_RETURN_IDX === "1"
          ? { idxByPostNumber: Object.fromEntries(idxByNum) }
          : {}),
      };
    }

    if (process.env.GW_TRACE) {
      // eslint-disable-next-line no-console
      console.error(
        `[gw] ${fromNum}->${toNum} fromIdx=${fromIdx} -> chosen=${chosenIdx} intermediates=[${chainIntermediates?.join(",") ?? ""}] gap=${conn.gap} label=${labelM?.toFixed?.(2) ?? labelM}`,
      );
    }

    // Claim any intermediate chain nodes (and add to visitedIdx) before the
    // defensive collision check below validates `chosenIdx`.
    if (chainIntermediates && chainIntermediates.length) {
      for (const interIdx of chainIntermediates) {
        if (claimed.has(interIdx)) {
          warn({
            kind: "dwg-graph-walk-fail",
            at_post: toNum,
            reason: "collision",
          });
          return {
            ok: false,
            failedAt: toNum,
            nearestDistance: 0,
            ...(process.env.GW_RETURN_IDX === "1"
              ? { idxByPostNumber: Object.fromEntries(idxByNum) }
              : {}),
          };
        }
        claimed.add(interIdx);
        visitedIdx.push(interIdx);
      }
    }

    // Defensive collision check
    if (claimed.has(chosenIdx)) {
      warn({
        kind: "dwg-graph-walk-fail",
        at_post: toNum,
        reason: "collision",
      });
      return {
        ok: false,
        failedAt: toNum,
        nearestDistance: 0,
        ...(process.env.GW_RETURN_IDX === "1"
          ? { idxByPostNumber: Object.fromEntries(idxByNum) }
          : {}),
      };
    }

    dwgByNum.set(toNum, regionPosts[chosenIdx]);
    idxByNum.set(toNum, chosenIdx);
    claimed.add(chosenIdx);
    visitedIdx.push(chosenIdx);
    visitedPostNums.push(toNum);
  }

  // Step 4 — Strict pairing check
  for (const p of posts) {
    if (!dwgByNum.has(p.number)) {
      warn({
        kind: "dwg-graph-walk-fail",
        at_post: p.number,
        reason: "unpaired",
      });
      return {
        ok: false,
        failedAt: p.number,
        nearestDistance: null,
        ...(process.env.GW_RETURN_PARTIAL === "1"
          ? { partialCoords: buildPartialCoords() }
          : {}),
        ...(process.env.GW_RETURN_IDX === "1"
          ? { idxByPostNumber: Object.fromEntries(idxByNum) }
          : {}),
      };
    }
  }

  // Step 5 — Build coords
  const coords = posts.map((p) => {
    const dwg = dwgByNum.get(p.number);
    const { lat, lon } = utmToLatLon(dwg.x, dwg.y, zoneExpected);
    return {
      postNumber: p.number,
      lat,
      lon,
      source: "dwg",
      dwg_block: dwg.block,
    };
  });

  return {
    ok: true,
    coords,
    ...(process.env.GW_RETURN_IDX === "1"
      ? { idxByPostNumber: Object.fromEntries(idxByNum) }
      : {}),
  };
}
