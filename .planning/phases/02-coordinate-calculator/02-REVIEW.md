---
phase: 02-coordinate-calculator
reviewed: 2026-05-30T00:00:00Z
depth: standard
files_reviewed: 35
files_reviewed_list:
  - .github/workflows/regression-gate.yml
  - browser/main.js
  - index.html
  - parser/cable-builder.js
  - parser/construct-path-parser.js
  - parser/coordinate-calculator.js
  - parser/distance-associator.js
  - parser/dwg/coordinate-calculator-dwg.js
  - parser/dwg/dxf-loader.js
  - parser/dwg/dxf-parser-shim.js
  - parser/dwg/graph-walker.js
  - parser/dwg/region-library.js
  - parser/dwg/region-pairing.js
  - parser/geo/cable-arc-placer.js
  - parser/geo/cable-boundary-calibrator.js
  - parser/geo/grid-affine-calibrator.js
  - parser/geo/label-lsq-calibrator.js
  - parser/geo/overview-composite.js
  - parser/geo/route-corridor.js
  - parser/geo/route-sequence.js
  - parser/geo/utm-calibrator.js
  - parser/graphics-extractor.js
  - parser/kml-builder.js
  - parser/kml-color.js
  - parser/kmz-defaults.js
  - parser/kmz-packager.js
  - parser/layer-sources.js
  - parser/node-canvas-setup.js
  - parser/ocr-extractor.js
  - parser/pdf-parser.js
  - parser/post-assembler.js
  - parser/post-positioning.js
  - parser/post-positioning-n3.js
  - scripts/build.mjs
  - vercel.json
findings:
  critical: 3
  warning: 11
  info: 13
  total: 27
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-05-30
**Depth:** standard
**Files Reviewed:** 35 (cable-builder.js, label-lsq-calibrator.js, and pdf-parser.js read only partially due to size; findings below cite confirmed line ranges)
**Status:** issues_found

## Summary

Phase 02 introduced the DWG graph-walk pairing pipeline (`parser/dwg/*`) plus a large UTM/geo calibration layer (`parser/geo/*`). The geo and KML/KMZ utility modules are generally well structured. The DWG graph-walker (`graph-walker.js`, 2837 lines) is by far the highest-risk file: it concentrates dozens of special-case branches, several hard-coded post-number literals tied to one specific drawing (`siriu.dxf`), and at least one reference-before-declaration bug that throws under a debug flag.

The strongest correctness concerns:
- A `const` referenced before its declaration in three early-return paths of `pairPostsByGraphWalk` (throws `ReferenceError` when `GW_RETURN_IDX` is set).
- Route-specific magic constants (`fromNum === 73 && toNum === 74`, `fromNum === 80 && toNum === 81`, page numbers `3`/`5`/`15`/`60`, posts `36/37/38`) baked into general-purpose algorithms. These silently no-op or misbehave on any drawing other than the two test fixtures.
- An unused dead module (`dxf-parser-shim.js`) whose contract (a `globalThis.DxfParser`) is never satisfied and never invoked.

The dominant quality theme is **low cohesion and route-specific coupling** in the DWG walker and distance-associator: general algorithms are interleaved with one-off fixups for named routes, making the code extremely hard to reason about or extend to a third drawing.

## Critical Issues

### CR-01: `idxByNum` referenced before declaration in early-return paths (TDZ ReferenceError)

**File:** `parser/dwg/graph-walker.js:1118`, `:1140`, `:1166`
**Issue:** Inside `pairPostsByGraphWalk`, three early-return blocks reference `idxByNum` via `...(envFlag("GW_RETURN_IDX") ? { idxByPostNumber: Object.fromEntries(idxByNum) } : {})`. But `idxByNum` is declared with `const` at line 1175 — *after* all three of these return sites (the zone-mismatch return at 1113-1121, the no-anchor returns at 1136-1144 and 1162-1170). Because `const` bindings live in the temporal dead zone until their declaration executes, any of these returns will throw `ReferenceError: Cannot access 'idxByNum' before initialization` whenever `GW_RETURN_IDX` is set in the environment. The error masks the intended graceful failure (zone mismatch / no anchor), turning a recoverable "fall back to PDF" path into an uncaught throw.
**Fix:** Declare `idxByNum` (and `dwgByNum`, `visitedIdx`, etc. if similarly referenced) before the anchor-resolution block, or guard these early returns to not reference it:
```js
// Move declaration above the zone-mismatch check, or in each early return use:
...(envFlag("GW_RETURN_IDX") ? { idxByPostNumber: {} } : {})
```

