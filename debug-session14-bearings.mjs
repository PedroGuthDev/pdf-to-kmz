// Bearings analysis for page 3
import { readFileSync } from "fs";
import { parsePdf } from "./parser/pdf-parser.js";
import { latLonToUtm } from "./parser/geo/utm-calibrator.js";

const refs = [];
for (const line of readFileSync("./coordenadas postes rua joao born.txt", "utf8").split("\n")) {
  const m = line.match(/Poste\s+(\d+).*?(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/i);
  if (m) refs.push({ num: +m[1], lat: +m[2], lon: +m[3] });
}

const buf = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);

const page3Posts = parsed.posts.filter(p => p.pageNum === 3).sort((a,b)=>a.number-b.number);

console.log("\n=== Reference UTM bearings (post N -> post N+1) ===");
const refsByNum = new Map(refs.map(r => [r.num, r]));
for (let i = 1; i < 14; i++) {
  const a = refsByNum.get(i);
  const b = refsByNum.get(i + 1);
  const au = latLonToUtm(a.lat, a.lon);
  const bu = latLonToUtm(b.lat, b.lon);
  const dE = bu.easting - au.easting;
  const dN = bu.northing - au.northing;
  const brg = (Math.atan2(dE, dN) * 180 / Math.PI + 360) % 360;
  console.log(`  ${i}->${i+1}: bearing ${brg.toFixed(2)}° dE=${dE.toFixed(2)} dN=${dN.toFixed(2)} dist=${Math.hypot(dE,dN).toFixed(2)}m`);
}

console.log("\n=== PDF bearings (post N -> post N+1) — convert to UTM bearing space ===");
// PDF +y = south, so dN_pdf = -dy
for (let i = 0; i < 13; i++) {
  const a = page3Posts[i];
  const b = page3Posts[i + 1];
  if (!a || !b) continue;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // atan2(dE, dN) where dE ~ dx, dN ~ -dy
  const brg = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
  console.log(`  ${a.number}->${b.number}: pdf bearing ${brg.toFixed(2)}° dx=${dx.toFixed(2)} dy=${dy.toFixed(2)} dist=${Math.hypot(dx,dy).toFixed(2)}pt`);
}

console.log("\n=== Reference UTM bearing of post 1 -> post K (cumulative) ===");
const u1 = latLonToUtm(refsByNum.get(1).lat, refsByNum.get(1).lon);
for (let k = 2; k <= 14; k++) {
  const uk = latLonToUtm(refsByNum.get(k).lat, refsByNum.get(k).lon);
  const dE = uk.easting - u1.easting;
  const dN = uk.northing - u1.northing;
  const brg = (Math.atan2(dE, dN) * 180 / Math.PI + 360) % 360;
  console.log(`  1->${k}: bearing ${brg.toFixed(2)}° dist=${Math.hypot(dE,dN).toFixed(2)}m`);
}

console.log("\n=== PDF bearing of post 1 -> post K (cumulative) ===");
const p1 = page3Posts[0];
for (let k = 2; k <= 14; k++) {
  const pk = page3Posts.find(p => p.number === k);
  if (!pk) continue;
  const dx = pk.x - p1.x;
  const dy = pk.y - p1.y;
  const brg = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
  console.log(`  1->${k}: pdf bearing ${brg.toFixed(2)}° dist=${Math.hypot(dx,dy).toFixed(2)}pt = ${(Math.hypot(dx,dy)*0.354610).toFixed(2)}m`);
}
