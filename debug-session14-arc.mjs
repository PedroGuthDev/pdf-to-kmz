// Probe cable-arc-placer consistency check on page 3
import { readFileSync } from "fs";
import { parsePdf } from "./parser/pdf-parser.js";

const buf = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);

const scale = 0.354610;
const distMap = new Map();
for (const d of parsed.distances) {
  distMap.set(`${d.from}->${d.to}`, d.meters);
  distMap.set(`${Math.min(d.from, d.to)}->${Math.max(d.from, d.to)}`, d.meters);
}

const page3Posts = parsed.posts.filter(p => p.pageNum === 3).sort((a,b)=>a.number-b.number);

console.log("\n=== PAGE 3 PDF chord vs label distance (5-13) ===");
for (let i = 0; i < page3Posts.length - 1; i++) {
  const p1 = page3Posts[i];
  const p2 = page3Posts[i+1];
  const chord = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const chordM = chord * scale;
  const labelM = distMap.get(`${p1.number}->${p2.number}`) ?? distMap.get(`${p2.number}->${p1.number}`);
  if (labelM == null) continue;
  const ratio = chordM / labelM;
  const diff = chordM - labelM;
  const status = ratio < 0.88 || ratio > 1.12 ? "BAD" : "ok";
  console.log(`  ${p1.number}->${p2.number}: chord ${chordM.toFixed(2)}m, label ${labelM.toFixed(2)}m, ratio ${ratio.toFixed(3)}, diff ${diff.toFixed(2)}m  [${status}]`);
}

console.log("\n=== Cable info ===");
const cs = parsed.cableSegments?.filter(c => c.pageNum === 3 || c.page === 3) ?? [];
console.log(`  cableSegments on page 3: ${cs.length}`);
if (parsed.cableSegments) {
  // count M sub-paths
  for (const c of cs) {
    let mCount = 0;
    for (const op of (c.ops ?? [])) if (op.type === 'M') mCount++;
    console.log(`    page=${c.pageNum ?? c.page} ops=${(c.ops ?? []).length} M=${mCount} layer=${c.layer ?? '?'}`);
  }
}

// Compute cumulative label-walked chord from post 1
let cumLabel = 0;
let cumChord = 0;
console.log("\n=== Cumulative on page 3 ===");
for (let i = 0; i < page3Posts.length - 1; i++) {
  const p1 = page3Posts[i];
  const p2 = page3Posts[i+1];
  const chord = Math.hypot(p2.x - p1.x, p2.y - p1.y) * scale;
  const labelM = distMap.get(`${p1.number}->${p2.number}`) ?? distMap.get(`${p2.number}->${p1.number}`);
  cumChord += chord;
  cumLabel += labelM;
  console.log(`  Post ${p2.number}: cum_chord=${cumChord.toFixed(2)}m cum_label=${cumLabel.toFixed(2)}m  drift=${(cumChord-cumLabel).toFixed(2)}m`);
}

// Compute reference UTM distances from post 1
console.log("\n=== Reference UTM chord from post 1 ===");
const refs = [];
for (const line of readFileSync("./coordenadas postes rua joao born.txt", "utf8").split("\n")) {
  const m = line.match(/Poste\s+(\d+).*?(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/i);
  if (m) refs.push({ num: +m[1], lat: +m[2], lon: +m[3] });
}
const r1 = refs.find(r => r.num === 1);
function approx(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2-lat1)*Math.PI/180;
  const dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}
for (const r of refs.filter(r => r.num >= 2 && r.num <= 14)) {
  const prev = refs.find(x => x.num === r.num - 1);
  const segDist = approx(prev.lat, prev.lon, r.lat, r.lon);
  const totalDist = approx(r1.lat, r1.lon, r.lat, r.lon);
  console.log(`  Post ${r.num}: seg=${segDist.toFixed(2)}m  total_from_1=${totalDist.toFixed(2)}m`);
}
