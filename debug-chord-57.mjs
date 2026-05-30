import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { parsePdf } from "./parser/pdf-parser.js";
import { createRegionLibrary } from "./parser/dwg/region-library.js";
import { latLonToUtm } from "./parser/geo/utm-calibrator.js";

const pdf = readFileSync(
  "./INFOVIAS_PJC INTERNET_Garopaba_Praia do Siriu_v01.pdf",
);
const parsed = await parsePdf(
  pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength),
);
const p58 = parsed.posts.find((p) => p.number === 58);
const utm58 = latLonToUtm(p58.lat, p58.lon);

const dxfText = readFileSync("./siriu.dxf", "utf8");
const lib = createRegionLibrary(globalThis.indexedDB);
await lib.addRegion("siriu", new Blob([dxfText], { type: "text/plain" }));
const regionData = await lib.getRegionWithIndex("siriu");
const posts = regionData.region?.posts ?? regionData.posts ?? [];

const fromIdx = 2;
const span = (i) =>
  Math.hypot(posts[i].x - posts[fromIdx].x, posts[i].y - posts[fromIdx].y);
const gpsD = (i) =>
  Math.hypot(posts[i].x - utm58.easting, posts[i].y - utm58.northing);

for (const idx of [1, 444, 75, 46]) {
  console.log(
    `idx ${idx}: span=${span(idx).toFixed(1)} gps=${gpsD(idx).toFixed(1)}`,
  );
}
