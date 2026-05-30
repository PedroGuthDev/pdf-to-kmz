import "fake-indexeddb/auto";
import { readFileSync, writeFileSync } from "node:fs";
const OUT = [];
const log = (...a) => OUT.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
import { parsePdf } from "./parser/pdf-parser.js";
import { deduplicatePostsPreferLowerPage } from "./parser/post-assembler.js";
import { calculateCoordinates } from "./parser/coordinate-calculator.js";
import { createRegionLibrary } from "./parser/dwg/region-library.js";
import { pairPostsByGraphWalk } from "./parser/dwg/graph-walker.js";
import { buildAdjacencyGraph, buildPostIndex } from "./parser/dwg/region-pairing.js";

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

const opts = {
  pageDimensions: parsed.pageDimensions,
  viewportBoxes: parsed.viewportBoxes,
  utmGridPathsPerPage: parsed.utmGridPathsPerPage,
};

// === STANDALONE-style pdfResult (no opts -> no UTM, lat/lon null) ===
const pdfStandalone = calculateCoordinates(posts, distances, start.lat, start.lon, parsed.cableSegments ?? []);
// === HARNESS/cascade-style pdfResult (WITH opts -> full UTM) ===
const pdfHarness = calculateCoordinates(posts, distances, start.lat, start.lon, parsed.cableSegments ?? [], opts);

function key(c) { return `${c.from}->${c.to}`; }
function summarize(label, pr) {
  const conns = pr.connections ?? [];
  const route = deduplicatePostsPreferLowerPage(
    Array.isArray(pr.posts) && pr.posts.length ? pr.posts : posts
  ).sort((a, b) => a.number - b.number);
  const gps = new Map();
  for (const p of pr.posts ?? []) if (p?.number != null && p.lat != null && p.lon != null) gps.set(p.number, { lat: p.lat, lon: p.lon });
  return { label, connKeys: new Set(conns.map(key)), conns, route, gps };
}
const A = summarize("standalone", pdfStandalone);
const B = summarize("harness", pdfHarness);

log("standalone connections:", A.conns.length, " harness connections:", B.conns.length);
log("standalone route len:", A.route.length, " harness route len:", B.route.length);
log("standalone gps size:", A.gps.size, " harness gps size:", B.gps.size);

const onlyB = [...B.connKeys].filter((k) => !A.connKeys.has(k));
const onlyA = [...A.connKeys].filter((k) => !B.connKeys.has(k));
log("conns in harness not standalone:", onlyB);
log("conns in standalone not harness:", onlyA);

// gap flag differences around 40-46
function connGap(conns, a, b) {
  const c = conns.find((x) => x && ((x.from === a && x.to === b) || (x.from === b && x.to === a)));
  return c ? c.gap : "(absent)";
}
log("\ngap flags 40-46:");
for (const [a, b] of [[40,41],[41,42],[42,43],[43,44],[44,45],[45,46]]) {
  log(`  ${a}->${b}: standalone gap=${connGap(A.conns, a, b)} harness gap=${connGap(B.conns, a, b)}`);
}

// route order differences
const aNums = A.route.map((p) => p.number).join(",");
const bNums = B.route.map((p) => p.number).join(",");
log("\nroute identical:", aNums === bNums);

// Now run the walk with each (connections + route + gps) combo, no/with GPS.
process.env.GW_RETURN_IDX = "1";
function runWalk(label, route, conns, gps) {
  const warnings = [];
  const gw = pairPostsByGraphWalk({
    posts: route, distances, connections: conns,
    startLat: start.lat, startLon: start.lon,
    region: { posts: regionPosts, cableEdges: region.cableEdges },
    postIndex, adjacencyGraph, warnings, gpsByPostNumber: gps,
  });
  const wf = warnings.filter((w) => w?.kind === "dwg-graph-walk-fail").slice(-1)[0];
  log(`  ${label}: ok=${gw.ok} failedAt=${gw.failedAt ?? "-"} reason=${wf?.reason ?? "-"}`);
  return gw;
}
log("\n=== walk runs ===");
runWalk("standalone-conns + no-gps", A.route, A.conns, null);
runWalk("standalone-conns + std-gps", A.route, A.conns, A.gps);
runWalk("harness-conns + no-gps", B.route, B.conns, null);
runWalk("harness-conns + harness-gps", B.route, B.conns, B.gps);

writeFileSync("./cmp-result.txt", OUT.join("
") + "
");
