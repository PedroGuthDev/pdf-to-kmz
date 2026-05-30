/**
 * Probe: map east-spine label chain (posts 45..53) against the 153 arm geometry,
 * and confirm GT distances for posts 45..53.
 */
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";

import { createRegionLibrary } from "./parser/dwg/region-library.js";

async function loadRegion() {
  const dxfText = readFileSync("./siriu.dxf", "utf8");
  const dxfBlob = new Blob([dxfText], { type: "text/plain" });
  const lib = createRegionLibrary(globalThis.indexedDB);
  await lib.addRegion("siriu", dxfBlob);
  return lib.getRegionWithIndex("siriu");
}

const region = await loadRegion();
const regionPosts = region.region?.posts ?? region.posts ?? [];
const cableEdges = region.region?.cableEdges ?? region.cableEdges ?? [];

function nearestRegionPostWithin(posts, x, y, tol) {
  let bestIdx = -1, bestD = Infinity;
  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= tol && d < bestD) { bestD = d; bestIdx = i; }
  }
  return bestIdx;
}
function buildRichAdjacency(posts, edges, snapTol) {
  const adj = new Map();
  const ensure = (i) => { let s = adj.get(i); if (!s) { s = new Set(); adj.set(i, s); } return s; };
  for (const e of edges ?? []) {
    const a = e?.a, b = e?.b;
    if (!a || !b) continue;
    const iA = nearestRegionPostWithin(posts, a.x, a.y, snapTol);
    const iB = nearestRegionPostWithin(posts, b.x, b.y, snapTol);
    if (iA < 0 || iB < 0 || iA === iB) continue;
    ensure(iA).add(iB); ensure(iB).add(iA);
  }
  return adj;
}
function unionAdj(a, b) {
  const out = new Map();
  const ensure = (i) => { let s = out.get(i); if (!s) { s = new Set(); out.set(i, s); } return s; };
  for (const src of [a, b]) for (const [k, set] of src) { const s = ensure(k); for (const v of set) s.add(v); }
  return out;
}
const span = (i, j) => Math.hypot(regionPosts[j].x - regionPosts[i].x, regionPosts[j].y - regionPosts[i].y);

const graph = unionAdj(
  buildRichAdjacency(regionPosts, cableEdges, 8),
  buildRichAdjacency(regionPosts, cableEdges, 14),
);

// Walk the east spine from 123 -> 153 and follow degree-<=3 nodes forward,
// printing the chain so we can map it to posts 46..53.
console.log("East spine chain from junction 123 via arm 153:");
let prev = 123, cur = 153, n = 46;
const visited = new Set([123]);
for (let step = 0; step < 12; step++) {
  console.log(`  post~${n}? idx=${cur} span(${prev}->${cur})=${span(prev, cur).toFixed(1)}m deg=${graph.get(cur)?.size}`);
  visited.add(cur);
  const nb = [...(graph.get(cur) ?? [])].filter((x) => !visited.has(x));
  if (nb.length === 0) { console.log("   (dead end)"); break; }
  // pick the neighbor that is NOT going back; if multiple, list them
  if (nb.length > 1) {
    console.log(`   branch: ${nb.map((x) => `${x}@${span(cur, x).toFixed(1)}(deg${graph.get(x)?.size})`).join(", ")}`);
  }
  prev = cur;
  cur = nb[0];
  n++;
}
