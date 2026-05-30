/**
 * Probe branch-terminal detection at idx 76 (post 45) vs idx 128 (post 40).
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

const nextLabel = 25.5; // 46->47
const tol = Math.min(10, Math.max(2, 0.15 * nextLabel));

function bestNext(fromIdx, nIdx, claimed) {
  let best = Infinity;
  for (const nn of graph.get(nIdx) ?? []) {
    if (nn === fromIdx || claimed.has(nn)) continue;
    const d = Math.abs(span(posts, nIdx, nn) - nextLabel);
    if (d < best) best = d;
  }
  return best;
}

for (const fromIdx of [76, 128, 158]) {
  console.log(`\n=== fromIdx=${fromIdx} deg=${graph.get(fromIdx)?.size} ===`);
  for (const n of graph.get(fromIdx) ?? []) {
    const nd = bestNext(fromIdx, n, new Set());
    console.log(
      `  ->${n} span=${span(posts, fromIdx, n).toFixed(1)} deg=${graph.get(n)?.size} nextDelta=${nd.toFixed(2)} tol=${tol.toFixed(2)} fits=${nd <= tol}`,
    );
  }
}

// GT distance from stub nodes to post 46
function gtUtm(n) {
  const line = readFileSync("./coordenadas postes siriu.txt", "utf8")
    .split("\n")
    .find((l) => new RegExp(`Poste\\s+${n}\\b`, "i").test(l));
  const m = line?.match(/;\s*([-\d.]+)\s*,\s*([-\d.]+)/);
  const u = latLonToUtm(Number(m[1]), Number(m[2]));
  return { x: u.easting, y: u.northing };
}
for (const postNum of [41, 46, 49, 50]) {
  const { x, y } = gtUtm(postNum);
  console.log(`\nGT post ${postNum} UTM`, x.toFixed(2), y.toFixed(2));
  for (const idx of [111, 112, 113, 130, 153, 155, 156, 157, 158, 159, 161, 76]) {
    const p = posts[idx];
    if (!p) continue;
    console.log(`  idx${idx} d=${Math.hypot(p.x - x, p.y - y).toFixed(1)}m`);
  }
}
