---
phase: 01-pdf-parser-engine
reviewed: 2026-05-15T00:00:00Z
depth: deep
files_reviewed: 3
files_reviewed_list:
  - parser/ocr-extractor.js
  - parser/pdf-parser.js
  - parser/post-assembler.js
findings:
  critical: 4
  warning: 5
  info: 2
  total: 11
status: fixed
fixed_at: 2026-05-15T00:00:00Z
fixes_applied:
  - CR-01
  - CR-02
  - CR-03
  - CR-04
  - WR-01
  - WR-02
  - WR-03
  - WR-04
  - WR-05
---

# Phase 01: Code Review Report (Deep — OCR Pipeline Bug)

**Reviewed:** 2026-05-15T00:00:00Z
**Depth:** deep
**Files Reviewed:** 3 + 5 cross-reference files (graphics-extractor.js, construct-path-parser.js, layer-sources.js, ocg-map.js, text-extractor.js)
**Status:** issues_found

## Summary

This review was triggered by a confirmed bug: an 11-circle PDF produces 22 OCR results, 15 final posts, and returns impossible post numbers (0, 19, 28, 29, 167, 333, 500) while missing real posts 1, 10, and 11.

All three reviewed files and five cross-referenced files were read and traced. The confirmed bug has four distinct critical causes that compound each other:

**Root-cause chain (confirmed by log evidence):**

1. `graphics-extractor.js` feeds layer `'0'` paths through `circleCentroidsFromSubpaths` with a span filter of 16–360 pt. This range is far too permissive — cable segments, dimension lines, and pole-symbol rectangles all produce subpath bounding boxes within 16–360 pt. These non-circle paths emit spurious centroids that join the `circles[]` array alongside the 11 real post circles. This is the primary cause of 22 OCR inputs for 11 real circles.

2. `ocr-extractor.js` crops a 60pt-radius window around every centroid in `circles[]`. For spurious centroids that land on cable-route regions, the crop captures nearby annotation text (distance labels, coordinate values, pole-type specs). Tesseract reads those and returns values like 19, 28, 167, 333, 500.

3. `assemblePostsFromOcr` in `post-assembler.js` has no plausibility gate: every non-null OCR result, including 0 and 3-digit numbers far beyond the expected sequence, is accepted as a valid post without any range check.

4. `assemblePostsFromOcr` sorts circles by `pageNum then x` only. Circles at similar x positions stacked vertically are sorted in undefined order, breaking sequence inference for OCR-failed circles (real posts 1, 10, 11).

---

## Critical Issues

### CR-01: Layer `'0'` span filter (16–360 pt) is too wide — non-circle paths produce spurious circle centroids, explaining 22 results for 11 circles

**File:** `parser/graphics-extractor.js:146` (cross-ref: `parser/layer-sources.js:72`, `parser/construct-path-parser.js:156`)

The AutoCAD default layer `'0'` is accepted as a circle source by `isCircleCentroidLayerName` because some exports place post circles on it. To filter out non-circle linework, a span filter `{ min: 16, max: 360 }` is passed to `circleCentroidsFromSubpaths`. 360 pt is approximately 127 mm, which is wide enough to include cable-route line segments, dimension arcs, pole-symbol rectangles, and leader lines. Post marker circles have an established diameter of approximately 70 pt (radius ~35 pt from SKELETON.md). A span filter of 360 pt thus accepts subpaths up to 5x the expected size.

The construct-path parser splits each `constructPath` operator (fn=91) into subpaths (M…Z chunks), computes the bounding-box centroid per subpath, and applies the page-space span check. Any linear subpath (a cable segment) that happens to measure between 16 and 360 pt in its longest axis will pass and emit a centroid at the middle of that line. These centroids are inserted into the same `circles[]` array passed to OCR.

This explains how 11 real circles become 22 OCR inputs.

