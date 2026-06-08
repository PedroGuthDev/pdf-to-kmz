import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { solveGlobalGraphAlignment } from "../dwg/global-solver.js";
import {
  buildAdjacencyGraph,
  buildPostIndex,
} from "../dwg/region-pairing.js";
import { latLonToUtm, utmToLatLon } from "../geo/utm-calibrator.js";

const ANCHOR_E = 730000;
const ANCHOR_N = 6900000;
const ZONE = 22;
const SPAN = 40;

function anchorLatLon() {
  return utmToLatLon(ANCHOR_E, ANCHOR_N, ZONE);
}

function makeDxfNode(idx, dx, dy, block = `P${idx}`) {
  return { x: ANCHOR_E + dx, y: ANCHOR_N + dy, block };
}

function makeLineRegion(nodeCount, spanM = SPAN) {
  const regionPosts = [];
  for (let i = 0; i < nodeCount; i++) {
    regionPosts.push(makeDxfNode(i + 1, i * spanM, 0));
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

function makeSolverInputs({
  postCount,
  nodeCount,
  spanM = SPAN,
  startLat,
  startLon,
  regionPosts,
  regionEdges,
}) {
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
  const anchor = anchorLatLon();
  const rp = regionPosts ?? makeLineRegion(nodeCount, spanM).regionPosts;
  const re = regionEdges ?? makeLineRegion(nodeCount, spanM).regionEdges;
  const postIndex = buildPostIndex(rp);
  const adjacencyGraph = buildAdjacencyGraph(rp, re, { postIndex });
  const gpsByPostNumber = new Map();
  for (let i = 0; i < postCount; i++) {
    gpsByPostNumber.set(i + 1, utmToLatLon(rp[i].x, rp[i].y, ZONE));
  }
  return {
    posts,
    distances,
    connections,
    startLat: startLat ?? anchor.lat,
    startLon: startLon ?? anchor.lon,
    regionData: { crs: { zone: ZONE } },
    regionPosts: rp,
    regionEdges: re,
    postIndex,
    adjacencyGraph,
    gpsByPostNumber,
    junctions: new Set(),
  };
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

describe("solveGlobalGraphAlignment — Wave 1 Hungarian core", () => {
  it("identity assignment: post i on DXF node i → coords match utmToLatLon", () => {
    const inputs = makeSolverInputs({ postCount: 3, nodeCount: 3 });
    const result = solveGlobalGraphAlignment(inputs);

    assert.equal(result.ok, true);
    assert.equal(result.coords.length, 3);
    for (let i = 0; i < 3; i++) {
      const c = result.coords[i];
      const node = inputs.regionPosts[i];
      const expected = utmToLatLon(node.x, node.y, ZONE);
      assert.equal(c.postNumber, i + 1);
      assert.equal(c.source, "dwg");
      assert.equal(c.dwg_block, `P${i + 1}`);
      assert.ok(Math.abs(c.lat - expected.lat) < 1e-7);
      assert.ok(Math.abs(c.lon - expected.lon) < 1e-7);
    }
  });

  it("rectangular matrix: fewer posts than DXF nodes assigns every post", () => {
    const { regionPosts, regionEdges } = makeLineRegion(5);
    const anchor = anchorLatLon();
    const spanM = SPAN;
    const posts = [
      { number: 1, x: 0, y: 0, page: 1 },
      { number: 3, x: 0, y: 0, page: 1 },
      { number: 5, x: 0, y: 0, page: 1 },
    ];
    const distances = [
      { from: 1, to: 3, meters: spanM * 2 },
      { from: 3, to: 5, meters: spanM * 2 },
    ];
    const connections = [
      { from: 1, to: 3 },
      { from: 3, to: 5 },
    ];
    const postIndex = buildPostIndex(regionPosts);
    const adjacencyGraph = buildAdjacencyGraph(regionPosts, regionEdges, { postIndex });
    const gpsByPostNumber = new Map([
      [1, utmToLatLon(regionPosts[0].x, regionPosts[0].y, ZONE)],
      [3, utmToLatLon(regionPosts[2].x, regionPosts[2].y, ZONE)],
      [5, utmToLatLon(regionPosts[4].x, regionPosts[4].y, ZONE)],
    ]);
    const result = solveGlobalGraphAlignment({
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
    });

    assert.equal(result.ok, true);
    assert.equal(result.coords.length, 3);
    assert.deepEqual(
      result.coords.map((c) => c.postNumber).sort((a, b) => a - b),
      [1, 3, 5],
    );
  });

  it("no-anchor: post 1 GPS far from all INSERTs → ok:false reason no-anchor", () => {
    const inputs = makeSolverInputs({
      postCount: 3,
      nodeCount: 3,
      startLat: 0,
      startLon: 0,
    });
    const result = solveGlobalGraphAlignment(inputs);

    assert.equal(result.ok, false);
    assert.equal(result.reason, "no-anchor");
  });

  it("scale-mismatch passthrough from medianCrossValidate", () => {
    const { regionPosts, regionEdges } = makeLineRegion(3);
    const mmEdges = regionEdges.map((e) => ({
      a: { x: e.a.x * 1000, y: e.a.y * 1000 },
      b: { x: e.b.x * 1000, y: e.b.y * 1000 },
    }));
    const mmPosts = regionPosts.map((p) => ({
      ...p,
      x: p.x * 1000,
      y: p.y * 1000,
    }));
    const inputs = makeSolverInputs({
      postCount: 3,
      nodeCount: 3,
      regionPosts: mmPosts,
      regionEdges: mmEdges,
    });
    const result = solveGlobalGraphAlignment(inputs);

    assert.equal(result.ok, false);
    assert.equal(result.reason, "scale-mismatch");
  });

  it("does not mutate posts, distances, or regionPosts", () => {
    const inputs = makeSolverInputs({ postCount: 3, nodeCount: 3 });
    const beforePosts = deepClone(inputs.posts);
    const beforeDistances = deepClone(inputs.distances);
    const beforeRegionPosts = deepClone(inputs.regionPosts);

    solveGlobalGraphAlignment(inputs);

    assert.deepEqual(inputs.posts, beforePosts);
    assert.deepEqual(inputs.distances, beforeDistances);
    assert.deepEqual(inputs.regionPosts, beforeRegionPosts);
  });

  it("returns elapsedMs wall-clock timing", () => {
    const inputs = makeSolverInputs({ postCount: 3, nodeCount: 3 });
    const result = solveGlobalGraphAlignment(inputs);

    assert.equal(result.ok, true);
    assert.equal(typeof result.elapsedMs, "number");
    assert.ok(result.elapsedMs >= 0);
  });
});
