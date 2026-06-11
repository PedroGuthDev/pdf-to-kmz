import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  checkTopologyGate,
  evaluateAcceptBar,
  solveGlobalGraphAlignment,
} from "../dwg/global-solver.js";
import {
  buildAdjacencyGraph,
  buildPostIndex,
} from "../dwg/region-pairing.js";
import { medianCrossValidate } from "../dwg/median-crossval.js";
import { utmToLatLon } from "../geo/utm-calibrator.js";

const ANCHOR_E = 730000;
const ANCHOR_N = 6900000;
const ZONE = 22;
const SPAN = 40;

function makeDxfNode(idx, dx, dy, block = `N${idx}`) {
  return { x: ANCHOR_E + dx, y: ANCHOR_N + dy, block };
}

function makeLineRegion(nodeCount, spanM = SPAN) {
  const regionPosts = [];
  for (let i = 0; i < nodeCount; i++) {
    regionPosts.push(makeDxfNode(i, i * spanM, 0));
  }
  const regionEdges = [];
  for (let i = 0; i < nodeCount - 1; i++) {
    regionEdges.push({
      a: { x: regionPosts[i].x, y: regionPosts[i].y },
      b: { x: regionPosts[i + 1].x, y: regionPosts[i + 1].y },
    });
  }
  return { regionPosts, regionEdges };
}

function makeForkRegion() {
  const regionPosts = [
    makeDxfNode(0, 0, 0),
    makeDxfNode(1, SPAN, 0),
    makeDxfNode(2, 2 * SPAN, 0),
    makeDxfNode(3, 3 * SPAN, 0),
    makeDxfNode(4, 4 * SPAN, 0),
    makeDxfNode(5, 5 * SPAN, 0),
    makeDxfNode(6, 6 * SPAN, 0),
    makeDxfNode(7, 4 * SPAN, SPAN),
    makeDxfNode(8, 4 * SPAN, 2 * SPAN),
  ];
  const regionEdges = [
    { a: regionPosts[0], b: regionPosts[1] },
    { a: regionPosts[1], b: regionPosts[2] },
    { a: regionPosts[2], b: regionPosts[3] },
    { a: regionPosts[3], b: regionPosts[4] },
    { a: regionPosts[4], b: regionPosts[5] },
    { a: regionPosts[5], b: regionPosts[6] },
    { a: regionPosts[4], b: regionPosts[7] },
    { a: regionPosts[7], b: regionPosts[8] },
  ];
  return { regionPosts, regionEdges };
}

function buildTopologyInputs({
  posts,
  connections,
  assignments,
  junctions = new Set(),
  authoritativeDegreeByPost,
  regionPosts,
  regionEdges,
}) {
  const postIndex = buildPostIndex(regionPosts);
  const postToIdx = new Map();
  for (let i = 0; i < regionPosts.length; i++) {
    postToIdx.set(regionPosts[i], i);
  }
  const adjacencyGraph = buildAdjacencyGraph(regionPosts, regionEdges, {
    postIndex,
    postToIdx,
  });
  const distances = connections.map((c) => ({
    from: c.from,
    to: c.to,
    meters: c.meters ?? SPAN,
    source: c.source,
  }));
  const scale = medianCrossValidate({ distances, regionEdges });
  assert.equal(scale.ok, true, "fixture medians must agree");
  const coords = [...assignments.entries()].map(([postNumber, node]) => {
    const { lat, lon } = utmToLatLon(node.x, node.y, ZONE);
    return { postNumber, lat, lon, source: "dwg", dwg_block: node.block };
  });
  coords.sort((a, b) => a.postNumber - b.postNumber);
  return {
    coords,
    assignments,
    posts,
    connections,
    junctions,
    authoritativeDegreeByPost,
    adjacencyGraph,
    regionPosts,
    regionEdges,
    postToIdx,
    tolerances: scale.tolerances,
  };
}

