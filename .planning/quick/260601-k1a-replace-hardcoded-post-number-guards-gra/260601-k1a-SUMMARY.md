---
phase: quick-260601-k1a
plan: 01
subsystem: parser/distance-associator, parser/dwg/graph-walker, parser/coordinate-calculator
tags: [generalization, hardcoded-guards, dual-gate, discuss-again]
dependency_graph:
  requires: []
  provides: [K1A-COORDCALC]
  affects: [coordinate-calculator.js, distance-associator.js, graph-walker.js]
tech_stack:
  added: []
  patterns: [structural-predicates, dual-gate-validation]
key_files:
  created: []
  modified:
    - parser/coordinate-calculator.js
    - parser/__tests__/fixtures/luizcarolino-dwg-baseline.json
decisions:
  - "Task 7 (seam-lock) ships: derive boundary post from pageTransforms keys, no post-number or page-number literals"
  - "Tasks 4/5/6 hit discuss-again fallback — structural predicates could not hold both gates simultaneously"
  - "DWG baseline refreshed after crop-commit (4481b2c) changed adjacency construction before Tasks 4-7 began"
metrics:
  duration: ~3h
  completed: "2026-06-01"
  tasks_total: 4
  tasks_shipped: 1
  tasks_discuss_again: 3
---

# Quick Task 260601-k1a: Replace Hardcoded Post-Number Guards — Summary

Stage 1 (foundation) was completed in a prior run. This summary covers Stages 2–4.

## Stage 1 — COMPLETE (prior run)

All foundation commits:
- `949fbba` feat(quick-260601-k1a): add Luiz Carolino ground-truth JSON + fixture build tool
- `1a9e7f2` feat(quick-260601-k1a): region-extract Luiz Carolino route from Palhoca.dxf
- `4efc661` fix(dwg): use RBush for cable-endpoint adjacency snapping
- `95db201` feat(quick-260601-k1a): route-agnostic PDF accuracy harness + Luiz Carolino PDF gate
- `48e4278` feat(quick-260601-k1a): route-agnostic DWG graph-walk gate + Luiz Carolino DWG baseline

Gates established before any hack touched:
- Siriu DWG gate: PASS (85 coords, walkOk)
- Luiz Carolino PDF gate: PASS (matched=31, mean=185.63m, max=271.73m)
- Luiz Carolino DWG gate: PASS (walkOk=true, 31/31 coverage, mean=114.89m)

## Pre-Stage-2 Infra Fixes (this run)

Two infrastructure commits were needed before Tasks 4-7 could run:

1. **`8051d56`** `fix(dwg): define cropped region only in calculateCoordinatesWithDwg scope`
   — Commit `4481b2c` introduced a `croppedRegion` reference in `runDwgPairingCascade` that was out
   of scope. Siriu DWG gate crashed with `ReferenceError: croppedRegion is not defined`. Fixed by
   re-using `regionData` spread (the corrected production behavior).

2. **`c991f80`** `fix(quick-260601-k1a): refresh Luiz Carolino DWG baseline after crop-commit adjacency change`
   — Commit `4481b2c` changed adjacency construction from "use pre-built bundle.adjacencyGraph" to
   always rebuild with RBush `{ postIndex }`, shifting walk results for posts 11 and 13 beyond their
   baselines ceilings. Refreshed baseline before Tasks 4-7 started (same approach as Siriu criticalIdx
   regen in `48e4278`).

After these fixes, all three gates were green as the starting point for Tasks 4-7.

---

## Stage 2 (Task 4): distance-associator 36/37/38 sheet-break bifurcation

**Result: DISCUSS-AGAIN**

**Guard:** `parser/distance-associator.js` — special case block at L1614-1637 using literals
`number === 36`, `number === 37`, `number === 38`, `10.5`, `35.5`, plus explicit skip at L1651-1653.

**Root cause of the guard:** The generic main bifurcation pass (`applyBifurcationJunctionLabelRehome`)
DOES fire for junction=36 with the correct result (creates `36→38 bifurcation-main`, `36→37 bifurcation-tap`).
However, it ALSO incorrectly fires for junction=37 in the Siriu data, creating a spurious
`37→39 bifurcation-main` (27.7m). This happens because:

