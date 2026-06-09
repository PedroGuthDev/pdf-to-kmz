---
phase: 09-diagnostic-failure-confidence-surfacing
reviewed: 2026-06-09T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - browser/main.js
  - index.html
  - parser/__tests__/coordinate-calculator-dwg-conf.test.mjs
  - parser/__tests__/kml-builder.test.mjs
  - parser/__tests__/residual-gate.test.mjs
  - parser/dwg/coordinate-calculator-dwg.js
  - parser/dwg/residual-gate.js
  - parser/dwg/tier-styles.js
  - parser/kml-builder.js
  - parser/kmz-defaults.js
findings:
  critical: 1
  warning: 5
  info: 4
  total: 10
status: issues_found
---

# Phase 9: Code Review Report

**Reviewed:** 2026-06-09
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Reviewed the Phase 9 confidence-surfacing implementation: the residual gate, tier styling, KML builder tier emission, the DWG calculator's hard-block/diverged-at-post additions, the browser UI confidence banner, and three test files. The pure modules (`residual-gate.js`, `tier-styles.js`, `kmz-defaults.js`) are well-guarded and correct. The defects cluster in the *data flow between modules*: the browser drops parser fields that a downstream accuracy feature requires, and the KML builder consumes per-post fields (`demotionReason`, `source`) that the residual gate never produces — so the documented D-04 ExtendedData is silently incomplete on the live path. Tests pass because they exercise modules in isolation and never trace the browser → calculator → gate → builder chain end to end.

## Critical Issues

### CR-01: Browser drops `distanceLabelItems` / `posteRawCentroids` from parse result, disabling topology branch-arm rehome

**File:** `browser/main.js:616-623` (read sites `:842`, `:1126`, `:1127`)
**Issue:** `handlePdfFile` builds `currentParseData` from the parse result but copies only six fields:

```js
currentParseData = {
  posts, distances, cableSegments,
  utmGridPathsPerPage, viewportBoxes, pageDimensions,
};
```

`parsePdf` returns `distanceLabelItems` and `posteRawCentroids` (see `parser/pdf-parser.js:840-841`), but they are never stored. Later, the calculate handler reads `currentParseData.distanceLabelItems` (line 842) and the reference-compare handler reads both `distanceLabelItems` and `posteRawCentroids` (lines 1126-1127). Both evaluate to `undefined`.

In `calculateCoordinatesWithDwg`, the topology branch-arm rehome is gated on `Array.isArray(distItems) && distItems.length > 0` (`parser/dwg/coordinate-calculator-dwg.js:411-440`). With `distItems === undefined`, `applyTopologyBranchArmRehome` is **never called** in the browser. This is the exact label-rehome accuracy mechanism the project's MEMORY index records as the landed fix ("junction-from-region-geometry unlock"). The route silently degrades to pre-rehome accuracy in production while every unit test still passes (tests call the calculator/parser directly with their own `distanceLabelItems`).

**Fix:** Persist the fields into `currentParseData`:
```js
currentParseData = {
  posts: result.posts,
  distances: result.distances,
  cableSegments: result.cableSegments,
  utmGridPathsPerPage: result.utmGridPathsPerPage,
  viewportBoxes: result.viewportBoxes,
  pageDimensions: result.pageDimensions,
  distanceLabelItems: result.distanceLabelItems,
  posteRawCentroids: result.posteRawCentroids,
};
```

## Warnings

### WR-01: `demotionReason` and `source` never appear on `postTiers`, so D-04 ExtendedData is incomplete on the live path

**File:** `parser/kml-builder.js:400-407` and `parser/dwg/residual-gate.js:231-236`
**Issue:** `buildKml` emits `<Data name="source">` from `post.source` and `<Data name="demotionReason">` from `tp.demotionReason`. But `applyResidualGate` constructs each tier object with exactly four keys — `{ postNumber, tier, shapeResidualM, anchorGapM }` (residual-gate.js:231-236), and the residual-gate test even *locks* that shape with `assert.deepEqual(Object.keys(t).sort(), ["anchorGapM","postNumber","shapeResidualM","tier"])` (residual-gate.test.mjs:183-186). The calculator sets `successResult.demotionReason` on the *result*, never on each tier entry. In the browser, `buildKml` is called with `postTiers: lastCalcResult.dwgConfidence?.postTiers` (main.js:978), i.e. the gate's bare tier objects. Therefore `tp.demotionReason` is always `undefined` → the `<Data name="demotionReason">` block is never emitted, contradicting the documented D-13 channel. `post.source` survives only because it lives on the post object, not the tier.
**Fix:** Either (a) merge `demotionReason` (and `source`) onto each tier entry where `dwgConfidence` is assembled in `coordinate-calculator-dwg.js` before passing to the UI, or (b) drop the dead `demotionReason` branch from `buildKml` and update the D-04 spec. If the field is intended, also update the residual-gate test's exact-key assertion so it stops enforcing the four-key shape.

