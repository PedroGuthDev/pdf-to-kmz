// Test: does re-associating distances after parsePdf fix the browser path?
import { readFileSync } from "fs";
import { parsePdf } from "./parser/pdf-parser.js";
import { calculateCoordinates } from "./parser/coordinate-calculator.js";
import { associateDistances } from "./parser/distance-associator.js";
import { computeScaleFactor, haversineMeters } from "./parser/geo/utm-calibrator.js";

const refs = [];
for (const line of readFileSync("./coordenadas postes rua joao born.txt", "utf8").split("\n")) {
  const m = line.match(/Poste\s+(\d+).*?(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/i);
  if (m) refs.push({ num: +m[1], lat: +m[2], lon: +m[3] });
}
const buf = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);

// FIX: re-associate distances with post-N3 positions
const overviewScale = computeScaleFactor(parsed.utmGridPathsPerPage.get(2) ?? [], []);
const perPageScale = (pageNum) => {
  const paths = parsed.utmGridPathsPerPage.get(pageNum);
  if (paths?.length) {
    const sf = computeScaleFactor(paths, []);
    if (sf != null) return sf;
  }
  return overviewScale ?? null;
};
const reassoc = associateDistances(parsed.posts.map(p => ({...p})), parsed.distanceLabelItems ?? [], [], { perPageScale });
console.log("Re-associated 3->4:", reassoc.distances.find(d => d.from === 3 && d.to === 4)?.meters);
console.log("Re-associated 4->5:", reassoc.distances.find(d => d.from === 4 && d.to === 5)?.meters);

// Force 3->4 to null (simulate harness's "No distance label found between posts 3 and 4")
// to see if prefill can recover with chord-from-neighbors
const e34 = reassoc.distances.find(d => d.from === 3 && d.to === 4);
if (e34) e34.meters = null;
console.log("Forced 3->4 to null");

const r1 = refs.find((r) => r.num === 1);
const postsCopy = JSON.parse(JSON.stringify(parsed.posts));
const r = calculateCoordinates(
  postsCopy,
  reassoc.distances, // ← use re-associated distances
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
for (const g of refs) {
  const p = r.posts.find((x) => x.number === g.num);
  const e = haversineMeters(g.lat, g.lon, p.lat, p.lon);
  errs.push({num: g.num, err: e});
  if (e < 5) ok++;
}
console.log("\n=== With re-associated distances ===");
for (const e of errs) {
  if (e.num >= 22 || e.num <= 12) {
    console.log(`  Post ${String(e.num).padStart(2)}: ${e.err.toFixed(2)}m`);
  }
}
console.log(`\n<5m: ${ok}/34, max: ${Math.max(...errs.map(e => e.err)).toFixed(2)}m`);

console.log("\nKey warnings:");
for (const w of r.warnings) {
  if (/sheet entry|boundary-locked|label-lsq|seam-lock|cable-arc-placer/.test(w)) {
    console.log("  " + w);
  }
}
