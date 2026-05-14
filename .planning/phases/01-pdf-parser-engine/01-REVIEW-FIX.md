---
phase: 01-pdf-parser-engine
fixed_at: 2026-05-14T16:42:06Z
review_path: .planning/phases/01-pdf-parser-engine/01-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 7
skipped: 0
status: all_fixed
---

# Phase 01: Code Review Fix Report

**Fixed at:** 2026-05-14T16:42:06Z
**Source review:** `.planning/phases/01-pdf-parser-engine/01-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope (Critical + Warning): 7 (CR-01 through CR-05, WR-01, WR-02, WR-03)
- Fixed: 7
- Skipped: 0

Note: WR-01 is the text-extractor analog of CR-01 and was fixed atomically in the same commit as CR-01 part 2. WR-02 was fixed atomically with CR-01 part 1. WR-03 was fixed atomically with CR-03.

---

## Fixed Issues

### CR-01 + WR-02: Replace `activeLayer` with `layerStack` in `graphics-extractor.js`

**Files modified:** `parser/graphics-extractor.js`
**Commit:** `9464272`
**Applied fix:** Removed the single `activeLayer = null` variable and replaced it with `layerStack = []`. Added `OPS_BEGIN_MARKED_CONTENT` (fn=69, BMC) constant and handler that pushes `null`. The existing `OPS_BEGIN_MARKED` (fn=70, BDC) handler now pushes the resolved layer name (or `null` if not found) instead of setting a single variable. `OPS_END_MARKED` (fn=71, EMC) pops one entry regardless of push source. `OPS_CONSTRUCT_PATH` reads the top of the stack inline via `layerStack[layerStack.length - 1]`. This preserves the outer BDC layer name when an inner BMC's EMC fires, fixing the root cause of "1 of 11 posts detected".

Also bundled WR-02: added `console.warn` when `readMatrix6` returns null in the OPS_TRANSFORM handler, instead of silently keeping stale CTM.

---

### CR-01 + WR-01 + CR-05: Replace `activeLayer` with `layerStack` + add `TL` handler in `text-extractor.js`

**Files modified:** `parser/text-extractor.js`
**Commit:** `216abc4`
**Applied fix:** Same layer-stack approach as graphics-extractor: added `OPS_BEGIN_MARKED_CONTENT` (fn=69) constant and handler, updated `OPS_BEGIN_MARKED` (fn=70) to push onto stack, `OPS_END_MARKED` (fn=71) pops. Show-text operators read the stack top inline.

Also bundled CR-05: added `OPS_SET_LEADING = 38` (TL) constant and handler `leading = args[0]`. The existing `OPS_NEXT_LINE` (T*) handler already uses `leading`, so it now correctly advances by the value set by TL rather than always advancing by 0.

---

### CR-02: Prevent `allDistItems` double-population in `pdf-parser.js`

**Files modified:** `parser/pdf-parser.js`
**Commit:** `bc4bb9f`
**Applied fix:** The all-page getTextContent scan now pushes distance candidates into a separate `allDistItemsFallback` array instead of directly into `allDistItems`. After the scan loop, `allDistItemsFallback` is merged into `allDistItems` only when `allDistItems.length === 0` (i.e., layer-filtered extraction found nothing). A warning is emitted when the fallback is used. This prevents every distance label from appearing twice when layer-filtered extraction succeeds.

---

### CR-03 + WR-03: Add `pageNum` to collected items + penalise cross-page circle matches

**Files modified:** `parser/pdf-parser.js`, `parser/post-assembler.js`
**Commit:** `d47f097`
**Applied fix (pdf-parser.js):** Added `pageNum` to `pageCache` entries. All collected items now carry `pageNum`: circles in `allCircles`, text items in `allTextoItems` and `allDistItems`, and integer items in `allIntItems` and `allDistItemsFallback`.

**Applied fix (post-assembler.js):** Added `CROSS_PAGE_PENALTY = 1e6` constant. In the nearest-circle search, computes a `score = distance + crossPagePenalty` where the penalty is applied when `text.pageNum !== circle.pageNum`. Nearest circle is selected by score (same-page circles always beat cross-page circles), but the threshold check still uses the raw geometric distance. Also added WR-03 diagnostic log: each post candidate logs its nearest circle distance and whether it is a cross-page match.

---

### CR-04: Add explicit warning when no post candidates found from any source

**Files modified:** `parser/pdf-parser.js`
**Commit:** `820b439`
**Applied fix:** After building `postCandidates`, checks `allIntItems.length === 0 && allTextoItems.length === 0` and pushes a `'CRITICAL: No post number candidates found...'` warning so empty-candidate failure is visible. Also removed the misleading earlier warning that fired when `allTextoItems` was empty (even though `allIntItems` — the primary source — is always populated), replacing it with a comment clarifying that `allIntItems` is always populated.

---

## Skipped Issues

None — all in-scope findings were fixed.

---

_Fixed: 2026-05-14T16:42:06Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
