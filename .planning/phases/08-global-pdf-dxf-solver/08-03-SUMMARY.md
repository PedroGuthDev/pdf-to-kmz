---
phase: 08-global-pdf-dxf-solver
plan: 03
subsystem: solver-cascade
tags: [cascade-wiring, level-0, strangler-fig, d-04, d-13, timing-gate, solve-02, solve-04]

requires:
  - phase: 08-global-pdf-dxf-solver
    provides: solveGlobalGraphAlignment + D-05 accept bar (08-01, 08-02)
provides:
  - solveGlobalGraphAlignment wired as cascade level-0 in runDwgPairingCascade (SOLVE-02)
  - D-13 structured fields (solverPath/solverDemoted/demotionReason/solverScore) + warnings[] entry
  - tools/run-solver-timing-gate.mjs — 2s budget assertion per named route (Pitfall 8 / D-05)
affects:
  - 09-confidence-ui (consumes D-13 channel)

tech-stack:
  added: []
  patterns:
    - "_testDeps.solve / _testDeps.walk injection for cascade level-0 unit isolation"
    - "Timing gate drives the solver from tracked ground-truth + dwg-region JSON (no PDF needed)"
    - "elapsedMs returned on every solver path (accept, demote, no-anchor, scale-mismatch)"

key-files:
  created:
    - tools/run-solver-timing-gate.mjs
  modified:
    - parser/dwg/coordinate-calculator-dwg.js
    - parser/__tests__/global-solver-cascade.test.mjs
    - package.json

key-decisions:
  - "Timing gate measures budget only (accept/demote correctness is the route gates' job)"
  - "Timing gate built from JSON fixtures so it runs in PDF-less worktrees and CI"

patterns-established:
  - "Solver demote logs 'solver demoted; using graph-walker' + pushes { kind: dwg-solver-demoted, reason }"
  - "Success result carries solverPath = cascade.dwgPath; human-readable solver warning in warnings[]"

requirements-completed: [SOLVE-02, SOLVE-04]

duration: 30min
completed: 2026-06-09
---

# Phase 08 Plan 03: Cascade Level-0 Wiring Summary

**solveGlobalGraphAlignment wired as cascade level-0 with strangler-fig demotion to a pristine, byte-identical graph-walker (SOLVE-02); D-13 structured fields + warnings channel on the success result; a 2s-budget solver timing gate across all four named routes (Pitfall 8).**

## Continuation Context

This plan was executed as a continuation. Task 1 (level-0 wiring + D-13 fields +
cascade integration test) had already landed in commit `646490a` (`feat(08-03):
wire solver as cascade level-0 with D-13 fields`) present at the worktree base.
This run **verified** Task 1 (test green, 5/5) and **completed** Task 2 (timing
gate + package.json wiring) + the SUMMARY.

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-06-09
- **Tasks:** 2 (Task 1 pre-landed + verified; Task 2 implemented)
- **Files modified:** 3 (1 created)

## Accomplishments

### Task 1 — Level-0 solver in runDwgPairingCascade (pre-landed `646490a`, verified)
- `solveGlobalGraphAlignment` imported and called at the TOP of `runDwgPairingCascade`,
  BEFORE the Level-1 `pairPostsByGraphWalk` block (verified by line order: solver
  ~line 155, walker ~line 183).
- On `level0.ok` → returns `{ ok:true, coords, dwgPath:"global-solve", solverScore,
  solverDemoted:false, demotionReason:null }`; walker NOT called (spy asserts 0 calls).
- On failure → `console.log("solver demoted; using graph-walker")`, pushes
  `{ kind:"dwg-solver-demoted", reason }` to `warnings`, falls through to the UNCHANGED
  Level-1 walker with pristine inputs (walker call count = 1; deep-equal pristine-input assertion).
- D-13 fields attach at the success-result build (lines 500-510): `solverPath`,
  `solverDemoted`, `demotionReason`, `solverScore`, plus a human-readable string pushed
  to `successResult.warnings` (`[dwg] solver demoted (...)` or `[dwg] global-solve accepted`).
