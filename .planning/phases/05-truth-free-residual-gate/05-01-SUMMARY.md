---
phase: 05-truth-free-residual-gate
plan: 01
subsystem: testing
tags: [residual-gate, haversine, median, two-gate, confidence-tiers, esm, node-test]

# Dependency graph
requires:
  - phase: 04 (cable-topology / dwg pairing)
    provides: cascade.coords {postNumber,lat,lon}, distances {from,to,meters}, gpsByPostNumber Map
provides:
  - "parser/dwg/residual-gate.js — computeResiduals, computeAnchorGap, applyResidualGate pure functions"
  - "Two-sub-score (shape + anchor) truth-free quality judge with per-post HIGH/MED/LOW/UNRESOLVABLE tiers"
  - "Named threshold constants (SHAPE_TRUST/FALLBACK, ANCHOR_TRUST/FALLBACK/FAIL) — ANCHOR_* placeholders to be LOCKED in Plan 02"
  - "node:test unit suite locking median aggregation, anchor-gap math, two-gate logic, UNRESOLVABLE rule"
affects: [05-02 (integration + CI gate calibration), P7/P8 (active demotion), P9 (KMZ tier surfacing)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure parser/dwg module: leading geo import, file+function JSDoc, named ESM exports, plain-object returns"
    - "MEDIAN route-level aggregate (never mean) for shape fidelity"
    - "Two-gate HIGH-only-when-both-pass decision; fail-loud UNRESOLVABLE for unscored posts"

key-files:
  created:
    - parser/dwg/residual-gate.js
    - parser/__tests__/residual-gate.test.mjs
  modified: []

key-decisions:
  - "Route shape aggregate is the MEDIAN, not the mean (Siriu mean 60.5% vs median 0.3%) — load-bearing for ACC-04"
  - "ANCHOR_* thresholds seeded as documented placeholders (50/100/150m); LOCKED in Plan 02 against real route output, must stay < 202m (LC anchor gap)"
  - "UNRESOLVABLE reachability: applyResidualGate accepts optional thresholds.allPostNumbers to declare the full post universe; declared-but-unscored posts are flagged UNRESOLVABLE, never dropped"
  - "Per-post shapeScore = MAX incident-edge relError (fail-loud, single bad edge cannot hide); single MED/LOW boundary uses the FALLBACK thresholds (D-05 discretion)"

patterns-established:
  - "Pattern: truth-free quality judge — no GPS ground-truth fixture in the live path; shape from printed-distance residuals, anchor from DWG-vs-PDF gap"
  - "Pattern: tier labels only (HIGH/MED/LOW/UNRESOLVABLE), never a numeric percentage field (D-07)"

requirements-completed: [ACC-01, ACC-02, ACC-03, ACC-05]

# Metrics
duration: 5min
completed: 2026-06-05
---

# Phase 5 Plan 01: Truth-Free Residual Gate (pure module) Summary

**Pure-math `parser/dwg/residual-gate.js` quality judge: MEDIAN shape-fidelity residuals, DWG-vs-PDF anchor gap, and a two-gate trust/fallback/fail decision with per-post HIGH/MED/LOW/UNRESOLVABLE tiers — plus a 12-test node:test suite.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-06-05T21:19:55Z
- **Completed:** 2026-06-05T21:24:03Z
- **Tasks:** 3
- **Files modified:** 2 (both created)

## Accomplishments
- `computeResiduals(coords, distances)` — MEDIAN-aggregated shape-fidelity relative error over labelled edges (never mean), with p95 tail and per-edge diagnostics; guards skip meters<=0/null/NaN and unpaired endpoints, returns null aggregates on empty input.
- `computeAnchorGap(coords, gpsByPostNumber)` — per-post DWG-vs-user-anchored-PDF gap (D-03), mean/p95 aggregates; post 1 ~0 by construction, downstream posts diverge under rigid offset.
- `applyResidualGate(shape, anchor, thresholds?)` — "trust" only when BOTH sub-scores pass; "fail" when either hard-fails (the ACC-03 LC anchor mechanism); else "fallback". Per-post tiers from worst incident edge + anchor gap; declared-but-unscored posts → UNRESOLVABLE (fail-loud).
- Named threshold constants in-file (D-05); tier labels only, no numeric % (D-07).
- 12 node:test cases proving median≠mean, invalid-edge skipping, anchor-gap haversine math, and all four gate decisions / tier outcomes — all passing.

## Task Commits

Each task was committed atomically:

1. **Task 1: computeResiduals + computeAnchorGap** - `f5fa1fc` (feat)
2. **Task 2: applyResidualGate + named threshold constants** - `640d6db` (feat)
3. **Task 3: unit tests** - `1d954ad` (test)

**Plan metadata:** (this SUMMARY commit, docs)

_Note: this is a `type: execute` plan with `tdd="true"` tasks. The plan ordered implementation (Tasks 1–2) before the test file (Task 3), so the commit sequence is feat → feat → test rather than the canonical RED→GREEN. See TDD Gate Compliance below._

## Files Created/Modified
- `parser/dwg/residual-gate.js` - The truth-free residual gate: three named ESM exports + named threshold constants, reuses in-house `haversineMeters`, zero new dependencies.
- `parser/__tests__/residual-gate.test.mjs` - node:test + node:assert/strict unit suite (12 tests) mirroring `cable-topology.test.mjs` conventions.

## Decisions Made
- **Median, not mean** for the route shape score — verbatim from 05-PATTERNS.md; mean would false-fail Siriu (60.5% vs 0.3% median) and break ACC-04.
- **ANCHOR_* placeholders (50/100/150 m)** with an explicit header comment that they are LOCKED in Plan 02 against real Siriu/Valmor/João Born output, and ANCHOR_FAIL_M must stay below the 202 m LC anchor gap. SHAPE constants (5% / 15%) are treated as final.
- **UNRESOLVABLE reachability** (see Deviations §1): the pure `applyResidualGate(shape, anchor)` signature alone cannot know about a post absent from both indices. Added optional `thresholds.allPostNumbers` so the caller declares the post universe; any declared post with no incident edge and no anchor entry is tagged UNRESOLVABLE. This makes the D-04 "flag, never drop" rule both testable and honoured by Plan 02's integration call.
- **Per-post shapeScore = MAX incident relError** (fail-loud, per RESEARCH Pattern 3 / Anti-pattern A4); a single intermediate MED/LOW boundary reusing the FALLBACK thresholds (Claude's discretion under D-05).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added optional `thresholds.allPostNumbers` to make UNRESOLVABLE reachable**
- **Found during:** Task 2 (applyResidualGate) / Task 3 (UNRESOLVABLE test).
- **Issue:** The plan's acceptance criterion "a post supplied with no incident edge and no anchor entry yields tier UNRESOLVABLE" is unreachable with the fixed `(shape, anchor, thresholds)` signature, because such a post appears in neither the incident-edge index nor the anchor index and so never enters the per-post loop. RESEARCH Pattern 3 clarifies UNRESOLVABLE is driven by the post universe ("0 paired coord → post not in coords"), which the two sub-score objects do not carry.
- **Fix:** `applyResidualGate` now reads an optional `thresholds.allPostNumbers` iterable and unions it into the post set. Declared posts with no edge and no anchor are tagged UNRESOLVABLE (fail-loud). The `thresholds` parameter was already in the signature, reserved; this gives it a concrete, documented use without changing the numeric-thresholds-are-named-constants rule (D-05). Plan 02's integration can pass `cascade.coords.map(c => c.postNumber)` as the universe.
- **Files modified:** parser/dwg/residual-gate.js (part of Task 2 commit).
- **Verification:** Unit test "post with no incident edge and no anchor entry → UNRESOLVABLE" passes; node probe confirmed post 99 → UNRESOLVABLE while posts 1/2 score normally.
- **Committed in:** `640d6db` (Task 2 commit).

---

**Total deviations:** 1 auto-fixed (1 blocking).
**Impact on plan:** Necessary to satisfy the plan's own UNRESOLVABLE acceptance criterion and the D-04 fail-loud lock. No scope creep — signature unchanged, no new dependency, no behavior change to the shape/anchor sub-scores.

## Issues Encountered
- The Task 3 "fallback band" test initially used `medianRelError: 0.03`, which actually *passes* the 5% trust band (0.03 < 0.05) and, with a passing anchor, yields "trust" — the test failed. Corrected the input to `0.10` (strictly between the 5% trust and 15% fallback thresholds) so it exercises the genuine middle band. All 12 tests then passed.

## TDD Gate Compliance

This is a `type: execute` plan (not `type: tdd`), with `tdd="true"` on individual tasks. The plan deliberately ordered the implementation tasks (1–2) before the test-authoring task (3), so the git sequence is `feat(f5fa1fc) → feat(640d6db) → test(1d954ad)` rather than a strict RED-before-GREEN cycle. No `refactor` commit was needed. All acceptance-criteria probes were run against the implementation before each commit, and the full `node --test` suite (12/12 passing) gates the final state.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The pure contract every downstream piece builds on is in place and unit-locked.
- **Plan 02 (integration + CI gate):** wire `computeResiduals`/`computeAnchorGap`/`applyResidualGate` into `coordinate-calculator-dwg.js` (additive attach per 05-PATTERNS.md), pass the post universe via `thresholds.allPostNumbers`, build the `tools/run-residual-gate.mjs` CI gate, and CALIBRATE + LOCK the ANCHOR_* constants against real Siriu/Valmor/João Born output (current 50/100/150 m are documented placeholders). The LC posts-21–31 must-fail fixture (D-06) is also a Plan 02 deliverable.

## Self-Check: PASSED

- FOUND: parser/dwg/residual-gate.js
- FOUND: parser/__tests__/residual-gate.test.mjs
- FOUND: .planning/phases/05-truth-free-residual-gate/05-01-SUMMARY.md
- FOUND commit: f5fa1fc (Task 1)
- FOUND commit: 640d6db (Task 2)
- FOUND commit: 1d954ad (Task 3)

---
*Phase: 05-truth-free-residual-gate*
*Completed: 2026-06-05*
