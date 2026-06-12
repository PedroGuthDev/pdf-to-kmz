import { readFileSync } from "node:fs";
import "fake-indexeddb/auto";
import { parsePdf } from "./parser/pdf-parser.js";

const PDF = "INFOVIAS_PJC INTERNET_Palhoça_RUA BIBI FERREIRA (Final)_v1.pdf";
const pdfBuf = readFileSync(PDF);
const parsed = await parsePdf(
  pdfBuf.buffer.slice(pdfBuf.byteOffset, pdfBuf.byteOffset + pdfBuf.byteLength),
);
if (parsed.error) throw new Error(parsed.error);

console.log("=== POSTS (anchor x,y per page) ===");
for (const p of [...parsed.posts].sort((a, b) => a.number - b.number)) {
  console.log(
    `  Poste ${String(p.number).padStart(2)}: page=${p.pageNum ?? p.page} x=${p.x?.toFixed(1)} y=${p.y?.toFixed(1)}` +
      (p.anchorX != null ? ` anchor=(${p.anchorX.toFixed(1)},${p.anchorY.toFixed(1)})` : "") +
      (p.circleX != null ? ` circle=(${p.circleX.toFixed(1)},${p.circleY.toFixed(1)})` : ""),
  );
}

console.log("\n=== DISTANCE LABEL ITEMS ===");
for (const d of parsed.distanceLabelItems ?? []) {
  console.log(`  page=${d.pageNum ?? d.page} "${d.text ?? d.str}" @ (${d.x?.toFixed(1)},${d.y?.toFixed(1)})`);
}

console.log("\n=== PARSED DISTANCES (with provenance fields) ===");
for (const d of parsed.distances ?? []) {
  console.log("  " + JSON.stringify(d));
}

console.log("\n=== CABLE PATHS (per page, point counts + bbox) ===");
for (const cp of parsed.cablePaths ?? []) {
  const pts = cp.points ?? cp;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  console.log(
    `  page=${cp.pageNum ?? cp.page} n=${pts.length} bbox=[${Math.min(...xs).toFixed(0)},${Math.min(...ys).toFixed(0)} → ${Math.max(...xs).toFixed(0)},${Math.max(...ys).toFixed(0)}]`,
  );
}

console.log("\n=== CABLE SEGMENTS sample (page 3, near junction x 650-820 y 260-420) ===");
let n = 0;
for (const s of parsed.cableSegments ?? []) {
  const pg = s.pageNum ?? s.page;
  if (pg !== 3) continue;
  const inBox = (x, y) => x >= 640 && x <= 830 && y >= 250 && y <= 430;
  if (inBox(s.x1, s.y1) || inBox(s.x2, s.y2)) {
    console.log(
      `  (${s.x1.toFixed(1)},${s.y1.toFixed(1)}) → (${s.x2.toFixed(1)},${s.y2.toFixed(1)})` +
        (s.layer ? ` [${s.layer}]` : ""),
    );
    if (++n > 60) break;
  }
}
