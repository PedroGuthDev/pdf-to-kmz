---
phase: 09-diagnostic-failure-confidence-surfacing
plan: 01
subsystem: dwg-confidence-gate
tags: [residual-gate, confidence, hardBlock, diverged-at-post, additive-return-shape]
requires:
  - "parser/dwg/residual-gate.js applyResidualGate (Phase 05)"
  - "parser/dwg/coordinate-calculator-dwg.js successResult/miss exits (Phase 08)"
provides:
  - "applyResidualGate return: per-post shapeResidualM/anchorGapM + top-level overall tier"
  - "successResult.dwgConfidence.overall (route-level gate-gated worst-case tier)"
  - "explicit hardBlock boolean on every result exit (block-vs-flag, no string-sniffing)"
  - "formatDwgWarning diverged-at-post Portuguese kind (meters, no %)"
affects:
  - "Plan 09-02 (KMZ tier styles/ExtendedData) consumes per-post sub-scores + overall"
  - "Plan 09-03 (UI status banner/hard-block gating) consumes overall + hardBlock"
tech-stack:
  added: []
  patterns:
    - "additive return-shape discipline (never rename/remove/reorder existing fields)"
    - "pure read of { gateDecision, postTiers } for overall — no tier recompute"
    - "structured { kind, ... } warning → formatDwgWarning switch (one taxonomy)"
key-files:
  created:
    - "parser/__tests__/coordinate-calculator-dwg-conf.test.mjs"
  modified:
    - "parser/dwg/residual-gate.js"
    - "parser/__tests__/residual-gate.test.mjs"
    - "parser/dwg/coordinate-calculator-dwg.js"
decisions:
  - "overall HIGH-but-not-trust maps to 'med' (gate trust is a hard precondition for 'high')"
  - "ANCHOR_FALLBACK_M re-declared locally (DIVERGED_ANCHOR_FALLBACK_M=15), not imported, not mutating the gate constant"
  - "both miss exits (catch + if !region) set hardBlock:true; cascade-fail-after-match + success set hardBlock:false"
metrics:
  duration: "~25 min"
  completed: 2026-06-09
  tasks: 2
  files: 4
---

# Phase 9 Plan 01: Confidence Signal Surfacing Data-Source Summary

Made three additive changes so every Phase-9 downstream sink can read confidence/failure signals without recomputing anything: per-post `shapeResidualM`/`anchorGapM` meters + a route-level `overall` tier on `applyResidualGate`, and an explicit `hardBlock` boolean plus a Portuguese `diverged-at-post` warning at the calculator assembly point.

## What Was Built

### Task 1 — per-post sub-scores + overall tier in `applyResidualGate` (D-06/D-08)
- Each `postTiers[]` entry now carries `shapeResidualM` (worst incident edge residual in metres, sourced from the same edge that drives the post's max `relError`, or `null`) and `anchorGapM` (the post's anchor gap, or `null`). Tier VALUES are byte-identical — a parallel `incidentResidualM` map was added so the tier logic still reads `incidentRel` (relError) untouched.
- New top-level `overall ∈ {high, med, low, unresolvable}`: `"high"` ONLY when `gateDecision === "trust"` AND every post is HIGH (or there are no posts); otherwise the worst material per-post tier mapped to lowercase, with HIGH-but-not-trust collapsing to `"med"`. This is a pure read over `{ gateDecision, postTiers }` — no threshold or tier recompute.
- Threshold constants (SHAPE_TRUST / SHAPE_FALLBACK / ANCHOR_TRUST_M / ANCHOR_FALLBACK_M / ANCHOR_FAIL_M) are unchanged.
- Commit: `fe04297`

