import { readFileSync } from "node:fs";
import { parseDxfText } from "./parser/dwg/dxf-loader.js";

// page-3 transform from utm-calibrator log
const OE = 725188.583, ON = 6938021.719, SF = 0.35461;
const toUtm = (x, y) => [OE + x * SF, ON - y * SF];

const pdfSyms = {
  A: [694.8, 516.8], B: [715.5, 397.8], C: [782.2, 391.3], D: [703.0, 379.0],
  E: [728.2, 358.3], F: [788.8, 344.7], G: [697.7, 328.1], H: [729.9, 315.5],
};

const dxf = parseDxfText(readFileSync("Palhoca.dxf", "utf8"));
const posts = dxf.posts ?? [];
console.log(`DXF posts total: ${posts.length}`);

// junction box
const box = { e0: 725410, e1: 725490, n0: 6937860, n1: 6937930 };
const near = posts.filter(
  (p) => p.x >= box.e0 && p.x <= box.e1 && p.y >= box.n0 && p.y <= box.n1,
);
console.log(`\nDXF poles in junction box (${near.length}):`);
for (const p of near) console.log(`  E=${p.x.toFixed(1)} N=${p.y.toFixed(1)}`);

console.log("\nPDF symbol → nearest DXF pole:");
for (const [k, [x, y]] of Object.entries(pdfSyms)) {
  const [e, n] = toUtm(x, y);
  const ranked = near
    .map((p) => ({ p, d: Math.hypot(p.x - e, p.y - n) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 2);
  console.log(
    `  ${k} utm(${e.toFixed(1)},${n.toFixed(1)}): ` +
      ranked.map((r) => `(${r.p.x.toFixed(1)},${r.p.y.toFixed(1)}) d=${r.d.toFixed(1)}m`).join("  "),
  );
}

console.log("\nDXF pole pairwise (<40m), poles P0..:");
near.forEach((p, i) => console.log(`  P${i} = (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`));
for (let i = 0; i < near.length; i++)
  for (let j = i + 1; j < near.length; j++) {
    const d = Math.hypot(near[i].x - near[j].x, near[i].y - near[j].y);
    if (d < 40) console.log(`  P${i}-P${j}: ${d.toFixed(1)}m`);
  }
