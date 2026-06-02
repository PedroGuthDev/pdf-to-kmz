# Quick Task 260602-lbl: Fix distance-label branch/cross-page mis-association — Summary

**One-liner:** Built a proven generic DFS-with-slots branch-traversal model and a hybrid
cable-bearing + on-cable-overlap discriminator that re-homes same-page stolen branch-arm labels
to their true junctions (27.7→36→46, 31→60→69); cross-page (40.6→62→81) and the degree<3 junction
case (38.7→70→74) remain recovered by documented-kept graph-walker hacks because the root-cause
associator fix could not safely capture them without regressing the tight Siriu gate.

**Completed:** 2026-06-02
**Branch:** fix/siriu-post45-phantom-hint (sequential, no worktree)

---

## Final gate results (all green throughout)

| Gate | Result |
|------|--------|
| `run-siriu-regression-gate` | PASS — dwg-graph-walk, walkOk, coords=85, 64 err ceilings, 39 idx locks |
| `run-route-pdf-accuracy-gate` (Luiz Carolino PDF) | PASS — matched=31, mean=185.63 m, max=271.73 m |
| `run-route-dwg-accuracy-gate` (Luiz Carolino DWG) | PASS — matched=31, mean=114.88 m, max=403.93 m |
| `run-valmor-accuracy-gate` (NEW) | PASS — matched=11/11, mean=2.22 m, max=4.38 m |
| `branch-traversal.test.mjs` | PASS — 4/4 |

(Luiz Carolino means are the existing per-post-ceiling baselines; the gate asserts no per-post
regression, not a low mean. Siriu is the tight one and stayed locked at its baseline.)

---

## Tasks & commits

| Task | Commit | Outcome |
|------|--------|---------|
| A1 — ground-truth junction fixture | `8abf69d` | 7 junctions, 36 degree-4, 62→81 cross-page, directed inbound edges |
| A2 — DFS-with-slots traversal (TDD) | `51799cc` (RED), `3135165` (GREEN) | Generic model reproduces ground-truth arms/meters, zero post-number literals |
| B1 — Valmor accuracy gate | `844a852` | Nearest-INSERT region-coverage oracle, 11/11 posts, mean 2.2 m |
| B2 — thread cablesByPage + discriminator | `6b36c25` | `classifyBranchArmLabel` (bearing + on-cable); no behavior change; gates green |
| B3 — fix failure modes | `aafa21f` | `rehomeBranchArmLabels`; fixes 27.7→36→46 and 31→60→69 |
| B4 — remove walk hacks (GATED) | `8bb3a6d` | Both hacks KEPT-and-documented (removal regressed Siriu) |
| B5 — re-home 27.7 + simplify re-val (GATED) | `96133e1` | 27.7 placed on 36→46; re-validation pass KEPT-and-documented |

---

## Outcome per gated step (as required by constraints)

### Hacks removed vs kept (Task B4)
- **73/74 gap-reentry hack:** KEPT-and-documented. Removal regressed Siriu posts 74–76
  (idx 8/9/10 → 13/295/16; err >140 m). Root cause: the associator fix could not capture the
  `38.7 → 70→74` branch arm because true junction 70 has label-graph degree < 3 in the broken
  graph (its arm is mis-associated), and the only degree-≥3 neighbour (69) misroutes to `69→74`
  — correctly rejected by the new occlusion guard, so `38.7` stays unfixed rather than wrong.
