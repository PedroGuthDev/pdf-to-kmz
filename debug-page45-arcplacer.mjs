// Why doesn't cable-arc-placer reposition page 4/5 on browser path?
import { readFileSync } from "fs";
import { parsePdf } from "./parser/pdf-parser.js";
import { buildCablesByPage, nearestCableHitOnPage, isOffRouteCablePost } from "./parser/cable-builder.js";
import { computeScaleFactor } from "./parser/geo/utm-calibrator.js";

const buf = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);
const sorted = [...parsed.posts].sort((a, b) => a.number - b.number);
const cablesByPage = buildCablesByPage(parsed.cableSegments);
const postByNum = new Map(sorted.map((p) => [p.number, p]));

const distMap = new Map();
for (const d of parsed.distances) {
  if (d.meters != null && d.meters > 0) {
    distMap.set(`${d.from}->${d.to}`, d.meters);
  }
}

function checkPage(pageNum) {
  const pagePosts = sorted.filter((p) => p.pageNum === pageNum);
  const nonTapPosts = pagePosts.filter((p) => !isOffRouteCablePost(p, postByNum, cablesByPage));
  const scale = computeScaleFactor(parsed.utmGridPathsPerPage?.get(pageNum) ?? [], []) ?? 0.354610;

  console.log(`\n=== Page ${pageNum} (scale=${scale.toFixed(6)}) ===`);
  console.log(`  posts: ${pagePosts.length}, nonTap: ${nonTapPosts.length}`);

  // Anchor check
  const routePost1 = sorted.find((p) => p.number === 1);
  const anchorPost = routePost1 && routePost1.pageNum === pageNum && !isOffRouteCablePost(routePost1, postByNum, cablesByPage)
    ? routePost1 : nonTapPosts[0];
  const anchorHit = nearestCableHitOnPage(anchorPost.x, anchorPost.y, pageNum, cablesByPage);
  console.log(`  anchor post: ${anchorPost.number} at (${anchorPost.x.toFixed(1)}, ${anchorPost.y.toFixed(1)})`);
  console.log(`  anchorHit.d=${anchorHit.d.toFixed(1)} (threshold 80)`);

  // Consistency
  let consistent = 0, total = 0;
  const ratios = [];
  for (let i = 0; i < pagePosts.length - 1; i++) {
    const p1 = pagePosts[i];
    const p2 = pagePosts[i + 1];
    if (isOffRouteCablePost(p1, postByNum, cablesByPage)) continue;
    if (isOffRouteCablePost(p2, postByNum, cablesByPage)) continue;
    const m = distMap.get(`${p1.number}->${p2.number}`);
    if (m == null) continue;
    total++;
    const actual = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const expected = m / scale;
    if (expected < 1e-6) continue;
    const ratio = actual / expected;
    ratios.push(ratio);
    if (ratio >= 0.88 && ratio <= 1.12) consistent++;
  }
  const frac = total > 0 ? consistent / total : 1;
  const sortedR = [...ratios].sort((a,b) => a-b);
  const median = sortedR.length > 0 ? sortedR[Math.floor(sortedR.length / 2)] : 1;
  const medianOk = median >= 0.88 && median <= 1.12;
  console.log(`  consistency: ${consistent}/${total} (${(frac*100).toFixed(0)}%)`);
  console.log(`  median ratio: ${median.toFixed(2)} (medianOk=${medianOk})`);
  console.log(`  GATE: totalLabeledPairs >= 2 && (frac >= 0.85 || (medianOk && frac >= 0.75)) → ` +
    `${total >= 2 && (frac >= 0.85 || (medianOk && frac >= 0.75))}`);
  console.log(`    → Would the gate SKIP page ${pageNum}? ${total >= 2 && (frac >= 0.85 || (medianOk && frac >= 0.75)) ? "YES" : "no"}`);

  // Per-post tap detection
  console.log(`  tap detection:`);
  for (const p of pagePosts) {
    const isTap = isOffRouteCablePost(p, postByNum, cablesByPage);
    if (isTap || pageNum === 4) {
      const hit = nearestCableHitOnPage(p.x, p.y, pageNum, cablesByPage);
      console.log(`    Post ${p.number}: isTap=${isTap} cable_d=${hit.d.toFixed(1)}`);
    }
  }
}

checkPage(3);
checkPage(4);
checkPage(5);
