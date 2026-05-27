---

status: root_cause_found
trigger: CLI harness all posts within 10m; browser/web app some posts further
created: 2026-05-27
updated: 2026-05-27
priority_angle: Valmor regression — assignPostsByRouteOrder cable-entry heuristic (5e177ab) reverses post numbering direction on Valmor, placing post 1 at wrong end (x=169 instead of x=668), causing all posts to project in wrong GPS direction (east instead of west).

---

## Current Focus

hypothesis: |
  Commit 5e177ab ("fix(n3): orient OCR-fallback markers by cable entry") changed
  assignPostsByRouteOrder in parser/post-positioning.js to orient by the low-X endpoint
  of the Cabo Projetado cable instead of the old high-X heuristic. For Valmor (a route
  where OCR fails due to garbled fonts and falls back to assignPostsByRouteOrder), this
  flips post 1 to the wrong end: the cable enters from the RIGHT (high-X) side but the
  new heuristic assumes low-X entry. Result: posts 1-6 numbered in reverse spatial order,
  page 3 origin computed from wrong-end post 1, all posts walk in the wrong direction
  (east instead of west), 360m max error.

test: |
  At ed7ed71: post 1 = x=668.78 (right side), page 3 origin_e=726721, Valmor max=9.14m
  At HEAD: post 1 = x=169.58 (left side), page 3 origin_e=726898, Valmor max=360.98m

  Old logic: reverse when last.x - first.x > SAME_COLUMN_X_PT (high-X = post 1 end)
  New logic: find low-X cable entry, reverse if last marker is closer to entry
  → For Valmor: low-X entry is at ~x=0 (left side), first marker (x=169) is closer → no reverse → WRONG

expecting: |
  Fix: restore the original high-X heuristic for the fallback (or detect Valmor's entry
  correctly). A safe minimal fix is to check that the cable entry heuristic is correct
  only when the route is confirmed to enter from a low-X end, with fallback to high-X
  when cable paths on the page are ambiguous.

next_action: |
  Apply fix to assignPostsByRouteOrder and verify:
  1. Valmor: max ≤ 9.14m, 9/11 < 5m (restored invariant)
  2. João Born: max ≤ 9.90m, 23/34 < 5m (no regression)
  3. node --test parser/**tests**/coordinate-calculator.test.mjs passes

## Root Cause

The CLI harness and browser use the same parser code. The issue is NOT a CLI vs browser
code path split — it is a regression introduced in commit 5e177ab that affects ALL paths
(both CLI and browser) for Valmor.

### Chain of Causation

1. Valmor's PDF has garbled/encoded font text — OCR fails for Numero_Poste labels.
2. parsePdf falls back to assignPostsByRouteOrder to assign post numbers by spatial order
   along the cable.
