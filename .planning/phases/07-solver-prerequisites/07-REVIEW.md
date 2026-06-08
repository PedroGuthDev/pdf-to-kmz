---
phase: 07-solver-prerequisites
reviewed: 2026-06-08T00:00:00Z
depth: standard
files_reviewed: 23
files_reviewed_list:
  - package.json
  - parser/__tests__/branch-traversal-joaoborn.test.mjs
  - parser/__tests__/branch-traversal-lc.test.mjs
  - parser/__tests__/branch-traversal-valmor.test.mjs
  - parser/__tests__/fixtures/joaoborn-ground-truth.json
  - parser/__tests__/fixtures/joaoborn-junction-ground-truth.json
  - parser/__tests__/fixtures/joaoborn-post-positions-truth.json
  - parser/__tests__/fixtures/luizcarolino-junction-ground-truth.json
  - parser/__tests__/fixtures/luizcarolino-post-positions-truth.json
  - parser/__tests__/fixtures/valmor-junction-ground-truth.json
  - parser/__tests__/fixtures/valmor-post-positions-truth.json
  - parser/__tests__/post-positioning.test.mjs
  - parser/post-positioning.js
  - tools/import-ground-truth-txt.mjs
  - tools/lib/accuracy-tiers.mjs
  - tools/lib/txt-accuracy-gate-runner.mjs
  - tools/route-dwg-accuracy-harness.mjs
  - tools/run-joaoborn-post-position-gate.mjs
  - tools/run-joaoborn-txt-accuracy-gate.mjs
  - tools/run-lc-txt-accuracy-gate.mjs
  - tools/run-siriu-txt-accuracy-gate.mjs
  - tools/run-valmor-post-position-gate.mjs
  - tools/run-valmor-txt-accuracy-gate.mjs
findings:
  critical: 1
  warning: 7
  info: 5
  total: 13
status: issues_found
---

# Phase 7: Code Review Report

**Reviewed:** 2026-06-08
**Depth:** standard
**Files Reviewed:** 23
**Status:** issues_found

## Summary

Phase 7 ships per-route accuracy/position gates (Siriu, LC, João Born, Valmor), a
junction ground-truth oracle suite, and the `post-positioning.js` pole-assignment
pipeline (greedy + Viterbi-HMM + collapse-restore). The gate scaffolding is well
structured and the collapse-restore predicate is carefully guarded. However the
review surfaced one correctness blocker (a duplicate-symbol repair path with no
used-symbol guard that can place two posts on the same pole), several
robustness/validation gaps in the gate runners and `import-ground-truth-txt.mjs`,
and meaningful test-quality weaknesses: the central unit test
`post-positioning.test.mjs` is not wired into any `npm` script (and history records
it as having pre-existing failures), and the junction fixtures pin all distances to
`0.0`, making the "arm meters" assertions vacuous.

## Critical Issues

### CR-01: `repairConsecutiveLabelArcJumps` can assign two posts to the same pole symbol

**File:** `parser/post-positioning.js:1166-1191`
**Issue:** The nearest-symbol search loops over every symbol on the page without
skipping ones already taken (`usedSymbol`) or already chosen for another post in
the same repair pass:

```js
for (let si = 0; si < symbols.length; si++) {
  const sym = symbols[si];
  const d = Math.hypot(sym.x - pt.x, sym.y - pt.y);
  if (d < bestD) { bestD = d; bestSi = si; }   // no usedSymbol.has(si) skip
}
```

The function then does `usedSymbol.add(bestSi)` AFTER selection, so a previously
assigned symbol can still be re-selected here, and two different posts whose
label-implied arc target resolves to the same nearest pole both snap to it. This
is exactly the "shared-symbol collapse" failure mode the rest of the module works
hard to avoid (`siSeen`/`symbolConflict` guard at lines 1940-1954, the dedicated
`restoreSharedSymbolCollapsedPosts` pass). The same pattern recurs in
`repairPagesLabelArcFromPositions` (lines 1597-1617) where the per-post nearest
search also ignores `usedSymbol`. Two collinear posts whose Viterbi assignment was
correct can be corrupted by this repair pass on a page with a missing/duplicated
pole.
**Fix:** Skip already-claimed symbols and track picks within the pass:
```js
for (let si = 0; si < symbols.length; si++) {
  if (si !== prevSi && usedSymbol.has(si)) continue;   // don't steal another post's pole
  const sym = symbols[si];
  const d = Math.hypot(sym.x - pt.x, sym.y - pt.y);
  if (d < bestD) { bestD = d; bestSi = si; }
}
```
and only commit the move when `bestSi` is genuinely free (or equals the post's own
prior `si`), mirroring the `siSeen` conflict guard used for the Viterbi result.