**Fix:**
```javascript
// parser/graphics-extractor.js, line 146
// Post circles are ~35 pt radius (~70 pt diameter). Tighten the span
// filter to [50, 120] pt to exclude cable segments and dimension geometry
// while absorbing rendering variation in the circle size.
const layer0Span =
  activeLayer === '0' ? { min: 50, max: 120 } : null;
```

If the real circle diameter is uncertain, add a diagnostic log before this line to record the span of every layer-`'0'` subpath centroid emitted, then calibrate the range from observed data on a good PDF.

---

### CR-02: `assemblePostsFromOcr` accepts OCR number `0` and any 3-digit value with no sequence-range validation

**File:** `parser/post-assembler.js:193-200`

The pass-through for non-null OCR results:

```javascript
if (number !== null) {
  posts.push({
    number,
    x: circle.x,
    y: circle.y,
    ...(circle.pageNum !== undefined ? { pageNum: circle.pageNum } : {}),
  });
  continue;
}
```

The regex in `ocr-extractor.js` line 74 is `/^\d{1,3}$/`, which matches 0 through 999. The number 0 is not a valid post number. Numbers like 167, 333, and 500 are impossible in an 11-post PDF. There is no minimum value of 1, no maximum based on the known circle count, and no check that the number is even plausibly within the expected sequence. Every non-null OCR hit propagates directly to the final output.

Because `deduplicatePostsPreferLowerPage` deduplicates by exact number, junk numbers that are each unique (0, 19, 28, 29, 167, 333, 500) all survive dedup. This explains why 22 raw posts reduce to only 15 final posts — some real duplicates are removed but all the junk unique numbers survive.

**Fix:**
```javascript
// parser/post-assembler.js — assemblePostsFromOcr
// Compute a generous upper bound from total circle count.
// Any OCR number above this is certainly a coordinate/label value, not a post number.
const MAX_PLAUSIBLE_POST = Math.max(ocrResults.length * 2, 50);

for (let i = 0; i < sorted.length; i++) {
  const { circle, number } = sorted[i];

  if (number !== null) {
    if (number < 1 || number > MAX_PLAUSIBLE_POST) {
      // Treat implausible OCR read as a failure; fall through to sequence inference.
      warnings.push(
        `OCR at (${circle.x.toFixed(1)}, ${circle.y.toFixed(1)}) ` +
        `page ${circle.pageNum ?? '?'}: rejected implausible number ${number} ` +
        `(valid range 1–${MAX_PLAUSIBLE_POST})`
      );
      // Do NOT continue — let execution fall through to the sequence-inference block.
    } else {
      posts.push({
        number,
        x: circle.x,
        y: circle.y,
        ...(circle.pageNum !== undefined ? { pageNum: circle.pageNum } : {}),
      });
      continue;
    }
  }
  // ... sequence-inference block unchanged ...
}
```

---

### CR-03: `assemblePostsFromOcr` sort ignores Y — vertically-stacked circles at similar X are misordered, breaking sequence inference for missed circles

**File:** `parser/post-assembler.js:183-186`

```javascript
const sorted = [...ocrResults].sort((a, b) => {
  const pd = (a.circle.pageNum ?? 1) - (b.circle.pageNum ?? 1);
  return pd !== 0 ? pd : a.circle.x - b.circle.x;
});
```

The comparator is `pageNum then x` with no Y tiebreaker. When two circles share the same page and have close or identical X coordinates (common in vertically arranged route sheets), the comparator returns near-zero and sort order is undefined (stable sort is not guaranteed in all JS engines, and even stable sort here gives bottom-before-top or top-before-bottom depending on original array order).

Sequence inference in the null-number block relies on `sorted.slice(0, i)` and `sorted.slice(i + 1)` to find the nearest known neighbours before and after the failed circle in sorted order. If a circle that should be "between" post 5 and post 7 in route order is instead sorted before post 2 due to X-tie instability, the interpolation uses the wrong lower/upper bounds and produces an incorrect inferred number. The inferred number can then collide with a real post or be out of range.

