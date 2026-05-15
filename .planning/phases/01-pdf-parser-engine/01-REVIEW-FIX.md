---
phase: 01-pdf-parser-engine
fixed_at: 2026-05-15T00:00:00Z
review_path: .planning/phases/01-pdf-parser-engine/01-REVIEW.md
iteration: 2
findings_in_scope: 9
fixed: 9
skipped: 0
post_review_fixes: 2
status: all_fixed
---

# Phase 01: Code Review Fix Report

**Fixed at:** 2026-05-15T00:00:00Z
**Source review:** `.planning/phases/01-pdf-parser-engine/01-REVIEW.md`
**Iteration:** 2

**Summary:**
- Findings in scope: 9 (CR-01, CR-02, CR-03, CR-04, WR-01, WR-02, WR-03, WR-04, WR-05)
- Fixed: 9
- Skipped: 0

---

## Fixed Issues

### CR-01: Layer 0 span filter too wide

**Files modified:** `parser/graphics-extractor.js`
**Commit:** a940df8
**Applied fix:** Changed `layer0Span` for `activeLayer === '0'` from `{ min: 16, max: 360 }` to `{ min: 50, max: 120 }`. This excludes cable segments, dimension lines, and pole-symbol rectangles whose bounding boxes fall outside the 50-120 pt range expected for ~35pt-radius post-marker circles. Added explanatory comment noting the tightening from the previous permissive range.

---

### CR-02: No plausibility gate on OCR numbers

**Files modified:** `parser/post-assembler.js`
**Commit:** b13f951
**Applied fix:** Added `const MAX_PLAUSIBLE_POST = Math.max(ocrResults.length * 2, 50)` before the `for` loop in `assemblePostsFromOcr`. Replaced the unconditional `if (number !== null) { posts.push(...); continue; }` block with a two-branch range check: numbers outside `[1, MAX_PLAUSIBLE_POST]` emit a warning and fall through to sequence inference; numbers in range still push and `continue` as before. `const posts = []` kept in place.

---

### CR-03: Sort ignores Y — vertically stacked circles misordered

**Files modified:** `parser/post-assembler.js`
**Commit:** f1cd582
**Applied fix:** Replaced the two-key sort `(pageNum then x)` with a three-key comparator `(pageNum then x then y)`. When two circles share a page and their X positions differ by at most 10pt, they are treated as the same column and sorted by ascending Y (top-to-bottom). Sequence inference neighbours are now consistent for vertically arranged routes.

---

### CR-04: OCR crop window too large

**Files modified:** `parser/ocr-extractor.js`
**Commit:** d63541f
**Applied fix:** Changed `CROP_RADIUS_PX` from `60` to `40` (20pt radius at 2x scale). Updated the STEP 3 comment to accurately describe the tighter crop that wraps only the inner region of the circle where the post digit is printed, excluding annotation text placed outside the circle edge.

---

### WR-01: Layer 0 unconditional — applied even when named layers present

**Files modified:** `parser/graphics-extractor.js`, `parser/pdf-parser.js`
**Commit:** 515e38b
**Applied fix:** `extractLayerGraphics` now returns `namedLayerCircles` (Numero_Poste and named aliases) and `layer0Circles` (AutoCAD default layer "0") as separate arrays alongside the merged `circles` union. In `pdf-parser.js`, `flippedCircles` is built from `namedFlipped` when any named-layer circles exist for the page; `layer0Flipped` is used only as a fallback when `namedFlipped.length === 0`. JSDoc return type and inline comments updated in both files.

---

### WR-02: Sequence inference can produce post number 0

**Files modified:** `parser/post-assembler.js`
**Commit:** d2fbaac
**Applied fix:** Added `&& inferred <= MAX_PLAUSIBLE_POST` to the sequence-inference accept guard. The guard was `inferred !== null && inferred >= 1`; it is now `inferred !== null && inferred >= 1 && inferred <= MAX_PLAUSIBLE_POST`. `MAX_PLAUSIBLE_POST` is in scope from the CR-02 fix in the same function.

---

### WR-03: D-10 filter defeated by layer 0 centroids

