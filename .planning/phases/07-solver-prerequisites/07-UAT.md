---
status: testing
phase: 07-solver-prerequisites
source: 07-01-SUMMARY.md, 07-02-SUMMARY.md, 07-03-SUMMARY.md, 07-04-SUMMARY.md, 07-05-SUMMARY.md, 07-06-SUMMARY.md, 07-07-SUMMARY.md
started: 2026-06-09T18:00:00Z
updated: 2026-06-09T18:00:00Z
---

## Current Test

number: 1
name: Full test:gate Umbrella
expected: Run `npm run test:gate` from the repo root (with route PDFs, Palhoca.dxf, and node_modules present). The command runs all 17 Phase 7 gates — unit suites, four position gates, four txt-accuracy gates, junction oracles, Siriu regression, residual gate, and DXF timing — and exits 0 with no failures.
awaiting: user response

## Tests

### 1. Full test:gate Umbrella

expected: Run `npm run test:gate` — all 17 gates pass, exit 0
result: [pending]

### 2. Four Per-Post Position Gates

expected: Run each `node tools/run-{siriu,lc,joaoborn,valmor}-post-position-gate.mjs` — Siriu 85/85 max 0.00 pt, LC 20/20, JB 34/34, Valmor 11/11; all exit 0
result: [pending]

### 3. Junction Ground-Truth Oracles

expected: Run `node --test parser/__tests__/branch-traversal*.test.mjs` — 21 tests pass / 0 fail; JB and Valmor linear (junctions {}), LC junction at post 7 with spur to post 21
result: [pending]

### 4. txt GPS Accuracy Gates

expected: Siriu and Valmor txt-accuracy gates exit 0 with zero bad-tier posts; LC and JB gates exit 0 as soft fences (bad-tier posts listed to stderr with "deferred to Phase 8" header, but process still exits 0)
result: [pending]

### 5. LC Layer-B Collapse Fix

expected: LC position gate passes (posts 9/10/11 no longer collapsed onto shared symbols); Siriu position gate remains byte-identical (max error 0.00 pt) proving the fix did not regress Siriu
result: [pending]

### 6. Gate Audit Document

expected: `.planning/phases/07-solver-prerequisites/07-GATE-AUDIT.md` exists and classifies every active gate as regression FENCE or accuracy ASSERTION, with D-18 hard red-lines and soft mid-flight fences annotated
result: [pending]

### 7. Pre-Solver Baseline Cascade

expected: `.planning/phases/07-solver-prerequisites/07-BASELINE-CASCADE.md` records all four routes with tier histograms and residual decisions; confirms no solver code present (munkres-js absent); LC 21–31 must-fail fixture still shows decision=fail
result: [pending]

## Summary

total: 7
passed: 0
issues: 0
pending: 7
skipped: 0
blocked: 0

## Gaps

[none yet]
