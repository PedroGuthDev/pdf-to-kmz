/**
 * End-to-end DWG pairing using PDF-extracted topology (distances + connections).
 *
 * Uses:
 *  - PDF: INFOVIAS_PJC INTERNET_Garopaba_Praia do Siriu_v01.pdf
 *  - DWG: siriu.dxf (loaded into region library)
 *  - Ground truth: coordenadas postes siriu.txt
 *
 * Run:
 *   GW_RETURN_IDX=1 node debug-run-calc-dwg-from-pdf-siriu.mjs
 */
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";

import { parsePdf } from "./parser/pdf-parser.js";
import { calculateCoordinatesWithDwg } from "./parser/dwg/coordinate-calculator-dwg.js";
import { createRegionLibrary } from "./parser/dwg/region-library.js";
import { associateDistances } from "./parser/distance-associator.js";
import { computeScaleFactor, haversineMeters } from "./parser/geo/utm-calibrator.js";
import { pairPostsByGraphWalk } from "./parser/dwg/graph-walker.js";
import { buildAdjacencyGraph, buildPostIndex } from "./parser/dwg/region-pairing.js";

const PDF = "./INFOVIAS_PJC INTERNET_Garopaba_Praia do Siriu_v01.pdf";
const DXF = "./siriu.dxf";
const GT_TXT = "./coordenadas postes siriu.txt";

