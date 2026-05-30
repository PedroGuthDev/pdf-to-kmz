import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { createRegionLibrary } from "./parser/dwg/region-library.js";
import { latLonToUtm } from "./parser/geo/utm-calibrator.js";

function loadGT() {
  const t = readFileSync("./coordenadas postes siriu.txt", "utf8");
  const gt = [];
  for (const line of t.split("\n")) {
    const m = line.match(/Poste\s+(\d+);\s*([-\d.]+)\s*,\s*([-\d.]+)/);
    if (m) gt.push({ number: parseInt(m[1], 10), lat: parseFloat(m[2]), lon: parseFloat(m[3]) });
  }
  gt.sort((a, b) => a.number - b.number);
  return gt;
}

function buildRichAdjacency(regionPosts, cableEdges, snapTol) {
  const adjacency = new Map();
  const ensure = (idx) => { let s = adjacency.get(idx); if (!s) { s = new Set(); adjacency.set(idx, s); } return s; };
  for (const e of cableEdges ?? []) {
    const a = e?.a, b = e?.b;
    if (!a || !b) continue;
    let iA = -1, dA = Infinity, iB = -1, dB = Infinity;
    for (let i = 0; i < regionPosts.length; i++) {
      const p = regionPosts[i];
      const da = Math.hypot(p.x - a.x, p.y - a.y);
      if (da <= snapTol && da < dA) { dA = da; iA = i; }
      const db = Math.hypot(p.x - b.x, p.y - b.y);
      if (db <= snapTol && db < dB) { dB = db; iB = i; }
    }
    if (iA < 0 || iB < 0 || iA === iB) continue;
    ensure(iA).add(iB);
    ensure(iB).add(iA);
  }
  return adjacency;
}

const dxf = readFileSync("./siriu.dxf", "utf8");
const blob = new Blob([dxf], { type: "text/plain" });
const lib = createRegionLibrary(globalThis.indexedDB);
await lib.addRegion("siriu", blob);
const region = await lib.getRegionWithIndex("siriu");

const gt = loadGT();
const regionPosts = region.posts;
const gtIdx = new Map();
for (const g of gt) {
  const u = latLonToUtm(g.lat, g.lon);
  let bi = -1, bd = Infinity;
  for (let i = 0; i < regionPosts.length; i++) {
    const p = regionPosts[i];
    const d = Math.hypot(p.x - u.easting, p.y - u.northing);
    if (d < bd) { bd = d; bi = i; }
  }
  gtIdx.set(g.number, { idx: bi, dist: bd });
}

const graph = buildRichAdjacency(regionPosts, region.cableEdges, 8);

for (const num of [9,10,11,12,13,14]) {
  const info = gtIdx.get(num);
  const p = regionPosts[info.idx];
  const nbrs = graph.get(info.idx);
  console.log(`Post ${num}: idx=${info.idx} (${p.x.toFixed(2)},${p.y.toFixed(2)}) block=${p.block} gtErr=${info.dist.toFixed(2)}m neighbors=${nbrs ? [...nbrs].join(',') : 'NONE'}`);
}

console.log("\n=== Pair 3->4 diagnostic ===");
const p3 = gtIdx.get(3), p4 = gtIdx.get(4);
const a = regionPosts[p3.idx], b = regionPosts[p4.idx];
console.log(`Post 3 idx=${p3.idx}, Post 4 idx=${p4.idx}`);
console.log(`Straight-line span (label): ${Math.hypot(b.x-a.x, b.y-a.y).toFixed(2)}m`);
console.log(`Post 3 neighbors in rich graph (snap=8):`);
const nbrs3 = graph.get(p3.idx) || new Set();
for (const n of nbrs3) {
  const np = regionPosts[n];
  console.log(`  -> idx=${n} (${np.x.toFixed(2)},${np.y.toFixed(2)}) span=${Math.hypot(np.x-a.x, np.y-a.y).toFixed(2)}m degree=${graph.get(n)?.size ?? 0}`);
}
console.log(`Post 4 neighbors in rich graph (snap=8):`);
const nbrs4 = graph.get(p4.idx) || new Set();
for (const n of nbrs4) {
  const np = regionPosts[n];
  console.log(`  -> idx=${n} (${np.x.toFixed(2)},${np.y.toFixed(2)}) span=${Math.hypot(np.x-b.x, np.y-b.y).toFixed(2)}m degree=${graph.get(n)?.size ?? 0}`);
}

