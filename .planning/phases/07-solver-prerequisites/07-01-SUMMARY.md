---
phase: 07-solver-prerequisites
plan: 01
subsystem: testing
tags: [ground-truth, fixtures, regression-gates, haversine, node-test]

# Dependency graph
requires: []
provides:
  - txt→JSON ground-truth importer with outlier exclusion (D-02)
  - Four regenerated *-ground-truth.json fixtures (Siriu 85, JB 34)
  - Siriu position gate (1.0 pt) + junction DFS oracle in test:gate
affects: [07-02, 07-03, 07-06, 07-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Median-cluster outlier exclusion via haversineMeters (--outlier-km default 2.0)"
    - "Flat-array ground-truth JSON with pretty-print + trailing newline"

key-files:
  created:
    - tools/import-ground-truth-txt.mjs
  modified:
    - parser/__tests__/fixtures/joaoborn-ground-truth.json
    - package.json

key-decisions:
  - "JB post 35 excluded by haversine distance from route median cluster (>2 km threshold)"
  - "Siriu position gate wired into test:gate before LC fix wave (Pitfall 2 regression net)"

patterns-established:
  - "Ground-truth import: case-insensitive poste regex, skip blanks, outlier filter, write flat array"
  - "test:gate extension: fold node --test files + chain standalone gate scripts with &&"

requirements-completed: [SOLVE-05]

# Metrics
duration: 15min
completed: 2026-06-06
---

# Phase 7 Plan 01: Truth Foundation Summary

**txt→JSON ground-truth importer with JB post-35 outlier exclusion, plus Siriu position gate and junction oracle live in test:gate**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-06-06T14:35:00Z
- **Completed:** 2026-06-06T14:50:55Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Created `tools/import-ground-truth-txt.mjs` parsing four repo-root txt files into flat `{ number, lat, lon }` JSON fixtures
- Resolved João Born post-35 anomaly: excluded Siriu coordinates 37.1 km from cluster; JB fixture now 34 posts
- Siriu ground-truth holds 85 posts (8 blank lines skipped); all four routes regenerate idempotently
- Extended `npm run test:gate` with `branch-traversal.test.mjs` and `run-siriu-post-position-gate.mjs`; full suite green

## Task Commits

Each task was committed atomically:

1. **Task 1: Build txt → ground-truth JSON importer with outlier exclusion** - `0f2e4c4` (feat)
2. **Task 2: Wire Siriu position gate + Siriu junction oracle into test:gate** - `e328ca0` (feat)

**Plan metadata:** `831a92f` (docs: complete plan)

## Files Created/Modified
- `tools/import-ground-truth-txt.mjs` - Parses txt files, excludes outliers, writes four ground-truth JSON fixtures
- `parser/__tests__/fixtures/joaoborn-ground-truth.json` - Regenerated to 34 posts (post 35 removed)
- `package.json` - test:gate includes branch-traversal test + Siriu position gate

## Decisions Made
- Outlier exclusion uses median lat/lon cluster center with configurable `--outlier-km` (default 2.0 km) per RESEARCH §8
- LC position gate deliberately NOT added to test:gate yet (deferred to 07-07 per D-17)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Wave 0 truth foundation complete; downstream plans can rely on canonical JSON fixtures
- Siriu regression net (1.0 pt position + junction oracle) active before LC layer-B fix (07-06)
- Remaining Wave 0/1 work: JB/Valmor position fixtures, txt-accuracy gates, junction GT for LC/JB/Valmor

## Self-Check: PASSED
- FOUND: tools/import-ground-truth-txt.mjs
- FOUND: parser/__tests__/fixtures/joaoborn-ground-truth.json
- FOUND: commits 0f2e4c4, e328ca0 (git log --oneline -3)
- Idempotent re-run: no fixture diff after second import

---
*Phase: 07-solver-prerequisites*
*Completed: 2026-06-06*
