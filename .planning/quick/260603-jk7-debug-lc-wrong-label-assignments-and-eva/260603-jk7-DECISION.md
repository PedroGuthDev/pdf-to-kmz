# 260603-jk7 Decision: LC Wrong Label Assignments — Document Recommendation

**Date:** 2026-06-03
**Chosen option:** `document-recommendation` (no parser code changes)
**Task 1 commit:** 54af8ec (ROOTCAUSE.md)

---

## Chosen Option and Rationale

**Option selected:** Stop at a documented recommendation.

**Why not apply-minimal-fix:**

Of the 7 wrong consecutive edges identified in Task 1, only 2 are heuristic-bugs
(`9→10` and `10→11` — a `refineSequentialWindows` swap). The remaining 5 are
**ambiguous-source** errors where the PDF itself omits or misplaces the correct
label value, and no heuristic change inside `distance-associator.js` can recover
absent information:

| Edge | Classification | Reason not code-fixable |
|------|---------------|------------------------|
| 3→4 | ambiguous-source | `bifurcation-cleared` — cross-page boundary forces bifurcation detection; correct label geometrically ambiguous between chord 2→4 and 3→4 |
| 6→7 | ambiguous-source | PDF omits the ~37.7m label entirely; li=62 (13.8m) is the only geometrically viable label and the greedy correctly assigns it |
| 11→12 | ambiguous-source | `bifurcation-cleared` — same mechanism as 3→4; label 18.7m at page-5 border geometrically nearer chord 10→12 |
| 20→21 | ambiguous-source | `jumpback-refill` — cross-sheet hop; single label (29.8m) exists at the boundary and there is no 381.6m ground-truth label in the PDF for this step |
| 22→23 | ambiguous-source | Cascade of 6→7: li=62 consumed by 6→7 leaves no ~39.4m label available; PDF has no such label |
| 9→10 | **heuristic-bug** | `refineSequentialWindows` swap — post 11 juts geometrically back toward post 9 in PDF coords; refiner sees li=44 (19.6m) closer to chord 10→11 and swaps; greedy had it correct |
| 10→11 | **heuristic-bug** | Same `refineSequentialWindows` swap event (paired with 9→10) |

The contained fix for the 2 heuristic-bug edges (`9→10` / `10→11`) would correct only
those two steps. This does NOT address the dominant deformation in posts 1–20 (which is
driven by the ambiguous-source bifurcation clears at 3→4 and 11→12 and the missing 6→7
label). The LC mean error at baseline is already 185.63m — fixing only 9→10/10→11 would
not materially change this, because the posts-1–20 deformation is dominated by the
bifurcation cascade, not the window-refine swap.

Additionally, `refineSequentialWindows` is the same code family that previously caused
regressions on Siriu (the mid-street ratio guard, which was NOT shipped). Any change to
this function requires verified gate-safety across LC + Siriu + Valmor before landing.

---

## Precise Recommended Fix Shape (for a Future Targeted Task)

**Target function:** `refineSequentialWindows`
**File:** `parser/distance-associator.js`
**Entry point:** L936 (function definition)
**Assignment site:** L1107 (where the swap is written back)

**What signal to add:**

Suppress the window-refine swap for a candidate reassignment when the window's
middle segment (the segment being displaced by the swap, e.g. `9→10`) connects to
a node whose label-graph degree is ≥ 3 (a junction post in the label-graph sense,
computed from `distanceEdges` at the time `refineSequentialWindows` is called).

Concretely: before writing the refined assignment back at L1107, check whether
either endpoint of the displaced-from segment is a junction node
(`labelGraphDegree[node] >= 3`). If so, skip the write-back for that window
(keep the greedy assignment). This is **geometry-only**: `labelGraphDegree` is
computed from PDF-coordinate proximity (edge weights / gaps), carries no post-number
literals, and satisfies the 260602-decouple project rule.

The `labelGraphDegree` map is available from the `inferDistanceEdgesFromLabels`
output (L1138 builds it implicitly) — or can be derived by counting edges per node
in the greedy-assigned `distanceEdges` array before `refineSequentialWindows` runs.

**Why it is risky now:**

