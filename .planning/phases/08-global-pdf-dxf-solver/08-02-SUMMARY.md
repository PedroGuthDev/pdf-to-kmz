---
phase: 08-global-pdf-dxf-solver
plan: 02
subsystem: testing
tags: [topology-gate, d-05, d-10, d-11, monotonicity, hub-degree, accept-bar, solve-03]

requires:
  - phase: 08-global-pdf-dxf-solver
    provides: solveGlobalGraphAlignment Hungarian core (08-01)
provides:
  - checkTopologyGate() — per-branch arc-monotonicity + hub-degree class
  - evaluateAcceptBar() — D-05 three-condition accept bar
  - D-05 demotion wired into solveGlobalGraphAlignment post-munkres
affects:
  - 08-03-cascade-wiring

tech-stack:
  added: []
  patterns:
    - "Monotonicity tolerance from tolerances.spanTolM (D-08 median-derived, no absolute-meter literal)"
    - "Authoritative-edge degree from source-tagged distances; connAdj fallback when auth count is 0"
    - "Accept bar order: budget → residual trust → topology pass"

key-files:
  created:
    - parser/__tests__/global-solver-topology.test.mjs
  modified:
    - parser/dwg/global-solver.js
    - parser/__tests__/global-solver.test.mjs

key-decisions:
  - "Monotonicity uses BFS cable-span arc-position along adjacencyGraph within each junction-partitioned run"
  - "degreeClass buckets 1/2/≥3 for both PDF authoritative and DXF cable degree"
  - "evaluateAcceptBar exported for isolated accept-bar unit tests (topology fail decoupled from coords)"

patterns-established:
  - "Demotion reasons: residual-gate | monotonicity:runN | hub-degree:N | budget"
  - "testAssignments / _testAssignments hook skips munkres for degenerate fixture injection"

requirements-completed: [SOLVE-03]

duration: 40min
completed: 2026-06-08
---

# Phase 08 Plan 02: Topology Gate Summary

**Per-branch arc-monotonicity and hub-degree-class topology gate with D-05 accept bar (residual trust + topology + 2s budget) bolted onto solveGlobalGraphAlignment**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-06-08T20:00:00Z
- **Completed:** 2026-06-08T20:40:00Z
- **Tasks:** 1 (TDD: RED → GREEN)
- **Files modified:** 3

## Accomplishments

- `checkTopologyGate()` — junction-aware linear-run partition, arc-position monotonicity (D-10), hub-degree class match (D-11)
- `evaluateAcceptBar()` — residual `trust` AND topology pass AND `elapsedMs < 2000`; any fail demotes with `partialCoords`
- `parser/__tests__/global-solver-topology.test.mjs` — 10/10 green (7 topology + 3 accept-bar reject fixtures)
- Wave 1 suite still green (6/6) with GPS fixtures added for residual sub-score

## Task Commits

1. **Task 1 RED:** `855f9b6` — test(08-02): add failing topology gate unit tests
2. **Task 1 GREEN:** `a0f121c` — feat(08-02): topology gate and D-05 accept bar

**Plan metadata:** pending (docs commit after state update)

## Verification

| Check | Result | Detail |
|-------|--------|--------|
| `node --test parser/__tests__/global-solver-topology.test.mjs` | **GREEN** | 10/10 pass |
| `node --test parser/__tests__/global-solver.test.mjs` | **GREEN** | 6/6 pass |
| Monotonicity tolerance grep | **OK** | Uses `tolerances.spanTolM` only |
| `npm run test:gate` | **Not re-run** | Pre-existing post-positioning failures documented in 08-01; solver not wired into cascade |

## Files Created/Modified

- `parser/dwg/global-solver.js` — `checkTopologyGate`, `evaluateAcceptBar`, accept bar in `solveGlobalGraphAlignment`
- `parser/__tests__/global-solver-topology.test.mjs` — monotonicity, hub-degree, accept-bar reject fixtures
- `parser/__tests__/global-solver.test.mjs` — GPS map for residual trust on happy-path tests

## Decisions Made

- Hub-degree authoritative count of 0 falls back to connection adjacency (routes without source tags in unit fixtures)
- Topology-fail accept-bar test uses correct coords + swapped assignments to isolate topology rejection from shape residual
- `evaluateAcceptBar` exported for direct unit testing of the three-condition bar

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Authoritative degree 0 blocked connAdj fallback**
- **Found during:** Task 1 GREEN (hub-degree false rejects on linear fixtures)
- **Issue:** `buildAuthoritativeDegreeByPost` initialized all posts to 0; `resolveAuthoritativeDegree` treated 0 as authoritative → degreeClass(0)=1 vs DXF through-node class 2
- **Fix:** Only use authoritative map entry when count > 0; else fall back to connAdj size
- **Files modified:** `parser/dwg/global-solver.js`
- **Commit:** `a0f121c`

**2. [Rule 3 - Blocking] Double-export syntax on evaluateAcceptBar**
- **Found during:** Task 1 GREEN (test import)
- **Issue:** `export export function evaluateAcceptBar` parse error during iteration
- **Fix:** Single `export function evaluateAcceptBar`
- **Files modified:** `parser/dwg/global-solver.js`
- **Commit:** `a0f121c`

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Required for correct hub-degree on fixtures without authoritative source tags; no scope creep.

## Issues Encountered

None beyond deviations above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Ready:** 08-03 cascade wiring can call `solveGlobalGraphAlignment` as level-0 and demote on any accept-bar failure
- **Blocker:** Full `npm run test:gate` still has pre-existing `post-positioning.test.mjs` failures (unchanged; solver not yet in cascade)

## Self-Check: PASSED

- FOUND: parser/dwg/global-solver.js
- FOUND: parser/__tests__/global-solver-topology.test.mjs
- FOUND: .planning/phases/08-global-pdf-dxf-solver/08-02-SUMMARY.md
- FOUND: 855f9b6
- FOUND: a0f121c

---
*Phase: 08-global-pdf-dxf-solver*
*Completed: 2026-06-08*
