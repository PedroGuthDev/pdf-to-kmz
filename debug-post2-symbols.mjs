import { parsePdf } from "./parser/pdf-parser.js";
import { readFileSync } from "fs";

const pdfBytes = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(pdfBytes.buffer);

console.log("Keys:", Object.keys(parsed));
const centroids = parsed.posteRawCentroids || [];
console.log("posteRawCentroids total:", centroids.length);

// Filter to page 3
const p3sym = centroids.filter(c => c.pageNum === 3);
console.log("page 3 symbols:", p3sym.length);

// Post 2 anchor is at (342.38, 428.82). Check symbols near 1->3 line on page 3.
const p1 = { x: 272.66, y: 444.30 };
const p3 = { x: 436.82, y: 396.78 };
const ux = (p3.x - p1.x);
const uy = (p3.y - p1.y);
const len = Math.hypot(ux, uy);
const lx = ux / len;
const ly = uy / len;

console.log("\nSymbols within 30pt perpendicular of 1->3 line:");
const candidates = [];
for (const s of p3sym) {
  const t = (s.x - p1.x) * lx + (s.y - p1.y) * ly;
  const perp = Math.abs((s.x - p1.x) * ly - (s.y - p1.y) * lx);
  if (t > 5 && t < len - 5 && perp < 30) {
    candidates.push({ x: s.x.toFixed(2), y: s.y.toFixed(2), t: t.toFixed(2), perp: perp.toFixed(2), distFromP1: (t * 0.354610).toFixed(2) });
  }
}
console.log(candidates);

// Symbols within 30pt of post 2 anchor (342.38, 428.82)
const a2 = { x: 342.38, y: 428.82 };
console.log("\nSymbols within 50pt of post 2 anchor (342.38, 428.82):");
const near = [];
for (const s of p3sym) {
  const d = Math.hypot(s.x - a2.x, s.y - a2.y);
  if (d < 50) near.push({ x: s.x.toFixed(2), y: s.y.toFixed(2), dist: d.toFixed(2) });
}
near.sort((a, b) => parseFloat(a.dist) - parseFloat(b.dist));
console.log(near);
