# Phase 09 — Deferred / Out-of-Scope Items (discovered during 09-01 execution)

Logged per the executor SCOPE BOUNDARY rule. These are pre-existing on `main` and
NOT caused by Plan 09-01 changes.

## 1. `npm run test:gate` cannot run in this worktree — missing PDF fixtures
`tools/run-residual-gate.mjs` and the other route gates require the source PDF files
(e.g. `INFOVIAS_PJC INTERNET_Garopaba_Praia do Siriu_v01.pdf`) which are large binaries
present only in the primary working tree, not committed to git. In the isolated
worktree they are absent, so every gate "threw (... missing PDF ...)" and the residual
baseline reports "present in baseline but not produced this run".

- Status: environmental (worktree isolation), pre-existing, not introduced by 09-01.
- Action for orchestrator: run `npm run test:gate` in the primary working tree (with
  PDFs present) after merge to confirm zero accuracy regression. The 09-01 changes are
  additive-only over return shapes and touch no coordinate/connection/threshold logic,
  so no regression is expected.

## 2. Pre-existing boundary mismatch in residual-gate.test.mjs line 132
The test `"trust only when BOTH shape and anchor pass"` passed `p95GapM: 10` and
expected `gateDecision === "trust"`. But `ANCHOR_TRUST_M = 10` was LOCKED in commit
62336ca (Phase 05-02) to a strict `p95Gap < ANCHOR_TRUST_M`, so `10 < 10` is false and
the route resolves to `"fallback"`. The test (authored earlier at 05-01) was never
updated for the strict boundary.

- Status: pre-existing test/threshold inconsistency on `main`.
- Resolution in 09-01: since this same test file is in Task 1's `<files>` and Task 1's
  acceptance requires the file to exit 0, the test input was corrected to `p95GapM: 9`
  (clearly inside the locked `< 10` trust band). The LOCKED threshold constant was NOT
  changed. Documented as a Rule 1 (test-correctness) fix.

## 3. `post-positioning.test.mjs` — 3 pre-existing failures (discovered during 09-03)
Running `npm run test:gate:fixtures` exercises `parser/__tests__/post-positioning.test.mjs`,
which reports `21 passed, 3 failed` on `main` BEFORE any 09-03 change. The three failures:
  - `[post-positioning] keeps circle when raw pole already matches Numero_Poste ring`
    — "post 4 kept when raw symbol matches circle"
  - `[D-N2-01 baseline] greedy assignment Valmor p4 max symbol-distance < 30 pt`
  - `[D-N2-01 fix] Viterbi assignment Valmor p4 max symbol-distance < 5 pt`

- Status: pre-existing on `main`, in `parser/post-positioning.js` coordinate-assignment
  logic. Confirmed independent of 09-03 by re-running the test with `browser/main.js`
  reverted to base — failure count was identical (`21 passed, 3 failed`).
- Out of scope for Plan 09-03: this plan is a pure presentation/surfacing layer touching
  only `index.html` and `browser/main.js`. It does not import or modify post-positioning
  logic, so it cannot have caused or be expected to fix these failures (SCOPE BOUNDARY).
- Action for orchestrator/owner: triage the Valmor p4 Viterbi assignment + circle-keep
  regressions separately (they relate to Phase 07/08 post-positioning work, not Phase 09).
