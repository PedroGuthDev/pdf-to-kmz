---
phase: quick-260603-jk7
plan: 01
subsystem: parser
tags: [distance-associator, label-assignment, luiz-carolino, accuracy, diagnosis]

# Dependency graph
requires:
  - phase: quick-260603-acc
    provides: LC error split into deformation (posts 1-20) vs rigid offset (posts 21-31) finding; debug scripts
  - phase: quick-260602-decouple
    provides: junction-detection-from-geometry prerequisite; no-post-number-literals rule
provides:
  - Per-edge root cause table for all 7 wrong LC Distância_Poste assignments with file:line citations
  - Classification of 5 ambiguous-source vs 2 heuristic-bug wrong edges
  - Precise documented fix shape for refineSequentialWindows junction-aware suppression
  - Documented baseline: LC PDF gate mean=185.63m, max=271.73m (all 4 gates green)
affects: [future-accuracy-tasks, 260603-acc, label-assignment-fixes]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Diagnose-then-decide pattern: classify wrong edges as ambiguous-source vs heuristic-bug before committing to a code fix"
    - "Documented recommendation: when only 2/7 wrong edges are code-fixable and dominant deformation remains, defer with precise fix shape"

key-files:
  created:
    - .planning/quick/260603-jk7-debug-lc-wrong-label-assignments-and-eva/260603-jk7-ROOTCAUSE.md
    - .planning/quick/260603-jk7-debug-lc-wrong-label-assignments-and-eva/260603-jk7-DECISION.md
  modified: []

key-decisions:
  - "document-recommendation chosen: 5/7 wrong LC edges are ambiguous-source (absent PDF labels, cross-page geometry); only 2/7 (9→10, 10→11 window-refine swap) are heuristic-bugs — fixing only those does not materially improve the dominant posts-1-20 deformation"
  - "refineSequentialWindows junction-aware guard is the recommended future fix: suppress swap when displaced segment endpoint has labelGraphDegree>=3; geometry-only, no post-number literals"
  - "refineSequentialWindows fix is deferred: same code family previously regressed Siriu; fix requires proven gate-safety across LC + Siriu + Valmor before landing"

patterns-established:
  - "Ambiguous-source vs heuristic-bug classification: before fixing label-association errors, trace each wrong edge to determine whether the PDF itself is the source of ambiguity — if so, no heuristic improvement is possible"

requirements-completed: [LC-LABEL-DIAGNOSE, LC-LABEL-EVALUATE]

# Metrics
duration: ~30min
completed: 2026-06-03
---

# Quick Task 260603-jk7: LC Wrong Label Assignments — Summary

**Diagnosed all 7 wrong LC Distância_Poste edges (5 ambiguous-source, 2 heuristic-bug); documented refineSequentialWindows junction-aware suppression as the precise deferred fix; all 4 gates confirmed green with no code changes.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-06-03
- **Completed:** 2026-06-03
- **Tasks:** 2 (Task 1: DIAGNOSE — committed 54af8ec; Task 2: EVALUATE — document-recommendation)
- **Files modified:** 0 (parser code — this was a diagnose-and-evaluate task)

## Accomplishments

- Per-edge root-cause table: 7 wrong consecutive edges traced to exact `distance-associator.js` file:line (bifurcation loop L1548, greedy L218/L231, window-refine L936/L1107, jumpback-refill L491)
- Classification: 5 ambiguous-source (absent PDF labels or cross-page geometry beyond code reach), 2 heuristic-bug (refineSequentialWindows swap at posts 9→10/10→11)
- Confirmed all three prior-finding hypotheses (false bifurcations at posts 2 and 10; short 13.8m greedy 6→7; inferred-label phantoms 3→1/9→11/11→8)
- Documented precise fix shape for the deferred junction-aware suppression guard
- Gate baseline documented: LC PDF mean=185.63m, max=271.73m; all 4 gates green

## Task Commits

1. **Task 1: DIAGNOSE — root-cause LC wrong label assignments** - `54af8ec` (docs)
2. **Task 2: EVALUATE — document-recommendation (DECISION.md + SUMMARY.md)** - (this commit)

## Files Created/Modified

- `.planning/quick/260603-jk7-debug-lc-wrong-label-assignments-and-eva/260603-jk7-ROOTCAUSE.md` — per-edge mechanism table with file:line citations; hypothesis confirmation; ambiguous-source vs heuristic-bug classification; window-refine detailed mechanism
- `.planning/quick/260603-jk7-debug-lc-wrong-label-assignments-and-eva/260603-jk7-DECISION.md` — chosen option rationale; precise recommended fix shape; LC baseline metrics; gate results table; non-code-fixable edges documented

## Decisions Made

- **document-recommendation chosen** (not apply-minimal-fix): Only 2 of 7 wrong edges are heuristic-bugs, and fixing them would not materially reduce the dominant posts-1–20 deformation (which is driven by the 5 ambiguous-source edges — bifurcation clears at 3→4/11→12, absent labels at 6→7/22→23, cross-sheet hop at 20→21). The contained fix corrects only 9→10/10→11 while the mean error stays ~185m.

- **Deferred fix is precise and unblocked by one prerequisite**: `refineSequentialWindows` (L936) needs a junction-aware suppression guard — suppress the window swap when the displaced segment endpoint has `labelGraphDegree >= 3` (geometry-only; computed from greedy `distanceEdges`, no post-number literals). This requires proven gate-safety across LC + Siriu + Valmor, which is the same prerequisite established in 260602-decouple for junction detection from geometry.

## Deviations from Plan

None — plan executed exactly as written. The `document-recommendation` branch of Task 2 was followed as directed by the checkpoint decision. No parser code was changed.

## Issues Encountered

None. All four gates were green on the unmodified tree.

## Gate Results (Baseline, No Code Changes)

| Gate | Command | Result | Key Metrics |
|---|---|---|---|
| LC PDF | `node tools/run-route-pdf-accuracy-gate.mjs` | PASS | matched=31/31, mean=185.63m, max=271.73m |
| Valmor | `node tools/run-valmor-accuracy-gate.mjs` | PASS | matched=11/11, mean=2.22m, max=4.38m |
| DWG | `node tools/run-route-dwg-accuracy-gate.mjs` | PASS | matched=31/31, mean=114.88m, max=403.93m |
| Regression | `npm run test:gate` | PASS | Siriu: 85 posts, 64 err ceilings, 39 idx locks |

## User Setup Required

None.

## Next Phase Readiness

- Root cause of LC wrong label assignments is fully documented with exact file:line citations.
- A future targeted task can implement the `refineSequentialWindows` junction-aware suppression guard using `labelGraphDegree >= 3` as the suppression predicate — geometry-only, no post-number literals.
- Prerequisite: compute `labelGraphDegree` between `associateDistances` (L143) and `refineSequentialWindows` (L936), then verify all 4 gates stay green with the guard enabled.
- The 5 ambiguous-source wrong edges (3→4, 11→12, 6→7, 22→23, 20→21) require either architectural change (DWG topology cross-walk for bifurcation disambiguation) or absent PDF information — they are out of scope for a label-associator fix.

---
*Phase: quick-260603-jk7*
*Completed: 2026-06-03*
