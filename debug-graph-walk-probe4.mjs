/**
 * Probe 4: examine the orphan cable endpoint (732013.85, 6903021.52)
 * Find the closest INSERT to it, and check whether it's a junction node not in any block.
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
const posts = region.posts ?? [];
const cableEdges = region.cableEdges ?? [];

// What's at INSERT #235?
console.log(`#235: block=${posts[235]?.block}  (x=${posts[235].x.toFixed(2)}, y=${posts[235].y.toFixed(2)})`);

// What is closest to (732013.85, 6903021.52)?
const targetX = 732013.85, targetY = 6903021.52;
const top = [];
for (let i = 0; i < posts.length; i++) {
  const d = Math.hypot(posts[i].x - targetX, posts[i].y - targetY);
  top.push({ idx: i, d, p: posts[i] });
}
top.sort((a, b) => a.d - b.d);
console.log(`\nClosest INSERTs to orphan endpoint (732013.85, 6903021.52):`);
for (const t of top.slice(0, 6)) {
  console.log(`  #${t.idx}  d=${t.d.toFixed(2)}m  block=${t.p.block}  (x=${t.p.x.toFixed(2)}, y=${t.p.y.toFixed(2)})`);
}

// Also examine ALL edges that touch this point
console.log(`\nEdges that have an endpoint within 1m of (732013.85, 6903021.52):`);
for (let ei = 0; ei < cableEdges.length; ei++) {
  const e = cableEdges[ei];
  if (!e?.a || !e?.b) continue;
  const dA = Math.hypot(e.a.x - targetX, e.a.y - targetY);
  const dB = Math.hypot(e.b.x - targetX, e.b.y - targetY);
  if (dA < 1 || dB < 1) {
    console.log(`  edge[${ei}] A=(${e.a.x.toFixed(2)}, ${e.a.y.toFixed(2)})  B=(${e.b.x.toFixed(2)}, ${e.b.y.toFixed(2)})  dA=${dA.toFixed(2)}  dB=${dB.toFixed(2)}`);
  }
}

// Now: what is at (731974.22, 6903017.11) which is the OTHER end of edge[153]?
// Edge[153] A=(731994.20, 6903038.68) (2m from #231) B=(731974.22, 6903017.11)
console.log(`\nClosest INSERTs to (731974.22, 6903017.11):`);
const targetX2 = 731974.22, targetY2 = 6903017.11;
const top2 = [];
for (let i = 0; i < posts.length; i++) {
  const d = Math.hypot(posts[i].x - targetX2, posts[i].y - targetY2);
  top2.push({ idx: i, d, p: posts[i] });
}
top2.sort((a, b) => a.d - b.d);
for (const t of top2.slice(0, 4)) {
  console.log(`  #${t.idx}  d=${t.d.toFixed(2)}m  block=${t.p.block}`);
}
