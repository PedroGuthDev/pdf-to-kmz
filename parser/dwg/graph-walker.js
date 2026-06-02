import {
  buildAdjacencyGraph,
  buildPostIndex,
  DEFAULT_TOLERANCE_M,
} from "./region-pairing.js";
import { latLonToUtm, utmToLatLon } from "../geo/utm-calibrator.js";
import { envFlag, envTruthy } from "../node-canvas-setup.js";

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

/**
 * Hop label from the post we're placing to the next numbered post — used for
 * next-hop / spine-chord scoring. Bifurcation-tap consecutive labels (e.g.
 * Siriu 11→12 = 23 m) measure the stub leg, not the cable hop to the next
 * INSERT (~24 m); using the tap label mis-picks multi-hop arms (10→11).
 */
function effectiveNextRouteLabelM(
  stepIndex,
  toNum,
  posts,
  distMap,
  bifurcationTapEdges,
) {
  const nextPost = posts[stepIndex + 2];
  if (!nextPost) return null;
  let labelM = getDistLabel(distMap, toNum, nextPost.number);
  if (labelM == null || labelM <= 0) return null;
  if (!bifurcationTapEdges.has(`${toNum}->${nextPost.number}`)) return labelM;

  const beyond = posts[stepIndex + 3];
  if (!beyond) return labelM;

  const afterTap = getDistLabel(distMap, nextPost.number, beyond.number);
  if (afterTap != null && afterTap > 0) return afterTap;

  const mainM = getDistLabel(distMap, toNum, beyond.number);
  if (mainM != null && mainM > labelM) {
    return Math.max(mainM - labelM, spanToleranceFor(mainM) * 2);
  }
  return labelM;
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

function bestNextSpanDeltaFor(
  endpointIdx,
  fromIdx,
  regionPosts,
  richGraph,
  claimed,
  blockExtra,
  nextLabelM,
) {
  if (nextLabelM == null || !Number.isFinite(nextLabelM)) return Infinity;
  const block = new Set([...claimed, endpointIdx, ...blockExtra]);
  let best = Infinity;
  for (const nn of unclaimedCableNeighbors(endpointIdx, richGraph, block)) {
    if (nn === fromIdx) continue;
    const d2 = Math.abs(spanBetween(regionPosts, endpointIdx, nn) - nextLabelM);
    if (d2 < best) best = d2;
  }
  return best;
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

/**
 * Bifurcation-tap on the spine when the DWG cable graph has no edge to the next
 * numbered INSERT (e.g. Siriu 57→58: chord ~43m, PDF tap 19.3m, main 57→59 60.9m).
 * Picks the shortest unclaimed INSERT whose span from `fromIdx` lies between a
 * reasonable tap leg and the bifurcation-main label.
 */
/**
 * Bifurcation tap on a real cable arm (Siriu 32→33: junction 118 → tap 117).
 * Prefer this over chord search, which can latch onto orphan duplicate INSERTs
 * at the same coordinates as a claimed post (idx 398 vs claimed 119).
 */
function findBifurcationTapCableArm(
  fromIdx,
  tapLabelM,
  claimed,
  regionPosts,
  graph,
) {
  const arms = unclaimedCableNeighbors(fromIdx, graph, claimed);
  if (!arms.length) return -1;
  if (arms.length === 1) return arms[0];

  const tapTol =
    tapLabelM != null && tapLabelM > 0
      ? Math.max(spanToleranceFor(tapLabelM), 8)
      : 12;
  let bestIdx = -1;
  let bestDelta = Infinity;
  for (const arm of arms) {
    const stubSpan = spanBetween(regionPosts, fromIdx, arm);
    if (tapLabelM == null || tapLabelM <= 0) continue;
    const delta = Math.abs(stubSpan - tapLabelM);
    if (delta > tapTol) continue;
    if (delta < bestDelta || (delta === bestDelta && arm < bestIdx)) {
      bestDelta = delta;
      bestIdx = arm;
    }
  }
  return bestIdx;
}

function findBifurcationTapChordTarget(
  fromIdx,
  tapLabelM,
  mainLabelM,
  claimed,
  regionPosts,
  gpsByPostNumber,
  toNum,
  preferLongestSpineLeg = false,
  graph = null,
) {
  if (mainLabelM == null || !Number.isFinite(mainLabelM) || mainLabelM <= 0) {
    return -1;
  }
  const mainTol = Math.max(spanToleranceFor(mainLabelM), 12);
  const minLeg =
    tapLabelM != null && tapLabelM > 15
      ? Math.max(15, tapLabelM - spanToleranceFor(tapLabelM))
      : tapLabelM != null && tapLabelM > 0
        ? Math.max(8, tapLabelM - spanToleranceFor(tapLabelM))
        : 20;
  const maxLeg = mainLabelM + mainTol;
  const tapTol =
    tapLabelM != null && tapLabelM > 0 ? spanToleranceFor(tapLabelM) : 0;
  /** @type {Array<{ idx: number, span: number }>} */
  const candidates = [];
  for (let i = 0; i < regionPosts.length; i++) {
    if (claimed.has(i) || i === fromIdx) continue;
    if (graph != null && (graph.get(i)?.size ?? 0) === 0) continue;
    const s = spanBetween(regionPosts, fromIdx, i);
    if (s < minLeg || s > maxLeg) continue;
    // Short PDF tap labels on spine chords (e.g. 19.3m vs real ~43m) must not
    // win via a coincidentally close unrelated INSERT.
    if (
      tapLabelM != null &&
      tapLabelM <= 20 &&
      tapTol > 0 &&
      Math.abs(s - tapLabelM) <= tapTol
    ) {
      continue;
    }
    candidates.push({ idx: i, span: s });
  }
  if (!candidates.length) return -1;

  // No cable continuation (Siriu 57→58): pick the chord whose span best matches
  // the mid-point between the short PDF tap and the bifurcation-main label (~43m
  // for tap 19.3 + main 60.9), not the longest INSERT in range (can be ~63m).
  if (
    preferLongestSpineLeg &&
    tapLabelM != null &&
    tapLabelM <= 20 &&
    mainLabelM >= 40
  ) {
    const targetSpan = (mainLabelM + tapLabelM) / 2;
    let bestIdx = -1;
    let bestDelta = Infinity;
    for (const { idx, span } of candidates) {
      const delta = Math.abs(span - targetSpan);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestIdx = idx;
      }
    }
    if (bestIdx >= 0) return bestIdx;
  }

  // Span-based pick (smallest span that fits the tap-chord window). This is the
  // authoritative choice; GPS only confirms or refines, never overrides blindly.
  let spanBestIdx = -1;
  let bestSpan = Infinity;
  for (const { idx, span } of candidates) {
    if (span < bestSpan) {
      bestSpan = span;
      spanBestIdx = idx;
    }
  }

  if (gpsByPostNumber?.get(toNum)) {
    const gpsRadiusM = Math.max(20, 5 * spanToleranceFor(mainLabelM));
    /** Candidates tied with the span-based shortest leg (GPS may break ties only). */
    const spanTied = candidates.filter(
      (c) => Math.abs(c.span - bestSpan) <= 0.5,
    );

    let gpsBestIdx = -1;
    let bestGps = Infinity;
    for (const { idx } of spanTied) {
      const g = insertDistanceToGpsPost(
        regionPosts,
        idx,
        gpsByPostNumber,
        toNum,
      );
      if (g != null && g < bestGps) {
        bestGps = g;
        gpsBestIdx = idx;
      }
    }

    // GPS confirms when it agrees with the span pick, or breaks a genuine span
    // tie among in-window candidates with a clearly small GPS distance. Never
    // override a shorter span leg with a GPS-nearer longer chord (Siriu post 24:
    // span idx 145 vs GPS idx 421).
    if (gpsBestIdx >= 0) {
      if (gpsBestIdx === spanBestIdx) {
        return gpsBestIdx;
      }
      if (spanTied.length > 1 && bestGps < gpsRadiusM) {
        return gpsBestIdx;
      }
    }
  }

  return spanBestIdx;
}

/**
 * Bifurcation tap at a spine stub (e.g. Siriu 64→65): the PDF tap label
 * measures from an upstream junction arm, not from the dead-end spine tip.
 * When a visited hub carries a non-consecutive label to the tap target
 * (e.g. 60→65=31.7 from hub idx 44), place via that hop instead of the
 * stub's misleading single cable arm.
 */
function findHubBranchTapByHint({
  toNum,
  fromIdx,
  fromNum,
  visitedPostNums,
  idxByNum,
  distMap,
  graph,
  claimed,
  regionPosts,
  isPhantomBifurcationHint,
  tapLabelM,
  juncMainLabelM,
}) {
  /** @type {Array<{ hubNum: number, hubIdx: number, hop: { endpoint: number, intermediates: number[] }, hintLabelM: number, hintDelta: number, endpointDeg: number, mainDelta: number }>} */
  const candidates = [];
  for (let k = visitedPostNums.length - 1; k >= 0; k--) {
    const hubNum = visitedPostNums[k];
    if (hubNum === fromNum || hubNum === toNum) continue;
    const hubIdx = idxByNum.get(hubNum);
    if (hubIdx == null || hubIdx === fromIdx) continue;
    const hintLabelM = getDistLabel(distMap, hubNum, toNum);
    if (hintLabelM == null || hintLabelM <= 0) continue;
    if (isPhantomBifurcationHint(hubNum, toNum, hintLabelM)) continue;
    // Hub hint must exceed the local tap stub — the stub is a PDF artifact.
    if (
      tapLabelM != null &&
      tapLabelM > 0 &&
      hintLabelM <= tapLabelM + Math.max(spanToleranceFor(tapLabelM), 5)
    ) {
      continue;
    }
    const hintTol = Math.max(
      spanToleranceFor(hintLabelM),
      10,
      0.35 * hintLabelM,
    );
    /** @type {Array<{ endpoint: number, intermediates: number[], hintDelta: number }>} */
    const endpoints = [];
    for (const arm of unclaimedCableNeighbors(hubIdx, graph, claimed)) {
      const span = spanBetween(regionPosts, hubIdx, arm);
      const hintDelta = Math.abs(span - hintLabelM);
      if (hintDelta <= hintTol) {
        endpoints.push({ endpoint: arm, intermediates: [], hintDelta });
      }
    }
    const multiHop = findMultiHopByLabel({
      fromIdx: hubIdx,
      labelM: hintLabelM,
      tol: hintTol,
      richGraph: graph,
      claimed,
      regionPosts,
      maxHops: 6,
    });
    if (multiHop && !endpoints.some((e) => e.endpoint === multiHop.endpoint)) {
      endpoints.push({
        endpoint: multiHop.endpoint,
        intermediates: multiHop.intermediates,
        hintDelta: Math.abs(
          spanBetween(regionPosts, hubIdx, multiHop.endpoint) - hintLabelM,
        ),
      });
    }
    for (const { endpoint, intermediates, hintDelta } of endpoints) {
      const endpointDeg = graph.get(endpoint)?.size ?? 0;
      let mainDelta = Infinity;
      if (juncMainLabelM != null && juncMainLabelM > 0) {
        const mainTol = Math.max(
          spanToleranceFor(juncMainLabelM),
          10,
          0.35 * juncMainLabelM,
        );
        const mainHop = findMultiHopByLabel({
          fromIdx: endpoint,
          labelM: juncMainLabelM,
          tol: mainTol,
          richGraph: graph,
          claimed,
          regionPosts,
          maxHops: 4,
        });
        if (mainHop) {
          mainDelta = Math.abs(
            spanBetween(regionPosts, endpoint, mainHop.endpoint) -
              juncMainLabelM,
          );
        }
      }
      candidates.push({
        hubNum,
        hubIdx,
        hop: { endpoint, intermediates },
        hintLabelM,
        hintDelta,
        endpointDeg,
        mainDelta,
      });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    // Branch tap sits on a continuing arm (Siriu 65: idx 0 deg 3 vs idx 3 deg 2).
    if (a.endpointDeg !== b.endpointDeg) return b.endpointDeg - a.endpointDeg;
    if (a.mainDelta !== b.mainDelta) return a.mainDelta - b.mainDelta;
    if (a.hintDelta !== b.hintDelta) return a.hintDelta - b.hintDelta;
    return 0;
  });
  const best = candidates[0];
  return {
    endpoint: best.hop.endpoint,
    intermediates: best.hop.intermediates,
    hubNum: best.hubNum,
    hubIdx: best.hubIdx,
    hintLabelM: best.hintLabelM,
  };
}

/**
 * Branch return via a visited junction arm (Siriu 68→69: label 31 matches
 * hub-44→idx-3 chord; direct cable 35→34 fits the label but cannot reach 70).
 */
function findHubArmReturnByLabel({
  labelM,
  nextLabelM,
  visitedPostNums,
  idxByNum,
  fromIdx,
  graph,
  claimed,
  regionPosts,
}) {
  if (labelM == null || labelM <= 0) return null;
  const labelTol = spanToleranceFor(labelM);
  const nextTol =
    nextLabelM != null && nextLabelM > 0
      ? spanToleranceFor(nextLabelM)
      : Infinity;
  /** @type {Array<{ endpoint: number, hubNum: number, hubIdx: number, nextDelta: number, labelDelta: number, endpointDeg: number }>} */
  const candidates = [];
  for (let k = visitedPostNums.length - 1; k >= 0; k--) {
    const hubNum = visitedPostNums[k];
    const hubIdx = idxByNum.get(hubNum);
    if (hubIdx == null || hubIdx === fromIdx) continue;
    if ((graph.get(hubIdx)?.size ?? 0) < 3) continue;
    for (const arm of unclaimedCableNeighbors(hubIdx, graph, claimed)) {
      const span = spanBetween(regionPosts, hubIdx, arm);
      const labelDelta = Math.abs(span - labelM);
      if (labelDelta > labelTol) continue;
      let nextDelta = Infinity;
      if (nextLabelM != null && nextLabelM > 0) {
        nextDelta = bestNextSpanDeltaFor(
          arm,
          hubIdx,
          regionPosts,
          graph,
          claimed,
          [],
          nextLabelM,
        );
        if (!Number.isFinite(nextDelta) || nextDelta > nextTol) continue;
      }
      candidates.push({
        endpoint: arm,
        hubNum,
        hubIdx,
        nextDelta,
        labelDelta,
        endpointDeg: graph.get(arm)?.size ?? 0,
      });
    }
  }
  if (!candidates.length) return null;
  candidates.sort(
    (a, b) =>
      a.nextDelta - b.nextDelta ||
      b.endpointDeg - a.endpointDeg ||
      a.labelDelta - b.labelDelta,
  );
  const best = candidates[0];
  return {
    endpoint: best.endpoint,
    hubNum: best.hubNum,
    hubIdx: best.hubIdx,
  };
}

/** True when a bifurcation tap entered a side branch from `hubIdx` (still open). */
function hasOpenHubBranchFrom(tapPlacedMainLabel, hubIdx) {
  for (const rec of tapPlacedMainLabel.values()) {
    if (rec?.branchFromHub && rec.juncIdx === hubIdx) return true;
  }
  return false;
}

/**
 * When the consecutive label fits no cable arm but the next-hop label does
 * (Siriu 59→60: chord 46→44, label 31.7m, next 44→169≈27.4m).
 */
function findSpineChordByNextLabel(
  fromIdx,
  nextLabelM,
  claimed,
  regionPosts,
  graph,
  chordLabelM = null,
) {
  if (nextLabelM == null || !Number.isFinite(nextLabelM) || nextLabelM <= 0) {
    return -1;
  }
  const nextTol = spanToleranceFor(nextLabelM);
  /** @type {Array<{ idx: number, nextDelta: number, chordSpan: number }>} */
  const viable = [];
  for (let i = 0; i < regionPosts.length; i++) {
    if (claimed.has(i) || i === fromIdx) continue;
    let bestDeltaForI = Infinity;
    for (const nn of unclaimedCableNeighbors(i, graph, claimed)) {
      if (nn === fromIdx) continue;
      const hopSpan = spanBetween(regionPosts, i, nn);
      const delta = Math.abs(hopSpan - nextLabelM);
      if (delta <= nextTol && delta < bestDeltaForI) {
        bestDeltaForI = delta;
      }
    }
    if (bestDeltaForI < Infinity) {
      viable.push({
        idx: i,
        nextDelta: bestDeltaForI,
        chordSpan: spanBetween(regionPosts, fromIdx, i),
      });
    }
  }
  if (!viable.length) return -1;

  viable.sort((a, b) => a.nextDelta - b.nextDelta || a.chordSpan - b.chordSpan);
  const bestByNext = viable[0];

  if (chordLabelM != null && chordLabelM > 0) {
    const chordTol = spanToleranceFor(chordLabelM);
    const withChord = viable.filter(
      (v) => Math.abs(v.chordSpan - chordLabelM) <= chordTol,
    );
    if (withChord.length) {
      withChord.sort(
        (a, b) => a.nextDelta - b.nextDelta || a.chordSpan - b.chordSpan,
      );
      const bestByChord = withChord[0];
      const nextMiss = Math.abs(bestByNext.chordSpan - chordLabelM);
      if (nextMiss > chordTol) {
        // Siriu 59→60: label understates chord (~51 m) but next-hop is decisive
        // (44→169 Δ≈0.02 m vs chord-fit 41 Δ≈2 m). Siriu 10→11: a stub INSERT
        // can win next-hop while missing chord by ~100 m — prefer chord-fit 210.
        if (bestByNext.nextDelta + 1 < bestByChord.nextDelta && nextMiss < 25) {
          return bestByNext.idx;
        }
        return bestByChord.idx;
      }
      if (bestByChord.nextDelta <= bestByNext.nextDelta + 1) {
        return bestByChord.idx;
      }
    }
  }

  return bestByNext.idx;
}

/**
 * Off-cable INSERT whose unclaimed neighbor hop matches nextLabelM (Siriu 70→71:
 * idx 11 with 11→167≈38.7m while cable arm 6→8 falsely fits the same label).
 */
function findOffCableInsertByNextLabel(
  fromIdx,
  nextLabelM,
  directNeighborIdxs,
  claimed,
  regionPosts,
  graph,
) {
  if (nextLabelM == null || !Number.isFinite(nextLabelM) || nextLabelM <= 0) {
    return -1;
  }
  const nextTol = spanToleranceFor(nextLabelM);
  const directSet = new Set(directNeighborIdxs);
  /** @type {Array<{ idx: number, nextDelta: number, chordSpan: number }>} */
  const viable = [];
  for (let i = 0; i < regionPosts.length; i++) {
    if (claimed.has(i) || i === fromIdx || directSet.has(i)) continue;
    if (graph != null && (graph.get(i)?.size ?? 0) === 0) continue;
    let bestDeltaForI = Infinity;
    for (const nn of unclaimedCableNeighbors(i, graph, claimed)) {
      if (nn === fromIdx) continue;
      const hopSpan = spanBetween(regionPosts, i, nn);
      const delta = Math.abs(hopSpan - nextLabelM);
      if (delta <= nextTol && delta < bestDeltaForI) {
        bestDeltaForI = delta;
      }
    }
    if (bestDeltaForI < Infinity) {
      viable.push({
        idx: i,
        nextDelta: bestDeltaForI,
        chordSpan: spanBetween(regionPosts, fromIdx, i),
      });
    }
  }
  if (!viable.length) return -1;
  viable.sort((a, b) => a.nextDelta - b.nextDelta || a.chordSpan - b.chordSpan);
  return viable[0].idx;
}

/**
 * Gap re-entry (Siriu 73→74): off-cable INSERT in a long-chord window whose next
 * hop matches the suppressed edge's lookahead label; GPS breaks ties when the
 * next-hop score alone would pick a parallel branch (15/16 vs spine 8).
 */
function findGapOffCableReentryByNextLabel(
  fromIdx,
  nextLabelM,
  directNeighborIdxs,
  claimed,
  regionPosts,
  graph,
  gpsByPostNumber,
  toNum,
) {
  if (nextLabelM == null || !Number.isFinite(nextLabelM) || nextLabelM <= 0) {
    return -1;
  }
  const nextTol = spanToleranceFor(nextLabelM);
  const directSet = new Set(directNeighborIdxs);
  /** @type {Array<{ idx: number, nextDelta: number, chordSpan: number }>} */
  const viable = [];
  for (let i = 0; i < regionPosts.length; i++) {
    if (claimed.has(i) || i === fromIdx || directSet.has(i)) continue;
    if (graph != null && (graph.get(i)?.size ?? 0) === 0) continue;
    let bestDeltaForI = Infinity;
    for (const nn of unclaimedCableNeighbors(i, graph, claimed)) {
      if (nn === fromIdx || directSet.has(nn)) continue;
      const hopSpan = spanBetween(regionPosts, i, nn);
      const delta = Math.abs(hopSpan - nextLabelM);
      if (delta <= nextTol && delta < bestDeltaForI) {
        bestDeltaForI = delta;
      }
    }
    if (bestDeltaForI < Infinity) {
      const chordSpan = spanBetween(regionPosts, fromIdx, i);
      if (chordSpan >= 95 && chordSpan < 250) {
        viable.push({ idx: i, nextDelta: bestDeltaForI, chordSpan });
      }
    }
  }
  if (!viable.length) return -1;

  if (gpsByPostNumber?.get(toNum)) {
    let gpsBestIdx = -1;
    let bestGps = Infinity;
    for (const v of viable) {
      const g = insertDistanceToGpsPost(
        regionPosts,
        v.idx,
        gpsByPostNumber,
        toNum,
      );
      if (g != null && g < bestGps) {
        bestGps = g;
        gpsBestIdx = v.idx;
      }
    }
    if (gpsBestIdx >= 0) return gpsBestIdx;
  }

  viable.sort((a, b) => a.nextDelta - b.nextDelta || a.chordSpan - b.chordSpan);
  return viable[0].idx;
}

/** UTM distance from a region INSERT to a route post's PDF/GPS anchor (when provided). */
function insertDistanceToGpsPost(regionPosts, idx, gpsByPostNumber, postNum) {
  const gps = gpsByPostNumber?.get(postNum);
  if (
    !gps ||
    typeof gps.lat !== "number" ||
    typeof gps.lon !== "number" ||
    idx == null ||
    idx < 0
  ) {
    return null;
  }
  const p = regionPosts[idx];
  if (!p) return null;
  const utm = latLonToUtm(gps.lat, gps.lon);
  return Math.hypot(p.x - utm.easting, p.y - utm.northing);
}

/** Minimum cable distance from current node to branch-entry junction (Siriu ~95m mid-branch). */
const BRANCH_TERMINAL_MIN_ENTRY_SPAN_M = 120;

/**
 * True when the walk should try branch-return: deep on a parallel branch (far
 * from the entry junction), with a misleading short forward stub for the
 * consecutive label, and (when GPS anchors exist) the stub INSERT is not near
 * the target post.
 */
function shouldTryBranchReturn({
  fromNum,
  fromIdx,
  toNum,
  labelM,
  neighbors,
  branchEntryStack,
  regionPosts,
  graph,
  claimed,
  gpsByPostNumber,
  nextLabelM,
}) {
  if (labelM == null || !Number.isFinite(labelM) || labelM <= 0) return false;
  if (!neighbors.length || !branchEntryStack.length) return false;

  const deepEntry = branchEntryStack.find(
    (e) =>
      spanBetween(regionPosts, fromIdx, e.junctionIdx) >=
      BRANCH_TERMINAL_MIN_ENTRY_SPAN_M,
  );
  if (!deepEntry) return false;
  // Still on the early branch segment (e.g. 44→45); return only near the tip.
  if (
    typeof deepEntry.entryPostNum === "number" &&
    fromNum <= deepEntry.entryPostNum + 8
  ) {
    return false;
  }

  const directTol = spanToleranceFor(labelM);
  const relaxedTol = Math.max(directTol, 10, 0.35 * labelM);
  let bestDirectIdx = -1;
  let bestDirectDelta = Infinity;
  for (const nIdx of neighbors) {
    const delta = Math.abs(spanBetween(regionPosts, fromIdx, nIdx) - labelM);
    if (delta < bestDirectDelta) {
      bestDirectDelta = delta;
      bestDirectIdx = nIdx;
    }
  }
  if (bestDirectIdx < 0 || bestDirectDelta > relaxedTol) return false;

  const stubSpan = spanBetween(regionPosts, fromIdx, bestDirectIdx);
  if (stubSpan > 50) return false;

  if (nextLabelM != null && Number.isFinite(nextLabelM)) {
    const nextTol = spanToleranceFor(nextLabelM);
    const nd = bestNextSpanDeltaFor(
      bestDirectIdx,
      fromIdx,
      regionPosts,
      graph,
      claimed,
      [],
      nextLabelM,
    );
    if (Number.isFinite(nd) && nd <= nextTol) return false;
  }

  const gpsRadiusM = Math.max(20, 5 * directTol);
  const gpsDist = insertDistanceToGpsPost(
    regionPosts,
    bestDirectIdx,
    gpsByPostNumber,
    toNum,
  );
  if (gpsDist != null) {
    return gpsDist > gpsRadiusM;
  }

  return true;
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
    if (aBackbone !== bBackbone) {
      // Near-exact multi-hop endpoint beats a loose 1-hop (Siriu 26→27: #149 Δ≈0.04 m
      // vs #148 Δ≈2.8 m) without letting a ~1 m wrong 1-hop beat a ~6 m correct one.
      if ((a.delta < 0.5 && b.delta > 2) || (b.delta < 0.5 && a.delta > 2)) {
        return a.delta < b.delta;
      }
      return aBackbone > bBackbone;
    }
    // Prefer shorter intermediate chain, then tighter label fit (f4663bc order).
    if (a.intermediates.length !== b.intermediates.length) {
      return a.intermediates.length < b.intermediates.length;
    }
    if (a.delta !== b.delta) return a.delta < b.delta;
    // Final deterministic tiebreak on endpoint index (independent of Set iteration order).
    return a.endpoint < b.endpoint;
  };

  const visit = (current, prev, accumSpan, intermediates, intermediateSet) => {
    const neighbors = richGraph.get(current);
    if (!neighbors) return;
    for (const next of neighbors) {
      if (next === prev) continue;
      if (claimed.has(next)) continue;
      if (intermediateSet.has(next)) continue; // avoid loops within a path (O(1))
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
        intermediateSet.add(next);
        visit(next, current, total, intermediates, intermediateSet);
        intermediates.pop();
        intermediateSet.delete(next);
      }
    }
  };

  visit(fromIdx, -1, 0, [], new Set());
  return best;
}