Additionally, spurious centroids from CR-01 are interleaved in this same sorted array, displacing real circles and compressing/expanding the index span used in interpolation.

**Fix:**
```javascript
// Sort by pageNum → x → y so that vertically-stacked circles (same X, different Y)
// are ordered consistently top-to-bottom within each column.
const sorted = [...ocrResults].sort((a, b) => {
  const pd = (a.circle.pageNum ?? 1) - (b.circle.pageNum ?? 1);
  if (pd !== 0) return pd;
  const dx = a.circle.x - b.circle.x;
  if (Math.abs(dx) > 10) return dx;       // clearly distinct columns
  return a.circle.y - b.circle.y;         // same column — top-to-bottom
});
```

---

### CR-04: OCR crop window (60pt radius) extends beyond the circle boundary and captures adjacent text labels

**File:** `parser/ocr-extractor.js:49,53-58`

```javascript
const CROP_RADIUS_PX = 60; // 60pt at 2× = 120px total crop window
// ...
const cropX = Math.max(0, canvasCx - CROP_RADIUS_PX);
const cropY = Math.max(0, canvasCy - CROP_RADIUS_PX);
const cropW = Math.min(CROP_RADIUS_PX * 2, canvasW - cropX);
const cropH = Math.min(CROP_RADIUS_PX * 2, canvasH - cropY);
```

At SCALE=2, `CROP_RADIUS_PX = 60` means the crop radius in PDF point space is 30pt, making the crop window a 60×60pt square in PDF space. Wait — the comment says "60pt at 2×" but the constant is 60 canvas pixels, which at scale 2 is 30pt. So the crop is a 30pt radius = 60pt square in PDF space. Post circles have radius ~35pt per SKELETON.md, meaning the crop window is actually **smaller than the circle** itself in PDF space.

However, the comment "60pt at 2× = 120px total crop window" contradicts the arithmetic: `CROP_RADIUS_PX=60` at scale 2 gives a crop of 60pt radius = 120pt total. Either the comment is right (crop is 120pt wide = 60pt radius in PDF space) and the crop exceeds the ~35pt circle radius by 25pt in all directions, or there is a unit confusion in the constant.

Reading the code precisely: `canvasCx = circle.x * SCALE` where `circle.x` is in PDF points. `cropX = canvasCx - 60` in canvas pixels. Canvas pixel / SCALE = PDF point, so `60 / 2 = 30pt` radius in PDF space. The crop is actually 30pt radius (60pt total) in PDF space.

Regardless, the observed impossible OCR numbers (numbers from distance labels, cable annotations, pole-type specs) confirm that the crop window captures text outside the circle boundary. This is consistent with: (a) spurious centroids from CR-01 being placed at non-circle positions where adjacent annotation text IS the dominant nearby content, or (b) the 30pt radius being insufficient to center on the circle number but large enough to catch nearby labels.

The larger architectural issue: Tesseract with `tessedit_char_whitelist: '0123456789'` will extract the first plausible digit sequence from ANY image content. On a cropped region that contains a distance label ("28.3"), Tesseract returns "283" or "28". On a region containing "10-300 (U)", it returns "10300" or "300" or "10" — any of which passes `/^\d{1,3}$/` depending on what Tesseract segments.

**Fix (immediate):** Reduce the crop to a tighter window centered on the circle. The post number is printed inside the circle (~35pt radius). A crop of 35pt radius in PDF space (70px at scale=2) tightly wraps the circle and minimises capture of adjacent labels:

```javascript
// Crop tightly around the circle. Post circles are ~35pt radius; at scale=2
// that is 70px. Using 40px (20pt radius) crops the inner region of the circle
// where the digit is printed, excluding labels placed outside the circle edge.
const CROP_RADIUS_PX = 40; // 20pt radius at 2× scale
```

**Fix (robust):** Pass the detected circle radius from the graphics extractor so the crop can be sized per circle: `CROP_RADIUS_PX = Math.round(circle.radius * SCALE * 0.8)` where `radius` comes from the path bbox computed in `circleCentroidsFromSubpaths`.