- **80/81 off-cable insert hack:** KEPT-and-documented. Removal regressed Siriu post 81
  (idx 321 → 326; err 235 m). Root cause: `40.6 → 62→81` is a CROSS-PAGE branch entry (label on
  post 81's page); the implemented rehome handles SAME-PAGE stolen arms only — cross-page bridging
  to the prior-page junction was not implemented.

Both inline comments record the failing gate and the precise condition for a future removal.

### Re-validation pass simplified vs kept (Task B5)
- **KEPT-and-documented.** 27.7 is now correctly PLACED on `36→46` (source `branch-arm-rehomed`)
  by the B3 pass. Disabling the edc96a2 calibrated re-validation pass (verified) regressed Siriu
  posts 39–45 (err up to 142 m). The two mechanisms are complementary, not redundant: the rehome
  fixes a STOLEN arm; the re-validation pass independently drops a SPURIOUS pre-calibration tap
  edge around 39–45. Documented inline with the failing-gate condition.

### Final mean error per gate
- Siriu: locked at baseline (per-post ceilings, ~3.6 m regime) — no regression.
- Luiz Carolino PDF: 185.63 m (baseline, unchanged).
- Luiz Carolino DWG: 114.88 m (baseline, unchanged).
- Valmor: 2.22 m (new baseline).

---

## What the root-cause fix achieved

- **Stage A (proven model):** `parser/branch-traversal.mjs` + test prove the user's DFS-with-slots
  model (degree-1 = tip, degree-≥3 = junction with degree-1 arms, degree-4 = 2 slots, pop to
  nearest free slot) reproduces the ground-truth Siriu junction arms/meters with ZERO post-number
  literals. The model is generic and validated in isolation.
- **Stage B (associator fix):** `classifyBranchArmLabel` (hybrid: cable-arm bearing primary +
  on-cable overlap confirm) and `rehomeBranchArmLabels` re-home stolen same-page branch-arm labels
  onto their true junction arms. Two of the four target labels are now fixed at the source:
  `27.7→36→46` and `31→60→69`. No post-number literals in the fix — junctions/arms are discovered
  by label-graph degree + geometry, guarded by forward-arm, on-arm-chord, decisive-gap-vs-stolen-pair,
  and occlusion (a closer mid post = the real junction) tests.

## Deviations from plan

- **B4/B5 are GATED-KEPT, not removed/simplified.** The plan explicitly permits a documented-kept
  hack/pass as an acceptable outcome when removal regresses a gate (a broken gate is not). Both
  hacks and the re-validation pass were proven necessary by disabling them and observing the Siriu
  regression, then reverted with inline documentation. This is the sanctioned GATED outcome.
- The Valmor gate uses a nearest-INSERT region-coverage oracle rather than the PDF distance-label
  walk, because Valmor is a pure DWG route extracted from `Palhoca.dxf` with no PDF sheet (so the
  numbered-label associator path cannot drive it). The gate locks region coverage (11/11 posts,
  mean ≤2.4 m) + the UTM↔lat/lon conversion; the associator changes are covered by the Siriu and
  Luiz Carolino gates. Documented in the gate file header.

## Deferred / not captured at the source (must-haves not fully met)

The plan's must-have "both graph-walker hacks removed" and "Siriu label-graph encodes ONLY junctions
5,14,36,48,60,62,70" were NOT fully achieved, by the GATED protocol's design (keep rather than break):

1. **`38.7 → 70→74` (same-page, degree-<3 junction).** True junction 70 is degree-2 in the broken
   label graph, so the degree-≥3 junction detector never selects it; selecting neighbour 69 is
   correctly rejected by the occlusion guard. Fix path: detect junction 70 from DWG region geometry
   (region degree) rather than from the label-graph degree, then the rehome can place 38.7.
2. **`40.6 → 62→81` (cross-page branch entry).** Label drawn on post 81's page; needs cross-page
   bridging back to junction 62 on the prior page (extend the cross-page logic around
   `labelGapToSegment`). Not implemented to avoid destabilising the cross-page association.

Both are honest blockers, not forced/fabricated passes. The corresponding walk hacks remain as
documented-kept recovery until these two associator capabilities are added.

## Files

- `parser/__tests__/fixtures/siriu-junction-ground-truth.json` (created) — ground-truth junction graph.
- `parser/branch-traversal.mjs` (created) — DFS-with-slots model, zero hacks.
- `parser/__tests__/branch-traversal.test.mjs` (created) — Stage A proof.
- `tools/run-valmor-accuracy-gate.mjs` (created) + `parser/__tests__/fixtures/valmor-accuracy-baseline.json` (created).
- `parser/distance-associator.js` (modified) — `classifyBranchArmLabel`, `rehomeBranchArmLabels`,
  threaded `cablesByPage`; re-validation pass kept-documented.
- `parser/pdf-parser.js`, `parser/post-positioning-n3.js` (modified) — thread `cablesByPage` into rehome.
- `parser/dwg/graph-walker.js` (modified) — 73/74 + 80/81 hacks kept-documented with failing-gate reasons.

## Self-Check: PASSED
- Created files verified present (fixtures, model, test, valmor gate + baseline).
- All commit hashes verified in git log.
- All four gates + traversal test re-run green after final state.
