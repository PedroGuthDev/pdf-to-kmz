// Does the DRAWN geometry (post chord length x per-sheet scale) already encode
// the LC inter-post distances that the TEXT labels miss?
// For each consecutive pair: truthM vs scaledChordM (geometry only) vs assigned label edge.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import "fake-indexeddb/auto";
import { parsePdf } from "./parser/pdf-parser.js";
import { haversineMeters } from "./parser/geo/utm-calibrator.js";
import { computeScaleFactor } from "./parser/geo/utm-calibrator.js";
import { deduplicatePostsPreferLowerPage } from "./parser/post-assembler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF = path.join(__dirname, "INFOVIAS_AAF INTERNET_São José_RUA LUIZ CAROLINO PEREIRA_v1.pdf");
const GT = path.join(__dirname, "parser/__tests__/fixtures/luizcarolino-ground-truth.json");

const truth = JSON.parse(readFileSync(GT, "utf8"));
const byNum = new Map(truth.map((g) => [g.number, g]));
const buf = readFileSync(PDF);
const parsed = await parsePdf(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

const posts = deduplicatePostsPreferLowerPage(parsed.posts ?? []);
const pByNum = new Map(posts.map((p) => [p.number, p]));
const grid = parsed.utmGridPathsPerPage;
const overviewScale =
  grid instanceof Map ? computeScaleFactor(grid.get(2) ?? [], []) : computeScaleFactor(grid?.[2] ?? [], []);
const OVERVIEW_TO_DETAIL_SCALE = 1191 / 842;
const perPageScale = (pn) => {
  const paths = grid instanceof Map ? grid.get(pn) : grid?.[pn];
  if (paths?.length) {
    const sf = computeScaleFactor(paths, []);
    if (sf != null) return sf;
  }
  return overviewScale != null ? overviewScale * OVERVIEW_TO_DETAIL_SCALE : null;
};

const pos = (p) => ({ x: p.anchorX ?? p.x, y: p.anchorY ?? p.y });
const edge = (a, b) => (parsed.distances ?? []).find((d) => (d.from === a && d.to === b) || (d.from === b && d.to === a));

console.log("=== LC: truth vs DRAWN-geometry vs label edge (consecutive posts) ===");
console.log("step    truthM   geomM   labelM  src                   |geom-truth|  |label-truth|");
let geomErrTot = 0, labelErrTot = 0, geomN = 0, labelN = 0;
for (let n = 1; n <= 30; n++) {
  const a = byNum.get(n), b = byNum.get(n + 1);
  if (!a || !b) continue;
  const tm = haversineMeters(a.lat, a.lon, b.lat, b.lon);
  const pa = pByNum.get(n), pb = pByNum.get(n + 1);
  let geomM = null, samePage = null;
  if (pa && pb) {
    samePage = pa.pageNum != null && pa.pageNum === pb.pageNum;
    const pt = Math.hypot(pos(pb).x - pos(pa).x, pos(pb).y - pos(pa).y);
    const sf = samePage ? perPageScale(pa.pageNum) : null; // cross-page chord meaningless in pt
    geomM = sf != null && samePage ? pt * sf : null;
  }
  const e = edge(n, n + 1);
  const em = e ? e.meters : null;
  const src = e ? e.source ?? "" : "MISSING";
  const ge = geomM != null ? Math.abs(geomM - tm) : null;
  const le = em != null ? Math.abs(em - tm) : null;
  if (ge != null) { geomErrTot += ge; geomN++; }
  if (le != null) { labelErrTot += le; labelN++; }
  const pg = pa && pb ? `${pa.pageNum}${samePage ? "" : "/" + pb.pageNum}` : "?";
  console.log(
    `${String(n).padStart(2)}->${String(n + 1).padStart(2)}  ${tm.toFixed(1).padStart(6)}  ` +
      `${geomM == null ? "  xpage" : geomM.toFixed(1).padStart(6)}  ${em == null ? "  null" : em.toFixed(1).padStart(6)}  ` +
      `${String(src).padEnd(20)}  ${ge == null ? "    -" : ge.toFixed(1).padStart(6)}       ${le == null ? "    -" : le.toFixed(1).padStart(6)}   pg${pg}`,
  );
}
console.log(`\nmean |geom-truth| (same-page only, n=${geomN}) = ${(geomErrTot / Math.max(1, geomN)).toFixed(1)}m`);
console.log(`mean |label-truth| (n=${labelN}) = ${(labelErrTot / Math.max(1, labelN)).toFixed(1)}m`);

// Do posts carry absolute geo coords we could use directly for cross-page spans?
const sample = posts.slice(0, 3).map((p) => Object.keys(p));
console.log("\npost object keys (sample):", JSON.stringify(sample[0] ?? []));