describe("checkTopologyGate — D-10 monotonicity + D-11 hub-degree", () => {
  it("linear route with correct order passes monotonicity", () => {
    const { regionPosts, regionEdges } = makeLineRegion(4);
    const posts = [1, 2, 3, 4].map((n) => ({ number: n }));
    const connections = [
      { from: 1, to: 2 },
      { from: 2, to: 3 },
      { from: 3, to: 4 },
    ];
    const assignments = new Map([
      [1, regionPosts[0]],
      [2, regionPosts[1]],
      [3, regionPosts[2]],
      [4, regionPosts[3]],
    ]);
    const result = checkTopologyGate(
      buildTopologyInputs({ posts, connections, assignments, regionPosts, regionEdges }),
    );
    assert.equal(result.ok, true);
  });

  it("junction reset: legitimate fork passes (non-global monotonicity)", () => {
    const { regionPosts, regionEdges } = makeForkRegion();
    const posts = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ number: n }));
    const connections = [
      { from: 1, to: 2 },
      { from: 2, to: 3 },
      { from: 3, to: 4 },
      { from: 4, to: 5 },
      { from: 5, to: 6 },
      { from: 6, to: 7 },
      { from: 5, to: 8 },
      { from: 8, to: 9 },
    ];
    const assignments = new Map([
      [1, regionPosts[0]],
      [2, regionPosts[1]],
      [3, regionPosts[2]],
      [4, regionPosts[3]],
      [5, regionPosts[4]],
      [6, regionPosts[5]],
      [7, regionPosts[6]],
      [8, regionPosts[7]],
      [9, regionPosts[8]],
    ]);
    const result = checkTopologyGate(
      buildTopologyInputs({
        posts,
        connections,
        assignments,
        junctions: new Set([5]),
        regionPosts,
        regionEdges,
      }),
    );
    assert.equal(result.ok, true);
  });

  it("uniform-spacing swap rejects with monotonicity reason", () => {
    const { regionPosts, regionEdges } = makeLineRegion(4);
    const posts = [1, 2, 3, 4].map((n) => ({ number: n }));
    const connections = [
      { from: 1, to: 2 },
      { from: 2, to: 3 },
      { from: 3, to: 4 },
    ];
    const assignments = new Map([
      [1, regionPosts[0]],
      [2, regionPosts[2]],
      [3, regionPosts[1]],
      [4, regionPosts[3]],
    ]);
    const result = checkTopologyGate(
      buildTopologyInputs({ posts, connections, assignments, regionPosts, regionEdges }),
    );
    assert.equal(result.ok, false);
    assert.match(result.reason, /monotonicity/);
  });

  it("hub-degree: junction post on hub DXF node passes", () => {
    const { regionPosts, regionEdges } = makeForkRegion();
    const posts = [{ number: 5 }];
    const connections = [
      { from: 4, to: 5 },
      { from: 5, to: 6 },
      { from: 5, to: 8 },
    ];
    const assignments = new Map([[5, regionPosts[4]]]);
    const authoritativeDegreeByPost = new Map([[5, 3]]);
    const result = checkTopologyGate(
      buildTopologyInputs({
        posts,
        connections,
        assignments,
        junctions: new Set([5]),
        authoritativeDegreeByPost,
        regionPosts,
        regionEdges,
      }),
    );
    assert.equal(result.ok, true);
  });

  it("hub-degree: junction post on degree-1 DXF tip rejects", () => {
    const { regionPosts, regionEdges } = makeForkRegion();
    const posts = [{ number: 5 }];
    const connections = [
      { from: 4, to: 5 },
      { from: 5, to: 6 },
      { from: 5, to: 8 },
    ];
    const assignments = new Map([[5, regionPosts[0]]]);
    const authoritativeDegreeByPost = new Map([[5, 3]]);
    const result = checkTopologyGate(
      buildTopologyInputs({
        posts,
        connections,
        assignments,
        junctions: new Set([5]),
        authoritativeDegreeByPost,
        regionPosts,
        regionEdges,
      }),
    );
    assert.equal(result.ok, false);
    assert.match(result.reason, /hub-degree:5/);
  });

  it("hub-degree buckets raw DXF degree 5 and 3 both as hub (≥3)", () => {
    const hubNode = makeDxfNode(0, 0, 0);
    const spurA = makeDxfNode(1, SPAN, 0);
    const spurB = makeDxfNode(2, 0, SPAN);
    const spurC = makeDxfNode(3, -SPAN, 0);
    const spurD = makeDxfNode(4, 0, -SPAN);
    const regionPosts = [hubNode, spurA, spurB, spurC, spurD];
    const regionEdges = [
      { a: hubNode, b: spurA },
      { a: hubNode, b: spurB },
      { a: hubNode, b: spurC },
      { a: hubNode, b: spurD },
      { a: spurA, b: spurB },
    ];
    const posts = [{ number: 10 }];
    const connections = [
      { from: 10, to: 11, source: "bifurcation-main" },
      { from: 10, to: 12, source: "bifurcation-main" },
      { from: 10, to: 13, source: "bifurcation-main" },
    ];
    const authoritativeDegreeByPost = new Map([[10, 3]]);
    const assignments = new Map([[10, hubNode]]);
    const result = checkTopologyGate(
      buildTopologyInputs({
        posts,
        connections,
        assignments,
        authoritativeDegreeByPost,
        regionPosts,
        regionEdges,
      }),
    );
    assert.equal(result.ok, true);
  });

  it("authoritative-degree: inferred-label phantom does not promote degree class", () => {
    const { regionPosts, regionEdges } = makeLineRegion(3);
    const posts = [{ number: 2 }];
    const connections = [{ from: 1, to: 2 }, { from: 2, to: 3 }];
    const distances = [
      { from: 1, to: 2, meters: SPAN, source: "bifurcation-main" },
      { from: 2, to: 3, meters: SPAN, source: "bifurcation-main" },
      { from: 2, to: 99, meters: SPAN, source: "inferred-label" },
      { from: 2, to: 98, meters: SPAN, source: "inferred-label" },
    ];
    const authoritativeDegreeByPost = new Map([[2, 2]]);
    const assignments = new Map([[2, regionPosts[1]]]);
    const input = buildTopologyInputs({
      posts,
      connections: distances,
      assignments,
      authoritativeDegreeByPost,
      regionPosts,
      regionEdges,
    });
    const result = checkTopologyGate(input);
    assert.equal(result.ok, true);
  });
});