function loadReferenceFromTxt(path) {
  const text = readFileSync(path, "utf8");
  const refs = [];
  for (const line of text.split("\n")) {
    const m = line.match(/Poste\s+(\d+).*?(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/i);
    if (!m) continue;
    refs.push({
      num: parseInt(m[1], 10),
      lat: parseFloat(m[2]),
      lon: parseFloat(m[3]),
    });
  }
  refs.sort((a, b) => a.num - b.num);
  return refs;
}

const reference = loadReferenceFromTxt(GT_TXT);
if (!reference.length) {
  console.error(`[dwg+pdf] No ground truth posts found in ${GT_TXT}`);
  process.exit(1);
}
const refByNum = new Map(reference.map((r) => [r.num, r]));
const start = reference[0];

console.log(`\n══ Siriu DWG+PDF topology harness ══`);
console.log(`PDF: ${PDF}`);
console.log(`DXF: ${DXF}`);
console.log(`GT:  ${GT_TXT}\n`);

const pdfBuf = readFileSync(PDF);
const parsed = await parsePdf(
  pdfBuf.buffer.slice(pdfBuf.byteOffset, pdfBuf.byteOffset + pdfBuf.byteLength),
);
if (parsed.error) {
  console.error("parsePdf failed:", parsed);
  process.exit(1);
}

const posts = parsed.posts ?? [];
console.log(`[dwg+pdf] Parsed posts: ${posts.length}`);
if (posts.length < 20) {
  console.warn("[dwg+pdf] WARNING: unusually low post count; OCR may have failed.");
}

// Prefer distance labels associated from PDF text items when available.
let distances = parsed.distances ?? [];
if (posts.length && parsed.distanceLabelItems?.length) {
  // Use any available UTM grid to derive a reasonable per-page scale for association.
  let anyScale = null;
  for (let pn = 1; pn <= 12; pn++) {
    const paths = parsed.utmGridPathsPerPage?.get?.(pn);
    if (paths?.length) {
      anyScale = computeScaleFactor(paths, []);
      if (anyScale != null) break;
    }
  }
  const perPageScale = (pageNum) => {
    const paths = parsed.utmGridPathsPerPage?.get?.(pageNum);
    if (paths?.length) {
      const sf = computeScaleFactor(paths, []);
      if (sf != null) return sf;
    }
    return anyScale;
  };
  const { distances: assoc } = associateDistances(posts, parsed.distanceLabelItems, [], {
    perPageScale,
  });
  const labeled = assoc.filter((d) => d.meters != null && d.meters > 0).length;
  if (labeled >= 10) {
    distances = assoc;
    console.log(`[dwg+pdf] Using associated Distância_Poste labels: ${labeled} edges`);
  }
}

const regionLibrary = createRegionLibrary(globalThis.indexedDB);
const dxfText = readFileSync(DXF, "utf8");
await regionLibrary.addRegion("siriu", new Blob([dxfText], { type: "text/plain" }));

const region = await regionLibrary.getRegionWithIndex("siriu");
const regionPosts = region.posts ?? [];
const regionEdges = region.cableEdges ?? [];
const postIndex = region.postIndex ?? buildPostIndex(regionPosts);
const adjacencyGraph =
  region.adjacencyGraph ?? buildAdjacencyGraph(regionPosts, regionEdges);

const result = await calculateCoordinatesWithDwg(
  posts,
  distances,
  start.lat,
  start.lon,
  parsed.cableSegments ?? [],
  {
    pageDimensions: parsed.pageDimensions,
    viewportBoxes: parsed.viewportBoxes,
    utmGridPathsPerPage: parsed.utmGridPathsPerPage,
  },
  regionLibrary,
);

console.log(`\n[dwg+pdf] dwgStatus: ${result.dwgStatus ?? "?"}`);
console.log(`[dwg+pdf] dwgRegionId: ${result.dwgRegionId ?? "?"}`);
console.log(`[dwg+pdf] connections: ${(result.connections ?? []).length}`);
const has1011 =
  (result.connections ?? []).some(
    (c) =>
      (c.from === 10 && c.to === 11) ||
      (c.from === 11 && c.to === 10),
  );
console.log(`[dwg+pdf] has connection 10↔11: ${has1011}`);

// If full DWG failed, still compare partial DWG walk (e.g. posts 1..26).
if ((result.dwgStatus ?? "") === "pdf-fallback") {
  const gw = pairPostsByGraphWalk({
    posts,
    distances,
    connections: result.connections ?? [],
    startLat: start.lat,
    startLon: start.lon,
    region: { id: "siriu", posts: regionPosts, cableEdges: regionEdges },
    postIndex,
    adjacencyGraph,
    warnings: [],
  });
  const partial = gw.partialCoords ?? [];
  if (partial.length) {
    console.log(`\n[dwg+pdf] Partial DWG coords: ${partial.length} post(s)\n`);
    console.log("Post  err(m)  (DWG partial)");
    for (const c of partial) {
      const ref = refByNum.get(c.postNumber);
      if (!ref) continue;
      const err = haversineMeters(c.lat, c.lon, ref.lat, ref.lon);
      console.log(`${String(c.postNumber).padStart(3)}  ${err.toFixed(2).padStart(7)}`);
    }
  }
}

const errors = [];
let within5 = 0;
let paired = 0;
let maxErr = 0;
let firstBig = null;

console.log("\nPost  source  err(m)");
for (const p of result.posts ?? []) {
  const ref = refByNum.get(p.number);
  if (!ref) continue;
  if (p.lat == null || p.lon == null) continue;
  const err = haversineMeters(p.lat, p.lon, ref.lat, ref.lon);
  paired++;
  errors.push(err);
  if (err < 5) within5++;
  if (err > maxErr) maxErr = err;
  if (firstBig == null && err > 20) firstBig = p.number;
  console.log(
    `${String(p.number).padStart(3)}  ${(p.source ?? "pdf").padEnd(6)} ${err.toFixed(2).padStart(7)}`,
  );
}

console.log(`\n[dwg+pdf] Paired:   ${paired}/${reference.length}`);
console.log(`[dwg+pdf] < 5m:     ${within5}/${reference.length}`);
console.log(`[dwg+pdf] Max err:  ${maxErr.toFixed(2)} m`);
if (firstBig != null) console.log(`[dwg+pdf] First >20m at poste ${firstBig}`);

if ((result.warnings ?? []).length) {
  const dwgWarnings = (result.warnings ?? []).filter(
    (w) => typeof w === "object" && w && String(w.kind ?? "").startsWith("dwg"),
  );
  console.log(`\n[dwg+pdf] Warnings (${(result.warnings ?? []).length})`);
  if (dwgWarnings.length) {
    console.log(`[dwg+pdf] DWG warnings (${dwgWarnings.length}):`);
    for (const w of dwgWarnings.slice(0, 25)) console.log(`  ${JSON.stringify(w)}`);
  } else {
    console.log("[dwg+pdf] No DWG warnings found in result.warnings.");
  }
}

