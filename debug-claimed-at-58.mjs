import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { parsePdf } from "./parser/pdf-parser.js";
import { deduplicatePostsPreferLowerPage } from "./parser/post-assembler.js";
import { calculateCoordinates } from "./parser/coordinate-calculator.js";
import { createRegionLibrary } from "./parser/dwg/region-library.js";
import { pairPostsByGraphWalk } from "./parser/dwg/graph-walker.js";
import { buildPostIndex } from "./parser/dwg/region-pairing.js";
import { haversineMeters } from "./parser/geo/utm-calibrator.js";

const refByNum = new Map();
for (const line of readFileSync("./coordenadas postes siriu.txt", "utf8").split(
  "\n",
)) {
  const m = line.match(/Poste\s+(\d+).*?(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/i);
  if (m) refByNum.set(+m[1], { lat: +m[2], lon: +m[3] });
}

const PDF = "./INFOVIAS_PJC INTERNET_Garopaba_Praia do Siriu_v01.pdf";
const DXF = "./siriu.dxf";
const pdfBuf = readFileSync(PDF);
const parsed = await parsePdf(
  pdfBuf.buffer.slice(pdfBuf.byteOffset, pdfBuf.byteOffset + pdfBuf.byteLength),
);
const refs = [];
for (const line of readFileSync("./coordenadas postes siriu.txt", "utf8").split(
  "\n",
)) {
  const m = line.match(/Poste\s+(\d+).*?(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/i);
  if (m) refs.push({ num: +m[1], lat: +m[2], lon: +m[3] });
}
refs.sort((a, b) => a.num - b.num);
const start = refs[0];

const pdfResult = calculateCoordinates(
  parsed.posts,
  parsed.distances,
  start.lat,
  start.lon,
  parsed.cableSegments ?? [],
);
const routePosts = deduplicatePostsPreferLowerPage(pdfResult.posts).sort(
  (a, b) => a.number - b.number,
);

const lib = createRegionLibrary(globalThis.indexedDB);
const dxfText = readFileSync(DXF, "utf8");
await lib.addRegion("siriu", new Blob([dxfText], { type: "text/plain" }));
const region = await lib.getRegionWithIndex("siriu");
const regionPosts = region.posts ?? [];

// Monkey-patch: log idxByNum when stepping to 58
const orig = pairPostsByGraphWalk;
// Run until 58 via internal - use GW_RETURN_IDX partial
process.env.GW_RETURN_PARTIAL = "1";
const gw = await import("./parser/dwg/graph-walker.js").then((m) =>
  m.pairPostsByGraphWalk({
    posts: routePosts,
    distances: parsed.distances,
    connections: pdfResult.connections,
    startLat: start.lat,
    startLon: start.lon,
    region: { posts: regionPosts, cableEdges: region.cableEdges },
    postIndex: region.postIndex,
    warnings: [],
  }),
);

const coords = gw.ok ? gw.coords : (gw.partialCoords ?? []);
console.log(
  `\nwalker: ok=${gw.ok} failedAt=${gw.failedAt ?? "-"} coords=${coords.length}`,
);

console.log("\nPost  DWG err(m)  idx");
for (const n of [55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65]) {
  const c = coords.find((x) => x.postNumber === n);
  const ref = refByNum.get(n);
  const idx = gw.idxByPostNumber?.[n];
  if (!c || !ref) {
    console.log(`${String(n).padStart(3)}       n/a  ${idx ?? "-"}`);
    continue;
  }
  const err = haversineMeters(c.lat, c.lon, ref.lat, ref.lon);
  console.log(
    `${String(n).padStart(3)}  ${err.toFixed(2).padStart(8)}  ${idx ?? "-"}`,
  );
}