### WR-02: `result.error` paths re-enable parsing UI via `finally`, but `missing_layers` / `parse_failed` returns leave the user with no parsed data and a still-disabled download — and the success path never re-runs `setParsingUi` on the early `parse_failed` return

**File:** `browser/main.js:575-599`
**Issue:** The `try/finally` around `parsePdf` calls `setParsingUi(false)` in `finally`, which is correct. However, the `catch` block (line 575-577) returns *before* showing warnings and without distinguishing a genuine throw from a structured error, and the catch does not call `setParsingUi` itself — it relies on `finally`. That part is fine, but note the inconsistency: structured errors (`missing_layers`, `parse_failed`) are returned objects handled *after* `finally`, so the UI is re-enabled, yet `currentParseData` stays `null`. A subsequent click on "Calcular rota" is still possible because `calcBtn` was re-enabled, and is only caught by the `!currentParseData` guard at line 816. This works but couples re-enable timing to a downstream guard. Confirm the guard ordering: line 808-814 runs `validateBrazilBounds` and may show a warning *before* the `!currentParseData` check at 816, so on a failed parse the user sees a bounds warning before the "no posts" message.
**Fix:** Move the `!currentParseData || !currentParseData.posts.length` guard to the top of the `calcBtn` handler, before coordinate parsing/bounds validation, so the "envie um PDF" message is not preceded by an unrelated bounds warning.

### WR-03: `worstGapPost` divergence warning fires on a post that may not be the route's actual worst — uses anchor gap only, ignoring shape residual

**File:** `parser/dwg/coordinate-calculator-dwg.js:519-532`
**Issue:** The `diverged-at-post` warning scans `anchor.perPost` for the max `gapM` and emits when `>= DIVERGED_ANCHOR_FALLBACK_M` (15 m). `DIVERGED_ANCHOR_FALLBACK_M = 15` is a hand-copied mirror of the gate's `ANCHOR_FALLBACK_M` (residual-gate.js:14). These two constants are documented as intentionally decoupled, but they currently hold the same literal `15`. If a maintainer retunes `ANCHOR_FALLBACK_M` (the comment at residual-gate.js:12 shows the band was already moved once to "TRUST<10/FAIL>20"), the mirror silently drifts and the divergence warning threshold no longer matches the LOW tier band, producing posts flagged LOW with no `diverged-at-post` warning (or vice-versa). The comment claims the gate is "the sole authority" yet the warning uses a duplicated magic number.
**Fix:** Import and reference the gate's exported band (or have the gate export a `DIVERGED_BAND_M` constant) so the warning threshold and the LOW band cannot drift. At minimum add a unit test asserting `DIVERGED_ANCHOR_FALLBACK_M === ANCHOR_FALLBACK_M` to fail loudly on drift.

### WR-04: `hardBlock` flag exits are never exercised by a test — only the no-region path is covered

**File:** `parser/__tests__/coordinate-calculator-dwg-conf.test.mjs:45-80` (gap), assertions about `parser/dwg/coordinate-calculator-dwg.js:463`, `:503`
**Issue:** The test suite asserts `hardBlock: true` only for the no-region miss path. The two `hardBlock: false` exits — degraded-match fallback (line 463) and success (line 503) — are documented as "asserted structurally by the source grep in the plan's acceptance," i.e. by grepping source text, not by behavior. A regression that flips `hardBlock` to `true` on the success path (which would suppress all KMZ downloads — see main.js:956-964) would not be caught by any test. Given that `hardBlock === true` hard-blocks the download with no override, this is a high-consequence untested branch.
**Fix:** Add a test that stubs `regionLibrary` to return a matching region with geometry (or inject `_testDeps` into the cascade) and asserts the success/degraded results carry `hardBlock: false`.

