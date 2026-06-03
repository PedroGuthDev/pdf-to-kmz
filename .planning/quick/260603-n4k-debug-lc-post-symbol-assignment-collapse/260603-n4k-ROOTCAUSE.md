# 260603-n4k — LC Post-Symbol Assignment Collapse (posts 9/10/11 → wrong/shared poles)

**Date:** 2026-06-03
**Parent:** spun out of 260603-jk7 (label-assignment investigation), which proved LC's posts-1–20
deformation is NOT a label problem but an upstream **post-positioning** problem.
**Status:** Diagnosis complete; fix not yet attempted (post-positioning is Siriu-critical — gate first).

---

## The symptom (probe `debug-lc-post-fields.mjs`)

`parsed.posts` final pole positions (`x,y`) vs the number-label anchors (`anchorX/anchorY`):

| Post | x,y (assigned pole symbol) | anchorX,Y (number label — correct) | type |
|------|----------------------------|-------------------------------------|------|
| 6 | 328, 239 ✓ | 328, 239 | 11-600 (R) |
| 7 | 315, 338 ✓ | 315, 338 | 11-600 (U) |
| 8 | 298, 419 ✓ | 298, 419 | 11-300 (U) |
| **9** | **338, 343** ✗ | 295, 509 | 11-600 (U) |
| **10** | **305, 302** ✗ | 283, 562 | 12-300 (U) |
| **11** | **305, 302** ✗ | 319, 518 | 12-300 (U) |
| 22 | 305, 302 ✓ | 305, 302 | 12-300 (U) |
| 23 | 417, 343 ✓ | 417, 343 | 11-600 (U) |

Posts 6,7,8,12,22,23 have `x,y == anchor` (correct). **Posts 9, 10, 11 were assigned pole symbols
~200 pt away** (upper page, y≈302–343) from their correct lower-page anchors (y≈509–562). **Posts 10
and 11 collapsed onto post 22's symbol** at (305,302). The collapse is stable across both N3 passes
(`PP_DBG=1` shows the post numbers intact; only the `x,y` are wrong).

**Why the route still scores 185 m (not catastrophic):** final lat/lon come from the distance-edge
CHAIN + label-LSQ anchoring, not directly from pole `x,y`. But the collapsed `x,y` corrupt every
downstream consumer that reads `x,y` — tap detection (`isOffRouteCablePost`), cable-adjacency, and the
N3 calibration's own pole-anchored terms — feeding the posts-1–20 deformation.

## The stage

`assignPolesGloballyByLabels` (`parser/post-positioning.js:1554`), invoked from
`calibrateMultiSheetPostCoordinates` (`parser/post-positioning-n3.js:54`). It:
1. Partitions posts by page + nearest cable `pathIndex` (line 1603-1616).
2. **Filters out posts classed off the main cable** via `isOffRouteCablePost` (line 1630).
3. Builds per-post pole candidates inside an **arc-length window** along the route cable
   (`buildRouteCandidatesPerPost`, arcWindow ≈ `arcMax*1.35` or `medianEdgeM/scale*0.85`, line 1660)
   and assigns globally, **expecting monotonic arc advance** with route number.

## Root cause (same pathology that defeated the label fix)

The page-4 cable runs **7 → 8 → 11 → 9 → 10** by arc position `t` (probe `debug-lc-cable-hits.mjs`,
anchor coords: 7≈669, 8≈950, **11≈1320**, 9≈1327, 10≈1591). Two things follow:

1. **Posts 9 and 10 sit OFF the main cable** (d≈33 and 36 pt > the 30 pt `OFF_CABLE_FOR_LABEL_CHAIN_PT`
   threshold), so `isOffRouteCablePost` can drop them from `routePosts` — leaving them to a greedy /
   fallback that lands them on the wrong (and shared) symbol.
2. **Post 11 is drawn out of route order on the cable** (between 8 and 9). The global assignment's
   monotonic arc-window assumption is violated, so 9/10/11's candidate windows overlap and mis-resolve.

So the collapse is the **post-positioning manifestation of the same drawing reality** that produced the
phantom inferred edges in 260603-jk7: in the PDF, post 11 (and the 9,10 branch) are NOT in route-number
order along the drawn cable, and 9,10 are off the main cable.

### To confirm in the fix task (2 quick checks)
- Instrument line 1630: is each of 9,10,11 dropped by `isOffRouteCablePost`? (Add a PP_DBG line listing
  filtered post numbers per partition.)
- Instrument `buildRouteCandidatesPerPost`: how many in-window candidates does each of 9,10,11 get, and
  do they share the (305,302) symbol?

## Recommended fix direction (NOT label code — post-positioning)
1. **Make off-cable route posts first-class.** A numbered route post that is off the main cable (taps /
   branch poles like LC 9,10) must still receive ITS OWN nearest pole symbol — never be dropped into a
   shared fallback. Assign by label-anchor proximity when the arc-window assignment can't place it.
2. **Relax the monotonic-arc assumption** (or detect+handle out-of-sequence poles like 11) so a post
   drawn out of cable order doesn't steal/again-collapse neighbors.
3. **Never allow two route numbers to share one pole symbol** (`usedSymbol` guard exists at line 1595 —
   verify it actually blocks the 10/11→(305,302) double-assignment; it appears not to on the fallback
   path).
4. Gate every change against ALL 4 gates — `assignPolesGloballyByLabels` is the Siriu N3 calibrator and
   is highly regression-prone. Expect to need `npm run test:gate` + Valmor + DWG + LC green, with the LC
   baseline refreshed only on a genuine improvement.

## Reproduce
- `node debug-lc-post-fields.mjs` — the collapse table (raw + deduped).
- `node debug-lc-cable-hits.mjs` — cable arc-`t` order + off-cable distances (anchor coords).
- `PP_DBG=1 node debug-lc-post-fields.mjs` — N3 pass numbers (extend with per-partition filter/candidate logs).
