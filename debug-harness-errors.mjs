/**
 * Per-post harness error report + first divergence vs standalone (no GPS) walk.
 */
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { parsePdf } from "./parser/pdf-parser.js";
import { deduplicatePostsPreferLowerPage } from "./parser/post-assembler.js";
import { calculateCoordinates } from "./parser/coordinate-calculator.js";
import { calculateCoordinatesWithDwg } from "./parser/dwg/coordinate-calculator-dwg.js";
import { createRegionLibrary } from "./parser/dwg/region-library.js";
import { pairPostsByGraphWalk } from "./parser/dwg/graph-walker.js";
import { buildAdjacencyGraph, buildPostIndex } from "./parser/dwg/region-pairing.js";
import { haversineMeters } from "./parser/geo/utm-calibrator.js";

const GT = "./coordenadas postes siriu.txt";
const refByNum = new Map();
for (const line of readFileSync(GT, "utf8").split("\n")) {
  const m = line.match(/Poste\s+(\d+).*?(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/i);
  if (m) refByNum.set(+m[1], { lat: +m[2], lon: +m[3] });
}
const start = [...refByNum.entries()].map(([num, v]) => ({ num, ...v })).sort((a, b) => a.num - b.num)[0];

const pdfBuf = readFileSync("./INFOVIAS_PJC INTERNET_Garopaba_Praia do Siriu_v01.pdf");
const parsed = await parsePdf(pdfBuf.buffer.slice(pdfBuf.byteOffset, pdfBuf.byteOffset + pdfBuf.byteLength));
const opts = {
  pageDimensions: parsed.pageDimensions,
  viewportBoxes: parsed.viewportBoxes,
  utmGridPathsPerPage: parsed.utmGridPathsPerPage,
};

const lib = createRegionLibrary(globalThis.indexedDB);
await lib.addRegion("siriu", new Blob([readFileSync("./siriu.dxf", "utf8")], { type: "text/plain" }));
const region = await lib.getRegionWithIndex("siriu");
const regionPosts = region.posts ?? [];
const postIndex = region.postIndex ?? buildPostIndex(regionPosts);
const adjacencyGraph = region.adjacencyGraph ?? buildAdjacencyGraph(regionPosts, region.cableEdges ?? []);

// Harness path
const harness = await calculateCoordinatesWithDwg(
  parsed.posts,
  parsed.distances,
  start.lat,
  start.lon,
  parsed.cableSegments ?? [],
  opts,
  { regionId: "siriu", regionLibrary: lib },
);

// Standalone walk (no GPS)
const pr = calculateCoordinates(parsed.posts, parsed.distances, start.lat, start.lon, parsed.cableSegments ?? [], opts);
const route = deduplicatePostsPreferLowerPage(pr.posts).sort((a, b) => a.number - b.number);
process.env.GW_RETURN_IDX = "1";
const standalone = pairPostsByGraphWalk({
  posts: route,
  distances: parsed.distances,
  connections: pr.connections,
  startLat: start.lat,
  startLon: start.lon,
  region: { posts: regionPosts, cableEdges: region.cableEdges },
  postIndex,
  adjacencyGraph,
  warnings: [],
  gpsByPostNumber: null,
});

function errForCoords(coords, n) {
  const c = coords.find((x) => x.postNumber === n);
  const ref = refByNum.get(n);
  if (!c || !ref) return null;
  return haversineMeters(c.lat, c.lon, ref.lat, ref.lon);
}

console.log(`harness dwgStatus: ${harness.dwgStatus}`);
console.log(`standalone ok: ${standalone.ok}`);
console.log("\nPost  harness  standalone  idx(h/s)  note");
const bad = [];
for (let n = 1; n <= 85; n++) {
  const he = errForCoords(harness.posts, n);
  const se = errForCoords(standalone.coords ?? [], n);
  if (he == null) continue;
  const hi = harness.dwgIdxByPostNumber?.[n] ?? harness.idxByPostNumber?.[n];
  const si = standalone.idxByPostNumber?.[n];
  const note = hi !== si ? "IDX_DIFF" : he > 10 ? "BIG_ERR" : "";
  if (he > 10 || se > 10 || note === "IDX_DIFF") {
    bad.push({ n, he, se, hi, si, note: hi !== si ? "IDX_DIFF" : "BIG_ERR" });
  }
  if (n <= 45 || he > 10 || se > 10) {
    console.log(
      `${String(n).padStart(3)}  ${he.toFixed(1).padStart(8)}  ${(se ?? NaN).toFixed(1).padStart(9)}  ${hi ?? "-"}/${si ?? "-"}  ${note}`,
    );
  }
}
console.log(`\nPosts with err>10m (harness): ${bad.filter((b) => b.he > 10).length}`);
console.log(`Posts idx differs harness vs standalone: ${bad.filter((b) => b.note === "IDX_DIFF").length}`);
