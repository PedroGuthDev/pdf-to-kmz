---
quick_id: 260530-bif
slug: fix-siriu-kmz-bifurcations
goal: Fix KMZ cable route polylines at Siriu bifurcation junctions 14, 36, 64 so all 10 junctions draw correctly
must_haves:
  - preferMainRouteEdge correctly picks main edge at junctions 14/36/64
  - tap spur starts a separate polyline, not merged into the trunk
  - main edge at 14/36/64 is not demoted to an isolated 2-pt polyline
  - source propagation from coordinate-calculator.js to connections
  - new tests for non-continuing jump case (junctions 14/36/64)
  - existing 10 tests still pass
  - siriu-walk-regression gate still passes (npm run test:gate)
wont_haves:
  - changes to GPS/UTM coordinate calculation
  - changes to DWG walk or graph-walker.js
  - changes to other PDF parsers
---

# Quick Task: Fix Siriu KMZ bifurcation junctions 14, 36, 64

## Context

At a junction with a consecutive tap edge (`J→J+1`) and a main jump edge (`J→hi`),
`preferMainRouteEdge` (parser/kml-builder.js:53-71) only prefers the jump when
`hi` has its own `hi→hi+1` continuation. At junctions 14/36/64 the jump target's
next edge is `jumpback-suppressed`, so `hi→hi+1` is absent and the function wrongly
falls back to the consecutive tap as main. Result: tap merges into trunk, true main
is demoted to a 2-pt stub, downstream spur posts are orphaned.

`coordinate-calculator.js` already knows each edge's `source`
(`bifurcation-main` / `inferred-label` / `bifurcation-tap` / `jumpback-suppressed`)
inside `finalizeBifurcationConnections` (parser/coordinate-calculator.js:938-1036)
but discards it when pushing connection objects. The fix propagates `source` onto
the emitted connection objects and consumes it in `kml-builder.js`.

**Verified safe:** `walkConnections` snapshot (coordinate-calculator.js:2198) is taken
BEFORE `finalizeBifurcationConnections` runs and copies all fields with `{ ...c }`;
adding a `source` field is additive. The 7 already-correct junctions
(5, 11, 23, 32, 41, 48, 57) and the 10 existing tests must produce identical output.

**Reference broken polylines (current, wrong):** trunk `1,2,3,4,5,10,11,13,14,15,16,17`
swallows tap `15-17`; `14,18` / `36,38` / `64,66` demoted to 2-pt stubs; spurs
`67-73` and `74-85` orphaned.

---

## Tasks

### Task 1: Read the source-stamping sites in coordinate-calculator.js
**Files:** `parser/coordinate-calculator.js` (read only)
**Action:** Read `finalizeBifurcationConnections` lines 938-1036, focusing on the
two `makeConn` push sites (the branch-return main at 1000-1006 and the
`bifurcation-main` loop at 1011-1028). Confirm `makeConn` (950-980) returns a plain
object with no `source` field, and that `d.source` is in scope at both push sites.
Identify exactly where to add `source` to each pushed object.
**Verify:** No edit. Note the line numbers of the two push sites and the `makeConn` return literal.
**Done:** You can state which object literals need a `source` field added and the source value each should carry.

### Task 2: Propagate `source` onto connections in coordinate-calculator.js
**Files:** `parser/coordinate-calculator.js`
**Action:** Stamp `source` onto connection objects emitted by `finalizeBifurcationConnections`:
- Add a `source` parameter to `makeConn` (default `undefined`) and include
  `...(source ? { source } : {})` in its returned object literal (after `gap: false`).
- At the branch-return main push (line ~1000-1006), pass the originating distance
  entry's source — use `"inferred-label"` (these come from `findBranchReturns` /
  inferred-label drops) so the rejoin main is tagged.
- At the `bifurcation-main` loop push (line ~1022-1024), pass `d.source` (which is
  `"bifurcation-main"` for that branch).
Do NOT alter `walkConnections` (line 2198) or any meters/bearing/gap computation.
This is purely additive — only a new optional `source` key.
**Verify:** `npm test` passes (coordinate-calculator.test.mjs unaffected).
**Done:** Connection objects for `36→38`, `64→66` carry `source: "bifurcation-main"` and the inferred-label rejoin mains carry `source: "inferred-label"`; all existing fields unchanged.

### Task 3: Read preferMainRouteEdge and branchStarts in kml-builder.js
**Files:** `parser/kml-builder.js` (read only)
**Action:** Re-read `preferMainRouteEdge` (53-71) and the `branchStarts` builder in
`buildKml` (151-164). Confirm `candidates`/`outs` objects flow straight from
`connections`, so a `source` field added in Task 2 is visible on them. Confirm
`branchStarts` is currently built purely from `Math.abs(o.to - e.from) > 1` and adds
the JUMP target `o.to` (line 160) — which is the bug source for branch flagging.
**Verify:** No edit. Confirm `e.source` is reachable inside both functions.
**Done:** You can describe the exact source-aware checks to insert in each function.

