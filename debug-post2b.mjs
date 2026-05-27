// Find what label distances exist on page 3 between posts 1, 2, 3
import { parsePdf } from "./parser/pdf-parser.js";
import { readFileSync } from "fs";

const pdfBytes = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(pdfBytes.buffer);

console.log("All distance labels:");
for (const d of parsed.distances) {
  if (d.from <= 5 && d.to <= 5) console.log(`  ${d.from}->${d.to}: ${d.meters}m`);
}

console.log("\nRaw distance items on page 3:");
const items = parsed.allDistItems || [];
console.log("allDistItems count:", items.length);

// Find post 2 in PDF: at (342.38, 428.82). What other Poste symbols are near the cable between posts 1, 2, 3?
const p1 = parsed.posts.find(p => p.number === 1);
const p2 = parsed.posts.find(p => p.number === 2);
const p3 = parsed.posts.find(p => p.number === 3);

// Use parsed.symbols or look at allPosteRaw (Poste layer symbols)
const posteRaw = parsed.allPosteRaw || [];
const page3Symbols = posteRaw.filter(s => s.pageNum === 3 || s.page === 3);
console.log(`page 3 Poste symbols: ${page3Symbols.length}`);

// Posts near segment 1-3
const x1 = p1.x, y1 = p1.y;
const x3 = p3.x, y3 = p3.y;
const dx = x3 - x1, dy = y3 - y1;
const len = Math.hypot(dx, dy);
const ux = dx / len, uy = dy / len;

const near = [];
for (const s of page3Symbols) {
  const sx = s.x, sy = s.y;
  const t = ((sx - x1) * ux + (sy - y1) * uy);
  const perp = Math.abs((sx - x1) * uy - (sy - y1) * ux);
  if (t > 5 && t < len - 5 && perp < 40) {
    near.push({ x: sx.toFixed(1), y: sy.toFixed(1), t: t.toFixed(1), perp: perp.toFixed(1) });
  }
}
console.log("Poste symbols near 1->3 segment:", near);

// At what t along 1->3 should post 2 be?
const target_t_pt = 31.89 / 0.354610; // = 89.9pt
console.log(`Walking 31.89m (ref) from post 1: t = ${target_t_pt.toFixed(1)}pt`);
console.log(`PDF position at that t: (${(x1 + ux * target_t_pt).toFixed(2)}, ${(y1 + uy * target_t_pt).toFixed(2)})`);
console.log(`Current post 2 PDF position: (${p2.x.toFixed(2)}, ${p2.y.toFixed(2)})`);
console.log(`Current post 2 t along 1->3: ${(((p2.x - x1) * ux + (p2.y - y1) * uy)).toFixed(2)}pt`);
