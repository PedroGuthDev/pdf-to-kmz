---
status: investigating
trigger: Coordinates work on Valmor PDF but are way off on Joao Born PDF (34 posts, reference coords in folder)
created: 2026-05-18
updated: 2026-05-20
---

## Symptoms

- **Expected:** GPS within ~5m of reference for all posts on Joao Born PDF
- **Baseline 2026-05-19:** max **46.07 m**; 4/34 < 5 m
- **Best 2026-05-20:** max **38.63 m**; 6/34 < 5 m (attempt 13)
- **Reproduction:** `node debug-run-calc.mjs joao-born` (PARSE DEBUG positions)

## Root causes identified

**RC-A: Cable-arc-placer uses a broken cable tangent on pages 4/5.**

- Page 4/5 cables are **dashed-ribbon polygons** (24 and 20 M sub-paths). Each "subpath" is a triangle (M, L, L, Z) — a tiny dash. The cable is not a continuous polyline.
- `pathTotalArcLength` returns 4053.69 but the true continuous arc through `L` ops is only 2275.34 m. Post 15's `t = 4285.66` exceeds `total = 4053.69` → tangent direction collapses to the last subpath's tail.
- The cable tangent returns 105.73° (page 4) and 103.7° (page 5), while the actual post-sequence bearing is ~73.8° (NE). 30° off → systematic SE shift of ~28–35 m on page 4 posts 16–23.

**RC-B: `applyDistanceLabelGpsChain` uses the same broken cable tangent for label-walk bearings.**

- Chain falls through to `gpsBearing` only when `cableSegmentBearingDeg` returns null — but the broken tangent returns a non-null (wrong) value. Errors compound on top of placer corruption.

**RC-C: Placer's straight-line walk accumulates from a single anchor across chain breaks.**

- When a label is missing (e.g. 23→24, 32→33), `sumChainLabels` returns null, post is skipped, and the cumulative distance is not advanced for that leg. The next labelled post lands too close to the anchor.

**RC-D: Several post PDF positions are wrong upstream (Phase 02-06 Viterbi).**

- Post 33 is 95 pt from the page 5 cable — likely a Viterbi mis-assignment to a wrong Poste symbol.
- Post 24 raw PDF is ~70 pt off the expected straight-line position between posts 23 and 25.
- These cap the achievable accuracy without revisiting post-positioning.

## Fixes applied (attempts log)

| # | Patch | Max err | < 5 m | Notes |
|---|-------|--------:|------:|-------|
| 0 | Baseline (commit dc7116e) | 46.07 m | 4/34 | |
| 1 | `--disable-arc-placer` | 343.02 m | 3/34 | Worse — raw PDF coords + page-4 UTM grid origin alone wildly off |
| 2 | Placer uses posts-regression bearing | 510.33 m | 4/34 | Worse — chain re-projects with same broken cable tangent |
| 3 | + `--disable-seam-lock` | 525.52 m | 4/34 | Same — seam-lock not the issue |
| 4 | + `--disable-cable-chain` (chain uses gpsBearing only) | **43.84 m** | **6/34** | Big improvement |
| 5 | + fillAdjacentMissingDistances before placer | 35.82 m | 3/34 | New max record; <5m regressed (page-3 noise from inferred 4→5) |
| 6 | Placer re-anchors on chain break (always) | 43.84 m | 6/34 | Post 25 27→29; post 34 25→33 (regressed) |
| 7 | Re-anchor only when curr is near cable | 43.84 m | 6/34 | Post 25 settled; post 34 24 |
| 8 | Combine 5 + 7 | 35.82 m | 3/34 | Same as 5 |
| 9 | Fragmentation-gated bearing override (M-ops ≥ 5) | 43.84 m | 6/34 | Page 3 unchanged; same as 7 |
| 10 | Threshold 10° vs 25° | 43.84 m | 6/34 | Page 3 within 10° (no override fires) |
| 11 | Auto-detect fragmentation in calculator (replaces `--disable-cable-chain`) | 43.84 m | 6/34 | Same as 4 but built-in |
| 12 | Chain uses `augDistMapForSeams` (filled labels) | **38.73 m** | 6/34 | post 33 43→39, post 34 25→21 |
| 13 | Remove 28-29 chain-skip hack (no longer needed with auto-disable cable bearing) | **38.63 m** | 6/34 | Marginal improvement |

