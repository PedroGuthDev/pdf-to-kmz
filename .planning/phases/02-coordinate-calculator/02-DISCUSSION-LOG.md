# Phase 2: Coordinate Calculator - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-19
**Phase:** 02-coordinate-calculator
**Areas discussed:** N1 default enablement, Viterbi-HMM for anchor/assignment, N2 root cause, Phase 02 done criteria, 144-symbol boundary (Phase 01 filtering)

---

## N1 Default Enablement

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, remove the gate (default ON) | Enable N1 whenever Cabo Projetado is detected. G-1 guard catches any regression. | ✓ |
| Enable by default but keep a kill-switch | Default ON, keep `enableCableArcPlacer: false` as override for unreliable cable. | |
| Keep as opt-in, validate João Born first | One manual test before removing gate. | |

**User's choice:** Remove the opt-in gate — N1 always ON when Cabo Projetado is present.

---

### N1 arc anchor input

| Option | Description | Selected |
|--------|-------------|----------|
| Use anchorX/anchorY (label centroid) | Proved more accurate than pole.x/pole.y on Valmor page 4 (N2 revert evidence). | |
| Viterbi-HMM for anchor post only | Replace greedy snap with short Viterbi lattice for anchor post. | |
| [Free text] | "the label position is not our goal, we aim for the post symbol position" | ✓ |

**User's choice:** Pole symbol position (post.x/post.y) → cable snap as the arc anchor input. The pole IS on the cable; the label is a readability offset.

**Notes:** This depends on Viterbi (D-V-01) having correctly assigned the symbol first. With Viterbi, post.x/post.y should be the correctly assigned symbol position. The D-N2-01 unit test will confirm this before N1 is wired.

---

### N1 missing-label fallback

| Option | Description | Selected |
|--------|-------------|----------|
| Euclidean distance from `augmentCrossPageDistances` | Already implemented, zero new code. | ✓ |
| Skip arc walk, fall back to Phase 01 position | Posts with missing labels lose N1's benefit. | |
| You decide (hybrid) | Use augmentCrossPageDistances + repairPostsOnUncalibratedPages. | |

**User's choice:** `augmentCrossPageDistances()` — the existing implementation.

---

## Viterbi-HMM for Anchor Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — replace beam search with Viterbi | Full O(n×k²), ~30 lines JS, globally optimal. | ✓ |
| Keep beam search, widen it | Width 8 → 20, add arc-length term. Still approximate. | |
| Defer Viterbi — let N1 carry the weight first | Enable N1, measure João Born, add Viterbi only if needed. | |

**User's choice:** Replace beam search with Viterbi-HMM.

---

### Viterbi parameters

| Option | Description | Selected |
|--------|-------------|----------|
| Use research defaults (sigma=15pt, beta=15m) | Web research recommendations. | |
| You decide based on João Born geometry | João Born: posts ~35m apart, labels accurate to 0.1m. | ✓ |
| Make them constants only | Module-level constants for easy tuning. | |

**User's choice:** Claude's discretion — recommended sigma=20pt, beta=5m. Expose as named constants.

---

### Viterbi scope (assignment vs anchor)

| Option | Description | Selected |
|--------|-------------|----------|
| Viterbi for full assignment; greedy for anchor | Simpler; anchor error is corrected by arc-walk. | |
| Viterbi for both assignment AND anchor selection | Best accuracy; short lattice (k=5, first 3 posts) for anchor. | ✓ |
| You decide | Use greedy for anchor since N1 corrects it anyway. | |

**User's choice:** Viterbi for both full assignment AND anchor selection.

---

## N2 Root Cause Diagnostic

| Option | Description | Selected |
|--------|-------------|----------|
| Let N1 bypass the issue | N1 overwrites interior posts; anchor error is correctable. | |
| Diagnose page-4 mismatch before N1 | Add unit test fixture; fix the assignment bug; then wire N1. | ✓ |
| Accept anchorX/anchorY for arc anchor | Use label centroid for cable-snap, avoiding the regression entirely. | |

**User's choice:** Diagnose first — add unit test for `assignPostPositionsFromPosteSymbols` on Valmor page-4 cases.

---

### Diagnostic form

| Option | Description | Selected |
|--------|-------------|----------|
| Debug flag in `debug-run-calc.mjs` | Print post.x/post.y vs anchorX/anchorY per post. Zero production code changes. | |
| Unit test fixture for page-4 | Test fixture with Valmor page-4 symbols and known correct assignment. | ✓ |
| You decide | Compare anchor=pole vs anchor=label during N1 implementation. | |

**User's choice:** Unit test in `parser/__tests__/post-positioning.test.mjs`.

---

## Phase 02 Done Criteria

| Option | Description | Selected |
|--------|-------------|----------|
| João Born passes G-2 (max <10m, 25+/33 <5m, 1-anchor) | Realistic close-out gate per the plan. | |
| João Born G-2 AND stretch (<5m max, 1-anchor) | Higher bar — validates N1+Viterbi eliminates all major errors. | ✓ |
| Valmor + João Born G-2 + one more PDF in harness | Broader validation; delays closure. | |

**User's choice:** João Born G-2 AND stretch goal: max <5m, 1-anchor.

---

### If stretch goal is not reached

| Option | Description | Selected |
|--------|-------------|----------|
| Accept <8m max if plan stack exhausted | Close Phase 02 if N1+Viterbi+N4 combined can't reach 5m. | ✓ |
| Keep iterating until <5m or hard blocker | Never close until 5m is reached. | |
| Promote gap to Phase 02-B | Close at G-2 (10m), open Phase 02-B for stretch. | |

**User's choice:** Accept <8m max as Phase 02 close if the N1+Viterbi+N4 stack is exhausted.

---

## 144-Symbol Boundary (Phase 01 Filtering)

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — filter in Phase 01 (60 pt threshold) | Reduces candidates to ~14 before Viterbi runs. | ✓ |
| No — filter in Phase 02 via N1 cable proximity check | Existing 80 pt check in arc-placer handles it. | |
| Both — Phase 01 coarse + Viterbi fine | Defense in depth. | |

**User's choice:** Tighten Phase 01 cable-proximity threshold from 150 pt to 60 pt (~22m).

---

### Threshold value

| Option | Description | Selected |
|--------|-------------|----------|
| 60 pt (~22m) — tight | Eliminates off-route building symbols and most tap poles. | ✓ |
| 80 pt (~29m) — moderate | Consistent with N1 arc-placer threshold. | |
| You decide — tune empirically | Start at 80 pt, tune via harness. | |

**User's choice:** 60 pt — tight threshold to aggressively reduce noise before Viterbi.

---

## Claude's Discretion

- **Viterbi parameters:** sigma=20 PDF pt, beta=5m — chosen based on João Born page 3 geometry (posts ~35m apart, labels accurate to 0.1m). Exposed as named module-level constants for easy tuning.
- **Arc-length anchor fall-through:** If Viterbi still doesn't fix page-4 symbol mismatch, fall back to anchorX/anchorY for the cable snap (D-N2-01 unit test will reveal whether this is needed).
- **N1 arc-overflow handling:** When `pointAtArcLength` returns null (cable overshot), keep original pole position and emit a warning.

## Deferred Ideas

- Luiz Carolino + Siriu harness validation — follow-up after Phase 02 close
- Kalman smoothing for long routes (Siriu, ~85 posts)
- Hungarian for tap pole assignment (current greedy is sufficient for Valmor)
- N8 multi-anchor UI — deferred until algorithm stack exhausted
- Per-page GPS anchors — only if N1+Viterbi+N4 can't reach <8m
