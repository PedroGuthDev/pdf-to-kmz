import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { parsePdf } from "./parser/pdf-parser.js";
import { deduplicatePostsPreferLowerPage } from "./parser/post-assembler.js";
import { calculateCoordinates } from "./parser/coordinate-calculator.js";
import { createRegionLibrary } from "./parser/dwg/region-library.js";
import { latLonToUtm } from "./parser/geo/utm-calibrator.js";

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
  const nearest = (x, y, tol) => {
    let b = -1,
      bd = Infinity;
    for (let i = 0; i < regionPosts.length; i++) {
      const d = Math.hypot(regionPosts[i].x - x, regionPosts[i].y - y);
      if (d <= tol && d < bd) {
        bd = d;
        b = i;
      }
    }
    return b;
  };
  for (const e of cableEdges ?? []) {
    const iA = nearest(e.a.x, e.a.y, snapTol);
    const iB = nearest(e.b.x, e.b.y, snapTol);
    if (iA < 0 || iB < 0 || iA === iB) continue;
    ensure(iA).add(iB);
    ensure(iB).add(iA);
  }
  return adjacency;
}

function unionAdjacency(a, b) {
  const out = new Map();
  const ensure = (k) => {
    let s = out.get(k);
    if (!s) {
      s = new Set();
      out.set(k, s);
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

const refByNum = new Map();
for (const line of readFileSync("./coordenadas postes siriu.txt", "utf8").split(
  "\n",
)) {
  const m = line.match(/Poste\s+(\d+).*?(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/i);
  if (m) refByNum.set(+m[1], { lat: +m[2], lon: +m[3] });
}

const pdfBuf = readFileSync(
  "./INFOVIAS_PJC INTERNET_Garopaba_Praia do Siriu_v01.pdf",
);
const parsed = await parsePdf(
  pdfBuf.buffer.slice(pdfBuf.byteOffset, pdfBuf.byteOffset + pdfBuf.byteLength),
);
const start = refByNum.get(1);
const pr = calculateCoordinates(
  parsed.posts ?? [],
  parsed.distances ?? [],
  start.lat,
  start.lon,
  parsed.cableSegments ?? [],
);
const distMap = new Map();
for (const d of parsed.distances ?? []) {
  if (d?.from != null && d?.to != null && d?.meters != null) {
    distMap.set(`${d.from}->${d.to}`, d.meters);
  }
}
const get = (a, b) => distMap.get(`${a}->${b}`) ?? null;

const lib = createRegionLibrary(globalThis.indexedDB);
await lib.addRegion(
  "siriu",
  new Blob([readFileSync("./siriu.dxf", "utf8")], { type: "text/plain" }),
);
const region = await lib.getRegionWithIndex("siriu");
const posts = region.posts ?? [];
const graph = unionAdjacency(
  buildRichAdjacency(posts, region.cableEdges, 8),
  buildRichAdjacency(posts, region.cableEdges, 14),
);
const span = (a, b) =>
  Math.hypot(posts[a].x - posts[b].x, posts[a].y - posts[b].y);

console.log("Distance labels 31-42:");
for (let n = 31; n <= 42; n++) {
  const parts = [];
  for (const k of [
    `${n}->${n + 1}`,
    `${n}->${n + 2}`,
    `32->${n}`,
    `31->${n}`,
  ]) {
    const v = distMap.get(k);
    if (v != null) parts.push(`${k}=${v}`);
  }
  if (parts.length) console.log(" ", parts.join("  "));
}

console.log("\nGT nearest INSERT (posts 31-42):");
const gtIdx = new Map();
for (const n of [31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42]) {
  const ref = refByNum.get(n);
  const u = latLonToUtm(ref.lat, ref.lon);
  let best = -1,
    bestD = Infinity;
  for (let i = 0; i < posts.length; i++) {
    const d = Math.hypot(posts[i].x - u.easting, posts[i].y - u.northing);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  gtIdx.set(n, best);
  console.log(
    `  post ${n}: idx ${best} err ${bestD.toFixed(1)}m deg ${graph.get(best)?.size ?? 0}`,
  );
}

const walker = {
  31: 119,
  32: 118,
  33: 398,
  34: 121,
  35: 122,
  36: 123,
  37: 124,
  38: 127,
  39: 128,
  40: 130,
  41: 132,
  42: 131,
};

console.log("\nWalker vs GT idx:");
for (const n of [31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42]) {
  const w = walker[n];
  const g = gtIdx.get(n);
  const mark = w === g ? "OK" : `WRONG (gt=${g})`;
  console.log(`  post ${n}: walker=${w} gt=${g} ${mark}`);
}

console.log("\nGT spine spans:");
for (let n = 31; n < 42; n++) {
  const a = gtIdx.get(n),
    b = gtIdx.get(n + 1);
  console.log(
    `  ${n}->${n + 1}: idx ${a}->${b} = ${span(a, b).toFixed(1)}m  label=${get(n, n + 1)}`,
  );
}

const fromIdx = 118;
const tap = get(32, 33);
const main = get(32, 34);
console.log(`\n32->33 tap=${tap} 32->34 main=${main}`);
console.log(
  `Neighbors of idx ${fromIdx}:`,
  [...(graph.get(fromIdx) ?? [])].map(
    (n) => `${n}(${span(fromIdx, n).toFixed(1)}m,d${graph.get(n)?.size})`,
  ),
);

console.log("\nCandidates in bifurcation tap window from 118:");
const mainTol = Math.max(Math.min(10, Math.max(2, 0.15 * main)), 12);
const minLeg = Math.max(15, tap - Math.min(10, Math.max(2, 0.15 * tap)));
const maxLeg = main + mainTol;
const tapTol = Math.min(10, Math.max(2, 0.15 * tap));
const targetSpan = (main + tap) / 2;
console.log(
  `  minLeg=${minLeg.toFixed(1)} maxLeg=${maxLeg.toFixed(1)} targetMid=${targetSpan.toFixed(1)}`,
);
for (let i = 0; i < posts.length; i++) {
  if (i === fromIdx) continue;
  const s = span(fromIdx, i);
  if (s < minLeg || s > maxLeg) continue;
  if (Math.abs(s - tap) <= tapTol) continue;
  const gtN = [...gtIdx.entries()].find(([, idx]) => idx === i)?.[0];
  console.log(
    `  idx ${i} span=${s.toFixed(1)} |mid|=${Math.abs(s - targetSpan).toFixed(1)} gtPost=${gtN ?? "-"} deg=${graph.get(i)?.size}`,
  );
}
