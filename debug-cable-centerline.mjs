// Extract the cable centerline by only keeping "long" L segments (>10pt), which are the main ribbon segments.
import { parsePdf } from "./parser/pdf-parser.js";
import { buildCablesByPage } from "./parser/cable-builder.js";
import { readFileSync } from "fs";

const pdfBytes = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(pdfBytes.buffer);
const cablesByPage = buildCablesByPage(parsed.cableSegments || parsed.cablePaths || []);
const cable = cablesByPage.get(3)[0];

// Collect all "long" L moves
const longSegs = [];
let prev = null;
for (const op of cable) {
  if (op.type === 'M') {
    prev = { x: op.x, y: op.y };
  } else if (op.type === 'L' && prev) {
    const d = Math.hypot(op.x - prev.x, op.y - prev.y);
    if (d > 10) longSegs.push({ from: prev, to: { x: op.x, y: op.y }, len: d });
    prev = { x: op.x, y: op.y };
  } else if (op.type === 'Z') {
    prev = null;
  }
}
console.log(`Long segments (>10pt): ${longSegs.length}`);
for (const s of longSegs.slice(0, 20)) {
  console.log(`  (${s.from.x.toFixed(1)},${s.from.y.toFixed(1)}) -> (${s.to.x.toFixed(1)},${s.to.y.toFixed(1)}) len=${s.len.toFixed(2)}pt`);
}

// Order them by midpoint x
longSegs.sort((a, b) => (a.from.x + a.to.x) / 2 - (b.from.x + b.to.x) / 2);
console.log("\nSorted by midX:");
for (const s of longSegs.slice(0, 10)) {
  console.log(`  (${s.from.x.toFixed(1)},${s.from.y.toFixed(1)}) -> (${s.to.x.toFixed(1)},${s.to.y.toFixed(1)}) len=${s.len.toFixed(2)}pt`);
}
