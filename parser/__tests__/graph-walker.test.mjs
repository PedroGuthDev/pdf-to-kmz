// parser/__tests__/graph-walker.test.mjs
// Unit tests for parser/dwg/graph-walker.js — three synthetic fixtures.
// Run: node parser/__tests__/graph-walker.test.mjs
// NOTE: no fake-indexeddb — graph-walker is a pure algorithm module.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAdjacencyGraph,
  buildPostIndex,
} from "../dwg/region-pairing.js";
import { pairPostsByGraphWalk } from "../dwg/graph-walker.js";
import { utmToLatLon } from "../geo/utm-calibrator.js";

// Synthesize a region in UTM zone 22 (Brazil south). Coords are metres.
const ANCHOR_E = 730000;
const ANCHOR_N = 6900000;
const ZONE = 22;

function anchorLatLon() {
  return utmToLatLon(ANCHOR_E, ANCHOR_N, ZONE);
}

function makePost(idx, dx, dy, block = `pod_${idx}`) {
  return { x: ANCHOR_E + dx, y: ANCHOR_N + dy, block };
}

function makeEdge(a, b) {
  return { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } };
}

test("graph-walker-A-01: 7 posts, spine 1-2-3 + branch 4-5-6 + spine resumes 7, all paired", () => {
  // Geometry: spine 1(0,0)-2(30,0)-3(60,0), branch from 3: 4(60,30)-5(60,60)-6(60,90),
  // then 6 continues to 7(90,0) via long cable. Junction is post 3 (deg 3: neighbors 2,4,7).
  const posts = [
    makePost(1,   0,   0),   // idx 0
    makePost(2,  30,   0),   // idx 1
    makePost(3,  60,   0),   // idx 2  (junction: cable to 1,3,6 indices)
    makePost(4,  60,  30),   // idx 3
    makePost(5,  60,  60),   // idx 4
    makePost(6,  60,  90),   // idx 5
    makePost(7,  90,   0),   // idx 6  (spine resumes)
  ];

  const cableEdges = [
    makeEdge(posts[0], posts[1]),  // 1-2
    makeEdge(posts[1], posts[2]),  // 2-3
    makeEdge(posts[2], posts[3]),  // 3-4 (branch start)
    makeEdge(posts[3], posts[4]),  // 4-5
    makeEdge(posts[4], posts[5]),  // 5-6
    makeEdge(posts[5], posts[6]),  // 6-7 (long cable, span ≈94.87m)
    makeEdge(posts[2], posts[6]),  // 3-7 (spine continuation, span 30m)
  ];

  const pdfPosts = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ number: n, x: 0, y: 0, pageNum: 1 }));

  const distances = [
    { from: 1, to: 2, meters: 30 },
    { from: 2, to: 3, meters: 30 },
    { from: 3, to: 4, meters: 30 },
    { from: 4, to: 5, meters: 30 },
    { from: 5, to: 6, meters: 30 },
    { from: 6, to: 7, meters: Math.hypot(30, 90) },
  ];

  const connections = [1, 2, 3, 4, 5, 6].map((from) => ({ from, to: from + 1, gap: false }));

  const region = { posts, cableEdges, crs: { zone: ZONE } };
  const { lat, lon } = anchorLatLon();
  const warnings = [];

  const res = pairPostsByGraphWalk({
    posts: pdfPosts,
    distances,
    connections,
    startLat: lat,
    startLon: lon,
    region,
    postIndex: buildPostIndex(posts),
    adjacencyGraph: buildAdjacencyGraph(posts, cableEdges),
    warnings,
  });

  assert.equal(res.ok, true, `expected ok, got: ${JSON.stringify(res)} warnings=${JSON.stringify(warnings)}`);
  assert.equal(res.coords.length, 7);
  const blocks = res.coords.map((c) => c.dwg_block);
  assert.equal(new Set(blocks).size, 7);
  const c4 = res.coords.find((c) => c.postNumber === 4);
  assert.equal(c4.dwg_block, "pod_4", "post 4 should pair to branch start, not spine resumption");
  const c7 = res.coords.find((c) => c.postNumber === 7);
  assert.equal(c7.dwg_block, "pod_7", "post 7 should pair to spine resumption");
});

