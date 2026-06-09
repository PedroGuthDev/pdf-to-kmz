---
status: complete
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
  artifacts: []
  missing: []

- truth: "applyResidualGate returns gateDecision trust only when BOTH shape and anchor sub-scores pass their trust thresholds"
  status: failed
  reason: "User reported: applyResidualGate suite: 'trust only when BOTH shape and anchor pass' fails; fail-on-anchor, fallback band, UNRESOLVABLE, tier-label-only, and HIGH-when-both-pass tests all pass"
  severity: major
  test: 2
  artifacts: []
  missing: []

- truth: "Running a DWG coordinate calculation on Siriu returns dwgConfidence with gateDecision and postTiers on the success result"
  status: failed
  reason: "User reported: gateDecision: undefined, postTiers count: undefined, sample tiers: undefined (Siriu harness one-liner after full PDF parse)"
  severity: major
  test: 4
  artifacts: []
  missing: []

- truth: "node tools/run-residual-gate.mjs exits 0 with LC→fail(anchor), Valmor→not fail, all routes returning a defined gateDecision"
  status: failed
  reason: "User reported: valmor: decision=fallback (anchorP95=16.6m); joaoborn/luizcarolino: decision=fail; lc-mustfail passes anchor-cause checks — but siriu returns no decision and gate exits 1"
  severity: major
  test: 6
  artifacts: []
  missing: []

- truth: "npm run test:gate exits 0 including residual gate"
  status: failed
  reason: "User reported: npm run test:gate exit 1; post-positioning.test.mjs 21 passed 3 failed; chain aborts before siriu-regression and residual gate"
  severity: major
  test: 7
  artifacts: []
  missing: []
