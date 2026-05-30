import "fake-indexeddb/auto";
import { readFileSync, writeFileSync } from "node:fs";
import { parsePdf } from "./parser/pdf-parser.js";
import { deduplicatePostsPreferLowerPage } from "./parser/post-assembler.js";
import { calculateCoordinates } from "./parser/coordinate-calculator.js";
import { createRegionLibrary } from "./parser/dwg/region-library.js";
import { pairPostsByGraphWalk } from "./parser/dwg/graph-walker.js";
import { buildAdjacencyGraph, buildPostIndex } from "./parser/dwg/region-pairing.js";

const OUT = [];
const log = (...a) => OUT.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));

const refByNum = new Map();
for (const line of readFileSync("./coordenadas postes siriu.txt", "utf8").split("\n")) {
  const m = line.match(/Poste\s+(\d+).*?(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/i);
  if (m) refByNum.set(+m[1], { lat: +m[2], lon: +m[3] });
}
const refs = [...refByNum.entries()].map(([num, v]) => ({ num, ...v })).sort((a, b) => a.num - b.num);
const start = refs[0];

const pdfBuf = readFileSync("./INFOVIAS_PJC INTERNET_Garopaba_Praia do Siriu_v01.pdf");
const parsed = await parsePdf(pdfBuf.buffer.slice(pdfBuf.byteOffset, pdfBuf.byteOffset + pdfBuf.byteLength));
const posts = parsed.posts ?? [];
const distances = parsed.distances ?? [];

const lib = createRegionLibrary(globalThis.indexedDB);
await lib.addRegion("siriu", new Blob([readFileSync("./siriu.dxf", "utf8")], { type: "text/plain" }));
const region = await lib.getRegionWithIndex("siriu");
const regionPosts = region.posts ?? [];
const regionEdges = region.cableEdges ?? [];
const postIndex = region.postIndex ?? buildPostIndex(regionPosts);
const adjacencyGraph = region.adjacencyGraph ?? buildAdjacencyGraph(regionPosts, regionEdges);

const opts = { pageDimensions: parsed.pageDimensions, viewportBoxes: parsed.viewportBoxes, utmGridPathsPerPage: parsed.utmGridPathsPerPage };
const pr = calculateCoordinates(posts, distances, start.lat, start.lon, parsed.cableSegments ?? [], opts);
const route = deduplicatePostsPreferLowerPage(pr.posts).sort((a, b) => a.number - b.number);
const gps = new Map();
for (const p of pr.posts ?? []) if (p?.number != null && p.lat != null && p.lon != null) gps.set(p.number, { lat: p.lat, lon: p.lon });

process.env.GW_RETURN_IDX = "1";
process.env.GW_RETURN_PARTIAL = "1";
process.env.GW_TRACE = "1";

function run(label, g) {
  // capture GW_TRACE stderr by patching console.error
  const orig = console.error;
  const lines = [];
  console.error = (...a) => lines.push(a.join(" "));
  const warnings = [];
  const gw = pairPostsByGraphWalk({
    posts: route, distances, connections: pr.connections,
    startLat: start.lat, startLon: start.lon,
    region: { posts: regionPosts, cableEdges: region.cableEdges },
    postIndex, adjacencyGraph, warnings, gpsByPostNumber: g,
  });
  console.error = orig;
  const idxs = gw.idxByPostNumber ?? {};
  // full chosen-idx map by post number for divergence detection
  const idxMap = {};
  for (let n = 1; n <= 46; n++) idxMap[n] = idxs[n] ?? null;
  return { label, ok: gw.ok, failedAt: gw.failedAt, idxMap, warnings, lines };
}

const A = run("NO-GPS", null);
const B = run("WITH-GPS", gps);

log(`NO-GPS:   ok=${A.ok} failedAt=${A.failedAt ?? "-"}`);
log(`WITH-GPS: ok=${B.ok} failedAt=${B.failedAt ?? "-"}`);

// First post number where chosen idx differs
let firstDiff = null;
for (let n = 1; n <= 46; n++) {
  if (A.idxMap[n] !== B.idxMap[n]) { firstDiff = n; break; }
}
log(`First divergent post: ${firstDiff} (NO-GPS idx=${A.idxMap[firstDiff]} vs WITH-GPS idx=${B.idxMap[firstDiff]})`);

// Show idx map around divergence
const lo = Math.max(1, (firstDiff ?? 1) - 3);
log("idx map (post: nogps / gps):");
for (let n = lo; n <= 46; n++) {
  const mark = A.idxMap[n] !== B.idxMap[n] ? "  <-- DIFF" : "";
  log(`  ${n}: ${A.idxMap[n]} / ${B.idxMap[n]}${mark}`);
}

// Warnings emitted in WITH-GPS run from a few steps before divergence onward
log("\nWITH-GPS warnings (dwg-* kinds):");
for (const w of B.warnings) {
  if (typeof w === "object" && w && String(w.kind ?? "").startsWith("dwg")) {
    log("  " + JSON.stringify(w));
  }
}
log("\nNO-GPS warnings (dwg-* kinds):");
for (const w of A.warnings) {
  if (typeof w === "object" && w && String(w.kind ?? "").startsWith("dwg")) {
    log("  " + JSON.stringify(w));
  }
}

// GW trace lines around divergence (both)
const stepRe = (lo2, hi2) => new RegExp(`\\[gw(-fail)?\\] (${lo2})->`);
log(`\nNO-GPS trace steps ${lo}..44:`);
for (const l of A.lines) if (/\[gw(-fail)?\] \d+->/.test(l)) {
  const m = l.match(/\] (\d+)->/); if (m && +m[1] >= lo - 1 && +m[1] <= 44) log("  " + l);
}
log(`\nWITH-GPS trace steps ${lo}..44:`);
for (const l of B.lines) if (/\[gw(-fail)?\] \d+->/.test(l)) {
  const m = l.match(/\] (\d+)->/); if (m && +m[1] >= lo - 1 && +m[1] <= 44) log("  " + l);
}

writeFileSync("./gps43-trace.txt", OUT.join("\n") + "\n");
