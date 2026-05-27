// Test what happens if post 5 is moved to (508.94, 301.74) — the debug_results.txt position
import { readFileSync } from "fs";
import { parsePdf } from "./parser/pdf-parser.js";
import { calculateCoordinates } from "./parser/coordinate-calculator.js";
import { haversineMeters } from "./parser/geo/utm-calibrator.js";

const refs = [];
for (const line of readFileSync("./coordenadas postes rua joao born.txt", "utf8").split("\n")) {
  const m = line.match(/Poste\s+(\d+).*?(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/i);
  if (m) refs.push({ num: +m[1], lat: +m[2], lon: +m[3] });
}
const buf = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);

// Override post 5 to the historical position
const post5 = parsed.posts.find(p => p.number === 5);
console.log(`Before override: post 5 (${post5.x}, ${post5.y}) anchor (${post5.anchorX}, ${post5.anchorY})`);
post5.x = 508.94;
post5.y = 301.74;
post5.anchorX = 508.94;
post5.anchorY = 301.74;
console.log(`After override: post 5 (${post5.x}, ${post5.y})`);

const r1 = refs.find((r) => r.num === 1);
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

console.log("\n=== ERRORS with post 5 at (508.94, 301.74) ===");
let ok = 0;
let maxe = 0;
for (const g of refs) {
  const p = r.posts.find((x) => x.number === g.num);
  const e = haversineMeters(g.lat, g.lon, p.lat, p.lon);
  maxe = Math.max(maxe, e);
  if (e < 5) ok++;
  console.log(`  Post ${g.num.toString().padStart(2)}: err=${e.toFixed(2).padStart(6)}m`);
}
console.log(`\nMax: ${maxe.toFixed(2)}m, <5m: ${ok}/34`);