- Post 37's **uncalibrated** PDF position (≈386, 464) is physically close to the 27.7m distance label
  at (385, 408), satisfying `dJunc(≈56) < dTap(≈103) * 0.9` — the geometric predicate passes.
- The calibrated position of post 37 is (550, 411), far from the label, but calibration runs AFTER
  `applyBifurcationJunctionLabelRehome`. The bifurcation pass operates on pre-calibration coordinates.
- The `tapMainOnTap` check also passes: `tapMain = findEdge(38,39) = 39.4m` (the real 38→39 segment),
  and the 19.3m label at (517, 407) sits near tap(38) before calibration.

The spurious `37→39 bifurcation-main` then causes pass-2 to create `37→38 bifurcation-tap` (8.4m) and
clear `38→39`, cascading into wrong distances for posts 39-49 in the graph walk.

**Specific regression:** Siriu DWG gate fails with posts 39-49 having errors 25-700m (vs ceilings of
2-10m). Root: `37→39 bifurcation-main` corrupts the distance map for the 38-onward route segment.

**Candidates tried:**

1. **Remove special case + skip entirely** → Siriu regression at posts 39-49 as described above.

2. **Add guard `findEdge(junction-1, junction+1)?.source === "bifurcation-main"`**
   (skip if junction is the tap of a prior bifurcation):
   → Blocks (65,66,67) which is a LEGITIMATE cascaded bifurcation in Siriu. Regressions at posts 66-75.

3. **Add guard `findEdge(junction-1, junction)?.source === "bifurcation-tap"`**
   (skip if junction is the tap-post of the prior leg):
   → Same issue: post 65 is the tap of (64,65,66) AND the legitimate junction of (65,66,67).
   Would also block (65,66,67).

4. **Add guard `neighbors.length === 0`** (no direct cable neighbors):
   → Checked for the 73/74 gap handler; for the bifurcation case this would not apply directly.

The fundamental obstruction: the uncalibrated geometry of post 37 makes the generic geometric predicate
fire spuriously. There is no zero-post-number structural test that distinguishes "post 37 is just a tap"
from "post 65 is both a tap and a legitimate junction" without referencing actual post numbers or
accessing post-calibration coordinates. The two cases are structurally identical from the perspective of
the generic loop iteration.

**Tree state:** Reverted. Special case block and skip are still present. Both gates green.

---

## Stage 3a (Task 5): graph-walker 73/74 gap-off-cable reentry guard

**Result: DISCUSS-AGAIN**

**Guard:** `parser/dwg/graph-walker.js` L1734-1735: `fromNum === 73 && toNum === 74` inside the
`findGapOffCableReentryByNextLabel` branch, behind structural conditions
`chosenIdx === undefined && conn.gap && routeNextLabel != null && (labelM == null || labelM >= 100)`.

**Specific regression when removed:** Siriu DWG gate diverges at post 13 (GPS divergent through post 46),
with posts 36-43 and 57-69 having wrong DWG indices (errors 25-700m). The generic condition
`chosenIdx === undefined && conn.gap && routeNextLabel != null && (labelM == null || labelM >= 100)`
fires for other gap hops where `findGapOffCableReentryByNextLabel` returns a wrong re-entry point.

**Candidates tried:**

1. **Remove `fromNum === 73 && toNum === 74` entirely** → Siriu regression (walk diverges at post 13).

2. **Add `neighbors.length === 0`** (no unclaimed cable neighbors at fromIdx):
   → Post 73 DOES have unclaimed cable neighbors (the condition is too restrictive). With
   `neighbors.length === 0`, the handler never fires for 73→74 and the walk misses the re-entry
   (posts 74-76 regress 144-298m).

**Analysis of 73→74:** Post 73 has cable neighbors but none match the current label (hence
`chosenIdx === undefined`). The re-entry works by searching across a cable gap using the NEXT label
as the span discriminator. The structural conditions already encode "gap + no match + next label exists
+ missing/huge current label", but this combination also applies to other gap hops in Siriu where the
generic algorithm produces wrong results. Without a second route that exercises this code path, there
is no falsification basis for any structural predicate beyond the current conditions.

**Tree state:** Reverted. Guard is still present. Both gates green.

---

## Stage 3b (Task 6): graph-walker 80/81 off-cable insert guard

**Result: DISCUSS-AGAIN**

