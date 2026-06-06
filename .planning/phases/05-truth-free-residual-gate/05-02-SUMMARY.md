---
phase: 05-truth-free-residual-gate
plan: 02
subsystem: testing
tags: [residual-gate, ci-gate, anchor-threshold, calibration, fixture, dwg-confidence]

# Dependency graph
requires:
  - phase: 05-01
    provides: computeResiduals, computeAnchorGap, applyResidualGate pure functions
  - phase: 04 (coordinate-calculator-dwg)
    provides: cascade success path with gpsByPostNumber + cascade.coords
provides:
  - "parser/dwg/coordinate-calculator-dwg.js — additive dwgConfidence attachment on cascade success path (D-01)"
  - "ANCHOR_* thresholds LOCKED: TRUST=10m, FALLBACK=15m, FAIL=20m (user-specified strict accuracy)"
  - "parser/__tests__/fixtures/luizcarolino-residual-mustfail.json — real LC posts 21-31 must-fail fixture (anchor cause)"
  - "tools/run-residual-gate.mjs — CI gate: LC→fail(anchor), Valmor→fallback, no-crash assertion"
  - "npm run test:gate chain extended with residual gate (ACC-04)"
affects: [P7/P8 (active demotion uses dwgConfidence), P9 (KMZ tier surfacing)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive pure-judge pattern: attach dwgConfidence to successResult, zero coordinate byte change (D-01)"
    - "Strict accuracy thresholds: ANCHOR_TRUST_M=10, FAIL_M=20 — <10m=trust, >20m=fail"
    - "CI gate baseline/UPDATE_BASELINE pattern mirroring run-route-dwg-accuracy-gate.mjs"

key-files:
  created:
    - tools/run-residual-gate.mjs
    - parser/__tests__/fixtures/luizcarolino-residual-mustfail.json
    - parser/__tests__/fixtures/residual-gate-baseline.json
  modified:
    - parser/dwg/coordinate-calculator-dwg.js
    - parser/dwg/residual-gate.js
    - tools/route-dwg-accuracy-harness.mjs
    - package.json

key-decisions:
  - "ANCHOR thresholds set to user-specified strict values: TRUST_M=10, FALLBACK_M=15, FAIL_M=20 (overrides plan's calibrate-from-Siriu assumption)"
  - "Siriu anchor p95=192m is a legitimate 'fail' under strict thresholds — only Valmor (16.6m p95) lands in fallback"
  - "CI gate asserts LC→fail-by-anchor and Valmor→not-fail; Siriu/João Born are expected failures (not false-fail guarded)"
  - "dwgConfidence attached after successResult assembly, before userWarnings; no coordinate/connection byte change (D-01 verified by Siriu regression gate)"

patterns-established:
  - "Pattern: calibrate thresholds from user accuracy requirement, not route-specific tuning — prevents threshold gaming"

requirements-completed: [ACC-02, ACC-03, ACC-04]

# Metrics
duration: 30min
completed: 2026-06-06
---

# Phase 5 Plan 02: Truth-Free Residual Gate (integration + CI gate) Summary

**Residual gate wired as pure judge (`dwgConfidence`) into the DWG cascade success path, ANCHOR_* thresholds locked at 10/15/20m (user-specified strict accuracy), LC posts-21-31 real-capture must-fail fixture committed, and full CI gate running in `npm run test:gate`.**

## Performance

- **Duration:** ~30 min (two agent sessions)
- **Started:** 2026-06-05
- **Completed:** 2026-06-06
- **Tasks:** 3 auto + 1 human-verify checkpoint
- **Files modified:** 7 (3 created, 4 modified)

## Accomplishments
- Wired `computeResiduals` / `computeAnchorGap` / `applyResidualGate` into `coordinate-calculator-dwg.js` success path (additive only — D-01). `successResult.dwgConfidence` attached before `userWarnings`; cascade-fail early-return untouched. Siriu regression gate (85 posts, byte-identical output) remains green.
- Calibrated and LOCKED `ANCHOR_TRUST_M=10`, `ANCHOR_FALLBACK_M=15`, `ANCHOR_FAIL_M=20` in `residual-gate.js` — user-specified strict accuracy: below 10m is trustworthy, above 20m is fail.
- Built real LC posts 21-31 must-fail fixture (`luizcarolino-residual-mustfail.json`). Live anchor p95=301m >> 20m; shape median=12.8% < 15% SHAPE_FALLBACK — fixture isolates the anchor sub-score as the cause (`shapeAloneFails=false`). Satisfies ACC-03.
- Created `tools/run-residual-gate.mjs` CI gate (mirrors `run-route-dwg-accuracy-gate.mjs`): slackM, UPDATE_BASELINE pattern, failure list → exit 1. Asserts LC→"fail"(anchor), Valmor→not "fail", all routes run without crash.
- Appended `&& node tools/run-residual-gate.mjs` to `package.json scripts.test:gate` (ACC-04). `npm run test:gate` exits 0 (full chain: 16 unit tests + Siriu regression + residual gate).

## Task Commits

1. **Task 1: Wire residual gate into cascade success path** — `b96bd76` (feat)
2. **Task 2(a): Expose `dwgConfidence` from route-dwg-accuracy harness** — `b2b6a3f` (feat)
3. **Task 2(b/c/d): Lock ANCHOR thresholds + LC fixture + CI gate + baseline** — `62336ca` (feat)
4. **Task 3: Hook residual gate into `npm run test:gate`** — `ef41cac` (feat)

## Files Created/Modified
- `parser/dwg/coordinate-calculator-dwg.js` — added import + 3-line gate invocation on success path
- `parser/dwg/residual-gate.js` — ANCHOR_* placeholders replaced with LOCKED values (10/15/20m)
- `tools/route-dwg-accuracy-harness.mjs` — added `dwgConfidence: result.dwgConfidence ?? null` to return shape
- `tools/run-residual-gate.mjs` — CI gate: Siriu/Valmor/João Born/LC run, LC fixture assertion
- `parser/__tests__/fixtures/luizcarolino-residual-mustfail.json` — real captured LC posts 21-31 coords (anchor cause)
- `parser/__tests__/fixtures/residual-gate-baseline.json` — CI baseline snapshot
- `package.json` — test:gate chain extended

## Decisions Made
- **Strict accuracy thresholds (user override):** The plan assumed Siriu would be the calibration "trust" anchor. Live measurement: Siriu anchor p95=192m — far above any meaningful accuracy threshold. User specified ANCHOR_TRUST_M=10 / ANCHOR_FAIL_M=20 as explicit accuracy requirements. These were locked as-is. Under these thresholds only Valmor (p95=16.6m) avoids "fail" — landing in "fallback". Siriu/João Born/LC all legitimately fail on anchor.
- **CI gate assertion scope:** Only Valmor (→ "fallback") and LC (→ "fail" by anchor) are strongly asserted. Siriu and João Born are run end-to-end (no-crash guarantee) without a false-fail guard, since their large anchor gaps are genuine signals.
- **dwgConfidence field name:** Kept consistent with existing `dwgStatus`/`dwgRegionId` siblings on `successResult` (D-01 Claude's-Discretion).

## Deviations from Plan

### Decision Escalated (Rule 4)

**1. [Rule 4 - Architectural] Threshold calibration conflict — plan's "Siriu → trust" assertion unreachable**
- **Found during:** Task 2 calibration.
- **Issue:** Live Siriu anchor p95=192m; LC anchor historical ~178m. A single `ANCHOR_FAIL_M` cannot simultaneously be > 192m (to not fail Siriu) and < 178m (to fail LC) — they overlap. The plan's must-have "Siriu → trust" and "LC → fail" were mutually exclusive under any real-valued threshold.
- **Fix:** Escalated to user. User specified strict accuracy thresholds: TRUST_M=10, FAIL_M=20. Plan's "Siriu → trust" CI assertion replaced with "no-crash" guarantee. Valmor (16.6m p95) becomes the non-fail sanity route.
- **Files modified:** parser/dwg/residual-gate.js (threshold values), tools/run-residual-gate.mjs (assertion logic).
- **Committed in:** `62336ca`.

### Auto-fixed Issues

**2. [Rule 3 - Blocking] Worktree missing PDFs + node_modules/pdfjs-dist**
- **Found during:** Task 1 verification (Siriu regression gate).
- **Issue:** Git worktrees don't copy gitignored assets; the hard-coded relative worker path in `parser/pdf-parser.js:27-30` pointed to a nonexistent worktree path → all PDFs returned `parse_failed`.
- **Fix:** Restored 4 route PDFs + `siriu.dxf` + `Palhoca.dxf` + `node_modules/pdfjs-dist` from main checkout.
- **Verification:** Siriu regression gate: `PASS — coords=85`, 22/22 unit tests passing.
- **Impact:** Not committed (gitignored assets).

---

**Total deviations:** 1 Rule 4 escalated (threshold design conflict), 1 Rule 3 auto-fixed (worktree assets).
**Impact on plan:** Rule 4 required user decision — resulted in stricter and more honest thresholds than the plan assumed. All plan requirements (ACC-02, ACC-03, ACC-04) met.

## Issues Encountered
None beyond the deviations documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `dwgConfidence` is attached on every DWG cascade success. P7/P8 (active demotion) and P9 (KMZ tier surfacing) can consume `result.dwgConfidence.gateDecision` and `result.dwgConfidence.postTiers` directly.
- The locked accuracy thresholds (10/15/20m) establish the project's official DWG quality bar. Future routes should be measured against these to understand their anchor quality.
- Refresh the CI baseline (`RESIDUAL_UPDATE_BASELINE=1 node tools/run-residual-gate.mjs`) if route PDFs/DXF change significantly.

---
*Phase: 05-truth-free-residual-gate*
*Completed: 2026-06-06*
