---
phase: quick-260602-decouple
plan: 01
subsystem: parser
tags: [siriu, distance-associator, graph-walker, phantom-edges, dwg, branch-traversal]

requires:
  - phase: quick-260602-lbl
    provides: proven DFS-with-slots traversal model; rehomeBranchArmLabels; GATED protocol; 73/74 + 80/81 walk hacks
provides:
  - Generic equal-value-at-junction phantom dedup at the associator (pair 1 — 36->39 nulled at source)
  - Phantom-refill of the consecutive spine step exposed by a phantom removal (38->39=39.4)
  - Generic dense-junction consecutive-label swap at the associator (pair 2 — 48->49=8.4 / 49->50=22.6)
  - Retired walker compensations isPhantomBifurcationHint (pair 1) + dense-bifurcation swap handler (pair 2)
  - Forbidden-arm correctness oracle (forbiddenArms + armMetersChecks) for 7 Siriu junctions
  - Documented exact failing conditions for the two GATED-kept cross-page/region-degree pairs (3, 4)
affects: [siriu, distance-associator, graph-walker, future cross-page bridge, future DWG-region junction detection]

tech-stack:
  added: []
  patterns:
    - "Phantom removal at the associator + walker-compensation retirement in ONE atomic commit (lockstep)"
    - "Generic phantom discrimination by source-tier + value-equality + chord geometry + numbering-consecutiveness — zero post-number literals"
    - "Topology asserted by a forbidden-arm oracle independent of the moving idx baseline"

key-files:
  created:
    - .planning/quick/260602-decouple-graph-walker-phantom-edges/260602-decouple-SUMMARY.md
  modified:
    - parser/__tests__/fixtures/siriu-junction-ground-truth.json
    - parser/__tests__/branch-traversal.test.mjs
    - parser/distance-associator.js
    - parser/dwg/graph-walker.js

key-decisions:
  - "Equal-value dedup fires ONLY when the survivor is authoritative (tier>=3) AND the dropped edge is non-consecutive — consecutive spine edges are never deleted (stolen-arm junctions invert the consecutive=real assumption)."
  - "After dropping a phantom, refill the exposed consecutive spine step from the nearest on-chord label so the walk proceeds without the phantom hint."
  - "Dense-junction swap requires both post-swap labels to land essentially on-chord (<=45pt) to exclude cross-cluster junctions."
  - "Pairs 3 and 4 are GATED-KEPT: both need DWG region adjacency in the associator, which it does not have — exact failing conditions captured inline."

patterns-established:
  - "Pair-atomic lockstep commit: associator phantom removal + walker compensation retirement together (bisectable)."
  - "GATED-keep with an inline exact-failing-condition note when a pair cannot decouple without a broken gate."

requirements-completed: [DECOUPLE-01, DECOUPLE-02, DECOUPLE-03, DECOUPLE-04]

duration: ~95min
completed: 2026-06-02
---

# Quick Task 260602-decouple: Decouple graph-walker from load-bearing phantom label edges — Summary

**Pairs 1 & 2 decoupled at the associator (generic equal-value dedup + dense-junction label swap, with phantom-refill of the exposed spine step) and their walker compensations retired; pairs 3 & 4 are GATED-kept because the cross-page 62->81 bridge and the degree-<3 junction-70 detection both require DWG region adjacency the associator does not have. All four accuracy gates + the branch-traversal oracle stay green, zero post-number literals in any decoupled-pair code.**

## Performance

- **Duration:** ~95 min
- **Completed:** 2026-06-02
- **Tasks:** 6 (Task 1 + 4 pairs + final re-prove)
- **Files modified:** 4

## Per-pair outcome

