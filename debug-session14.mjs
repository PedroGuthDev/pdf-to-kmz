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

// Snapshot PDF positions BEFORE calculateCoordinates
console.log("\n=== PARSED POST POSITIONS (after parsePdf, before calculateCoordinates) ===");
for (const p of parsed.posts.filter(x => x.number >= 1 && x.number <= 14)) {
  console.log(`Post ${p.number}: page ${p.pageNum}, PDF (${p.x?.toFixed(2)}, ${p.y?.toFixed(2)})${p.anchorX ? `, anchor (${p.anchorX?.toFixed(2)}, ${p.anchorY?.toFixed(2)})` : ''}`);
}

console.log("\n=== DISTANCE LABELS for posts 1-14 ===");
for (let n = 1; n <= 13; n++) {
  const d = parsed.distances.find(x => x.from === n && x.to === n + 1);
  if (d) console.log(`  ${n}->${n+1}: ${d.meters}m`);
}

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

console.log("\n=== ALL POST ERRORS ===");
let ok = 0;
const errors = [];
for (const g of refs) {
  const p = r.posts.find((x) => x.number === g.num);
  const e = haversineMeters(g.lat, g.lon, p.lat, p.lon);
  errors.push({ num: g.num, err: e, lat: p.lat, lon: p.lon });
  if (e < 5) ok++;
  console.log(`Post ${g.num.toString().padStart(2)}: err=${e.toFixed(2).padStart(6)}m  pdf=(${p.x?.toFixed(1)},${p.y?.toFixed(1)}) page ${p.pageNum}  calc=(${p.lat.toFixed(8)}, ${p.lon.toFixed(8)})  ref=(${g.lat.toFixed(8)}, ${g.lon.toFixed(8)})`);
}
console.log("\n<5m", ok, "/34");
console.log("Max:", Math.max(...errors.map(e => e.err)).toFixed(2), "m");

console.log("\n=== ALL WARNINGS ===");
for (const w of r.warnings) console.log(" ", w);