### CR-02: Route-specific hard-coded post/page numbers embedded in general algorithms

**File:** `parser/dwg/graph-walker.js:1790` (`fromNum === 73 && toNum === 74`), `:2034` (`fromNum === 80 && toNum === 81`); `parser/geo/route-sequence.js:11-12` (`pageNum === 3 → 15 - n`, `pageNum === 5 → 60 - n`), `:33` (`p1.pageNum !== 3`); `parser/distance-associator.js:1608-1630` (`j36/t37/m38`, literals `10.5`, `35.5`)
**Issue:** Core pairing/numbering logic is gated on literal post numbers and page numbers that only exist in the two test fixtures (Siriu, João Born). `findGapOffCableReentryByNextLabel` only runs for the exact hop `73→74`; the off-cable insert repair only runs for `80→81`; `remapBrowserPostNumber` mirror-maps page 3 and page 5 with constants `15` and `60`; the distance-associator hard-codes a bifurcation at posts 36/37/38 with literal meter values 10.5 and 35.5. On any third drawing these branches either never fire (silently degrading accuracy) or fire incorrectly (e.g. a real `73→74` hop on a different route triggers the gap-reentry heuristic). This is a correctness-and-maintainability defect: the algorithm is fitted to fixtures, not generalized.
**Fix:** Replace literal gates with structural predicates. For the gap-reentry: detect "gap edge with large/absent label and a long-chord off-cable re-entry" without naming 73/74. For route-sequence: derive the mirror pivot from the actual min/max post numbers on the page (as `correctRouteNumberingByDistanceLabels` already does via `minN + maxN - number`) instead of constants 15/60. For the 36/37/38 block: the generic bifurcation passes above it already handle junction→tap→main; remove the named-post special case or move it behind a per-route override config, not inline code.

### CR-03: Dead, contract-broken module `dxf-parser-shim.js` (global never loaded)

**File:** `parser/dwg/dxf-parser-shim.js:2-8`; `index.html:827`
**Issue:** `dxf-parser-shim.js` throws at import time unless `globalThis.DxfParser` exists ("ensure node_modules/dxf-parser/dist/dxf-parser.js is loaded before modules"). No file in the repo imports this shim (grep confirms it is referenced only by itself), and `index.html` loads no `dxf-parser` UMD `<script>` — only `./dist/app.js`. Meanwhile the actual DXF code path (`dxf-loader.js:1`) imports `dxf-parser` as an ESM/bundled dependency, which esbuild bundles. So the shim is dead code that, if ever wired up, would immediately throw because its precondition is never met. Dead modules that encode a false "this is how DXF parsing is loaded" contract are a trap for the next maintainer and a latent runtime crash.
**Fix:** Delete `dxf-parser-shim.js`. If a browser-global path is genuinely intended, document and actually load the UMD bundle in `index.html`, and import the shim where DXF parsing occurs. As-is it is misleading dead code.

## Warnings

### WR-01: `recognizeDigitsWithFallback` mutates worker PSM and never restores it

**File:** `parser/ocr-extractor.js:298-303`
**Issue:** `runWithPsm` calls `worker.setParameters({ tessedit_pageseg_mode: String(psm) })` and the function may return after running PSM 6, leaving the worker globally configured to PSM 6 for the *next* circle. The worker is created with PSM 7 (`createOcrWorker`, line 284) and the per-circle loop assumes PSM-7-first behavior. Because the parameter is shared mutable state on the long-lived worker, OCR results become order-dependent: a circle that needed the PSM-6 fallback silently changes the segmentation mode for all subsequent circles until another fallback flips it back.
**Fix:** Reset PSM to 7 at the end of `recognizeDigitsWithFallback` (or before each `runWithPsm(7)` call), so each circle starts from a known state:
```js
const result = ...;
await worker.setParameters({ tessedit_pageseg_mode: "7" });
return result;
```