### Task 2 — overall + hardBlock + diverged-at-post at the calculator (D-08/D-09/D-12/D-13)
- Added an explicit boolean `hardBlock` to all four result exits: `true` on the catch/region-lookup miss and the no-region miss (both carry `dwgNoRegion` → BLOCK), `false` on cascade-fail-after-match (region matched, then degraded → FLAG) and on success. The UI no longer needs to string-sniff `dwgStatus`.
- Added `case "diverged-at-post"` to `formatDwgWarning`, rendering `DXF: rota divergiu no poste <N> (resíduo <X.X> m).` with `Number(residual_m).toFixed(1)` and no `%`.
- On success, the worst-gap post in `anchor.perPost` is read (no new math); if its gap crosses the fallback band (`DIVERGED_ANCHOR_FALLBACK_M = 15`, a local re-declaration of the gate's locked constant, never mutating it), a `{ kind:"diverged-at-post", at_post, residual_m }` object is pushed into `successResult.warnings`.
- `overall` lands on `successResult.dwgConfidence` automatically via the Task 1 gate change — no extra attach.
- Commit: `32da245`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Pre-existing residual-gate boundary test was failing on `main`**
- **Found during:** Task 1 (baseline run before edits)
- **Issue:** `residual-gate.test.mjs:132` passed `p95GapM: 10` expecting `gateDecision === "trust"`, but `ANCHOR_TRUST_M = 10` was locked to a strict `< 10` in Phase 05-02 (commit 62336ca). `10 < 10` is false → route resolved to `"fallback"`, so the test (and thus `node --test residual-gate.test.mjs`) exited 1 before any of my changes.
- **Fix:** Corrected the test input to `p95GapM: 9` (clearly inside the locked `< 10` trust band). The LOCKED threshold constant was NOT changed. This test file is in Task 1's `<files>` and Task 1's acceptance requires the file to exit 0, so the fix is in scope.
- **Files modified:** parser/__tests__/residual-gate.test.mjs
- **Commit:** fe04297

## Deferred Issues (out of scope — pre-existing, not caused by this plan)

Logged to `.planning/phases/09-diagnostic-failure-confidence-surfacing/deferred-items.md`:

1. **`npm run test:gate` cannot run in this worktree — missing PDF fixtures.** The route gates and `tools/run-residual-gate.mjs` require large source PDFs that live only in the primary working tree (not committed to git). In the isolated worktree they are absent, so the gates throw "missing PDF" and the residual baseline reports "present in baseline but not produced this run." This is an environmental/worktree-isolation artifact, not a regression. The orchestrator should run `npm run test:gate` in the primary working tree after merge; the 09-01 changes are additive-only over return shapes and touch no coordinate/connection/threshold logic, so no accuracy regression is expected.

## Verification Results

- `node --test parser/__tests__/residual-gate.test.mjs` → exit 0 (18 tests pass)
- `node --test parser/__tests__/coordinate-calculator-dwg-conf.test.mjs` → exit 0 (3 tests pass)
- `node --test ...dwg-no-region.test.mjs residual-gate.test.mjs ...dwg-conf.test.mjs` → 23/23 pass (existing no-region calculator test unbroken by additive changes)
- `grep hardBlock parser/dwg/coordinate-calculator-dwg.js` → 4 exits (lines 317/344 true, 463/503 false)
- No `%` in the `diverged-at-post` arm or any new string
- Threshold constants in residual-gate.js unchanged (SHAPE_TRUST=0.05, SHAPE_FALLBACK=0.15, ANCHOR_TRUST_M=10, ANCHOR_FALLBACK_M=15, ANCHOR_FAIL_M=20)
- `npm run test:gate` NOT run here (missing PDF fixtures — see Deferred Issues; orchestrator runs it in the primary tree post-merge)

## Threat Surface

No new security-relevant surface introduced. All new field values are numeric (`at_post`, `residual_m` via `Number().toFixed`, gap meters) or fixed enum labels; no raw user text is interpolated. Downstream KML/DOM escaping is owned by Plans 02/03 per the plan's threat register (T-09-01). Zero new dependencies (T-09-SC).

## Self-Check: PASSED

- FOUND: parser/dwg/residual-gate.js
- FOUND: parser/__tests__/residual-gate.test.mjs
- FOUND: parser/dwg/coordinate-calculator-dwg.js
- FOUND: parser/__tests__/coordinate-calculator-dwg-conf.test.mjs
- FOUND: .planning/phases/09-diagnostic-failure-confidence-surfacing/09-01-SUMMARY.md
- FOUND commit: fe04297 (Task 1)
- FOUND commit: 32da245 (Task 2)
- FOUND commit: f0d7b5d (docs/SUMMARY)