**Files modified:** `parser/graphics-extractor.js`, `parser/pdf-parser.js`
**Commit:** 515e38b
**Applied fix:** (Same commit as WR-01.) The `isBadCtmPage` check in `pdf-parser.js` now evaluates `namedFlipped` (named-layer circles only) instead of the full `flippedCircles`. Layer-0 centroids from cable linework no longer prevent the degenerate-CTM page skip from triggering on pages where `Numero_Poste` paths have a bad CTM.

---

### WR-04: No post-count sanity check

**Files modified:** `parser/pdf-parser.js`
**Commit:** 8a99237
**Applied fix:** After `const posts = deduplicatePostsPreferLowerPage(rawPosts)`, added a block that checks whether `Math.max(...posts.map(p => p.number)) > posts.length * 3` and, if so, pushes a warning describing the suspicious ratio and suggesting the layer-0 span filter as the likely cause.

---

### WR-05: Tesseract worker created per page

**Files modified:** `parser/ocr-extractor.js`, `parser/pdf-parser.js`
**Commit:** e48f893
**Applied fix:** Extracted worker lifecycle into a new exported `createOcrWorker()` function in `ocr-extractor.js`. `ocrCircleNumbers` now accepts `worker` as a required 5th parameter and no longer calls `createWorker`, `setParameters`, or `terminate` internally. In `pdf-parser.js`, `ocrWorker` is created via `createOcrWorker()` before the page loop, passed into each `ocrCircleNumbers` call, and terminated with `await ocrWorker.terminate()` after the loop. `TESSERACT_CDN` is now a named export.

---

## Skipped Issues

None — all 9 in-scope findings were successfully fixed.

---

## Post-Review Fixes

Discovered during manual testing after the code review cycle closed.

### PRF-01: Fill+stroke circle duplicates doubled OCR input

**Files modified:** `parser/graphics-extractor.js`
**Commit:** 3ea0a47
**Applied fix:** Each Numero_Poste post circle is drawn with two `constructPath` calls (fill + stroke), producing two identical centroids. This doubled the OCR input (11 → 22 entries), causing sequence inference to run on the fill/stroke partner of each circle and generate wrong inferred post numbers. Added `dedupeByProximity(<8pt)` on `namedLayerCircles` and `layer0Circles` before returning; logs how many duplicates were removed.

---

### PRF-02: OCR pipeline could not reliably read post digits

**Files modified:** `parser/ocr-extractor.js`, `parser/post-assembler.js`
**Commit:** (this commit)
**Applied fix (ocr-extractor.js):**
- Render scale raised from 2× to 6× so small overview-page circles (digits ~6 pt tall) have enough native pixels for Tesseract without blurry upscaling.
- Replaced fixed-radius crop with connected-component analysis: scan a 25 pt window around the path centroid for red pixels, group into components, select the component whose bounding box matches a post-marker ring (5–22 pt on each side, aspect 0.6–1.7), then crop the ring interior with an adaptive shrink.
- Fallback (no red ring found): fixed 50 px crop centred on the path centroid with a console warning.
- Binarization step: convert crop to strict black-on-white before Tesseract (dark pixels → black; red ring outline, background, anti-aliasing → white). Eliminates Tesseract confusion from the red circle outline.
- Upscaling for tiny crops: if the binarized crop is smaller than 120 px, upscale with high-quality smoothing so Tesseract has ≥25 px character height.
- PSM changed from 7 (single word) to 6 (single uniform block) — PSM 7/8 returned empty on clean binarized inputs; PSM 6 is the most permissive mode that still respects character ordering.
- Lenient number parse: pick the last digit run from the Tesseract output (handles leading "0" artefacts, stray spaces). Max-plausibility gating happens downstream.
- Debug output: emit base64 PNG data URLs for the first 6 failed crops per page so misses can be diagnosed visually.

**Applied fix (post-assembler.js):**
- `MAX_PLAUSIBLE_POST` tightened from `ocrResults.length * 2` to `ocrResults.length` — each post has exactly one centroid, so the highest valid post number equals the total circle count.
- `isAnchor[]` pre-computed flag array: only OCR reads that pass the plausibility gate qualify as sequence-inference anchors. This prevents a misread (e.g. number=46 on a 22-circle PDF) from being picked up as a `lower`/`upper` boundary and poisoning every interpolated value.
- Sequence-inference neighbour search rewritten to skip non-anchor entries, with explicit forward/backward index tracking (eliminates the `indexOf` call that would return the wrong index when duplicates exist).

---

_Fixed: 2026-05-15T00:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