### Task 4: Make preferMainRouteEdge source-aware (Part A) + add structural fallback (Part B)
**Files:** `parser/kml-builder.js`
**Action:** In `preferMainRouteEdge`:
- **Part A (primary):** Before the existing `mainCont` heuristic, if any candidate has
  `source === "bifurcation-main"` or `source === "inferred-label"`, return that
  candidate as the main edge.
- **Part B (fallback, for connections lacking `source`):** Keep the existing
  `mainCont` loop. If it finds no continuing jump AND a consecutive tap coexists with
  a non-continuing jump, prefer the jump (sorted ascending, first jump) instead of
  falling through to `consecutive`. This corrects the always-prefer-tap bug for
  source-less inputs (preserves existing tests, which rely on the `mainCont` path).
Keep the final `consecutive` / `nonBranch` fallbacks for the no-jump case.
**Verify:** `node --test parser/__tests__/kml-builder.test.mjs` — all existing cases pass.
**Done:** A junction with a `bifurcation-main`/`inferred-label` jump returns the jump as main; a source-less non-continuing jump also returns the jump, not the tap.

### Task 5: Fix branchStarts to flag the tap target, not the main jump
**Files:** `parser/kml-builder.js`
**Action:** In the `branchStarts` loop (151-164), when a junction has both a
consecutive edge (`o.to === e.from + 1`) and a jump edge, flag the TAP target as the
branch start (so the tap begins a separate polyline) and do NOT flag a jump target
whose connection carries `source === "bifurcation-main"` / `"inferred-label"` (that is
the main trunk continuation). Preserve current behavior for plain non-consecutive
spurs (`Math.abs(o.to - e.from) > 1` with no source) so the 7 working junctions are
unchanged. Read `source` off the connection objects (available after Task 2).
**Verify:** `node --test parser/__tests__/kml-builder.test.mjs` passes.
**Done:** At junctions 14/36/64 the tap target (15/37/65) is in `branchStarts`; the main jump target (18/38/66) is not.

### Task 6: Add kml-builder unit tests for the non-continuing jump case
**Files:** `parser/__tests__/kml-builder.test.mjs`
**Action:** Add `buildRoutePolylines` cases mirroring junctions 14/36/64:
- Source-tagged case: junction with `{from:36,to:37}` (tap) and
  `{from:36,to:38,source:"bifurcation-main"}` (main, no `38→39` continuation).
  Assert the main edge extends the trunk and the tap starts its own polyline (and is NOT
  merged into the trunk; main is NOT a 2-pt stub).
- Source-less fallback case (Part B): same topology without `source`; assert the jump
  is still chosen as main.
- Inferred-label case: `{from:14,to:18,source:"inferred-label"}` vs tap `{from:14,to:15}`.
**Verify:** `node --test parser/__tests__/kml-builder.test.mjs` — new + existing tests pass.
**Done:** New cases fail against pre-Task-4 logic and pass after; all prior cases green.

### Task 7: Add Siriu fixture integration test in bifurcation-connections.test.mjs
**Files:** `parser/__tests__/bifurcation-connections.test.mjs`
**Action:** Add an integration test that runs the Siriu connection pipeline (reuse the
existing fixture/harness already imported in this file) and asserts the resulting
polylines for junctions 14/36/64: the tap spurs (`15-17`, `37`, `65`) are separate
polylines, the main trunk passes through 18/38/66 (not demoted to 2-pt stubs), and the
downstream spurs `67-73` / `74-85` are connected to their junction rather than orphaned.
Match the existing test style in this file; do not introduce a new fixture if one exists.
**Verify:** `node --test parser/__tests__/bifurcation-connections.test.mjs` passes.
**Done:** Test asserts correct polylines at 14/36/64 and fails against pre-fix behavior.

### Task 8: Run full gate and confirm no regressions
**Files:** none (verification only)
**Action:** Run `npm run test:gate` (graph-walker + distance-associator +
coordinate-calculator tests + siriu regression gate) and `node --test parser/__tests__/kml-builder.test.mjs parser/__tests__/bifurcation-connections.test.mjs`.
Confirm the 7 already-correct junctions (5, 11, 23, 32, 41, 48, 57) produce identical
output and the siriu-walk-regression gate still passes all posts.
**Verify:** `npm run test:gate` exits 0; both kml/bifurcation test files green.
**Done:** Gate passes; all 10 junctions render correctly; no regression in the 7 working junctions or the walk gate.
