---
phase: 08-global-pdf-dxf-solver
plan: 01
subsystem: testing
tags: [munkres, hungarian, global-solver, rbush, d-02, d-03, d-07, solve-01]

requires:
  - phase: 08-global-pdf-dxf-solver
    provides: medianCrossValidate D-08 scale guard (08-00)
provides:
  - solveGlobalGraphAlignment() Hungarian core (anchor, prune, cost, assign)
  - munkres@2.0.3 dependency (havelessbemore)
  - Synthetic unit suite for identity, rectangular, demotion, immutability, timing
affects:
  - 08-02-topology-gate
  - 08-03-cascade-wiring

tech-stack:
  added: [munkres@2.0.3]
  patterns:
    - "Large-finite sentinel (10× maxRealCost) for non-candidates; -Infinity anchor force"
    - "Planar UTM hypot for cost; haversine only at coords output"
    - "Pristine-input discipline — never mutate posts/distances/regionPosts"

key-files:
  created:
    - parser/dwg/global-solver.js
    - parser/__tests__/global-solver.test.mjs
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "w_pos = w_span = 1 for D-02 cost (A4 discretion; tune in later waves)"
  - "LABEL_ROUND_TOL_FRAC = 0.05 for printed distance match in spanFit"
  - "no-anchor and scale-mismatch fail loud without relaxing tolerance"

patterns-established:
  - "solveGlobalGraphAlignment returns { ok, coords, elapsedMs, partialCoords, warnings } or { ok:false, reason }"
  - "Walker coords shape: { postNumber, lat, lon, source:'dwg', dwg_block } via utmToLatLon"

requirements-completed: [SOLVE-01]

duration: 35min
completed: 2026-06-08
---

# Phase 08 Plan 01: Hungarian Core Summary

**munkres@2.0.3 Hungarian assignment with anchor D-07, rbush k≤30 prune, D-02 cost matrix, and walker-identical coords output — pure additive module, inputs never mutated**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-06-08T18:32:45Z
- **Completed:** 2026-06-08T19:31:14Z
- **Tasks:** 1 (TDD: RED → GREEN)
- **Files modified:** 4

## Accomplishments

- Installed `munkres@2.0.3` (havelessbemore); verified no postinstall script
- `parser/dwg/global-solver.js` — `solveGlobalGraphAlignment()` with median guard passthrough, anchor, candidate prune, cost matrix, munkres assign, coords mapping, `elapsedMs`
- `parser/__tests__/global-solver.test.mjs` — 6/6 green (identity, rectangular, no-anchor, scale-mismatch, immutability, timing)

## Task Commits

1. **Task 1 RED:** `9fff08f` — test(08-01): add failing global-solver unit tests
2. **Task 1 GREEN:** `8176fd1` — feat(08-01): global-solver core with munkres Hungarian assignment

**Plan metadata:** pending (docs commit after state update)

## Verification

| Check | Result | Detail |
|-------|--------|--------|
| `node --test parser/__tests__/global-solver.test.mjs` | **GREEN** | 6/6 pass |
| `npm run test:gate` | **RED (pre-existing)** | Stops at `post-positioning.test.mjs` — 3 Valmor/circle-keep failures; solver not wired into cascade |
| `node_modules/munkres` | **OK** | v2.0.3, no postinstall |
| Tolerance grep | **OK** | Uses `tolerances.*` and `DEFAULT_TOLERANCE_M` only |

## Files Created/Modified

- `parser/dwg/global-solver.js` — exports `solveGlobalGraphAlignment`
- `parser/__tests__/global-solver.test.mjs` — synthetic graph unit suite
- `package.json` / `package-lock.json` — `munkres@^2.0.3`

## Decisions Made

- Balanced D-02 weights (`W_POS = W_SPAN = 1`) per A4 discretion
- ±5% label rounding tolerance in spanFit cost term
- Coverage failures return `reason:"coverage"` with diagnostic `partialCoords`
- Anchor row forced via `-Infinity` at pinned INSERT column (D-07)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Full `npm run test:gate` RED on pre-existing `post-positioning.test.mjs` failures (same blocker documented in 08-00); acceptable per plan since solver is not yet wired into cascade

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Ready:** Wave 3 (08-02) topology gate can bolt onto `solveGlobalGraphAlignment` return path
- **Blocker for strict full-bar:** `post-positioning.test.mjs` 3 failures must green before claiming `npm run test:gate` exit 0

## Self-Check: PASSED

- FOUND: parser/dwg/global-solver.js
- FOUND: parser/__tests__/global-solver.test.mjs
- FOUND: .planning/phases/08-global-pdf-dxf-solver/08-01-SUMMARY.md
- FOUND: 9fff08f
- FOUND: 8176fd1

---
*Phase: 08-global-pdf-dxf-solver*
*Completed: 2026-06-08*
