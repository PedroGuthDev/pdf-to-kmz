/**
 * Compare DWG graph-walker vs PDF coords for posts 55–65 (not the pdf-fallback table).
 */
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { parsePdf } from "./parser/pdf-parser.js";
import { deduplicatePostsPreferLowerPage } from "./parser/post-assembler.js";
import { calculateCoordinates } from "./parser/coordinate-calculator.js";
import { calculateCoordinatesWithDwg } from "./parser/dwg/coordinate-calculator-dwg.js";
import { createRegionLibrary } from "./parser/dwg/region-library.js";
import { pairPostsByGraphWalk } from "./parser/dwg/graph-walker.js";
import { buildPostIndex } from "./parser/dwg/region-pairing.js";
import { haversineMeters } from "./parser/geo/utm-calibrator.js";

const PDF = "./INFOVIAS_PJC INTERNET_Garopaba_Praia do Siriu_v01.pdf";
const DXF = "./siriu.dxf";
const GT_TXT = "./coordenadas postes siriu.txt";

const refByNum = new Map();
for (const line of readFileSync(GT_TXT, "utf8").split("\n")) {
  const m = line.match(/Poste\s+(\d+).*?(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/i);
  if (m) refByNum.set(+m[1], { lat: +m[2], lon: +m[3] });
}
const start = refByNum.get(1);

const pdfBuf = readFileSync(PDF);
const parsed = await parsePdf(
  pdfBuf.buffer.slice(pdfBuf.byteOffset, pdfBuf.byteOffset + pdfBuf.byteLength),
);
const distances = parsed.distances ?? [];

const pdfOnly = calculateCoordinates(
  parsed.posts,
  distances,
  start.lat,
  start.lon,
  parsed.cableSegments ?? [],
  {
    pageDimensions: parsed.pageDimensions,
    viewportBoxes: parsed.viewportBoxes,
    utmGridPathsPerPage: parsed.utmGridPathsPerPage,
  },
);

const lib = createRegionLibrary(globalThis.indexedDB);
const dxfText = readFileSync(DXF, "utf8");
await lib.addRegion("siriu", new Blob([dxfText], { type: "text/plain" }));
const region = await lib.getRegionWithIndex("siriu");

const dwgResult = await calculateCoordinatesWithDwg(
  parsed.posts,
  distances,
  start.lat,
  start.lon,
  parsed.cableSegments ?? [],
  {
    pageDimensions: parsed.pageDimensions,
    viewportBoxes: parsed.viewportBoxes,
    utmGridPathsPerPage: parsed.utmGridPathsPerPage,
    dwgRegionId: "siriu",
  },
  lib,
);

const routePosts = deduplicatePostsPreferLowerPage(
  dwgResult.posts?.length ? dwgResult.posts : parsed.posts,
).sort((a, b) => a.number - b.number);

const gpsByPostNumber = new Map();
for (const p of pdfOnly.posts ?? []) {
  if (p?.number != null && p.lat != null && p.lon != null) {
    gpsByPostNumber.set(p.number, { lat: p.lat, lon: p.lon });
  }
}

process.env.GW_RETURN_IDX = "1";
process.env.GW_RETURN_PARTIAL = "1";
const gw = pairPostsByGraphWalk({
  posts: routePosts,
  distances,
  connections: pdfOnly.connections ?? [],
  startLat: start.lat,
  startLon: start.lon,
  region: {
    posts: region.posts,
    cableEdges: region.cableEdges,
    crs: region.crs,
  },
  postIndex: region.postIndex ?? buildPostIndex(region.posts),
  warnings: [],
  gpsByPostNumber,
});
const walkCoords = gw.ok ? gw.coords : (gw.partialCoords ?? []);

console.log("══ DWG walker vs PDF vs GT (posts 55–65) ══\n");
console.log(
  "dwgStatus (cascade):",
  dwgResult.dwgStatus ?? "?",
  "| gw.ok:",
  gw.ok,
  "| failedAt:",
  gw.failedAt ?? "-",
);
console.log("Post  PDF err   DWG-walk err   idx   source(cascade)\n");

const pdfByNum = new Map((pdfOnly.posts ?? []).map((p) => [p.number, p]));
const cascadeByNum = new Map((dwgResult.posts ?? []).map((p) => [p.number, p]));
const dwgCoordByNum = new Map(walkCoords.map((c) => [c.postNumber, c]));
const idxByNum = gw.idxByPostNumber ?? {};

for (const n of [55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65]) {
  const ref = refByNum.get(n);
  const pdfP = pdfByNum.get(n);
  const cascadeP = cascadeByNum.get(n);
  const dwgC = dwgCoordByNum.get(n);

  const pdfErr =
    ref && pdfP?.lat != null
      ? haversineMeters(pdfP.lat, pdfP.lon, ref.lat, ref.lon)
      : null;
  const walkErr =
    ref && dwgC?.lat != null
      ? haversineMeters(dwgC.lat, dwgC.lon, ref.lat, ref.lon)
      : null;
  const cascadeErr =
    ref && cascadeP?.lat != null && cascadeP.source === "dwg"
      ? haversineMeters(cascadeP.lat, cascadeP.lon, ref.lat, ref.lon)
      : null;

  console.log(
    `${String(n).padStart(3)}  ` +
      `${pdfErr != null ? pdfErr.toFixed(2).padStart(8) : "     n/a"}  ` +
      `${walkErr != null ? walkErr.toFixed(2).padStart(11) : "        n/a"}  ` +
      `${String(idxByNum[n] ?? "-").padStart(4)}  ` +
      `${cascadeP?.source ?? "?"}${cascadeErr != null ? ` (${cascadeErr.toFixed(1)}m)` : ""}`,
  );
}

if (process.env.GW_TRACE === "1") {
  console.log("\n(gw trace: GW_TRACE=1 node debug-dwg-vs-pdf-57.mjs)");
}