### WR-05: `p95` percentile uses biased index and can equal the max element for small arrays, weakening the "p95" semantics

**File:** `parser/dwg/residual-gate.js:82` and `:116`
**Issue:** `rels[Math.floor(rels.length * 0.95)]` and `gaps[Math.floor(gaps.length * 0.95)]`. For `length <= 20` the index `floor(length*0.95)` equals `length-1` (the max) for many sizes (e.g. length 2→index 1, length 3→index 2, length 4→index 3), so "p95" silently becomes "max" on short routes. Since the route gate's hard-fail decision (`anchorFails = p95Gap >= ANCHOR_FAIL_M`, line 179) keys off this value, a single large outlier on a short route fails the entire route — the exact mean-vs-median outlier sensitivity the module's own docstring (lines 26-31) warns against for the shape sub-score, but left uncorrected for the anchor p95. Not a crash, but a correctness/robustness concern for the gate decision on small inputs.
**Fix:** Use a clamped/interpolated percentile, e.g. `gaps[Math.min(gaps.length - 1, Math.ceil(gaps.length * 0.95) - 1)]`, or document that p95 collapses to max below ~20 samples and confirm that is intended for the gate.

## Info

### IN-01: `console.log` debug artifacts shipped in the browser bundle

**File:** `browser/main.js:865`, `:860`, `:1145`
**Issue:** `console.log("[pdf-to-kmz] Generated connections:", connections)` (line 865) runs on every calculation and dumps the full connection array to the production console. Lines 860 and 1145 are `console.error` in catch blocks (acceptable for diagnostics).
**Fix:** Gate the `console.log` behind the existing dev-tools toggle (`devToolsVisible`) or remove it.

### IN-02: `formatDwgWarning` has a stray `@param {unknown} w` JSDoc above the wrong function

**File:** `parser/dwg/coordinate-calculator-dwg.js:44-50`
**Issue:** Line 44 `/** @param {unknown} w */` is immediately followed by a second JSDoc block (lines 45-50) documenting `buildCalcUserWarnings(result)`. The orphan `@param w` comment belongs to `formatDwgWarning` (defined at line 86) and is now detached from it, which will mislead readers and any doc tooling.
**Fix:** Remove the orphan line 44 and add a proper `@param {unknown} w` JSDoc directly above `formatDwgWarning` at line 86.

### IN-03: `refInput` reference coordinates carry leading line-number tokens that the parser tolerates only by accident

**File:** `index.html:873-885` and `browser/main.js:1061`
**Issue:** The textarea default content is `1\tposte 01; -27.6...`, `2\tposte 02; ...` — i.e. each line begins with a tab-prefixed line number from the cat-style paste. `parseReferenceLines` uses `/poste\s+(\d+).*?([-\d.]+)\s*,\s*([-\d.]+)/i`, which happens to skip the leading `1\t` because it anchors on `poste`. This is dev-tools-only, but the leading numbers are confusing seed data and a slightly different paste (e.g. `1; -27...` without `poste`) would be silently dropped.
**Fix:** Strip the line-number prefixes from the seed textarea content, or document that the leading column is ignored.

### IN-04: Tier hex palette duplicated across three modules with no single source of truth

**File:** `parser/dwg/tier-styles.js:22-27`, `parser/kmz-defaults.js:33-38`, `index.html:249-267`
**Issue:** The traffic-light tier colors are declared three times: `TIER_HEX` (tier-styles), `TIER_COLORS` (kmz-defaults, which references PRESET_COLORS), and the CSS `.confidence-banner.tier-*` rules in index.html use yet another set of literal rgba values (`rgba(0,255,0,0.08)`, `#00aa00`, etc.) that approximate but do not exactly match the `#00ff00`/`#ffff00`/`#ffaa00`/`#ff0000` hexes. The CSS green border `#00aa00` differs from the KML `#00ff00`. Cosmetic, but a maintainer changing the tier palette must update three places and will likely miss the CSS.
**Fix:** Document the CSS banner colors as deliberately darker-for-contrast, or derive them from the shared hexes via CSS custom properties to keep the mental model single-sourced.

---

_Reviewed: 2026-06-09_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
