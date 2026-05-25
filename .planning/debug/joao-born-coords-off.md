---
status: verifying
trigger: Posts 4-14 on page 3 land 10-28m from reference; posts 1-3 and 15-34 are fine
created: 2026-05-18
updated: 2026-05-25

session_8_diagnosis: |
  Guard fired: NONE — refineAnchorPageByDownstreamChord is NOT silently failing.
  
  The plan premise (function emits zero [anchor-refit] lines) was based on the harness
  truncating warnings to "first 8". The function IS firing and succeeds:
  
  [anchor-refit-gate] multiSheetRoute=true pageTransforms.size=3 sorted[0].lat=-27.641966... augDistMapForSeams.size=66
  [anchor-refit] Page 3: refined scale 0.354610→0.348182 (×0.9819), θ 0.00°→-3.25° using post 1 + post 15 chord (354.9m); label RMSE 4.04→4.07 m.
  
  Both lines are present in warnings[] but appear at index ~16-17 (beyond the first 8
  shown by the harness). The diagnosis confirms: the current 18.97m max error on post 9
  IS the post-refit result. The anchor-refit applies scale ×0.9819 and θ=-3.25° (close
  to but not identical to the Procrustes optimum scale=0.9581/θ=-3.696°).
  
  Conclusion for Task 2: No fix needed — the function already works. The remaining error
  gap is due to:
  1. Procrustes global-transform floor for post 9 = 12.34m (inherent to page-3 distortion)
  2. The refit chord (post 1 → post 15) gives a slightly different θ/scale than the full
     14-post Procrustes optimum because it uses only 2 anchor points.
  Task 2 is SKIPPED. Split-region (Tasks 3+4) is the necessary next step.

session_8_fix: |
  Guard culprit: NONE (function was already working).
  
  Minimal change applied in Task 2: Removed all 9 [anchor-refit-diag] pushes from
  refineAnchorPageByDownstreamChord and the [anchor-refit-gate] push from
  coordinate-calculator.js. No behavioral change.
  
  Per-post errors for posts 9, 10, 11 before Task 2 (= baseline, Task 1 was diagnostic only):
    Post 9:  18.97m
    Post 10: 15.35m
    Post 11: 16.72m
  After Task 2 (diagnostics removed, no behavioral change):
    Post 9:  18.97m (unchanged)
    Post 10: 15.35m (unchanged)
    Post 11: 16.72m (unchanged)
  
  Valmor: max 9.14m, 9/11 < 5m — unchanged (multiSheetRoute=false, anchor-refit never fires).
  João Born posts 15-34: 22/34 < 5m — unchanged (session-7 invariant preserved).
  
  The [anchor-refit] Page 3: refined scale 0.354610→0.348182 success log remains
  in the function (4 [anchor-refit] Page strings in label-lsq-calibrator.js).

session_7_addendum: 2026-05-25 — post-25 arc-repair skip + soft theta prior implemented
session_7_result: |
  João Born: max 18.97m, 22/34 < 5m  (was 20/34 baseline; +2 posts under 5m)
  Valmor:    max  9.14m,  9/11 < 5m  (unchanged, no regression)

  Per-post deltas (joao-born, baseline → after fix):
    Post 21: 5.56m → 4.83m  (now < 5m)
    Post 22: 5.74m → 5.03m  (still > 5m but improved)
    Post 25: 14.77m → 7.29m (-7.48m biggest single-post gain)
    Posts 26-34 (page 5): no regression, several improved (post 26: 2.27→0.41,
                          post 28: 1.72→0.66, post 27: 1.20→1.85 ~flat, etc.)
    Posts 5-12 (page 3): unchanged (intrinsic Procrustes floor ~12-15m on
                         posts 9-11 — would need split-region per-page calibration)
    Two-anchor variant: 17/34 < 5m (same as baseline two-anchor — no regression).

