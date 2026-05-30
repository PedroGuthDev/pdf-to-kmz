/**
 * Probe: inspects exactly what happens at posts 1, 2, 3 in graph-walk
 * - UTM coords for GT 1, 2, 3
 * - Top-3 nearest INSERTs for each (within 20m)
 * - Adjacency of those INSERTs
 * - Simulates the first 3 steps of the walk
 */
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";

import { createRegionLibrary } from "./parser/dwg/region-library.js";
import { buildAdjacencyGraph, buildPostIndex } from "./parser/dwg/region-pairing.js";
import { latLonToUtm } from "./parser/geo/utm-calibrator.js";

function loadGT(path = "./coordenadas postes siriu.txt") {
  const text = readFileSync(path, "utf8");
  const gt = [];
  for (const line of text.split("\n")) {
    const m = line.match(/Poste\s+(\d+);\s*([-\d.]+)\s*,\s*([-\d.]+)/);
    if (!m) continue;
    gt.push({ number: parseInt(m[1], 10), lat: parseFloat(m[2]), lon: parseFloat(m[3]) });
  }
  gt.sort((a, b) => a.number - b.number);
  return gt;
}

async function loadRegion() {
  const dxfText = readFileSync("./siriu.dxf", "utf8");
  const dxfBlob = new Blob([dxfText], { type: "text/plain" });
  const lib = createRegionLibrary(globalThis.indexedDB);
  await lib.addRegion("siriu", dxfBlob);
  return lib.getRegionWithIndex("siriu");
}

function topNNearest(posts, x, y, n, maxR) {
  const arr = [];
  for (let i = 0; i < posts.length; i++) {
    const d = Math.hypot(posts[i].x - x, posts[i].y - y);
    if (d <= maxR) arr.push({ idx: i, d, p: posts[i] });
  }
  arr.sort((a, b) => a.d - b.d);
  return arr.slice(0, n);
}

const gt = loadGT();
const region = await loadRegion();
const posts = region.posts ?? [];
const cableEdges = region.cableEdges ?? [];
const adjacency = region.adjacencyGraph ?? buildAdjacencyGraph(posts, cableEdges);

console.log(`Region: ${posts.length} INSERTs, ${cableEdges.length} cable edges, adjacency map size=${adjacency.size}`);

// Inspect GT posts 1, 2, 3
const targetPosts = [1, 2, 3];
const gtToIdx = new Map();
for (const tn of targetPosts) {
  const g = gt.find((x) => x.number === tn);
  if (!g) { console.log(`GT post ${tn} not found`); continue; }
  const u = latLonToUtm(g.lat, g.lon);
  console.log(`\n=== GT poste ${tn} (lat=${g.lat}, lon=${g.lon}) -> UTM (${u.easting.toFixed(2)}, ${u.northing.toFixed(2)}) zone=${u.zone}`);
  const top = topNNearest(posts, u.easting, u.northing, 5, 25);
  for (const t of top) {
    const adj = adjacency.get(t.idx);
    const adjSize = adj ? adj.size : 0;
    const adjList = adj ? [...adj].slice(0, 10) : [];
    console.log(`   #${t.idx}  d=${t.d.toFixed(2)}m  (x=${t.p.x.toFixed(2)}, y=${t.p.y.toFixed(2)})  block=${t.p.block}  cable-neighbors=${adjSize} -> [${adjList.join(",")}]`);
  }
  // Record best
  if (top.length > 0) gtToIdx.set(tn, top[0].idx);
}

// For each best-INSERT for GT 1/2/3, look at neighbors in detail
console.log(`\n=== Adjacency details for the GT-nearest INSERTs ===`);
for (const tn of targetPosts) {
  const idx = gtToIdx.get(tn);
  if (idx == null) continue;
  const adj = adjacency.get(idx);
  console.log(`\nGT ${tn} -> INSERT #${idx} (block=${posts[idx].block}):`);
  if (!adj || adj.size === 0) {
    console.log(`   NO cable-adjacent neighbors!`);
    continue;
  }
  for (const nIdx of adj) {
    const n = posts[nIdx];
    const span = Math.hypot(n.x - posts[idx].x, n.y - posts[idx].y);
    const nAdj = adjacency.get(nIdx);
    const nAdjSize = nAdj ? nAdj.size : 0;
    console.log(`   neighbor #${nIdx}  span=${span.toFixed(2)}m  block=${n.block}  its-own-neighbors=${nAdjSize} (${nAdj ? [...nAdj].join(",") : ""})`);
  }
}

// Now simulate first 3 steps of the walk
console.log(`\n=== Simulating walk anchor (post 1) ===`);
const anchorIdx = gtToIdx.get(1);
console.log(`Anchor INSERT #${anchorIdx} (cable-neighbors: ${[...(adjacency.get(anchorIdx)??[])].join(",")})`);

const claimed = new Set([anchorIdx]);
console.log(`Claimed: {${[...claimed].join(",")}}`);

