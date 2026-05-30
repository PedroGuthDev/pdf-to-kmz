/**
 * Probe 3: full structural picture
 * - Map ALL GT posts to nearest INSERTs
 * - Find the cable-shortest-path between consecutive GT-nearest INSERTs
 * - Count how many hops the cable graph takes per GT-pair (1 = direct adjacent, >1 = intermediates)
 * - Identify INSERTs along the cable that are NOT in any GT post list
 */
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";

import { createRegionLibrary } from "./parser/dwg/region-library.js";
import { buildAdjacencyGraph } from "./parser/dwg/region-pairing.js";
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

function bfsPath(adj, src, dst, claimed) {
  if (src === dst) return [src];
  const prev = new Map();
  const visited = new Set([src]);
  const queue = [src];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === dst) {
      const path = [dst];
      let n = dst;
      while (prev.has(n)) { n = prev.get(n); path.unshift(n); }
      return path;
    }
    for (const nb of adj.get(cur) ?? []) {
      if (visited.has(nb)) continue;
      if (claimed && claimed.has(nb) && nb !== dst) continue;
      visited.add(nb);
      prev.set(nb, cur);
      queue.push(nb);
    }
  }
  return null;
}

const gt = loadGT();
const region = await loadRegion();
const posts = region.posts ?? [];
const cableEdges = region.cableEdges ?? [];
const adj = region.adjacencyGraph ?? buildAdjacencyGraph(posts, cableEdges);

// Map each GT post to nearest INSERT
const gtIdx = new Map();
for (const g of gt) {
  const u = latLonToUtm(g.lat, g.lon);
  let bestIdx = -1, bestD = Infinity;
  for (let i = 0; i < posts.length; i++) {
    const d = Math.hypot(posts[i].x - u.easting, posts[i].y - u.northing);
    if (d < bestD) { bestD = d; bestIdx = i; }
  }
  gtIdx.set(g.number, { idx: bestIdx, d: bestD });
}

// For each consecutive pair, compute cable-shortest-path length
const stats = { direct: 0, twoHop: 0, threeHop: 0, more: 0, disconnected: 0 };
const problematic = [];
for (let i = 0; i < gt.length - 1; i++) {
  const a = gt[i].number;
  const b = gt[i + 1].number;
  const iA = gtIdx.get(a).idx;
  const iB = gtIdx.get(b).idx;
  const path = bfsPath(adj, iA, iB, null);
  if (!path) { stats.disconnected++; problematic.push({ a, b, iA, iB, hops: "INF" }); continue; }
  const hops = path.length - 1;
  if (hops === 1) stats.direct++;
  else if (hops === 2) { stats.twoHop++; if (problematic.length < 20) problematic.push({ a, b, iA, iB, hops, path }); }
  else if (hops === 3) { stats.threeHop++; if (problematic.length < 20) problematic.push({ a, b, iA, iB, hops, path }); }
  else { stats.more++; if (problematic.length < 20) problematic.push({ a, b, iA, iB, hops, path }); }
}

console.log(`\n=== GT-consecutive cable-shortest-path stats (n=${gt.length - 1}) ===`);
console.log(`  direct (1 hop):  ${stats.direct}`);
console.log(`  2 hops:          ${stats.twoHop}`);
console.log(`  3 hops:          ${stats.threeHop}`);
console.log(`  >3 hops:         ${stats.more}`);
console.log(`  disconnected:    ${stats.disconnected}`);

console.log(`\n=== Sample multi-hop / disconnected pairs ===`);
for (const p of problematic.slice(0, 20)) {
  if (p.path) {
    console.log(`  gt ${p.a}->${p.b}  insert ${p.iA}->${p.iB}  hops=${p.hops}  path=[${p.path.join(",")}]`);
  } else {
    console.log(`  gt ${p.a}->${p.b}  insert ${p.iA}->${p.iB}  hops=${p.hops}`);
  }
}

// For the first multi-hop case (posts 2->3), describe the intermediate
console.log(`\n=== Intermediate INSERT analysis for gt 2->3 ===`);
const iA = gtIdx.get(2).idx;
const iB = gtIdx.get(3).idx;
const path = bfsPath(adj, iA, iB, null);
if (path) {
  for (const idx of path) {
    const p = posts[idx];
    // Is this INSERT close to any GT post?
    let bestGT = -1, bestD = Infinity;
    for (const g of gt) {
      const u = latLonToUtm(g.lat, g.lon);
      const d = Math.hypot(p.x - u.easting, p.y - u.northing);
      if (d < bestD) { bestD = d; bestGT = g.number; }
    }
    console.log(`  #${idx} block=${p.block}  (x=${p.x.toFixed(2)}, y=${p.y.toFixed(2)})  closest-GT-post=${bestGT} d=${bestD.toFixed(2)}m  degree=${adj.get(idx)?.size ?? 0}`);
  }
}

// Are there any INSERTs in the path that are also a different GT post's nearest?
console.log(`\n=== Set of all GT-nearest INSERTs (claimed by other GT posts) ===`);
const allGtIdx = new Set();
for (const v of gtIdx.values()) allGtIdx.add(v.idx);
console.log(`  unique GT-nearest INSERTs: ${allGtIdx.size} (out of ${gt.length} GT posts) — duplicates: ${gt.length - allGtIdx.size}`);

// Find which GT posts map to the same INSERT
const reverseMap = new Map();
for (const [postNum, v] of gtIdx.entries()) {
  if (!reverseMap.has(v.idx)) reverseMap.set(v.idx, []);
  reverseMap.get(v.idx).push(postNum);
}
const dups = [...reverseMap.entries()].filter(([_, arr]) => arr.length > 1);
console.log(`  duplicate INSERTs claimed by multiple GT posts: ${dups.length}`);
for (const [idx, arr] of dups.slice(0, 10)) {
  console.log(`    #${idx} claimed by GT posts: [${arr.join(",")}]`);
}