### WR-02: OCR fallback crop window uses fixed pixel constants that ignore `SCALE`

**File:** `parser/ocr-extractor.js:344`, `:403-406`
**Issue:** `SCALE` is `6`, but the no-ring fallback crop is `Math.max(0, rawCx - 50)` / `Math.min(100, ...)` — a fixed 100×100 px window. At SCALE=6 a ~35 pt post marker spans ~210 px, so the 100 px fallback crop can clip the digits. The module header comment (line 3, "2× scale") is also stale relative to `SCALE = 6`, indicating the constant was changed without updating the fallback geometry. This degrades OCR reliability precisely when the red-ring detector already failed (the hardest cases).
**Fix:** Scale the fallback window by `SCALE` (e.g. `Math.round(25 * SCALE)` half-window to match `locateRedMarkerRing`'s `searchHalfPx`), and correct the stale `2×` comments.

### WR-03: `node-canvas-setup.js` overwrites the entire `navigator` global

**File:** `parser/node-canvas-setup.js:26-32`
**Issue:** When `globalThis.navigator?.language` is falsy, the code assigns `globalThis.navigator = { language, platform, userAgent }`. On modern Node (18+) `globalThis.navigator` exists and is a non-configurable/read-only accessor; assigning to it throws `TypeError: Cannot set property navigator of #<Object> which has only a getter`, aborting polyfill setup. Even where assignment succeeds, replacing the whole object discards any real navigator fields pdf.js or downstream code may read.
**Fix:** Guard the assignment and only define when absent, using `Object.defineProperty` with try/catch, and set only the missing property rather than replacing the object:
```js
if (typeof globalThis.navigator === "undefined") {
  try { Object.defineProperty(globalThis, "navigator", { value: { language: "en-US", platform: "", userAgent: "" }, configurable: true }); } catch {}
}
```

### WR-04: `dxf-loader.js` collapses each LWPOLYLINE to first+last vertex, dropping intermediate topology

**File:** `parser/dwg/dxf-loader.js:50-61`
**Issue:** For each `TrechoSecundarioAereo` LWPOLYLINE the loader records only `vertices[0]` and `vertices[length-1]` as a single cable edge. A polyline with bends (3+ vertices) representing two cable hops collapses into one straight chord. Downstream `buildRichAdjacency` snaps edge endpoints to nearest INSERT within 8–14 m; an intermediate post sitting on a polyline bend will not be connected to its neighbors, fragmenting the cable graph the walker depends on. This silently weakens the very adjacency graph that `graph-walker.js` was built to navigate.
**Fix:** Emit one edge per consecutive vertex pair: `for (let k = 1; k < vertices.length; k++) cableEdges.push({ a: vertices[k-1], b: vertices[k] })` (with the same numeric-coordinate guards). If the single-chord behavior is intentional, document why intermediate vertices are safe to drop.

### WR-05: `findRedComponents` search window is clamped on the high side but not centered, biasing crops near canvas edges

**File:** `parser/ocr-extractor.js:106-109`
**Issue:** `sx = max(0, cx - searchHalfPx)` then `sw = min(searchHalfPx*2, canvasW - sx)`. When `cx < searchHalfPx` (circle near the left/top edge), `sx` is clamped to 0 but `sw` stays `searchHalfPx*2`, so the window is shifted right of the circle rather than centered on it — the marker can fall outside the searched region. Edge-of-page posts (common at sheet boundaries) are exactly the posts most likely to be miss-detected.
**Fix:** Compute the window symmetrically: `sx = clamp(cx - half, 0, canvasW - 2*half)` (and similarly sy), or widen `sw` to cover `cx - half .. cx + half` after clamping both ends.

### WR-06: `parseCoordinateInput` relies on downstream range checks instead of strict token validation

**File:** `parser/coordinate-calculator.js:294-310`
**Issue:** For space-separated input the tokens from `trimmed.split(/\s+/)` are not re-trimmed, and inputs with a thousands separator (`"1,234.5 -48.6"`) split on comma into `["1", "234.5 -48.6"]`-style ambiguity, leaning entirely on the later lat/lon range checks to reject malformed input. Acceptance is fragile: a value that happens to fall in range after a bad split would be silently accepted as a coordinate.
**Fix:** Validate each token with a strict signed-decimal regex before `parseFloat`, and reject inputs containing more than one separator type.

### WR-07: `detectGaps` distance presence check conflates "unlabeled" with "explicitly null"

**File:** `parser/coordinate-calculator.js:890`
**Issue:** `const hasDistance = distMap.get(\`${curr.number}->${next.number}\`) != null;` checks one direction and treats any non-null value as "has distance," but the associator stores `meters: null` entries and the map is built with `d.meters` for both directions. The `!= null` semantics mean a pair present with a real reverse-only value is fine today (both directions carry the same value), but the check is brittle: it does not require a *positive* distance and does not consult both keys explicitly.
**Fix:** `const m = distMap.get(fwd) ?? distMap.get(rev); const hasDistance = m != null && m > 0;`.

### WR-08: `findMultiHopByLabel` tie-breaks depend on adjacency `Set` iteration order

**File:** `parser/dwg/graph-walker.js:935-988`
**Issue:** The DFS returns the first `scoreBetter` winner; when candidates tie on degree/chain-length/delta, the winner is determined by the iteration order of the neighbor `Set`, which is insertion order from `buildRichAdjacency`/`unionAdjacency`. This makes the chosen INSERT a function of cable-edge parse order rather than a total ordering, so a change in `dxf-loader` emission order could flip a placement. The per-path loop guard `intermediates.includes(next)` is also an O(n) linear scan on a hot path.
**Fix:** Make the comparator total (final tiebreak on `endpoint` index) so results are deterministic regardless of adjacency build order; use a `Set` for `intermediates` membership.

### WR-09: `applyBifurcationJunctionLabelRehome` unconditional `break` after first meter-matching label

**File:** `parser/distance-associator.js:1538-1549`
**Issue:** The loop scanning for the tap-main label `break`s after the first label within meter tolerance regardless of whether that label sits on the tap or the junction side. If the first match is on the junction side, `tapMainOnTap` stays false and the rehome is skipped even though another same-meter label on the tap would have qualified.
**Fix:** Only break on a positive match: `if (dT < dJ * JUNCTION_CLOSER_RATIO) { tapMainOnTap = true; break; }`.

### WR-10: `calculateCoordinates` mutates the caller's `distances[].meters` in place

**File:** `parser/coordinate-calculator.js:1076-1079`
**Issue:** After auxiliary distance supplementation the function writes `d.meters = v` back into the caller's array. `coordinate-calculator-dwg.js` calls `calculateCoordinates` first and then reuses the same `distances` for `runDwgPairingCascade`, so the DWG walker sees mutated meters differing from what was passed. This hidden side effect makes the PDF and DWG paths order-dependent and hard to test in isolation.
**Fix:** Clone before mutating, or return augmented distances explicitly. At minimum document that `distances` is mutated in place.

### WR-11: `kml-builder` branch-start detection uses an always-equal redundant condition

**File:** `parser/kml-builder.js:144`
**Issue:** `if (o.to > e.from + 1 || o.to - e.from > 1)` — the two disjuncts are algebraically identical (`o.to > e.from + 1` ⇔ `o.to - e.from > 1`). The `||` can never select differently than either operand alone, so the intended second case is lost (e.g. branches that go backward in numbering are never flagged as branch starts).
**Fix:** Decide the real predicate. If any non-consecutive successor is a branch start, use `Math.abs(o.to - e.from) > 1` and delete the duplicate.

## Info

### INF-01: Console logging left in production paths

**File:** `parser/geo/utm-calibrator.js:389-394`, `:461-464`; `parser/coordinate-calculator.js:1279`; `parser/graphics-extractor.js:57`, `:187`, `:235`; `parser/ocr-extractor.js:396-410`, `:499-512`
**Issue:** `console.debug`/`console.info`/`console.warn` calls fire on every page transform build and every OCR circle in normal (non-debug) runs. `coordinate-calculator.js:1279` loops `for (const w of warnings) console.warn(w)` unconditionally. This floods the browser console in production and couples logging to hot paths.
**Fix:** Gate verbose logging behind an env/debug flag (the repo already has `envTruthy`/`PP_DBG`/`GW_TRACE` patterns — reuse them).

### INF-02: `void adjacencyGraph; void buildAdjacencyGraph;` to silence unused params/imports

**File:** `parser/dwg/graph-walker.js:1093-1094`
**Issue:** The function accepts `adjacencyGraph` and imports `buildAdjacencyGraph` only to immediately `void` them, because it rebuilds its own richer graph. This is dead parameter/import surface kept for signature parity and misleads callers into thinking the passed graph matters.
**Fix:** Drop the unused import and parameter (or document the deliberate ignore in JSDoc rather than `void`-ing at runtime).

### INF-03: `buildPostByNumber(posts)` called purely for a non-existent "validation" side effect

**File:** `parser/dwg/graph-walker.js:1261`
**Issue:** `buildPostByNumber(posts); // validate; result unused in graph-walk` — the function only builds and returns a Map; it has no validation side effects and throws nothing for bad input. The call allocates and discards.
**Fix:** Delete the call, or replace with an actual validation that warns/throws on malformed posts.

### INF-04: Duplicated `pdfBearing` helper with inconsistent sign conventions

**File:** `parser/coordinate-calculator.js:82-86`, `:156-160`, `:226-230`, `:1310-1314`; `parser/geo/utm-calibrator.js:542-548`, `:653-659`, `:728-730`; `parser/geo/cable-boundary-calibrator.js:333-339`
**Issue:** The same `atan2(dx, dy)` bearing helper is re-implemented many times with subtly different `dy` sign conventions (some `to.y - from.y`, others `from.y - to.y`). The inconsistency is an active footgun for flipY space.
**Fix:** Extract a single documented `pdfBearingDeg(from, to)` and import it everywhere, settling the sign convention once.

### INF-05: Duplicated `selectRouteCableOps` across three modules

**File:** `parser/geo/cable-arc-placer.js:122-136`, `parser/geo/cable-boundary-calibrator.js:112-126`, `parser/post-positioning.js:728-742`
**Issue:** Three near-identical copies of "pick best cable ops near a reference point" with the same `score = hit.t - hit.d * 2` heuristic and 80-pt near thresholds. Divergence risk.
**Fix:** Hoist to `cable-builder.js` as one exported helper with the threshold as a parameter.

### INF-06: Duplicated `postPdfPos` / `pdfPos` / `anchorOf` accessor with inconsistent anchor handling

**File:** `parser/geo/utm-calibrator.js:517-519`; `parser/geo/cable-boundary-calibrator.js:27-29`; `parser/distance-associator.js:61-64`; `parser/post-positioning.js:103-108`
**Issue:** The "anchorX ?? x" accessor is reimplemented many times; `postPdfPos` in utm-calibrator ignores anchorX entirely (`return { x: post.x, y: post.y }`) while others prefer the anchor — an inconsistency that can shift which coordinate a calculation uses.
**Fix:** Single shared `anchorOf(post)` helper; confirm the utm-calibrator variant that drops anchor is intentional.

### INF-07: Magic literal `303.6 / 1191` repeated as overview→detail scale ratio

**File:** `parser/distance-associator.js:104`, `:248`, `:592`, `:736`, `:855`
**Issue:** The detail-scale fallback `overviewSf * (303.6 / 1191)` appears verbatim five times with no named constant or explanation of where 303.6 and 1191 originate.
**Fix:** Extract `const OVERVIEW_TO_DETAIL_SCALE = 303.6 / 1191;` with a comment citing its derivation.

### INF-08: Dead/superseded exports kept in the build surface

**File:** `parser/coordinate-calculator.js:653` (`snapPostsToPolyline` — "Legacy: not used"), `parser/geo/utm-calibrator.js:532` (`adjustPageOriginsAtBoundaries`), `parser/geo/cable-boundary-calibrator.js:320` (`adjustPageOriginsByCableContinuity`), `parser/dwg/region-pairing.js:46` (`buildAdjacencyGraph` — graph-walker rebuilds its own)
**Issue:** Several exported functions are explicitly legacy/superseded but remain exported, inviting accidental use of the wrong calibration path.
**Fix:** Remove or mark `@deprecated` with a pointer to the replacement; prune from exports if no caller remains.

### INF-09: `route-sequence.js` `remapBrowserPostsToParserOrder` appears unused

**File:** `parser/geo/route-sequence.js:16-20`
**Issue:** `remapBrowserPostsToParserOrder`/`remapBrowserPostNumber` encode João Born-specific page→number remaps but no reviewed caller invokes them (only `detectSequenceFlipPages`/`flipBearingDeg` are imported). If unused they are dead route-specific code; if used they are CR-02-class hard-coding.
**Fix:** Confirm callers; delete if unused, or generalize per CR-02.

### INF-10: KML `<coordinates>` interpolate lat/lon without numeric enforcement

**File:** `parser/kml-builder.js:191`, `:206`
**Issue:** `${post.lon},${post.lat},0` is interpolated directly into `<coordinates>` (the description is escaped, but the coordinate elements are not). Not exploitable for normal numeric data, but it relies on an unstated invariant that lat/lon are always finite numbers; a `NaN` or upstream string would land raw in the KML.
**Fix:** Format coordinates as fixed-precision numbers (`Number(post.lon).toFixed(7)`) before interpolation to enforce the numeric invariant.

### INF-11: `MAX_PLAUSIBLE_POST = ocrResults.length` is a soft bound that can be inflated by duplicate circles

**File:** `parser/post-assembler.js:517`
**Issue:** The valid-post-number upper bound equals the raw OCR result count. If duplicate circles (fill+stroke pairs) survived the 8-pt proximity dedup in graphics-extractor, the bound inflates and an implausible OCR misread could pass the `<= MAX_PLAUSIBLE_POST` gate. The comment asserts exactly one centroid per post, which the proximity dedup does not strictly guarantee.
**Fix:** Derive the bound from a more robust count or document it as a soft bound.

### INF-12: `solveLinear` accepts near-singular systems with only a pivot-magnitude guard

**File:** `parser/geo/grid-affine-calibrator.js:95-120`
**Issue:** Gaussian elimination returns `null` only when a pivot magnitude `< 1e-12`. A nearly-singular system can still yield wild affine coefficients; the only downstream guards are `MAX_RMSE_PER_POINT_M = 2` and `Number.isFinite`. Borderline-degenerate grids with few intersections could pass with a poor fit.
**Fix:** Add a condition-number or residual sanity check, or require more than `MIN_INTERSECTIONS = 4` control points.

### INF-13: Stale / contradictory comments

**File:** `parser/ocr-extractor.js:3` ("2× scale" vs `SCALE = 6`); `parser/coordinate-calculator.js:566` ("28-29 skip removed in attempt 13"); `parser/post-positioning.js:59` ("~7 m at typical scale" for `VITERBI_SIGMA_PT = 20`); numerous `// Siriu 57→58`, `// João Born 25→26` route-anecdote comments in graph-walker
**Issue:** Comments document debugging history and route-specific anecdotes rather than current invariants, and at least one (`2×`) directly contradicts the code.
**Fix:** Replace debugging-narrative comments with current-invariant statements; correct the `2×`/`SCALE=6` contradiction.

---

_Reviewed: 2026-05-30_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