## Warnings

### WR-01: `post-positioning.test.mjs` is orphaned — not run by any npm script

**File:** `package.json:11-13`, `parser/__tests__/post-positioning.test.mjs`
**Issue:** The only unit test that directly exercises `post-positioning.js`
(greedy assignment, Viterbi, `restoreSharedSymbolCollapsedPosts`, route ordering)
is not referenced by `test`, `test:unit`, or `test:gate`. Project history
(`.planning/.../260530-bif-SUMMARY.md`) records "3 pre-existing failures in
post-positioning.test.mjs". An un-wired test with known failures gives false
confidence: CI is green while the collapse-restore / Viterbi logic this phase
depends on is unverified by the regular suite. CR-01 above would not be caught by
the current gate set.
**Fix:** Add `node parser/__tests__/post-positioning.test.mjs` to the `test:gate`
(or `test:unit`) script and resolve the 3 failing assertions, or explicitly delete
the test if obsolete. Do not ship a phase whose core module's unit test is dark.

### WR-02: Junction-fixture meters are all `0.0`, making arm-meters assertions vacuous

**File:** `parser/__tests__/fixtures/luizcarolino-junction-ground-truth.json:12-16,22-51`
(and the João Born / Valmor fixtures)
**Issue:** Every `edges[].meters` and `arms[].meters` is `0.0`, and no junction
declares `armMetersChecks`. The test at
`branch-traversal-lc.test.mjs:102-112` asserts
`got.meters === arm.meters` — i.e. `0 === 0` — for all arms, and the
`armMetersChecks` loop (lines 165-181) is skipped entirely. These "meters
mismatch" assertions therefore can never fail on a real distance regression; they
only confirm `0 === 0`. The oracle verifies topology but provides zero protection
on arm distances despite asserting them.
**Fix:** Populate real arm/edge meters from the DWG ground truth and add
`armMetersChecks` for the LC post-7 junction (arms ->8, ->21), or drop the meters
assertions and document that distances are out of scope so the coverage gap is
explicit rather than disguised as a passing check.

### WR-03: `parseTxtLines` silently drops integer-degree coordinates

**File:** `tools/import-ground-truth-txt.mjs:64`
**Issue:** The regex requires a decimal point in both lat and lon
(`(-?\d+\.\d+)`). A correctly-formatted line whose coordinate happens to be an
integer (e.g. `-48`) or uses no fractional part is silently skipped with no
warning. Because non-matching lines `continue` without logging, a malformed or
unusual GPS line is dropped invisibly and the fixture is written with fewer posts
than the source file — the gate then measures a silently truncated route. There is
no post-parse count/contiguity check against the source.
**Fix:** Relax to `(-?\d+(?:\.\d+)?)`, and after parsing, warn when the parsed
count is less than the number of non-blank `Poste`-prefixed lines so dropped lines
are visible.

### WR-04: Outlier median uses component-wise lat/lon median, biasing the cluster center

**File:** `tools/import-ground-truth-txt.mjs:73-74`
**Issue:** The "route cluster median" is computed as the median of latitudes and
the median of longitudes independently, then haversine distance is measured to that
synthetic `(medianLat, medianLon)` point. For an L-shaped or curved route the
component-wise median is not a point on the route and can sit well off it, inflating
distances for legitimate posts at the route extremities. With the 2.0 km default
this is unlikely to drop a real post, but a tightened `--outlier-km` (the tool
explicitly supports it) could exclude valid endpoints. The comment claims it
removes a post "37 km off" — that case survives any reasonable center, masking the
center-quality issue.
**Fix:** Use a geometric/medoid center (the actual post minimizing summed haversine
distance to others), or document that `--outlier-km` must stay coarse because the
center is a component-wise median, not a route point.

### WR-05: Gate runners trust env-var overrides without validation

**File:** `tools/run-joaoborn-post-position-gate.mjs:110-112`,
`tools/run-valmor-post-position-gate.mjs:130-132`
**Issue:** `Number(process.env.JOAOBORN_POST_POS_TOL_PT)` / `VALMOR_...` is used
directly as the tolerance. A typo or non-numeric value yields `NaN`; every
`err > NaN` comparison is `false`, so the gate PASSES every post regardless of
error — a silent gate bypass via a mistyped env var. The same unguarded `Number(env)`
pattern appears for `JOAOBORN_POST_POS_TOL_PT`/`VALMOR_POST_POS_TOL_PT`.
**Fix:** Validate: `const raw = Number(process.env...); const tolPt = Number.isFinite(raw) && raw > 0 ? raw : (truthDoc._meta?.tolerancePt ?? DEFAULT_TOL_PT);`
and warn when the override is present but invalid.

