---
phase: 07-solver-prerequisites
plan: 03
subsystem: testing
tags: [position-gate, fixtures, valmor, layer-b, regression-gates, D-06]

# Dependency graph
requires:
  - 07-01 (truth foundation: importer + position-gate pattern)
provides:
  - Valmor per-post PDF position gate (D-06) — hand-verified anchors, all 11 posts
  - tools/run-valmor-post-position-gate.mjs (layer-B placement lock for Valmor)
  - parser/__tests__/fixtures/valmor-post-positions-truth.json
affects: [08-solver]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Layer-B position gate cloned from JB/LC gate — swap PDF_PATH/TRUTH_PATH/env-var only"
    - "D-06 viability assertion: parse must yield >=11 finite-x,y posts or exit non-zero with explicit blocker"
    - "UPDATE_BASELINE branch dumps anchorX/anchorY to stderr for hand-verification"

key-files:
  created:
    - tools/run-valmor-post-position-gate.mjs
    - parser/__tests__/fixtures/valmor-post-positions-truth.json
  modified: []

key-decisions:
  - "Valmor PDF parse viability PROVEN (D-06): parses 11 posts with finite x,y across pages 3-4; NOT exempted as DWG-only"
  - "tolerancePt held at 50 (hand-anchor capture imprecision); actual max err 0.6 pt"
  - "Fixture locked at 11 posts (pages 3 and 4) per user verification"

patterns-established:
  - "Per-route position gate: dynamic import parsePdf + Math.hypot vs hand-known truth"

requirements-completed: [SOLVE-05]

# Metrics
duration: 4min
completed: 2026-06-08
tasks-completed: 2
files-touched: 2
---

# Phase 7 Plan 03: Valmor Position Gate Summary

Valmor per-post PDF position gate (D-06) cloned from the JB/LC gate, backed by user-verified hand-known PDF pole anchors for all 11 Valmor posts. Valmor was previously treated as DWG-only; this plan first PROVED the Valmor PDF parses with usable per-post pole symbols (D-06 forbids exempting it), then locked the gate — the third of the four SOLVE-05 layer-B position gates feeding the Phase 8 solver.

## What Was Built

- **`tools/run-valmor-post-position-gate.mjs`** (201 lines): clone of `run-joaoborn-post-position-gate.mjs` with `PDF_PATH`, `TRUTH_PATH`, and the `VALMOR_POST_POS_TOL_PT` env-var swapped. Keeps `import "fake-indexeddb/auto"`, dynamic-imports `parsePdf`, parses an `ArrayBuffer` slice of the Valmor PDF, compares each parsed post against truth via `Math.hypot`, and exits 1 on any failure. Includes the `VALMOR_POST_POS_UPDATE_BASELINE=1` baseline-capture branch (dumps per-post `{ number, pageNum, x, y }` plus `anchorX/anchorY` to stderr). The D-06 viability assertion is added: if the PDF fails to parse or yields fewer than 11 usable poles, it prints the explicit blocker ("escalate per D-06; do NOT exempt Valmor") and exits non-zero — no fixture written.
- **`parser/__tests__/fixtures/valmor-post-positions-truth.json`** (79 lines): `_meta` block (`source: "hand-known anchors, Valmor v1"`, `scope: "all posts"`, `tolerancePt: 50`, `postCount: 11`) + `posts[]` covering all 11 Valmor posts (posts 1-6 on page 3, posts 7-11 on page 4).

## Verification

`node tools/run-valmor-post-position-gate.mjs` (no env flag) exits 0:

```
posts=11/11, mean err=0.4 pt, max=0.6 pt, tol=50 pt
PASS — all 11 posts within 50 pt of expected position.
```

All 11 posts parse and land within 0.6 pt of their hand-known anchors.

## D-06 Viability Outcome

The Valmor PDF parse viability is PROVEN, not a blocker. The parse yields 11 posts (`ocrResults=11 rawPosts=11 final posts=11`, numbers 1-11) with finite numeric x,y across pages 3 and 4. Valmor is NOT exempted as DWG-only — it now carries a real per-post PDF position gate exactly like Siriu, LC, and JB.

## Human-Verify Checkpoint (Task 2)

The candidate anchor dump was presented to the user for spot-check against the PDF sheet `INFOVIAS_PJC INTERNET_Palhoça_RUA VALMOR FRANCISCO_v1.pdf`. User response:

> "Aprovado — 11 postes, páginas corretas"

All 11 posts confirmed present with correct page assignments (1-6 on page 3, 7-11 on page 4). Fixture locked as the Valmor position truth.

## Deviations from Plan

None — plan executed exactly as written. The candidate fixture captured in Task 1 (commit 012ff29) required no corrections after human verification.

## Self-Check: PASSED

- FOUND: tools/run-valmor-post-position-gate.mjs
- FOUND: parser/__tests__/fixtures/valmor-post-positions-truth.json
- FOUND: commit 012ff29 (Task 1)
- Gate exits 0 (no env flag), 11/11 posts within tolerance (max 0.6 pt)
