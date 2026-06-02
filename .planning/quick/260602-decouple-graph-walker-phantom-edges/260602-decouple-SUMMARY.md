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
  - buildCableTopologyMaps + applyTopologyBranchArmRehome (DWG-only, non-destructive 70->74 arm add)
  - Documented exact failing conditions for GATED-kept cross-page/region-degree pairs (3, 4)
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
requirements-partial: [DECOUPLE-03, DECOUPLE-04]

completed: 2026-06-02
---

# Quick Task 260602-decouple — Summary (pairs 3+4 reattempt)

**Pairs 1 & 2 fully decoupled (prior session). Pairs 3 & 4 remain GATED-kept, with new DWG cable-topology infrastructure that non-destructively adds the 70->74=38.7 arm before the graph walk. Walker literal hacks (80/81, 73/74) stay until stolen-edge clearing + cross-page bridge can run safely with a refill pass.**

## Per-pair outcome (full task)

| Pair | Target | Outcome | Walker compensation |
|------|--------|---------|---------------------|
| 1 | 36->39 phantom (+ 60 phantoms) | **DECOUPLED** | isPhantomBifurcationHint **RETIRED** |
| 2 | post-48 swapped labels + 51->48 | **DECOUPLED** | dense-bifurcation swap **RETIRED** |
| 3 | cross-page 40.6 -> 62->81 | **GATED-KEPT** | `fromNum===80 && toNum===81` **KEPT** |
| 4 | 38.7 -> 70->74 | **PARTIAL + GATED** | `fromNum===73 && toNum===74` + findGapOffCableReentry **KEPT** |

## Pairs 3+4 reattempt (this session)

### What shipped

- `buildCableTopologyMaps()` in `parser/dwg/cable-topology.js` — derives per-post neighbor sets from `deriveCableTopology` on DWG cable edges + PDF GPS coords.
- `applyTopologyBranchArmRehome()` in `parser/distance-associator.js` — DWG-only pass; uses topology + label-to-chord geometry to **add** confirmed branch arms (e.g. `70->74=38.7`) without touching the PDF associator path.
- `coordinate-calculator-dwg.js` calls the topology pass after PDF coords exist and before `runDwgPairingCascade`, threading `distanceLabelItems` + `cablePaths` from opts.
- `siriu-regression-harness.mjs` passes `distanceLabelItems` and `cablePaths` into the DWG calculator.

### Why pairs 3 & 4 are still GATED

**Pair 3 (62->81 cross-page):** A cross-page rehome prototype misfired (e.g. `11->16`, `54->69`) before guards were tightened. Safe cross-page bridging requires: (a) label-to-stolen-chord matching, (b) minimum numeric arm gap (≥15), (c) **refill of the cleared consecutive edge** after rehome. Without refill, clearing `80->81` or spurious pairs collapses the walk.

**Pair 4 (70->74):** Cable topology correctly identifies `70↔74`. Non-destructive add of `70->74=38.7` keeps all gates green, but **clearing** the stolen `74->75=38.7` leaves post 75 without a consecutive hint and collapses the walk (probed: `pdf-fallback`, coords=0). Full decouple requires the same phantom-refill pattern used for pair 1 (`38->39=39.4`) applied to the exposed `74->75` spine step, then removal of the `73/74` literal gate.

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
