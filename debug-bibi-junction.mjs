import { readFileSync } from "node:fs";
import "fake-indexeddb/auto";
import { parsePdf } from "./parser/pdf-parser.js";

const PDF = "INFOVIAS_PJC INTERNET_Palhoça_RUA BIBI FERREIRA (Final)_v1.pdf";
const pdfBuf = readFileSync(PDF);
const parsed = await parsePdf(
  pdfBuf.buffer.slice(pdfBuf.byteOffset, pdfBuf.byteOffset + pdfBuf.byteLength),
);
if (parsed.error) throw new Error(parsed.error);

const SCALE = 0.35461; // page-3 m per viewport unit (from utm-calibrator log)

// post symbols near the junction on page 3
const syms = (parsed.posteRawCentroids ?? []).filter(
  (s) => s.pageNum === 3 && s.x >= 640 && s.x <= 840 && s.y >= 250 && s.y <= 530,
);
console.log("Poste symbols near junction (page 3):");
for (const s of syms) console.log(`  (${s.x.toFixed(1)}, ${s.y.toFixed(1)})`);

const circles = {
  1: [670.1, 512.7],
  2: [689.3, 407.8],
  3: [722.2, 283.5],
  4: [672.3, 310.4],
  5: [778.5, 321.9],
};
console.log("\nNearest symbols to each circle:");
for (const [n, [cx, cy]] of Object.entries(circles)) {
  const ranked = syms
    .map((s) => ({ s, d: Math.hypot(s.x - cx, s.y - cy) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);
  console.log(
    `  circle ${n} @(${cx},${cy}): ` +
      ranked.map((r) => `(${r.s.x.toFixed(0)},${r.s.y.toFixed(0)}) d=${(r.d * SCALE).toFixed(1)}m`).join("  "),
  );
}

// pairwise distances between junction symbols in meters
const uniq = [];
for (const s of syms) {
  if (!uniq.some((u) => Math.hypot(u.x - s.x, u.y - s.y) < 3)) uniq.push(s);
}
console.log("\nPairwise symbol distances (m), symbols A..:");
uniq.forEach((s, i) =>
  console.log(`  ${String.fromCharCode(65 + i)} = (${s.x.toFixed(1)}, ${s.y.toFixed(1)})`),
);
for (let i = 0; i < uniq.length; i++)
  for (let j = i + 1; j < uniq.length; j++) {
    const d = Math.hypot(uniq[i].x - uniq[j].x, uniq[i].y - uniq[j].y) * SCALE;
    if (d < 50)
      console.log(
        `  ${String.fromCharCode(65 + i)}–${String.fromCharCode(65 + j)}: ${d.toFixed(1)}m`,
      );
  }
