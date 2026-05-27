// Direct test: what does associateDistances give for harness vs browser inputs?
import { readFileSync } from "fs";
import { parsePdf } from "./parser/pdf-parser.js";
import { associateDistances } from "./parser/distance-associator.js";
import { computeScaleFactor } from "./parser/geo/utm-calibrator.js";

const buf = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);

// Replicate the harness's distance association
const overviewScale = computeScaleFactor(parsed.utmGridPathsPerPage.get(2) ?? [], []);
const perPageScale = (pageNum) => {
  const paths = parsed.utmGridPathsPerPage.get(pageNum);
  if (paths?.length) {
    const sf = computeScaleFactor(paths, []);
    if (sf != null) return sf;
  }
  return overviewScale ?? null;
};

console.log(`overviewScale = ${overviewScale}`);

// Get the PARSE DEBUG positions
const debugText = readFileSync("./debug_results.txt", "utf8");
const debugDumpStart = debugText.indexOf("PARSE DEBUG DUMP");
const debugBlock = debugText.slice(debugDumpStart, debugText.indexOf("\nPage dimensions", debugDumpStart));
const debugPosts = [];
for (const line of debugBlock.split("\n")) {
  const m = line.match(/Post\s+(\d+):\s+page=(\d+)\s+x=([\d.]+)\s+y=([\d.]+)/);
  if (!m) continue;
  debugPosts.push({
    number: parseInt(m[1], 10),
    pageNum: parseInt(m[2], 10),
    x: parseFloat(m[3]),
    y: parseFloat(m[4]),
  });
}

console.log("\n=== Test 1: associateDistances with parsed.posts (browser positions) ===");
const r1 = associateDistances(parsed.posts.map(p => ({...p})), parsed.distanceLabelItems ?? [], [], { perPageScale });
for (const d of r1.distances) {
  if (d.from <= 14 && d.from >= 1) {
    console.log(`  ${d.from}→${d.to}: ${d.meters}m`);
  }
}

console.log("\n=== Test 2: associateDistances with debug_results.txt PARSE DEBUG positions ===");
const r2 = associateDistances(debugPosts.map(p => ({...p})), parsed.distanceLabelItems ?? [], [], { perPageScale });
for (const d of r2.distances) {
  if (d.from <= 14 && d.from >= 1) {
    console.log(`  ${d.from}→${d.to}: ${d.meters}m`);
  }
}

// Check if browser parsed.distances differs because parsePdf called associateDistances
// BEFORE N3 (when posts were still at Numero_Poste positions)
console.log("\n=== Test 3: parsed.distances (from parsePdf, called BEFORE N3) ===");
for (const d of parsed.distances) {
  if (d.from <= 14 && d.from >= 1) {
    console.log(`  ${d.from}→${d.to}: ${d.meters}m`);
  }
}
