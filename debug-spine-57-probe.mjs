/**
 * Probe spine posts 56-64 vs DWG indices and cable spans.
 */
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { createRegionLibrary } from "./parser/dwg/region-library.js";
import { latLonToUtm } from "./parser/geo/utm-calibrator.js";

function nearestRegionPostWithin(posts, x, y, tol) {
  let bestIdx = -1,
    bestD = Infinity;
  for (let i = 0; i < posts.length; i++) {
    const d = Math.hypot(posts[i].x - x, posts[i].y - y);
    if (d <= tol && d < bestD) {
      bestD = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}
function buildRichAdjacency(regionPosts, cableEdges, snapTol) {
  const adjacency = new Map();
  const ensure = (idx) => {
    let s = adjacency.get(idx);
    if (!s) {
      s = new Set();
      adjacency.set(idx, s);
    }
    return s;
  };
  for (const e of cableEdges ?? []) {
    const a = e?.a,
      b = e?.b;
    if (!a || !b) continue;
    const iA = nearestRegionPostWithin(regionPosts, a.x, a.y, snapTol);
    const iB = nearestRegionPostWithin(regionPosts, b.x, b.y, snapTol);
    if (iA < 0 || iB < 0 || iA === iB) continue;
    ensure(iA).add(iB);
    ensure(iB).add(iA);
  }
  return adjacency;
}
function unionAdjacency(a, b) {
  const out = new Map();
  const ensure = (idx) => {
    let s = out.get(idx);
    if (!s) {
      s = new Set();
      out.set(idx, s);
    }
    return s;
  };
  for (const src of [a, b])
    for (const [k, set] of src) {
      const s = ensure(k);
      for (const v of set) s.add(v);
    }
  return out;
}
const span = (posts, i, j) =>
  Math.hypot(posts[j].x - posts[i].x, posts[j].y - posts[i].y);

const region = await (async () => {
  const dxfText = readFileSync("./siriu.dxf", "utf8");
  const lib = createRegionLibrary(globalThis.indexedDB);
  await lib.addRegion("siriu", new Blob([dxfText], { type: "text/plain" }));
  return lib.getRegionWithIndex("siriu");
})();
const posts = region.region?.posts ?? region.posts ?? [];
const edges = region.region?.cableEdges ?? region.cableEdges ?? [];
const graph = unionAdjacency(
  buildRichAdjacency(posts, edges, 8),
  buildRichAdjacency(posts, edges, 14),
);

function gtUtm(n) {
  const line = readFileSync("./coordenadas postes siriu.txt", "utf8")
    .split("\n")
    .find((l) => new RegExp(`Poste\\s+${n}\\b`, "i").test(l));
  const m = line?.match(/;\s*([-\d.]+)\s*,\s*([-\d.]+)/);
  const u = latLonToUtm(Number(m[1]), Number(m[2]));
  return { x: u.easting, y: u.northing };
}

console.log("GT nearest INSERT per post:");
for (const n of [
  55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 69, 71, 73, 80, 81,
]) {
  const { x, y } = gtUtm(n);
  let best = -1,
    bestD = Infinity;
  for (let i = 0; i < posts.length; i++) {
    const d = Math.hypot(posts[i].x - x, posts[i].y - y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  console.log(
    `  post ${n}: idx ${best} d=${bestD.toFixed(1)}m deg=${graph.get(best)?.size}`,
  );
}

console.log("\nSpine chain from idx 165 (post~56):");
const start = 165;
for (const n of graph.get(start) ?? []) {
  console.log(
    `  165->${n} span=${span(posts, start, n).toFixed(1)} deg=${graph.get(n)?.size}`,
  );
}

console.log("\nAround idx 2 (post 57):");
for (const n of graph.get(2) ?? []) {
  console.log(
    `  2->${n} span=${span(posts, 2, n).toFixed(1)} deg=${graph.get(n)?.size}`,
  );
}
console.log("\nAround idx 1 (post 58):");
for (const n of graph.get(1) ?? []) {
  console.log(
    `  1->${n} span=${span(posts, 1, n).toFixed(1)} deg=${graph.get(n)?.size}`,
  );
}
console.log("\nAround idx 75 (wrong 57->58 pick):");
for (const n of graph.get(75) ?? []) {
  console.log(`  75->${n} span=${span(posts, 75, n).toFixed(1)}`);
}

// Walk spine 57-64 from GT indices
const chain = [];
for (const n of [57, 58, 59, 60, 61, 62, 63, 64]) {
  const { x, y } = gtUtm(n);
  let best = -1,
    bestD = Infinity;
  for (let i = 0; i < posts.length; i++) {
    const d = Math.hypot(posts[i].x - x, posts[i].y - y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  chain.push({ n, idx: best, d: bestD });
}
console.log("\nGT spine indices:");
for (const c of chain)
  console.log(`  post ${c.n} idx ${c.idx} (${c.d.toFixed(1)}m)`);
for (let i = 0; i < chain.length - 1; i++) {
  const a = chain[i].idx,
    b = chain[i + 1].idx;
  console.log(
    `  span ${chain[i].n}->${chain[i + 1].n} idx ${a}->${b} = ${span(posts, a, b).toFixed(1)}m`,
  );
}
