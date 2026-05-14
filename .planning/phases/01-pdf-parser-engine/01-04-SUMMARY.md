---
phase: 01-pdf-parser-engine
plan: "04"
subsystem: pdf-parser
tags: [ocr, tesseract, post-extraction, dead-code-removal]
dependency_graph:
  requires: [01-01, 01-02, 01-03]
  provides: [ocrCircleNumbers, assemblePostsFromOcr, parsePdf-with-OCR]
  affects: [parser/pdf-parser.js, parser/ocr-extractor.js, parser/post-assembler.js]
tech_stack:
  added: [Tesseract.js@5 CDN ESM, OffscreenCanvas]
  patterns: [canvas-crop-OCR, sequence-inference, bad-CTM-filter]
key_files:
  created: [parser/ocr-extractor.js]
  modified: [parser/pdf-parser.js, parser/post-assembler.js]
decisions:
  - "OCR per-page: one render call, multiple crops (D-08) — not per-circle viewport renders"
  - "Bad-CTM filter uses x<10 AND y<10 (flipY coords) — not hardcoded page numbers (D-10)"
  - "Sequence inference only when inferred >= 1 — avoids negative post numbers at array start"
metrics:
  duration: "216s"
  completed: "2026-05-14"
  tasks_completed: 3
  files_changed: 3
---

# Phase 1 Plan 04: OCR Post-Number Extraction Summary

**One-liner:** Replaced broken text-proximity post number extraction with Tesseract.js OCR pipeline rendering circle crops at 2x scale, plus D-10 bad-CTM page filter and sequence inference for OCR gaps.

## What Was Built

### Task 1 — parser/ocr-extractor.js (new file)
- Named export `ocrCircleNumbers(page, pageHeight, circles)` using Tesseract.js@5 from CDN
- Renders each PDF page to `OffscreenCanvas` at scale 2 (one render per page, D-08)
- Crops 120px windows (60pt radius × 2) around each circle centroid
- Tesseract config: `tessedit_char_whitelist = '0123456789'`, `tessedit_pageseg_mode = '7'`
- Returns `Array<{circle, number}>` where `number` is integer or `null` on OCR miss
- Worker terminated after all circles on a page (prevents worker accumulation, T-04-01)
- Crop bounds clamped to canvas dimensions (T-04-02 mitigation)

### Task 2 — parser/pdf-parser.js (major rewrite)
- Deleted ~845 lines of dead text-proximity code:
  - 14 dead functions: `integerTextsNearCircles`, `dedupePostIntCandidates`, `postCandidateAnchorXY`, `dedupePostDigitCandidatesNearestCircle`, `circlesNearLayerSequentialDigits`, `computePageCircleAnchorStats`, `strictDigitsNearCircleCentroids`, `maskedDigitsNearCentroids`, `circlesFromAnchorDensityPages`, `selectPostAssemblyCircles`, `refinePostMarkersByInsideDigitsAndCable`, `circlesWithSequentialTextInsideFromLayers`, `circlesWithMaskedRouteTextInsideFromLayers`, `circlesWithStrictWholeDigitInsideFromGettext`
  - All associated constants (INSIDE_POST_*, LAYER_ANCHOR_*, GETTEXT_*, ANCHOR_*)
  - Dead `pageCache`, `allIntItems`, `postCandidates` pipeline
- Added imports: `ocrCircleNumbers` from `./ocr-extractor.js`, `assemblePostsFromOcr` from `./post-assembler.js`
- Added D-10 bad-CTM page filter: skips pages where all circles have `x<10 AND y<10` (flipY coords)
- OCR pipeline: `flippedCircles → ocrCircleNumbers → allOcrResults` per page
- Post assembly: `assemblePostsFromOcr(allOcrResults) → rawPosts → deduplicatePostsPreferLowerPage`
- Output contract unchanged: `{ posts, distances, cableSegments, warnings, layerMap }`
- All non-post extraction code preserved: distances, cable segments, Poste type labels, snapToPoste

### Task 3 — parser/post-assembler.js (additive)
- Added new export `assemblePostsFromOcr(ocrResults)` at end of file
- Sorts circles by `pageNum` then `x` (left-to-right, D-07)
- Direct pass-through for OCR hits (`number !== null`)
- Sequence inference for OCR misses using lower/upper neighbours in sorted order
  - Both bounds: linear interpolation over index span
  - Lower only: `inferred = lower + 1`
  - Upper only: `inferred = upper - 1`
  - Neither: post skipped with warning
- Warns per OCR failure and per inferred number
- All existing exports unchanged: `assemblePostData`, `deduplicatePosts`, `deduplicatePostsPreferLowerPage`, `PROXIMITY_THRESHOLD`

## Deviations from Plan

### Minor: assemblePostsFromOcr grep returns 1 line instead of 2

**Found during:** Task 3 verification
**Issue:** Plan acceptance criteria expected `grep -c "assemblePostsFromOcr"` to return >= 2. The implementation uses `export function assemblePostsFromOcr(ocrResults) {` (all on one line), so grep finds exactly 1 match.
**Assessment:** The function is correctly exported and implemented. The 2-line expectation assumed a split export style (`export { assemblePostsFromOcr }` + `function assemblePostsFromOcr`). The single-line `export function` style is idiomatic and correct.
**Fix:** None needed — the code is correct. Criterion intent (function exported, body present) is met.

## Known Stubs

None. All exports are fully implemented. OCR pipeline wires to real Tesseract.js CDN.

## Threat Flags

No new threat surface beyond what is documented in the plan's `<threat_model>`:
- `parser/ocr-extractor.js` CDN import of Tesseract.js@5 — already T-04-04 (CDN unavailable = parse_failed, user-visible)
- `parser/pdf-parser.js` CDN import of pdfjs-dist — pre-existing, not new surface

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| parser/ocr-extractor.js exists | FOUND |
| parser/pdf-parser.js exists | FOUND |
| parser/post-assembler.js exists | FOUND |
| 01-04-SUMMARY.md exists | FOUND |
| Commit f1fe167 (Task 1) | FOUND |
| Commit 56519a1 (Task 2) | FOUND |
| Commit 01f3914 (Task 3) | FOUND |