| Pair | Target | Outcome | Walker compensation |
|------|--------|---------|---------------------|
| 1 | `36->39` phantom (+ 60 phantoms) | **DECOUPLED** — `36->39` nulled at source; `38->39=39.4` refilled | `isPhantomBifurcationHint` + `bifurcationMainByOriginMeters` **RETIRED** |
| 2 | post-48 swapped labels + `51->48` | **DECOUPLED** — `48->49=8.4` / `49->50=22.6` fixed at source | dense-bifurcation swap handler **RETIRED** |
| 3 | cross-page `40.6 -> 62->81` | **GATED-KEPT** | `fromNum===80 && toNum===81` off-cable hack **KEPT** (note updated) |
| 4 | `38.7 -> 70->74` (degree-<3 junction) | **GATED-KEPT** | `fromNum===73 && toNum===74` gap-reentry hack + `findGapOffCableReentryByNextLabel` **KEPT** (note updated) |

## Final gate results (all green, from clean state)

| Gate | Result |
|------|--------|
| `run-siriu-regression-gate` | PASS — dwg-graph-walk, walkOk, coords=85, 64 err ceilings, 39 idx locks (no baseline refresh needed) |
| `run-route-pdf-accuracy-gate` (Luiz Carolino PDF) | PASS — matched=31, mean=185.63 m, max=271.73 m |
| `run-route-dwg-accuracy-gate` (Luiz Carolino DWG) | PASS — matched=31, mean=114.88 m, max=403.93 m |
| `run-valmor-accuracy-gate` (Valmor) | PASS — matched=11/11, mean=2.22 m, max=4.38 m |
| `branch-traversal.test.mjs` (incl. forbidden-arm oracle) | PASS — 6/6 |

## Task Commits

1. **Task 1: forbidden-arm oracle (TDD: RED→GREEN)** - `10ffb7d` (test)
2. **Task 2: Pair 1 — null 36 phantom + retire isPhantomBifurcationHint** - `54a289d` (feat)
3. **Task 3: Pair 2 — fix post-48 labels at source + retire dense-bifurcation swap** - `b45a1b2` (feat)
4. **Task 4: Pair 3 — cross-page 62->81 GATED-kept** - `dbe3b44` (docs)
5. **Task 5: Pair 4 — junction-70 GATED-kept** - `38da4b6` (docs)
6. **Task 6: final all-gates re-prove** - no code change (verification only; literal-gate grep confirms decoupled pairs are literal-free)

## Files Created/Modified

- `parser/__tests__/fixtures/siriu-junction-ground-truth.json` — added `forbiddenArms` for all 7 junctions + `armMetersChecks` (48->49==8.4).
- `parser/__tests__/branch-traversal.test.mjs` — new forbidden-arm oracle test (each junction carries every GT arm, no phantom arm; meters checks) + junction-60-inbound test.
- `parser/distance-associator.js` — `dedupEqualValueAtJunction` (equal-value phantom dedup, authoritative-survivor + non-consecutive guards, + phantom-refill of the exposed spine step); `swapDenseJunctionConsecutiveLabels` (generic dense-junction label swap with on-chord guard); `distanceSourceTier`. Zero post-number literals.
- `parser/dwg/graph-walker.js` — retired `isPhantomBifurcationHint`/`bifurcationMainByOriginMeters` (pair 1) and the dense-bifurcation swap handler (pair 2); updated the GATED-kept `80/81` (pair 3) and `73/74` (pair 4) inline notes with exact failing conditions.

## Decisions Made