`refineSequentialWindows` runs on every PDF route, including Siriu. Adding a
degree-based suppression guard will change the gate-test vector for any route that
has deg≥3 label-graph junctions, which includes both LC and Siriu. Siriu's
accuracy gate currently passes with 64 error ceilings and 39 index locks — these
were set against the current behavior of `refineSequentialWindows`. A targeted
task must:
1. Compute `labelGraphDegree` at the correct pipeline stage (after greedy, before refine).
2. Verify the Siriu regression gate (`npm run test:gate`) stays green with the guard enabled.
3. Verify the LC PDF gate (`node tools/run-route-pdf-accuracy-gate.mjs`) shows the
   9→10 and 10→11 edges resolving toward truth.
4. Verify Valmor gate (`node tools/run-valmor-accuracy-gate.mjs`) and DWG gate
   (`node tools/run-route-dwg-accuracy-gate.mjs`) are unaffected.

**Prerequisite to unblock:**

A junction-aware guard that is proven gate-safe across LC + Siriu + Valmor — specifically,
a regression-safe `labelGraphDegree` computation inserted between `associateDistances`
(L143) and `refineSequentialWindows` (L936) — with all four gates running clean before
the new guard is enabled. This is the same prerequisite established in the 260602-decouple
project: junction detection from geometry only (region degree/adjacency), no post-number
literals.

---

## LC Error Baseline (this run, no code changes)

| Metric | Value |
|--------|-------|
| Gate | LC PDF accuracy gate (`run-route-pdf-accuracy-gate.mjs`) |
| Matched posts | 31/31 |
| Mean error | 185.63 m |
| Max error | 271.73 m |
| Result | PASS (per-post ceiling thresholds in `luizcarolino-pdf-baseline.json`) |

Note: The gate PASSES because per-post error ceilings in the baseline JSON were set
to the current (wrong) output. The mean=185.63m and max=271.73m reflect the full
posts-1–20 deformation from cascading wrong label assignments. The gate is a
regression-fence, not an absolute-accuracy assertion — a future improvement would
need `LUIZCAROLINO_UPDATE_BASELINE=1` refresh after verified improvement.

---

## Gate Results

All four gates were run on the unmodified tree (no code changes made in this task).

| Gate command | Result | Key metrics |
|---|---|---|
| `node tools/run-route-pdf-accuracy-gate.mjs` | **PASS** | matched=31/31, mean=185.63m, max=271.73m |
| `node tools/run-valmor-accuracy-gate.mjs` | **PASS** | matched=11/11, mean=2.22m, max=4.38m |
| `node tools/run-route-dwg-accuracy-gate.mjs` | **PASS** | matched=31/31, mean=114.88m, max=403.93m, dwgStatus=dwg-graph-walk |
| `npm run test:gate` | **PASS** | Siriu: 85 posts, 64 err ceilings, 39 idx locks |

---

## Non-Code-Fixable Edges (Ambiguous Source)

The following 5 wrong edges are **NOT fixable by changes to `distance-associator.js`**
without architectural change or absent information:

- **3→4** (`bifurcation-cleared` at L1548): Cross-page boundary (pages 3→4) forces
  the bifurcation detector. The label geometry is genuinely ambiguous — the 18.8m label
  is physically closer to chord 2→4 than to 3→4 in PDF coordinates. Fixing this requires
  either (a) a cross-page bifurcation bypass rule (architectural change), or (b) topology
  information from the DWG to confirm that 3→4 is a straight continuation, not a branch.

- **11→12** (`bifurcation-cleared` at L1548): Same cross-page mechanism as 3→4. The
  18.7m label at the page-5 boundary geometrically wins chord 10→12. Same fix prerequisites.

- **6→7** (greedy `associateDistances` at L218/L231): The PDF omits the ~37.7m label
  for this step. The greedy assigns the only geometrically nearby label (li=62, 13.8m).
  No heuristic can assign a label that is absent.

- **22→23** (greedy `associateDistances`, cascade of 6→7): No ~39.4m label exists in
  the PDF. The 22→23 assignment is a cascade failure from 6→7 consuming li=62.

- **20→21** (`jumpback-refill` at L491): Cross-sheet hop with only a 29.8m label at the
  boundary; the ground-truth distance (381.6m) corresponds to a sheet-to-sheet gap that
  has no corresponding PDF label. This is outside the scope of label-association logic.
