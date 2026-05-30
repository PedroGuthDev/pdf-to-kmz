/**
 * Probe 2: confirms the gap=true / no-junction failure mode at step 2->3
 * Also explores ADJACENCY_SNAP_M sensitivity: rebuild graph at 3m, 5m, 8m and check
 * if (237, 231) get linked at larger tolerances.
 */
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";

import { createRegionLibrary } from "./parser/dwg/region-library.js";
import { buildAdjacencyGraph } from "./parser/dwg/region-pairing.js";
import { latLonToUtm } from "./parser/geo/utm-calibrator.js";

async function loadRegion() {
  const dxfText = readFileSync("./siriu.dxf", "utf8");
  const dxfBlob = new Blob([dxfText], { type: "text/plain" });
  const lib = createRegionLibrary(globalThis.indexedDB);
  await lib.addRegion("siriu", dxfBlob);
  return lib.getRegionWithIndex("siriu");
}

// Re-implement buildAdjacencyGraph with custom tolerance to test sensitivity
function buildAdjacencyGraphCustomTol(posts, cableEdges, tol) {
  const adjacency = new Map();
  const ensure = (idx) => {
    let s = adjacency.get(idx);
    if (!s) { s = new Set(); adjacency.set(idx, s); }
    return s;
  };
  const nearestPostIndexWithin = (posts, x, y, tol) => {
    let bestIdx = -1, bestD = Infinity;
    for (let i = 0; i < posts.length; i++) {
      const p = posts[i];
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= tol && d < bestD) { bestD = d; bestIdx = i; }
    }
    return bestIdx;
  };
  for (const e of cableEdges ?? []) {
    if (!e?.a || !e?.b) continue;
    const iA = nearestPostIndexWithin(posts, e.a.x, e.a.y, tol);
    const iB = nearestPostIndexWithin(posts, e.b.x, e.b.y, tol);
    if (iA < 0 || iB < 0 || iA === iB) continue;
    ensure(iA).add(iB);
    ensure(iB).add(iA);
  }
  return adjacency;
}

const region = await loadRegion();
const posts = region.posts ?? [];
const cableEdges = region.cableEdges ?? [];

console.log(`\n=== Adjacency sensitivity analysis ===`);
for (const tol of [3, 4, 5, 6, 8, 10]) {
  const adj = buildAdjacencyGraphCustomTol(posts, cableEdges, tol);
  // Check key relationships
  const a237_231 = adj.get(237)?.has(231) ?? false;
  const a240_237 = adj.get(240)?.has(237) ?? false;
  const a231_215 = adj.get(231)?.has(215) ?? false;
  const a231_228 = adj.get(231)?.has(228) ?? false;
  const a237_size = adj.get(237)?.size ?? 0;
  const a231_size = adj.get(231)?.size ?? 0;
  console.log(`tol=${tol}m  posts-with-edges=${adj.size}  adj(240,237)=${a240_237}  adj(237,231)=${a237_231}  adj(231,215)=${a231_215}  adj(231,228)=${a231_228}  |237|=${a237_size}  |231|=${a231_size}`);
}

// Examine the raw cable edges near INSERTs 237 and 231 to understand
// why they aren't linked at 3m
console.log(`\n=== Raw cable edges with endpoints near INSERT #237 (732031.20, 6903003.77) or #231 (731995.51, 6903040.19) ===`);
const i237 = posts[237];
const i231 = posts[231];
for (let ei = 0; ei < cableEdges.length; ei++) {
  const e = cableEdges[ei];
  if (!e?.a || !e?.b) continue;
  const dA237 = Math.hypot(e.a.x - i237.x, e.a.y - i237.y);
  const dB237 = Math.hypot(e.b.x - i237.x, e.b.y - i237.y);
  const dA231 = Math.hypot(e.a.x - i231.x, e.a.y - i231.y);
  const dB231 = Math.hypot(e.b.x - i231.x, e.b.y - i231.y);
  const near237 = Math.min(dA237, dB237);
  const near231 = Math.min(dA231, dB231);
  if (near237 < 6 || near231 < 6) {
    console.log(`  edge[${ei}] A=(${e.a.x.toFixed(2)}, ${e.a.y.toFixed(2)})  B=(${e.b.x.toFixed(2)}, ${e.b.y.toFixed(2)})  nearestToA-of-237=${dA237.toFixed(2)}m  nearestToB-of-237=${dB237.toFixed(2)}m  nearestToA-of-231=${dA231.toFixed(2)}m  nearestToB-of-231=${dB231.toFixed(2)}m`);
  }
}

// Now simulate the FULL Case B path that the walker takes at step 2->3
console.log(`\n=== Simulating Case B (jumpback) at step 2->3 ===`);
const realAdj = region.adjacencyGraph ?? buildAdjacencyGraph(posts, cableEdges);
// visitedIdx after step 1->2: [240, 237]
const visitedIdx = [240, 237];
const claimed = new Set([240, 237]);
console.log(`visited=[${visitedIdx.join(",")}], claimed=[${[...claimed].join(",")}]`);

// junctionSetFromVisited: those with |neighbors| > 2
const junctions = [];
for (const i of visitedIdx) {
  const n = realAdj.get(i);
  console.log(`  #${i}: |neighbors|=${n ? n.size : 0}, is-junction (>2)? ${n && n.size > 2}`);
  if (n && n.size > 2) junctions.push(i);
}
console.log(`junctions=[${junctions.join(",")}]`);

const cands = [];
const seen = new Set();
for (const j of junctions) {
  for (const n of realAdj.get(j) ?? []) {
    if (!claimed.has(n) && !seen.has(n)) { seen.add(n); cands.push(n); }
  }
}
console.log(`jumpbackCandidates: count=${cands.length} -> [${cands.join(",")}]`);
console.log(`>>> Conclusion: Case B has 0 candidates because visited path [240, 237] contains NO junction (both have degree 2).`);
