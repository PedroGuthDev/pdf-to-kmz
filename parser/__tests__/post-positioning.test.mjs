/**
 * post-positioning.js — anchor guards and route ordering
 * Run: node parser/__tests__/post-positioning.test.mjs
 */
import {
  attachMarkerAnchors,
  snapPostsToPosteLayerSymbols,
  assignPostPositionsFromPosteSymbols,
  assignPostsByRouteOrder,
  alignPostPositionsToRouteMarkers,
  routeSortKeyForPage,
} from '../post-positioning.js';

let pass = 0;
let fail = 0;
function assert(cond, name) {
  if (cond) {
    console.log(`  PASS: ${name}`);
    pass++;
  } else {
    console.error(`  FAIL: ${name}`);
    fail++;
  }
}

console.log('\n[post-positioning] refine mode caps move from label anchor');
const posts = [
  { number: 1, x: 668, y: 499, pageNum: 3, anchorX: 668, anchorY: 499 },
  { number: 4, x: 376, y: 459, pageNum: 3, anchorX: 376, anchorY: 459 },
  { number: 5, x: 246, y: 442, pageNum: 3, anchorX: 246, anchorY: 442 },
  { number: 6, x: 169, y: 429, pageNum: 3, anchorX: 169, anchorY: 429 },
];
const postByNum = new Map(posts.map(p => [p.number, p]));
const badHint = [{ x: 311, y: 408, pageNum: 3 }];
snapPostsToPosteLayerSymbols(posts, badHint, 200, { postByNum, primary: false });
const p5 = posts.find(p => p.number === 5);
assert(Math.hypot(p5.x - 246, p5.y - 442) < 2, 'refine mode rejects Poste snap >50pt from label anchor');

console.log('\n[post-positioning] cable-aware match places post at pole symbol');
const postsPrimary = [
  { number: 5, x: 246, y: 442, pageNum: 3, anchorX: 246, anchorY: 442 },
];
const poleRaw = [{ x: 247.6, y: 467.8, pageNum: 3 }];
const cablePaths = [{
  pageNum: 3,
  ops: [
    { type: 'M', x: 160, y: 400 },
    { type: 'L', x: 700, y: 520 },
  ],
}];
assignPostPositionsFromPosteSymbols(postsPrimary, poleRaw, cablePaths, []);
assert(
  Math.hypot(postsPrimary[0].x - 247.6, postsPrimary[0].y - 467.8) < 2,
  'label + cable match places post at Poste symbol center'
);

console.log('\n[post-positioning] route order high-X feeder');
const markers = [
  { x: 668, y: 499, pageNum: 3 },
  { x: 566, y: 486, pageNum: 3 },
  { x: 477, y: 471, pageNum: 3 },
  { x: 376, y: 459, pageNum: 3 },
  { x: 246, y: 442, pageNum: 3 },
  { x: 169, y: 429, pageNum: 3 },
];
const numbered = assignPostsByRouteOrder(markers);
assert(numbered[0].number === 1 && numbered[0].x > 600, 'post 1 at high-X end');
assert(numbered[5].number === 6 && numbered[5].x < 200, 'post 6 at low-X end');

console.log('\n[post-positioning] align OCR numbers to circle anchors');
const ocrPosts = [{ number: 5, x: 311, y: 408, pageNum: 3 }];
const ocrResults = [{ circle: { x: 246, y: 442, pageNum: 3 }, number: 5 }];
const allMarkers = [
  { x: 668, y: 499, pageNum: 3 },
  { x: 566, y: 486, pageNum: 3 },
  { x: 477, y: 471, pageNum: 3 },
  { x: 376, y: 459, pageNum: 3 },
  { x: 246, y: 442, pageNum: 3 },
  { x: 169, y: 429, pageNum: 3 },
];
alignPostPositionsToRouteMarkers(
  ocrPosts,
  allMarkers.map(c => ({ circle: c, number: null }))
);
// post 5 should move to 3rd-from-left on page 3 in full set - simplified: single marker list
const ocrPosts2 = [{ number: 5, x: 311, y: 408, pageNum: 3 }];
alignPostPositionsToRouteMarkers(
  ocrPosts2,
  allMarkers.map(c => ({ circle: c }))
);
assert(Math.hypot(ocrPosts2[0].x - 246, ocrPosts2[0].y - 442) < 2, 'OCR post 5 aligned to route marker centroid');

console.log('\n[post-positioning] route sort key defined');
const key = routeSortKeyForPage(posts);
assert(typeof key(posts[0]) === 'number', 'route sort key returns number');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
