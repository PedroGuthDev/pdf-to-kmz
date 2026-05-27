// Test what happens if we move post 7 to (674.54, 283.74) and/or post 8 to (769.10, 257.46)
import { readFileSync } from "fs";
import { parsePdf } from "./parser/pdf-parser.js";
import { calculateCoordinates } from "./parser/coordinate-calculator.js";
import { haversineMeters } from "./parser/geo/utm-calibrator.js";

const refs = [];
for (const line of readFileSync("./coordenadas postes rua joao born.txt", "utf8").split("\n")) {
  const m = line.match(/Poste\s+(\d+).*?(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/i);
  if (m) refs.push({ num: +m[1], lat: +m[2], lon: +m[3] });
}

async function testWithOverrides(overrides) {
  const buf = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
  const parsed = await parsePdf(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  );
  for (const o of overrides) {
    const p = parsed.posts.find(x => x.number === o.num);
    p.x = o.x; p.y = o.y;
    p.anchorX = o.x; p.anchorY = o.y;
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
  let ok = 0;
  let maxe = 0;
  const errors = {};
  for (const g of refs) {
    const p = r.posts.find((x) => x.number === g.num);
    const e = haversineMeters(g.lat, g.lon, p.lat, p.lon);
    errors[g.num] = e;
    maxe = Math.max(maxe, e);
    if (e < 5) ok++;
  }
  return { errors, ok, maxe };
}

// Baseline (no overrides)
console.log("=== BASELINE (no overrides) ===");
const base = await testWithOverrides([]);
for (let n = 1; n <= 14; n++) console.log(`  Post ${n.toString().padStart(2)}: ${base.errors[n].toFixed(2)}m`);
console.log(`  Max: ${base.maxe.toFixed(2)}m, <5m: ${base.ok}/34`);

// Try: post 7 only at (674.54, 283.74)
console.log("\n=== Override: post 7 → (674.54, 283.74) ===");
const r7 = await testWithOverrides([{ num: 7, x: 674.54, y: 283.74 }]);
for (let n = 1; n <= 14; n++) console.log(`  Post ${n.toString().padStart(2)}: ${r7.errors[n].toFixed(2)}m  Δ=${(r7.errors[n] - base.errors[n]).toFixed(2)}m`);
console.log(`  Max: ${r7.maxe.toFixed(2)}m, <5m: ${r7.ok}/34`);

// Try: post 8 only at (769.10, 257.46)
console.log("\n=== Override: post 8 → (769.10, 257.46) ===");
const r8 = await testWithOverrides([{ num: 8, x: 769.10, y: 257.46 }]);
for (let n = 1; n <= 14; n++) console.log(`  Post ${n.toString().padStart(2)}: ${r8.errors[n].toFixed(2)}m  Δ=${(r8.errors[n] - base.errors[n]).toFixed(2)}m`);
console.log(`  Max: ${r8.maxe.toFixed(2)}m, <5m: ${r8.ok}/34`);

// Try: both
console.log("\n=== Override: post 7 → (674.54, 283.74) AND post 8 → (769.10, 257.46) ===");
const r78 = await testWithOverrides([
  { num: 7, x: 674.54, y: 283.74 },
  { num: 8, x: 769.10, y: 257.46 }
]);
for (let n = 1; n <= 14; n++) console.log(`  Post ${n.toString().padStart(2)}: ${r78.errors[n].toFixed(2)}m  Δ=${(r78.errors[n] - base.errors[n]).toFixed(2)}m`);
console.log(`  Max: ${r78.maxe.toFixed(2)}m, <5m: ${r78.ok}/34`);

// Print 26-34 just to check page 5 unchanged
console.log("\n=== Posts 26-34 baseline vs both-override ===");
for (let n = 26; n <= 34; n++) console.log(`  Post ${n.toString().padStart(2)}: ${base.errors[n].toFixed(2)}m  → ${r78.errors[n].toFixed(2)}m`);
