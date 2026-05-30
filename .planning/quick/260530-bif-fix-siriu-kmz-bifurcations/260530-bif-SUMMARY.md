---
quick_id: 260530-bif
slug: fix-siriu-kmz-bifurcations
status: complete
completed: 2026-05-30
commits:
  - 6b25aea feat(bif): propagate source onto connections in finalizeBifurcationConnections
  - 4e8ac0c fix(bif): preferMainRouteEdge uses source tags + structural fallback
  - ea168fa fix(bif): branchStarts flags tap target, not main jump target
  - 00ceb59 test(bif): add kml-builder unit cases for non-continuing junction
  - bcad547 test(bif): add Siriu integration test for junctions 14/36/64
files-modified:
  - parser/coordinate-calculator.js
  - parser/kml-builder.js
files-created:
  - (tests added to) parser/__tests__/kml-builder.test.mjs
  - (tests added to) parser/__tests__/bifurcation-connections.test.mjs
---

# Quick Task 260530-bif: Fix Siriu KMZ bifurcation junctions 14, 36, 64 — Summary

Source-driven main/tap selection at KMZ bifurcations: `coordinate-calculator.js` now
propagates each edge's `source` onto connection objects, and `kml-builder.js` uses
`bifurcation-main`/`inferred-label` tags (with a structural fallback) to pick the true
through-route, fixing the three Siriu junctions where the main edge was wrongly demoted
to a 2-point stub and the tap spur was merged into the trunk.

## What was wrong

At Siriu junctions 14, 36, 64 the main jump target (18/38/66) is itself a bifurcation
whose next edge is `jumpback-suppressed` (`18→19`, `38→39`, `66→67` do not exist).
`preferMainRouteEdge`'s `hi→hi+1` continuation heuristic therefore failed and fell back
to the consecutive tap edge as "main", producing three defects: tap merged into trunk,
true main demoted to an isolated 2-point polyline (`14,18` / `36,38` / `64,66`), and
downstream spur posts drawn but disconnected. The `source` classification that
`coordinate-calculator.js` already computes was discarded when connections were built.

## Changes

### Part A — source propagation (`parser/coordinate-calculator.js`)
- Added an optional `source` parameter to `makeConn` inside
  `finalizeBifurcationConnections`; it is emitted additively (`...(source ? { source } : {})`)
  after `gap: false`, so existing fields are untouched.
- Branch-return rejoin main is tagged `"inferred-label"`; the `bifurcation-main` loop
  edges are tagged with `d.source` (`"bifurcation-main"`).
- `walkConnections` snapshot (line 2198) is taken BEFORE this function runs, so the DWG
  walk is unaffected (verified).

### Part A + B — main-edge selection (`parser/kml-builder.js`)
- `preferMainRouteEdge`: a candidate tagged `source === "bifurcation-main"` or
  `"inferred-label"` is returned as main immediately, before the continuation heuristic
  (Part A, primary fix).
- `preferMainRouteEdge`: for source-less inputs, when no jump has a `hi→hi+1`
  continuation, a non-continuing jump **whose target has outgoing edges** is preferred
  over the consecutive tap (Part B, fallback). A jump to a bare leaf stays a spur.
- `branchStarts` in `buildKml`: when a junction out-edge carries
  `bifurcation-main`/`inferred-label`, every OTHER target (the taps) is flagged as a
  branch start and the tagged main is never flagged. Source-less junctions keep legacy
  behavior so the 7 working junctions are unchanged.

### Tests
- `kml-builder.test.mjs`: 4 new `buildRoutePolylines` cases — junction 64 (source-tagged),
  junction 14 (inferred-label), Part B (source-less non-continuing jump with outgoing
  edges), and a guard that a source-less jump to a bare leaf stays a spur.
- `bifurcation-connections.test.mjs`: 1 new full-fixture Siriu integration test asserting
  `14→18`/`36→38`/`64→66` are tagged main, the trunk passes through 18/38/66 (no 2-pt
  stubs), taps `14→15→16→17`/`36→37`/`64→65` are separate polylines, the trunk does not
  swallow the 15/16/17 tap, and junctions 5/48 are unchanged.

## Result (full Siriu fixture, after fix)

Junction-level polylines are now correct:
- `14,15,16,17` is a separate tap spur (was merged into trunk).
- Main trunk passes through `…,14,18`, `…,36,38`, `…,64,66` (was 2-pt stubs).
- Tap spurs `36,37` and `64,65` are separate polylines.

## Deviations from Plan

### [Rule 1 — Bug] Part B refined to gate on the jump target having outgoing edges
- **Found during:** Task 4.
- **Issue:** The plan's literal Part B ("prefer the jump over a coexisting consecutive tap
  whenever no jump continues sequentially") broke the existing unit test
  `splits at bifurcation into main run and branch`, which asserts the consecutive
  through-route wins when the jump (`2→4`) goes to a bare leaf — a genuine spur, not a
  bifurcation rejoin.
- **Fix:** Part B now prefers the non-continuing jump only when its target has outgoing
  edges (`outMap.get(jump.to)?.length > 0`), which is the real distinguishing signal in
  Siriu (`66` has `66→…`, a leaf `4` does not). This matches the orchestrator-context
  specification of Part B and preserves the existing leaf-spur test.
- **Files modified:** `parser/kml-builder.js`.
- **Commit:** 4e8ac0c.

## Out of Scope / Known Limitations

- **Downstream spurs `67–73` and `74–85` remain separate polylines.** Their connecting
  edges (`66→67`, `73→74`) are `jumpback-suppressed` and do not exist in the data, so the
  chainer cannot join them to the trunk. Restoring those edges would require changing the
  suppression logic in `coordinate-calculator.js`, which is explicitly out of scope
  (`wont_haves`: no changes to coordinate calculation / DWG walk). The brief's core defect
  (tap-merge + main demotion) is fully fixed.
- **3 pre-existing failures in `post-positioning.test.mjs`** (Viterbi/Valmor symbol
  assignment) are unrelated to this task — that file imports neither `coordinate-calculator`
  nor `kml-builder`, and the failures stem from uncommitted OCR/positioning work in the
  working tree. Logged in `deferred-items.md`; not fixed (scope boundary).

## Verification

- `node --test parser/__tests__/kml-builder.test.mjs` — 13/13 pass (9 routePolylines + 4 buildKml... existing + new).
- `node --test parser/__tests__/bifurcation-connections.test.mjs` — 2/2 pass.
- `node --test parser/__tests__/coordinate-calculator.test.mjs` — 22/22 pass.
- `npm run test:gate` — exit 0, `PASS — dwgStatus=dwg-graph-walk, walkOk=true, coords=85`.
- The 7 already-correct junctions (5, 11, 23, 32, 41, 48, 57) produce identical spurs.

## Self-Check: PASSED

- Commits 6b25aea, 4e8ac0c, ea168fa, 00ceb59, bcad547 all present in `git log`.
- `parser/coordinate-calculator.js` and `parser/kml-builder.js` modified as described.
- New tests present and green in both test files.
