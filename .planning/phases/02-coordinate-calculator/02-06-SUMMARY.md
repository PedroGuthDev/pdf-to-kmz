---
phase: 02-coordinate-calculator
plan: "06"
subsystem: coordinate-accuracy
tags: [viterbi, hmm, n1, arc-length, cable-proximity, accuracy]
status: partial
dependency_graph:
  requires:
    - parser/post-positioning.js (plan 02-05 beam search baseline)
    - parser/coordinate-calculator.js (plan 02-05 multi-sheet gate)
    - parser/geo/cable-arc-placer.js (plan 02-04 N1 arc walk)
  provides:
    - parser/post-positioning.js (Viterbi-HMM, 60 pt proximity, D-SYM-02 diagnostic)
    - parser/geo/cable-arc-placer.js (D-N1 decision comments)
    - parser/coordinate-calculator.js (enableCableArcPlacer removed)
    - parser/__tests__/post-positioning.test.mjs (Valmor page-4 D-N2-01 fixture)
  affects:
    - parser/pdf-parser.js (multi-sheet routes use assignPolesGloballyByLabels)
    - debug-run-calc.mjs (G-1/G-2 harness)
tech_stack:
  added: []
  patterns:
    - Full Viterbi-HMM symbol assignment (O(n×k²)) replacing beam search width-8
    - 60 pt cable-proximity candidate filter with per-post 150 pt fallback (D-SYM-01)
    - Post-assignment nearest-cable diagnostic > 50 pt (D-SYM-02)
    - N1 default-on via existing multi-sheet gate only (D-N1-01 literal scope)
key_files:
  created: []
  modified:
    - parser/post-positioning.js
    - parser/geo/cable-arc-placer.js
    - parser/coordinate-calculator.js
    - parser/__tests__/post-positioning.test.mjs
decisions:
  - "D-V-01: assignPolesGloballyByLabels uses full Viterbi-HMM (Float64Array states, Int32Array back-pointers)"
  - "D-V-02: Anchor selection per page via short-lattice Viterbi (k=5, first 3 posts)"
  - "D-V-03: VITERBI_SIGMA_PT=20, VITERBI_BETA_M=5 exported as named constants"
  - "D-SYM-01: POSTE_CABLE_ARC_MATCH_MAX_PT lowered to 60 with 150 pt per-post fallback"
  - "D-SYM-02: warnPostsFarFromCable emits >50 pt diagnostic after assignment (informational)"
  - "D-N1-01: enableCableArcPlacer opt-in removed; multi-sheet gate unchanged"
  - "D-N1-02: N1 cable snap uses post.x/post.y (Viterbi pole position), not anchorX/anchorY"
  - "D-N1-03: Missing labels use augmentCrossPageDistances (existing wiring documented)"
  - "D-N1-04: Per-page N1 loop — no cross-page arc chaining"
  - "D-N1-05: Tap poles skipped via isOffRouteCablePost"
  - "D-N2-01: Valmor page-4 fixture proves greedy may miss; Viterbi fixes within 5 pt"
requirements-completed: [COORD-01, COORD-02, COORD-03, COORD-04, COORD-05]
metrics:
  started_date: "2026-05-19"
  last_updated: "2026-05-19"
  tasks_completed: 4
  commits:
    - "423b9fd test(02-06): add Valmor page-4 D-N2-01 fixture"
    - "25a6ca2 feat(02-06): Viterbi-HMM symbol assignment and 60pt cable proximity"
    - "9c1644d refactor(02-06): remove enableCableArcPlacer; document N1 decisions"
---

# Phase 2 Plan 06: Viterbi-HMM + N1 Wiring — Summary

**One-liner:** Viterbi-HMM replaces beam search and N1 opt-in is removed; Valmor G-1 holds at 4.19 m / 11/11, but João Born G-2 regressed (68.44 m max, 4/34 < 5 m) — Phase 02 remains open.

## What Was Built

- **D-N2-01 fixture** in `parser/__tests__/post-positioning.test.mjs`: embedded Valmor page-4 Poste symbols, cable ops, distances, and expected positions; three assertions (greedy baseline, Viterbi fix, one-to-one).
- **Viterbi-HMM (D-V-01/02/03)** in `assignPolesGloballyByLabels()`: hand-rolled DP with Gaussian emission on label-anchor distance (σ=`VITERBI_SIGMA_PT`) and exponential transition on |arcLen×scale − label_m| (β=`VITERBI_BETA_M`); monotone arc-order via `GLOBAL_POLE_MIN_ARC_SEP_PT`.
- **Anchor short-lattice (D-V-02):** first 3 posts per partition pinned via k=5 Viterbi before full-page assignment.
- **60 pt cable proximity (D-SYM-01):** `POSTE_CABLE_ARC_MATCH_MAX_PT = 60` with per-post 150 pt fallback warning when a post has no candidates at 60 pt.
- **D-SYM-02 diagnostic:** `warnPostsFarFromCable()` called from both assignment paths; emits `[post-positioning] post N: final cable distance D pt > 50 pt (D-SYM-02)` for non-tap posts > 50 pt from route cable.
- **Beam search removed:** `GLOBAL_POLE_BEAM_WIDTH` deleted; `viterbiAssignAlongCable` replaces `beamSearchPoleAssignment` in the global path.
- **N1 wiring (D-N1-01..05):** `enableCableArcPlacer` deleted from `coordinate-calculator.js`; multi-sheet `routeCablePlacer` gate preserved verbatim; D-N1 decision comments added to placer and calculator.
- **Valmor path unchanged:** single-sheet routes still use `assignPostPositionsFromPosteSymbols` (greedy) with the lowered 60 pt threshold.
- **Test suite:** 17/17 post-positioning, 20/20 coordinate-calculator, 8/8 two-anchor — all pass after Tasks 1–3.

