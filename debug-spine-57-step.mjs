/**
 * Trace why 57->58 picks idx 75.
 */
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { createRegionLibrary } from "./parser/dwg/region-library.js";
import { pairPostsByGraphWalk } from "./parser/dwg/graph-walker.js";
import { latLonToUtm } from "./parser/geo/utm-calibrator.js";

function gtGps(n) {
  const line = readFileSync("./coordenadas postes siriu.txt", "utf8")
    .split("\n")
    .find((l) => new RegExp(`Poste\\s+${n}\\b`, "i").test(l));
  const m = line?.match(/;\s*([-\d.]+)\s*,\s*([-\d.]+)/);
  return { lat: Number(m[1]), lon: Number(m[2]) };
}

const gpsByPostNumber = new Map();
for (let n = 1; n <= 90; n++) gpsByPostNumber.set(n, gtGps(n));

// Load same inputs as debug-run-calc-dwg-from-pdf-siriu.mjs (minimal)
const { parsePdf } = await import("./parser/pdf-parser.js");
const pdfBuf = readFileSync("./siriu.pdf");
const parsed = await parsePdf(pdfBuf);
const posts = parsed.posts.filter((p) => p.number >= 55 && p.number <= 62);
const distances = parsed.distances;
const connections = parsed.connections.filter(
  (c) => c.from >= 55 && c.to <= 62,
);

const dxfText = readFileSync("./siriu.dxf", "utf8");
const lib = createRegionLibrary(globalThis.indexedDB);
await lib.addRegion("siriu", new Blob([dxfText], { type: "text/plain" }));
const regionData = await lib.getRegionWithIndex("siriu");
const region = regionData.region ?? regionData;

const start = gtGps(1);
process.env.GW_TRACE = "1";
process.env.GW_RETURN_IDX = "1";

const res = pairPostsByGraphWalk({
  posts,
  distances,
  connections,
  startLat: start.lat,
  startLon: start.lon,
  region,
  postIndex: regionData.postIndex,
  warnings: [],
  gpsByPostNumber,
});

console.log("ok", res.ok, "failedAt", res.failedAt);
console.log("idx", res.idxByPostNumber);