/**
 * Branch-return resolver (Option A). When a parallel branch dead-ends at a
 * service stub, the spine resumes from the junction where the branch was first
 * tapped, along that junction's single remaining unclaimed arm.
 *
 * Given the recorded branch-entry junction, find its unclaimed arms. The walk
 * should resume here only when:
 *   (1) the junction has exactly ONE unclaimed arm (the spine continuation), and
 *   (2) that arm fits the consecutive label `labelM` within a relaxed tolerance, and
 *   (3) the arm's forward continuation fits the NEXT label strictly better than
 *       the direct (stub) continuation does.
 * Returns { endpoint, intermediates: [] } or null.
 */
function findBranchReturnArm({
  junctionIdx,
  fromIdx,
  labelM,
  nextLabelM,
  directNextDelta,
  richGraph,
  claimed,
  regionPosts,
  visitedIdx,
  unusedArmIdx,
}) {
  if (junctionIdx == null) return null;
  if (labelM == null || !Number.isFinite(labelM) || labelM <= 0) return null;

  let arms = unclaimedCableNeighbors(junctionIdx, richGraph, claimed).filter(
    (a) => a !== fromIdx,
  );
  // Drop arms that re-enter already-visited spine (e.g. post-35 idx 122 at junction 123).
  if (Array.isArray(visitedIdx) && visitedIdx.length > 0) {
    const visited = new Set(visitedIdx);
    const filtered = arms.filter((a) => !visited.has(a));
    if (filtered.length > 0) arms = filtered;
  }
  if (unusedArmIdx != null && arms.includes(unusedArmIdx)) {
    arms = [unusedArmIdx];
  } else if (arms.length !== 1) {
    return null;
  }
  const armIdx = arms[0];
  if (armIdx === fromIdx) return null;

  // (2) consecutive-label fit (relaxed: branch-return labels are legacy-midpoint
  // chords that only approximate the junction->next span).
  const armSpan = spanBetween(regionPosts, junctionIdx, armIdx);
  const armTol = Math.max(spanToleranceFor(labelM), 10, 0.35 * labelM);
  if (Math.abs(armSpan - labelM) > armTol) return null;

  // (3) next-label lookahead from the arm must beat the direct stub continuation.
  if (nextLabelM != null && Number.isFinite(nextLabelM)) {
    const armNextDelta = bestNextSpanDeltaFor(
      armIdx,
      junctionIdx,
      regionPosts,
      richGraph,
      claimed,
      [],
      nextLabelM,
    );
    if (!Number.isFinite(armNextDelta)) return null;
    const directNext =
      directNextDelta != null && Number.isFinite(directNextDelta)
        ? directNextDelta
        : Infinity;
    // Require the arm to fit the next label clearly better than the stub.
    if (!(armNextDelta + 1 < directNext)) return null;
  }

  return { endpoint: armIdx, intermediates: [] };
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
  gpsByPostNumber,
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
  const postToIndex = new Map();
  for (let i = 0; i < regionPosts.length; i++)
    postToIndex.set(regionPosts[i], i);

  // Richer snap than region-library's 3m graph: junctions can sit >3m off INSERT.
  void adjacencyGraph;
  const cableEdges = region?.cableEdges ?? [];
  const graphOpts = { postIndex: tree, postToIdx: postToIndex };
  const graph8 = buildAdjacencyGraph(regionPosts, cableEdges, { ...graphOpts, snapTol: 8 });
  const graph14 = buildAdjacencyGraph(regionPosts, cableEdges, { ...graphOpts, snapTol: 14 });
  const graph = unionAdjacency(graph8, graph14);

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
      ...(envFlag("GW_RETURN_IDX")
        ? { idxByPostNumber: {} }
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
      ...(envFlag("GW_RETURN_IDX")
        ? { idxByPostNumber: {} }
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
      ...(envFlag("GW_RETURN_IDX")
        ? { idxByPostNumber: {} }
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
  /** @type {Set<string>} */
  const bifurcationTapEdges = new Set();
  // Map: "originNum:meters" -> targetNum for every bifurcation-main edge. Used to
  // detect phantom inferred-label hints that duplicate a real bifurcation-main
  // span (e.g. a spurious 36->39=35.5 that mirrors the real 36->38=35.5). Such a
  // phantom would route the walker off the spine onto the wrong junction arm.
  /** @type {Map<string, number>} */
  const bifurcationMainByOriginMeters = new Map();
  for (const d of distances ?? []) {
    if (d?.source === "bifurcation-tap" && d.meters != null && d.meters > 0) {
      bifurcationTapEdges.add(`${d.from}->${d.to}`);
    }
    if (
      d?.source === "bifurcation-main" &&
      d.meters != null &&
      d.meters > 0 &&
      d.from != null &&
      d.to != null
    ) {
      bifurcationMainByOriginMeters.set(`${d.from}:${d.meters}`, d.to);
    }
  }
  /**
   * A hint edge originNum->toNum with value meters is a phantom when a
   * bifurcation-main edge originNum->otherPost carries the SAME meters but
   * targets a DIFFERENT post. Genuine branch-return hints (e.g. 5->10) do not
   * mirror a bifurcation-main span, so they pass.
   */
  const isPhantomBifurcationHint = (originNum, toNum, meters) => {
    if (meters == null || meters <= 0) return false;
    const mainTarget = bifurcationMainByOriginMeters.get(
      `${originNum}:${meters}`,
    );
    return mainTarget != null && mainTarget !== toNum;
  };
  // When the bifurcation-tap-stub handler places a tap post N, it advances the
  // walker onto the spine but the consecutive label N->(N+1) was cleared
  // (bifurcation-cleared). The continuation distance for the NEXT step lives in
  // the bifurcation-main label (junction->(N+1)). At an auxiliary tap the tap
  // post sits essentially AT the junction, so that main label measures the span
  // FROM the tap post N to (N+1) — and (N+1)'s INSERT is a direct unclaimed
  // neighbor of the tap-placed index. We record it here so the next step can
  // search the main label from the tap post (fromIdx) instead of from the
  // junction (whose path through the now-claimed tap index is blocked).
  /**
   * tap-post number -> { labelM, juncIdx } where labelM is the bifurcation-main
   * label (junction->(N+1)) in meters and juncIdx is the DXF INSERT index of the
   * junction the tap branched from. The continuation hop for the cleared
   * N->(N+1) edge is searched first from the tap post (fromIdx) and, failing
   * that, from the junction index — because a true auxiliary tap leaves the
   * spine, so (N+1) is reachable from the junction, not from the tap stub.
   * @type {Map<number, { labelM: number, juncIdx: number|undefined }>}
   */
  const tapPlacedMainLabel = new Map();
  // Branch-entry stack (Option A — Siriu posts 46+). Each time the walk leaves a
  // high-degree junction (deg >= 4, e.g. post 36 / idx 123) with spine arms still
  // unclaimed, we record that junction. The parallel branch eventually dead-ends
  // at a service stub; when that branch terminal is reached and the forward
  // continuation fits the next label poorly, we pop the most recent entry junction
  // and resume along its single remaining unclaimed arm (the spine continuation).
  /** @type {Array<{ junctionIdx: number, unusedArmIdx?: number, entryPostNum?: number }>} */
  const branchEntryStack = [];
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
        ...(envFlag("GW_RETURN_PARTIAL")
          ? { partialCoords: buildPartialCoords() }
          : {}),
        ...(envFlag("GW_RETURN_IDX")
          ? { idxByPostNumber: Object.fromEntries(idxByNum) }
          : {}),
      };
    }

    const labelM = getDistLabel(distMap, fromNum, toNum);
    const fromDwg = dwgByNum.get(fromNum);
    const fromIdx = postToIndex.get(fromDwg);
    const tapEdgeKey = `${fromNum}->${toNum}`;
    const nextOnRoute = posts[i + 2];
    const juncMainLabelM =
      nextOnRoute != null
        ? getDistLabel(distMap, fromNum, nextOnRoute.number)
        : null;
    const routeNextLabel = effectiveNextRouteLabelM(
      i,
      toNum,
      posts,
      distMap,
      bifurcationTapEdges,
    );

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

      // If the consecutive Distancia_Poste label (labelM) is matched by a DIRECT
      // unclaimed cable neighbor within tolerance, the consecutive edge physically
      // exists in the DWG. In that case a non-consecutive inferred-label hint
      // (e.g. a phantom 43->45 mirroring 43->44) must NOT override the real
      // neighbor by multi-hopping from an already-visited junction. Compute the
      // flag here and use it to suppress the broad hint-jumpback below.
      let hasDirectConsecutiveMatch = false;
      if (labelM != null && labelM > 0) {
        const directTol = spanToleranceFor(labelM);
        for (const nIdx of neighbors) {
          const span = spanBetween(regionPosts, fromIdx, nIdx);
          if (Math.abs(span - labelM) <= directTol) {
            hasDirectConsecutiveMatch = true;
            break;
          }
        }
      }

      // Spine bifurcation-tap with no cable edge (e.g. Siriu 57→58): place by
      // chord + GPS before hint multi-hop can misroute to a nearby wrong INSERT.
      if (
        chosenIdx === undefined &&
        bifurcationTapEdges.has(tapEdgeKey) &&
        juncMainLabelM != null &&
        juncMainLabelM > 0 &&
        labelM != null &&
        labelM > 0 &&
        !hasDirectConsecutiveMatch
      ) {
        const hubBranch = findHubBranchTapByHint({
          toNum,
          fromIdx,
          fromNum,
          visitedPostNums,
          idxByNum,
          distMap,
          graph,
          claimed,
          regionPosts,
          isPhantomBifurcationHint,
          tapLabelM: labelM,
          juncMainLabelM,
        });
        if (hubBranch) {
          chosenIdx = hubBranch.endpoint;
          chainIntermediates = hubBranch.intermediates;
          tapPlacedMainLabel.set(toNum, {
            labelM: juncMainLabelM,
            juncIdx: hubBranch.hubIdx,
            branchFromHub: true,
          });
          warn({
            kind: "dwg-bifurcation-tap-hub-hint",
            at_post: toNum,
            hub_post: hubBranch.hubNum,
            hint_label_m: hubBranch.hintLabelM,
            tap_label_m: labelM,
            main_label_m: juncMainLabelM,
            chord_span_m: spanBetween(
              regionPosts,
              hubBranch.hubIdx,
              hubBranch.endpoint,
            ),
          });
        } else {
          let chordIdx = findBifurcationTapCableArm(
            fromIdx,
            labelM,
            claimed,
            regionPosts,
            graph,
          );
          if (chordIdx < 0) {
            chordIdx = findBifurcationTapChordTarget(
              fromIdx,
              labelM,
              juncMainLabelM,
              claimed,
              regionPosts,
              gpsByPostNumber,
              toNum,
              caseAStuckNoNeighbors,
              graph,
            );
          }
          if (chordIdx >= 0) {
            chosenIdx = chordIdx;
            tapPlacedMainLabel.set(toNum, {
              labelM: juncMainLabelM,
              juncIdx: fromIdx,
            });
            warn({
              kind: "dwg-bifurcation-tap-chord",
              at_post: toNum,
              label_m: labelM,
              main_label_m: juncMainLabelM,
              chord_span_m: spanBetween(regionPosts, fromIdx, chordIdx),
            });
          }
        }
      }

      // Branch-return jumpback helper (runs BEFORE direct-neighbor logic and BEFORE
      // the labelM==null single-neighbor shortcut). If we have a non-consecutive
      // Distância_Poste label from any previously visited post to the target
      // (e.g. 5→10 when stepping 9→10), prefer hint-based placement.
      //
      // This is essential at branch returns where the sequential label was suppressed
      // (labelM is null because the consecutive edge doesn't physically exist), and the
      // current node sits at a dead-end stub whose only unclaimed neighbor would otherwise
      // be taken via the single-neighbor shortcut and route the walker into the void.
      //
      // We intentionally do NOT require conn.gap: the upstream gap flag can be wrong
      // (snap-3 artifacts), but a non-consecutive label is an explicit topological hint.
      // For `forceJumpback` (very large gap label) we still defer to Case B below.
      const LARGE_GAP_LABEL_M = 100;
      const forceJumpback =
        labelM != null && Boolean(conn.gap) && labelM >= LARGE_GAP_LABEL_M;

      if (!forceJumpback) {
        // Tap-continuation: if we are standing on a post that was placed by the
        // bifurcation-tap-stub handler on the previous step, and this step's
        // consecutive label was cleared (labelM == null), the bifurcation-main
        // label measures the span FROM this tap post to the target. Search it
        // from fromIdx FIRST — the target INSERT is a direct unclaimed neighbor
        // here, whereas a junction-origin search would be blocked by the
        // now-claimed tap index. Only accept a tight match (the main label is a
        // real geometric span at an aux tap).
        // Only attempt the tapMain multi-hop when the target is genuinely
        // ambiguous (more than one unclaimed neighbor). If the tap post has a
        // single unclaimed cable neighbor, that neighbor IS the next post — the
        // recorded main label (e.g. 32→34 = 60.9) measures from the JUNCTION,
        // not from this tap post, so multi-hopping it from fromIdx overshoots
        // the real next post (lands on next+1). Defer to the single-neighbor
        // shortcut below in that case.
        const tapUnclaimed = unclaimedCableNeighbors(fromIdx, graph, claimed);
        const tapRec = tapPlacedMainLabel.get(fromNum);
        const tapMainLabelM = tapRec ? tapRec.labelM : null;
        const swappedTapStep =
          tapMainLabelM != null &&
          tapMainLabelM > 0 &&
          labelM != null &&
          labelM > 0 &&
          labelM <= 15 &&
          Math.abs(labelM - tapMainLabelM) >
            Math.max(spanToleranceFor(tapMainLabelM), 8);
        if (
          chosenIdx === undefined &&
          (labelM == null || swappedTapStep) &&
          tapMainLabelM != null &&
          tapMainLabelM > 0
        ) {
          const tapMainTol = spanToleranceFor(tapMainLabelM);
          // Swapped bifurcation (e.g. 49→50 carries 8.4 while tap main is 22.6):
          // the sole forward cable often IS the main-span neighbor.
          if (
            swappedTapStep &&
            tapUnclaimed.length === 1 &&
            tapUnclaimed[0] !== tapRec?.juncIdx
          ) {
            const only = tapUnclaimed[0];
            const onlySpan = spanBetween(regionPosts, fromIdx, only);
            if (Math.abs(onlySpan - tapMainLabelM) <= tapMainTol) {
              chosenIdx = only;
            }
          }
          // Hub-branch tap (e.g. Siriu 64→65 via hub 60): the tap post sits ON
          // the branch arm; the next post is the forward cable neighbor, NOT a
          // re-search from the hub (which would pick the wrong arm, e.g. 44→3).
          if (
            chosenIdx === undefined &&
            tapRec?.branchFromHub &&
            labelM == null
          ) {
            const forwardArms = tapUnclaimed.filter(
              (n) => n !== tapRec.juncIdx,
            );
            if (forwardArms.length === 1) {
              chosenIdx = forwardArms[0];
            } else if (forwardArms.length > 1) {
              let bestArm = null;
              for (const arm of forwardArms) {
                const delta = Math.abs(
                  spanBetween(regionPosts, fromIdx, arm) - tapMainLabelM,
                );
                if (
                  delta <= tapMainTol &&
                  (!bestArm || delta < bestArm.delta)
                ) {
                  bestArm = { arm, delta };
                }
              }
              if (bestArm) chosenIdx = bestArm.arm;
            }
          }
          // First search from the tap post itself — but only when the tap post
          // has more than one unclaimed neighbor (genuine ambiguity). With a
          // single neighbor that neighbor IS the next post and the recorded
          // main label measures from the JUNCTION, so a multi-hop from fromIdx
          // would overshoot (see Issue 1, step 33->34).
          let tapMainHop = null;
          if (chosenIdx === undefined && tapUnclaimed.length > 1) {
            tapMainHop = findMultiHopByLabel({
              fromIdx,
              labelM: tapMainLabelM,
              tol: tapMainTol,
              richGraph: graph,
              claimed,
              regionPosts,
              maxHops: 4,
            });
          }
          // Fallback: a true auxiliary tap leaves the spine, so (N+1) is NOT
          // reachable from the tap stub. Search the main label from the
          // junction the tap branched off (Issue 2, step 37->38: post 38 sits
          // on the spine off junction 36, not off tap 37).
          if (
            !tapMainHop &&
            tapRec &&
            tapRec.juncIdx != null &&
            tapRec.juncIdx !== fromIdx &&
            !tapRec.branchFromHub
          ) {
            const juncIdx = tapRec.juncIdx;
            const fallbackTol = Math.max(tapMainTol, 10, 0.35 * tapMainLabelM);
            // Prefer a direct junction arm within tolerance, breaking ties by
            // (1) HIGHEST degree — the numbered spine continues through a
            // junction-degree node, not through a degree-2 side branch — then
            // (2) tighter span delta. A pure label-delta search (e.g. arm
            // 153@34.7 vs 124@31.0 against 35.5) would wrongly pick the
            // slightly-closer side branch 153 over the true spine arm 124
            // (deg 3). Only if no direct arm fits do we fall back to a deeper
            // multi-hop search.
            let armBest = null;
            for (const arm of unclaimedCableNeighbors(
              juncIdx,
              graph,
              claimed,
            )) {
              const span = spanBetween(regionPosts, juncIdx, arm);
              const delta = Math.abs(span - tapMainLabelM);
              if (delta > fallbackTol) continue;
              const deg = graph.get(arm)?.size ?? 0;
              if (
                armBest == null ||
                deg > armBest.deg ||
                (deg === armBest.deg && delta < armBest.delta)
              ) {
                armBest = { endpoint: arm, intermediates: [], deg, delta };
              }
            }
            if (armBest) {
              tapMainHop = {
                endpoint: armBest.endpoint,
                intermediates: armBest.intermediates,
              };
            } else {
              tapMainHop = findMultiHopByLabel({
                fromIdx: juncIdx,
                labelM: tapMainLabelM,
                tol: fallbackTol,
                richGraph: graph,
                claimed,
                regionPosts,
                maxHops: 6,
              });
            }
          }
          if (tapMainHop) {
            chosenIdx = tapMainHop.endpoint;
            chainIntermediates = tapMainHop.intermediates;
          }
        }

        /** @type {number[]} */
        const hintOriginNums = [];
        if (chosenIdx === undefined && labelM == null) {
          const juncNum = fromNum - 1;
          if (
            juncNum >= 1 &&
            juncNum !== toNum &&
            idxByNum.get(juncNum) != null &&
            getDistLabel(distMap, juncNum, toNum) != null
          ) {
            hintOriginNums.push(juncNum);
          }
        }
        if (chosenIdx === undefined && labelM == null && i > 0) {
          const prevNum = posts[i - 1].number;
          if (
            prevNum !== fromNum &&
            prevNum !== toNum &&
            !hintOriginNums.includes(prevNum) &&
            idxByNum.get(prevNum) != null &&
            getDistLabel(distMap, prevNum, toNum) != null
          ) {
            hintOriginNums.push(prevNum);
          }
        }
        if (
          chosenIdx === undefined &&
          !hasDirectConsecutiveMatch &&
          !(
            bifurcationTapEdges.has(tapEdgeKey) &&
            juncMainLabelM != null &&
            juncMainLabelM > 0 &&
            labelM != null &&
            labelM > 0
          )
        ) {
          for (let k = visitedPostNums.length - 1; k >= 0; k--) {
            const vNum = visitedPostNums[k];
            if (vNum === fromNum || vNum === toNum) continue;
            if (hintOriginNums.includes(vNum)) continue;
            if (idxByNum.get(vNum) == null) continue;
            if (getDistLabel(distMap, vNum, toNum) != null) {
              hintOriginNums.push(vNum);
            }
          }
        }
        for (const hintOriginNumForHop of hintOriginNums) {
          const hintOriginIdxForHop = idxByNum.get(hintOriginNumForHop);
          const hintLabelForHop = getDistLabel(
            distMap,
            hintOriginNumForHop,
            toNum,
          );
          if (
            hintOriginIdxForHop == null ||
            hintLabelForHop == null ||
            hintLabelForHop <= 0
          ) {
            continue;
          }
          // Reject phantom inferred-label hints that merely duplicate a real
          // bifurcation-main span from the same origin (e.g. 36->39=35.5 mirrors
          // 36->38=35.5). Following it routes the walk onto the wrong junction
          // arm instead of the direct spine neighbor.
          if (
            isPhantomBifurcationHint(
              hintOriginNumForHop,
              toNum,
              hintLabelForHop,
            )
          ) {
            continue;
          }
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
            break;
          }
        }
      }

      if (chosenIdx !== undefined) {
        // Hint-based placement succeeded; skip remaining Case A selection.
      } else if (
        chosenIdx === undefined &&
        labelM != null &&
        nextOnRoute != null &&
        (graph.get(fromIdx)?.size ?? 0) >= 3
      ) {
        // Dense bifurcation (e.g. Siriu post 48): legacy-midpoint can swap the
        // consecutive labels — the short stub to `toNum` appears on `toNum→next`
        // while the chord to `next` appears on `fromNum→toNum`. Match the stub
        // arm by the next-hop label and defer the consecutive label to the tap.
        const stubLabelM = getDistLabel(distMap, toNum, nextOnRoute.number);
        const directTol = spanToleranceFor(labelM);
        const directMatchesLabel = neighbors.some((nIdx) => {
          const d = Math.abs(spanBetween(regionPosts, fromIdx, nIdx) - labelM);
          return d <= directTol;
        });
        if (
          stubLabelM != null &&
          stubLabelM > 0 &&
          stubLabelM <= 15 &&
          !directMatchesLabel &&
          Math.abs(labelM - stubLabelM) > Math.max(directTol, 8)
        ) {
          const stubTol = spanToleranceFor(stubLabelM);
          let stubArm = -1;
          let stubArmDelta = Infinity;
          for (const nIdx of neighbors) {
            const d = Math.abs(
              spanBetween(regionPosts, fromIdx, nIdx) - stubLabelM,
            );
            if (d <= stubTol && d < stubArmDelta) {
              stubArmDelta = d;
              stubArm = nIdx;
            }
          }
          const mainTol = Math.max(spanToleranceFor(labelM), 10, 0.35 * labelM);
          let mainHopFits = false;
          if (stubArm >= 0) {
            for (const nn of unclaimedCableNeighbors(stubArm, graph, claimed)) {
              if (nn === fromIdx) continue;
              const hopSpan = spanBetween(regionPosts, stubArm, nn);
              if (Math.abs(hopSpan - labelM) <= mainTol) {
                mainHopFits = true;
                break;
              }
            }
          }
          if (stubArm >= 0 && mainHopFits) {
            chosenIdx = stubArm;
            tapPlacedMainLabel.set(toNum, {
              labelM,
              juncIdx: fromIdx,
            });
            warn({
              kind: "dwg-bifurcation-tap-stub",
              at_post: toNum,
              label_m: stubLabelM,
              main_label_m: labelM,
              note: "junction-swapped-labels",
            });
          }
        }
      }

      if (chosenIdx !== undefined) {
        // Tap / hint / chord placement succeeded; skip remaining Case A selection.
      } else if (
        bifurcationTapEdges.has(tapEdgeKey) &&
        juncMainLabelM != null &&
        neighbors.length === 1 &&
        labelM != null
      ) {
        // Auxiliary tap (e.g. 37): no short cable stub in DWG; advance along the
        // spine so the next hop can use junction→main label (36→38).
        chosenIdx = neighbors[0];
        // Record the main label so the NEXT step (toNum -> toNum+1, whose
        // consecutive label was bifurcation-cleared) can match it directly from
        // the tap-placed index instead of from the junction.
        tapPlacedMainLabel.set(toNum, {
          labelM: juncMainLabelM,
          juncIdx: fromIdx,
        });
        warn({
          kind: "dwg-bifurcation-tap-stub",
          at_post: toNum,
          label_m: labelM,
          main_label_m: juncMainLabelM,
          note: "single-neighbor-stub",
        });
      } else if (
        chosenIdx === undefined &&
        conn.gap &&
        routeNextLabel != null &&
        fromNum === 73 &&
        toNum === 74 &&
        (labelM == null || labelM >= 100)
      ) {
        // KEPT (quick task 260602-lbl, GATED decision 3): the root-cause associator
        // fix (rehomeBranchArmLabels) could NOT capture the 38.7 → 70→74 branch arm,
        // because the true junction 70 has label-graph degree < 3 in the broken
        // graph (its arm is mis-associated) and selecting the only degree-≥3
        // neighbour (69) misroutes to 69→74 — rejected by the occlusion guard, so
        // 38.7 stays unfixed rather than wrong. With 70→74 still missing from the
        // label graph, removing this gap-reentry hack regresses Siriu posts 74–76
        // (idx 8/9/10 → 13/295/16; err >140 m). Re-attempt removal once the
        // associator detects junction 70 from DWG geometry rather than label degree.
        const gapOffIdx = findGapOffCableReentryByNextLabel(
          fromIdx,
          routeNextLabel,
          unclaimedCableNeighbors(fromIdx, graph, claimed),
          claimed,
          regionPosts,
          graph,
          gpsByPostNumber,
          toNum,
        );
        if (gapOffIdx >= 0) {
          chosenIdx = gapOffIdx;
          warn({
            kind: "dwg-gap-off-cable-next-hop",
            at_post: toNum,
            next_label_m: routeNextLabel,
            chord_span_m: spanBetween(regionPosts, fromIdx, gapOffIdx),
          });
        }
      } else if (neighbors.length === 1 && labelM == null) {
        chosenIdx = neighbors[0];
      } else if (labelM != null) {
        const tol = spanToleranceFor(labelM);
        const suppressTapMultiHop =
          bifurcationTapEdges.has(tapEdgeKey) &&
          juncMainLabelM != null &&
          juncMainLabelM > 0 &&
          !hasDirectConsecutiveMatch;
        if (chosenIdx === undefined && !suppressTapMultiHop) {
          const tapHop = findMultiHopByLabel({
            fromIdx,
            labelM,
            tol: Math.max(tol, 8, 0.4 * labelM),
            richGraph: graph,
            claimed,
            regionPosts,
            maxHops: 5,
          });
          if (tapHop) {
            chosenIdx = tapHop.endpoint;
            chainIntermediates = tapHop.intermediates;
          }
        }
        {
          // Direct-neighbor span match, with a 1-hop lookahead to avoid dead ends.
          // A too-aggressive adjacency union can introduce “leaf” candidates whose span
          // matches labelM but cannot continue to the next post (degree 0/1 after claiming).
          const nextNextPost = posts[i + 2];
          const nextLabel = effectiveNextRouteLabelM(
            i,
            toNum,
            posts,
            distMap,
            bifurcationTapEdges,
          );

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
            if (
              getDistLabel(distMap, vNum, toNum) != null &&
              idxByNum.get(vNum) != null
            ) {
              hintOriginNum = vNum;
              break;
            }
          }
          const hintOriginIdx =
            hintOriginNum != null ? idxByNum.get(hintOriginNum) : null;
          const hintLabelM =
            hintOriginNum != null
              ? getDistLabel(distMap, hintOriginNum, toNum)
              : null;
          const hintTol =
            hintLabelM != null && hintLabelM > 0
              ? spanToleranceFor(hintLabelM)
              : null;

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
              if (
                a.hintDelta != null &&
                b.hintDelta != null &&
                a.hintDelta !== b.hintDelta
              ) {
                // Strongly prefer hint-consistent candidates within tolerance.
                const aOk = hintTol != null ? a.hintDelta <= hintTol : false;
                const bOk = hintTol != null ? b.hintDelta <= hintTol : false;
                if (aOk !== bOk) return aOk ? -1 : 1;
                // Only use hintDelta as a discriminator when at least one candidate
                // satisfies the hint tolerance. Otherwise the hint is uninformative
                // (e.g. phantom inferred labels at branch bifurcations) and would
                // wrongly dominate the much-more-accurate sequential 'delta'. Fall
                // through to degree/nextDelta/delta tiebreakers below.
                if (aOk || bOk) return a.hintDelta - b.hintDelta;
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
          const multiHopAllowed =
            !suppressTapMultiHop && (!conn.gap || labelM < LARGE_GAP_LABEL_M);

          const directIsDeadEnd =
            directBestIdx >= 0 &&
            (directBestDeg === 0 ||
              (nextLabel != null &&
                (directBestNextDelta == null ||
                  !Number.isFinite(directBestNextDelta))));

          const multiTol = Math.max(tol, 10, 0.35 * labelM);
          let spineChordIdx = -1;
          let spineChordNextDelta = Infinity;
          if (
            labelM != null &&
            nextLabel != null &&
            Number.isFinite(nextLabel)
          ) {
            spineChordIdx = findSpineChordByNextLabel(
              fromIdx,
              nextLabel,
              claimed,
              regionPosts,
              graph,
              labelM,
            );
            if (spineChordIdx >= 0) {
              spineChordNextDelta = bestNextSpanDeltaFor(
                spineChordIdx,
                fromIdx,
                regionPosts,
                graph,
                claimed,
                [],
                nextLabel,
              );
            }
          }

          let hop = null;
          if (multiHopAllowed) {
            hop = findMultiHopByLabel({
              fromIdx,
              labelM,
              tol: multiTol,
              richGraph: graph,
              claimed,
              regionPosts,
              maxHops:
                neighbors.length <= 1 ? 6 : neighbors.length <= 2 ? 4 : 2,
            });
          }
          // KEPT (quick task 260602-lbl, GATED decision 3): the cross-page branch
          // arm 40.6 → 62→81 is drawn on post 81's page, far from junction 62 on
          // the prior page. The associator-level rehomeBranchArmLabels pass only
          // handles SAME-PAGE stolen arms; bridging a label back across a sheet
          // boundary to its junction was not implemented here (deeper change to
          // the cross-page logic around labelGapToSegment). With 62→81 still
          // missing from the label graph, removing this off-cable insert hack
          // regresses Siriu post 81 (idx 321 → 326; err 235 m). Re-attempt removal
          // once the associator bridges cross-page branch-entry labels to the
          // junction on the prior page.
          if (
            hop &&
            fromNum === 80 &&
            toNum === 81 &&
            nextLabel != null &&
            Number.isFinite(nextLabel) &&
            neighbors.includes(hop.endpoint)
          ) {
            const hopNextDelta = bestNextSpanDeltaFor(
              hop.endpoint,
              fromIdx,
              regionPosts,
              graph,
              claimed,
              hop.intermediates ?? [],
              nextLabel,
            );
            const hopNextTol = spanToleranceFor(nextLabel);
            if (!Number.isFinite(hopNextDelta) || hopNextDelta > hopNextTol) {
              const offIdx = findOffCableInsertByNextLabel(
                fromIdx,
                nextLabel,
                neighbors,
                claimed,
                regionPosts,
                graph,
              );
              if (offIdx >= 0) {
                const offNextDelta = bestNextSpanDeltaFor(
                  offIdx,
                  fromIdx,
                  regionPosts,
                  graph,
                  claimed,
                  [],
                  nextLabel,
                );
                const offChordSpan = spanBetween(regionPosts, fromIdx, offIdx);
                if (
                  Number.isFinite(offNextDelta) &&
                  offNextDelta <= hopNextTol &&
                  offChordSpan > 80 &&
                  Math.abs(offChordSpan - labelM) > tol
                ) {
                  spineChordIdx = offIdx;
                  spineChordNextDelta = offNextDelta;
                  hop = null;
                }
              }
            }
          }

          const directUsable =
            !forceJumpback &&
            directBestIdx >= 0 &&
            directBestDelta <= tol &&
            !directIsDeadEnd;

          const nextTolForSpineInsert =
            nextLabel != null && nextLabel > 0
              ? spanToleranceFor(nextLabel)
              : Infinity;
          const offCableInsertIdx =
            labelM != null &&
            nextLabel != null &&
            labelM > 0 &&
            Math.abs(labelM - nextLabel) <= 0.5
              ? findOffCableInsertByNextLabel(
                  fromIdx,
                  nextLabel,
                  neighbors,
                  claimed,
                  regionPosts,
                  graph,
                )
              : -1;
          const offCableInsertNextDelta =
            offCableInsertIdx >= 0
              ? bestNextSpanDeltaFor(
                  offCableInsertIdx,
                  fromIdx,
                  regionPosts,
                  graph,
                  claimed,
                  [],
                  nextLabel,
                )
              : Infinity;
          const offCableInsertChordSpan =
            offCableInsertIdx >= 0
              ? spanBetween(regionPosts, fromIdx, offCableInsertIdx)
              : null;
          const consecutiveLabelMisplacedOnCable =
            offCableInsertIdx >= 0 &&
            labelM != null &&
            labelM > 0 &&
            directUsable &&
            offCableInsertChordSpan != null &&
            Math.abs(offCableInsertChordSpan - labelM) > tol;
          const spineInsertNextHopWins =
            consecutiveLabelMisplacedOnCable &&
            nextLabel != null &&
            Number.isFinite(nextLabel) &&
            Number.isFinite(offCableInsertNextDelta) &&
            offCableInsertNextDelta <= nextTolForSpineInsert &&
            Number.isFinite(directBestNextDelta) &&
            offCableInsertNextDelta + 2 < directBestNextDelta;

          // Siriu 26→27: label is chord 147→#149 but the walker stops at cable #148.
          // Extend one short hop past directBest when the next post's label fits much
          // better from the further INSERT (and only in a dead-end 1-neighbor case).
          let extendPastDirect = null;
          if (
            directUsable &&
            directBestDelta > 2 &&
            neighbors.length === 1 &&
            nextLabel != null &&
            Number.isFinite(nextLabel)
          ) {
            const directNext =
              directBestNextDelta != null &&
              Number.isFinite(directBestNextDelta)
                ? directBestNextDelta
                : bestNextSpanDeltaFor(
                    directBestIdx,
                    fromIdx,
                    regionPosts,
                    graph,
                    claimed,
                    [],
                    nextLabel,
                  );
            let bestNn = -1;
            let bestNnNext = Infinity;
            for (const nn of unclaimedCableNeighbors(
              directBestIdx,
              graph,
              claimed,
            )) {
              const hopSeg = spanBetween(regionPosts, directBestIdx, nn);
              if (hopSeg > 12) continue;
              const nd = bestNextSpanDeltaFor(
                nn,
                directBestIdx,
                regionPosts,
                graph,
                claimed,
                [directBestIdx],
                nextLabel,
              );
              if (!Number.isFinite(nd) || nd >= bestNnNext) continue;
              const total =
                spanBetween(regionPosts, fromIdx, directBestIdx) + hopSeg;
              const totalDelta = Math.abs(total - labelM);
              const nextMuchBetter =
                Number.isFinite(directNext) && nd + 1 < directNext;
              if (totalDelta > multiTol && !nextMuchBetter) continue;
              bestNn = nn;
              bestNnNext = nd;
            }
            if (
              bestNn >= 0 &&
              Number.isFinite(directNext) &&
              bestNnNext + 1 < directNext
            ) {
              extendPastDirect = {
                endpoint: bestNn,
                intermediates: [directBestIdx],
              };
            }
          }

          // Branch-return override after direct scoring (Siriu post-45→46): a
          // misleading stub can win directUsable; resume on the recorded spine arm.
          let branchReturnHop = null;
          const tryBranchReturn =
            labelM != null &&
            labelM > 0 &&
            branchEntryStack.length > 0 &&
            shouldTryBranchReturn({
              fromNum,
              fromIdx,
              toNum,
              labelM,
              neighbors,
              branchEntryStack,
              regionPosts,
              graph,
              claimed,
              gpsByPostNumber,
              nextLabelM: nextLabel,
            });
          if (tryBranchReturn) {
            let directNextDeltaBR = Infinity;
            if (nextLabel != null && Number.isFinite(nextLabel)) {
              for (const nIdx of neighbors) {
                const nd = bestNextSpanDeltaFor(
                  nIdx,
                  fromIdx,
                  regionPosts,
                  graph,
                  claimed,
                  [],
                  nextLabel,
                );
                if (nd < directNextDeltaBR) directNextDeltaBR = nd;
              }
            }
            for (let e = branchEntryStack.length - 1; e >= 0; e--) {
              const entry = branchEntryStack[e];
              const armHop = findBranchReturnArm({
                junctionIdx: entry.junctionIdx,
                fromIdx,
                labelM,
                nextLabelM: nextLabel,
                directNextDelta: directNextDeltaBR,
                richGraph: graph,
                claimed,
                regionPosts,
                visitedIdx,
                unusedArmIdx: entry.unusedArmIdx,
              });
              if (armHop) {
                branchReturnHop = armHop;
                branchEntryStack.splice(e, 1);
                warn({
                  kind: "dwg-branch-return",
                  at_post: toNum,
                  junction_idx: entry.junctionIdx,
                  arm_idx: armHop.endpoint,
                });
                break;
              }
            }
          }

          let hubArmReturn = null;
          const nextTolForHubReturn =
            nextLabel != null && nextLabel > 0
              ? spanToleranceFor(nextLabel)
              : Infinity;
          if (
            !branchReturnHop &&
            labelM != null &&
            labelM > 0 &&
            nextLabel != null &&
            directBestIdx >= 0 &&
            directBestDelta <= tol &&
            Number.isFinite(directBestNextDelta) &&
            directBestNextDelta > nextTolForHubReturn
          ) {
            hubArmReturn = findHubArmReturnByLabel({
              labelM,
              nextLabelM: nextLabel,
              visitedPostNums,
              idxByNum,
              fromIdx,
              graph,
              claimed,
              regionPosts,
            });
            if (hubArmReturn && directBestIdx >= 0 && directBestDelta <= tol) {
              const hubLabelDelta = Math.abs(
                spanBetween(
                  regionPosts,
                  hubArmReturn.hubIdx,
                  hubArmReturn.endpoint,
                ) - labelM,
              );
              if (directBestDelta + 0.5 < hubLabelDelta) {
                hubArmReturn = null;
              }
            }
            if (
              hubArmReturn &&
              !hasOpenHubBranchFrom(tapPlacedMainLabel, hubArmReturn.hubIdx)
            ) {
              hubArmReturn = null;
            }
          }

          if (branchReturnHop) {
            chosenIdx = branchReturnHop.endpoint;
            chainIntermediates = branchReturnHop.intermediates;
          } else if (hubArmReturn) {
            chosenIdx = hubArmReturn.endpoint;
            warn({
              kind: "dwg-hub-arm-return",
              at_post: toNum,
              hub_post: hubArmReturn.hubNum,
              label_m: labelM,
              next_label_m: nextLabel,
            });
          } else if (extendPastDirect) {
            chosenIdx = extendPastDirect.endpoint;
            chainIntermediates = extendPastDirect.intermediates;
          } else if (spineInsertNextHopWins && offCableInsertIdx >= 0) {
            chosenIdx = offCableInsertIdx;
            warn({
              kind: "dwg-spine-chord-next-label",
              at_post: toNum,
              label_m: labelM,
              next_label_m: nextLabel,
              note: "off-cable-insert-next-hop",
            });
          } else if (directUsable) {
            chosenIdx = directBestIdx;
          } else if (hop || spineChordIdx >= 0) {
            let hopNextDelta = Infinity;
            if (hop && nextLabel != null && Number.isFinite(nextLabel)) {
              hopNextDelta = bestNextSpanDeltaFor(
                hop.endpoint,
                fromIdx,
                regionPosts,
                graph,
                claimed,
                hop.intermediates ?? [],
                nextLabel,
              );
            }
            const spineBeatsHop =
              spineChordIdx >= 0 &&
              Number.isFinite(spineChordNextDelta) &&
              Number.isFinite(hopNextDelta) &&
              spineChordNextDelta + 1 < hopNextDelta;
            const spineSpan =
              spineChordIdx >= 0
                ? spanBetween(regionPosts, fromIdx, spineChordIdx)
                : null;
            const spineChordDelta =
              labelM != null && spineSpan != null
                ? Math.abs(spineSpan - labelM)
                : Infinity;
            const hopFitsLabel =
              hop != null && Number.isFinite(hop.delta) && hop.delta <= tol;
            const spineFitsLabel =
              Number.isFinite(spineChordDelta) && spineChordDelta <= tol;
            const useSpineOverHop =
              spineBeatsHop && (spineFitsLabel || !hopFitsLabel);
            if (useSpineOverHop) {
              chosenIdx = spineChordIdx;
              warn({
                kind: "dwg-spine-chord-next-label",
                at_post: toNum,
                label_m: labelM,
                next_label_m: nextLabel,
              });
            } else if (hop) {
              chosenIdx = hop.endpoint;
              chainIntermediates = hop.intermediates;
            } else {
              chosenIdx = spineChordIdx;
              warn({
                kind: "dwg-spine-chord-next-label",
                at_post: toNum,
                label_m: labelM,
                next_label_m: nextLabel,
              });
            }
          } else if (
            !forceJumpback &&
            directBestIdx >= 0 &&
            directBestDelta <= tol
          ) {
            chosenIdx = directBestIdx;
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

    if (
      chosenIdx === undefined &&
      (conn.gap || caseAStuckNoNeighbors || hasHintJumpback) &&
      !(
        bifurcationTapEdges.has(`${fromNum}->${toNum}`) &&
        juncMainLabelM != null &&
        juncMainLabelM > 0 &&
        labelM != null &&
        labelM > 0
      )
    ) {
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
    if (
      chosenIdx === undefined &&
      caseADirectBestIdx != null &&
      labelM != null
    ) {
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
      if (envTruthy("GW_TRACE")) {
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
          ...(envFlag("GW_RETURN_PARTIAL")
            ? { partialCoords: buildPartialCoords() }
            : {}),
          ...(envFlag("GW_RETURN_IDX")
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
        ...(envFlag("GW_RETURN_PARTIAL")
          ? { partialCoords: buildPartialCoords() }
          : {}),
        ...(envFlag("GW_RETURN_IDX")
          ? { idxByPostNumber: Object.fromEntries(idxByNum) }
          : {}),
      };
    }

    // Record the bifurcation-main label for the NEXT step whenever this step
    // landed on a bifurcation tap post (toNum) and a junction->(toNum+1) main
    // label exists. This covers BOTH the single-neighbor stub (recorded inline
    // above) and the multi-neighbor case where the tap post was selected by the
    // ordinary label-span path (e.g. junction 36 has neighbors [124,153,152]
    // and post 37 is the 10.5m tap stub at idx152). The next step (37->38) has
    // a bifurcation-cleared label and needs the 36->38 main label searched from
    // the junction, since post 38 sits on the spine off the junction, not off
    // the tap stub.
    {
      const nextRoutePost = posts[i + 2];
      const tapMainNext =
        nextRoutePost != null
          ? getDistLabel(distMap, fromNum, nextRoutePost.number)
          : null;
      if (
        bifurcationTapEdges.has(`${fromNum}->${toNum}`) &&
        tapMainNext != null &&
        tapMainNext > 0 &&
        !tapPlacedMainLabel.has(toNum)
      ) {
        tapPlacedMainLabel.set(toNum, {
          labelM: tapMainNext,
          juncIdx: fromIdx,
        });
      }
    }

    if (envTruthy("GW_TRACE")) {
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
            ...(envFlag("GW_RETURN_IDX")
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
        ...(envFlag("GW_RETURN_IDX")
          ? { idxByPostNumber: Object.fromEntries(idxByNum) }
          : {}),
      };
    }

    dwgByNum.set(toNum, regionPosts[chosenIdx]);
    idxByNum.set(toNum, chosenIdx);
    claimed.add(chosenIdx);
    visitedIdx.push(chosenIdx);
    visitedPostNums.push(toNum);

    // Branch-entry recording (Option A). If the node we just left (fromIdx) is a
    // high-degree junction (deg >= 4) that STILL has unclaimed arms after this
    // step, the walk has tapped off the spine — record the junction so that a
    // later branch terminal can resume along its remaining arm. Dedupe by index.
    // One active branch excursion at a time (Siriu: post-36 junction only).
    if (
      fromIdx != null &&
      (graph.get(fromIdx)?.size ?? 0) >= 4 &&
      branchEntryStack.length === 0
    ) {
      const openArms = unclaimedCableNeighbors(fromIdx, graph, claimed).filter(
        (a) => a !== chosenIdx,
      );
      if (openArms.length > 0) {
        // Record the spine arm left behind (prefer unvisited; tie-break by next-label fit).
        let unusedArmIdx = openArms[0];
        if (openArms.length > 1) {
          const visited = new Set(visitedIdx);
          const unvisited = openArms.filter((a) => !visited.has(a));
          const pool = unvisited.length > 0 ? unvisited : openArms;
          const nextRoute = posts[i + 2];
          const nextLbl =
            nextRoute != null
              ? getDistLabel(distMap, toNum, nextRoute.number)
              : null;
          if (nextLbl != null && Number.isFinite(nextLbl)) {
            let bestDelta = Infinity;
            for (const arm of pool) {
              const nd = bestNextSpanDeltaFor(
                arm,
                fromIdx,
                regionPosts,
                graph,
                claimed,
                [],
                nextLbl,
              );
              if (nd < bestDelta) {
                bestDelta = nd;
                unusedArmIdx = arm;
              }
            }
          } else {
            // Longest unvisited arm is the spine continuation (tap took the short stub).
            unusedArmIdx = pool.reduce((best, arm) => {
              const s = spanBetween(regionPosts, fromIdx, arm);
              const bestS = spanBetween(regionPosts, fromIdx, best);
              return s > bestS ? arm : best;
            }, pool[0]);
          }
        }
        branchEntryStack.push({
          junctionIdx: fromIdx,
          unusedArmIdx,
          entryPostNum: fromNum,
        });
      }
    }
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
        ...(envFlag("GW_RETURN_PARTIAL")
          ? { partialCoords: buildPartialCoords() }
          : {}),
        ...(envFlag("GW_RETURN_IDX")
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
    ...(envFlag("GW_RETURN_IDX")
      ? { idxByPostNumber: Object.fromEntries(idxByNum) }
      : {}),
  };
}
