---
phase: 07-solver-prerequisites
plan: 06
subsystem: post-positioning (PDF layer B)
status: complete
completed: "2026-06-08"
tags: [lc-fix, layer-b, position-gate, additive-predicate, siriu-safe]
requires: ["07-01", "07-02", "07-03", "07-04", "07-05"]
provides: ["lc-position-gate-green", "shared-symbol-collapse-restore"]
affects: [parser/post-positioning.js, parser/__tests__/post-positioning.test.mjs, parser/__tests__/fixtures/luizcarolino-post-positions-truth.json]
tech-stack:
  added: []
  patterns: ["generic-predicate-not-literal-guard (260601-k1a)", "additive layer-B pass", "all-green checkpoint discipline (D-11)"]
key-files:
  created: [".planning/phases/07-solver-prerequisites/deferred-items.md"]
  modified: ["parser/post-positioning.js", "parser/__tests__/post-positioning.test.mjs", "parser/__tests__/fixtures/luizcarolino-post-positions-truth.json"]
decisions:
  - "07-06-T1 = layerb-only (user-resolved): P7 fixes the LC layer-B collapse (posts 9/10/11); posts 21-31 rigid offset stays a Phase 8 solver target."
  - "Discriminator for Siriu-safety = (far from OWN free anchor) AND (clustered with another such post). Anchor-free + cluster together select exactly LC {9,10,11}, zero Siriu/JB/Valmor."
requirements: [SOLVE-05]
commits:
  - cd22f64  # test(07-06-T2): failing test for LC shared-symbol collapse restore (RED)
  - c98dc28  # feat(07-06-T2): restoreSharedSymbolCollapsedPosts predicate (GREEN)
  - 1691c46  # docs(07-06-T2): finalize LC position truth _meta.scope (layerb-only)
  - 3f7f095  # docs(07-06): log pre-existing Valmor unit failures (out of scope)
metrics:
  tasks: 2
  files-changed: 3
  files-created: 1
---

# Phase 7 Plan 6: LC Layer-B Shared-Symbol Collapse Fix Summary

LC per-post position gate greened (mean 32.7 pt → 0.4 pt) via an additive,
generic-geometry predicate `restoreSharedSymbolCollapsedPosts` that restores
posts collapsed onto a wrong/shared pole symbol back to their own free label
anchor — with the Siriu 1.0-pt position gate staying byte-identical (max 0.00 pt)
and every other Phase-7 gate green.

## Task 1 (07-06-T1) — Scope decision: RESOLVED by user = layerb-only

The user pre-resolved the checkpoint. **Decision: layerb-only.**

- P7 fixes the LC layer-B collapse only: posts 9/10/11 (and any other
  position-gate failure within posts 1-20).
- Posts 21-31 (the ~179 m rigid absolute-position offset) stay a Phase 8 solver
  target. The Phase 5 residual gate keeps `lc-mustfail(21-31)` as a must-fail
  fixture (verified still `decision=fail`, `anchorCausesFail=true`).
- The 07-05 LC txt-accuracy gate stays as-is (posts 21-31 already excluded from
  its zero-bad-tier exit rule via `EXCLUDED_POSTS`); no re-widening done.
- The LC txt-accuracy zero-bad-tier rule is a soft fence (D-18), to be marked in
  the 07-07 gate audit.

No automation/fixture re-widening was performed for T1 — skipped directly to T2
and recorded the decision in `luizcarolino-post-positions-truth.json` `_meta.scope`.

## Task 2 (07-06-T2) — Additive layer-B predicate (TDD, all-green discipline)

### Root cause (diagnosed by probing the live parse)

Posts 9/10/11 live on page-4 partition path 1, where the N3 Viterbi assignment
**fails** and the greedy fallback packs them onto wrong/shared pole symbols:

| post | collapsed x,y | own label anchor (= correct) |
|------|---------------|------------------------------|
| 9    | (338, 343)    | (295, 509)                   |
| 10   | (305, 302)    | (283, 562)  *(shared w/ 11)* |
| 11   | (305, 302)    | (319, 518)  *(shared w/ 10)* |

Each post's `anchorX/anchorY` (the Numero_Poste label centroid, computed
**independently** of pole-symbol assignment) equals its correct position. The
collapse is the assignment moving x/y far from that free anchor.

### The Siriu-safe discriminator (the hard part — Pitfall 2)

A naive "snap to anchor when x/y diverges from anchor" predicate would have
wrecked Siriu: **7 Siriu posts legitimately diverge** from their anchors
(junction/branch posts 5,6,7,42,50,66,72). Probing showed the safe discriminator
is the conjunction:

