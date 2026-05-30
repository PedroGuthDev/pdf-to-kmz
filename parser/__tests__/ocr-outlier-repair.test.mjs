/**
 * ocr-outlier-repair.test.mjs
 *
 * Purpose: Catch "in-range but obviously wrong" OCR reads by local sequence context,
 * so we don't silently lose posts after deduplication on big jobs like Siriu (85 posts).
 *
 * Run: node parser/__tests__/ocr-outlier-repair.test.mjs
 */
import { assemblePostsFromOcr } from "../post-assembler.js";

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

console.log(
  "\n[ocr-outlier-repair] repairs obvious misreads via sequence inference",
);

// Build a synthetic "sorted order" run of 85 circles on one page.
// Each circle i corresponds to true number (i+1), but we inject misreads that match the bug report:
// - 50 read as 30 (in-range)
// - 53 read as 93 (out of range -> already rejected)
// - 58 read as 8  (in-range)
// - 59 read as 99 (out of range -> already rejected)
// - 70 read as 40 (in-range)
const N = 85;
const ocrResults = Array.from({ length: N }, (_, idx) => ({
  circle: { x: idx * 10, y: 100, pageNum: 3 },
  number: idx + 1,
  ringCenter: null,
}));

ocrResults[49].number = 30; // true 50
ocrResults[52].number = 93; // true 53
ocrResults[57].number = 8; // true 58
ocrResults[58].number = 99; // true 59
ocrResults[69].number = 40; // true 70

const { posts, warnings, userWarnings } = assemblePostsFromOcr(ocrResults);
const nums = new Set(posts.map((p) => p.number));
const byX = new Map(posts.map((p) => [p.x, p.number]));

assert(posts.length === 85, "returns 85 posts (no silent drop)");
assert(nums.size === 85, "all post numbers are unique (no dedup required)");

// We must not assert that 8/30/40 disappear entirely (they are valid posts elsewhere).
// Instead, assert that the specific circles that were misread get corrected.
assert(byX.get(49 * 10) === 50, "circle for true 50 corrected (30→50)");
assert(byX.get(57 * 10) === 58, "circle for true 58 corrected (8→58)");
assert(byX.get(69 * 10) === 70, "circle for true 70 corrected (40→70)");

// The key requirement: the true missing numbers are present.
assert(nums.has(50), "post 50 recovered");
assert(nums.has(53), "post 53 recovered");
assert(nums.has(58), "post 58 recovered");
assert(nums.has(59), "post 59 recovered");
assert(nums.has(70), "post 70 recovered");

assert(
  warnings.some((w) => /rejected sandwich outlier/.test(w)),
  "emits sandwich-outlier warnings",
);
assert(
  userWarnings.some(
    (w) => /40/.test(w) && /70/.test(w) && /69/.test(w) && /71/.test(w),
  ),
  "user notice cites bracket 69 and 71 for 40→70",
);
assert(
  !userWarnings.some((w) => /40/.test(w) && /61/.test(w)),
  "user notice does not cite stray neighbor 61",
);
assert(
  !warnings.some((w) => /duplicate number .* renumbered/.test(w)),
  "does not run blind duplicate renumbering",
);

// 93 → 53 via n−40 (not midpoint 55 on long spans).
const page6 = Array.from({ length: 85 }, (_, idx) => ({
  circle: { x: idx * 10, y: 100, pageNum: 6 },
  number: null,
  ringCenter: null,
}));
for (let i = 0; i < 50; i++) page6[i].number = i + 1;
page6[50].number = 51;
page6[52].number = 93;
page6[68].number = 69;
for (let i = 69; i < 85; i++) page6[i].number = i + 1;
const p6 = assemblePostsFromOcr(page6);
const at93 = p6.posts.find((p) => p.x === 520);
assert(at93?.number === 53, "93 infers 53 via n−40 repair");

console.log(
  "\n[ocr-outlier-repair] sheet-edge bracket (57 page 6 → 58 page 7)",
);

const edge = [];
for (let i = 0; i < 57; i++) {
  edge.push({
    circle: { x: i * 10, y: 100, pageNum: 6 },
    number: i + 1,
    ringCenter: null,
  });
}
edge.push({
  circle: { x: 600, y: 200, pageNum: 7 },
  number: 8,
  ringCenter: null,
});
edge.push({
  circle: { x: 610, y: 200, pageNum: 7 },
  number: 99,
  ringCenter: null,
});
edge.push({
  circle: { x: 620, y: 200, pageNum: 7 },
  number: 60,
  ringCenter: null,
});
for (let i = 60; i < 85; i++) {
  edge.push({
    circle: { x: (i - 57) * 10 + 700, y: 300, pageNum: 7 },
    number: i + 1,
    ringCenter: null,
  });
}
const edgeOut = assemblePostsFromOcr(edge);
const p58edge = edgeOut.posts.find((p) => p.pageNum === 7 && p.x === 600);
const p59edge = edgeOut.posts.find((p) => p.pageNum === 7 && p.x === 610);
assert(p58edge?.number === 58, "8 on page 7 with 57 on prev sheet → 58");
assert(p59edge?.number === 59, "99 on page 7 → 59");

console.log(
  "\n[ocr-outlier-repair] bracket sandwich with other posts between anchors",
);

// Siriu-like: 69, 50, 40, 71 in route order — immediate neighbors are 50/71, not 69/71.
const bracketed = Array.from({ length: 85 }, (_, idx) => ({
  circle: { x: idx * 10, y: 100, pageNum: 6 },
  number: idx + 1,
  ringCenter: null,
}));
bracketed[68].number = 69;
bracketed[69].number = 50;
bracketed[70].number = 40;
bracketed[71].number = 71;
bracketed[56].number = 57;
bracketed[57].number = 20;
bracketed[58].number = 8;
bracketed[59].number = 59;
const br = assemblePostsFromOcr(bracketed);
const byX6 = new Map(br.posts.map((p) => [p.x, p.number]));
assert(byX6.get(700) === 70, "40 between 69 and 71 (with 50 between) → 70");
assert(byX6.get(580) === 58, "8 between 57 and 59 (with gap) → 58");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
