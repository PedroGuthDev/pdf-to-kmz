# Phase 2 Iteration: Posts 9-11 Under 10m — Context

**Gathered:** 2026-05-25
**Status:** Ready for planning
**Scope:** Sub-plan within Phase 2 (Coordinate Calculator) — iteration 02-07

<domain>
## Phase Boundary

Improve GPS accuracy for posts 9-11 on João Born page 3 from the current 15-19m errors to under 10m, without regressing Valmor (G-1: 11/11 < 5m) or João Born posts 15-34 (session-7 gains). Two sequential steps: (1) diagnose and fix the silent failure in `refineAnchorPageByDownstreamChord` so the page-3 global calibration actually applies its scale/theta correction, then (2) add split-region calibration within page 3 to break through the Procrustes floor for post 9.

</domain>

<decisions>
## Implementation Decisions

### Target and constraints

- **D-P911-01: Hard requirement — all three posts (9, 10, 11) must be under 10m.** Not best-effort. Rationale: field crew navigation — technicians locate poles in the field and 10m is the maximum acceptable locating error for practical use.
- **D-P911-02: No additional GPS anchors.** The algorithm must work from the PDF alone with only the user-provided GPS for post 1. No second field anchor point.
- **D-P911-03: Non-regression invariants (non-negotiable):**
  - Valmor G-1: 11/11 < 5m, max < 5m after every change. Immediate revert on regression.
  - João Born posts 15-34: session-7 gains (22/34 < 5m) must be preserved.
  - Posts 10-11: any approach that improves post 9 must not worsen posts 10 or 11.

### Step 1 — Diagnose and fix `refineAnchorPageByDownstreamChord` silent failure

- **D-P911-04: Primary first step.** The function produces zero log output in the current debug run — it is failing a silent guard (no `[anchor-refit]` entry in `debug_results.txt`). This means the page-3 scale/theta correction (-4%, -3.7°) is never being applied, explaining the 7m gap between current performance and the Procrustes optimum for posts 10-11.
- **D-P911-05: Diagnostic approach.** Add `warnings.push` calls to every silent `return false` path in `refineAnchorPageByDownstreamChord` (lines ~434–513 in `label-lsq-calibrator.js`). Run the harness and identify which guard triggers. Candidate silent guards (currently emit no warning): `anchorPagePosts.length < 4`, `chordLen < labelKtoK1`, `!Number.isFinite(newScale)`, `det < 1`, `tAnchor.affine`, `firstDownstream.lat == null`, `labelKtoK1 == null`.
- **D-P911-06: Expected outcome after fix.** Posts 10 and 11 drop from 15-16m to ~8m (their Procrustes floors: 8.01m and 8.88m). Post 9 drops from 18.97m to ~12m (its Procrustes floor: 12.34m — still above 10m, addressed by Step 2).

### Step 2 — Split-region calibration for page 3

- **D-P911-07: Approach is split-region calibration** (not label-chain backward, not 3-point refit). Apply separate similarity transforms to two sub-regions of the anchor page (page 3): one for the distortion-free segment (posts 1–K) and one for the distorted mid-page segment (posts K+1–14).
- **D-P911-08: Activation condition — forward-chain vs projection disagreement at midpoint.** Walk forward from post 1 GPS using Distância_Poste labels and corrected page-3 bearing to estimate the midpoint post's GPS. Also project the midpoint post using the global page-3 transform. If the two estimates disagree by > threshold at the midpoint, local distortion is confirmed and split-region fires. Threshold: tune empirically so it fires on João Born page 3 and does NOT fire on Valmor. Do not fire if post count on anchor page < 6 (not enough posts to split meaningfully).
- **D-P911-09: Split boundary detection — residual-driven.** After the global refit (Step 1), compute per-post GPS error using the forward-chain GPS as proxy reference (walk forward from post 1 using label distances). Find the sequence position where this proxy error spikes above 2× the median per-post error for the anchor page. That is the break post K.
- **D-P911-10: Region anchoring.** For each region, use 2 anchor points:
  - Region 1 (posts 1–K): post 1 GPS (truth) + break-post K GPS estimated via forward-chain from post 1.
  - Region 2 (posts K+1–14): break-post K GPS (from region 1 fit) + post 14 GPS (from downstream chain).
  - Apply a 2-point similarity fit per region. Pin the region-boundary post exactly on both sides (continuity constraint).