---

## Warnings

### WR-01: `isCircleCentroidLayerName` accepts layer `'0'` without requiring any named layer to be absent first

**File:** `parser/layer-sources.js:72`

```javascript
export function isCircleCentroidLayerName(rawName) {
  if (rawName == null || rawName === '') return false;
  if (rawName === '0') return true;   // accepts ALL paths on the AutoCAD default layer
  // ...
}
```

The code comment in `graphics-extractor.js:144` acknowledges that layer `'0'` "carries almost all linework." This unconditional acceptance means every path on layer `'0'` in every PDF — regardless of whether the PDF also has a named `Numero_Poste` layer — is treated as a potential post circle. The sole guard is the span filter (CR-01). If a PDF correctly uses `Numero_Poste` for its circles and separately uses layer `'0'` for cable routes, both are treated as circle sources simultaneously.

**Fix:** Make layer `'0'` a fallback that only activates when no circles are found on any named layer in a given page. In `pdf-parser.js`, after the per-page OCR loop, if `namedLayerCircles.length > 0`, discard any layer-`'0'` circles for that page.

---

### WR-02: Sequence inference can produce post number `0` when the first circle fails OCR and `upper.number === 1`

**File:** `parser/post-assembler.js:221-222`

```javascript
} else if (upper) {
  inferred = upper.number - 1;
}
```

If the very first circle (before any known post) fails OCR, and the next known post is post 1, `inferred = 1 - 1 = 0`. The guard at line 225 (`inferred >= 1`) correctly rejects this and emits a warning. However, if CR-02 is not fixed, `upper.number` may be a garbage value (e.g., 500), making `inferred = 499`, which passes the `>= 1` guard and produces a bogus post.

Fixing CR-02 reduces the severity, but the guard should also add an upper bound:

**Fix:**
```javascript
// parser/post-assembler.js:225
// Existing:  if (inferred !== null && inferred >= 1) {
// Replace with:
if (inferred !== null && inferred >= 1 && inferred <= MAX_PLAUSIBLE_POST) {
```

---

### WR-03: D-10 bad-CTM filter is defeated when layer `'0'` contributes scattered non-degenerate centroids on a page with a degenerate named-layer CTM

**File:** `parser/pdf-parser.js:311-318`

```javascript
const isBadCtmPage = flippedCircles.length > 0 &&
  flippedCircles.every(c => c.x < 10 && c.y > pageHeight - 10);
```

The filter requires **every** circle to be near the page origin to trigger. When layer `'0'` contributes spurious centroids at normal positions across the page (from cable linework), even a page whose `Numero_Poste` CTM is degenerate will not satisfy `every(...)`, because the layer-`'0'` centroids have non-degenerate coordinates. The filter is effectively disabled for mixed-layer pages.

**Fix:** Only evaluate the filter against circles that came from named layers (not layer `'0'`). In `pdf-parser.js`, track a separate `namedLayerCircles` sub-list within the page loop and apply the D-10 test only to that sub-list.

---

### WR-04: `deduplicatePostsPreferLowerPage` does not warn when surviving post numbers are implausibly large relative to total count

**File:** `parser/post-assembler.js:158-168`, called from `parser/pdf-parser.js:338`

After deduplication, post numbers like 167 or 500 in a 15-post set are structurally valid (they are unique integers) but semantically wrong. Neither `deduplicatePostsPreferLowerPage` nor `pdf-parser.js` checks the maximum post number against total post count. Downstream consumers (Phase 2, KMZ builder) receive structurally well-formed but semantically corrupted data with no warning.

**Fix:** In `pdf-parser.js`, after line 338 (`const posts = deduplicatePostsPreferLowerPage(rawPosts)`):

