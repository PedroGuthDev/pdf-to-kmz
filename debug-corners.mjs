// For each post, find the nearest "long segment endpoint" on the cable.
import { parsePdf } from "./parser/pdf-parser.js";
import { buildCablesByPage } from "./parser/cable-builder.js";
import { readFileSync } from "fs";

const pdfBytes = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(pdfBytes.buffer);
const cablesByPage = buildCablesByPage(parsed.cableSegments || parsed.cablePaths || []);
const cable = cablesByPage.get(3)[0];

// Collect long-segment endpoints
const endpoints = [];
let prev = null;
for (const op of cable) {
  if (op.type === 'M') {
    prev = { x: op.x, y: op.y };
  } else if (op.type === 'L' && prev) {
    const d = Math.hypot(op.x - prev.x, op.y - prev.y);
    if (d > 30) {
      endpoints.push({ ...prev });
      endpoints.push({ x: op.x, y: op.y });
    }
    prev = { x: op.x, y: op.y };
  } else if (op.type === 'Z') {
    prev = null;
  }
}
// Dedupe
const uniq = [];
for (const p of endpoints) {
  if (!uniq.some(u => Math.hypot(u.x - p.x, u.y - p.y) < 5)) uniq.push(p);
}
uniq.sort((a, b) => a.x - b.x);
console.log(`Long-segment endpoints: ${uniq.length}`);

// For each page-3 post (1-14), find nearest cable endpoint
const posts = parsed.posts.filter(p => p.pageNum === 3);
for (const p of posts) {
  const candidates = uniq.map(c => ({ ...c, d: Math.hypot(c.x - p.x, c.y - p.y) }));
  candidates.sort((a, b) => a.d - b.d);
  const best = candidates[0];
  const bearing = Math.atan2(p.x - best.x, p.y - best.y) * 180 / Math.PI; // from corner to post
  console.log(`  post ${p.number}: PDF (${p.x.toFixed(1)}, ${p.y.toFixed(1)})  nearest corner (${best.x.toFixed(1)}, ${best.y.toFixed(1)}) Δ(${(p.x - best.x).toFixed(1)}, ${(p.y - best.y).toFixed(1)}) dist=${best.d.toFixed(2)}pt`);
}
