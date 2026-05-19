---
slug: fix-posts-3-4-9-accuracy
created: 2026-05-18
status: researched
tags: [accuracy, coordinate-calculator, snap, label-chain]
---

# Quick Task: Fix Posts 3, 4, 9 > 5m Errors

**Goal:** Reduce GPS error for posts 3, 4, and 9 from current 6–8m to < 5m.

## Current State (from `node debug-run-calc.mjs`)

| Post | Error | Root cause |
|------|-------|------------|
| 3    | 6.74m | Segment-snap (2nd pass) places at cable point with correct distance but WRONG direction from post 2 |
| 4    | 7.34m | Nearest vertex at 34.36pt (just outside 30pt threshold); page-3 label chain SKIPPED |
| 9    | 8.15m | Same snap direction error as post 3; page-4 chain propagates bad bearing |
| All others | < 5m | OK |

Distance labels: ALL 10 segments have labels (1→2: 36.1m, 2→3: 39.5m, 3→4: 32.3m, 4→5: 42.2m, 5→6: 29.7m, 6→7: 41.2m, 7→8: 38.8m, 8→9: 41.2m, 9→10: 37.8m, 10→11: 34.3m).

---

## Root Cause Analysis

### Post 3 and Post 9 — Direction-wrong snap

Both were snapped via the **2nd-pass segment snap** (nearest point ON cable, 100pt max).

- Post 3: anchor (477.86, 471.54) → snapped (455.90, 496.20) — 33pt move
- Post 9: anchor (944.54, 383.22) → snapped (914.62, 409.92) — 40pt move

The segment snap moves them in the CORRECT general direction (south and west), but not far enough. The PDF distance from the previous post MATCHES the label (post 2→3: 39.8m calc vs 39.5m label; post 8→9: 41.4m calc vs 41.2m label), so distance-ratio checks cannot detect these bad snaps.

**The cable segment at these locations is not co-located with the physical pole — it runs nearby but not through the exact pole position.** The snap moves to the nearest cable point, which is correct in distance but wrong in bearing.

True positions (from error analysis):
- Post 3 should be ~14–19pt FURTHER south and ~11pt further west than snapped
- Post 9 should be ~14pt FURTHER south than snapped

### Post 4 — Threshold miss

Nearest cable vertex is at 34.36pt from OCR position, just outside the 30pt vertex-snap threshold. Falls through to segment snap but ends up at the OCR position (no nearby segment point either). Error of 7.34m is almost entirely in longitude (7.35m too far east = ~20.7pt too far east in PDF).

The vertex at 34.36pt is likely the CORRECT vertex for post 4. Increasing threshold to 40pt would capture it.

### Page-3 label chain skipped

`applyDistanceLabelGpsChain` explicitly skips the page-3 run:
```javascript
if (startIdx === 0 && runPage === sorted[endIdx].pageNum) {
  continue;  // skips posts 1–6 entirely
}
```

If enabled, it would chain from post 1 (exact GPS) → post 2 → ... → post 6.

**Problem:** The chain bearing for segment 2→3 uses `gpsBearing(utm[1], utm[2])`. Since utm[2] (post 3) has 6.74m error with a northward bias, the bearing is ~8° off from true. At 39.5m, this gives ~5.5m lateral error — similar to current error.

So enabling the page-3 chain WITHOUT fixing the bearing doesn't help posts 3 and 4.

### Page-4 chain bearing propagates post-9 error

For segment 8→9: bearing uses `gpsBearing(utm[7], utm[8])` (UTM posts 8 and 9). UTM post 9 is wrong (8.15m north bias), so the chain bearing for 8→9 is ~8° too northward, causing the chained post 9 to also be placed too far north.

---

## Solution Options (ranked by impact/effort)

### Option A — Distance-constrained snap (HIGH IMPACT, MEDIUM EFFORT)

**Concept:** Add a 3rd snap pass. For each post with a label distance to its previous neighbor, if the current snapped position gives a distance that's > 8% off from the label, find the cable point that lies at EXACTLY the label distance from the previous post.

**Algorithm:**
1. Sample cable segments in 0.5pt steps
2. For each cable point P near the anchor (within 80pt): compute dist(prev_snapped, P)
3. If |dist(P) - target_pdf_dist| < 5pt and P is closer to anchor than current best → P is a candidate
4. Pick candidate closest to anchor

**Why this works for post 3:**
- Post 2 snapped at correct position
- Target PDF dist from post 2 to post 3: 39.5 / 0.3546 ≈ 111.4pt
- Circle of radius 111.4pt centered at post 2 intersects cable at TWO candidate points
- True post 3 is on the cable at ~111pt from post 2, but further south than current snap
- The constraint picks the correct point (closest to anchor, on correct cable segment)

**Required changes:**
- Pass `distMap` and `scaleFactor` to `snapPostsToPolyline()`
- Add `findCablePointAtDistance(prevX, prevY, targetDist, anchorX, anchorY, pageNum, cablesByPage, tol)` helper
- Run after existing 1st + 2nd pass; only for posts where distance ratio > 8% off

**Estimated error after:** Posts 3 and 9 → likely < 3m. Post 4 unchanged by this pass.

---

### Option B — Raise snap threshold to 40pt + post-snap consistency check (LOW EFFORT)

**Concept:** Increase vertex-snap threshold from 30pt to 40pt. Post 4's correct vertex at 34.36pt would be captured. For any post where raising threshold worsens the label-distance ratio, revert to the lower threshold result.

