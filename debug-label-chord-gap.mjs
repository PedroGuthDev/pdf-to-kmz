/**
 * Diagnose label vs straight-chord mismatch for posts 9–13 (page 3).
 * Run: node debug-label-chord-gap.mjs
 */
import { readFileSync } from "fs";
import { parsePdf } from "./parser/pdf-parser.js";
import { associateDistances } from "./parser/distance-associator.js";
import {
  buildCablesByPage,
  nearestPointOnPathOps,
} from "./parser/cable-builder.js";
import { computeScaleFactor } from "./parser/geo/utm-calibrator.js";

function loadParseDebug() {
  const text = readFileSync("./debug_results.txt", "utf8");
  const idx = text.indexOf("PARSE DEBUG DUMP");
  const block = text.slice(idx, text.indexOf("\nPage dimensions", idx));
  const byNum = new Map();
  for (const line of block.split("\n")) {
    const m = line.match(
      /Post\s+(\d+):\s+page=(\d+)\s+x=([\d.]+)\s+y=([\d.]+)/,
    );
    if (!m) continue;
    const num = parseInt(m[1], 10);
    if (byNum.has(num)) continue;
    const post = {
      number: num,
      pageNum: parseInt(m[2], 10),
      x: parseFloat(m[3]),
      y: parseFloat(m[4]),
    };
    const am = line.match(/anchor=\(([\d.]+)\s*,\s*([\d.]+)\)/);
    if (am) {
      post.anchorX = parseFloat(am[1]);
      post.anchorY = parseFloat(am[2]);
    }
    byNum.set(num, post);
  }
  return [...byNum.values()].sort((a, b) => a.number - b.number);
}

/** Arc length along ops between two PDF points (project to path first). */
function arcPtBetween(ops, ax, ay, bx, by) {
  const ha = nearestPointOnPathOps(ax, ay, ops);
  const hb = nearestPointOnPathOps(bx, by, ops);
  return Math.abs(hb.t - ha.t);
}

const buf = readFileSync(
  "./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf",
);
const parsed = await parsePdf(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);
const posts = loadParseDebug();
const page3 = posts.filter((p) => p.pageNum === 3);

const overviewSf = computeScaleFactor(
  parsed.utmGridPathsPerPage?.get(2) ?? [],
  [],
);
const page3Sf = computeScaleFactor(
  parsed.utmGridPathsPerPage?.get(3) ?? [],
  [],
);
const detailSf = overviewSf != null ? overviewSf * (303.6 / 1191) : null;

const { distances } = associateDistances(
  posts,
  parsed.distanceLabelItems ?? [],
  [],
  {
    scaleFactor: overviewSf ?? undefined,
    detailScaleFactor: detailSf ?? undefined,
  },
);
const distMap = new Map();
for (const d of distances) {
  if (d.meters != null) distMap.set(`${d.from}->${d.to}`, d.meters);
}

const cablesByPage = buildCablesByPage(parsed.cablePaths ?? []);
const paths = cablesByPage.get(3) ?? [];
let routeOps = paths[0] ?? null;
let bestScore = -Infinity;
const ref = page3.find((p) => p.number === 9) ?? page3[0];
for (const ops of paths) {
  const hit = nearestPointOnPathOps(ref.x, ref.y, ops);
  const score = hit.t - hit.d * 2;
  if (score > bestScore) {
    bestScore = score;
    routeOps = ops;
  }
}

console.log("\n=== Scale factors ===");
console.log(`  Page 2 UTM (overview): ${overviewSf?.toFixed(6)} m/pt`);
console.log(`  Page 3 UTM grid:       ${page3Sf?.toFixed(6)} m/pt`);
console.log(
  `  Detail viewport est:   ${detailSf?.toFixed(6)} m/pt (overview × 303.6/1191)`,
);

console.log("\n=== Segments 8→13 (PARSE DEBUG x,y) ===");
console.log(
  "seg     label(m)  chordPt  chord×p3sf  arcPt   arc×p3sf  ratio arc/label  label→chord dist(pt)",
);

const nums = [8, 9, 10, 11, 12, 13];
for (let i = 0; i < nums.length - 1; i++) {
  const a = posts.find((p) => p.number === nums[i]);
  const b = posts.find((p) => p.number === nums[i + 1]);
  if (!a || !b) continue;
  const chordPt = Math.hypot(b.x - a.x, b.y - a.y);
  const chordM = chordPt * (page3Sf ?? 0.3546);
  const arcPt = routeOps ? arcPtBetween(routeOps, a.x, a.y, b.x, b.y) : NaN;
  const arcM = arcPt * (page3Sf ?? 0.3546);
  const label = distMap.get(`${a.number}->${b.number}`) ?? null;

  // nearest label glyph to segment midpoint
  let labelDistToSeg = "";
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  let best = Infinity;
  for (const dt of parsed.distanceLabelItems ?? []) {
    if ((dt.pageNum ?? 1) !== 3) continue;
    const norm = dt.str.trim().replace(/\s+/g, "").replace(",", ".");
    if (!/^\d+(\.\d+)?$/.test(norm)) continue;
    const v = parseFloat(norm);
    if (Math.abs(v - (label ?? -1)) > 0.05) continue;
    const w = typeof dt.width === "number" && dt.width > 0 ? dt.width : 0;
    const lx = w > 0 ? dt.x + w * 0.5 : dt.x;
    const d = Math.hypot(lx - mx, dt.y - my);
    if (d < best) best = d;
  }
  if (Number.isFinite(best)) labelDistToSeg = best.toFixed(1);

  const ratio = label != null && label > 0 ? (arcM / label).toFixed(3) : "—";
  console.log(
    `${String(a.number).padStart(2)}→${String(b.number).padStart(2)}  ` +
      `${label != null ? label.toFixed(1).padStart(7) : "     —"}  ` +
      `${chordPt.toFixed(1).padStart(7)}  ` +
      `${chordM.toFixed(1).padStart(10)}  ` +
      `${arcPt.toFixed(1).padStart(7)}  ` +
      `${arcM.toFixed(1).padStart(9)}  ` +
      `${ratio.padStart(12)}  ` +
      `${labelDistToSeg.padStart(8)}`,
  );
}

console.log("\n=== Pole symbol vs post (x,y) for 9–12 ===");
for (const n of [9, 10, 11, 12]) {
  const p = posts.find((x) => x.number === n);
  if (!p) continue;
  const symD = routeOps ? nearestPointOnPathOps(p.x, p.y, routeOps).d : NaN;
  console.log(
    `  Post ${n}: (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) cable dist ${symD.toFixed(1)} pt`,
  );
}

// Labels on page 3 near segment 9-12
console.log("\n=== Distância_Poste glyphs on page 3 (value @ x,y) ===");
for (const dt of parsed.distanceLabelItems ?? []) {
  if ((dt.pageNum ?? 1) !== 3) continue;
  const norm = dt.str.trim().replace(/\s+/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(norm)) continue;
  const v = parseFloat(norm);
  if (v < 8 || v > 40) continue;
  const w = typeof dt.width === "number" && dt.width > 0 ? dt.width : 0;
  const lx = w > 0 ? dt.x + w * 0.5 : dt.x;
  console.log(`  ${v.toFixed(1)} m @ (${lx.toFixed(1)}, ${dt.y.toFixed(1)})`);
}
