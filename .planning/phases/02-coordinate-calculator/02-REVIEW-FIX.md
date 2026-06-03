---
phase: 02-coordinate-calculator
fixed_at: 2026-05-30T12:00:00Z
review_path: .planning/phases/02-coordinate-calculator/02-REVIEW.md
iteration: 1
findings_in_scope: 27
fixed: 17
skipped: 10
status: partial
---

# Phase 02: Code Review Fix Report

**Fixed at:** 2026-05-30
**Source review:** `.planning/phases/02-coordinate-calculator/02-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 27
- Fixed: 17
- Skipped: 10

## Fixed Issues

### CR-01: `idxByNum` referenced before declaration (TDZ ReferenceError)

**Files modified:** `parser/dwg/graph-walker.js`
**Commit:** a686019
**Applied fix:** Replaced `Object.fromEntries(idxByNum)` with `{}` in the three early-return blocks at the zone-mismatch check and two no-anchor checks (lines 1113-1121, 1136-1144, 1162-1170). Since `idxByNum` has not been populated at those exit points, an empty object is the correct sentinel value. The populated map is only available after the anchor is resolved at line 1175.

### CR-03: Dead `dxf-parser-shim.js` (global never loaded)

**Files modified:** `parser/dwg/dxf-parser-shim.js` (deleted)
**Commit:** 6a79e40
**Applied fix:** Deleted the file. Confirmed via grep that no file in the repository imports it. `index.html` loads no `dxf-parser` UMD script. The actual DXF parsing uses the ESM import in `dxf-loader.js:1` which esbuild bundles.

### WR-01: `recognizeDigitsWithFallback` mutates worker PSM and never restores it

**Files modified:** `parser/ocr-extractor.js`
**Commit:** 197bea9
**Applied fix:** Restructured the return logic to capture the winner in a `let result` variable. After selecting the winner, reset PSM to 7 via `await worker.setParameters({ tessedit_pageseg_mode: "7" })` before returning. The early-return path (PSM-7 succeeds immediately) is unaffected since it exits before any PSM-6 call.

### WR-02: OCR fallback crop window uses fixed pixel constants ignoring SCALE

**Files modified:** `parser/ocr-extractor.js`
**Commit:** 8dab56e
**Applied fix:** Replaced the fixed `50`/`100` px fallback crop with `fallbackHalf = Math.round(25 * SCALE)` so the window scales with the render scale. Also corrected the stale file header comment from "2× scale" to "6× scale" to match `SCALE = 6`.

### WR-03: `node-canvas-setup.js` overwrites the entire `navigator` global

**Files modified:** `parser/node-canvas-setup.js`
**Commit:** 235a534
**Applied fix:** Changed the condition from `!globalThis.navigator?.language` to `typeof globalThis.navigator === "undefined"`, and replaced the direct assignment `globalThis.navigator = { ... }` with `Object.defineProperty(globalThis, "navigator", { value: ..., configurable: true })` wrapped in try/catch. This avoids the `TypeError` on Node 18+ where `navigator` is a read-only accessor.

### WR-04: `dxf-loader.js` collapses LWPOLYLINE to first+last vertex

**Files modified:** `parser/dwg/dxf-loader.js`
**Commit:** beb8a51
**Applied fix:** Replaced the two-endpoint extraction with a `for (let k = 1; k < vertices.length; k++)` loop that emits one `cableEdge` per consecutive vertex pair. Each segment carries its own numeric-coordinate guards.

### WR-05: `findRedComponents` search window biased near canvas edges

**Files modified:** `parser/ocr-extractor.js`
**Commit:** 17d6656
**Applied fix:** Changed `sx = Math.max(0, cx - searchHalfPx)` to `sx = Math.max(0, Math.min(cx - searchHalfPx, canvasW - searchHalfPx * 2))` (same for sy). This clamps the start coordinate so the `2*searchHalfPx` window remains centred on (cx, cy) even when the circle is near a canvas edge.

### WR-06: `parseCoordinateInput` fragile token validation

**Files modified:** `parser/coordinate-calculator.js`
**Commit:** 3241ca5
**Applied fix:** Added an up-front guard that rejects inputs containing both a comma and whitespace (catching thousands-separator ambiguity). Added a strict `DECIMAL_RE = /^-?\d+(\.\d+)?$/` test for each token before `parseFloat`, so inputs that happen to parse to a plausible range but aren't valid decimal numbers are rejected.

### WR-07: `detectGaps` hasDistance check misses reverse direction and accepts `meters: null`

**Files modified:** `parser/coordinate-calculator.js`
**Commit:** b0b54e5
**Applied fix:** Replaced `distMap.get(fwd) != null` with a bidirectional lookup (`fwd` then `rev`) and added `> 0` to require a positive distance. An entry with `meters: null` or `meters: 0` no longer prevents a gap from being recorded.

### WR-08: `findMultiHopByLabel` non-deterministic tie-break + O(n) intermediates check

**Files modified:** `parser/dwg/graph-walker.js`
**Commit:** b5a1568
**Applied fix:** Added a final deterministic tiebreak `a.endpoint < b.endpoint` to `scoreBetter` so equal-scoring candidates resolve independently of Set iteration order. Converted the `intermediates` array to a parallel `intermediateSet: Set` (passed recursively, add-on-push/delete-on-pop) so membership tests are O(1) instead of O(n).

### WR-09: `applyBifurcationJunctionLabelRehome` unconditional break after first meter-match

**Files modified:** `parser/distance-associator.js`
**Commit:** 4f6b7a3
**Applied fix:** The `break` was moved inside the positive-match branch: `if (dT < dJ * JUNCTION_CLOSER_RATIO) { tapMainOnTap = true; break; }`. The loop now continues scanning on junction-side matches, only stopping when it finds a tap-side label.

### WR-10: `calculateCoordinates` mutates caller's `distances[]` in place

**Files modified:** `parser/coordinate-calculator.js`
**Commit:** 71d1a0c
**Applied fix:** Added a multi-line JSDoc note to the `distances` parameter documenting the in-place mutation. A full refactor (clone-before-mutate) was deferred as architectural change; the note at minimum makes the side effect discoverable by callers.

### WR-11: `kml-builder` branch-start detection uses always-equal duplicate condition

**Files modified:** `parser/kml-builder.js`
**Commit:** f1f66fa
**Applied fix:** Replaced `o.to > e.from + 1 || o.to - e.from > 1` (the two disjuncts are algebraically identical) with `Math.abs(o.to - e.from) > 1` so backward-numbered branch successors are correctly flagged as branch starts.

### INF-02/03: Dead `void` expressions and dead `buildPostByNumber` call

**Files modified:** `parser/dwg/graph-walker.js`
**Commit:** e40ecd5
**Applied fix:** Replaced the bare `// The original adjacencyGraph argument is intentionally ignored here.` with a fuller explanation of why the parameter and import are unused (API signature parity). Added `// eslint-disable-line no-unused-expressions` inline comments. Deleted the `buildPostByNumber(posts); // validate; result unused` call which performs no validation and discards its result.