3. At ed7ed71: old heuristic "reverse when last.x > first.x by threshold" correctly
   places post 1 at x=668.78 (right/high-X end = feeder end of Valmor's route).
4. Commit 5e177ab introduced a cable-entry-based orientation: find the leftmost (low-X)
   point in Cabo Projetado cable ops on the page, compare distance from first vs last
   marker to that entry, reverse if last is closer.
5. For Valmor page 3: Cabo Projetado cable runs from left to right (or has a leftmost
   point at ~x=100 or less). The first marker at x=169 is CLOSER to the low-X entry
   than last marker at x=668. New heuristic: no reverse. But correct behavior requires
   REVERSE (post 1 at high-X=668).
6. Post 1 is placed at x=169 (wrong end). buildPageTransforms derives page 3 origin from
   post 1's (wrong) position. Page 3 origin_e shifts from 726721 to 726898.
7. UTM projection now maps increasing x → increasing E (eastward), but Valmor's route
   goes westward. Posts 2-11 land 63-361m east of references.
8. applyDistanceLabelGpsChain SKIPS run 1 (posts 1-6, all page 3, same-page-only rule).
9. Run 2 (posts 7-11, page 4) also chains in wrong direction (gpsBearing from UTM = east).
10. refineGpsToPdfRouteCorridor (expanded in later commits to handle non-same-page neighbors)
    attempts reflection but further compounds error.

### Evidence

- At ed7ed71: parsePdf post 1.x = 668.78 → Valmor max 9.14m ✓
- At HEAD (5e177ab+): parsePdf post 1.x = 169.58 → Valmor max 360.98m ✗
- utm-calibrator.js UNCHANGED (confirmed git diff ed7ed71..HEAD — no changes)
- applyDistanceLabelGpsChain UNCHANGED (same skip logic, same return condition)
- The change is purely in assignPostsByRouteOrder's orientation decision (5e177ab)
- Valmor's Cabo Projetado cable has leftmost ops at low X; Valmor route enters from HIGH-X end

### Scope

- João Born: NOT affected (uses OCR successfully → assignPostsByRouteOrder fallback not triggered
  for João Born; it uses Viterbi/N3 for placement; post numbering from OCR layer is correct)
- Valmor: BROKEN (max 360m, 1/11 < 5m; was max 9.14m, 9/11 < 5m)
- Luiz Carolino / Praia do Siriu: unknown (no reference GPS; likely affected if OCR also fails)

### distanceLabelItems Omission in index.html (Secondary Finding)

index.html line 1142-1149: currentParseData does NOT include distanceLabelItems or
posteRawCentroids. Both fields are returned by parsePdf but not saved to currentParseData.
calculateCoordinates in the browser therefore receives distanceLabelItems: undefined.

Verification: For João Born this makes NO difference (supplementDistancesBesideAuxiliaryPosts
returns filled=0 either way — no unassigned auxiliary segments). For other routes with
auxiliary posts lacking distance labels, this MIGHT suppress useful distance filling.
This is a latent bug that does not reproduce on current test datasets but should be fixed.

## Fix Plan

### Fix 1 (required): Restore correct cable entry orientation for Valmor

In parser/post-positioning.js, assignPostsByRouteOrder, the cable-entry orientation
(introduced by 5e177ab) needs to account for routes where post 1 is at the HIGH-X end.

Option A: Revert to old heuristic for cases where cable entry is ambiguous.
  The old code: `if (last.x - first.x > SAME_COLUMN_X_PT) pageMarkers.reverse()`
  This worked for both João Born (post 26 fix was the goal) and Valmor.

Option B: Detect cable ENTRY correctly — use the endpoint NEAREST to the boundary of the
  page's viewport box, not simply the leftmost point.

Option C: Keep cable entry heuristic but also apply the old high-X fallback when cable
  entry gives a result that contradicts the old heuristic significantly.

Safest fix: Option A — revert the cable entry change, or at minimum apply it only when
  the old heuristic (high-X reverse) and cable entry agree. The session 14 notes say this
  fix was targeting João Born post 26, but the test in the joao-born-coords-off.md doesn't
  show this function being needed for João Born (João Born uses N3/Viterbi for post placement,
  not assignPostsByRouteOrder).

### Fix 2 (latent, low priority): Add distanceLabelItems to currentParseData in index.html

Line 1142-1149 of index.html: add distanceLabelItems and posteRawCentroids to the
currentParseData object so calculateCoordinates receives them in the browser.

## Symptoms Evidence

- debug-valmor-browser.mjs at HEAD: max 360.98m, 1/11 < 5m
- debug-valmor-browser.mjs at ed7ed71: max 9.14m, 9/11 < 5m (verified by git checkout test)
- debug-browser-path.mjs (João Born) at HEAD: max 9.90m, 23/34 < 5m (unaffected)
- parsePdf Valmor at ed7ed71: post 1 at x=668.78 (correct, right side)
- parsePdf Valmor at HEAD: post 1 at x=169.58 (incorrect, left side)
- utm-calibrator.js: no changes between ed7ed71 and HEAD
- 5e177ab diff: assignPostsByRouteOrder changed from high-X heuristic to cable-entry orientation

## Resolution

root_cause: |
  Commit 5e177ab changed assignPostsByRouteOrder to orient OCR-fallback post markers by
  the leftmost (low-X) Cabo Projetado cable endpoint instead of the traditional high-X
  heuristic. For Valmor (where OCR fails and this function is used), Valmor's route
  enters from the high-X (right) end of page 3, so the new heuristic places post 1 at
  x=169 (left/wrong end) instead of x=668 (right/correct end). This reverses the spatial
  numbering of posts 1-6, causes buildPageTransforms to compute a wrong origin_e, and
  projects all 11 posts ~60-361m east of their true positions.

fix: |
  Not yet applied — checkpoint written. Fix requires reverting/adjusting the cable-entry
  orientation heuristic in assignPostsByRouteOrder (parser/post-positioning.js, ~line 1996)
  so that Valmor's route direction is correctly detected. The safest fix is to restore the
  old high-X heuristic as the primary or to gate the cable-entry heuristic on additional
  evidence (e.g., the cable runs toward the anchor GPS anchor, not just low-X first).

verification: |
  Verified root cause by checking parsePdf output at ed7ed71 vs HEAD:
  - ed7ed71: post 1 x=668.78 → max 9.14m (correct)
  - HEAD: post 1 x=169.58 → max 360.98m (broken by 5e177ab)
  João Born unaffected (uses N3/Viterbi, not assignPostsByRouteOrder fallback).