session_7_changes: |
  1. parser/post-positioning.js:
     - repairConsecutiveLabelArcJumps accepts optional arcRepairedPosts Set (default null);
       when set, records each post number it relocates by label-arc distance walk.
     - realignPostsToMarkerAnchorWhenCablePulled accepts optional skipPostNumbers Set
       (default null); when set, skips those post numbers entirely so the label-driven
       arc-repair is not undone by nearest-anchor proximity.
     - repairPagesLabelArcFromPositions threads arcRepairedPosts through.
     - assignPolesGloballyByLabels creates one arcRepairedPosts Set, threads it to both
       Viterbi+arc-repair AND the final realign pass AND the greedy fallback realign
       (via opts.arcRepairedPosts).
     - assignPostPositionsFromPosteSymbols accepts opts.arcRepairedPosts and threads
       it to its realign call.

  2. parser/geo/label-lsq-calibrator.js (refinePageOriginsByLabelLsq):
     - Added soft theta prior per free page:
         priorPenalty = lambda_p * (theta_curr - theta_initial)^2
       contributing lambda_p to JtJ[theta_var, theta_var] and
       -lambda_p * (theta_curr - theta_initial) to Jtr[theta_var].
     - lambda_p is selected per page by cross-page label-link count:
         < 2 cross-page links (rotation-degenerate) → lambda = 10
         >= 2 cross-page links                      → lambda = 0.01
     - Per-iter accept threshold relaxed: trialRmse < bestRmse - 0.001 (was - 0.01).
     - Outer "improved" threshold relaxed: rmseBefore - rmseAfter > 0.001 (was > 0.05).
     - Acceptance metric (RMSE on label residuals) is unchanged — prior only steers
       gradient steps, not the accept/reject decision.

