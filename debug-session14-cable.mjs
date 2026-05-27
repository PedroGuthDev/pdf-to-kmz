// Check which posts on page 3 are near the cable
import { readFileSync } from "fs";
import { parsePdf } from "./parser/pdf-parser.js";
import { nearestCableHitOnPage, buildCablesByPage, isOffRouteCablePost } from "./parser/cable-builder.js";

const buf = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);

const cablesByPage = buildCablesByPage(parsed.cableSegments);
const postMap = new Map(parsed.posts.map(p => [p.number, p]));

console.log("\n=== Posts 1-14 cable proximity (page 3) ===");
for (const p of parsed.posts.filter(x => x.number >= 1 && x.number <= 14).sort((a,b)=>a.number-b.number)) {
  const hit = nearestCableHitOnPage(p.x, p.y, p.pageNum, cablesByPage);
  const isOff = isOffRouteCablePost(p, postMap, cablesByPage);
  console.log(`  Post ${p.number.toString().padStart(2)}: PDF (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) cable d=${hit?.d?.toFixed(2)}pt  isOff=${isOff}  pathIndex=${hit?.pathIndex}`);
}

// Page 3 cable info
console.log("\n=== Page 3 cables ===");
const page3Cables = cablesByPage.get(3) ?? [];
console.log(`  ${page3Cables.length} paths`);
for (let i = 0; i < page3Cables.length; i++) {
  const ops = page3Cables[i];
  let mCount = 0;
  for (const op of ops) if (op.type === 'M') mCount++;
  console.log(`    path ${i}: ${ops.length} ops, ${mCount} M sub-paths`);
}

// Simulate the placer's bearing on page 3
const page3Posts = parsed.posts.filter(p => p.pageNum === 3).sort((a,b)=>a.number-b.number);
const xs = page3Posts.map(p => p.x);
const ys = page3Posts.map(p => p.y);
const n = page3Posts.length;
const idxArr = page3Posts.map((_, i) => i);
const iMean = idxArr.reduce((s, v) => s + v, 0) / n;
const xMean = xs.reduce((s, v) => s + v, 0) / n;
const yMean = ys.reduce((s, v) => s + v, 0) / n;
let sxn = 0, syn = 0, snn = 0;
for (let i = 0; i < n; i++) {
  const di = idxArr[i] - iMean;
  sxn += di * (xs[i] - xMean);
  syn += di * (ys[i] - yMean);
  snn += di * di;
}
const dx = sxn / snn;
const dy = syn / snn;
const postsRegressionBearing = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
console.log(`\n  Page 3 posts regression bearing: ${postsRegressionBearing.toFixed(2)}° (dx=${dx.toFixed(2)}, dy=${dy.toFixed(2)})`);

// Manual simulation: if cable-arc-placer were to walk page 3 from post 1, what positions would it give?
const scale = 0.354610;
const distMap = new Map();
for (const d of parsed.distances) {
  distMap.set(`${d.from}->${d.to}`, d.meters);
}

const brg = postsRegressionBearing * Math.PI / 180;
console.log("\n=== Simulated walk from post 1 (forward) on page 3 ===");
const anchorPost = page3Posts[0]; // post 1
console.log(`  Anchor: Post 1 (${anchorPost.x.toFixed(2)}, ${anchorPost.y.toFixed(2)})`);
let cumDist = 0;
let prevNum = 1;
let curAnchor = anchorPost;
for (let i = 1; i < page3Posts.length; i++) {
  const curr = page3Posts[i];
  const labelM = distMap.get(`${prevNum}->${curr.number}`);
  if (!labelM) { prevNum = curr.number; continue; }
  cumDist += labelM / scale;
  prevNum = curr.number;
  const hit = nearestCableHitOnPage(curr.x, curr.y, 3, cablesByPage);
  const reAnchor = hit && hit.d <= 45;
  const proj_x = curAnchor.x + cumDist * Math.sin(brg);
  const proj_y = curAnchor.y - cumDist * Math.cos(brg);
  const drift = Math.hypot(proj_x - curr.x, proj_y - curr.y);
  console.log(`  Post ${curr.number.toString().padStart(2)}: existing (${curr.x.toFixed(2)}, ${curr.y.toFixed(2)})  cable_d=${hit?.d?.toFixed(2)}pt  ${reAnchor ? 'RE-ANCHOR' : `WALK→(${proj_x.toFixed(2)},${proj_y.toFixed(2)}) drift=${drift.toFixed(2)}pt = ${(drift*scale).toFixed(2)}m`}`);
  if (reAnchor) {
    curAnchor = curr;
    cumDist = 0;
  }
}