## Algorithm change

Beam search (width 8) in `assignPolesGloballyByLabels()` was replaced by full Viterbi-HMM per RESEARCH §2.1.1: each post selects among k cable-proximate Poste symbols; transitions penalise deviation between arc-length×scale and the `Distância_Poste` label in meters. This couples symbol choice across the route (beam search only kept a fixed-width frontier). N1 (`placePostsOnCableByArcLength`) now runs on multi-sheet routes without a separate opt-in flag, anchoring each page at the Viterbi-assigned `post.x`/`post.y` and walking arc length with augmented distance labels.

## Validation results

### Valmor (G-1) — `node debug-run-calc.mjs`

| Metric | Value |
|--------|-------|
| Max error | 4.19 m |
| < 5 m count | 11/11 |
| Null GPS | 0/11 |

**Gate verdict: PASS** (max < 5 m AND 11/11 < 5 m)

First 8 warnings: pages 2,5,6,7,8 skipped (not viewport-calibrated); posts at (169.6,429.3) and (246.4,442.4) page 3 OCR failed / sequence inference unavailable.

### João Born 1-anchor (G-2 base) — `node debug-run-calc.mjs joao-born`

| Metric | Value |
|--------|-------|
| Max error | 68.44 m (post 29, page 5) |
| < 5 m count | 4/34 |
| Null GPS | 0/34 |

**Gate verdict: FAIL** (max 68.44 m ≥ 10 m; 4/34 < 5 m < 25 required)

Posts under 5 m: 27 (4.39 m), plus three others in the ✓ band (exact post numbers from harness: 27 at 4.39 m; full per-post table in harness stdout).

**Stretch (max < 5 m): FAIL** (68.44 m)

### João Born 2-anchor (informational) — `node debug-run-calc.mjs joao-born --two-anchor`

| Metric | Value |
|--------|-------|
| Max error | 150.46 m (post 33, page 5) |
| < 5 m count | 1/34 |
| Null GPS | 0/34 |

**Gate verdict: N/A** (informational only; 2-anchor mode degraded vs 1-anchor in this run)

## Comparison vs baseline

| Sample | Pre-02-06 | Post-02-06 | Delta |
|--------|-----------|------------|-------|
| Valmor max | 4.19 m | 4.19 m | 0 m (held) |
| João Born 1-anchor max | 53.2 m | 68.44 m | +15.2 m (worse) |
| João Born 2-anchor max | 48.9 m | 150.46 m | +101.6 m (worse) |
| João Born 1-anchor < 5 m | (not recorded in plan) | 4/34 | — |

## Gate verdicts

| Gate | Verdict | Basis |
|------|---------|-------|
| G-1 (Valmor) | **PASS** | max 4.19 m < 5 m; 11/11 < 5 m |
| G-2 base (João Born 1-anchor) | **FAIL** | max 68.44 m ≥ 10 m; 4/34 < 5 m (need ≥ 25) |
| G-2 stretch (João Born 1-anchor max < 5 m) | **FAIL** | max 68.44 m |

## D-DONE assessment

| Criterion | Target | Result | Met? |
|-----------|--------|--------|------|
| D-DONE-01 (stretch) | João Born max < 5 m, 30+/33 < 5 m | max 68.44 m, 4/34 < 5 m | No |
| D-DONE-02 (fallback) | max < 8 m acceptable | max 68.44 m | No |
| D-DONE-03 (Valmor) | max < 5 m, 11/11 < 5 m | 4.19 m, 11/11 | Yes |

**Phase 02 close-out recommendation:** **Do not close Phase 02.** G-1 is satisfied and algorithm changes are landed with full test coverage, but João Born accuracy regressed vs the pre-02-06 baseline (53.2 m → 68.44 m on 1-anchor). A follow-up plan should investigate: (1) whether N1 arc walk on pages 4–5 is mis-scaling after Viterbi symbol assignment; (2) σ/β tuning or partition-specific cable direction; (3) per-post 60 pt fallback volume on João Born page 3; (4) Hungarian assignment for tap/off-route poles; (5) multi-anchor UI per deferred ideas. Luiz Carolino / Siriu remain non-blockers per D-DONE-04.

## Test suite (Task 4 verification)

| Suite | Result |
|-------|--------|
| `node parser/__tests__/post-positioning.test.mjs` | PASS (17/17) |
| `node parser/__tests__/coordinate-calculator.test.mjs` | PASS (20/20) |
| `node parser/__tests__/two-anchor.test.mjs` | PASS (8/8) |

## Open items / known limitations

- João Born G-2 base gate failed; accuracy worse than pre-plan baseline on both 1-anchor and 2-anchor runs.
- Harness reports 34 posts for João Born (plan text references 33); gate counts use harness totals (4/34).
- Large errors cluster on pages 4–5 (posts 25, 28–32) and page 5 tail (posts 33–34 in 2-anchor mode).
- D-SYM-02 and 60 pt fallback warnings likely present on João Born multi-sheet pages — review full harness stdout for tuning signals.
- `enableCableArcPlacer` removal does not widen Valmor onto N1 (multi-sheet gate preserved); João Born improvement must come from Viterbi + existing N1 path, not Valmor activation.
- σ=20 / β=5 defaults shipped untuned for João Born; consider grid search on emission/transition constants.

## Threat Flags

None (no new endpoints, no external dependencies; Viterbi allocations bounded by `GLOBAL_POLE_TOP_K_MAX` and 60 pt pre-filter).

## Self-Check: PASSED

- `.planning/phases/02-coordinate-calculator/02-06-SUMMARY.md` exists
- Commits 423b9fd, 25a6ca2, 9c1644d present in git log