console.log("\n=== With snap=12 ===");
const graph12 = buildRichAdjacency(regionPosts, region.cableEdges, 12);
const nbrs3_12 = graph12.get(p3.idx) || new Set();
console.log(`Post 3 neighbors (snap=12):`);
for (const n of nbrs3_12) {
  const np = regionPosts[n];
  console.log(`  -> idx=${n} (${np.x.toFixed(2)},${np.y.toFixed(2)}) span=${Math.hypot(np.x-a.x, np.y-a.y).toFixed(2)}m degree=${graph12.get(n)?.size ?? 0}`);
}

// Check if post4 is reachable from post3 via BFS
function bfsPath(g, src, dst, maxHops = 5) {
  const q = [[src, [src]]];
  const seen = new Set([src]);
  while (q.length) {
    const [n, path] = q.shift();
    if (n === dst) return path;
    if (path.length > maxHops) continue;
    const ns = g.get(n);
    if (!ns) continue;
    for (const x of ns) {
      if (seen.has(x)) continue;
      seen.add(x);
      q.push([x, [...path, x]]);
    }
  }
  return null;
}

// Inspect neighborhood of idx 237 (post2)
console.log("\n=== Post 2 (idx=237) full multi-hop expansion ===");
const visited = new Set([240]);
function dfs(cur, prev, depth, path, totalSpan) {
  const nbrs = graph.get(cur);
  if (!nbrs) return;
  for (const n of nbrs) {
    if (n === prev) continue;
    if (visited.has(n)) continue;
    const cp = regionPosts[cur], np = regionPosts[n];
    const span = Math.hypot(np.x-cp.x, np.y-cp.y);
    const total = totalSpan + span;
    console.log(`  ${'  '.repeat(depth)}-> idx=${n} span=${span.toFixed(2)} total=${total.toFixed(2)} deg=${graph.get(n)?.size}`);
    if (depth < 2 && (graph.get(n)?.size ?? 0) <= 2) {
      dfs(n, cur, depth+1, [...path, n], total);
    }
  }
}
dfs(237, -1, 0, [237], 0);

console.log("\n=== idx=232 neighbors ===");
const n232 = graph.get(232);
for (const n of n232) {
  const np = regionPosts[n];
  const cp = regionPosts[232];
  console.log(`  -> idx=${n} span=${Math.hypot(np.x-cp.x, np.y-cp.y).toFixed(2)}m deg=${graph.get(n)?.size}`);
}
console.log("\n=== idx=235 neighbors ===");
const n235 = graph.get(235);
for (const n of n235) {
  const np = regionPosts[n];
  const cp = regionPosts[235];
  console.log(`  -> idx=${n} span=${Math.hypot(np.x-cp.x, np.y-cp.y).toFixed(2)}m deg=${graph.get(n)?.size}`);
}

const path = bfsPath(graph, p3.idx, p4.idx, 6);
console.log(`\nBFS path post3->post4 (snap=8, max 6 hops):`, path);
if (path) {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const pa = regionPosts[path[i-1]], pb = regionPosts[path[i]];
    total += Math.hypot(pb.x-pa.x, pb.y-pa.y);
  }
  console.log(`  Total path length: ${total.toFixed(2)}m`);
}

// Check 9->10 path
console.log("\n=== Pair 9->10 (label 137.52m, gap) ===");
const p9 = gtIdx.get(9), p10 = gtIdx.get(10);
console.log(`Post 9 idx=${p9.idx}, Post 10 idx=${p10.idx}`);
const path910 = bfsPath(graph, p9.idx, p10.idx, 10);
console.log(`BFS path post9->post10:`, path910);
if (path910) {
  let total = 0;
  for (let i = 1; i < path910.length; i++) {
    const pa = regionPosts[path910[i-1]], pb = regionPosts[path910[i]];
    total += Math.hypot(pb.x-pa.x, pb.y-pa.y);
  }
  console.log(`  Total path length: ${total.toFixed(2)}m`);
}
// Try larger snap
for (const snap of [10, 12, 15, 20]) {
  const g = buildRichAdjacency(regionPosts, region.cableEdges, snap);
  const p = bfsPath(g, p9.idx, p10.idx, 10);
  console.log(`  snap=${snap}: BFS path=`, p);
  if (p) {
    let total = 0;
    for (let i = 1; i < p.length; i++) {
      const pa = regionPosts[p[i-1]], pb = regionPosts[p[i]];
      total += Math.hypot(pb.x-pa.x, pb.y-pa.y);
    }
    console.log(`    Total: ${total.toFixed(2)}m`);
  }
}