### INF-07: Magic literal `303.6 / 1191` repeated five times

**Files modified:** `parser/distance-associator.js`
**Commit:** 64b9d8c
**Applied fix:** Added `const OVERVIEW_TO_DETAIL_SCALE = 303.6 / 1191;` at the top of the file with a comment explaining the derivation (overview vs detail page widths). Replaced all five inline occurrences with the named constant.

### INF-10: KML `<coordinates>` interpolates lat/lon without numeric enforcement

**Files modified:** `parser/kml-builder.js`
**Commit:** 4d4656f
**Applied fix:** Changed both coordinate interpolations (Placemark point and polyline coords) to `Number(p.lon).toFixed(7)` / `Number(p.lat).toFixed(7)`. This enforces finite-number output — a `NaN` or string upstream becomes `"NaN"` visibly rather than being silently embedded.

### INF-13: Stale / contradictory comments

**Files modified:** `parser/coordinate-calculator.js`, `parser/post-positioning.js`
**Commit:** 7dd6097
**Applied fix:** Removed `// 28-29 skip removed in attempt 13 — chain bearing now uses gpsBearing not cable tangent.` and replaced with a current-invariant statement. Updated the `VITERBI_SIGMA_PT` JSDoc to be explicit: `20 pt ≈ 7 m at ~0.35 m/pt typical scale` rather than the vague `~7 m at typical scale`. (The `2× scale` → `6× scale` stale comment was fixed in WR-02.)

## Skipped Issues

### CR-02: Route-specific hard-coded post/page numbers embedded in general algorithms

**File:** `parser/dwg/graph-walker.js:1790`, `:2034`; `parser/geo/route-sequence.js:11-12`; `parser/distance-associator.js:1607-1630`
**Reason:** Architectural change — cannot safely generalize without breaking Siriu/João Born routes. Per task instructions: the `73→74` and `80→81` guards in graph-walker are on the active `fix/siriu-post45-phantom-hint` bugfix branch and must not be altered. The `route-sequence.js` page constants are João-Born-specific and backed by passing tests. The `distance-associator.js` posts 36/37/38 block is a Siriu sheet-break fix that would require a per-route override config to generalize safely.
**Original issue:** Core pairing/numbering logic gated on literal post/page numbers that only exist in two test fixtures.