**Risk:** Posts 1 (34.38pt), 5 (33.78pt), 6 (35.82pt), 7 (35.18pt), 10 (36.15pt), 11 (35.06pt) are ALL within 34–36pt of their nearest vertex. Currently accurate WITHOUT snapping. Snapping them to wrong vertices could hurt their accuracy.

**Mitigation:** After raising threshold, check label-distance ratio for each newly snapped post. If ratio is worse (further from 1.0) than before snap, revert.

**Required changes:**
- `snapPostsToPolyline()`: try threshold=40pt; measure dist to prev for new snaps vs old; revert if worse
- Requires passing `distMap` and `scaleFactor` (same as Option A)

**Estimated error after:** Post 4 likely → < 4m. Posts 3, 9 unchanged.

---

### Option C — Enable page-3 label chain with look-ahead bearing (MEDIUM EFFORT)

**Concept:** Remove page-3 skip restriction. Change bearing computation to use a wider window:
- For each step i, check if `|pdf_dist(i-1→i) × scale - label| / label > 0.10`
- If YES (inconsistent segment): find next reliable post j where j > i and the segment i-1→j IS consistent; use bearing from utm[i-1] to utm[j]
- If NO: use normal bearing utm[i-1]→utm[i]

For segment 3→4: pdf_dist (28.1m) vs label (32.3m) → 13% off → UNRELIABLE
- Look ahead to post 5 (0.45m error, reliable)
- Bearing from utm[2] (post 3) to utm[4] (post 5): accurate since both are reliable
- Place post 4 at 32.3m in this bearing from chain post 3

For post 9: segment 8→9 pdf_dist (41.4m) vs label (41.2m) → 0.5% off → appears reliable
- Problem: the distance matches but the direction is wrong
- Cannot detect with ratio check alone
- **This option does NOT fix post 9**

**Required changes:**
- Remove `startIdx === 0 && runPage === samePage` restriction in `applyDistanceLabelGpsChain`
- Add look-ahead bearing logic for inconsistent segments
- Pass `scaleFactor` to the function

**Estimated error after:** Post 4 → ~3–4m. Posts 3, 9 unchanged (or slightly worse if bearings degrade).

---

### Option D — Combined A + B (RECOMMENDED)

Implement Option A (distance-constrained snap) + Option B (threshold-40pt with rollback).

**Expected outcomes:**
- Post 3: ≤ 3m (constrained snap finds correct cable position)
- Post 4: ≤ 3m (vertex snap at 34.36pt OR constrained snap)
- Post 9: ≤ 3m (constrained snap finds correct position)
- Posts 1, 2, 5–8, 10–11: unchanged (A does not modify posts with consistent distances; B reverts if worse)

---

## Implementation Plan

### Task 1 — Add distance-constrained snap pass (Option A)

**File:** `parser/coordinate-calculator.js`

1. Change `snapPostsToPolyline(posts, cableSegments, warnings, threshold = 30)` signature to:
   `snapPostsToPolyline(posts, cableSegments, warnings, threshold = 30, distMap = null, scaleFactor = null)`

2. Sort posts by number before 3rd pass (chain order needed)

3. Add `findCablePointAtDistance(prevX, prevY, targetPdfDist, anchorX, anchorY, pageNum, cablesByPage, tolerance = 8)` helper:
   - Samples cable segments by walking each segment's ops at 0.5pt steps
   - Candidates: points where |dist(point, prev) - targetPdfDist| < tolerance AND dist(point, anchor) < 80pt
   - Returns candidate closest to anchor, or null if none

4. 3rd pass loop: for each post i > 0 in sorted order:
   - If no label for (prev→curr) segment: skip
   - Compute targetPdfDist = label / scaleFactor
   - Compute actualPdfDist = hypot(curr.x - prev.x, curr.y - prev.y)
   - If ratio is within 8%: skip (no refinement)
   - Call findCablePointAtDistance; if found and closer to anchor than current pos: update curr.x/y

5. Update call in `calculateCoordinates`:
   ```javascript
   snapPostsToPolyline(sorted, cableSegments, warnings, 30, distMap, scaleFactor);
   ```
   (scaleFactor is already computed by this point)

### Task 2 — Raise threshold to 40pt with rollback (Option B)

**File:** `parser/coordinate-calculator.js` → `snapPostsToPolyline`

After the greedy vertex assignment (1st pass), before the segment snap (2nd pass):
- Try re-running vertex assignment with threshold=40pt for posts NOT yet snapped
- For each new snap at 40pt: compute actualDist to prevSnapped vs targetDist from label
- If ratio is WORSE than pre-snap OCR position ratio: revert

This requires a snapshot of the pre-snap positions for comparison.

Alternative simpler approach: just raise threshold to 40pt globally. Test to verify posts 1, 5, 6, 7, 10, 11 don't get worse. If they do, use the per-post rollback.

### Task 3 — Verify with debug-run-calc.mjs

After each implementation:
```bash
node debug-run-calc.mjs
```

Success criterion: posts 3, 4, 9 all < 5m. Regression check: all previously-accurate posts remain < 5m.

---

## Files to Modify

- `parser/coordinate-calculator.js` — main changes (snapPostsToPolyline, calculateCoordinates)
- `parser/__tests__/coordinate-calculator.test.mjs` — add test for distance-constrained snap

## Key Constraints (from .continue-here.md)

- Do NOT revert to isotropic Y scale — keep hybrid (UTM X, viewport-ratio Y)
- Do NOT change `buildPageTransforms` origin math
- Post 01 must stay within 5m of user-provided GPS anchor
