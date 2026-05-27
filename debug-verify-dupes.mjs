/**
 * Verify: after assignPolesGloballyByLabels, no two posts on the same page
 * share identical (x, y) coordinates.
 *
 * Input: positions from debug_results.txt PARSE DEBUG (the buggy browser snapshot).
 * If the code fix works, re-running N3 on these inputs should produce unique positions.
 */
import { readFileSync } from "fs";
import { parsePdf } from "./parser/pdf-parser.js";
import { associateDistances } from "./parser/distance-associator.js";
import { assignPolesGloballyByLabels } from "./parser/post-positioning.js";
import { computeScaleFactor } from "./parser/geo/utm-calibrator.js";

const buf = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
);

// Load the ORIGINAL buggy snapshot from the user's bug report (posts 4 and 5
// duplicated at (528.38, 321.90)). Hardcoded so the verification doesn't depend
// on debug_results.txt edits.
const posts = [
  { number: 1, pageNum: 3, x: 272.66, y: 444.30, anchorX: 272.66, anchorY: 444.30 },
  { number: 2, pageNum: 3, x: 342.38, y: 428.82, anchorX: 342.38, anchorY: 428.82 },
  { number: 3, pageNum: 3, x: 436.82, y: 396.78, anchorX: 436.82, anchorY: 396.78 },
  { number: 4, pageNum: 3, x: 528.38, y: 321.90, anchorX: 528.38, anchorY: 321.90 },
  { number: 5, pageNum: 3, x: 528.38, y: 321.90, anchorX: 508.94, anchorY: 301.74 },
  { number: 6, pageNum: 3, x: 597.38, y: 305.82, anchorX: 606.02, anchorY: 277.74 },
  { number: 7, pageNum: 3, x: 668.54, y: 261.54, anchorX: 668.54, anchorY: 261.54 },
  { number: 8, pageNum: 3, x: 752.54, y: 236.94, anchorX: 752.54, anchorY: 236.94 },
  { number: 9, pageNum: 3, x: 849.50, y: 214.98, anchorX: 849.50, anchorY: 214.98 },
  { number: 10, pageNum: 3, x: 883.10, y: 201.42, anchorX: 883.10, anchorY: 201.42 },
  { number: 11, pageNum: 3, x: 939.50, y: 189.30, anchorX: 939.50, anchorY: 189.30 },
  { number: 12, pageNum: 3, x: 986.18, y: 179.34, anchorX: 986.18, anchorY: 179.34 },
  { number: 13, pageNum: 3, x: 1048.10, y: 160.86, anchorX: 1048.10, anchorY: 160.86 },
  { number: 14, pageNum: 3, x: 1139.66, y: 136.38, anchorX: 1139.66, anchorY: 136.38 },
];

console.log("\n=== INPUT (browser snapshot, before fix) ===");
const dupesBefore = [];
const byPage = new Map();
for (const p of posts) {
  if (!byPage.has(p.pageNum)) byPage.set(p.pageNum, []);
  byPage.get(p.pageNum).push(p);
}
for (const [pg, list] of byPage) {
  list.sort((a, b) => a.number - b.number);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (Math.abs(list[i].x - list[j].x) < 0.5 && Math.abs(list[i].y - list[j].y) < 0.5) {
        dupesBefore.push([list[i].number, list[j].number, list[i].x, list[i].y]);
      }
    }
  }
}
console.log(`Duplicate position pairs BEFORE running N3: ${dupesBefore.length}`);
for (const d of dupesBefore) console.log(`  Posts ${d[0]} and ${d[1]} both at (${d[2].toFixed(2)}, ${d[3].toFixed(2)})`);

// Now re-run N3 with the buggy snapshot
const dummy = posts.map((p) => ({ ...p }));
let distances = parsed.distances ?? [];
if (parsed.distanceLabelItems?.length) {
  const { distances: assoc } = associateDistances(dummy, parsed.distanceLabelItems, []);
  distances = assoc;
}

const overviewScale = computeScaleFactor(parsed.utmGridPathsPerPage?.get(2) ?? [], []);
const perPageScale = (pn) => {
  const paths = parsed.utmGridPathsPerPage?.get(pn);
  if (paths?.length) {
    const sf = computeScaleFactor(paths, []);
    if (sf != null) return sf;
  }
  return overviewScale;
};

const warnings = [];
assignPolesGloballyByLabels(
  dummy,
  parsed.posteRawCentroids,
  parsed.cablePaths,
  distances,
  warnings,
  {
    postByNum: new Map(dummy.map((p) => [p.number, p])),
    perPageScale,
  }
);

console.log("\n=== AFTER running N3 (with fix) ===");
const dupesAfter = [];
const byPageAfter = new Map();
for (const p of dummy) {
  if (!byPageAfter.has(p.pageNum)) byPageAfter.set(p.pageNum, []);
  byPageAfter.get(p.pageNum).push(p);
}
for (const [pg, list] of byPageAfter) {
  list.sort((a, b) => a.number - b.number);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (Math.abs(list[i].x - list[j].x) < 0.5 && Math.abs(list[i].y - list[j].y) < 0.5) {
        dupesAfter.push([list[i].number, list[j].number, list[i].x, list[i].y]);
      }
    }
  }
}
console.log(`Duplicate position pairs AFTER running N3: ${dupesAfter.length}`);
for (const d of dupesAfter) console.log(`  Posts ${d[0]} and ${d[1]} both at (${d[2].toFixed(2)}, ${d[3].toFixed(2)})`);

console.log("\n=== Posts 3-6 final positions ===");
const subset = dummy.filter((p) => p.pageNum === 3 && p.number >= 3 && p.number <= 6);
subset.sort((a, b) => a.number - b.number);
for (const p of subset) {
  console.log(`  Post ${p.number}: x=${p.x.toFixed(2)} y=${p.y.toFixed(2)} anchor=(${(p.anchorX ?? p.x).toFixed(2)}, ${(p.anchorY ?? p.y).toFixed(2)})`);
}

if (dupesAfter.length === 0) {
  console.log("\n✅ FIX VERIFIED: no duplicate post positions.");
} else {
  console.log("\n❌ FIX FAILED: still has duplicates.");
  process.exit(1);
}