```javascript
// Sanity-check: if the maximum post number greatly exceeds the count, OCR likely
// read coordinate values or label numbers as post numbers.
if (posts.length > 0) {
  const maxNum = Math.max(...posts.map(p => p.number));
  if (maxNum > posts.length * 3) {
    warnings.push(
      `Suspicious post numbers: highest number ${maxNum} is more than 3× the ` +
      `post count ${posts.length}. OCR may have read coordinate or label values ` +
      `as post numbers. Check graphics layer filtering (layer '0' span filter).`
    );
  }
}
```

---

### WR-05: `ocrCircleNumbers` creates and terminates a Tesseract worker per page — CDN import is repeated N times per PDF

**File:** `parser/ocr-extractor.js:37-42,79`

```javascript
const { createWorker } = (await import(TESSERACT_CDN)).default;
const worker = await createWorker('eng', 1, { logger: () => {} });
// ...
await worker.terminate();
```

`ocrCircleNumbers` is called once per page from `pdf-parser.js` line 322. Each call re-imports the CDN module, creates a new Tesseract WASM worker (including WASM init), runs OCR for all circles on that page, then terminates the worker. On a 5-page PDF this fires 5 CDN imports and 5 WASM initializations.

While module imports are cached by the browser after the first load, `createWorker` launches a new Web Worker and loads the WASM binary each time. This is a correctness risk: if the CDN is unreachable or rate-limits repeated requests, the second-through-Nth page OCR silently fails and those pages' circles produce all-null OCR results, causing sequence inference to run on the full page — which, with junk centroids from CR-01, produces wrong inferred numbers.

**Fix:** Hoist worker creation to the call site in `pdf-parser.js` before the page loop, pass the worker into `ocrCircleNumbers` as a parameter, and terminate it after all pages are processed. The function signature becomes:

```javascript
// ocr-extractor.js
export async function ocrCircleNumbers(page, pageHeight, circles, ocConfigPromise, worker) {
  // ... no createWorker / terminate here ...
}

// pdf-parser.js — before the page loop
const { createWorker } = (await import(TESSERACT_CDN)).default;
const ocrWorker = await createWorker('eng', 1, { logger: () => {} });
await ocrWorker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: '7' });
// ... page loop, passing ocrWorker to each ocrCircleNumbers call ...
await ocrWorker.terminate();
```

---

## Info

### IN-01: Multiple `console.info` / `console.debug` calls remain in production code paths

**Files:** `parser/pdf-parser.js:235,241-244,344`, `parser/post-assembler.js:96`, `parser/graphics-extractor.js:25,150`, `parser/text-extractor.js:241,247`

The diagnostic `console.info` at `pdf-parser.js:344` is the exact line that produced the quoted symptom log in the bug report. These calls are useful for debugging but expose internal coordinate data in the browser console for end users.

**Fix:** Guard behind a module-level `const DEBUG = false` flag or remove after the regression is resolved. The line at `pdf-parser.js:344` (which logs post numbers) is worth keeping behind a flag as it provides useful production diagnostics.

---

### IN-02: `assemblePostData`, `PROXIMITY_THRESHOLD`, and `deduplicatePosts` are exported but not imported by `pdf-parser.js`

**File:** `parser/post-assembler.js:8,52,141`

`assemblePostData` (the legacy TEXTO+circle spatial-matching function, lines 52–132) and `deduplicatePosts` (line 141) are exported but `pdf-parser.js` uses only `assemblePostsFromOcr` and `deduplicatePostsPreferLowerPage`. The `PROXIMITY_THRESHOLD` constant is also exported but unused by the active caller.

These dead exports suggest a pipeline switch occurred (text-based assembly replaced by OCR-based assembly) without cleaning up the old path. This creates confusion about which assembly function is authoritative.

**Fix:** Remove the `export` keyword from `assemblePostData`, `PROXIMITY_THRESHOLD`, and `deduplicatePosts`, or add `@deprecated` JSDoc tags and a comment explaining they are retained only for unit testing.

---

_Reviewed: 2026-05-15T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