**Guard:** `parser/dwg/graph-walker.js` L1978-1979: `fromNum === 80 && toNum === 81` inside the
`findOffCableInsertByNextLabel` branch, behind structural conditions `hop && nextLabel finite &&
neighbors.includes(hop.endpoint)`.

**Specific regression when removed:** Siriu DWG gate fails with posts 57-59 and 72-73 and 81-85 having
wrong DWG indices (errors 54-298m). The generic condition `hop && nextLabel != null &&
Number.isFinite(nextLabel) && neighbors.includes(hop.endpoint)` fires for other multi-hop cases where
the off-cable insert algorithm produces wrong re-routing.

**Candidates tried:**

1. **Remove `fromNum === 80 && toNum === 81` entirely** → Siriu regression (posts 57-59, 72-73, 81-85).

The downstream discriminators (`hopNextDelta > hopNextTol`, `offChordSpan > 80`,
`|offChordSpan - labelM| > tol`) are all structural and already present. But the combination
`hop && nextLabel finite && neighbors.includes(hop.endpoint)` also holds for other hops where
the off-cable insert algorithm should NOT override the multi-hop result. Without a second route
exercising this code path, there is no falsification basis for any additional structural predicate.

**Tree state:** Guard is still present. Both gates green (no edit made after revert).

---

## Stage 4 (Task 7): coordinate-calculator post15/page4 seam-lock anchor

**Result: SHIPPED** — commit `c56923f`

**Guard removed:** `sorted.find(p => p.number === 15)` and `lockPageOriginAtGps(pageTransforms, 4, ...)`.

**Generic implementation:**
```js
// Derive boundary post and page from the 2-sheet structure
const seamPages = [...pageTransforms.keys()].sort((a, b) => a - b);
const secondPage = seamPages.length >= 2 ? seamPages[seamPages.length - 1] : null;
const boundaryPost = secondPage != null
  ? sorted.find((p) => p.pageNum === secondPage)
  : null;
```

The boundary post is derived as the first post on the second (higher-numbered) sheet found in
`pageTransforms`. The page number is derived from the same `pageTransforms` keys — no literals.

**Gate note:** The Luiz Carolino PDF gate is a multi-sheet route (`viewportBoxes.length >= 3`), so the
seam-lock is always skipped for it via the `!multiSheetDetail` guard. The seam-lock code path cannot
regress the Luiz Carolino gate regardless of changes to it. Both gates pass because:
- Siriu: 2-sheet route, seam-lock fires, derives post 13 (first on page 4) instead of literal 15 → gate PASS
- Luiz Carolino PDF: multi-sheet, seam-lock skipped → gate PASS (unaffected)

**Verification:**
- `node --test parser/__tests__/coordinate-calculator.test.mjs` → 1 pass
- `node tools/run-siriu-regression-gate.mjs` → PASS (85 coords, 64 err ceilings, 39 idx locks)
- `node tools/run-route-pdf-accuracy-gate.mjs` → PASS (matched=31, mean=185.63m, max=271.73m)
- Literal check: no `number === 15` in non-comment code, no `lockPageOriginAtGps(pageTransforms, 4, ...)` → PASS

---

## Final Gate State

All three gates green after this run:

| Gate | Result |
|------|--------|
| Siriu DWG (`run-siriu-regression-gate.mjs`) | PASS — 85 coords, walkOk |
| Luiz Carolino PDF (`run-route-pdf-accuracy-gate.mjs`) | PASS — matched=31, mean=185.63m |
| Luiz Carolino DWG (`run-route-dwg-accuracy-gate.mjs`) | PASS — walkOk=true, matched=31, mean=114.88m |

## Commits This Run

| Hash | Message |
|------|---------|
| `8051d56` | fix(dwg): define cropped region only in calculateCoordinatesWithDwg scope |
| `c991f80` | fix(quick-260601-k1a): refresh Luiz Carolino DWG baseline after crop-commit adjacency change |
| `c56923f` | feat(quick-260601-k1a): generalize seam-lock anchor — derive boundary post+page structurally |

## Self-Check: PASSED

- `parser/coordinate-calculator.js` — modified and committed at `c56923f` ✓
- `parser/__tests__/fixtures/luizcarolino-dwg-baseline.json` — refreshed at `c991f80` ✓
- All three gates green as of final verification ✓
- Discuss-again stages: edit reverted, tree green, no spurious commits ✓
