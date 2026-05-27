// Test Valmor via browser-path style (parsePdf → calculateCoordinates)
import { readFileSync } from "fs";
import { parsePdf } from "./parser/pdf-parser.js";
import { calculateCoordinates } from "./parser/coordinate-calculator.js";
import { haversineMeters } from "./parser/geo/utm-calibrator.js";

const REF = [
  { num: 1, lat: -27.6594603999238, lon: -48.699240275151034 },
  { num: 2, lat: -27.65942120761788, lon: -48.699602010469185 },
  { num: 3, lat: -27.659382015296377, lon: -48.700021269466035 },
  { num: 4, lat: -27.659346742194973, lon: -48.700345393166934 },
  { num: 5, lat: -27.65930559022924, lon: -48.700762439716044 },
  { num: 6, lat: -27.659270317104404, lon: -48.70108213852094 },
  { num: 7, lat: -27.659231796350753, lon: -48.70147947750159 },
  { num: 8, lat: -27.65918966453256, lon: -48.70188546179813 },
  { num: 9, lat: -27.65914949231848, lon: -48.70230140211723 },
  { num: 10, lat: -27.6591063806582, lon: -48.702660924999286 },
  { num: 11, lat: -27.659066208413993, lon: -48.702999429619396 },
];

const buf = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA VALMOR FRANCISCO_v1.pdf");
const parsed = await parsePdf(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);
const r1 = REF[0];
const postsCopy = JSON.parse(JSON.stringify(parsed.posts));
const r = calculateCoordinates(
  postsCopy,
  parsed.distances,
  r1.lat,
  r1.lon,
  parsed.cableSegments,
  {
    utmGridPathsPerPage: parsed.utmGridPathsPerPage,
    viewportBoxes: parsed.viewportBoxes,
    pageDimensions: parsed.pageDimensions,
    distanceLabelItems: parsed.distanceLabelItems,
    posteRawCentroids: parsed.posteRawCentroids,
  },
);
let ok = 0;
const errs = [];
for (const g of REF) {
  const p = r.posts.find((x) => x.number === g.num);
  if (!p || p.lat == null) { errs.push({num: g.num, err: 999}); continue; }
  const e = haversineMeters(g.lat, g.lon, p.lat, p.lon);
  errs.push({num: g.num, err: e});
  if (e < 5) ok++;
}
console.log("Valmor (browser path):");
for (const e of errs) {
  console.log(`  Post ${String(e.num).padStart(2)}: ${e.err.toFixed(2)}m`);
}
console.log(`\n<5m: ${ok}/11, max: ${Math.max(...errs.map(e => e.err)).toFixed(2)}m`);
console.log("Valmor invariant: max 9.14m, 9/11 < 5m");
