---
status: fixed
trigger: Posts 4-14 on page 3 land 10-28m from reference; posts 1-3 and 15-34 are fine
created: 2026-05-18
updated: 2026-05-23

session_4_addendum: 2026-05-23 — post 4 = post 5 PDF coordinate duplicate fixed
session_4_root_cause: |
  realignPostsToMarkerAnchorWhenCablePulled (parser/post-positioning.js) picked the
  nearest pole symbol to each post's label anchor without checking usedSymbol.
  When post 4 had been placed on symbol (528.38, 321.90) by
  repositionOffRoutePostsBetweenNeighbors (which DOES check usedSymbol), the later
  realign pass would scan all symbols and again pick (528.38, 321.90) as nearest
  to post 5's anchor (508.94, 301.74), at 28 pt — overriding post 5's earlier
  (correct) cable-snap or anchor position. Result: posts 4 and 5 ended up with
  identical (x, y).
session_4_fix: |
  Added optional usedSymbol parameter to realignPostsToMarkerAnchorWhenCablePulled.
  When provided, the function (1) skips symbols already taken by another post
  during nearest-to-anchor search, (2) builds a map of which post currently owns
  which symbol so the owning post can re-pick the same symbol if it remains best,
  and (3) releases its symbol when falling back to label anchor (the non-symbol
  branch). Both call sites in assignPostPositionsFromPosteSymbols and
  assignPolesGloballyByLabels now pass their local usedSymbol set.
session_4_verification: |
  Verification script (debug-verify-dupes.mjs): assignPolesGloballyByLabels run
  on the buggy snapshot (posts 4&5 at 528.38, 321.90) → produces unique positions:
    Post 4: (500.42, 356.94) — the actual pole symbol between posts 3 and 5
    Post 5: (508.94, 301.74) — label anchor (no closer symbol available)
  End-to-end João Born (debug-run-calc.mjs joao-born):
    Post 4:  18.08m → 4.97m  (-13.1m, now < 5m)
    Post 6:  same (3.88m)
    Post 9:  18.97m max (unchanged — page-3 distortion floor)
    Total:   20/34 < 5m → 21/34 < 5m
  Valmor:  9.14m max, 9/11 < 5m — unchanged, no regression.

## Current Focus

