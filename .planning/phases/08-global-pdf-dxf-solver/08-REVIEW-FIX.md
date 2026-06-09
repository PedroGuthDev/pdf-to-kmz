---
phase: 08-global-pdf-dxf-solver
fixed_at: 2026-06-09T00:00:00Z
review_path: .planning/phases/08-global-pdf-dxf-solver/08-REVIEW.md
iteration: 1
findings_in_scope: 8
fixed: 8
skipped: 0
status: all_fixed
---

# Phase 8: Code Review Fix Report

**Fixed at:** 2026-06-09
**Source review:** .planning/phases/08-global-pdf-dxf-solver/08-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 8 (2 critical, 6 warning; info findings excluded per `critical_warning` scope)
- Fixed: 8
- Skipped: 0

All in-scope fixes were verified by re-reading (Tier 1), `node --check` syntax
parse (Tier 2), and running the four Phase 8 `node --test` suites
(`global-solver`, `global-solver-topology`, `global-solver-cascade`,
`median-crossval`): 25/25 tests pass after all fixes.

## Fixed Issues

### CR-01: `cableSpanAlongPath` hop-count BFS used as weighted shortest-path

**Files modified:** `parser/dwg/global-solver.js`
**Commit:** f4eb415
**Applied fix:** Replaced the FIFO/visited-at-enqueue BFS with Dijkstra using a
linear-scan priority queue. A node's distance is only finalized when popped as
the current minimum, so the returned arc span is the true shortest path even on
graphs with junctions/cycles. Behavior on linear chains is unchanged (existing
tests still pass).

### CR-02: median ratio can be `NaN`, silently bypassing the scale-mismatch guard

**Files modified:** `parser/dwg/median-crossval.js`
**Commit:** 795711d
**Applied fix:** Added an explicit guard before dividing — returns
`insufficient-data` when either median is `null` or `medianDXF <= 0` — and a
`Number.isFinite(ratio)` check in the band test so a non-finite ratio is treated
as a scale-mismatch (demote) rather than silently passing. Verified by the
existing "skips null/zero ... (no NaN)" test.

### WR-01: `medianOf` upper-middle bias on even-length inputs

**Files modified:** `parser/dwg/median-crossval.js`
**Commit:** 4cc19c5
**Applied fix:** Even-length arrays now average the two central elements
(`(s[mid-1] + s[mid]) / 2`); odd-length keeps the middle element. This is the
true median rather than the upper median.

### WR-02: anchor `degreeClass` never validated before hard-pin

**Files modified:** `parser/dwg/global-solver.js`
**Commit:** 0e527f1
**Applied fix:** Before forcing the anchor cell to `-Infinity`, compare post 1's
connection degree class (`connAdj`, array-valued) against `anchorBest`'s DXF
degree class (`graph.get(anchorIdx)`, Set-valued). On mismatch the solver now
demotes with a distinct `reason: "anchor-degree-mismatch"` instead of seeding
dead-reckoning from a potentially wrong origin.
**NOTE — requires human verification:** this is a logic/heuristic change. The
fix uses the proximity-selected `anchorBest` (matching the reviewer's "verify
before pinning" guidance) rather than the more invasive "re-rank candidates by
proximity + degree" alternative. Confirm the new demotion path and the new
`anchor-degree-mismatch` reason string are acceptable to downstream consumers,
and that the degree-class equivalence (classes 1/2/3) is the intended strictness.

### WR-03: sentinel-cost collision threshold `>= sentinel * 0.999`

**Files modified:** `parser/dwg/global-solver.js`
**Commit:** d4b6204
**Applied fix:** Replaced the magnitude-based coverage check with a structural
one: an assigned `(y,x)` is uncovered iff `realCosts[y][x] == null`, with the
forced anchor cell (`y === anchorRow && x === anchorCol`) exempted since it is
real by construction. Removes the `0.999` fudge / `SENTINEL_MULT` coupling. The
sentinel value is still used to fill non-candidate matrix cells.
**NOTE — requires human verification:** logic change to the coverage gate.
Confirm no other code path depended on the old `>= sentinel * 0.999` semantics.

### WR-04: colinear dead-reckoning drift biases candidate prune

**Files modified:** `parser/dwg/global-solver.js`
**Commit:** 17c8867
**Applied fix:** `propagatePredictedPositions` now also tracks per-post hop depth
from the anchor and returns `{ predicted, hops }`. `pruneCandidates` widens the
rbush search window per post as `candidateWindowM * (1 + 0.25 * hopCount)`, so
nodes farther from the anchor (where colinear drift accumulates) get a
proportionally larger window. Both call sites updated.
**NOTE — requires human verification:** the `HOP_WINDOW_GROWTH = 0.25` factor is
a heuristic chosen to match the reviewer's "widen proportional to hop count"
minimum suggestion; it should be calibrated on real routes. The alternative
(re-seeding direction from the best DXF neighbor at each hop) was not taken to
keep the change minimal.

### WR-05: `npm test` / `test:unit` does not run any Phase 8 suite

**Files modified:** `package.json`
**Commit:** a5f8c62
**Applied fix:** Appended `global-solver.test.mjs`,
`global-solver-topology.test.mjs`, `global-solver-cascade.test.mjs`, and
`median-crossval.test.mjs` to the `test:unit` `node --test` script.

### WR-06: `console.log` debug artifact on the production demotion path

**Files modified:** `parser/dwg/coordinate-calculator-dwg.js`,
`parser/__tests__/global-solver-cascade.test.mjs`
**Commit:** baac96e
**Applied fix:** Removed `console.log("solver demoted; using graph-walker")`,
keeping the structured `warnings.push({ kind: "dwg-solver-demoted", ... })`.
Updated the cascade test: it now asserts on the `dwg-solver-demoted` warning
object (assertion already present in the test) and the now-dead stdout-capture
harness (`logLines`, the `beforeEach`/`afterEach` console.log override, and the
unused `afterEach` import) was removed.

## Skipped Issues

None — all in-scope findings were fixed.

The Info-tier findings (IN-01 `_testAssignments` alias, IN-02 unused `coords`
param, IN-03 duplicate adjacency builders, IN-04 timing-gate comment) were out
of scope (`critical_warning`) and were not addressed.

---

_Fixed: 2026-06-09_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
