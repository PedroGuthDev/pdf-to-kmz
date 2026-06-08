/**
 * Cascade level-0 integration: solveGlobalGraphAlignment → demote → pairPostsByGraphWalk.
 * Run: node --test parser/__tests__/global-solver-cascade.test.mjs
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { calculateCoordinates } from "../coordinate-calculator.js";
import { deduplicatePostsPreferLowerPage } from "../post-assembler.js";
import {
  buildAdjacencyGraph,
  buildPostIndex,
} from "../dwg/region-pairing.js";
import { pairPostsByGraphWalk } from "../dwg/graph-walker.js";
import { cropRegionToBbox, routeUtmBbox } from "../dwg/region-crop.js";
import { runDwgPairingCascade } from "../dwg/coordinate-calculator-dwg.js";
import groundTruth from "./fixtures/siriu-ground-truth.json" with { type: "json" };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "fixtures");

const WALKER_COORDS = [
  { postNumber: 1, lat: -28.01, lon: -48.61, source: "dwg", dwg_block: "walker" },
];
const SOLVER_COORDS = [
  { postNumber: 1, lat: -28.02, lon: -48.62, source: "dwg", dwg_block: "solver" },
];

function objectToMap(o) {
  if (o == null) return null;
  if (o instanceof Map) return o;
  const m = new Map();
  for (const [k, v] of Object.entries(o)) m.set(Number.isFinite(+k) ? +k : k, v);
  return m;
}

function makeCascadeInputs(overrides = {}) {
  const regionPosts = overrides.regionPosts ?? [
    { x: 730000, y: 6900000, block: "P1" },
  ];
  const postIndex = buildPostIndex(regionPosts);
  return {
    posts: [{ number: 1, x: 0, y: 0, page: 1 }],
    distances: [],
    connections: [],
    startLat: groundTruth[0].lat,
    startLon: groundTruth[0].lon,
    regionData: { crs: { zone: 22 } },
    regionPosts,
    regionEdges: [],
    postIndex,
    adjacencyGraph: buildAdjacencyGraph(regionPosts, [], { postIndex }),
    warnings: [],
    gpsByPostNumber: new Map([[1, { lat: groundTruth[0].lat, lon: groundTruth[0].lon }]]),
    ...overrides,
  };
}

function coordsKey(coords) {
  return [...coords]
    .sort((a, b) => a.postNumber - b.postNumber)
    .map((c) => `${c.postNumber}:${c.lat?.toFixed(7)},${c.lon?.toFixed(7)}`)
    .join("|");
}

describe("runDwgPairingCascade — level-0 solver (injected deps)", () => {
  let walkerCallCount = 0;
  let walkerReceivedArgs = null;
  let solverImpl = () => ({ ok: false, reason: "residual-gate" });
  let logLines = [];
  let origLog;

  beforeEach(() => {
    walkerCallCount = 0;
    walkerReceivedArgs = null;
    logLines = [];
    origLog = console.log;
    console.log = (...args) => {
      logLines.push(args.join(" "));
      origLog(...args);
    };
  });

  afterEach(() => {
    console.log = origLog;
  });

  function testDeps() {
    return {
      solve: (...args) => solverImpl(...args),
      walk: (args) => {
        walkerCallCount++;
        walkerReceivedArgs = structuredClone(args);
        return { ok: true, coords: WALKER_COORDS };
      },
    };
  }

  it("accept: solver ok → global-solve, walker not called", () => {
    solverImpl = () => ({
      ok: true,
      coords: SOLVER_COORDS,
      solverScore: { shape: "trust", anchor: "trust" },
      elapsedMs: 12,
    });

    const result = runDwgPairingCascade({
      ...makeCascadeInputs(),
      _testDeps: testDeps(),
    });

    assert.equal(result.ok, true);
    assert.equal(result.dwgPath, "global-solve");
    assert.equal(walkerCallCount, 0);
    assert.deepEqual(result.coords, SOLVER_COORDS);
    assert.equal(result.solverDemoted, false);
    assert.equal(result.demotionReason, null);
    assert.ok(result.solverScore);
  });

  it("demotion: solver fail → logs message, walker called once", () => {
    solverImpl = () => ({ ok: false, reason: "hub-degree:7" });
    const warnings = [];

    const result = runDwgPairingCascade({
      ...makeCascadeInputs(),
      warnings,
      _testDeps: testDeps(),
    });

    assert.equal(result.ok, true);
    assert.equal(result.dwgPath, "dwg-graph-walk");
    assert.equal(walkerCallCount, 1);
    assert.ok(
      logLines.some((l) => l.includes("solver demoted; using graph-walker")),
      `expected demotion log, got: ${logLines.join("; ")}`,
    );
    assert.equal(result.solverDemoted, true);
    assert.equal(result.demotionReason, "hub-degree:7");
    const demoteWarn = warnings.find((w) => w.kind === "dwg-solver-demoted");
    assert.ok(demoteWarn);
    assert.equal(demoteWarn.reason, "hub-degree:7");
  });

  it("pristine input: walker receives same params as cascade (demotion)", () => {
    solverImpl = () => ({ ok: false, reason: "topology" });
    const inputs = makeCascadeInputs();
    const pristine = structuredClone({
      posts: inputs.posts,
      distances: inputs.distances,
      connections: inputs.connections,
      startLat: inputs.startLat,
      startLon: inputs.startLon,
      regionPosts: inputs.regionPosts,
      regionEdges: inputs.regionEdges,
      gpsByPostNumber: [...inputs.gpsByPostNumber.entries()],
    });

    runDwgPairingCascade({ ...inputs, _testDeps: testDeps() });

    assert.equal(walkerCallCount, 1);
    assert.deepEqual(walkerReceivedArgs.posts, pristine.posts);
    assert.deepEqual(walkerReceivedArgs.distances, pristine.distances);
    assert.deepEqual(walkerReceivedArgs.connections, pristine.connections);
    assert.equal(walkerReceivedArgs.startLat, pristine.startLat);
    assert.equal(walkerReceivedArgs.startLon, pristine.startLon);
    assert.deepEqual(walkerReceivedArgs.region.posts, pristine.regionPosts);
    assert.deepEqual(walkerReceivedArgs.region.cableEdges, pristine.regionEdges);
    assert.deepEqual(
      [...walkerReceivedArgs.gpsByPostNumber.entries()],
      pristine.gpsByPostNumber,
    );
  });
});

describe("runDwgPairingCascade — Siriu byte-identical coords", () => {
  it("emitted coords match pristine graph-walker output", () => {
    const topo = JSON.parse(
      readFileSync(path.join(FIXTURES, "siriu-topology.json"), "utf8"),
    );
    const dwg = JSON.parse(
      readFileSync(path.join(FIXTURES, "siriu-dwg-region.json"), "utf8"),
    );

    const start = groundTruth[0];
    const pdfResult = calculateCoordinates(
      topo.posts,
      topo.distances,
      start.lat,
      start.lon,
      topo.cableSegments ?? [],
      {
        pageDimensions: objectToMap(topo.pageDimensions),
        viewportBoxes: topo.viewportBoxes ?? [],
        utmGridPathsPerPage: objectToMap(topo.utmGridPathsPerPage),
        distanceLabelItems: topo.distanceLabelItems ?? [],
      },
    );

    const routePosts = deduplicatePostsPreferLowerPage(
      pdfResult.posts ?? topo.posts,
    ).sort((a, b) => a.number - b.number);
    const connections = pdfResult.walkConnections ?? pdfResult.connections ?? [];
    const regionData = {
      crs: { zone: 22 },
      posts: dwg.posts ?? [],
      cableEdges: dwg.cableEdges ?? [],
    };
    const routeBbox = routeUtmBbox(
      [{ lat: start.lat, lon: start.lon }, ...routePosts],
      22,
      200,
    );
    const croppedRegion = cropRegionToBbox(regionData, routeBbox);
    const regionPosts = croppedRegion.posts ?? [];
    const regionEdges = croppedRegion.cableEdges ?? [];
    const postIndex = buildPostIndex(regionPosts);
    const adjacencyGraph = buildAdjacencyGraph(regionPosts, regionEdges, {
      postIndex,
    });

    const gpsByPostNumber = new Map();
    for (const p of pdfResult.posts ?? []) {
      if (p.lat != null && p.lon != null) {
        gpsByPostNumber.set(p.number, { lat: p.lat, lon: p.lon });
      }
    }

    const cascadeInputs = {
      posts: routePosts,
      distances: topo.distances ?? [],
      connections,
      startLat: start.lat,
      startLon: start.lon,
      regionData,
      regionPosts,
      regionEdges,
      postIndex,
      adjacencyGraph,
      warnings: [],
      gpsByPostNumber,
    };

    const prevIdx = process.env.GW_RETURN_IDX;
    process.env.GW_RETURN_IDX = "1";
    const walkerOnly = pairPostsByGraphWalk({
      posts: cascadeInputs.posts,
      distances: cascadeInputs.distances,
      connections: cascadeInputs.connections,
      startLat: cascadeInputs.startLat,
      startLon: cascadeInputs.startLon,
      region: {
        posts: regionPosts,
        cableEdges: regionEdges,
      },
      postIndex,
      adjacencyGraph,
      warnings: [],
      gpsByPostNumber,
    });
    if (prevIdx == null) delete process.env.GW_RETURN_IDX;
    else process.env.GW_RETURN_IDX = prevIdx;
    assert.equal(walkerOnly.ok, true, "Siriu walker baseline must succeed");

    const cascade = runDwgPairingCascade(cascadeInputs);
    assert.equal(cascade.ok, true, "cascade must succeed on Siriu fixture");

    assert.equal(
      coordsKey(cascade.coords),
      coordsKey(walkerOnly.coords),
      `coords differ: cascade path=${cascade.dwgPath}`,
    );
  });
});

describe("calculateCoordinatesWithDwg — D-13 fields on success", () => {
  it("exposes solverPath, solverDemoted, demotionReason, solverScore", async () => {
    const topo = JSON.parse(
      readFileSync(path.join(FIXTURES, "siriu-topology.json"), "utf8"),
    );
    const dwg = JSON.parse(
      readFileSync(path.join(FIXTURES, "siriu-dwg-region.json"), "utf8"),
    );
    const start = groundTruth[0];
    const bundle = {
      id: "siriu",
      posts: dwg.posts,
      cableEdges: dwg.cableEdges,
      crs: { zone: 22 },
      postIndex: buildPostIndex(dwg.posts),
      adjacencyGraph: buildAdjacencyGraph(dwg.posts, dwg.cableEdges),
    };
    const library = {
      async lookupByGps() {
        return { id: "siriu" };
      },
      async getRegionWithIndex(id) {
        return id === "siriu" ? bundle : null;
      },
    };

    const { calculateCoordinatesWithDwg } = await import(
      "../dwg/coordinate-calculator-dwg.js"
    );

    const result = await calculateCoordinatesWithDwg(
      topo.posts,
      topo.distances,
      start.lat,
      start.lon,
      topo.cableSegments ?? [],
      {
        pageDimensions: objectToMap(topo.pageDimensions),
        viewportBoxes: topo.viewportBoxes ?? [],
        utmGridPathsPerPage: objectToMap(topo.utmGridPathsPerPage),
        distanceLabelItems: topo.distanceLabelItems ?? [],
      },
      library,
    );

    assert.ok(result.dwgStatus, `dwgStatus required, got ${result.dwgStatus}`);
    assert.equal(typeof result.solverPath, "string");
    assert.equal(result.solverPath, result.dwgStatus);
    assert.equal(typeof result.solverDemoted, "boolean");
    assert.ok(
      result.demotionReason === null || typeof result.demotionReason === "string",
    );
    assert.ok(
      result.solverScore === null || typeof result.solverScore === "object",
    );
    const hasSolverWarning = (result.warnings ?? []).some(
      (w) =>
        typeof w === "string" &&
        (w.includes("solver demoted") || w.includes("global-solve")),
    );
    assert.ok(hasSolverWarning, "human-readable solver warning in warnings[]");
  });
});