- `graph-walker.js` is unmodified (byte-identical level-1 fallback, strangler-fig).
- `parser/__tests__/global-solver-cascade.test.mjs` — 5/5 green (accept-short-circuit,
  demote-log+walker-once, pristine-input deep-equal, Siriu byte-identical coords, D-13 fields).

### Task 2 — Solver 2s timing gate + chain wiring
- `tools/run-solver-timing-gate.mjs` — for each route (Siriu/LC/JB/Valmor) builds
  cascade-faithful inputs from the tracked `*-ground-truth.json` + `*-dwg-region.json`
  fixtures (route bbox crop + postIndex + adjacencyGraph, exactly as the cascade does),
  runs `solveGlobalGraphAlignment`, and asserts `elapsedMs < 2000` (D-05 condition 3 /
  Pitfall 8). Exits non-zero on breach with a clear per-route message.
- Wired into `package.json` `test:gate:fixtures` after `run-residual-gate`, before
  `run-dxf-ingest-timing-gate`.

## Task Commits

1. **Task 1 (pre-landed, verified):** `646490a` — feat(08-03): wire solver as cascade level-0 with D-13 fields
2. **Task 2:** `1cfc385` — feat(08-03): add solver 2s timing gate wired into test:gate fixtures

## Verification

| Check | Result | Detail |
|-------|--------|--------|
| `node --test parser/__tests__/global-solver-cascade.test.mjs` | **GREEN** | 5/5 pass |
| `node tools/run-solver-timing-gate.mjs` | **GREEN** | 4/4 routes < 2000 ms (worst ~14 ms) |
| Four junction oracles (`branch-traversal*.test.mjs`) | **GREEN** | 21/21 pass (hard red-lines) |
| `tools/run-valmor-accuracy-gate.mjs` | **GREEN** | 11/11 matched, mean 2.22 m, max 4.38 m |
| Unit portion of gate (graph-walker + distance-associator + coordinate-calculator) | **GREEN** | 16/16 pass |
| `graph-walker.js` diff | **EMPTY** | byte-identical fallback preserved |
| **Full `npm run test:gate`** | **NOT VERIFIABLE IN WORKTREE** | see Environment Constraint below |

### Per-route timing-gate result (this run)

| Route | elapsedMs | Solver path (synthetic-fixture input) | posts / region nodes / edges |
|-------|-----------|----------------------------------------|------------------------------|
| Siriu | ~14 ms | demote:coverage | 85 / 393 / 386 |
| Luiz Carolino | ~3 ms | demote:coverage | 31 / 103 / 117 |
| João Born | ~1 ms | demote:coverage | 34 / 135 / 115 |
| Valmor | ~1 ms | demote:monotonicity:run0 | 11 / 54 / 63 |

**Note on the demote paths:** the timing gate measures the **2s budget only** (Pitfall 8 /
D-05 condition 3), NOT solver acceptance. It feeds the solver a *synthetic* route graph
derived from ground-truth GPS spans (no real PDF distance labels / source-tagged authoritative
edges), so the solver correctly demotes (coverage/monotonicity) — and still reports `elapsedMs`
on every path. Real accept/demote-with-zero-regression is the job of the PDF-driven route gates
(post-position + txt-accuracy + Siriu regression), which run in the main checkout. The Siriu
**byte-identical** assertion (cascade coords == pristine walker coords) is covered green by the
cascade integration test using the real `siriu-topology.json` fixture.

## Environment Constraint — Full `npm run test:gate` not runnable in this worktree

