---
phase: 08-global-pdf-dxf-solver
verified: 2026-06-09T00:00:00Z
status: gaps_found
score: 3/5 must-haves verified
overrides_applied: 0
gaps:
  - truth: "Siriu re-clears the 85-post regression gate and the LC per-post position gate with zero regression via a single green `npm run test:gate` bar (SOLVE-04 / D-06)"
    status: failed
    reason: >
      `npm run test:gate` exits 1 in the main checkout (the environment 08-03 deferred this very
      attestation to). The fixture chain stops at `post-positioning.test.mjs` (3 failures:
      D-N2-01 Valmor p4 x2 + circle-keep), so the four route position gates, the Siriu regression
      gate, the LC gate, AND the new solver timing gate are never reached in-chain. Independently,
      `tools/run-siriu-regression-gate.mjs` exits 1 with 106 failures (64 "no DWG error / missing
      pairing"). The single-green-bar phase-exit criterion is therefore NOT met in the codebase.
      NOTE: the Siriu regression failure and the post-positioning failures are PRE-EXISTING, not a
      Phase-8 regression — verified by swapping the pre-Phase-8 cascade file (no solver) back in and
      re-running: the regression gate still produces the identical 106 failures. The post-positioning
      3 failures are documented as out-of-scope Phase-7 carryover (commit 3f7f095). Phase 8 did not
      introduce these, but it also did not deliver the required green bar — the phase goal's
      "Siriu re-clears ... with zero regression" success condition is observably unsatisfied.
    artifacts:
      - path: "tools/run-siriu-regression-gate.mjs"
        issue: "exits 1, 106 failures (64 'no DWG error (missing pairing?)') — hard red-line RED"
      - path: "parser/__tests__/post-positioning.test.mjs"
        issue: "3 failures (pre-existing P7 carryover) block the test:gate chain before any route/solver gate runs"
    missing:
      - "Green `npm run test:gate` bar in the main checkout (currently exit 1)"
      - "Green Siriu regression gate (currently 106 failures) — DWG region pairing pipeline produces no pairing for 64 posts in this environment"
      - "Resolution of the pre-existing post-positioning.test.mjs blocker so the chain reaches the route + solver gates"
  - truth: "The topology gate's arc-order monotonicity (D-10 / SOLVE-03) is computed with a correct weighted shortest-path so it is sound on junction/cycle graphs"
    status: partial
    reason: >
      08-REVIEW.md CR-01 (CRITICAL, unresolved at HEAD) — `cableSpanAlongPath` (global-solver.js
      :119-138) is a hop-count BFS (FIFO `queue.shift()`, `visited` marked at enqueue, returns on
      first edge to reach target) used as if it were a weighted shortest-path. It is correct only on
      linear chains (where the unit fixtures live); on any graph with a junction or cycle — exactly
      the routes D-10 partitions runs at — it can return an arc position along a longer detour, so the
      monotonicity check can spuriously demote a correct assignment or pass a swapped one. The gate's
      verdict is unsound where it matters most. Unit tests are green only because every fork-arm fixture
      is itself linear.
    artifacts:
      - path: "parser/dwg/global-solver.js"
        issue: "cableSpanAlongPath (:119-138) is hop-count BFS, not Dijkstra — wrong arc positions on junction/cycle graphs"
    missing:
      - "Replace cableSpanAlongPath BFS with Dijkstra (settle node distance at pop, per CR-01 fix)"
      - "A topology-gate unit fixture with a non-trivial (multi-path) junction that exercises the shortest-path correctness"
  - truth: "The D-08 median scale guard fails loud (never returns ok:true) on degenerate input (SOLVE-03 scale-adaptive thresholds)"
    status: partial
    reason: >
      08-REVIEW.md CR-02 (CRITICAL, unresolved at HEAD) — median-crossval.js (:64-69) computes
      `ratio = medianPDF / medianDXF` and band-checks it WITHOUT first asserting the medians are
      non-null / non-zero. `medianOf` returns null on empty input; a null median yields ratio = NaN,
      and BOTH band comparisons (`ratio < 1/F || ratio > F`) evaluate false for NaN, so the guard
      returns `{ ok:true }` with NaN tolerances that then poison every downstream distance compare.
      A scale guard that can return ok:true on degenerate input is a fail-loud hole. The current
      length>0 pre-check (:60) does not cover this path.
    artifacts:
      - path: "parser/dwg/median-crossval.js"
        issue: "no null/zero-median + Number.isFinite(ratio) guard before band check (:64-69) — NaN bypasses scale-mismatch"
    missing:
      - "Guard medianPDF/medianDXF null and !(medianDXF>0) → reason:insufficient-data; guard !Number.isFinite(ratio) → scale-mismatch (per CR-02 fix)"
deferred: []
---

# Phase 8: Global PDF↔DXF Solver Verification Report

**Phase Goal:** A global Hungarian bipartite solver operates as cascade level-0, aligning the PDF numbered route-graph to the DXF cable-graph with anchor hard-constraint, arc-order monotonicity, and hub-degree matching; the existing graph-walker is kept untouched as the level-1 strangler-fig fallback; Siriu re-clears the 85-post regression gate and the LC per-post position gate with zero regression.
**Verified:** 2026-06-09
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SOLVE-01: Global Hungarian bipartite assignment (anchor, prune, cost, munkres, coords) | ✓ VERIFIED | `parser/dwg/global-solver.js` (760 lines) exports `solveGlobalGraphAlignment`; `import { munkres } from "munkres"`; munkres@2.0.3 in deps + node_modules present; `global-solver.test.mjs` green (identity-recovery, rectangular, no-anchor, scale-mismatch, immutability, elapsedMs) |
| 2 | SOLVE-03: anchor hard-constraint + arc-order monotonicity + hub-degree matching, scale-adaptive | ⚠️ PARTIAL | `checkTopologyGate` + `evaluateAcceptBar` exported; accept bar calls `applyResidualGate`; topology tests 10/10 green; anchor forced via -Infinity. BUT CR-01: monotonicity arc-position uses hop-count BFS (unsound on junctions); CR-02: scale guard NaN hole. Both CRITICAL, unresolved at HEAD |
| 3 | SOLVE-02: solver runs as cascade level-0, demotes to graph-walker (strangler-fig) | ✓ VERIFIED | `coordinate-calculator-dwg.js:155` calls solver BEFORE `pairPostsByGraphWalk` (:183); demote logs "solver demoted; using graph-walker" (:179) + pushes `{kind:"dwg-solver-demoted"}`; pristine inputs passed to walker; `global-solver-cascade.test.mjs` 5/5 green (accept-short-circuit, demote-walker-once, pristine deep-equal, Siriu byte-identical coords, D-13 fields) |
| 4 | Strangler-fig: existing graph-walker kept untouched | ✓ VERIFIED | `git diff 8af0260~1 HEAD -- parser/dwg/graph-walker.js` is EMPTY — graph-walker.js was not modified during Phase 8 (the only graph-walker edit, returnIdx, landed in Phase-7 commit e84798c, outside this phase's range) |
| 5 | SOLVE-04 / D-06: Siriu re-clears 85-post regression + LC per-post gate, zero regression, single green bar | ✗ FAILED | `npm run test:gate` exits 1 (main checkout, PDFs present). Chain stops at `post-positioning.test.mjs` (3 fail). `run-siriu-regression-gate.mjs` exits 1 / 106 failures. Pre-existing (reproduces with pre-P8 cascade), NOT a P8 regression — but the required green bar is observably absent |

**Score:** 3/5 truths verified (2 partial counted as not-verified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `parser/dwg/median-crossval.js` | D-08 scale guard, pure | ⚠️ STUB-RISK | 82 lines, exports medianCrossValidate/AGREEMENT_FACTOR/SPAN_TOL_FRAC/CANDIDATE_WINDOW_MULT; CR-02 NaN hole unresolved |
| `parser/dwg/global-solver.js` | solver core + topology gate + accept bar | ⚠️ CR-01 | 760 lines, exports solveGlobalGraphAlignment/checkTopologyGate/evaluateAcceptBar; CR-01 BFS arc-position unresolved |
| `parser/dwg/coordinate-calculator-dwg.js` | level-0 wiring + D-13 fields | ✓ VERIFIED | solver at :155 (before walker :183); D-13 fields solverPath/solverDemoted/demotionReason/solverScore at :500-503 |
| `tools/run-solver-timing-gate.mjs` | 2s budget per route | ✓ VERIFIED | Runs green: all 4 routes < 2000 ms (worst 7.6 ms); wired into package.json test:gate:fixtures |
| `parser/__tests__/*` (4 P8 suites) | unit coverage | ✓ VERIFIED (substantive) | 25/25 pass combined — but NOT wired into any npm script (see WR-05) |
| `package.json` / munkres | munkres@2.0.3 pinned | ✓ VERIFIED | "^2.0.3" in deps; node_modules/munkres present; no postinstall |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| coordinate-calculator-dwg.js | global-solver.js | level-0 call before walker | ✓ WIRED | solver :155, walker :183 (correct order) |
| global-solver.js | munkres | import { munkres } | ✓ WIRED | import present, package installed |
| global-solver.js | median-crossval.js | scale-derived tolerances | ✓ WIRED | medianCrossValidate consumed for spanTolM/candidateWindowM |
| global-solver.js | residual-gate.js | applyResidualGate === 'trust' accept-bar cond 1 | ✓ WIRED | evaluateAcceptBar calls applyResidualGate |
| coordinate-calculator-dwg.js | graph-walker.js | walker UNCHANGED on demote | ✓ WIRED | empty diff during P8; pristine params passed |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| P8 unit suites pass | `node --test median-crossval + global-solver + topology + cascade` | tests 25, pass 25, fail 0 | ✓ PASS |
| Solver 2s budget | `node tools/run-solver-timing-gate.mjs` | 4/4 routes < 2000ms (worst 7.6ms) | ✓ PASS |
| Full gate green bar | `npm run test:gate` | exit 1 (stops at post-positioning 3 fail) | ✗ FAIL |
| Siriu regression gate | `node tools/run-siriu-regression-gate.mjs` | exit 1, 106 failures | ✗ FAIL |
| Siriu regression is P8-caused? | swap pre-P8 cascade, re-run | identical 106 failures → NOT P8-caused (pre-existing) | ℹ INFO |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SOLVE-01 | 08-01 | Hungarian global bipartite assignment | ✓ SATISFIED | solver core + munkres + green unit suite |
| SOLVE-02 | 08-03 | solver cascade level-0 with walker fallback | ✓ SATISFIED | level-0 wiring + demote + D-13 + cascade tests |
| SOLVE-03 | 08-02 | anchor hard-constraint, monotonicity, hub-degree, scale-adaptive | ⚠️ PARTIAL | gate exists + green units, but CR-01 (BFS) + CR-02 (NaN) unresolved |
| SOLVE-04 | 08-03 | Siriu regression + LC per-post re-clear, zero regression | ✗ BLOCKED | test:gate RED; siriu regression gate RED (pre-existing, but unmet) |
| DXF-01..07 | 08-00 | (re-attestation only; Phase-6 shipped) | ⚠️ NEEDS HUMAN | 08-00 admits full test:gate was RED at attestation; DXF ingest unit tests pass standalone; not re-attestable green via the chain |

**Note on requirement ID scope:** Phase-goal IDs are SOLVE-01..04. Plan 08-00 additionally declares DXF-01..07 as a *re-attestation* (not a rebuild) — REQUIREMENTS.md maps DXF-01..07 to Phase 6 (already Complete). No orphaned Phase-8 SOLVE IDs. REQUIREMENTS.md still marks SOLVE-02 and SOLVE-04 as **Pending** (lines 81, 83), consistent with this verification's findings.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| coordinate-calculator-dwg.js | 179 | unconditional `console.log("solver demoted...")` on production path | ⚠️ Warning | WR-06: stdout noise in browser/prod; redundant with warnings.push next line |
| global-solver.js | 119-138 | hop-count BFS used as weighted shortest-path | 🛑 Blocker | CR-01: unsound monotonicity on junction/cycle graphs |
| median-crossval.js | 64-69 | NaN ratio bypasses band check | 🛑 Blocker | CR-02: scale guard returns ok:true on degenerate input |
| package.json | 11-14 | 4 P8 correctness suites absent from test/test:unit/test:gate | ⚠️ Warning | WR-05: solver regressions invisible to CI; only timing gate (wall-clock) wired |
| global-solver.js | 541-544, 192-203 | duplicate `_testAssignments` alias; unused `coords` param w/ `void` | ℹ Info | IN-01/IN-02 code smell |

### Human Verification Required

None routed to human — all checkable items were verifiable programmatically in this environment (PDFs present). The DXF-01..07 re-attestation gap is an artifact of the test:gate chain being RED upstream, not a UI/visual check.

### Gaps Summary

Three artifact families are fully delivered, substantive, wired, and unit-green: the Hungarian solver
core (SOLVE-01), the cascade level-0 strangler-fig wiring with D-13 fields (SOLVE-02), the topology
gate + D-05 accept bar plumbing (SOLVE-03 structurally), the 2s timing gate, and the munkres install.
graph-walker.js was genuinely untouched during Phase 8 (empty diff), honoring the strangler-fig
contract. 25/25 Phase-8 unit tests and the timing gate are green.

However, the phase goal's load-bearing success condition — "Siriu re-clears the 85-post regression
gate and the LC per-post position gate with zero regression" expressed as a single green
`npm run test:gate` bar — is NOT achieved in the codebase. In the main checkout (where the source
PDFs exist, unlike the 08-03 worktree that deferred this attestation), `npm run test:gate` exits 1:
it halts at the pre-existing `post-positioning.test.mjs` 3 failures, and the Siriu regression gate
itself exits 1 with 106 failures. I isolated the cause: swapping the pre-Phase-8 cascade (no solver)
back in reproduces the identical 106 regression-gate failures, proving these are PRE-EXISTING
environmental/baseline failures, NOT a regression introduced by Phase 8. The post-positioning
failures are documented Phase-7 out-of-scope carryover. So Phase 8 caused no new regression — but
it also did not deliver the green bar the phase goal requires, and that bar is the contractual
SOLVE-04 / D-06 exit criterion.

Two unresolved CRITICAL code-review findings (08-REVIEW.md, status issues_found, HEAD) further
weaken SOLVE-03 soundness: CR-01 (topology arc-position is a hop-count BFS, mathematically wrong on
the junction/cycle graphs the gate exists to police) and CR-02 (median scale guard NaN hole that can
return ok:true on degenerate input). These pass current unit tests only because the fixtures are
linear/symmetric. WR-05 compounds the risk: none of the four Phase-8 correctness suites are wired
into `npm test`/`test:unit`/`test:gate`, so a future solver regression would be invisible to CI.

**Recommendation:** Route to `/gsd:plan-phase --gaps`. The green-bar gap requires either fixing the
pre-existing post-positioning + Siriu-regression-gate environment blocker (so SOLVE-04 can be
genuinely attested green), or an explicit human decision/override that the pre-existing failures are
accepted and SOLVE-04 is closed by an alternative route-level attestation. The two CRITICAL review
findings should be closed before the solver is trusted as an emitting (non-demoting) path.

---

_Verified: 2026-06-09_
_Verifier: Claude (gsd-verifier)_
