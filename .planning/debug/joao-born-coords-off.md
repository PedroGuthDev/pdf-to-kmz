---
status: awaiting_human_verify
trigger: Posts 4-14 on page 3 land 10-28m from reference; posts 1-3 and 15-34 are fine
created: 2026-05-18
updated: 2026-05-25
focus: posts-9-11-page3-mid-calibration
---

## Current Focus

hypothesis: |
  Page-3 dense cluster (posts 8–13) has non-uniform label/PDF scale distortion; a partial
  scale nudge toward the 8→13 chord (after downstream 1→15 refit) can shrink 9–11 errors
  without a second full similarity replace.

test: |
  node debug-run-calc.mjs joao-born — posts 9–11; post 4/13/14; Valmor unchanged.

expecting: |
  Posts 9–11 drop vs 18.97/15.35/16.72 baseline; post 4 stays ~5m; post 14 not >5m if possible.

next_action: |
  Human-verify harness on real PDF workflow; tune scaleBlend/guard if post 14 regression unacceptable.

## Symptoms (posts 9-11 push — 2026-05-25)

- **Expected:** Posts 9, 10, 11 within ~5 m of reference (dense cluster on R. João Born page 3).
- **Actual (before mid-cluster):** Post 9 ~19 m, Post 10 ~15 m, Post 11 ~17 m.
- **Reproduction:** `node debug-run-calc.mjs joao-born`
- **Procrustes floor:** 9: 12.3 m, 10: 8.0 m, 11: 8.9 m

## Eliminated

- hypothesis: Full 2-point mid-cluster similarity (posts 8+13) replaces page-3 transform
  evidence: Improves cluster label RMSE but global label RMSE worsens (5.14→5.49 m); reverted by guards.
  timestamp: 2026-05-25

- hypothesis: Label-chain GPS re-walk for posts 9–11 overrides projection
  evidence: Improved label residuals but post 10 GPS error 15.3→20.3 m; removed from pipeline.
  timestamp: 2026-05-25

- hypothesis: Scale-only replace (100% cluster scale) without blend
  evidence: Same global RMSE regression as full 2-point; needs partial blend.
  timestamp: 2026-05-25

## Evidence

- timestamp: 2026-05-25
  checked: Per-segment label/UTM ratios on page 3 after downstream refit
  found: |
    9→10 ratio 1.41 (UTM too short), 10→11 ratio 0.70 (UTM too long), 11→12 ratio 0.66 —
    non-uniform; single extra scale cannot fit all segments.
  implication: Partial scale blend toward 8→13 chord is the safe lever; not a full replace.

- timestamp: 2026-05-25
  checked: Sweep scaleBlend 0.2–0.35 with guard on post 14 label residuals
  found: |
    blend 0.34 + guardPostNums [14] tolerance 0.22 m:
      Post 9: 18.97→17.68 m, Post 10: 15.35→14.03 m, Post 11: 16.72→15.26 m
      Max error: 18.97→17.68 m
      Post 4: 4.97→5.08 m, Post 14: 3.12→5.06 m
      <5m count: 20→18/34
    Valmor: unchanged (9.14 m max).
  implication: Meaningful 9–11 improvement with trade-off on post 14 and <5m count.

## Resolution

root_cause: |
  After refineAnchorPageByDownstreamChord (post 1 + post 15 chord), page-3 scale is globally
  correct for sheet ends but locally wrong in the dense posts 8–13 cluster where PDF chord
  lengths disagree with Distância_Poste by varying amounts per segment (non-uniform distortion).

fix: |
  Added refineAnchorPageByMidClusterChord: second-pass partial scale blend (default 35%,
  production 34%) toward posts 8→13 chord length while keeping θ from downstream refit and
  post 1 pinned. Guards: cluster label RMSE must improve, global RMSE within 0.5 m,
  tail-post label residual sum (post 14) within tolerance.

verification: |
  João Born harness (PARSE DEBUG + N3):
    Post 9: 18.97→17.68 m, Post 10: 15.35→14.03 m, Post 11: 16.72→15.26 m
    Max error: 18.97→17.68 m
    Post 4: 4.97 m (holds), Post 13: 3.50 m, Post 14: 5.06 m (regression vs 3.12)
    Valmor: 9.14 m max unchanged

files_changed:
  - parser/geo/label-lsq-calibrator.js
  - parser/coordinate-calculator.js
