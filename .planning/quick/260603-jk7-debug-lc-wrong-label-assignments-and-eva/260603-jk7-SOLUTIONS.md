# 260603-jk7 — LC Label Assignment: Evidence-Based Solutions (session 2)

**Date:** 2026-06-03
**Trigger:** User supplied the LC detail-sheet screenshots and asserted "the PDF is not the
problem, we will adapt." This session re-investigated with that lens and **overturns** the
session-1 ROOTCAUSE "5/7 ambiguous-source / missing data" conclusion.

---

## Finding 1 — The PDF data is excellent; the bug is ASSIGNMENT, not missing data

`Distância_Poste` is a **named PDF layer** with precise values. Probe `debug-lc-geom-vs-label.mjs`
(truth vs drawn-chord-geometry vs assigned label) shows that **where a label is correctly
assigned, it is sub-meter accurate** (|label−truth| = 0.0–0.9 m on every correct span).
`mean |label−truth| = 15.4 m` is inflated entirely by the handful of mis-assignments.
`mean |geom−truth| = 6.5 m` (drawn geometry is noisier than the labels, but good enough as a veto).

Re-check of each wrong edge against the **full 84-label inventory** (`debug-lc-label-assignments.mjs`):

| Edge | Truth | Got | Correct label in PDF? | Drawn geom | Real cause |
|------|-------|-----|----------------------|-----------|-----------|
| 9→10 | 19.5 | 34.1 | **YES** `19,6` idx 44 | 19.3 ✓ | `refineSequentialWindows` swap |
| 10→11 | 33.5 | 19.6 | **YES** `34,1` idx 45 | 20.2 ✗ (post 11 juts) | label 34,1 eaten by phantom 11→8 |
| 3→4 | 18.8 | null | **YES** `18,8` exists | xpage | bifurcation steals label to 2→4 |
| 11→12 | 18.4 | null | **YES** `18,x` exists | xpage | bifurcation steals label to 10→12 |
| 6→7 | 37.7 | 13.8 | NO exact label | 35.5 ✓ | `13,8` on-chord, ratio veto bypassed |
| 22→23 | 39.4 | 25.5 | NO exact label | 42.3 ✓ | cascade; `25,3/25,5` nearby |
| 20→21 | 381.6 | 29.8 | cross-sheet | xpage | needs per-sheet UTM georef |

**6 of 7 are recoverable from data the parser already extracts.** Only 20→21 (a real cross-sheet
381 m jump, "VER PRANCHA 04") needs per-sheet georeferencing.

## Finding 2 — The unifying root cause

The parser reconstructs **topology + metric from floating-text proximity**, while the draftsman
already drew both. Underused extracted layers: `TrechoPrimarioAereo` / `TrechoSecundarioAereo`
(the actual drawn cable spans, `cablePaths` > 0 per page) and the per-sheet UTM grid. The
associator throws away the drawn-geometry signal exactly when it matters (on-chord ratio bypass
at `distance-associator.js:202`) and lets a local proximity refiner override correct greedy
assignments.

---

## What was tried this session (all gated, all reverted)

### Fix C — window-refine drawn-geometry guard (`refineSequentialWindows`)
Block an equal-coverage (pure-swap) window-refine when it worsens agreement between the assigned
value and the scaled drawn-chord length. Geometry-only, no post-number literals.

- **Result:** corrected 9→10 (was a −14.6 m mislabel). **DWG gate improved 114.88 → 95.16 m**
  (clean pass). Valmor + Siriu unchanged-green. **This guard is Siriu-safe — a proven, principled
  improvement** and is worth re-landing on its own merits (esp. the DWG win).
- **But:** LC gate tripped posts 8/9 by ~1 m. Cause: **9→10 and 10→11 are a compensating pair.**
  Original (wrong) 9→10=34.1 + 10→11=19.6 sums to 53.7 ≈ truth 53.0; the LC baseline was built on
  that lucky cancellation. Fixing 9→10 alone (→19.6) makes 9→11 sum 39.2 — the global label-LSQ
  redistributes and nudges posts 8/9 over their tight ceilings.

### Fix A — on-chord ratio veto (`associateDistances:202`)
Reject an on-chord label whose value is >2.5× off the drawn chord length (`13,8` on the ~35 m 6→7).
- **Result: REJECTED.** Vetoing `13,8` from 6→7 freed it to migrate onto the cross-page 20→21 span
  (made it **worse**, −367.8 m), while 6→7 grabbed the next wrong label `25,3`. A proximity veto
  just shuffles wrong labels — it does not converge. Not viable.

**Both reverted. Parser is at pristine baseline; all 4 gates green (LC 185.63 / Valmor 2.22 /
DWG 114.88 / Siriu 22-pass).**

---

## Why the trip is UNAVOIDABLE incrementally

To avoid the posts-8/9 trip, 10→11 must be fixed alongside 9→10 (preserve the cumulative). 10→11's
correct label `34,1` (idx 45) is consumed by the **phantom inferred edge 11→8**
(`inferDistanceEdgesFromLabels:1194`). Every pure-geometry heuristic *prefers the phantom*: post 11
is drawn jutting back toward post 9, so the 11→8 chord scores **better** (gap 14.5 vs 16.3) than the
true 10→11, and the drawn 10→11 length (20.2) is itself wrong. No drawn-geometry guard can override
that — only the label can, and the phantom claims it first (inferred runs before sequential **by
design**, to protect Siriu branch-returns; reordering regresses Siriu).

