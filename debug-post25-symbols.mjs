import { parsePdf } from "./parser/pdf-parser.js";
import { readFileSync } from "fs";

const pdfBytes = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(pdfBytes.buffer);

// Symbols near (1133.90, 51.84) on page 4
const centroids = parsed.posteRawCentroids.filter(c => c.pageNum === 4);
console.log(`Page 4 symbols: ${centroids.length}`);

const p25 = { x: 1133.90, y: 51.84 };
const near = [];
for (const s of centroids) {
  const d = Math.hypot(s.x - p25.x, s.y - p25.y);
  if (d < 50) near.push({ x: s.x, y: s.y, dist: d });
}
near.sort((a, b) => a.dist - b.dist);
console.log("Symbols within 50pt of post 25:");
for (const n of near.slice(0, 6)) console.log(`  (${n.x.toFixed(2)}, ${n.y.toFixed(2)}) dist=${n.dist.toFixed(2)}`);

// Also check the cable corners on page 4