describe("solveGlobalGraphAlignment — D-05 accept bar", () => {
  function makeSolverInputsWithGps({
    postCount = 3,
    nodeCount = 3,
    spanM = SPAN,
    gpsOffsetM = 0,
  } = {}) {
    const anchor = utmToLatLon(ANCHOR_E, ANCHOR_N, ZONE);
    const { regionPosts, regionEdges } = makeLineRegion(nodeCount, spanM);
    const posts = Array.from({ length: postCount }, (_, i) => ({
      number: i + 1,
      x: 0,
      y: 0,
      page: 1,
    }));
    const distances = [];
    const connections = [];
    for (let i = 1; i < postCount; i++) {
      distances.push({ from: i, to: i + 1, meters: spanM });
      connections.push({ from: i, to: i + 1 });
    }
    const gpsByPostNumber = new Map();
    for (let i = 0; i < postCount; i++) {
      const ll = utmToLatLon(
        regionPosts[i].x + gpsOffsetM,
        regionPosts[i].y,
        ZONE,
      );
      gpsByPostNumber.set(i + 1, ll);
    }
    const postIndex = buildPostIndex(regionPosts);
    const adjacencyGraph = buildAdjacencyGraph(regionPosts, regionEdges, {
      postIndex,
    });
    return {
      posts,
      distances,
      connections,
      startLat: anchor.lat,
      startLon: anchor.lon,
      regionData: { crs: { zone: ZONE } },
      regionPosts,
      regionEdges,
      postIndex,
      adjacencyGraph,
      gpsByPostNumber,
      junctions: new Set(),
    };
  }

  it("accepts despite a hard-fail anchor band — anchor gap is the PDF's own georef error", () => {
    // Acceptance is SHAPE-driven: the anchor sub-score measures DWG-vs-PDF
    // disagreement, whose floor is the PDF's own georeferencing error (LC's
    // correct solve inherits ~90 m of PDF seam drift). The solve is pinned at
    // the user-provided post-1 GPS, so a uniform PDF offset must not veto it.
    // The full residual (incl. the anchor "fail") still surfaces downstream
    // as solverScore for confidence tiering.
    const inputs = makeSolverInputsWithGps({ gpsOffsetM: 500 });
    const result = solveGlobalGraphAlignment(inputs);
    assert.equal(result.ok, true);
    assert.equal(result.solverScore?.gateDecision, "fail");
    assert.equal(result.coords.length, 3);
  });

  it("demotes when the shape sub-score fails (printed spans misfit solved nodes)", () => {
    // Printed labels 2x the real DXF spacing: whatever nodes the solver
    // lands on, |span - printed|/printed stays >> SOLVER_SHAPE_ACCEPT, so
    // level-0 must demote (reason residual-gate) rather than ship a solve
    // whose chain contradicts the printed evidence.
    const inputs = makeSolverInputsWithGps({ gpsOffsetM: 0 });
    for (const d of inputs.distances) d.meters = SPAN * 2;
    const result = solveGlobalGraphAlignment(inputs);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "residual-gate");
  });

  it("accepts a fallback-band residual (anchor gap 10-20 m) — Valmor case", () => {
    // PDF GPS ~12 m off the DXF nodes: anchor p95 lands in the 10-20 m
    // fallback band. The PDF's own georeferencing floor makes "trust"
    // unreachable for any correct solve, so fallback must be accepted.
    const inputs = makeSolverInputsWithGps({ gpsOffsetM: 12 });
    const result = solveGlobalGraphAlignment(inputs);
    assert.equal(result.ok, true);
    assert.equal(result.solverScore?.gateDecision, "fallback");
    assert.equal(result.coords.length, 3);
  });

  it("demotes when topology gate fails", () => {
    const { regionPosts, regionEdges } = makeLineRegion(4);
    const posts = [1, 2, 3, 4].map((n) => ({ number: n }));
    const connections = [
      { from: 1, to: 2 },
      { from: 2, to: 3 },
      { from: 3, to: 4 },
    ];
    const goodAssignments = new Map([
      [1, regionPosts[0]],
      [2, regionPosts[1]],
      [3, regionPosts[2]],
      [4, regionPosts[3]],
    ]);
    const badAssignments = new Map([
      [1, regionPosts[0]],
      [2, regionPosts[2]],
      [3, regionPosts[1]],
      [4, regionPosts[3]],
    ]);
    const topoInput = buildTopologyInputs({
      posts,
      connections,
      assignments: goodAssignments,
      regionPosts,
      regionEdges,
    });
    const coords = topoInput.coords;
    const distances = connections.map((c) => ({
      from: c.from,
      to: c.to,
      meters: SPAN,
    }));
    const gpsByPostNumber = new Map(
      coords.map((c) => [c.postNumber, { lat: c.lat, lon: c.lon }]),
    );
    const accept = evaluateAcceptBar({
      coords,
      distances,
      gpsByPostNumber,
      posts,
      assignments: badAssignments,
      connections,
      junctions: new Set(),
      adjacencyGraph: topoInput.adjacencyGraph,
      regionPosts,
      postToIdx: topoInput.postToIdx,
      tolerances: topoInput.tolerances,
      elapsedMs: 10,
    });
    assert.equal(accept.ok, false);
    assert.match(accept.reason, /monotonicity/);
  });

  it("demotes when elapsedMs >= 2000", () => {
    const inputs = makeSolverInputsWithGps();
    let calls = 0;
    const origNow = performance.now.bind(performance);
    performance.now = () => {
      calls += 1;
      return calls === 1 ? 0 : 2500;
    };
    try {
      const result = solveGlobalGraphAlignment(inputs);
      assert.equal(result.ok, false);
      assert.equal(result.reason, "budget");
    } finally {
      performance.now = origNow;
    }
  });
});
