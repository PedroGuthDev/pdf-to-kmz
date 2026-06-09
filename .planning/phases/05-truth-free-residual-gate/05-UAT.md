---
status: diagnosed
phase: 05-truth-free-residual-gate
source: 05-01-SUMMARY.md, 05-02-SUMMARY.md
started: 2026-06-09T12:00:00Z
updated: 2026-06-09T12:35:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Residual Gate Unit Tests
expected: Run `node --test parser/__tests__/residual-gate.test.mjs` — all 12 tests pass covering median≠mean, invalid-edge skipping, anchor-gap math, gate decisions, and UNRESOLVABLE tiering.
result: issue
reported: "11/12 pass; failing test 'trust only when BOTH shape and anchor pass' — AssertionError: expected gateDecision 'trust', got 'fallback' (actual vs expected at residual-gate.test.mjs:137)"
severity: major

### 2. Two-Gate Trust Decision
expected: `applyResidualGate` returns gateDecision "trust" only when BOTH shape and anchor sub-scores pass their trust thresholds; either hard-fail yields "fail"; middle band yields "fallback".
result: issue
reported: "applyResidualGate suite: 'trust only when BOTH shape and anchor pass' fails; fail-on-anchor, fallback band, UNRESOLVABLE, tier-label-only, and HIGH-when-both-pass tests all pass"
severity: major

### 3. ANCHOR Thresholds Locked
expected: `parser/dwg/residual-gate.js` exports ANCHOR_TRUST_M=10, ANCHOR_FALLBACK_M=15, ANCHOR_FAIL_M=20 (user-specified strict accuracy bar, not placeholders).
result: pass

### 4. dwgConfidence on DWG Cascade Success
expected: Running a DWG coordinate calculation on a known route (e.g. Siriu) returns `dwgConfidence` on the success result with `gateDecision` and `postTiers`; coordinate bytes unchanged from pre-gate baseline.
result: issue
reported: "gateDecision: undefined, postTiers count: undefined, sample tiers: undefined (Siriu harness one-liner after full PDF parse)"
severity: major

### 5. LC Must-Fail Fixture (Anchor Cause)
expected: `parser/__tests__/fixtures/luizcarolino-residual-mustfail.json` drives a gate decision of "fail" caused by anchor (shapeAloneFails=false); anchor p95 well above 20m FAIL threshold.
result: pass

### 6. Residual CI Gate
expected: Run `node tools/run-residual-gate.mjs` — exits 0; asserts LC→fail(anchor), Valmor→not fail, all routes run without crash.
result: issue
reported: "valmor: decision=fallback (anchorP95=16.6m); joaoborn/luizcarolino: decision=fail; lc-mustfail(21-31): decision=fail anchorCausesFail=true shapeAloneFails=false — but gate exits 1: siriu gate returned no decision (undefined), baseline mismatch"
severity: major

### 7. Full test:gate Chain
expected: Run `npm run test:gate` — full chain exits 0, including residual gate appended after Siriu regression gate.
result: issue
reported: "npm run test:gate exit 1; post-positioning.test.mjs 21 passed 3 failed (post 4 circle match, Valmor D-N2-01 baseline/fix); chain aborts before siriu-regression and residual gate in this run"
severity: major

## Summary

total: 7
passed: 2
issues: 5
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "Run node --test parser/__tests__/residual-gate.test.mjs — all 12 tests pass"
  status: failed
  reason: "User reported: 11/12 pass; failing test 'trust only when BOTH shape and anchor pass' — AssertionError: expected gateDecision 'trust', got 'fallback' (actual vs expected at residual-gate.test.mjs:137)"
  severity: major
  test: 1
  root_cause: "Unit test uses p95GapM=10 exactly at ANCHOR_TRUST_M boundary; applyResidualGate requires strict p95Gap < ANCHOR_TRUST_M (10 < 10 is false) → fallback not trust"
  artifacts:
    - path: "parser/__tests__/residual-gate.test.mjs"
      issue: "line 135: p95GapM: 10 should be < 10 for trust (e.g. 9.9)"
    - path: "parser/dwg/residual-gate.js"
      issue: "line 175: anchorPasses = p95Gap < ANCHOR_TRUST_M (strict less-than, documented as <10m)"
  missing:
    - "Align test fixture with strict <10m trust boundary OR document inclusive boundary if product intent changes"
  debug_session: ""

