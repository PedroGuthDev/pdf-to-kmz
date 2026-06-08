---
phase: 07-solver-prerequisites
plan: 04
subsystem: parser/junction-ground-truth
tags: [junction-oracle, ground-truth, dfs-traversal, phantom-edge-defense, solver-prereq]
requires:
  - "parser/branch-traversal.mjs walkBranchGraph (DFS-with-slots traversal)"
  - "parser/__tests__/branch-traversal.test.mjs (Siriu clone source)"
  - "parser/__tests__/fixtures/siriu-junction-ground-truth.json (schema reference)"
provides:
  - "parser/__tests__/fixtures/luizcarolino-junction-ground-truth.json (LC, junction post 7, USER-APPROVED)"
  - "parser/__tests__/fixtures/joaoborn-junction-ground-truth.json (JB, linear, junctions: {}, D-14)"
  - "parser/__tests__/fixtures/valmor-junction-ground-truth.json (Valmor, linear, junctions: {})"
  - "parser/__tests__/branch-traversal-{lc,joaoborn,valmor}.test.mjs (per-route DFS oracles)"
affects:
  - "Phase 8 global solver input graph (clean junction GT for all 4 named routes)"
tech-stack:
  added: []
  patterns:
    - "Per-route junction ground-truth fixture cloned from the Siriu schema"
    - "D-15.2 global no-inferred-degree>=3 oracle in every route test"
    - "Edge source tagging (declared|inferred) for inferred-only subgraph defense"
key-files:
  created:
    - parser/__tests__/fixtures/joaoborn-junction-ground-truth.json
    - parser/__tests__/fixtures/valmor-junction-ground-truth.json
    - parser/__tests__/branch-traversal-lc.test.mjs
    - parser/__tests__/branch-traversal-joaoborn.test.mjs
    - parser/__tests__/branch-traversal-valmor.test.mjs
  modified:
    - parser/__tests__/fixtures/luizcarolino-junction-ground-truth.json
decisions:
  - "LC junction is at post 7 (NOT post 9) — USER-APPROVED 2026-06-08"
  - "JB confirmed locked linear (junctions: {}, 34-post chain) — D-14"
  - "Valmor confirmed linear (junctions: {}) — D-13"
metrics:
  duration: "~1 continuation session"
  completed: "2026-06-08"
  tasks: 3
  files: 6
---

# Phase 7 Plan 04: Junction Ground-Truth Oracle for LC/JB/Valmor Summary

Clean junction ground-truth fixtures + per-route DFS-oracle tests for the three remaining
named routes (Luiz Carolino, João Born, Valmor), completing the Pitfall-10 phantom-edge
defense for the Phase 8 solver input graph (Siriu already covered).

## What Was Built

- **luizcarolino-junction-ground-truth.json** — ONE real junction at post 7 (degree 3):
  inbound from post 6, main route continues to post 8, spur arm heads to post 21 (first post
  of the 21→31 spur). Single 1→20 spine + 7→21→…→31 spur. Every edge `source: "declared"`.
- **joaoborn-junction-ground-truth.json** — LOCKED linear (D-14): `junctions: {}`, consecutive
  1→…→34 chain only.
- **valmor-junction-ground-truth.json** — linear (D-13): `junctions: {}`, consecutive 1→…→11 chain.
- **branch-traversal-{lc,joaoborn,valmor}.test.mjs** — clones of the Siriu DFS oracle with the
  FIXTURE path swapped, the two Siriu-specific blocks (cross-page 62→81, junction-60 inbound)
  dropped, and the D-15.2 global no-inferred-degree>=3 block added.

## Verification

`node --test parser/__tests__/branch-traversal-lc.test.mjs parser/__tests__/branch-traversal-joaoborn.test.mjs parser/__tests__/branch-traversal-valmor.test.mjs`
→ **15 tests, 15 pass, 0 fail, exit 0** (5 blocks × 3 routes).

Each route asserts: every post visited exactly once, (degree-1) arms exposed per junction with
correct slot consumption, GT arms/meters reproduced, no phantom arms incident, and no
degree≥3 junction arises from inferred-label edges alone (D-15.2 — inferred subgraph empty,
passes trivially but the rule is encoded for Phase 8).

## Deviations from Plan

### LC Junction Correction (post 9 → post 7) — Task 3 user approval

- **Found during:** Task 3 checkpoint (human-verify).
- **Issue:** The Task-1 DRAFT placed the LC bifurcation at post 9 (arms 8-inbound/10/21),
  inferred from the 260602-decouple phantom pairs which were themselves anchored to a
  post-9 junction assumption.
- **User correction (2026-06-08):** The real bifurcation is between posts 6 and 7 — the
  junction post is **7**, not 9. Post 21 is the spur head (connects westward before post 22).
  There is exactly ONE real junction in LC.
- **Fix:** Rewrote the fixture: junction at post 7 (inbound 6, main route 8, spur 21);
  main chain collapsed to a single 1→20 spine (posts 8/9/10/11 are now plain consecutive
  spine steps, no longer junction arms); spur 7→21→…→31. `forbiddenArms: []` on post 7
  because none of the original phantoms (3→1, 11→8, 9→11) are incident to post 7 under the
  corrected topology — they remain asserted absent via the empty inferred-only subgraph
  (D-15.2) and are documented in the fixture `_phantomNote`.
- **Files modified:** parser/__tests__/fixtures/luizcarolino-junction-ground-truth.json
- **Commit:** efab260

### JB / Valmor — confirmed as drafted

User confirmed both routes are linear (`junctions: {}`); no changes needed. JB locked per
D-14, Valmor per D-13.

## User Approvals (Task 3)

| Route | Outcome |
|-------|---------|
| João Born | Confirmed LOCKED linear (junctions: {}, 34-post chain) — D-14 |
| Valmor | Confirmed linear (junctions: {}) — D-13 |
| Luiz Carolino | Corrected: junction at post 7 (not post 9); single junction; spur head at post 21 |

## Authentication Gates

None.

## Known Stubs

None. All fixtures carry real declared topology; the all-declared graphs make the D-15.2
inferred-only oracle pass on an empty subgraph by design (documented), not as a stub.

## Self-Check: PASSED

- Files exist: 3 fixtures + 3 test files present on disk.
- Commits exist: 71170ae (T1), a22b801 (T2), efab260 (T3) in `git log`.
- Tests: 15/15 pass, exit 0.
