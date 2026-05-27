// Investigate why cable-arc-placer doesn't fix posts 4-6 on page 3 in browser path
import { readFileSync } from "fs";
import { parsePdf } from "./parser/pdf-parser.js";
import { buildCablesByPage, nearestPointOnPathOps, nearestCableHitOnPage, isOffRouteCablePost } from "./parser/cable-builder.js";

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

// Focus on page 3 posts
const page3Posts = sorted.filter((p) => p.pageNum === 3);
console.log("Page 3 posts:");
for (const p of page3Posts) {
  const isTap = isOffRouteCablePost(p, postByNum, cablesByPage);
  const hit = nearestCableHitOnPage(p.x, p.y, 3, cablesByPage);
  console.log(`  Post ${p.number}: x=${p.x.toFixed(1)} y=${p.y.toFixed(1)} isTap=${isTap} cable_d=${hit.d.toFixed(1)}`);
}

const paths = cablesByPage.get(3) ?? [];
console.log(`\nPage 3 cable paths: ${paths.length}`);
let totalMOps = 0;
for (let pi = 0; pi < paths.length; pi++) {
  let mOps = 0;
  for (const op of paths[pi]) if (op.type === 'M') mOps++;
  totalMOps += mOps;
  if (pi < 5) console.log(`  Path ${pi}: ${paths[pi].length} ops, ${mOps} M sub-paths`);
}
console.log(`  Total M sub-paths across all paths: ${totalMOps}`);

// Now manually compute what cable-arc-placer would see
const ROUTE_CABLE_NEAR_PT = 80;
function selectRouteCableOps(pageNum, refX, refY) {
  const paths = cablesByPage.get(pageNum) ?? [];
  let bestOps = null;
  let bestScore = -Infinity;
  for (const ops of paths) {
    const hit = nearestPointOnPathOps(refX, refY, ops);
    if (hit.d > ROUTE_CABLE_NEAR_PT) continue;
    const score = hit.t - hit.d * 2;
    if (score > bestScore) {
      bestScore = score;
      bestOps = ops;
    }
  }
  return bestOps;
}

const anchorPost = page3Posts.find((p) => p.number === 1);
console.log(`\nAnchor for page 3: post ${anchorPost?.number} at (${anchorPost?.x.toFixed(1)}, ${anchorPost?.y.toFixed(1)})`);
const anchorHit = nearestCableHitOnPage(anchorPost.x, anchorPost.y, 3, cablesByPage);
console.log(`  anchorHit.d=${anchorHit.d.toFixed(1)} (threshold ${ROUTE_CABLE_NEAR_PT})`);
console.log(`  anchorHit.pathIndex=${anchorHit.pathIndex}`);

// Check consistency
const scale = 1.266464; // From browser path log
console.log(`\nLabel-chord consistency on page 3 (scale=${scale}):`);
let consistent = 0, total = 0;
for (let i = 0; i < page3Posts.length - 1; i++) {
  const p1 = page3Posts[i];
  const p2 = page3Posts[i + 1];
  const m = distMap.get(`${p1.number}->${p2.number}`);
  if (m == null) continue;
  total++;
  const actual = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const expected = m / scale;
  const ratio = actual / expected;
  const inRange = ratio >= 0.88 && ratio <= 1.12;
  if (inRange) consistent++;
  console.log(`  ${p1.number}→${p2.number}: actual=${actual.toFixed(1)}pt expected=${expected.toFixed(1)}pt ratio=${ratio.toFixed(2)} ${inRange ? 'OK' : 'OFF'}`);
}
console.log(`  Consistency: ${consistent}/${total} (${(consistent/total*100).toFixed(0)}%) — N1_SKIP_CONSISTENCY_FRAC=0.85`);