1. assigned (x,y) diverges from its OWN label anchor by > 60 pt, **AND**
2. that anchor is **FREE** (no other post's final x,y within 30 pt), **AND**
3. it sits in a degenerate **CLUSTER** — another post that also satisfies (1)+(2)
   lies within 60 pt of its assigned (x,y).

Conditions (2)+(3) are exactly what separate the LC greedy-fallback collapse
(posts packed together, correct anchors empty) from Siriu's legitimate off-anchor
placements (junction posts on real distinct poles, anchor occupied or lone).
Verified across all four routes: the predicate selects **exactly LC {9,10,11}**
and **zero Siriu / João Born / Valmor** posts.

### Implementation

- **`parser/post-positioning.js`** — added `restoreSharedSymbolCollapsedPosts(posts, warnings)`
  (exported) + three tuning constants (`COLLAPSE_ANCHOR_DIVERGENCE_PT=60`,
  `COLLAPSE_ANCHOR_FREE_PT=30`, `COLLAPSE_CLUSTER_PT=60`), wired as the final pass
  in `assignPolesGloballyByLabels` (restored indices added to `snappedPosts`).
  The predicate snapshots assigned (x,y) of all candidates **before** mutating any
  post, so restoring one collapsed post cannot dissolve the cluster that qualified
  its neighbours (a subtle bug found and fixed during TDD — see below).
- **No Siriu-calibrated assignment constant was touched** (Viterbi/cable/arc
  thresholds untouched). The new constants are clearly documented as collapse-restore
  tunables, not assignment thresholds.

### TDD cycle

- **RED** (cd22f64): test imports `restoreSharedSymbolCollapsedPosts` (doesn't exist)
  → `SyntaxError: does not provide an export`. Test fixtures cover LC {9,10,11} restore
  + Siriu-safe guards (occupied-anchor untouched, lone-off-anchor untouched).
- **GREEN** (c98dc28): predicate implemented; all 6 new collapse assertions pass.
  First implementation had an order-dependent bug — mutating x/y mid-loop dissolved
  the cluster, stranding the third post. Fixed by snapshotting candidate positions
  up front and running both predicate stages against the snapshot.

## Verification — full all-green checkpoint suite (D-11)

Run after the fix; every gate green at the final checkpoint:

| Gate | Result |
|------|--------|
| `run-lc-post-position-gate.mjs` | **PASS** — 20/20, mean 0.4 pt, max 0.7 pt (was RED: 9/10/11 @ 171/261/216 pt) |
| `run-siriu-post-position-gate.mjs` (1.0 pt red-line) | **PASS** — 85/85, max **0.00 pt** (byte-identical) |
| `run-joaoborn-post-position-gate.mjs` | PASS — 34/34 |
| `run-valmor-post-position-gate.mjs` | PASS — 11/11 |
| 4 junction tests (Siriu/LC/JB/Valmor) | PASS — 21 tests, 0 fail |
| `run-siriu-regression-gate.mjs` | PASS — dwg-graph-walk, walkOk |
| `run-residual-gate.mjs` | PASS — lc-mustfail(21-31) still `decision=fail` |
| 4 txt-accuracy gates | PASS (Siriu/Valmor 0 bad; LC/JB soft-fence) |
| `run-route-joaoborn-pdf-accuracy-gate.mjs` | PASS |
| `run-valmor-accuracy-gate.mjs` | PASS — mean 2.22 m |
| `npm run test:gate` (umbrella) | **PASS** (after copying gitignored PDFs/.dxf into worktree) |

## Deviations from Plan

### None required to the plan's approach.

The plan was executed as written (T1 pre-resolved, T2 TDD additive predicate).
Two environment/scope notes:

- **[Env] Worktree was spawned from a stale base** (53 commits behind main, 0
  ahead). Reset the per-agent branch to `main` at startup (sanctioned worktree
  branch-check reset; HEAD on `worktree-agent-*`, not a protected ref, nothing to
  lose). Route PDFs, `.dxf`, and `node_modules` are gitignored / absent in the
  worktree — copied the PDFs and `.dxf` from the main checkout and junction-linked
  `node_modules` so the gates could run. None of these are committed (gitignored).

- **[Scope boundary] Three pre-existing failures** in
  `parser/__tests__/post-positioning.test.mjs` (Valmor p4 greedy/Viterbi
  symbol-distance unit assertions) are present on the pristine `main` baseline
  (c5c0755) BEFORE any 07-06 change — unrelated to the LC fix. Logged to
  `deferred-items.md`, left untouched per the scope-boundary rule. These are NOT in
  `npm run test:gate` (the wired Valmor gates pass green).

## Known Stubs

None. The predicate is fully wired; LC posts 9/10/11 now resolve to real anchor
positions (no placeholder/empty values).

## Self-Check: PASSED

- Files exist:
  - `parser/post-positioning.js` — FOUND (modified)
  - `parser/__tests__/post-positioning.test.mjs` — FOUND (modified)
  - `parser/__tests__/fixtures/luizcarolino-post-positions-truth.json` — FOUND (modified)
  - `.planning/phases/07-solver-prerequisites/deferred-items.md` — FOUND (created)
- Commits exist: cd22f64, c98dc28, 1691c46, 3f7f095 — all FOUND in `git log`.