console.log(`\n=== Step 1->2 ===`);
console.log(`From INSERT #${anchorIdx}. Unclaimed cable-adjacent neighbors:`);
const step1Neighbors = [];
for (const n of adjacency.get(anchorIdx) ?? []) {
  if (!claimed.has(n)) step1Neighbors.push(n);
}
for (const n of step1Neighbors) {
  const span = Math.hypot(posts[n].x - posts[anchorIdx].x, posts[n].y - posts[anchorIdx].y);
  const itsAdj = adjacency.get(n);
  console.log(`   candidate #${n}  span=${span.toFixed(2)}m  its-own-neighbors=${itsAdj ? itsAdj.size : 0} -> [${itsAdj ? [...itsAdj].join(",") : ""}]`);
}

// Compute the synthetic label distance for 1->2
const gt1u = latLonToUtm(gt[0].lat, gt[0].lon);
const gt2u = latLonToUtm(gt[1].lat, gt[1].lon);
const labelM_1_2 = Math.hypot(gt2u.easting - gt1u.easting, gt2u.northing - gt1u.northing);
// Actually buildSyntheticPdfInput uses spans between GT-nearest INSERTs:
const i1 = gtToIdx.get(1);
const i2 = gtToIdx.get(2);
const synthLabel_1_2 = Math.hypot(posts[i2].x - posts[i1].x, posts[i2].y - posts[i1].y);
console.log(`\nlabel(1->2): GT-UTM span=${labelM_1_2.toFixed(2)}m, synthetic (INSERT-span between GT-nearest)=${synthLabel_1_2.toFixed(2)}m`);

// Check gap value
const i1HasI2 = adjacency.get(i1)?.has(i2) ?? false;
console.log(`adjacency.get(${i1}).has(${i2}) = ${i1HasI2}  => gap(1->2) = ${!i1HasI2}`);

console.log(`\n=== After picking post 2 = INSERT #${i1HasI2 ? i2 : "(picked by span)"} ===`);

// Pick using same logic as graph-walker
let chosenForPost2 = null;
if (step1Neighbors.length === 1) {
  chosenForPost2 = step1Neighbors[0];
} else if (step1Neighbors.length > 1) {
  // Span match using synthetic label
  let bestD = Infinity, best = -1;
  for (const n of step1Neighbors) {
    const span = Math.hypot(posts[n].x - posts[anchorIdx].x, posts[n].y - posts[anchorIdx].y);
    const d = Math.abs(span - synthLabel_1_2);
    if (d < bestD) { bestD = d; best = n; }
  }
  chosenForPost2 = best;
  console.log(`Span match chose INSERT #${chosenForPost2} (delta=${bestD.toFixed(2)}m)`);
}

if (chosenForPost2 == null) {
  console.log(`No candidate found for post 2 — walk would fail earlier`);
  process.exit(0);
}

claimed.add(chosenForPost2);
console.log(`Claimed: {${[...claimed].join(",")}}`);

console.log(`\n=== Step 2->3 ===`);
const i3 = gtToIdx.get(3);
console.log(`GT-nearest for post 3 = INSERT #${i3}`);
console.log(`Picked for post 2: INSERT #${chosenForPost2}. GT-nearest for post 2: INSERT #${i2}`);
console.log(`SAME? ${chosenForPost2 === i2}`);

const i2HasI3 = adjacency.get(i2)?.has(i3) ?? false;
const synthGap2_3 = !i2HasI3;
console.log(`adjacency.get(${i2}).has(${i3}) = ${i2HasI3}  => synthetic gap(2->3) = ${synthGap2_3}`);

console.log(`\nFrom picked INSERT #${chosenForPost2}, unclaimed cable-adjacent neighbors:`);
const step2Neighbors = [];
for (const n of adjacency.get(chosenForPost2) ?? []) {
  if (!claimed.has(n)) step2Neighbors.push(n);
}
console.log(`   count=${step2Neighbors.length}  ${step2Neighbors.join(",")}`);

for (const n of step2Neighbors) {
  const span = Math.hypot(posts[n].x - posts[chosenForPost2].x, posts[n].y - posts[chosenForPost2].y);
  console.log(`   candidate #${n}  span=${span.toFixed(2)}m`);
}

if (synthGap2_3) {
  console.log(`\nNote: gap=true, walker would take Case B (jumpback via junctions).`);
} else if (step2Neighbors.length === 0) {
  console.log(`\n>>> ROOT CAUSE: gap(2->3)=false but INSERT #${chosenForPost2} has 0 unclaimed cable-adjacent neighbors. Walk aborts.`);
}

// Also report the actual cable connectivity between i1, i2, i3 (GT-nearest)
console.log(`\n=== Connectivity between GT-nearest INSERTs ===`);
console.log(`adj(${i1}).has(${i2}) = ${adjacency.get(i1)?.has(i2) ?? false}`);
console.log(`adj(${i2}).has(${i3}) = ${adjacency.get(i2)?.has(i3) ?? false}`);
console.log(`adj(${i1}).has(${i3}) = ${adjacency.get(i1)?.has(i3) ?? false}`);
