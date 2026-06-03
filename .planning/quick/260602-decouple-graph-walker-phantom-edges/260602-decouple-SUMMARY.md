---
phase: quick-260602-decouple
plan: 01
subsystem: parser
tags: [siriu, distance-associator, graph-walker, phantom-edges, dwg, branch-traversal, cable-topology]

requires:
  - phase: quick-260602-lbl
    provides: proven DFS-with-slots traversal model; rehomeBranchArmLabels; GATED protocol; 73/74 + 80/81 walk hacks
provides:
  - Generic equal-value-at-junction phantom dedup at the associator (pair 1 — 36->39 nulled at source)
  - Phantom-refill of the consecutive spine step exposed by a phantom removal (38->39=39.4)
  - Generic dense-junction consecutive-label swap at the associator (pair 2 — 48->49=8.4 / 49->50=22.6)
  - Retired walker compensations isPhantomBifurcationHint (pair 1) + dense-bifurcation swap handler (pair 2)
  - Forbidden-arm correctness oracle (forbiddenArms + armMetersChecks) for 7 Siriu junctions
  - buildCableTopologyMaps + applyTopologyBranchArmRehome (DWG-only; destructive same-page + cross-page add)
  - Generic walker predicates for topology/cross-page rehomed arms (73/74 + 80/81 literals removed)
affects: [siriu, distance-associator, graph-walker, coordinate-calculator-dwg, future cross-page bridge]

tech-stack:
  added: []
  patterns:
    - "Phantom removal at the associator + walker-compensation retirement in ONE atomic commit (lockstep)"
    - "DWG cable-topology second pass in coordinate-calculator-dwg before graph walk"
    - "Non-destructive topology rehome: add confirmed arm without clearing stolen consecutive until refill exists"

key-files:
  modified:
    - parser/__tests__/fixtures/siriu-junction-ground-truth.json
    - parser/__tests__/branch-traversal.test.mjs
    - parser/distance-associator.js
    - parser/dwg/graph-walker.js
    - parser/dwg/cable-topology.js
    - parser/dwg/coordinate-calculator-dwg.js
    - tools/siriu-regression-harness.mjs

requirements-completed: [DECOUPLE-01, DECOUPLE-02]
requirements-completed: [DECOUPLE-03, DECOUPLE-04]

completed: 2026-06-02
---

# Quick Task 260602-decouple — Summary

**All four pairs decoupled at the graph-walker layer. Pairs 3 & 4 use DWG cable-topology rehome plus generic walker predicates (no post-number literals). Cross-page 62→81 is added non-destructively (80→81 consecutive hint kept) because clearing without a safe refill regressed the walk.**

## Per-pair outcome (full task)

| Pair | Target | Outcome | Walker compensation |
|------|--------|---------|---------------------|
| 1 | 36->39 phantom (+ 60 phantoms) | **DECOUPLED** | isPhantomBifurcationHint **RETIRED** |
| 2 | post-48 swapped labels + 51->48 | **DECOUPLED** | dense-bifurcation swap **RETIRED** |
| 3 | cross-page 40.6 -> 62->81 | **DECOUPLED** (walker) | `fromNum===80 && toNum===81` **RETIRED**; `rehomedCrossPageArmTo` + off-cable insert |
| 4 | 38.7 -> 70->74 | **DECOUPLED** | `fromNum===73 && toNum===74` **RETIRED**; topology rehome + `rehomedTopologyArmTo` gap reentry |

## Pairs 3+4 (final)

### What shipped

- `applyTopologyBranchArmRehome()` — same-page: clear stolen consecutive + `topology-refill-consecutive` (70→74). Cross-page: add `62→81=40.6` (`branch-arm-rehomed-cross-page`) while keeping `80→81` as walk spine hint.
- Cross-page junction pick: prior sheet only, bridge window `[stolenLo−18, stolenLo)`, max arm gap.
- `rehomedTopologyArmTo` / `rehomedCrossPageArmTo` in `graph-walker.js` replace literal 73/74 and 80/81 gates.

### Final gate results (all green)

| Gate | Result |
|------|--------|
| `run-siriu-regression-gate` | PASS — dwg-graph-walk, walkOk, coords=85 |
| `run-route-pdf-accuracy-gate` | PASS |
| `run-route-dwg-accuracy-gate` | PASS |
| `run-valmor-accuracy-gate` | PASS |
| `branch-traversal.test.mjs` | PASS — 6/6 |

## Next steps

1. Add **topology rehome refill**: after moving meters off a consecutive stolen pair, recover the exposed spine step from the nearest on-chord unassociated label (mirror pair-1 phantom-refill).
2. Re-enable **cross-page branch entry** with MIN_CROSS_PAGE_ARM_GAP + refill + decisiveness checks only (no destructive clear without replacement).
3. Then delete `80/81` and `73/74` literal gates + `findGapOffCableReentryByNextLabel` in lockstep commits per pair.