The four PDF-driven route gates (`run-{siriu,lc,joaoborn,valmor}-post-position-gate.mjs`,
`run-*-txt-accuracy-gate.mjs`, `run-siriu-regression-gate.mjs`, the `run-residual-gate.mjs`
per-route arms) require the **source route PDFs**, which are **gitignored** and therefore
**absent from this isolated worktree**. In this environment they fail with `Missing PDF: …`
(verified: `run-siriu-post-position-gate.mjs` and `run-residual-gate.mjs` throw "missing PDF"
for all four routes — NOT a regression). The full-chain stop point is the **pre-existing**
`post-positioning.test.mjs` 3 failures (D-N2-01 Valmor p4 + circle-keep), the standing blocker
documented identically in 08-00, 08-01, and 08-02 summaries — unrelated to and untouched by
this plan (this plan only added a new tools/ script + one package.json chain entry).

**Action for the orchestrator / phase-exit:** the four-route green bar (D-06, SOLVE-04) and
the `npm run test:gate` exit-0 assertion must be confirmed in the **main checkout** where the
PDFs exist. All worktree-verifiable parts of the gate are GREEN (junction oracles, valmor
accuracy, unit tests, solver timing gate, cascade integration incl. Siriu byte-identical).
No soft-fence re-baseline was performed (none required; the LC-must-fail fence evaluated
`decision=fail` as designed in the residual-gate output before the missing-PDF throw).

## Files Created/Modified

- `tools/run-solver-timing-gate.mjs` — **created**; per-route 2s budget gate
- `parser/dwg/coordinate-calculator-dwg.js` — level-0 solver call + D-13 fields (Task 1, `646490a`)
- `parser/__tests__/global-solver-cascade.test.mjs` — cascade integration suite (Task 1, `646490a`)
- `package.json` — `run-solver-timing-gate.mjs` added to `test:gate:fixtures`

## Decisions Made

- **Timing gate measures budget, not acceptance** — keeps it PDF-free and deterministic;
  acceptance is the route gates' concern (single source of truth per route, D-12).
- **Timing gate built from tracked JSON fixtures** so it runs in PDF-less worktrees/CI and
  still exercises the real crop + candidate-prune + munkres path that governs the 2s budget.
- **`SOLVER_BUDGET_MS` env override** mirrors the existing gates' baseline-override convention.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `path` variable shadow in timing gate loop**
- **Found during:** Task 2 (gate authoring)
- **Issue:** a local `const path = result.ok ? ...` shadowed the imported `node:path`
  inside the route loop — block-scoped so functional, but a latent footgun.
- **Fix:** renamed the local to `chosenPath`.
- **Files modified:** `tools/run-solver-timing-gate.mjs`
- **Commit:** `1cfc385`

### Scope note (not a code deviation)

- Full `npm run test:gate` four-route green bar is **deferred to the main-checkout run**
  because the source PDFs are gitignored and absent from the worktree (see Environment
  Constraint). This is an isolation limitation of parallel worktree execution, not a
  regression introduced by this plan.

---

**Total deviations:** 1 auto-fixed (1 bug) + 1 documented environment/scope note
**Impact on plan:** Timing gate delivered + wired as specified; the PDF-dependent four-route
green bar must be attested in the main checkout.

## Issues Encountered

- Source route PDFs gitignored/absent in worktree → PDF-driven gates unrunnable here
  (covered by Environment Constraint section).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Ready:** Phase 9 can consume the D-13 channel (`solverPath`, `solverDemoted`,
  `demotionReason`, `solverScore` + `warnings[]`) to surface confidence tiers without
  string-parsing.
- **Blocker for strict phase-exit attestation:** orchestrator must run `npm run test:gate`
  in the main checkout (PDFs present) to confirm the four-route green bar + the pre-existing
  `post-positioning.test.mjs` 3 failures (the standing blocker carried from 08-00).

## Self-Check: PASSED

- FOUND: tools/run-solver-timing-gate.mjs
- FOUND: parser/dwg/coordinate-calculator-dwg.js (solveGlobalGraphAlignment in runDwgPairingCascade)
- FOUND: parser/__tests__/global-solver-cascade.test.mjs
- FOUND: commit 646490a (Task 1)
- FOUND: commit 1cfc385 (Task 2)

---
*Phase: 08-global-pdf-dxf-solver*
*Completed: 2026-06-09*
