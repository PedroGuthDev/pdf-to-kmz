// What Poste symbols are available near posts 6 and 7's expected positions on page 3?
import { readFileSync } from "fs";
import { parsePdf } from "./parser/pdf-parser.js";

const buf = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);

// Find all posteRawCentroids on page 3
const page3Symbols = (parsed.posteRawCentroids ?? []).filter(c => c.pageNum === 3 || c.page === 3);
console.log(`Page 3 Poste raw centroids: ${page3Symbols.length}`);

// Sort by x for easier search
page3Symbols.sort((a,b) => a.x - b.x);
for (const s of page3Symbols) {
  if (s.x >= 550 && s.x <= 720) {
    console.log(`  (${s.x.toFixed(2)}, ${s.y.toFixed(2)})  pageNum=${s.pageNum}`);
  }
}

console.log("\n=== Posts 5-8 current positions ===");
for (const p of parsed.posts.filter(x => x.number >= 5 && x.number <= 8)) {
  console.log(`  Post ${p.number}: (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
  // Find nearest symbols
  const nearby = page3Symbols
    .map(s => ({ ...s, d: Math.hypot(s.x - p.x, s.y - p.y) }))
    .filter(s => s.d < 50)
    .sort((a, b) => a.d - b.d)
    .slice(0, 5);
  for (const s of nearby) {
    console.log(`    nearby: (${s.x.toFixed(2)}, ${s.y.toFixed(2)}) d=${s.d.toFixed(2)}pt`);
  }
}

// What's the "correct" PDF position for post 6 given the corrected ref transform?
// post 6 ref UTM dE from post1 = 10.39+(- (-10.39)) ... no let me use the refit theta = -3.442°
// dx, dy in PDF must satisfy: e6_ref - e1 = scale * (c*dx + s*dy), n6_ref - n1 = -scale*(-s*dx + c*dy)
// We can solve for (dx, dy):
//   dE = scale * (c*dx + s*dy)
//   -dN = scale * (-s*dx + c*dy)
// Solving:
//   c*dx + s*dy = dE/scale
//   -s*dx + c*dy = -dN/scale
// Multiply first by c, second by -s:
//   c²*dx + c*s*dy = c*dE/scale
//   s²*dx - s*c*dy = s*dN/scale
//   sum: dx = (c*dE + s*dN)/scale
// Multiply first by s, second by c:
//   c*s*dx + s²*dy = s*dE/scale
//   -c*s*dx + c²*dy = -c*dN/scale
//   sum: dy = (s*dE - c*dN)/scale
import { latLonToUtm } from "./parser/geo/utm-calibrator.js";
const refs = [];
for (const line of readFileSync("./coordenadas postes rua joao born.txt", "utf8").split("\n")) {
  const m = line.match(/Poste\s+(\d+).*?(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/i);
  if (m) refs.push({ num: +m[1], lat: +m[2], lon: +m[3] });
}
const u1 = latLonToUtm(refs.find(r=>r.num===1).lat, refs.find(r=>r.num===1).lon);
const post1Pdf = parsed.posts.find(x=>x.number===1);

const theta = -3.442 * Math.PI / 180;
const scale = 0.351315;
const c = Math.cos(theta); const ss = Math.sin(theta);

console.log("\n=== What PDF position would each post need to land at ref under refit-via-1-14 transform? ===");
for (const n of [5, 6, 7, 8]) {
  const r = refs.find(x => x.num === n);
  const u = latLonToUtm(r.lat, r.lon);
  const dE = u.easting - u1.easting;
  const dN = u.northing - u1.northing;
  const dx_target = (c * dE - ss * dN) / scale;
  const dy_target = (ss * dE + c * dN) / scale;
  // Wait, let me re-derive. With north = origin_n - ry*scale, we have:
  //  ΔE = scale*(c*dx + s*dy)
  //  ΔN = -scale*(-s*dx + c*dy) = scale*(s*dx - c*dy)
  // So:
  //  c*dx + s*dy = dE/scale
  //  s*dx - c*dy = dN/scale
  // Solve:
  // Multiply 1st by c: c²*dx + cs*dy = c*dE/scale
  // Multiply 2nd by s: s²*dx - sc*dy = s*dN/scale
  // Sum: dx = (c*dE + s*dN)/scale
  // Multiply 1st by s: cs*dx + s²*dy = s*dE/scale
  // Multiply 2nd by -c: -cs*dx + c²*dy = -c*dN/scale
  // Sum: dy = (s*dE - c*dN)/scale
  const dx_corrected = (c * dE + ss * dN) / scale;
  const dy_corrected = (ss * dE - c * dN) / scale;
  const targetPdfX = post1Pdf.x + dx_corrected;
  const targetPdfY = post1Pdf.y + dy_corrected;
  const postN = parsed.posts.find(x=>x.number===n);
  const moveD = Math.hypot(targetPdfX - postN.x, targetPdfY - postN.y);
  console.log(`  Post ${n}: target PDF (${targetPdfX.toFixed(2)}, ${targetPdfY.toFixed(2)})  current (${postN.x.toFixed(2)}, ${postN.y.toFixed(2)})  move=${moveD.toFixed(2)}pt (${(moveD*0.354610).toFixed(2)}m)`);
  // Find nearest poste symbol to target
  const nearestSym = page3Symbols
    .map(s => ({ ...s, d: Math.hypot(s.x - targetPdfX, s.y - targetPdfY) }))
    .sort((a, b) => a.d - b.d)[0];
  console.log(`    nearest symbol to target: (${nearestSym.x.toFixed(2)}, ${nearestSym.y.toFixed(2)}) d=${nearestSym.d.toFixed(2)}pt`);
}