## Code changes (current state, NOT YET COMMITTED)

1. **`parser/geo/cable-arc-placer.js`**:
   - Added `postsRegressionBearingDeg(nonTapPosts)` helper — linear fit of post PDF vs sequence index.
   - When cable has ≥ 5 M sub-paths and posts-regression disagrees with cable tangent by > 25°, use the regression bearing.
   - In forward walk, when chainM is missing and the post is near the cable (d ≤ 45 pt), re-anchor to the post and reset cumDist.

2. **`parser/coordinate-calculator.js`**:
   - Added destructured opts: `disableCableArcPlacer`, `disableSeamLock`, `disableCableChainBearing`.
   - Auto-disable cable-chain bearing when any active cable has ≥ 5 M sub-paths (fragmented).
   - Chain now uses `augDistMapForSeams` (filled labels) instead of raw `distMap`.
   - Removed page-5 posts-28-29 chain-skip hack (no longer needed).

3. **`debug-run-calc.mjs`**:
   - Added `--disable-arc-placer`, `--disable-seam-lock`, `--disable-cable-chain` debug flags.
   - Top-5-offenders report.

## Valmor regression check

`node debug-run-calc.mjs` → **max 4.19 m, 11/11 < 5 m** (unchanged from baseline). G-1 still passes.

## Eliminated (prior runs)

- Page 5 seam lock at post 26 → ~292 m
- UTM-only page 4 posts 16–25 → ~189 m
- Extend page 5 chain skip to 28–31 → ~72 m

## Residual barriers to G-2 gate (max < 10 m, ≥ 25/33 < 5 m)

| Post | err | reason |
|------|----:|--------|
| 33 | 38.6 m | PDF position 95 pt from cable — Viterbi/N3 mis-assignment (Phase 02-06) |
| 25 | 29.9 m | Page 4 tail; raw PDF off-line, chain-break re-anchor at post 24 only partially corrects |
| 24 | 27.8 m | Raw PDF ~70 pt off route line — Viterbi mis-positioning |
| 10 | 24.8 m | Page 3 placer walk; cable tangent OK on page 3 but route curves — straight-line walk drifts |
| 34 | 20.5 m | Page 5 tail propagates post-33 error |
| 31 | 20.2 m | Page 5 — page-5 origin LSQ residual |

## Strongest residual hypothesis (if iteration plateaus here)

**The remaining ~28–39 m residual on page 4-5 tails (posts 24, 25, 33, 34) is bounded by upstream PDF positioning errors from Phase 02-06 (Viterbi/N1/N3) and cannot be fixed at the coordinate-calculator level without:**

1. **Re-running Viterbi with tighter σ/β on pages 4-5** to fix Poste symbol mis-assignments at posts 24 and 33.
2. **OCR pass to recover missing distance labels** (4→5, 23→24, 32→33) directly from the PDF (the current PDF chord × neighbor scale inference produces ±30% errors).
3. **Ground-truth digitizer** for at least one cross-page anchor per detail sheet (a 2nd anchor on each of pages 3, 4, 5 would bound origin LSQ).

A **per-page affine fit** instead of isotropic similarity on page 4 reduces RMSE from 15.16 → 12.96 m, indicating page 4 is non-uniformly scaled — but page 4 has only ~11 ref points colinear in the route direction, so the affine fit degenerates. Without independent anchors or labelled cross-page distances, no projection refinement can recover the missing degrees of freedom.

## Recommendation

- **Land attempts 4, 7, 9, 11, 12, 13 as the new João Born baseline** (max 38.63 m, 6/34 < 5 m — best so far). Valmor still passes G-1. Document G-2 as PARTIAL pass: post 33 remains the architecture-level blocker.
- **Phase 02-06 follow-up**: revisit Viterbi cost function on pages 4-5 to fix posts 24, 33 PDF positions (would likely drop max from 38m → ~15m).
- **Phase 03+ enhancement**: add optional 2nd-anchor input per detail sheet (UI: drag-pin on cross-page seam), which is a far cleaner architectural fix than chasing the inferred-label residuals.