### INF-01: Console logging left in production paths

**File:** `parser/geo/utm-calibrator.js:389-394`, `:461-464`; `parser/coordinate-calculator.js:1279`; `parser/ocr-extractor.js:396-410`, `:499-512`
**Reason:** Skipped — gating all console output behind an env flag touches many hot paths across multiple files and risks silencing legitimate warnings. A comprehensive logging audit is better handled as a dedicated task rather than an inline fix.
**Original issue:** `console.debug`/`console.info`/`console.warn` calls fire on every page transform and OCR circle in normal runs.

### INF-04: Duplicated `pdfBearing` helper with inconsistent sign conventions

**File:** `parser/coordinate-calculator.js:82-86`, `:156-160`, `:226-230`, `:1310-1314`; `parser/geo/utm-calibrator.js`, `cable-boundary-calibrator.js`
**Reason:** Skipped per task instructions — extracting a shared helper across 8 files is a cross-cutting architectural refactor that requires settling the sign-convention disagreement first. Safe auto-fix is not possible.
**Original issue:** `atan2(dx, dy)` bearing helper re-implemented many times with subtly different `dy` sign conventions.

### INF-05: Duplicated `selectRouteCableOps` across three modules

**File:** `parser/geo/cable-arc-placer.js:122-136`, `parser/geo/cable-boundary-calibrator.js:112-126`, `parser/post-positioning.js:728-742`
**Reason:** Skipped per task instructions — hoisting to `cable-builder.js` as a shared export is an architectural change requiring careful analysis of threshold differences and callers. Not a safe auto-fix.
**Original issue:** Three near-identical copies of "pick best cable ops near reference point" with the same score heuristic.

### INF-06: Duplicated `postPdfPos`/`pdfPos`/`anchorOf` accessor with inconsistent anchor handling

**File:** `parser/geo/utm-calibrator.js`, `cable-boundary-calibrator.js`, `distance-associator.js`, `post-positioning.js`
**Reason:** Skipped — requires confirming whether the utm-calibrator variant that drops anchorX is intentional (different coordinate semantics). A shared helper would need a behavioral spec first.
**Original issue:** "anchorX ?? x" accessor reimplemented multiple times with subtle inconsistency.

### INF-08: Dead/superseded exports kept in the build surface

**File:** `parser/coordinate-calculator.js:653` (`snapPostsToPolyline`); `parser/geo/utm-calibrator.js:532`; `parser/geo/cable-boundary-calibrator.js:320`; `parser/dwg/region-pairing.js:46`
**Reason:** Skipped — confirming zero callers requires a full grep across the entire project including tests. Removing exported functions risks breaking callers not visible at review time. Marking `@deprecated` would be safe but requires reading each of the four files; deferred to a cleanup pass.
**Original issue:** Several exported functions are explicitly legacy/superseded but remain exported.

### INF-09: `route-sequence.js` `remapBrowserPostsToParserOrder` appears unused in production

**File:** `parser/geo/route-sequence.js:16-20`
**Reason:** Skipped — the functions are exercised by `parser/__tests__/route-sequence.test.mjs`. Deleting them would break the test suite. Generalizing per CR-02 is the right fix but deferred (see CR-02 skip reason).
**Original issue:** João-Born-specific page→number remaps with no reviewed production caller.

### INF-11: `MAX_PLAUSIBLE_POST = ocrResults.length` inflatable by duplicate circles

**File:** `parser/post-assembler.js:517`
**Reason:** Skipped — the fix requires deciding on a more robust bound (e.g. unique centroids, or a fixed per-route max). This is a product decision, not a mechanical code fix.
**Original issue:** Valid-post-number upper bound equals raw OCR result count; duplicates inflate it.

### INF-12: `solveLinear` accepts near-singular systems with only a pivot-magnitude guard

**File:** `parser/geo/grid-affine-calibrator.js:95-120`
**Reason:** Skipped — adding a condition-number or residual check requires numerical analysis to choose thresholds that don't over-reject sparse-grid drawings. Not a safe mechanical fix.
**Original issue:** Near-singular systems can yield wild affine coefficients that pass the current `1e-12` pivot guard.

---

_Fixed: 2026-05-30_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
