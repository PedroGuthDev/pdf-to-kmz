// Replicate harness flow to see what N3 produces for posts 4-6
import { readFileSync, existsSync } from "fs";
import { parsePdf } from "./parser/pdf-parser.js";
import { associateDistances } from "./parser/distance-associator.js";
import { assignPolesGloballyByLabels } from "./parser/post-positioning.js";
import { buildCablesByPage } from "./parser/cable-builder.js";
import { prefillGapDistancesForPolePlacement } from "./parser/geo/label-lsq-calibrator.js";
import { computeScaleFactor } from "./parser/geo/utm-calibrator.js";

const buf = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);

// Load PARSE DEBUG positions like harness does
const text = readFileSync("./debug_results.txt", "utf8");
const dumpIdx = text.indexOf("PARSE DEBUG DUMP");
const block = dumpIdx >= 0 ? text.slice(dumpIdx, text.indexOf("\nPage dimensions", dumpIdx)) : text;
const debugPosts = [];
for (const line of block.split("\n")) {
  const m = line.match(/Post\s+(\d+):\s+page=(\d+)\s+x=([\d.]+)\s+y=([\d.]+)/);
  if (!m) continue;
  const p = { number: parseInt(m[1], 10), pageNum: parseInt(m[2], 10), x: parseFloat(m[3]), y: parseFloat(m[4]) };
  const am = line.match(/anchor=\(([\d.]+)\s*,\s*([\d.]+)\)/);
  if (am) { p.anchorX = parseFloat(am[1]); p.anchorY = parseFloat(am[2]); }
  debugPosts.push(p);
}
debugPosts.sort((a, b) => a.number - b.number);

console.log("PARSE DEBUG initial positions for posts 4-6:");
for (const n of [4, 5, 6]) {
  const p = debugPosts.find(x => x.number === n);
  console.log(`  Post ${n}: x=${p.x.toFixed(2)} y=${p.y.toFixed(2)} anchorX=${p.anchorX?.toFixed(2)} anchorY=${p.anchorY?.toFixed(2)}`);
}

// Re-associate distances (like harness)
const overviewScale = computeScaleFactor(parsed.utmGridPathsPerPage.get(2) ?? [], []);
const perPageScale = (pn) => {
  const paths = parsed.utmGridPathsPerPage.get(pn);
  if (paths?.length) { const sf = computeScaleFactor(paths, []); if (sf != null) return sf; }
  return overviewScale ?? null;
};
const { distances } = associateDistances(debugPosts, parsed.distanceLabelItems ?? [], [], { perPageScale });

// Prefill gaps
const cablesForPrefill = buildCablesByPage(parsed.cableSegments);
const prefilled = prefillGapDistancesForPolePlacement(debugPosts, distances, cablesForPrefill);
console.log(`\nPrefilled ${prefilled} labels. Now:`);
for (let n = 1; n <= 7; n++) {
  const d = distances.find(d => d.from === n && d.to === n+1);
  console.log(`  ${n}->${n+1}: ${d?.meters}m`);
}

// Run N3
console.log("\nRunning assignPolesGloballyByLabels:");
const n3Warnings = [];
assignPolesGloballyByLabels(
  debugPosts,
  parsed.posteRawCentroids,
  parsed.cablePaths,
  distances,
  n3Warnings,
  {
    postByNum: new Map(debugPosts.map(p => [p.number, p])),
    perPageScale,
  },
);

console.log("\nPosts 1-15 after N3:");
for (let n = 1; n <= 15; n++) {
  const p = debugPosts.find(x => x.number === n);
  console.log(`  Post ${String(n).padStart(2)}: x=${p.x.toFixed(2)} y=${p.y.toFixed(2)} page=${p.pageNum}`);
}
