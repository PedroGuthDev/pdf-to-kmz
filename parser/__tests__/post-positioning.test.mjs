/**
 * post-positioning.js — anchor guards and route ordering
 * Run: node parser/__tests__/post-positioning.test.mjs
 */
import {
  attachMarkerAnchors,
  snapPostsToPosteLayerSymbols,
  assignPostPositionsFromPosteSymbols,
  assignPolesGloballyByLabels,
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

console.log('\n[post-positioning] off-route post placed between neighbors (spatial, not on cable)');
const routePosts = [
  { number: 3, x: 440, y: 470, pageNum: 3, anchorX: 440, anchorY: 470 },
  { number: 4, x: 480, y: 400, pageNum: 3, anchorX: 600, anchorY: 200 },
  { number: 5, x: 528, y: 322, pageNum: 3, anchorX: 528, anchorY: 322 },
];
const poleBetween = [
  { x: 440, y: 470, pageNum: 3 },
  { x: 505, y: 380, pageNum: 3 },
  { x: 528, y: 322, pageNum: 3 },
];
const cableLine = [{
  pageNum: 3,
  ops: [
    { type: 'M', x: 430, y: 480 },
    { type: 'L', x: 470, y: 490 },
    { type: 'L', x: 510, y: 310 },
  ],
}];
assignPostPositionsFromPosteSymbols(routePosts, poleBetween, cableLine, []);
const p4 = routePosts.find(p => p.number === 4);
const onPole = Math.hypot(p4.x - 505, p4.y - 380) < 3;
assert(onPole, 'post 4 moved to pole symbol between posts 3 and 5 along the street');

console.log('\n[post-positioning] keeps circle when raw pole already matches Numero_Poste ring');
const routeWithRaw = [
  { number: 3, x: 440, y: 470, pageNum: 3, anchorX: 437, anchorY: 397 },
  { number: 4, x: 500, y: 357, pageNum: 3, anchorX: 600, anchorY: 200 },
  { number: 5, x: 528, y: 322, pageNum: 3, anchorX: 509, anchorY: 302 },
];
const poleAtRing = [
  { x: 500, y: 357, pageNum: 3 },
  { x: 520, y: 340, pageNum: 3 },
];
assignPostPositionsFromPosteSymbols(routeWithRaw, poleAtRing, cableLine, []);
const kept = routeWithRaw.find(p => p.number === 4);
assert(Math.hypot(kept.x - 500, kept.y - 357) < 2, 'post 4 kept when raw symbol matches circle');

console.log('\n[post-positioning] N3 beam picks symbols matching distance labels');
const scale = 0.35;
const arcStep = 40 / scale;
const n3Cable = [{ pageNum: 3, ops: [{ type: 'M', x: 0, y: 0 }, { type: 'L', x: 2000, y: 0 }] }];
const n3Posts = [
  { number: 1, x: 0, y: 0, pageNum: 3, anchorX: 2, anchorY: 2 },
  { number: 2, x: arcStep, y: 0, pageNum: 3, anchorX: arcStep + 2, anchorY: 2 },
  { number: 3, x: arcStep * 2, y: 0, pageNum: 3, anchorX: arcStep * 2 + 2, anchorY: 2 },
];
const n3Poles = [
  { x: 0, y: 0, pageNum: 3 },
  { x: arcStep, y: 0, pageNum: 3 },
  { x: arcStep * 2, y: 0, pageNum: 3 },
];
const n3Dist = [
  { from: 1, to: 2, meters: 40 },
  { from: 2, to: 3, meters: 40 },
];
const n3Warn = [];
assignPolesGloballyByLabels(n3Posts, n3Poles, n3Cable, n3Dist, n3Warn, {
  perPageScale: () => scale,
  postByNum: new Map(n3Posts.map(p => [p.number, p])),
});
assert(Math.hypot(n3Posts[1].x - arcStep, n3Posts[1].y) < 2, 'N3 post 2 at labeled arc position');
assert(Math.hypot(n3Posts[2].x - arcStep * 2, n3Posts[2].y) < 2, 'N3 post 3 at labeled arc position');
assert(n3Warn.some(w => /N3 page 3/.test(w)), 'N3 summary warning emitted');

console.log('\n[post-positioning] N3 monotonic beam ignores decoy symbols between route poles');
const decoyScale = 0.35;
const decoyStep = 40 / decoyScale;
const decoyCable = [{ pageNum: 3, ops: [{ type: 'M', x: 0, y: 0 }, { type: 'L', x: 3000, y: 0 }] }];
const decoyPosts = [
  { number: 1, x: 0, y: 0, pageNum: 3, anchorX: 2, anchorY: 2 },
  { number: 2, x: decoyStep, y: 0, pageNum: 3, anchorX: decoyStep + 2, anchorY: 2 },
  { number: 3, x: decoyStep * 2, y: 0, pageNum: 3, anchorX: decoyStep * 2 + 2, anchorY: 2 },
];
const decoyPoles = [
  { x: 0, y: 0, pageNum: 3 },
  { x: decoyStep * 0.5, y: 0, pageNum: 3 },
  { x: decoyStep, y: 0, pageNum: 3 },
  { x: decoyStep * 1.5, y: 0, pageNum: 3 },
  { x: decoyStep * 2, y: 0, pageNum: 3 },
];
assignPolesGloballyByLabels(
  decoyPosts,
  decoyPoles,
  decoyCable,
  [
    { from: 1, to: 2, meters: 40 },
    { from: 2, to: 3, meters: 40 },
  ],
  [],
  { perPageScale: () => decoyScale, postByNum: new Map(decoyPosts.map(p => [p.number, p])) }
);
assert(Math.hypot(decoyPosts[1].x - decoyStep, decoyPosts[1].y) < 2, 'N3 skips mid-span decoy for post 2');
assert(Math.hypot(decoyPosts[2].x - decoyStep * 2, decoyPosts[2].y) < 2, 'N3 skips mid-span decoy for post 3');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
