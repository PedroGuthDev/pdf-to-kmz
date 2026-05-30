import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { parsePdf } from "./parser/pdf-parser.js";
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
const distMap = new Map();
for (const d of parsed.distances ?? []) {
  if (d?.from != null && d?.to != null && d?.meters != null) {
    distMap.set(`${d.from}->${d.to}`, { m: d.meters, src: d.source });
  }
}
const get = (a, b) => distMap.get(`${a}->${b}`)?.m ?? null;

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
const span = (a, b) => Math.hypot(posts[a].x - posts[b].x, posts[a].y - posts[b].y);

console.log("Labels 59-70:");
for (let a = 59; a <= 70; a++) {
  for (let b = a + 1; b <= 70; b++) {
    const v = get(a, b);
    if (v != null) console.log(`  ${a}->${b} = ${v} (${distMap.get(`${a}->${b}`).src})`);
  }
}

console.log("\nGT nearest INSERT:");
const gtIdx = new Map();
for (const n of [59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70]) {
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

console.log("\nGT spine spans:");
for (let n = 59; n < 70; n++) {
  const a = gtIdx.get(n),
    b = gtIdx.get(n + 1);
  console.log(
    `  ${n}->${n + 1}: idx ${a}->${b} = ${span(a, b).toFixed(1)}m label=${get(n, n + 1)}`,
  );
}

const walker = {
  60: 44,
  61: 169,
  62: 43,
  63: 170,
  64: 40,
  65: 38,
  66: 45,
  67: 39,
  68: 254,
  69: 252,
};
console.log("\nWalker vs GT:");
for (const n of [60, 61, 62, 63, 64, 65, 66, 67, 68, 69]) {
  console.log(
    `  post ${n}: walker=${walker[n]} gt=${gtIdx.get(n)} ${walker[n] === gtIdx.get(n) ? "OK" : "WRONG"}`,
  );
}

console.log("\nHub idx 44 (post 60) neighbors:");
for (const n of graph.get(44) ?? []) {
  console.log(`  44->${n} span=${span(44, n).toFixed(1)} deg=${graph.get(n)?.size}`);
}

console.log("\nFrom hub 44 to GT posts 65-69 chord:");
for (const n of [65, 66, 67, 68, 69]) {
  const idx = gtIdx.get(n);
  console.log(`  44->${idx} (post ${n}) = ${span(44, idx).toFixed(1)}m`);
}

console.log("\nFrom idx 40 (post 64) neighbors:");
for (const n of graph.get(40) ?? []) {
  console.log(`  40->${n} span=${span(40, n).toFixed(1)}`);
}

console.log("\nCandidates for 64->65 tap 7.8 main?");
for (const [a, b] of [
  [64, 65],
  [64, 66],
  [60, 65],
  [60, 66],
]) {
  console.log(`  ${a}->${b} = ${get(a, b)}`);
}
