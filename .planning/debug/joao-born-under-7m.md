---
status: investigating
trigger: All posts <10m achieved (session 14c). New goal: all posts <7m.
created: 2026-05-27
priority: Tighten 7–10m stragglers (posts 2, 8, 9, 10, 25) without regressing 26–34 cluster.
---

## Current State Baseline (2026-05-27)

Harness (`node debug-run-calc.mjs joao-born`):
Max 9.90m, <5m: 23/34. label-lsq RMSE 3.34 → 3.34m. Posts in 7–10m range:

| Post | Page | Err   | PDF (x, y)         | Notes |
|------|------|-------|--------------------|-------|
|  2   |  3   | 9.46m | (342.38, 428.82)   | early page 3 (post 1 anchor at 0.05m) |
|  8   |  3   | 7.00m | (752.54, 236.94)   | on-cable, was 11.33m → 7.00m via bracket snap (session 14c) |
|  9   |  3   | 9.90m | (849.50, 214.98)   | mid-page distortion floor (session 11 refined to 9.90m) |
| 10   |  3   | 7.79m | (883.10, 201.42)   | mid-page distortion zone |
| 11   |  3   | 6.97m | (939.50, 189.30)   | borderline; under 7m but barely |
| 15   |  4   | 6.90m | (152.42, 283.26)   | first post of page 4 |
| 25   |  4   | 7.29m | (1133.90, 51.84)   | correct PDF symbol; LSQ floor (session 7) |

Posts <5m: 1, 3, 4, 13, 14, 16, 17, 18, 19, 20, 21, 22, 23, 24, 26, 27, 28, 29, 30, 31, 32, 33, 34 (23 total).

Other 5–7m: Post 5 (5.84), Post 6 (6.04), Post 7 (5.61), Post 12 (6.28), Post 15 (6.90).

## Hypotheses (in priority order)

### H1 — Post 2 (9.46m): single early post error before anchoring kicks in
Post 1 is at 0.05m (UTM anchor), Post 3 at 2.10m, but Post 2 spikes to 9.46m. Suggests:
- Either Post 2 PDF coords are wrong (mis-snapped), or
- Distance label 1→2 is too small/large, or
- Bearing 1→2 in PDF is rotated relative to UTM-grid.

Reference: post 1 (-27.641966, -48.663060), post 2 (-27.641896, -48.662746). 
Δlat=0.000070, Δlon=0.000314 → ~32m east, ~7.8m north → bearing ≈ 76.3°, dist ≈ 32.9m.
PDF: post1=(272.66, 444.30), post2=(342.38, 428.82). dx=69.72, dy=-15.48. 
With scale 0.354610, that's PDF dist = sqrt(69.72² + 15.48²) × 0.354610 = 71.42 × 0.3546 = 25.33m.
PDF bearing atan2(dx=69.72, dy=15.48) = atan2(69.72, 15.48) = 77.5° (treating +y as north).

So PDF says ~25.3m at 77.5°; reference says ~32.9m at 76.3°. PDF distance is 7.5m SHORT.

### H2 — Posts 9, 10 (9.90/7.79m): page 3 mid-section drawing distortion
Sessions 9 + 11 established a Procrustes floor here. Backward chain bias from post 14 already applied. Remaining gap = intrinsic distortion in PDF source.

### H3 — Post 25 (7.29m): page 4 boundary LSQ floor
Session 7 brought 25 from 14.77 → 7.29m. Floor is from LSQ + page 4 transform. Possibly improvable via:
- Tighter θ search on page 4 (currently θ=-0.20°)
- Sub-meter origin nudge on page 4 driven by cross-page link 25→26.

### H4 — Post 15 (6.90m): first post of page 4
Page 4 origin was placed via cross-page chain from post 14. If page 4 origin is off by ~7m at post 15, then all of page 4 inherits that. But posts 16–24 are 1.86–4.83m, so origin appears fine — Post 15 specifically may be at wrong PDF location.

## Plan

1. Investigate H1 first (post 2): single-post fix, no risk to others.
2. Investigate H4 (post 15): single-post fix.
3. Investigate H3 (post 25): may require LSQ tuning.
4. Investigate H2 (posts 9–11): mid-page distortion — possibly residual.

## Evidence Log