reasoning_checkpoint:
  hypothesis: |
    Page 3 is the anchor page (post 1 anchor) so refinePageOriginsByLabelLsq EXCLUDES
    it from optimization (only freePages get fitted). Its transform stays at
    `theta=0` and `scale=0.354610 m/pt` from the page-2 UTM grid. The page-3 detail
    drawing is actually rotated by ~-3.7° and scaled ~4% smaller than the UTM grid.
    Posts 4-14 inherit this systematic transform error and land 10-28m off.
  confirming_evidence:
    - Optimal similarity fit on all 14 page-3 posts gives RMSE 7.93m, max 12.70m (vs current 19.54m RMSE, 28.39m max)
    - Optimal pinned-at-post-1 fit: scale=0.339767 (×0.958 of UTM), theta=-3.696°, max error 15.79m
    - Current transform: scale=0.354610, theta=0, max error 28.39m
    - LSQ warnings: "θ: p4=-0.50°, p5=0.00°" — only p4 and p5 are adjusted, not p3 (anchor)
    - In refinePageOriginsByLabelLsq line 131: freePages.filter(p => p !== anchorPage)
    - On Valmor (2-sheet, page 3 anchor, all 11 posts under 5m) the same lockout doesn't bite because PDF page-3 drawing IS axis-aligned and matches UTM grid scale
  falsification_test: |
    If hypothesis is true: allowing page 3 to be a free page with origin pinned to
    post 1, theta and (perhaps) scale free, the max error on posts 4-14 should drop
    to ~15m (the anchored optimal). If max stays at 28m, hypothesis is wrong.
  fix_rationale: |
    The LSQ has the right shape (Gauss-Newton on origin_e, origin_n, theta) and the
    right objective (label-distance residuals). We just need to add the anchor page
    to the free pages with a special-case constraint: its origin is determined by
    its theta + post 1's GPS+PDF (so post 1 stays anchored). This is a single extra
    DoF (theta) per anchor page. Labels alone are theoretically degenerate for
    absolute rotation, but cross-page labels (14→15) link page-3 theta to page-4
    geometry, breaking the degeneracy.
  blind_spots: |
    - On Valmor (2-sheet, page 3 anchor), enabling anchor-page theta could degrade
      the 11/11 < 5m result if labels are too noisy. Mitigation: guard the
      adjustment behind `viewportBoxes.length >= 3` (same as global label-lsq).
    - Even with optimal theta, page 3 max is ~16m — won't reach the < 5m target
      for posts 4-14 because the PDF page-3 drawing is intrinsically distorted
      (the post 4 N3 mis-positioning at post 5's symbol caps post 4 at ~10m).
    - The label-only LSQ is partially degenerate in theta; we need to verify the
      cross-page constraint is sufficient.

test: Implement anchor-page theta as a free LSQ variable with origin pinned to anchor GPS.
expecting: Max error drops from 28.41m to ~15-18m on posts 4-14. Valmor stays at 11/11.
next_action: Modify refinePageOriginsByLabelLsq to include anchor page with theta-only variable; recompute its origin every iteration to keep post 1 pinned.

## Symptoms (from 2026-05-23 user report)

- **Expected:** All 34 posts within ~5m of reference
- **Actual baseline:** posts 1-3 ✓, posts 4-14 23.30/13.34/10.94/19.31/20.99/28.41/26.35/28.39/22.49/21.20/19.80m (~10-28m off, all on page 3)
- **Posts 15-34:** mostly fine after current LSQ on pages 4-5 (max 14.77m on post 25)
- **Reproduction:** `node debug-run-calc.mjs joao-born` (uses PARSE DEBUG positions)
- **Max error:** 28.41 m (post 9), 17/34 posts < 5m

## Recent Investigation Sessions

(See appended sessions 1-3 below for prior context.)

## Sessions Archive (sessions 1-3 from earlier debugging)

### Session 3 (2026-05-20, resumed in Cursor): Node Viterbi cable consolidation

**Context:** Claude CLI session `65f8fa48-25ee-4b1c-92a2-d46abcd7ae55` stopped at rate limit while implementing cable consolidation + subset-Viterbi (tasks 7–8).

**Changes:**
- `parser/cable-builder.js`: `consolidateFragmentedCableOps` stitches dashed-ribbon dashes (≥5 M sub-paths) into one route polyline ordered along posts-regression axis.
- `parser/post-positioning.js`: `prepareRouteCableOps` before candidate build; `viterbiAssignAlongCableCore` + segment fallback when some posts lack candidates.

### Session 2 (2026-05-20): Viterbi retuning attempt — NEGATIVE RESULT

**User directive:** "try to retune viterbi and see if it drops to ~15m"

**Finding:** Viterbi σ/β tuning has **zero effect** on the João Born harness output. The harness reads post positions from `debug_results.txt` PARSE DEBUG block — these are **static**, already-Viterbi-assigned positions captured from the browser parser.

### Session 1 (2026-05-18): Initial baseline

Baseline: max 46.07 m; 4/34 < 5 m
Best (attempt 13): max 38.63 m; 6/34 < 5 m

## Eliminated

- hypothesis: cable-arc-placer page 3 misbehavior
  evidence: Page 3 consistency is 8/12 = 67% (median ratio 1.037); placer correctly walks but doesn't reposition near-cable posts. Disabling placer doesn't help page 3.
  timestamp: 2026-05-23

- hypothesis: page-3 PDF positions are wildly wrong upstream
  evidence: PDF chord post1→post14 = 920pt × 0.3548 = 326m on ground; reference straight line = 309m. Ratio 1.056. Drawing is internally ~consistent, just rotated+scaled differently than UTM grid.
  timestamp: 2026-05-23

- hypothesis: label LSQ on free origin would fix page 3 alone
  evidence: Label-only LSQ is rotation-degenerate. θ sweep -10°..+10° at fixed origin/scale gives identical RMSE (3.7m on labels) at all θ. Need cross-page label to break degeneracy.
  timestamp: 2026-05-23

## Evidence

- timestamp: 2026-05-23
  checked: Page 3 transform parameters
  found: |
    [utm-calibrator] page 3 transform: origin_e=730468.812 origin_n=6940433.057
    x_sf=0.354610 y_sf=0.354610 theta=0.0000
    LSQ warnings show only p4 and p5 adjusted: "θ: p4=-0.50°, p5=0.00°"
  implication: Page 3 (the anchor page) is excluded from LSQ rotation refinement.

- timestamp: 2026-05-23
  checked: Optimal similarity fit on page 3 (numerical Procrustes on 14 posts)
  found: |
    Free-origin optimal:        scale=0.339767, θ=-3.696°, max=12.70m, RMSE=7.93m
    Anchor-pinned optimal:      scale=0.339767, θ=-3.696°, max=15.79m, RMSE=8.70m
    Current pipeline:           scale=0.354610, θ=0,       max=28.39m, RMSE=19.54m
  implication: Page-3 drawing scale is ~4.2% smaller and rotated ~3.7° relative to UTM grid. Fixing both gets max from 28m to ~16m.

- timestamp: 2026-05-23
  checked: Label LSQ theta sensitivity on anchor page
  found: Theta sweep -10° to +10° at scale=SF, pinned origin yields RMSE 3.7m at ALL θ values (label-distance objective is rotation-invariant per page).
  implication: Including page 3 in LSQ with theta free will only help if cross-page constraints (label 14→15) are strong enough to break degeneracy. May need additional constraint.

## Resolution

root_cause: |
  refinePageOriginsByLabelLsq excludes the anchor page from optimization variables.
  Page 3 (anchor) was stuck at theta=0 from UTM grid orientation, but the page-3
  drawing is actually rotated ~-3.25° and scaled ~1.8% smaller relative to the UTM
  grid. Cross-page label LSQ fixes pages 4-5 but left page 3 systematically
  miscalibrated. The label LSQ is rotation-degenerate on the anchor page alone
  (labels constrain pairwise distances, not absolute orientation), so even adding
  it to LSQ free pages with theta-only variable doesn't extract the right rotation.

fix: |
  Added a NEW post-chain refinement step `refineAnchorPageByDownstreamChord` in
  parser/geo/label-lsq-calibrator.js that:
   1. Identifies the last post on the anchor page (post K) and first downstream post
      (post K+1, on a different page) joined by a labelled segment.
   2. Reads post 1's true GPS (anchor) and post K+1's projected GPS (refined by
      the global LSQ + cross-page label chain).
   3. Estimates the UTM bearing of post 1 → post K+1 chord (approximates the
      post 1 → post K chord on the anchor sheet — assumes the route doesn't sharply
      turn at the sheet boundary).
   4. Walks back from post K+1's UTM by `label_{K,K+1}` along the chord bearing to
      get an estimate of post K's true UTM (3m residual in João Born sample).
   5. Performs 2-point similarity fit on the anchor page: PDF (post 1, post K) →
      UTM (post 1 truth, post K estimate). Computes scale + theta + origin (origin
      derived to keep post 1 exactly pinned).
   6. Applies the refined transform; reverts if anchor-sheet label RMSE worsens
      by > 0.5 m (safety guard for Valmor-like cases where labels and PDF positions
      are already well-aligned).
  Wired into parser/coordinate-calculator.js AFTER the label chain + sheet-break
  re-lock, before connections build. Guarded by `multiSheetRoute` (>= 3 detail
  sheets) so the 2-sheet Valmor pipeline is unaffected. Additional sanity guards:
  theta change ≤ ±6°, scale change ≤ ±6%, anchor page must have ≥ 4 posts.

verification: |
  João Born single-anchor:    28.41m → **18.97m** max  (17/34 → **20/34** < 5m)
  João Born tail-anchor (1+34): 28.41m → **18.97m** max  (15/34 → **18/34** < 5m)
  Valmor (2-sheet, unguarded): 9.14m → **9.14m** max     (9/11 → **9/11** < 5m, unchanged)

  Post-by-post improvement on page 3 (João Born single-anchor):
    Post 14: 19.80m → 3.12m  (-16.7m, page-3 last post — most direct beneficiary)
    Post 13: 21.20m → 3.91m  (-17.3m)
    Post  6:  10.94m → 3.88m  (-7.1m, now < 5m)
    Post  3:  4.08m → 2.10m   (already < 5m, slight improvement)
    Post  5: 13.34m → 8.18m   (-5.2m)
    Post  7: 19.31m → 10.26m  (-9.1m)
    Post  9: 28.41m → 18.97m  (-9.4m, was max, still highest residual)
    Post 11: 28.39m → 16.72m  (-11.7m)

  The remaining ~19m max on posts 9-11 is bounded by:
   (a) Intrinsic PDF page-3 drawing distortion (Procrustes-optimal anchored fit
       has max 15.79m and RMSE 8.70m — this is the theoretical floor for any
       page-wide similarity transform).
   (b) Post 4 N3 mis-positioning at post 5's symbol (PDF x,y for post 4 ≡ post 5),
       which caps post 4 error at ~10m on the ground.
  Further improvement would require per-detail-sheet ground-truth digitizing or
  fixing Phase 02-06 N3 post-positioning for post 4.

files_changed:
  - parser/geo/label-lsq-calibrator.js (added refineAnchorPageByDownstreamChord)
  - parser/coordinate-calculator.js (imported + wired the new step after label chain)
