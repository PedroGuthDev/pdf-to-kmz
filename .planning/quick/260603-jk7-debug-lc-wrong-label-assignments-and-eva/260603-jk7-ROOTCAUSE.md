# 260603-jk7 Root-Cause: LC Wrong Label Assignments

**Date:** 2026-06-03
**Scripts run:** `debug-lc-truth-vs-edges.mjs`, `debug-lc-label-assignments.mjs`, `debug-lc-offset-vs-deform.mjs`, `debug-lc-degree.mjs`

---

## Per-Edge Mechanism Table

| Edge | Truth m | Got m | Source/Stage | File:Line | Classification |
|------|---------|-------|--------------|-----------|----------------|
| 3→4 | 18.8 | null | `bifurcation-cleared` | `distance-associator.js:1548` (clearEdge) inside main bifurcation loop | **ambiguous-source** |
| 6→7 | 37.7 | 13.8 | `legacy-midpoint` (greedy) | `distance-associator.js:L143` `associateDistances`, candidates sort L218, assign L231 | **ambiguous-source** |
| 9→10 | 19.5 | 34.1 | `window-refine` | `distance-associator.js:L936` `refineSequentialWindows`, assign L1107 | **heuristic-bug** |
| 10→11 | 33.5 | 19.6 | `window-refine` | `distance-associator.js:L936` `refineSequentialWindows`, assign L1107 | **heuristic-bug** |
| 11→12 | 18.4 | null | `bifurcation-cleared` | `distance-associator.js:L1548` (clearEdge) inside main bifurcation loop | **ambiguous-source** |
| 20→21 | 381.6 | 29.8 | `jumpback-refill` | `distance-associator.js:L491` `rehomeNextSpanAfterJumpback` called from `applyJumpbackDistanceCleanup` | **ambiguous-source** |
| 22→23 | 39.4 | 25.5 | `legacy-midpoint` (greedy) | `distance-associator.js:L143` `associateDistances`, cascade from 6→7 consuming label li=62 | **ambiguous-source** |

Non-consecutive phantom edges present (not wrong per se but add complexity to route-walker):
- 3→1 (31.8m, `inferred-label`) — `inferDistanceEdgesFromLabels` L1138
- 9→11 (42.1m, `inferred-label`) — `inferDistanceEdgesFromLabels` L1138
- 11→8 (34.1m, `inferred-label`) — `inferDistanceEdgesFromLabels` L1138
- 31→29 (28.7m, `inferred-label`) — `inferDistanceEdgesFromLabels` L1138

---

## Hypothesis Confirmation / Refutation

### Hypothesis 1 — False bifurcations at posts 2 and 10

**Status: CONFIRMED**

The `[distance-assoc] Bifurcation at post 2: label 18.8 m on 2→4 (cleared 3→4)` and `Bifurcation at post 10: label 18.7 m on 10→12 (cleared 11→12)` warnings both fire. The main bifurcation loop at L1506 of `distance-associator.js` triggers for posts 2 and 10 because:

- Posts 2→3→4 are on pages 3→4 with a cross-page boundary (`pageSpread=1`). The detour-ratio bypass at L1553 only applies to same-page. Cross-page always enters the bifurcation logic.
- Post 2 (page 3) has neighbor 3 (page 3) and mainNext 4 (page 4). The label 18.8m at li=51 (`x=388, y=44`) is on page 4, and its gap to chord 2→4 wins over chord 3→4.
- Post 10 (page 4) has tap 11 (page 4) and mainNext 12 (page 5). The label 18.7m at li=73 (`x=292, y=47`) is on page 5 (border), close to chord 10→12.

Effect: steps 3→4 and 11→12 are `bifurcation-cleared` (meters=null). This directly breaks the route at two points in the posts 1–11 cluster.

`requireTapLegCorroboration` would NOT suppress these — the tap-leg path at L1537 only fires when a `bifurcation-main` edge *already exists*; the main creation path at L1559ff still runs regardless of corroboration.

### Hypothesis 2 — Short label 13.8m wins greedy 6→7 over true ~37.7m

**Status: CONFIRMED (but root cause is "no true label exists")**

The 37.7m true chord (ground-truth distance) has **no corresponding label in the PDF**. There is no ~37.7m `Distância_Poste` label anywhere in `distanceLabelItems` for step 6→7. The greedy associator at L143 (`associateDistances`) assigns label li=62 (value=13.8m, page 4, `x=323,y=313`) to 6→7 because that label is the physically closest label to chord 6→7 that passes all filters (gap=4.4pt, which is essentially on the chord). Labels with other values (28.1, 12.7, 25.3) that are also near the 6→7 chord belong to other segments and get consumed by those steps first or have higher gap scores.

There is no "heuristic mis-ranking" — the label that wins IS the geometrically correct winner for the wrong value. The PDF itself omits the ~37.7m label for the 6→7 step. This is an **ambiguous-source** problem: the correct label is absent from the PDF.

The cascade effect: because li=62 (13.8m) is consumed by 6→7, step 22→23 (which also sits geometrically near li=62, gap=4.2pt) loses its best label and falls back to li=61 (25.5m, gap=9.9pt) instead of a ~39.4m label. No ~39-40m label exists in the PDF at all, so 22→23 has no recoverable correct assignment.

### Hypothesis 3 — Inferred-label phantoms (3→1, 9→11, 11→8)

**Status: CONFIRMED**

`inferDistanceEdgesFromLabels` at L1138 emits exactly these three non-consecutive edges:
- 3→1 (31.8m, li=40 at page 3, `x=396,y=622`) — label sits near chord 3→1, passes tProj [0.1,0.9] and ratio check.
- 9→11 (42.1m, li=9 at page 2, overview) — label sits near chord 9→11 on the overview page.
- 11→8 (34.1m, li=45 at page 4, `x=325,y=475`) — label near chord 11→8.

