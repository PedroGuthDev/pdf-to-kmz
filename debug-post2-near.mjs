import { parsePdf } from "./parser/pdf-parser.js";
import { readFileSync } from "fs";

const pdfBytes = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(pdfBytes.buffer);
const centroids = parsed.posteRawCentroids || [];
const p3sym = centroids.filter(c => c.pageNum === 3);

// Looking for symbols near (359.04, 419.29)
const target = { x: 359.04, y: 419.29 };
const near = [];
for (const s of p3sym) {
  const d = Math.hypot(s.x - target.x, s.y - target.y);
  if (d < 60) near.push({ x: s.x.toFixed(2), y: s.y.toFixed(2), dist: d.toFixed(2) });
}
near.sort((a, b) => parseFloat(a.dist) - parseFloat(b.dist));
console.log("Symbols within 60pt of label-walk target (359.04, 419.29):");
for (const n of near) console.log("  ", n);

// Also: check if there are any layer-0 circles (NOT Poste layer) near there
// posteRawCentroids might be Poste-layer only; layer0Circles might have additional symbols
console.log("\nOther parsed fields:");
console.log("Keys:", Object.keys(parsed));