---

## The real fix (cable-topology — the deferred larger approach), now pinpointed

**Validate inferred-label edges against drawn-cable connectivity.** An inferred non-consecutive
edge (a,b) should only be created/claim-a-label if the drawn cable (`TrechoPrimarioAereo` /
`TrechoSecundarioAereo`) actually connects a↔b more directly than through the sequential chain.
- LC's phantom 11→8 is NOT cable-adjacent (cable goes 8→9→10→11) → reject → `34,1` freed → 10→11
  correct → 9→10/10→11 both fixed → cumulative correct → **no posts-8/9 trip**.
- Siriu's genuine branch-returns ARE cable-connected → still claimed → Siriu safe.

Apply the same cable-connectivity gate to the **bifurcation clears** (3→4, 11→12): only clear a
consecutive span if the drawn cable does not traverse it.

### Recommended sequencing for a future cable-topology task
1. Build a cable-adjacency map from `TrechoPrimario/Secundario` polylines snapped to `Poste` symbols
   (infra partly exists: `buildCablesByPage`, `fillAdjacentMissingDistances`, `isOffRouteCablePost`
   in `parser/geo/label-lsq-calibrator.js`).
2. Gate `inferDistanceEdgesFromLabels` on cable-adjacency → fixes 10→11 (frees `34,1`).
3. Re-land the **Fix C** window-refine geometry guard (proven Siriu-safe, +DWG) — now 9→10 AND
   10→11 are both correct, so the cumulative holds and the LC gate clears; refresh LC baseline to
   the genuinely-improved state.
4. Gate bifurcation clears on cable-adjacency → fixes 3→4, 11→12.
5. 6→7 / 22→23: once the phantom edges are gone, the cable-prefill
   (`prefillGapDistancesForPolePlacement`) fills the truly-unlabeled spans from cable length.
6. 20→21 + posts-21–31 rigid ~179 m offset: per-sheet UTM georeferencing (separate, largest piece).

### Decision
The user chose "incremental gated fixes, keep only if the trip is avoidable." It is not avoidable
incrementally (post-11 geometry + phantom-eaten label). All session changes reverted; this doc is
the hand-off for the cable-topology task that will actually land 6/7 edges.

---

## Session 2b — cable-adjacency attempt: DEFEATED by a deeper post-positioning pathology

I implemented the cable-adjacency veto (new `postsCableAdjacent` in `cable-builder.js`, threaded
`cablesByPage` into `inferDistanceEdgesFromLabels`). It did NOT reject the phantom 11→8. Probing the
page-4 cable hits (`debug-lc-cable-hits.mjs`) exposed two upstream problems that defeat the whole
cable-topology approach for LC as-is:

1. **Collapsed post coordinates.** Posts 9, 10, 11, 22 all share `x,y = (305,302)` — a default — while
   only their `anchorX/anchorY` are distinct. Cable snapping (and `isTapPoleRaw`, etc.) use `x,y`, so
   those posts all snap to ONE cable point. (The route survives at 185 m because coordinates come from
   the distance-edge CHAIN + label-LSQ anchoring, NOT from post `x,y` — which is also why labels matter
   so much and why `x,y` collapse isn't catastrophic.)

2. **Posts drawn out of route-order along the cable.** Using `anchorX/anchorY`, page-4 path-1 arc
   positions (`t`) are: 7≈669, 8≈950, **11≈1320**, 9≈1327, 10≈1591. So the drawn cable runs
   **7→8→11→9→10**, and **posts 9,10 sit OFF the main cable** (d≈33–36 pt > the 30 pt threshold) while
   **post 11 sits ON it** (d≈7.8) between 8 and 9. Cable-adjacency therefore reports 8↔11 as *adjacent*
   (no numbered post on the arc between them) — so it cannot reject the phantom 11→8. The drawing
   encodes post 11 between 8 and 9 on the cable even though the route sequence is 8→9→10→11.

**Conclusion:** the LC posts-1–20 cluster is not fixable by label-assignment or cable-adjacency tweaks.
The cable + the route numbering genuinely disagree about post 11 (and the 9,10 branch), and the post
`x,y` are partly collapsed. This is a **post-positioning / junction-topology PHASE**, matching the
260603-acc conclusion ("LC PDF junction fix is a future PHASE, not a quick patch").

### Revised recommendation (supersedes the cable-adjacency plan above)
1. **Fix post-positioning first.** Find why posts 9,10,11,22 share `x,y=(305,302)` (post-assembler /
   `attachMarkerAnchors` / multi-sheet calibration) and give every post a true per-sheet `x,y`. Make all
   cable/tap logic read `anchorX/anchorY` consistently.
2. **Then** reconstruct topology from the drawn cable (`TrechoPrimario/Secundario`) + a tap/branch model
   that accepts posts drawn off the main cable (9,10) and posts drawn out of sequence (11). Only after
   that can cable-adjacency veto phantom inferred edges reliably.
3. The **Fix C** window-refine geometry guard remains valid and Siriu-safe (and gives the +20 m DWG win);
   re-land it once posts 9–11 are correctly positioned and 10→11 can get its `34,1` label.

`debug-lc-cable-hits.mjs` (untracked) reproduces the t-ordering + collapsed-coordinate evidence.
