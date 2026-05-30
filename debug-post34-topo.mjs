/**
 * Probe: dump distances + connections + GT->INSERT mapping around posts 27-40.
 */
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { parsePdf } from "./parser/pdf-parser.js";
import { createRegionLibrary } from "./parser/dwg/region-library.js";
import { buildPostIndex, buildAdjacencyGraph } from "./parser/dwg/region-pairing.js";

const PDF = "./INFOVIAS_PJC INTERNET_Garopaba_Praia do Siriu_v01.pdf";
const DXF = "./siriu.dxf";
const GT_TXT = "./coordenadas postes siriu.txt";

// --- Ground truth (lat/lon) ---
function loadGT(path) {
  const refs = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/Poste\s+(\d+).*?(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/i);
    if (!m) continue;
    refs.push({ num: +m[1], lat: +m[2], lon: +m[3] });
  }
  return refs.sort((a, b) => a.num - b.num);
}
const gt = loadGT(GT_TXT);
const gtByNum = new Map(gt.map((r) => [r.num, r]));

const pdfBuf = readFileSync(PDF);
const parsed = await parsePdf(
  pdfBuf.buffer.slice(pdfBuf.byteOffset, pdfBuf.byteOffset + pdfBuf.byteLength),
);
const distances = parsed.distances ?? [];
const connections = parsed.connections ?? [];

console.log("=== DISTANCES touching posts 26..40 ===");
for (const d of distances) {
  if (d?.from == null || d?.to == null) continue;
  const lo = Math.min(d.from, d.to), hi = Math.max(d.from, d.to);
  if (hi >= 26 && lo <= 40 && (d.from >= 26 || d.to >= 26)) {
    if (lo >= 26 && hi <= 41) {
      console.log(
        `  ${d.from}->${d.to}  meters=${d.meters}  source=${d.source ?? "?"}`,
      );
    }
  }
}

console.log("\n=== CONNECTIONS touching posts 26..40 ===");
for (const c of connections) {
  if (c?.from == null || c?.to == null) continue;
  const lo = Math.min(c.from, c.to), hi = Math.max(c.from, c.to);
  if (lo >= 26 && hi <= 41) {
    console.log(
      `  ${c.from}->${c.to}  gap=${c.gap ?? false}  ${JSON.stringify(c).slice(0, 120)}`,
    );
  }
}

// --- DXF region: nearest INSERT to each GT post ---
const regionLibrary = createRegionLibrary(globalThis.indexedDB);
await regionLibrary.addRegion(
  "siriu",
  new Blob([readFileSync(DXF, "utf8")], { type: "text/plain" }),
);
const region = await regionLibrary.getRegionWithIndex("siriu");
const regionPosts = region.posts ?? [];
const regionEdges = region.cableEdges ?? [];
const graph = region.adjacencyGraph ?? buildAdjacencyGraph(regionPosts, regionEdges);

// Convert GT lat/lon to the region's coordinate frame.
// regionPosts are in DXF (UTM-like) coords. We need to map GT (lat/lon) to UTM.
// Use a simple approach: find the DXF post nearest to each GT post by
// converting GT to UTM via the harness's calibration is complex; instead
// report the DXF INSERT coordinates and we will compare spans only.
console.log(`\n=== regionPosts count: ${regionPosts.length} ===`);

// Build UTM from GT using the same calibrator the pipeline uses, if available.
import { latLonToUtm } from "./parser/geo/utm-calibrator.js";
function gtToXY(r) {
  const u = latLonToUtm(r.lat, r.lon);
  return { x: u.easting, y: u.northing };
}

// Nearest INSERT for posts 26..40
function nearestInsert(x, y) {
  let best = null, bestD = Infinity;
  for (let i = 0; i < regionPosts.length; i++) {
    const p = regionPosts[i];
    if (p.x == null || p.y == null) continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) { bestD = d; best = i; }
  }
  return { idx: best, dist: bestD };
}

const sample = gtToXY(gt[0]);
console.log(`\nGT[0] -> XY:`, sample);

console.log("\n=== Nearest DXF INSERT to GT posts 26..40 ===");
for (let n = 26; n <= 40; n++) {
  const r = gtByNum.get(n);
  if (!r) { console.log(`  post ${n}: no GT`); continue; }
  const xy = gtToXY(r);
  if (!xy || xy.x == null) { console.log(`  post ${n}: GT->XY failed`); continue; }
  const ni = nearestInsert(xy.x, xy.y);
  const adj = graph.get(ni.idx);
  console.log(
    `  post ${n}: idx=${ni.idx} dist=${ni.dist.toFixed(2)}m adj=${adj ? [...adj].join(",") : "none"}`,
  );
}