- **D-P911-11: Safety guard.** After applying split-region transforms, compute label-distance RMSE for anchor-page pairs. If the split-region RMSE is worse than the global refit RMSE, revert to the global refit. Log the outcome with `[split-region]` prefix regardless of outcome.
- **D-P911-12: Guard against Valmor.** Valmor is a 2-sheet route (multiSheetRoute requires ≥ 3 detail sheets). The split-region code must be gated behind the same multiSheetRoute check as refineAnchorPageByDownstreamChord. Valmor will never reach the activation check.

### Claude's Discretion

- The exact threshold for the forward-chain vs projection disagreement at midpoint (D-P911-08) is a hyperparameter. Tune empirically so the condition fires for João Born page 3 (posts 9-11 ~15-19m errors) and does not fire for well-calibrated pages. Starting value: 8m disagreement.
- The break-post K detection algorithm (D-P911-09) should prefer a break point where there are at least 3 posts in each region. If the spike is detected with fewer than 3 posts in a region, shift K by ±1 to meet the minimum.
- Reuse `labelDistanceRmse` (already exported from `label-lsq-calibrator.js`) for the RMSE guard in D-P911-11.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Current debug state
- `.planning/debug/joao-born-coords-off.md` — Full debug session history. Session 7 results (baseline: 22/34 < 5m, max 18.97m on post 9), Procrustes floor analysis per post (post 9: 12.34m, post 10: 8.01m, post 11: 8.88m), and why split-region was previously deferred. **Read the entire file.**
- `debug_results.txt` — Current parser dump reflecting session-7 changes (working tree, uncommitted). Contains the critical `[post-positioning]` warnings showing all page-3 posts using label anchor positions.

### Key source files
- `parser/geo/label-lsq-calibrator.js` — Site of the fix. `refineAnchorPageByDownstreamChord` (line 426): the function to diagnose and fix (D-P911-04/D-P911-05). `refinePageOriginsByLabelLsq`: contains session-7 soft theta prior (lambda=10 for degenerate pages, lambda=0.01 otherwise) — do not touch. `labelDistanceRmse`: reuse for split-region RMSE guard (D-P911-11).
- `parser/coordinate-calculator.js` — Call site for `refineAnchorPageByDownstreamChord` (line 1349-1375). Split-region logic will be added here (or in a new helper in `label-lsq-calibrator.js`) after the existing refit call.
- `parser/post-positioning.js` — Session-7 changes: `arcRepairedPosts` Set threaded through the pipeline. Do not regress these changes.
- `parser/geo/utm-calibrator.js` — `buildPageTransforms`, `projectPost`. Transform structure reference (fields: `origin_e`, `origin_n`, `x_scale_sf`, `y_scale_sf`, `theta`, `affine`, `zone`).

### Tests and harness
- `debug-run-calc.mjs` — End-to-end harness. Run after every change. G-1: Valmor max <5m, 11/11. G-2 target (new): João Born max <10m, all posts 9/10/11 < 10m.
- `parser/__tests__/coordinate-calculator.test.mjs` — 20/20 passing. Must remain green.
- `INFOVIAS_PJC INTERNET_Palhoça_RUA VALMOR FRANCISCO_v1.pdf` — Valmor reference (G-1). The split-region code must not affect Valmor's output.

### Prior phase context
- `.planning/phases/02-coordinate-calculator/02-CONTEXT.md` — Phase 2 base decisions (N1, Viterbi, LSQ, soft prior). Read for full decision history.
- `.planning/phases/02-coordinate-calculator/.continue-here.md` — Blocking anti-patterns from prior sessions.

</canonical_refs>

<code_context>
## Existing Code Insights

### The silent-failure function
- `refineAnchorPageByDownstreamChord` (label-lsq-calibrator.js:426): Has 8+ silent `return false` paths before the two guarded paths that emit warnings. The function should log on ALL exits, not just the scale/theta guard and RMSE guard. Look specifically at whether `firstDownstream.lat == null` or `labelKtoK1 == null || labelKtoK1 <= 0` is the culprit — these are most likely given the cross-page seam behavior.

