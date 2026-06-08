---
phase: 07-solver-prerequisites
plan: 02
subsystem: testing
tags: [position-gate, fixtures, joao-born, layer-b, regression-gates]

# Dependency graph
requires:
  - 07-01 (joaoborn-ground-truth.json: 34-post route, post 35 outlier excluded)
provides:
  - JB per-post PDF position gate (D-05) — hand-verified anchors, all 34 posts
  - tools/run-joaoborn-post-position-gate.mjs (layer-B placement lock for JB)
  - parser/__tests__/fixtures/joaoborn-post-positions-truth.json
affects: [08-solver]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Layer-B position gate cloned from LC gate — swap PDF_PATH/TRUTH_PATH/env-var only"
    - "UPDATE_BASELINE branch dumps anchorX/anchorY to stderr for hand-verification"

key-files:
  created:
    - tools/run-joaoborn-post-position-gate.mjs
    - parser/__tests__/fixtures/joaoborn-post-positions-truth.json
  modified: []

key-decisions:
  - "JB post 4 anchor confirmed by user at (500, 357) — correct pole symbol on the PDF sheet"
  - "tolerancePt held at 50 (hand-anchor capture imprecision); actual max err 0.7 pt"
  - "Fixture locked at 34 posts (post 35 was the excluded Siriu-coordinate outlier from 07-01)"

patterns-established:
  - "Per-route position gate: dynamic import parsePdf + Math.hypot vs hand-known truth"

requirements-completed: [SOLVE-05]

# Metrics
duration: 5min
completed: 2026-06-08
tasks-completed: 2
files-touched: 2
---

# Phase 7 Plan 02: João Born Position Gate Summary

JB per-post PDF position gate (D-05) cloned from the LC gate, backed by user-verified hand-known PDF pole anchors for all 34 João Born posts — the layer-B placement lock feeding the Phase 8 solver.

## What Was Built

- **`tools/run-joaoborn-post-position-gate.mjs`** (181 lines): exact clone of `run-lc-post-position-gate.mjs` with `PDF_PATH`, `TRUTH_PATH`, and the `JOAOBORN_POST_POS_TOL_PT` env-var swapped. Keeps `import "fake-indexeddb/auto"`, dynamic-imports `parsePdf`, compares each parsed post against truth via `Math.hypot`, and exits 1 on any failure. Includes the `JOAOBORN_POST_POS_UPDATE_BASELINE=1` baseline-capture branch (mirrors the Siriu `seedTruth` convention) that dumps per-post `{ number, pageNum, x, y }` plus `anchorX/anchorY` to stderr for hand-verification.
- **`parser/__tests__/fixtures/joaoborn-post-positions-truth.json`** (217 lines): `_meta` block (`source: "hand-known anchors, JB v04"`, `scope: "all posts"`, `tolerancePt: 50`) + `posts[]` covering all 34 JB posts.

## Verification

`node tools/run-joaoborn-post-position-gate.mjs` (no env flag) exits 0:

```
posts=34/34, mean err=0.4 pt, max=0.7 pt, tol=50 pt
PASS — all 34 posts within 50 pt of expected position.
```

All 34 posts parse and land within 0.7 pt of their hand-known anchors.

## Human-Verify Checkpoint (Task 2)

The candidate anchor dump was presented to the user for spot-check against the PDF sheet `INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf`. User response:

> "Approved — (500, 357) é o símbolo correto para o poste 4. Fixture bloqueado."

Post 4 anchor confirmed at (500, 357) as the correct pole symbol. Fixture locked as the JB position truth. Route confirmed at 34 posts (post 35 was the Siriu-coordinate outlier excluded in 07-01).

## Deviations from Plan

None — plan executed exactly as written. The fixture captured in Task 1 (commit dfcfe22) required no corrections after human verification.

## Self-Check: PASSED

- FOUND: tools/run-joaoborn-post-position-gate.mjs
- FOUND: parser/__tests__/fixtures/joaoborn-post-positions-truth.json
- FOUND: commit dfcfe22 (Task 1)
- Gate exits 0 (no env flag), 34/34 posts within tolerance
