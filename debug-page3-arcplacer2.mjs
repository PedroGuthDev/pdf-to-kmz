// Investigate page 3 cable-arc-placer behavior with per-page scale
import { readFileSync } from "fs";
import { parsePdf } from "./parser/pdf-parser.js";
import { buildCablesByPage, nearestPointOnPathOps, nearestCableHitOnPage, isOffRouteCablePost } from "./parser/cable-builder.js";
import { computeScaleFactor } from "./parser/geo/utm-calibrator.js";
import { placePostsOnCableByArcLength } from "./parser/geo/cable-arc-placer.js";

const buf = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);

const sorted = [...parsed.posts].sort((a, b) => a.number - b.number);
const cablesByPage = buildCablesByPage(parsed.cableSegments);
const postByNum = new Map(sorted.map((p) => [p.number, p]));

const distMap = new Map();
for (const d of parsed.distances) {
  distMap.set(`${d.from}->${d.to}`, d.meters);
}

const warnings = [];
const utmGridPathsPerPage = parsed.utmGridPathsPerPage;

const perPageScale = (pn) => {
  const paths = utmGridPathsPerPage?.get(pn);
  if (paths?.length) {
    const sf = computeScaleFactor(paths, warnings);
    if (sf != null) {
      console.log(`  perPageScale(${pn}) = ${sf}`);
      return sf;
    }
  }
  return 0.354610; // fallback (not used here)
};

console.log("Per-page scales:");
const page3Scale = perPageScale(3);
const page4Scale = perPageScale(4);
const page5Scale = perPageScale(5);

console.log("\nPage 3 label-chord consistency with PAGE-3 scale:");
const page3Posts = sorted.filter((p) => p.pageNum === 3);
let consistent = 0, total = 0;
for (let i = 0; i < page3Posts.length - 1; i++) {
  const p1 = page3Posts[i];
  const p2 = page3Posts[i + 1];
  const m = distMap.get(`${p1.number}->${p2.number}`);
  if (m == null) continue;
  total++;
  const actual = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const expected = m / page3Scale;
  const ratio = actual / expected;
  const inRange = ratio >= 0.88 && ratio <= 1.12;
  if (inRange) consistent++;
}
console.log(`  Consistency: ${consistent}/${total}`);

// Run cable-arc-placer
console.log("\nRunning placePostsOnCableByArcLength:");
const placerWarnings = [];
const placer = placePostsOnCableByArcLength({
  sortedPosts: sorted,
  distMap,
  cablesByPage,
  perPageScale,
  postByNum,
  warnings: placerWarnings,
});
console.log(`  Placed: ${placer.placed.size} posts on ${placer.pagesPlaced.size} pages`);
console.log(`  Pages placed: [${[...placer.pagesPlaced].join(", ")}]`);
console.log(`  Skipped: ${placer.skipped.length}`);
console.log("  Warnings:");
for (const w of placerWarnings) console.log("    " + w);

console.log("\nNew positions for page 3 posts 4, 5, 6:");
for (const num of [4, 5, 6]) {
  const placedP = placer.placed.get(num);
  const origP = page3Posts.find((p) => p.number === num);
  if (placedP) {
    console.log(`  Post ${num}: was (${origP.x.toFixed(1)}, ${origP.y.toFixed(1)}) → now (${placedP.x.toFixed(1)}, ${placedP.y.toFixed(1)})`);
  } else {
    console.log(`  Post ${num}: NOT placed (skipped, see skipped reasons above)`);
    const skips = placer.skipped.filter((s) => s.number === num);
    for (const s of skips) console.log(`    reason: ${s.reason}`);
  }
}

console.log("\nisOffRouteCablePost detection for page 3 posts:");
for (const p of page3Posts) {
  const isTap = isOffRouteCablePost(p, postByNum, cablesByPage);
  console.log(`  Post ${p.number}: isOffRouteCablePost=${isTap}`);
}