- **Equal-value dedup is authoritative-only + non-consecutive-only.** An earlier broad rule (inferred-vs-legacy, or "consecutive=authoritative") mis-fired at stolen-arm junctions, deleting real arms (`60->65`, `60->69`, `5->10`) and real spine steps (`5->6`). The final rule deletes a phantom only when its equal-value competitor is genuinely authoritative (bifurcation-main/tap, branch-arm-rehomed, override) and the dropped edge is non-consecutive — this matches exactly `36->39` (vs bifurcation-main `36->38`).
- **Phantom-refill is required for pair 1.** Nulling `36->39` left post 39 with no incident distance (`38->39` was jumpback-suppressed). The refill recovers `38->39=39.4` from the on-chord label, which is what makes the walk survive removal of the phantom hint.
- **Dense-junction swap needs an absolute on-chord guard.** Without it the swap mis-fired at cross-cluster junctions 10/40/63; requiring both post-swap labels within 45pt of their chords restricts it to genuine dense junctions (48).
- **Pairs 3 & 4 GATED-kept by a hard input limitation.** Both need the associator to consult DWG region adjacency (junction 62 and junction 70 are label-graph degree 2; only region degree reveals them). `distance-associator.js` operates on PDF posts + Distância_Poste labels + `cablesByPage` and has no DWG region graph — so the bridge/detection cannot be done generically there. This is a genuine prerequisite, not a forced pass.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Phantom-refill pass added (not explicitly in the plan)**
- **Found during:** Task 2 (Pair 1)
- **Issue:** Nulling `36->39` collapsed the walk at post 39 because the real consecutive `38->39` was jumpback-suppressed and the phantom had been the only hint reaching 39.
- **Fix:** Added a generic refill that, after a phantom drop, recovers the exposed consecutive spine step from the nearest on-chord unassociated label (`38->39=39.4`). Geometry only, no literals.
- **Files modified:** parser/distance-associator.js
- **Verification:** Walk reaches all 85 posts; Siriu gate + oracle green.
- **Committed in:** `54a289d`

---

**Total deviations:** 1 auto-fixed (1 blocking).
**Impact on plan:** The refill is required for pair 1 to decouple at all; it is generic and within the plan's intent (associator must stand alone). No scope creep.

## Known Stubs / Not fully captured at source

By the GATED protocol's design (keep rather than break), two must-haves were intentionally NOT achieved at the source and remain recovered by documented-kept walker hacks:

1. **`40.6 -> 62->81` (cross-page).** Probed removal of the `80/81` hack: Siriu post 81 idx 321->326; err 235.32 m; 2 gate failures. Junction 62 is label-graph degree 2; bridging needs DWG region adjacency in the associator. Inline note updated in `graph-walker.js`.
2. **`38.7 -> 70->74` (degree-<3 junction).** Probed removal of the `73/74` hack: Siriu posts 74/75/76 idx 8/9/10->13/295/16; err 144.98/218.68/298.02 m; 6 gate failures. Junction 70 needs region-degree detection. Inline note updated in `graph-walker.js`.

The junction-60 phantoms (`59->60`, `66->60`) are also not removed at source (their equal-value competitors are inferred-tier, not authoritative, so the safe dedup does not touch them), but the walk is green and the retired `isPhantomBifurcationHint` no longer depends on them.

## Issues Encountered

- Two earlier dedup formulations (inferred-vs-legacy tier; consecutive=authoritative) over-removed real arms/spine edges and collapsed the walk to pdf-fallback (5/6 region, 60 region). Resolved by tightening to authoritative-survivor + non-consecutive-only and adding the phantom-refill — confirmed via per-post walk diagnostics (failedAt) and the full gate suite.

## Next Steps Readiness

- **Re-attempt pairs 3 & 4** once the associator can consult DWG region adjacency (thread the DWG region graph or a region-degree map into `applyBifurcationJunctionLabelRehome`). Then bridge cross-page `62->81` and rehome `38.7` onto `70->74`, and DELETE the `80/81` and `73/74` literal gates + `findGapOffCableReentryByNextLabel`.

## Self-Check: PASSED

- All modified/created files verified present (associator, walker, fixture, test, SUMMARY).
- All 5 task commits verified in git log: `10ffb7d`, `54a289d`, `b45a1b2`, `dbe3b44`, `38da4b6`.
- All four accuracy gates + branch-traversal oracle (6/6) re-run green from clean state.
- Literal-gate grep confirms decoupled pairs 1/2 are post-number-literal-free; only GATED-kept pairs 3 (`80/81`) and 4 (`73/74`) retain literal gates, each with an inline failing-gate note.
- Temp debug script `debug-siriu-walkfail.mjs` removed; no debug-*.mjs committed.

---
*Quick task: 260602-decouple*
*Completed: 2026-06-02*
