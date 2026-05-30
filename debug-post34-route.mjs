/**
 * Probe: does the route post list contain posts 28-33? And what does
 * the connections list say around 27/28/34?
 */
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { parsePdf } from "./parser/pdf-parser.js";
import { deduplicatePostsPreferLowerPage } from "./parser/post-assembler.js";
import { calculateCoordinatesWithDwg } from "./parser/dwg/coordinate-calculator-dwg.js";
import { createRegionLibrary } from "./parser/dwg/region-library.js";

const PDF = "./INFOVIAS_PJC INTERNET_Garopaba_Praia do Siriu_v01.pdf";
const DXF = "./siriu.dxf";

const pdfBuf = readFileSync(PDF);
const parsed = await parsePdf(
  pdfBuf.buffer.slice(pdfBuf.byteOffset, pdfBuf.byteOffset + pdfBuf.byteLength),
);

console.log("=== parsed.posts numbers ===");
const pnums = (parsed.posts ?? []).map((p) => p.number).sort((a, b) => a - b);
console.log(pnums.join(","));
console.log(`count=${pnums.length}`);

console.log("\n=== parsed.connections touching 26..36 ===");
for (const c of parsed.connections ?? []) {
  if (c?.from == null || c?.to == null) continue;
  const lo = Math.min(c.from, c.to), hi = Math.max(c.from, c.to);
  if (hi >= 26 && lo <= 36 && lo >= 26) {
    console.log(`  ${c.from}->${c.to} gap=${c.gap ?? false} ${JSON.stringify(c).slice(0,140)}`);
  }
}

// Reproduce the route that the harness feeds the walker.
const regionLibrary = createRegionLibrary(globalThis.indexedDB);
await regionLibrary.addRegion("siriu", new Blob([readFileSync(DXF, "utf8")], { type: "text/plain" }));

const result = await calculateCoordinatesWithDwg(
  parsed.posts ?? [],
  parsed.distances ?? [],
  -28.0, -48.6, // dummy start; coords irrelevant for route inspection
  parsed.cableSegments ?? [],
  {
    pageDimensions: parsed.pageDimensions,
    viewportBoxes: parsed.viewportBoxes,
    utmGridPathsPerPage: parsed.utmGridPathsPerPage,
  },
  regionLibrary,
);

console.log(`\n=== result.dwgStatus=${result.dwgStatus} ===`);
console.log("=== result.connections touching 26..36 ===");
for (const c of result.connections ?? []) {
  if (c?.from == null || c?.to == null) continue;
  const lo = Math.min(c.from, c.to), hi = Math.max(c.from, c.to);
  if (hi >= 26 && lo <= 36 && lo >= 26) {
    console.log(`  ${c.from}->${c.to} gap=${c.gap ?? false}`);
  }
}

const routePosts = deduplicatePostsPreferLowerPage(
  (result.posts ?? []).length ? result.posts : parsed.posts,
).sort((a, b) => a.number - b.number);
const rnums = routePosts.map((p) => p.number);
console.log(`\n=== routePosts numbers (${rnums.length}) ===`);
console.log(rnums.join(","));
console.log(`\n28 in route? ${rnums.includes(28)}`);
console.log(`33 in route? ${rnums.includes(33)}`);
console.log(`34 in route? ${rnums.includes(34)}`);

// Per-post page numbers around 26-36
console.log("\n=== page of each post 24..40 ===");
for (const p of routePosts) {
  if (p.number >= 24 && p.number <= 40) {
    console.log(`  post ${p.number}: page=${p.page ?? p.pageNumber ?? "?"}`);
  }
}
