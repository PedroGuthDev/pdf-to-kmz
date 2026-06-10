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
  restoreSharedSymbolCollapsedPosts,
  VITERBI_SIGMA_PT,
  VITERBI_BETA_M,
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

assert(VITERBI_SIGMA_PT === 20 && VITERBI_BETA_M === 3, 'Viterbi tuning constants exported (D-V-03)');

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
// Post 4's anchor IS its Numero_Poste ring, sitting beside the raw symbol it matches
// (anchor = ring in the data model; a ring 186 pt from its own post with no nearby
// Poste was an unrealistic pre-realign fixture — see cdabaae post-8 rule).
const routeWithRaw = [
  { number: 3, x: 440, y: 470, pageNum: 3, anchorX: 437, anchorY: 397 },
  { number: 4, x: 500, y: 357, pageNum: 3, anchorX: 505, anchorY: 350 },
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

console.log('\n[post-positioning] Valmor page 4 assignment fixture (D-N2-01)');

/** Valmor page 4 scale (m/pt) from UTM grid on page 4 — parser dump 2026-05-19. */
const VALMOR_P4_SCALE = 0.3546099290780142;

/** Poste-layer centroids on Valmor page 4 (deduped 1 pt; from parsePdf / debug_results). */
const valmorPage4PosteRaw = [
  { x: 1154.9, y: 302.52, pageNum: 4 },
  { x: 1155.68, y: 300.96, pageNum: 4 },
  { x: 1013.24, y: 565.32, pageNum: 4 },
  { x: 1029.86, y: 425.28, pageNum: 4 },
  { x: 1122.86, y: 580.08, pageNum: 4 },
  { x: 1138.16, y: 440.88, pageNum: 4 },
  { x: 770.6, y: 359.16, pageNum: 4 },
  { x: 780.98, y: 287.34, pageNum: 4 },
  { x: 1051.1, y: 286.98, pageNum: 4 },
  { x: 934.76, y: 272.52, pageNum: 4 },
  { x: 830.18, y: 257.34, pageNum: 4 },
  { x: 736.28, y: 244.74, pageNum: 4 },
  { x: 794.6, y: 189.18, pageNum: 4 },
  { x: 1068.62, y: 146.58, pageNum: 4 },
  { x: 951.44, y: 130.32, pageNum: 4 },
  { x: 848.54, y: 116.64, pageNum: 4 },
  { x: 756.02, y: 104.52, pageNum: 4 },
  { x: 626.66, y: 86.22, pageNum: 4 },
  { x: 809.66, y: 83.52, pageNum: 4 },
  { x: 154.94, y: 221.28, pageNum: 4 },
  { x: 171.74, y: 99.18, pageNum: 4 },
  { x: 266.42, y: 234.6, pageNum: 4 },
  { x: 282.62, y: 115.98, pageNum: 4 },
  { x: 321.5, y: 242.82, pageNum: 4 },
  { x: 338.9, y: 123.06, pageNum: 4 },
  { x: 385.46, y: 304.26, pageNum: 4 },
  { x: 401.24, y: 193.08, pageNum: 4 },
  { x: 414.86, y: 253.14, pageNum: 4 },
  { x: 417.08, y: 81.18, pageNum: 4 },
  { x: 433.7, y: 138.9, pageNum: 4 },
  { x: 445.58, y: 112.74, pageNum: 4 },
  { x: 463.94, y: 355.98, pageNum: 4 },
  { x: 481.58, y: 219.06, pageNum: 4 },
  { x: 505.82, y: 69.66, pageNum: 4 },
  { x: 596.66, y: 367.02, pageNum: 4 },
  { x: 613.76, y: 227.94, pageNum: 4 },
  { x: 897.2, y: 549.42, pageNum: 4 },
  { x: 914.6, y: 409.92, pageNum: 4 },
  { x: 741.32, y: 583.92, pageNum: 4 },
  { x: 792.02, y: 534.96, pageNum: 4 },
  { x: 694.7, y: 521.4, pageNum: 4 },
  { x: 583.76, y: 505.98, pageNum: 4 },
  { x: 444.98, y: 496.38, pageNum: 4 },
  { x: 757.94, y: 465.78, pageNum: 4 },
  { x: 808.88, y: 396.18, pageNum: 4 },
  { x: 713, y: 382.56, pageNum: 4 },
];

/** Pre-positioning posts 7–11: OCR label centroids as x/y and anchor (Numero_Poste). */
const valmorPage4Posts = [
  { number: 7, x: 1139.3, y: 414.06, pageNum: 4, anchorX: 1139.3, anchorY: 414.06 },
  { number: 8, x: 1036.7, y: 397.02, pageNum: 4, anchorX: 1036.7, anchorY: 397.02 },
  { number: 9, x: 944.54, y: 383.22, pageNum: 4, anchorX: 944.54, anchorY: 383.22 },
  { number: 10, x: 811.58, y: 368.58, pageNum: 4, anchorX: 811.58, anchorY: 368.58 },
  { number: 11, x: 720.74, y: 356.94, pageNum: 4, anchorX: 720.74, anchorY: 356.94 },
];

/** Cabo Projetado route on page 4 (simplified polyline along posts 11→7). */
const valmorPage4Cable = {
  pageNum: 4,
  ops: [
    { type: 'M', x: 711.8, y: 390.84 },
    { type: 'L', x: 807.68, y: 404.52 },
    { type: 'L', x: 916.04, y: 401.04 },
    { type: 'L', x: 1028.84, y: 433.56 },
    { type: 'L', x: 1136.96, y: 449.16 },
  ],
};

/**
 * Short cable fragments running near the Numero_Poste anchor row. The real page 4
 * cable layer is fragmented (12 sub-paths) and anchors sit near other fragments, so
 * `realignPostsToMarkerAnchorWhenCablePulled` sees `pulledOntoCable=false` and keeps
 * the symbol assignment. Without these, the sparse single-cable fixture makes every
 * anchor look off-cable and the realign pass (cdabaae) resets correct symbol picks
 * to bare anchors — a fixture artifact the live route never exhibits (the Valmor
 * txt-accuracy gate locks the real behavior at ≤4.4 m).
 */
const valmorPage4CableFragments = [
  { pageNum: 4, ops: [{ type: 'M', x: 1100, y: 405 }, { type: 'L', x: 1150, y: 418 }] },
  { pageNum: 4, ops: [{ type: 'M', x: 1010, y: 392 }, { type: 'L', x: 1060, y: 400 }] },
  { pageNum: 4, ops: [{ type: 'M', x: 920, y: 378 }, { type: 'L', x: 970, y: 388 }] },
  { pageNum: 4, ops: [{ type: 'M', x: 700, y: 352 }, { type: 'L', x: 820, y: 370 }] },
];
const valmorPage4Cables = [valmorPage4Cable, ...valmorPage4CableFragments];

const valmorPage4Dist = [
  { from: 7, to: 8, meters: 38.8 },
  { from: 8, to: 9, meters: 41.2 },
  { from: 9, to: 10, meters: 37.8 },
  { from: 10, to: 11, meters: 34.3 },
];

/** Nearest Poste symbol to each post label anchor (human ground truth). */
const valmorPage4Expected = {
  7: { x: 1138.16, y: 440.88 },
  8: { x: 1029.86, y: 425.28 },
  9: { x: 914.6, y: 409.92 },
  10: { x: 808.88, y: 396.18 },
  11: { x: 713, y: 382.56 },
};

function maxValmorP4SymbolDistance(postsArr) {
  let maxD = 0;
  for (const p of postsArr) {
    const e = valmorPage4Expected[p.number];
    if (!e) continue;
    maxD = Math.max(maxD, Math.hypot(p.x - e.x, p.y - e.y));
  }
  return maxD;
}

const greedyValmorP4 = structuredClone(valmorPage4Posts);
assignPostPositionsFromPosteSymbols(greedyValmorP4, valmorPage4PosteRaw, valmorPage4Cables, []);
const maxGreedyError = maxValmorP4SymbolDistance(greedyValmorP4);
assert(
  maxGreedyError < 30,
  '[D-N2-01 baseline] greedy assignment Valmor p4 max symbol-distance < 30 pt'
);

const viterbiValmorP4 = structuredClone(valmorPage4Posts);
assignPolesGloballyByLabels(
  viterbiValmorP4,
  valmorPage4PosteRaw,
  valmorPage4Cables,
  valmorPage4Dist,
  [],
  {
    perPageScale: () => VALMOR_P4_SCALE,
    postByNum: new Map(viterbiValmorP4.map(p => [p.number, p])),
  }
);
const maxViterbiError = maxValmorP4SymbolDistance(viterbiValmorP4);
assert(
  maxViterbiError < 5,
  '[D-N2-01 fix] Viterbi assignment Valmor p4 max symbol-distance < 5 pt'
);

let valmorP4OneToOne = true;
for (let i = 0; i < viterbiValmorP4.length; i++) {
  for (let j = i + 1; j < viterbiValmorP4.length; j++) {
    const d = Math.hypot(
      viterbiValmorP4[i].x - viterbiValmorP4[j].x,
      viterbiValmorP4[i].y - viterbiValmorP4[j].y
    );
    if (d < 2) valmorP4OneToOne = false;
  }
}
assert(valmorP4OneToOne, '[D-N2-01] Viterbi Valmor p4 one-to-one symbol assignment');

// ---------------------------------------------------------------------------
// 07-06 — shared-symbol collapse restore (LC layer-B fix, D-09/D-10).
// Additive predicate: a post whose final (x,y) diverges far from its OWN free
// label anchor AND clusters with another such post is a shared-symbol collapse;
// restore it to its label anchor. Generic geometry — no literal post-number guard.
// ---------------------------------------------------------------------------
console.log('\n[post-positioning] shared-symbol collapse restore');

// LC-shaped collapse: posts 9/10/11 collapsed near (305,302)/(338,343) while their
// own free label anchors sit far away (~y 509-562). They cluster together → restore.
const lcCollapse = [
  { number: 7, pageNum: 4, x: 315, y: 338, anchorX: 315, anchorY: 338 },  // correct
  { number: 8, pageNum: 4, x: 298, y: 419, anchorX: 298, anchorY: 419 },  // correct
  { number: 9, pageNum: 4, x: 338, y: 343, anchorX: 295, anchorY: 509 },  // collapsed
  { number: 10, pageNum: 4, x: 305, y: 302, anchorX: 283, anchorY: 562 }, // collapsed (shared)
  { number: 11, pageNum: 4, x: 305, y: 302, anchorX: 319, anchorY: 518 }, // collapsed (shared)
  { number: 12, pageNum: 5, x: 262, y: 63, anchorX: 262, anchorY: 63 },   // correct, other page
];
const lcRestored = restoreSharedSymbolCollapsedPosts(lcCollapse, []);
const lc9 = lcCollapse.find(p => p.number === 9);
const lc10 = lcCollapse.find(p => p.number === 10);
const lc11 = lcCollapse.find(p => p.number === 11);
assert(Math.hypot(lc9.x - 295, lc9.y - 509) < 2, 'collapse: post 9 restored to its label anchor');
assert(Math.hypot(lc10.x - 283, lc10.y - 562) < 2, 'collapse: post 10 restored to its label anchor');
assert(Math.hypot(lc11.x - 319, lc11.y - 518) < 2, 'collapse: post 11 restored to its label anchor');
assert(lcRestored instanceof Set && lcRestored.size === 3, 'collapse: returns the 3 restored post indices');

// Correctly-placed posts are left untouched.
const lc7 = lcCollapse.find(p => p.number === 7);
assert(Math.hypot(lc7.x - 315, lc7.y - 338) < 2, 'collapse: correctly-placed post 7 untouched');

// Siriu-shaped legitimate off-anchor (single post, NOT clustered with another collapsed
// post, OR anchor occupied) must NOT be moved — guards against Pitfall-2 regression.
const siriuLegit = [
  { number: 49, pageNum: 2, x: 400, y: 400, anchorX: 400, anchorY: 400 }, // occupies post 50's anchor
  { number: 50, pageNum: 2, x: 900, y: 900, anchorX: 405, anchorY: 402 }, // far off-anchor but anchor OCCUPIED by 49
  { number: 51, pageNum: 2, x: 600, y: 600, anchorX: 600, anchorY: 600 }, // correct
];
restoreSharedSymbolCollapsedPosts(siriuLegit, []);
const s50 = siriuLegit.find(p => p.number === 50);
assert(Math.hypot(s50.x - 900, s50.y - 900) < 2, 'collapse: off-anchor post with OCCUPIED anchor untouched (Siriu-safe)');

// Lone off-anchor post with a FREE anchor but NO clustered partner must also be left alone.
const loneOffAnchor = [
  { number: 70, pageNum: 2, x: 800, y: 800, anchorX: 300, anchorY: 300 }, // far + free anchor, but lone
  { number: 71, pageNum: 2, x: 500, y: 500, anchorX: 500, anchorY: 500 }, // correct, not clustered
];
restoreSharedSymbolCollapsedPosts(loneOffAnchor, []);
const s70 = loneOffAnchor.find(p => p.number === 70);
assert(Math.hypot(s70.x - 800, s70.y - 800) < 2, 'collapse: lone off-anchor (no clustered partner) untouched');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
