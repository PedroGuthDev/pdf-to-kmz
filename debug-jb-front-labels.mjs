// JB front-label probe: dump distance labels near posts 1-14 and their gaps
// to every nearby consecutive chord, plus the final association result.
import { readFileSync } from "fs";
import { parsePdf } from "./parser/pdf-parser.js";
import { associateDistances } from "./parser/distance-associator.js";
import { computeScaleFactor } from "./parser/geo/utm-calibrator.js";

const buf = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);

const posts = parsed.posts;
const front = posts.filter((p) => p.number >= 1 && p.number <= 15);
const frontPage = front[0]?.pageNum;
console.log(`front page = ${frontPage}`);
console.log("\n=== posts 1-15 anchors ===");
for (const p of front) {
  console.log(
    `post ${String(p.number).padStart(2)}: page=${p.pageNum} x=${(p.anchorX ?? p.x).toFixed(1)} y=${(p.anchorY ?? p.y).toFixed(1)} (sym x=${p.x.toFixed(1)} y=${p.y.toFixed(1)})`,
  );
}

const items = (parsed.distanceLabelItems ?? []).filter(
  (it) => (it.pageNum ?? 1) === frontPage,
);
console.log(`\n=== ${items.length} distance labels on page ${frontPage} ===`);

const byNum = new Map(front.map((p) => [p.number, p]));
function chordGap(lx, ly, a, b) {
  const ax = a.anchorX ?? a.x, ay = a.anchorY ?? a.y;
  const bx = b.anchorX ?? b.x, by = b.anchorY ?? b.y;
  const dx = bx - ax, dy = by - ay;
  const L2 = dx * dx + dy * dy;
  if (L2 < 1e-9) return Math.hypot(lx - ax, ly - ay);
  let t = ((lx - ax) * dx + (ly - ay) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(lx - (ax + dx * t), ly - (ay + dy * t));
}

for (const it of items) {
  const w = typeof it.width === "number" && it.width > 0 ? it.width : 0;
  const lx = w > 0 ? it.x + w * 0.5 : it.x;
  const ly = it.y;
  const gaps = [];
  for (let n = 1; n <= 14; n++) {
    const a = byNum.get(n), b = byNum.get(n + 1);
    if (!a || !b) continue;
    gaps.push({ span: `${n}-${n + 1}`, g: chordGap(lx, ly, a, b) });
  }
  gaps.sort((u, v) => u.g - v.g);
  const top = gaps.slice(0, 3).map((g) => `${g.span}:${g.g.toFixed(1)}pt`).join("  ");
  console.log(
    `"${it.str}" @ (${lx.toFixed(1)}, ${ly.toFixed(1)})  nearest chords: ${top}`,
  );
}

const overviewScale = computeScaleFactor(parsed.utmGridPathsPerPage.get(2) ?? [], []);
const perPageScale = (pageNum) => {
  const paths = parsed.utmGridPathsPerPage.get(pageNum);
  if (paths?.length) {
    const sf = computeScaleFactor(paths, []);
    if (sf != null) return sf;
  }
  return overviewScale ?? null;
};
const r = associateDistances(
  posts.map((p) => ({ ...p })),
  parsed.distanceLabelItems ?? [],
  [],
  { perPageScale },
);
console.log("\n=== association result (from<=15) ===");
for (const d of r.distances) {
  if (d.from <= 15) console.log(`  ${d.from}→${d.to}: ${d.meters}m (${d.source ?? "?"})`);
}
console.log("\n=== warnings ===");
for (const w of r.warnings ?? []) console.log("  " + w);