### WR-06: `runRouteDwgAccuracyHarness` mutates shared `process.env` across concurrent gate runs

**File:** `tools/route-dwg-accuracy-harness.mjs:155-173`
**Issue:** `runWalk` sets `process.env.GW_RETURN_IDX = "1"` then restores it. It is
synchronous around the `pairPostsByGraphWalk` call so within one harness it is
sound, but `process.env` is process-global mutable state used as a control channel.
If gates are ever parallelized (or if `pairPostsByGraphWalk` becomes async and
yields), the save/restore race can leak `GW_RETURN_IDX` into unrelated code. Using
env vars to toggle return shape is fragile coupling.
**Fix:** Pass `returnIdx: true` as an explicit option to `pairPostsByGraphWalk`
rather than via `process.env`, eliminating the global mutation.

### WR-07: `assignPolesGloballyByLabels` mutates input post `.number` during mirroring

**File:** `parser/post-positioning.js:1693`, `correctRouteNumberingByDistanceLabels:1516-1518`
**Issue:** `correctRouteNumberingByDistanceLabels` rewrites `p.number = minN + maxN - p.number`
on the caller's post objects before assignment. This is an in-place mutation of an
identity field (the post number) on input that the caller still holds a reference
to. If the mirror decision is wrong (the function itself documents fragile
fragmented-cable cases at lines 1492-1511), every downstream consumer now sees
corrupted post numbers with no way to recover the original. The mutation also makes
the function non-idempotent — calling it twice flips numbers back.
**Fix:** Compute the corrected numbering into a side map / new field
(`p.correctedNumber`) and let the caller opt in, or at minimum snapshot original
numbers and emit them in the warning so the mutation is auditable and reversible.

## Info

### IN-01: Three near-identical junction test files (LC/JB/Valmor) duplicate ~50 lines of `buildGraph`

**File:** `parser/__tests__/branch-traversal-lc.test.mjs:20-50`,
`branch-traversal-joaoborn.test.mjs:20-50`, `branch-traversal-valmor.test.mjs:20-50`
**Issue:** `buildGraph` and all five `test(...)` bodies are copy-pasted verbatim
across the three route files (only the fixture path differs). A fix to the oracle
logic must be made in three places and can drift.
**Fix:** Extract a shared `runJunctionOracle(fixturePath)` helper and have each
route file call it with its fixture, keeping per-route fixtures separate.

### IN-02: Valmor junction fixture is a DRAFT pending user approval but feeds a passing gate

**File:** `parser/__tests__/fixtures/valmor-junction-ground-truth.json:2-5`
**Issue:** `_draftStatus: "PENDING USER APPROVAL"` with `junctions: {}`. The oracle
tests pass trivially (empty junction map → no-op loops). A green test against an
unconfirmed linear assumption can be mistaken for verified topology, especially
contrasted with LC's `_authoritative: "LOCKED"`.
**Fix:** Have the test print/skip with an explicit "DRAFT — topology unconfirmed"
notice for fixtures whose `_draftStatus` is pending, so the trivial pass is not
read as confirmation.

### IN-03: `topKRoutePoleCandidates` leaks internal `_sort` field into intermediate objects

**File:** `parser/post-positioning.js:1037-1053`
**Issue:** The `raw` candidate objects carry an internal `_sort` key used only for
ordering; it is stripped by the final `.map(({ si, t, x, y, dLabel }) => ...)`, so
no leak escapes — but the mixed shape (sometimes with `_sort`, sometimes without)
is easy to misuse if the early-return recursion path (line 1048) is edited.
**Fix:** Sort with a derived comparator array or a `WeakMap` of scores instead of
mutating the candidate shape, or document the strip explicitly.

### IN-04: `runRouteDwgAccuracyHarness` documents a return type that omits actual returned keys

**File:** `tools/route-dwg-accuracy-harness.mjs:73-81,193-202`
**Issue:** The JSDoc `@returns` lists `dwgStatus, walkOk, walkCoords, errorsByPost,
idxByPost, gpsFirstDivergentPost` but the implementation also returns `posts` and
`dwgConfidence` (lines 195-196). Stale doc invites callers to miss available
fields.
**Fix:** Add `posts` and `dwgConfidence` to the `@returns` typedef.

### IN-05: `medianLabeledEdgeMeters` returns a magic fallback of `40` with no named constant

**File:** `parser/post-positioning.js:941`
**Issue:** `if (!edges.length) return 40;` — the 40 m default span has no named
constant or comment explaining the choice, unlike the many documented `*_PT`
constants at the top of the file.
**Fix:** Promote to a named constant (e.g. `DEFAULT_EDGE_SPAN_M = 40`) with a
one-line rationale.

---

_Reviewed: 2026-06-08_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
