import { parsePdf } from "./parser/pdf-parser.js";
import { buildCablesByPage } from "./parser/cable-builder.js";
import { readFileSync } from "fs";

const pdfBytes = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(pdfBytes.buffer);
const cablesByPage = buildCablesByPage(parsed.cableSegments || parsed.cablePaths || []);
const cables = cablesByPage.get(3) || [];

console.log(`Page 3 cables: ${cables.length}`);
for (let i = 0; i < cables.length; i++) {
  const c = cables[i];
  const pts = c.points || c;
  console.log(`Cable ${i}: ${pts.length} points`);
  console.log(`  First 5:`, pts.slice(0, 5).map(p => `(${p.x.toFixed(1)},${p.y.toFixed(1)})`).join(' '));
  console.log(`  Last 5:`, pts.slice(-5).map(p => `(${p.x.toFixed(1)},${p.y.toFixed(1)})`).join(' '));
}

// Check cable points near posts 1, 2, 3
const region = (cables[0]?.points || cables[0] || []).filter(p => p.x < 500);
console.log(`\nCable points x<500 (${region.length} pts):`);
region.sort((a, b) => a.x - b.x);
const subsample = [];
for (let i = 0; i < region.length; i += Math.max(1, Math.floor(region.length / 20))) {
  subsample.push(region[i]);
}
for (const p of subsample) console.log(`  (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`);
