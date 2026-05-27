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

const { posts, warnings } = assemblePostsFromOcr(ocrResults);
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