session_7_why_it_works: |
  Before fix, post 25 was at the wrong PDF symbol (1098.14, 46.38), giving
  pdfBearing(24->25) ~= 97.5°. The boundary-lock used this bearing to walk from
  page-4-projected post 25 to determine page-5's origin. The 97.5° bearing
  happened to align with the true seam crossing direction (coincidence — the
  underlying pdfBearing formula has a y-axis convention bug, but it was
  self-calibrated with the label walk because of where the wrong symbol was).

  The arc-repair fix moves post 25 to the correct symbol (1133.90, 51.84),
  changing pdfBearing(24->25) to 88.5° — a 9° shift. The boundary-lock now
  walks page 5 in a different direction. Without LSQ correction, this shift
  destroys page 5 (posts 26-34 land 16-20m off, max 19.6m).

  With the LSQ relaxed enough to accept the tiny RMSE improvement (4.01->4.00m,
  ~0.004m gain), pages 4 and 5 get a small theta refinement:
    page 4: theta=-0.20° (refined from cross-page links via 14->15 and 25->26)
    page 5: theta=-0.47° (refined from 1 cross-page link via 25->26)
  These refinements correct the boundary-lock walk direction enough to keep
  page 5 posts within 0-5m of reference.

  The soft theta prior is what allows the relaxed threshold to be safe:
  without it, the optimizer at small gain regime overfits page-5 theta to
  arbitrary directions (label-distance objective is rotation-invariant per
  page when all that page's segments are on the same page). With the prior,
  page-5 theta stays anchored near the cross-page-link-driven minimum
  rather than drifting along the degenerate direction.

  Net effect: post 25 14.77->7.29m, post 21 5.56->4.83m (now <5m), and
  page-5 posts stay at baseline accuracy (no regression). Total <5m count
  20/34 -> 22/34.

session_7_remaining_work: |
  Posts 9-11 page 3 floor remains:
    Post 9:  18.97m (Procrustes floor ~12.34m, gap 6.6m to optimum)
    Post 11: 16.72m (Procrustes floor ~8.88m, gap 7.8m)
    Post 10: 15.35m (Procrustes floor ~8.01m, gap 7.3m)

  Split-region page-3 calibration assessed but NOT pursued:
    - Even if we hit Procrustes optimum, posts 9-11 stay at 8-12m (still > 5m).
    - Requires substantial refactor (piecewise affine per region, region detection
      from post density, segment splitting at break points).
    - Disproportionate complexity for diminishing return (~4m residual at best,
      still > 5m threshold).
    - The intrinsic page-3 drawing distortion in the post 4-11 region is the cap.

  Posts 5-8 (page 3 midsection, 10-14m errors): similar story — they are within
  the page-3 distortion region. Anchor-page Procrustes already handles the
  global page-3 rotation/scale via refineAnchorPageByDownstreamChord; the
  remaining residuals are localized drawing distortions inside page 3.

  RECOMMENDED future work (low priority):
    1. Investigate page-3 PDF source: if the drawing has known per-region
       distortion (e.g., zoom callout boxes), fix at the PDF authoring stage.
    2. If multiple datasets show similar mid-page distortion patterns, design
       a per-region calibration heuristic (e.g., detect bend points in label
       distances and refit each region independently).
    3. Neither of these is justified by the current dataset alone.

session_5_addendum: 2026-05-25 — post 25 root cause confirmed; LSQ overfitting blocks adoption
session_5_finding: |
  Post 25 (14.77m error) and posts 9-11 (15-19m errors) investigated.

  POST 25 ROOT CAUSE: PDF position is wrong.
    - Browser parser snaps post 25 to symbol (1098.14, 46.38) at 61.5pt from post 24
      (~22m via scale=0.3546), but label 24→25 says 35.2m.
    - Correct symbol is (1133.90, 51.84) at 96.8pt from post 24 (~34.3m, matches label).
    - The "25" Numero_Poste label text is drawn 50pt to the LEFT of the actual symbol,
      so nearest-to-anchor search picks the wrong symbol (13.9pt to anchor vs 50pt).
    - assignPolesGloballyByLabels DOES detect this (repairConsecutiveLabelArcJumps walks
      forward 99pt along cable, finds (1133.90, 51.84) at 14pt of target, moves post 25).
    - But realignPostsToMarkerAnchorWhenCablePulled (line 668 and 1793 in
      parser/post-positioning.js) UNDOES the repair: it sees post 25 50pt from anchor,
      finds (1098.14) is 14pt from anchor (much closer), reverts to it.
    - Order of operations: Viterbi → greedy realign (undoes Viterbi) → arc-jump-repair
      (fixes back) → final realign (undoes again). The realign function has no awareness
      of the strong label-distance evidence from arc-jump-repair.

  POST 25 PROPOSED FIX (NOT COMMITTED — see "rejected" section below):
    Track post NUMBERS moved by repairConsecutiveLabelArcJumps in a Set, pass to
    realignPostsToMarkerAnchorWhenCablePulled, skip those posts. Tested and verified
    to leave post 25 at (1133.90, 51.84) end-to-end.

  WHY NOT ADOPTED — LSQ overfitting downstream regression:
    With post 25 at correct PDF position, refinePageOriginsByLabelLsq sees rmseBefore=3.67m
    (down from 4.94m). LSQ tries to improve but the per-iteration gain is < 0.01m → trial
    rejected → no progress → improved=false → ALL LSQ adjustments REVERTED to initial
    (raw UTM-grid transforms). Then boundary-lock fallback fires and uses pdfBearing(24→25)
    to extrapolate page-5 origin — but the bearing is now different (88.5° vs 97.5°),
    leading to a 20° walk error and 16-20m page-5 errors (posts 26-34 all blow up).

    Lowering LSQ thresholds (per-iter from 0.01 to 0.001, outer from 0.05 to 0.001)
    lets LSQ accept the marginal improvement (rmse 3.68→3.67) but it OVERFITS page-5
    theta to -1.02° (an arbitrary 1° rotation that minimizes label-distance residual
    by a fraction of a meter while moving page-5 GPS errors UP by 3-5m on posts 29-34).
    Page-5 is rotation-degenerate (only 1 cross-page label link via 25→26), so theta
    is not well-constrained from labels alone.

    Net production-equivalent results when applying the fix:
      Status quo:        max 18.97m, 21/34 < 5m   (post 25 at 14.77m, page 5 all OK)
      Fix + LSQ-strict:  max 19.57m, 13/34 < 5m   (post 25 at 6.12m, page 5 16-20m off)
      Fix + LSQ-relaxed: max 18.97m, 14/34 < 5m   (post 25 at 9.10m, page 5 5-8m)
    Net loss of 7 posts under 5m. Not worth committing the post-25 fix without
    addressing the LSQ degeneracy.

  POSTS 9-11 ANALYSIS (CONFIRMED INTRINSIC FLOOR):
    Free Procrustes on page 3 (best possible similarity transform with current PDF coords):
      Post 9:  12.34m
      Post 10:  8.01m
      Post 11:  8.88m
    Current pipeline:
      Post 9:  18.97m  (gap +6.6m from Procrustes optimum)
      Post 10: 15.35m  (gap +7.3m)
      Post 11: 16.72m  (gap +7.8m)
    The gap from Procrustes-optimum to current is ~7m for these mid-page-3 posts.
    refineAnchorPageByDownstreamChord already optimises page-3 scale + theta using
    post1 + post14 chord, but posts 9-11 are in the MIDDLE — the page-3 drawing has
    localized distortion there that can't be captured by a global page-wide transform.
    Further improvement would require: piecewise affine transforms per region,
    per-post calibration anchors, or fixing the page-3 PDF source (out of scope).

  RECOMMENDED FOLLOWUPS (next session):
    1. Constrain LSQ theta for rotation-degenerate pages (those with < 2 cross-page
       label links). Initial attempt (commenting out theta jacobian) caused page-4 to
       compensate by shifting its own theta by +1.35°, hurting baseline; needs more
       care (perhaps a soft prior penalty instead of hard zero).
    2. Replace pdfBearing-based boundary-lock with UTM-projected-bearing (apply page
       transform to the bearing reference vector before computing compass).
    3. Then commit the post-25 N3 fix (skip arc-repaired in realign).
    4. For posts 9-11: explore split-region calibration for page 3.

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

session_6_state: |
  Baseline reconfirmed (2026-05-25 pristine state):
    Max 18.97m, 20/34 < 5m. Top 5: Post 9 (19.0m), Post 4 (18.1m), Post 11 (16.7m),
    Post 10 (15.3m), Post 25 (14.8m).
  Valmor baseline: max 9.14m, 9/11 < 5m.

  ATTEMPTED FIX 1 — UTM-projected bearing in lockPageOriginsAtSheetBreaksFromPriorProjection
    (and the two related lock-at-sheet-break helpers):
      Added utmProjectedBearing helper that projects (from, to) → GPS via projectPost
      and uses gpsBearing. Replaced all four pdfBearing call sites in the three lock
      functions in coordinate-calculator.js.

    RESULT: REGRESSION (REVERTED).
      João Born: 20/34 → 2/34 < 5m. Every post shifted by ~15-20m.
      Valmor: unchanged (no boundary-lock active there).

  ROOT CAUSE OF REGRESSION:
    `lockPageOriginsAtSheetBreaksFromPriorProjection` is gated by `labelLsqImproved || n6 > 0 ? 0 : ...`
    and DOES NOT FIRE on the current João Born baseline (LSQ improves; n6=0).
    Likewise `lockSheetBreaksFromChainedGps` only fires when applyDistanceLabelGpsChain
    returned chained=true, which (per current baseline warnings) does NOT happen here.
    Thus the lock functions are dormant on baseline — changing the bearing inside them
    should have ZERO effect on baseline numbers.

    Yet swapping pdfBearing → utmProjectedBearing changed RMSE (4.44→3.98 became
    4.44→3.98 with my change, was 4.94→4.52 before stash; but a clean revert restored
    baseline behavior consistently). Multiple stash/pop cycles produced inconsistent
    numbers, suggesting a stale-state interaction or a side-effect path I haven't
    yet identified.

    Evidence: with clean checkout, `cable-arc-placer Repositioned 22` matches the
    pristine baseline. After a stash/pop cycle it changed to `Repositioned 21`,
    suggesting either: (a) stash/pop corrupted a transient state, or (b) one of my
    apparently-dormant lock functions IS being called by an upstream path I haven't
    found, and projection through page transforms with non-zero theta produces a
    materially different bearing (~31° difference measured: page-3 13→14 PDF bearing
    104.969° vs UTM-projected 73.865°).

    The 31° gap is the smoking gun. The pdfBearing formula uses atan2(dx, dy) where
    dy = to.y - from.y. utmFromPdfPoint subtracts ry*y_sf from origin_n (PDF +y → UTM
    south). So pdfBearing is correct only after flipping the y delta. Yet the function
    in cable-boundary-calibrator.js (line 333-339) DOES flip y (`const dy = a.y - b.y`)
    — proving the boundary-lock helpers in coordinate-calculator.js have a long-standing
    bug that nonetheless happens to be self-consistent within their downstream usage.

session_6_continuation_2026-05-25: |
  Cursor resumed Claude session a5f57cb8 (rate-limited mid-debugger).

  CONFIRMED (subagent abdc6444, before limit):
    - `[boundary-locked] 2 page origin(s)` fires on baseline — lockSheetBreaksFromChainedGps
      is active (warning was beyond harness first-8 filter).
    - pdfBearing in lock helpers is ~31° off true UTM (13→14: 104.97° vs chain 74.17°).
    - Naive utmProjectedBearing swap: REGRESSION (documented earlier).
    - Pinning lock to chained curr.lat/lon directly: REGRESSION (max 27m, reverted).

  HARNESS FIX (committed separately):
    debug-run-calc.mjs now runs N3 on PARSE DEBUG path (!useBrowserFixture).
    Post 4: 18.08m → 4.97m without needing --reassign-poles.

  STILL OPEN:
    - Post-25 realign skip (arc-repair Set) blocked by LSQ/page-5 degeneracy.
    - Soft theta prior for rotation-degenerate pages.
    - Bearing fix must preserve the accidental compensation in pdfBearing re-walk
      (buggy bearing + label walk is self-calibrated to ~20/34 today).

next_action: |
  session 7 (2026-05-25) COMPLETED:
    1. ✓ Post-25 arc-repair skip implemented (arcRepairedPosts Set threaded through
         repairConsecutiveLabelArcJumps → realignPostsToMarkerAnchorWhenCablePulled).
    2. ✓ Soft theta prior on rotation-degenerate pages in refinePageOriginsByLabelLsq
         (lambda=10 for pages with <2 cross-page links, lambda=0.01 otherwise).
    3. ✓ LSQ acceptance thresholds relaxed safely under the prior.
    4. ✓ Verified: 22/34 < 5m on João Born (+2), no regression on Valmor.

  Awaiting user confirmation before commit. Posts 9-11 page-3 floor work assessed
  as not feasible at proportionate complexity (Procrustes optimum still > 5m).

session_7_plan_2026-05-25: |
  Reasoning checkpoint:
    hypothesis: |
      Post-25 N3 fix (arc-repair skip set passed to realignPostsToMarkerAnchorWhenCablePulled)
      is correct at N3 level (post 25 → 1133.90, 51.84). Downstream regression is caused by
      page-5 being rotation-degenerate (only 1 cross-page link 25→26) in refinePageOriginsByLabelLsq,
      which makes the LSQ jacobian theta column near-zero for page-5 segments — letting LSQ
      either reject all changes (per-iter gain < 0.01m → revert ALL transforms) or overfit
      theta (relaxed threshold → arbitrary 1° rotation worsens posts 29-34 by 3-5m).
    confirming_evidence:
      - Session 5 LSQ guard logs: rmseBefore 3.676m, trial 3.6714m → improvement 0.0045m → REJECTED
      - Session 5 sweep: page-5 has only 1 cross-page label (25→26), all other page-5 segments
        are same-page so LSQ moves them only by translating page-5 origin; theta is unconstrained
      - Procrustes floor evidence: with correct post 25, page-5 should be ~1m max, but LSQ revert
        makes boundary-lock walk from a different bearing (97.5°→88.5° pdfBearing)
    falsification_test: |
      Add a soft theta prior to LSQ: lambda * (theta - theta_initial)^2 with lambda chosen so
      that the prior dominates when label-derived theta gradient is small. If hypothesis is
      correct: page-5 theta stays near 0, page-5 GPS errors stay at baseline (~5m max), AND
      post 25 drops from 14.77m to ~6m. If hypothesis is wrong: page-5 still regresses or LSQ
      gives up altogether.
    fix_rationale: |
      Soft prior is preferable to hard zero (proven to hurt page 4 by 1.35°). Lambda should
      be small enough not to fight strong label evidence, but large enough to act when the
      jacobian's theta column is near-zero (degenerate). Anchoring to theta_initial preserves
      whatever rotation buildPageTransforms found while preventing LSQ from making it worse.
    blind_spots:
      - Page-4 also adjusts theta (-0.50° per logs). Soft prior must not interfere with page-4's
        legitimate refinement when it has multiple cross-page links.
      - The "improved" guard (rmseBefore - rmseAfter > 0.05) might still cause revert even
        with the prior in place if the prior penalty cost is added to the residual sum.
        Solution: keep RMSE measurement unchanged (only label residuals), apply prior only
        to the normal equations (JtJ and Jtr) for the gradient step.
      - Lambda value is a hyperparameter; will tune empirically using A/B against baseline.

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

- hypothesis: simple fix to skip arc-repaired posts in realign solves post 25
  evidence: Fix works at the N3 level (post 25 ends at 1133.90, 51.84 after parsePdf),
    but downstream LSQ overfits page-5 theta (1° rotation worsens GPS by 3-5m on posts 29-34)
    or LSQ guard reverts entirely and boundary-lock destroys page 5. Net result is a 7-post
    regression in posts-under-5m count. The fix is technically correct but needs to be
    paired with LSQ degeneracy guards (next-session work).
  timestamp: 2026-05-25

## Evidence

- timestamp: 2026-05-25
  checked: Post 25 PDF position candidates on João Born page 4
  found: |
    Two pole-symbol candidates near post 25's label anchor (1084.82, 42.54):
      (1098.14, 46.38): dToAnchor=13.9pt, dTo24=61.5pt (~22m via scale, label 24→25=35.2m INCONSISTENT)
      (1133.90, 51.84): dToAnchor=50.0pt, dTo24=96.8pt (~34.3m, MATCHES label 35.2m).
       Three raw centroids at that position → genuine pole symbol.
    PDF walk from post 24 by label 35.2m along bearing(23→24) lands at (1134.55, 35.13)
       — 16.7pt from (1133.90, 51.84) but 38.1pt from (1098.14, 46.38).
    Page-4 Procrustes max error: 12.64m with wrong symbol → 7.95m with right symbol.
  implication: |
    (1133.90, 51.84) is the correct symbol. The browser/parser picks the wrong one
    because realignPostsToMarkerAnchorWhenCablePulled uses label-anchor proximity
    only, without considering distância_poste label consistency. This is the SOURCE
    of post 25's 14.77m error.

- timestamp: 2026-05-25
  checked: Sequence of N3 operations on post 25
  found: |
    Order of post-25 modifications during assignPolesGloballyByLabels:
      1. Viterbi assigns post 25 to (1133.90, 51.84) [correct, RMSE 0.3m on edges]
      2. assignPostPositionsFromPosteSymbols → realignPostsToMarkerAnchorWhenCablePulled
         moves post 25 BACK to (1098.14, 46.38) [reverts Viterbi: 50pt to anchor → 14pt]
      3. repairPagesLabelArcFromPositions → repairConsecutiveLabelArcJumps walks forward
         on cable by label 35.2m, finds (1133.90, 51.84), moves post 25 there
      4. Final realignPostsToMarkerAnchorWhenCablePulled (line 1793) sees split=50pt,
         finds (1098.14) closer to anchor, reverts AGAIN to (1098.14, 46.38)
  implication: |
    The realign function is too aggressive — it undoes valid arc-jump repairs.
    Fix candidate: track arc-repaired post numbers, skip them in realign (TESTED,
    works at N3 level but causes downstream LSQ regression — see "rejected" hypothesis).

- timestamp: 2026-05-25
  checked: LSQ guard behavior when post 25 is at correct position
  found: |
    With post 25 forced to (1133.90, 51.84):
      rmseBefore = 3.676m (down from 4.94m when post 25 was wrong)
      LSQ first iter trial = 3.6714m (improvement 0.0045m) → REJECTED (threshold 0.01m)
      Subsequent iters: no further improvement, all rolled back
      improved = false → ALL transforms REVERTED to initial buildPageTransforms output
    Boundary-lock fires next, walks page-5 from PDF bearing(post24→post25)=88.5° (new)
    instead of 97.5° (old wrong post 25). Net change in bearing: 9°.
    Result: page-5 posts 26-34 land 16-20m off (vs 1-5m when bearing was 97.5°).
    Lowering thresholds (per-iter 0.001, outer 0.001) lets LSQ accept the marginal
    improvement, but it then sets page-5 theta to -1.02° (overfit to label noise),
    causing page-5 posts 29-34 to drift 3-5m from previous good positions.
  implication: |
    The LSQ guard is brittle: when post 25 is correct, RMSE is already near optimum,
    so the LSQ cannot improve further AND the small per-iter gain triggers full revert.
    The underlying issue is that page-5 is rotation-degenerate (only 1 cross-page label
    via 25→26), so any LSQ theta adjustment overfits to noise. Need either:
    (a) prior-penalty on theta for rotation-degenerate pages
    (b) UTM-projected bearing in boundary-lock (not raw PDF bearing)
    (c) accept partial LSQ improvements without all-or-nothing revert
    Without one of these, the post-25 fix cannot be committed without regressing
    overall < 5m post count.

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
  Through session 4 fix (post 4 = post 5 dedupe):
    João Born single-anchor:    28.41m → **18.97m** max  (17/34 → **20/34** < 5m)
    João Born tail-anchor (1+34): 28.41m → **18.97m** max  (15/34 → **18/34** < 5m)
    Valmor (2-sheet, unguarded): 9.14m → **9.14m** max     (9/11 → **9/11** < 5m, unchanged)

  Through session 7 fix (post-25 arc-repair skip + soft theta prior):
    João Born single-anchor:    18.97m → **18.97m** max  (20/34 → **22/34** < 5m)
    João Born tail-anchor (1+34): 18.97m → 18.97m max    (17/34 → 17/34 < 5m, unchanged)
    Valmor (2-sheet, unguarded): 9.14m → 9.14m max       (9/11 → 9/11 < 5m, unchanged)

  Session 7 post-by-post improvements (João Born single-anchor):
    Post 21: 5.56m → 4.83m   (now < 5m)
    Post 22: 5.74m → 5.03m   (improved, still > 5m)
    Post 25: 14.77m → 7.29m  (-7.48m, biggest single-post gain)
    Posts 26-34 (page 5): no regression; several improved (post 26: 2.27→0.41,
                          post 28: 1.72→0.66, post 30: 2.83→2.80, etc.)
    Posts 5-12 (page 3 midsection): unchanged (intrinsic Procrustes floor).

  The remaining ~19m max on posts 9-11 is bounded by:
   (a) Intrinsic PDF page-3 drawing distortion (Procrustes-optimal anchored fit
       has max 15.79m and RMSE 8.70m — this is the theoretical floor for any
       page-wide similarity transform).
   (b) Post 4 N3 mis-positioning at post 5's symbol (PDF x,y for post 4 ≡ post 5),
       which caps post 4 error at ~10m on the ground.
  Further improvement would require per-detail-sheet ground-truth digitizing or
  per-region piecewise affine calibration (assessed as disproportionate complexity
  for diminishing return — Procrustes floor still > 5m for posts 9-11).

files_changed:
  - parser/geo/label-lsq-calibrator.js
      session 4: added refineAnchorPageByDownstreamChord
      session 7: added soft theta prior in refinePageOriginsByLabelLsq,
                 relaxed per-iter accept threshold (0.01 → 0.001) and outer
                 improved threshold (0.05 → 0.001) — safe under the prior
  - parser/coordinate-calculator.js (imported + wired refineAnchorPageByDownstreamChord)
  - parser/post-positioning.js
      session 7: threaded arcRepairedPosts Set through
                 repairConsecutiveLabelArcJumps, repairPagesLabelArcFromPositions,
                 realignPostsToMarkerAnchorWhenCablePulled,
                 assignPostPositionsFromPosteSymbols (via opts), and
                 assignPolesGloballyByLabels (owns the Set).