- truth: "applyResidualGate returns gateDecision trust only when BOTH shape and anchor sub-scores pass their trust thresholds"
  status: failed
  reason: "User reported: applyResidualGate suite: 'trust only when BOTH shape and anchor pass' fails; fail-on-anchor, fallback band, UNRESOLVABLE, tier-label-only, and HIGH-when-both-pass tests all pass"
  severity: major
  test: 2
  root_cause: "Same boundary bug as test 1 — only the trust-at-exactly-10m case fails; all other two-gate paths pass"
  artifacts:
    - path: "parser/__tests__/residual-gate.test.mjs"
      issue: "trust test p95GapM: 10 at boundary"
  missing:
    - "Fix trust test input to p95GapM < 10"
  debug_session: ""

- truth: "Running a DWG coordinate calculation on Siriu returns dwgConfidence with gateDecision and postTiers on the success result"
  status: failed
  reason: "User reported: gateDecision: undefined, postTiers count: undefined, sample tiers: undefined (Siriu harness one-liner after full PDF parse)"
  severity: major
  test: 4
  root_cause: "Siriu DWG cascade fails (dwgStatus pdf-fallback) before success path attaches dwgConfidence; warnings include dwg-pair-fail at post 3 (nearest 15.5m > 15m tolerance) and dwg-graph-walk-fail at post 24 no-candidate"
  artifacts:
    - path: "parser/dwg/coordinate-calculator-dwg.js"
      issue: "dwgConfidence only on cascade.ok success path (line ~503)"
    - path: "parser/dwg/coordinate-calculator-dwg.js"
      issue: "cascade returns pdf-fallback when pairing/walk fails"
  missing:
    - "Restore Siriu cascade success OR attach dwgConfidence on fallback path with degraded verdict"
  debug_session: ""

- truth: "node tools/run-residual-gate.mjs exits 0 with LC→fail(anchor), Valmor→not fail, all routes returning a defined gateDecision"
  status: failed
  reason: "User reported: valmor: decision=fallback (anchorP95=16.6m); joaoborn/luizcarolino: decision=fail; lc-mustfail passes anchor-cause checks — but siriu returns no decision and gate exits 1"
  severity: major
  test: 6
  root_cause: "run-residual-gate.mjs requires every route to return dwgConfidence.gateDecision; Siriu live run hits pdf-fallback (same cascade failure as test 4) → null decision → baseline mismatch exit 1"
  artifacts:
    - path: "tools/run-residual-gate.mjs"
      issue: "lines 76-78: fails when dc.gateDecision == null"
  missing:
    - "Fix Siriu cascade success OR relax gate to tolerate Siriu pdf-fallback with explicit skip/baseline update"
  debug_session: ""

- truth: "npm run test:gate exits 0 including residual gate"
  status: failed
  reason: "User reported: npm run test:gate exit 1; post-positioning.test.mjs 21 passed 3 failed; chain aborts before siriu-regression and residual gate"
  severity: major
  test: 7
  root_cause: "test:gate chain aborts at post-positioning.test.mjs (3 failures: post-4 circle match, Valmor D-N2-01 baseline/fix) before reaching run-siriu-regression-gate.mjs and run-residual-gate.mjs; separate from residual-gate logic but blocks full CI green"
  artifacts:
    - path: "parser/__tests__/post-positioning.test.mjs"
      issue: "3 failing assertions abort test:gate:fixtures chain"
  missing:
    - "Fix or triage post-positioning regressions so gate chain reaches residual gate"
  debug_session: ""