test("graph-walker-B-01: 7 posts, spine 1-5 then jumpback 5→6 (gap:true) to branch attached at junction 3, then 6-7", () => {
  // Spine 1(0,0)-2(30,0)-3(60,0)-4(90,0)-5(120,0); branch at junction 3: 6(60,30)-7(60,60).
  const posts = [
    makePost(1,   0,  0),   // idx 0
    makePost(2,  30,  0),   // idx 1
    makePost(3,  60,  0),   // idx 2  (junction)
    makePost(4,  90,  0),   // idx 3
    makePost(5, 120,  0),   // idx 4
    makePost(6,  60, 30),   // idx 5  (branch, attached at junction 3)
    makePost(7,  60, 60),   // idx 6
  ];
  const cableEdges = [
    makeEdge(posts[0], posts[1]),  // 1-2
    makeEdge(posts[1], posts[2]),  // 2-3
    makeEdge(posts[2], posts[3]),  // 3-4
    makeEdge(posts[3], posts[4]),  // 4-5
    makeEdge(posts[2], posts[5]),  // 3-6 (branch attached at junction)
    makeEdge(posts[5], posts[6]),  // 6-7
  ];

  const pdfPosts = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ number: n, x: 0, y: 0, pageNum: 1 }));
  const distances = [
    { from: 1, to: 2, meters: 30 },
    { from: 2, to: 3, meters: 30 },
    { from: 3, to: 4, meters: 30 },
    { from: 4, to: 5, meters: 30 },
    { from: 5, to: 6, meters: 0 },
    { from: 6, to: 7, meters: 30 },
  ];
  const connections = [
    { from: 1, to: 2, gap: false },
    { from: 2, to: 3, gap: false },
    { from: 3, to: 4, gap: false },
    { from: 4, to: 5, gap: false },
    { from: 5, to: 6, gap: true },
    { from: 6, to: 7, gap: false },
  ];

  const region = { posts, cableEdges, crs: { zone: ZONE } };
  const { lat, lon } = anchorLatLon();
  const warnings = [];

  const res = pairPostsByGraphWalk({
    posts: pdfPosts,
    distances,
    connections,
    startLat: lat,
    startLon: lon,
    region,
    postIndex: buildPostIndex(posts),
    adjacencyGraph: buildAdjacencyGraph(posts, cableEdges),
    warnings,
  });

  assert.equal(res.ok, true, `warnings=${JSON.stringify(warnings)}`);
  assert.equal(res.coords.length, 7);
  const c6 = res.coords.find((c) => c.postNumber === 6);
  const c7 = res.coords.find((c) => c.postNumber === 7);
  assert.equal(c6.dwg_block, "pod_6", "jumpback post 6 should pair to branch INSERT attached at junction 3");
  assert.equal(c7.dwg_block, "pod_7", "post 7 should pair to branch continuation");
});

test("graph-walker-C-01: junction with 2 unclaimed cable neighbors at different spans — span-match selects correct one", () => {
  // Post 1 (junction, deg 2 toward A and B): cable to A at span 20m, cable to B at span 50m.
  // distance(1,2)=20 → must select A. A then has cable to C at span 30m for post 3.
  const posts = [
    makePost(1,   0,   0),   // idx 0  (anchor, junction)
    makePost("A", 20,  0),   // idx 1  (pairs to post 2 — span 20)
    makePost("B", 50,  0),   // idx 2  (decoy — span 50)
    makePost("C", 20, 30),   // idx 3  (pairs to post 3 — span(A,C)=30)
  ];
  const cableEdges = [
    makeEdge(posts[0], posts[1]),  // 1-A (span 20)
    makeEdge(posts[0], posts[2]),  // 1-B (span 50, decoy)
    makeEdge(posts[1], posts[3]),  // A-C (span 30, continuation)
  ];

  const pdfPosts = [1, 2, 3].map((n) => ({ number: n, x: 0, y: 0, pageNum: 1 }));
  const distances = [
    { from: 1, to: 2, meters: 20 },
    { from: 2, to: 3, meters: 30 },
  ];
  const connections = [
    { from: 1, to: 2, gap: false },
    { from: 2, to: 3, gap: false },
  ];

  const region = { posts, cableEdges, crs: { zone: ZONE } };
  const { lat, lon } = anchorLatLon();
  const warnings = [];

  const res = pairPostsByGraphWalk({
    posts: pdfPosts,
    distances,
    connections,
    startLat: lat,
    startLon: lon,
    region,
    postIndex: buildPostIndex(posts),
    adjacencyGraph: buildAdjacencyGraph(posts, cableEdges),
    warnings,
  });

  assert.equal(res.ok, true, `warnings=${JSON.stringify(warnings)}`);
  assert.equal(res.coords.length, 3);
  const c2 = res.coords.find((c) => c.postNumber === 2);
  assert.equal(c2.dwg_block, "pod_A", `expected post 2 to pair to A (span 20), got ${c2.dwg_block}`);
  assert.ok(!res.coords.some((c) => c.dwg_block === "pod_B"), "B must NOT be paired");
});

test("graph-walker-fail-01: anchor more than 15m from any INSERT → ok:false with reason:'no-anchor'", () => {
  const posts = [makePost(1, 0, 0)];
  const cableEdges = [];
  const pdfPosts = [{ number: 1, x: 0, y: 0, pageNum: 1 }];

  // Shift the user GPS 50m east — well outside DEFAULT_TOLERANCE_M=15.
  const farLatLon = utmToLatLon(ANCHOR_E + 50, ANCHOR_N, ZONE);
  const warnings = [];

  const res = pairPostsByGraphWalk({
    posts: pdfPosts,
    distances: [],
    connections: [],
    startLat: farLatLon.lat,
    startLon: farLatLon.lon,
    region: { posts, cableEdges, crs: { zone: ZONE } },
    postIndex: buildPostIndex(posts),
    adjacencyGraph: buildAdjacencyGraph(posts, cableEdges),
    warnings,
  });

  assert.equal(res.ok, false);
  assert.equal(res.failedAt, 1);
  assert.ok(
    warnings.some((w) => w.kind === "dwg-graph-walk-fail" && w.reason === "no-anchor"),
    `expected no-anchor warning, got ${JSON.stringify(warnings)}`,
  );
});
