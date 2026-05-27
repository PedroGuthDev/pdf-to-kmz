// All Poste symbols on page 3, sorted spatially
import { readFileSync } from "fs";
import { parsePdf } from "./parser/pdf-parser.js";

const buf = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);

const page3Symbols = (parsed.posteRawCentroids ?? []).filter(c => c.pageNum === 3 || c.page === 3);
// Dedupe within 1pt
const dedup = [];
for (const s of page3Symbols) {
  const exists = dedup.some(d => Math.hypot(d.x - s.x, d.y - s.y) < 1);
  if (!exists) dedup.push(s);
}
console.log(`Page 3 raw symbols: ${page3Symbols.length}, deduped: ${dedup.length}`);
dedup.sort((a,b) => a.x - b.x);

// Show all in posts 4-9 area (x 480-850, y 200-380)
console.log("\n=== Symbols in posts 4-9 region (x 480-850, y 200-380) ===");
for (const s of dedup) {
  if (s.x >= 480 && s.x <= 850 && s.y >= 200 && s.y <= 380) {
    console.log(`  (${s.x.toFixed(2)}, ${s.y.toFixed(2)})`);
  }
}

console.log("\n=== Posts 4-9 and their nearest 3 symbols ===");
for (const p of parsed.posts.filter(x => x.number >= 4 && x.number <= 9)) {
  console.log(`Post ${p.number}: (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) anchor=(${p.anchorX?.toFixed(2)}, ${p.anchorY?.toFixed(2)})`);
  const nearby = dedup
    .map(s => ({ x: s.x, y: s.y, dToPost: Math.hypot(s.x - p.x, s.y - p.y), dToAnchor: Math.hypot(s.x - (p.anchorX ?? p.x), s.y - (p.anchorY ?? p.y)) }))
    .sort((a, b) => a.dToAnchor - b.dToAnchor)
    .slice(0, 4);
  for (const s of nearby) {
    console.log(`  nearby symbol: (${s.x.toFixed(2)}, ${s.y.toFixed(2)})  dToPost=${s.dToPost.toFixed(2)}pt  dToAnchor=${s.dToAnchor.toFixed(2)}pt`);
  }
}