These phantom non-consecutive edges are correct in that they reflect real geometry (the labels ARE physically near those chords), but they create deg≥3 junctions at posts 8, 9, 10, 11 (all `deg=3` in the label-graph degree output), which is what drives the false bifurcation detections at posts 2 and 10 and complicates route-walking. The inferred edges themselves are not the primary route error but they compound the label-graph complexity.

---

## Window-Refine Swap: 9→10 / 10→11 Detailed Mechanism

This is the only **heuristic-bug** finding where a contained fix might be possible.

**Geometry:** Post 11 (`x=318.9, y=517.6`) is spatially between posts 9 (`x=294.5, y=509.0`) and 10 (`x=283.5, y=562.1`) in the Y direction — post 11 is a branch that juts back toward post 9's Y level. This means chord 10→11 points diagonally toward post 9's Y region.

**Label positions:**
- li=44 (19.6m) at `x=314, y=550`: gap to chord 9→10 = 27.4pt, gap to chord 10→11 = 16.3pt
- li=45 (34.1m) at `x=325, y=475`: gap to chord 9→10 = 45.5pt, gap to chord 10→11 = 43.2pt

**Greedy (L218 `associateDistances`) gets it right:** It assigns li=44 (19.6m) to 9→10 first (lower score 27.4 than 10→11's 16.3... wait — the greedy pass processes all segments in parallel. The greedy sorts all candidates by score; li=44 scores 27.4 for 9→10 and is assigned there. Then li=45 (34.1m) goes to 10→11. This matches truth (9→10=19.5m actual, 10→11=33.5m actual).

**Window-refine (L936 `refineSequentialWindows`) breaks it:** The window-refine scores li=44 (19.6m) as 17.3 for 10→11 vs 28.0 for 9→10. So when it tries a 3-segment window that includes both 9→10 and 10→11, the optimal injective assignment finds li=44→10→11 (17.3) + li=45→9→10 (65.5) = cost 82.8 for 2 segments, which beats the current greedy assignment's window cost. The refinement writes 34.1→9→10 and 19.6→10→11 (WRONG).

**Why the scale factor alone does not save it:** The page-4 scale factor is 0.3546 m/pt. Chord 9→10 = 54.3pt → 19.3m (ratio to 19.6m = 0.98, penalty=0.6). Chord 10→11 = 56.9pt → 20.2m (ratio to 19.6m = 1.03, penalty=1.0). Both chords are nearly identical in PDF length — so ratio penalty does not discriminate. The gap alone drives the score, and li=44 IS physically closer to chord 10→11 in PDF coordinates even though the truth says 9→10=~19.5m.

**Root cause in one sentence:** The window-refine swap fires because post 11 juts geometrically back toward post 9 in PDF coordinates, making label li=44 (19.6m) closer to chord 10→11 than to chord 9→10, which the refiner correctly observes but incorrectly treats as evidence for swapping — the geometry is ambiguous but the greedy's original assignment matched truth.

**Is this a heuristic-bug or ambiguous-source?** Classified as **heuristic-bug**: the signal (greedy score) was correct, but the window-refine applies an improvement criterion (`bestCost + 1e-6 < currentCost` at L1086) that does not account for whether the segment re-scoring reflects a genuine mis-assignment. A targeted fix — suppressing the window-refine swap when the affected window touches a label-graph junction (deg≥3 posts) — would be geometry-only and post-number-literal-free.

---

## Offset vs Deformation Summary

Confirmed (from `debug-lc-offset-vs-deform.mjs`):

- **Posts 1–20:** Mean offset vector 167m @ 344deg. **Residual (deformation) mean=118.9m, max=172.6m.** The error is NOT a rigid offset — it is pure deformation from the cascading wrong label assignments above (bifurcation clears, 6→7 wrong value, 9→10/10→11 swap).
- **Posts 21–31:** Mean offset vector 179m @ 303deg. **Residual mean=9.6m, max=40.0m.** This IS primarily a rigid offset — the label assignments are correct for 21→31 (all `legacy-midpoint` with delta <3m). The 179m rigid offset for posts 21–31 is a **calibration/anchor** issue unrelated to label assignment; it likely stems from the UTM calibration anchor being taken from a different PDF sheet page from where posts 21–31 physically lie.

---

## Root-Cause Summary (one paragraph)

The LC label assignment produces seven wrong consecutive edges in posts 1–31. Four of them (`3→4`, `11→12`, `20→21`, `22→23`) are **ambiguous-source** errors: the correct label value is absent from the PDF or the cross-page geometry makes the correct association ambiguous, and no reasonable heuristic change in `distance-associator.js` can recover the missing information. Two of them (`9→10`, `10→11`) are a **heuristic-bug**: `refineSequentialWindows` (L936–L1116) swaps the greedy's correct assignment by exploiting the anomalous back-jutting geometry of post 11 in PDF coordinates, and a targeted junction-aware suppression rule could prevent this. One (`6→7` = 13.8m) is **ambiguous-source**: the PDF simply omits the ~37.7m label for that step — the greedy assigns the only nearby label (13.8m) which is geometrically on the chord. The `22→23` wrong assignment is a cascade of `6→7`: li=62 (13.8m) is consumed by 6→7, leaving 22→23 with no correct option since no ~39.4m label exists in the PDF. The posts-21–31 ~179m rigid offset is a separate issue (calibration anchor, not label assignment) and is outside the scope of `distance-associator.js`.