### Transform structure (utm-calibrator.js)
```javascript
{
  origin_e: number,    // UTM easting of PDF origin
  origin_n: number,    // UTM northing of PDF origin
  x_scale_sf: number, // scale factor (PDF pt → UTM m)
  y_scale_sf: number, // same as x_scale_sf (isotropic)
  theta: number,       // rotation (radians, CCW)
  affine: boolean,     // true = grid-affine transform (skip refit)
  zone: string,        // UTM zone
}
```
The 2-point similarity fit formula already in `refineAnchorPageByDownstreamChord` computes `u = (dx*dE - dy*dN)/det`, `v = (dy*dE + dx*dN)/det`, `newScale = hypot(u,v)`, `newTheta = atan2(v,u)`. Reuse this formula for per-region fits in split-region.

### Reusable functions
- `labelDistanceRmse(transforms, sortedPosts, distMap)` — exported from `label-lsq-calibrator.js`. Takes the transforms map (mutable), sorted posts array, and distMap. Returns RMSE in meters over all labeled consecutive pairs. Use for the split-region RMSE guard.
- `augmentCrossPageDistances(sorted, distMap)` — fills in missing cross-page labels. Already called before `refineAnchorPageByDownstreamChord`.
- `projectPost(x, y, transform)` — from `utm-calibrator.js`. Projects a PDF (x,y) to `{ lat, lon }`. Use to reproject region-1 posts after applying region-1 transform.

### Established patterns
- All new calibration steps emit `[tag]` prefixed warnings for traceability.
- Guard: `if (multiSheetRoute && ...)` — split-region must be behind the same gate.
- Revert pattern: snapshot transform → apply trial → measure → revert if worse.

### Integration points
- Split-region code belongs AFTER the existing `refineAnchorPageByDownstreamChord` call block (lines 1349-1375 in coordinate-calculator.js), since it builds on the global refit result.
- After applying per-region transforms, reproject anchor-page posts (same pattern as lines 1362-1374: `for (const post of sorted) { if (post.pageNum !== anchorPage) continue; ... }`).

</code_context>

<specifics>
## Specific Notes

- **Procrustes floor is the hard floor for global transforms.** Post 9 = 12.34m, post 10 = 8.01m, post 11 = 8.88m. Any purely global page-3 similarity transform cannot beat these. Only local (split-region or per-post) correction can push below.
- **All page-3 posts use label anchors.** Debug shows `[post-positioning] post N: using label anchor position` for all 14 page-3 posts. The Viterbi-assigned Poste symbol positions are being overridden by label anchor positions (anchorX/anchorY) for the entire anchor page. The split-region calibration works with these label anchor (x,y) positions — no symbol reassignment needed.
- **Session-7 changes are in working tree (uncommitted).** `parser/geo/label-lsq-calibrator.js` and `parser/post-positioning.js` have uncommitted changes. Any new changes must be layered on top of these. Run `git diff` to confirm state before starting.
- **Forward-chain bearing.** When walking forward from post 1 using label distances to estimate mid-page post GPS, derive the bearing from the corrected page-3 transform: apply `theta` to the PDF direction vector between consecutive posts. This gives the UTM-oriented bearing that the corrected page-3 transform expects.

</specifics>

<deferred>
## Deferred Ideas

- **Label-chain backward from post 14** — user evaluated but chose split-region instead. The backward-chain approach (walk from post 14 using labels 13→14, 12→13, ...) is simpler but offers less accuracy since the bearing accumulates the same global-transform error. Defer unless split-region cannot be made to work.
- **3-point refit** — extending `refineAnchorPageByDownstreamChord` to use a mid-page anchor (post 1 + post 7 + post 14) was considered but rejected in favor of split-region. Defer.
- **Per-post GPS anchors** — user-provided GPS for multiple posts (not just post 1). Would guarantee <1m but requires UI complexity. Deferred to Phase 4 or a future iteration per D-DONE deferred from original 02-CONTEXT.md.

</deferred>

---

*Phase: 2-Coordinate Calculator (iteration: posts 9-11 under 10m)*
*Context gathered: 2026-05-25*
