import { parsePdf } from "./parser/pdf-parser.js";
import { readFileSync } from "fs";

const pdfBytes = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(pdfBytes.buffer);

// All centroid types: cable, Poste, Numero_Poste
const centroids = parsed.posteRawCentroids || [];
const p3sym = centroids.filter(c => c.pageNum === 3);

// Look at the Numero_Poste labels (post number circles)
const numTexts = parsed.distanceLabelItems ? parsed.distanceLabelItems.filter(d => d.pageNum === 3) : [];
console.log("Distancia label items on page 3:", numTexts.length);

// All posts with full info
console.log("\nAll posts info:");
for (let i = 1; i <= 5; i++) {
  const p = parsed.posts.find(x => x.number === i);
  if (p) console.log(`  post ${i}: x=${p.x.toFixed(2)} y=${p.y.toFixed(2)} anchorX=${p.anchorX?.toFixed?.(2)} anchorY=${p.anchorY?.toFixed?.(2)} pageNum=${p.pageNum}`);
}

// We want to see: what symbol(s) is post 2 located on?
// posteRawCentroids should be Poste layer symbols (pole symbols)
const post2 = parsed.posts.find(p => p.number === 2);
console.log(`\npost 2 final position: (${post2.x.toFixed(2)}, ${post2.y.toFixed(2)})`);

// Symbols within 5pt
const exact = p3sym.filter(s => Math.hypot(s.x - post2.x, s.y - post2.y) < 5);
console.log(`Symbols within 5pt of post 2: ${exact.length}`);
console.log(exact.slice(0, 3));

// Symbols within 1pt
const veryClose = p3sym.filter(s => Math.hypot(s.x - post2.x, s.y - post2.y) < 1);
console.log(`Symbols within 1pt of post 2: ${veryClose.length}`);

// Check unique distinct symbol positions on page 3
const uniqSet = new Set();
for (const s of p3sym) uniqSet.add(`${s.x.toFixed(1)},${s.y.toFixed(1)}`);
console.log(`Unique symbol positions on page 3: ${uniqSet.size}`);

// Show all unique
const uniq = [...uniqSet].sort();
for (const u of uniq) {
  console.log(`  ${u}`);
}
