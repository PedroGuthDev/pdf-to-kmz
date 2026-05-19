---
slug: coord-misplacement-research
created: 2026-05-19
status: in_progress
tags: [accuracy, coordinate-calculator, calibration, multi-sheet, cable-arc-placement]
inputs:
  - .planning/quick/20260519-coord-misplacement-research/RESEARCH.md
  - docs/PDF-LAYER-ANALYSIS.md
  - docs/CALIBRATION-APPROACHES.md
  - .planning/phases/02-coordinate-calculator/02-CONTEXT.md
  - parser/coordinate-calculator.js
  - parser/post-positioning.js
  - parser/cable-builder.js
  - parser/geo/utm-calibrator.js
  - parser/geo/label-lsq-calibrator.js
  - parser/geo/cable-boundary-calibrator.js
  - debug-run-calc.mjs
  - debug_results.txt
---

# Plan: Multi-approach fix for coordinate misplacement (N1–N7)

## Phase Goal

**As a** field-deploy engineer using pdf-to-kmz, **I want to** export KMZ
coordinates from multi-sheet INFOVIAS PDFs (João Born, Luiz Carolino, Siriu)
within 5 m of ground truth, **so that** I no longer have to manually correct
post positions after KMZ generation.

Scope of this plan: implement **N1, N2, N3, N4, N5, N6, N7** from
`RESEARCH.md §4`. N8 (multi-anchor UI) is explicitly **out of scope** — the user
has indicated it is a higher-cost UX change and should be deferred until the
input/calibration approaches are exhausted.

This plan is dual-track: **N2 → N1** is the committed path; **N3/N4/N5/N6/N7**
are gated follow-ups whose activation depends on the post-N1 verification
numbers.

---

## Execution order and decision gates

The approaches MUST be implemented in this order. After each implementation, run
the verification harness; act on the gate before moving on.

```
                ┌────────────┐
                │ N2 (cheap) │
                └──────┬─────┘
        ┌──────────────┴──────────────┐
        ▼                              ▼
  Valmor ≥ 5 m max?            Valmor < 5 m max?
  REVERT, abort plan           Proceed to N1
                                       │
                                ┌──────▼─────┐
                                │     N1     │
                                └──────┬─────┘
              ┌────────────────────────┴────────────────────────┐
              ▼                            ▼                    ▼
   Valmor regresses (≥ 5 m)    João Born meets pass     Joao Born partial
   REVERT N1, stop             criteria (§6 RESEARCH)   (max ≥ 5 m or
                               STOP — defer N3..N7      <5m count miss)
                               (mark deferred in PLAN)        │
                                                              ▼
                                                     ┌──────────────┐
                                                     │  N4 then N3  │
                                                     └──────┬───────┘
                                  ┌─────────────────────────┤
                                  ▼                          ▼
                          Pass criteria met            Still partial → N6 → N5
                          STOP, defer N5/N6/N7         (N7 only after detect step)
```

### Hard gates (apply unconditionally)

**G-1 (Valmor regression gate).** After every task that touches
`coordinate-calculator.js`, `post-positioning.js`, `utm-calibrator.js`,
`label-lsq-calibrator.js`, `cable-boundary-calibrator.js`, or any new module on
the projection path, run `node debug-run-calc.mjs`. If Valmor max error ≥ 5 m
OR `<5m` count drops below 11/11, **revert the change** (git restore the file
set), emit a warning, and do **not** advance to the next approach.

**G-2 (Pass criteria — RESEARCH.md §6).** After N1, run all three harness
modes:
- `node debug-run-calc.mjs` — Valmor: max < 5 m, 11/11 < 5 m (unchanged).
- `node debug-run-calc.mjs joao-born` — João Born 1-anchor: max < 10 m, 25+/33 < 5 m.
- `node debug-run-calc.mjs joao-born --two-anchor` — João Born 2-anchor: max < 5 m, 30+/33 < 5 m.

Stretch: João Born 1-anchor < 5 m max.

If **all three pass criteria are met after N1**, set the plan status of N3, N4,
N5, N6, N7 to `deferred-passed-without` and stop. They become follow-ups for
Luiz Carolino / Siriu validation, not blockers for João Born.

**G-3 (N7 feasibility gate).** N7 (grid coordinate label OCR) must begin with a
one-shot diagnostic. If **none** of the four reference PDFs contain explicit
easting/northing text labels along the UTM grid, mark N7 as `dropped-no-source`
and do not implement.

---

## Phase-02 invariants (non-negotiable)

These constraints MUST be respected by every approach below:

1. **Output contract unchanged** — `connections[]` shape stays
   `{ from, to, meters, bearing, gap, cross_page? }` (D-ACC-09 / D-REV-04). Per-post
   output `{ number, x, y, lat, lon, postType?, pageNum? }` (D-16) is unchanged.
2. **Browser + Node parity** — all new modules must run in both targets (no
   `fs`, no `Buffer`, no Node-only globals). The parser ships dual-target —
   see `getPdfjsLib` in `pdf-parser.js`.
3. **ESM-only, named exports** — no default exports, no CommonJS `require`.
4. **`warnings[]` accumulator pattern** — every new module mutates the passed
   `warnings` array; no new logging channels.
5. **Tap-pole exclusion** — `isOffRouteCablePost(post, postByNum, cablesByPage)`
   from `cable-builder.js` is the canonical detector. Tap poles ("N tem cabo",
   e.g. João Born post 4) MUST NOT be placed on the route cable by any
   approach. They retain their `post-positioning.js` snap.
6. **A1/A3/A4/A6 preservation** — do not delete any of these unless an
   approach explicitly supersedes it (N1 supersedes the *in-page* label chains
   `applyDistanceLabelGpsChain` and `applyPerPageLabelGpsChain`; N4 extends A3;
   N6 generalises A6).
7. **Cross-page seams** — reuse `augmentCrossPageDistances()` from
   `label-lsq-calibrator.js`; do not roll a parallel inference path.

---

# N2 — Prefer snapped pole `(x, y)` over label anchor for projection
**[N2 REVERTED — Valmor regressed: 10.23m max / 6 of 11 < 5m (was 4.19m / 11/11). G-1 gate: plan aborted.]**

**Goal.** Remove a known consistent source of bias in `pdfPos`, the projector's
input function. Today `pdfPos(post) → { x: post.anchorX ?? x, y: post.anchorY ?? y }`,
which means label position wins. After N2, pole position wins. This honours
D-ACC-10 ("pole symbols are the canonical position") which the current
implementation does NOT actually obey.

**Files touched.**
- `parser/coordinate-calculator.js` (modify `pdfPos`; touch `buildPageTransforms`
  call site at ~line 864 — `post1WithGps`)

**Contract change.** `pdfPos` returns pole `(x, y)` instead of `(anchorX, anchorY)`.

**Implementation steps.**

1. In `parser/coordinate-calculator.js`, swap the `pdfPos` body:
   ```
   function pdfPos(post) { return { x: post.x, y: post.y }; }
   ```
2. The `buildPageTransforms` call site (lines ~860–866) currently does
   `const post1Pdf = pdfPos(post1); …; const post1WithGps = { ...post1, x: post1Pdf.x, y: post1Pdf.y, lat: startLat, lon: startLon };`.
   After step 1 this already passes the pole position — but **verify** by
   reading: `post1.x` must be the Poste-symbol-snapped value, not the OCR
   label centroid. `post-positioning.js:assignPostPositionsFromPosteSymbols`
   sets `p.x = sym.x` after match, so this should hold; add an inline
   assertion via `console.assert(post1.x === pdfPos(post1).x)` only during
   the development cycle, then remove before commit.
3. **Audit `postPdfPos` shadows.** `parser/geo/utm-calibrator.js` (line ~343),
   `parser/geo/label-lsq-calibrator.js` (line ~7), and
   `parser/geo/cable-boundary-calibrator.js` (line ~17) define **local**
   `postPdfPos` helpers that all do `anchorX ?? x`. For consistency under N2,
   update each to `{ x: post.x, y: post.y }` so all transform math agrees on
   the pole position. (If you leave the geo helpers as label-first while
   `coordinate-calculator.pdfPos` is pole-first, residuals will diverge in
   ways that are hard to debug.)
4. `attachMarkerAnchors` continues to stamp `anchorX/anchorY` for posts that
   never went through Poste-symbol snapping (fallback). The anchor field
   becomes informational only after N2 — it survives in `posts[]` so KMZ
   downstream (Phase 03) and debug dumps still see the label centroid.
5. Audit `coordinate-calculator.js` for all uses of `post.anchorX`/`post.anchorY`
   outside `pdfPos`/`postPdfPos`/`attachMarkerAnchors`. Each occurrence is
   either (a) legitimate (`snapPostsToPolyline` uses anchors as the source
   to snap *from* — that is correct), or (b) a residual bug (should switch
   to pole). Document any remaining anchor reads in the task summary.

**Verification (after the swap, before any further work).**
```
node debug-run-calc.mjs                 # MUST stay 11/11 <5m, max <5m
node debug-run-calc.mjs joao-born       # Note baseline numbers (no expectation)
node debug-run-calc.mjs joao-born --two-anchor
```

**Regression gate.** G-1 applies. If Valmor max ≥ 5 m or `<5m` count drops:
`git restore parser/coordinate-calculator.js parser/geo/utm-calibrator.js parser/geo/label-lsq-calibrator.js parser/geo/cable-boundary-calibrator.js`,
emit `[N2] reverted — Valmor regressed from baseline`, and STOP. Do not start
N1.

**Estimated effort.** ~5% context (single function body, four file audits, two
harness runs).

---

# N1 — Place posts on the cable by arc-length × Distância_Poste

**Goal.** Use `Cabo Projetado` as the canonical route geometry. For each detail
page, walk the cable forward (and backward) from a known anchor post by
cumulative `Distância_Poste × scale_K` PDF-points, and snap each subsequent post
to the cable point at that arc length. This bypasses the per-segment-noise
problem identified in RESEARCH.md §2.2 — the cable polyline shape is correct
even when individual pole assignments zig-zag.

**Files touched.**
- New module: `parser/geo/cable-arc-placer.js`
- `parser/coordinate-calculator.js` (wire the new module; conditionally skip
  `applyDistanceLabelGpsChain` and `applyPerPageLabelGpsChain` when N1 placed
  posts on the page)

**Contract change.** Non-tap posts get `post.x, post.y` overwritten with the
cable arc-length point in PDF space before projection. Tap posts (per
`isOffRouteCablePost`) and posts on pages without `Cabo Projetado` are
unchanged.

**Public API of the new module.**
```
export function placePostsOnCableByArcLength({
  sortedPosts,         // Array of sorted posts, mutated in-place for non-tap on-route posts
  distMap,             // augmented distance map (use augDistMap from augmentCrossPageDistances)
  cablesByPage,        // Map<pageNum, Array<PathOp[]>> built via buildCablesByPage
  perPageScale,        // (pageNum: number) => number | null  — meters per PDF point per page
  postByNum,           // Map<number, post> from sorted
  warnings,            // mutable string[]
}) {
  return {
    placed: Map<postNumber, { x: number, y: number, pageNum: number, arcT: number }>,
    skipped: Array<{ number: number, reason: string }>,
    pagesPlaced: Set<number>,  // pages where ≥2 non-tap posts were placed (skip in-page label chain there)
  };
}
```

**Implementation steps.**

1. **Create `parser/geo/cable-arc-placer.js`.** Imports allowed:
   `nearestCableHitOnPage`, `pointAtArcLength`, `cableArcLengthPt`,
   `isOffRouteCablePost` from `../cable-builder.js`. No Node-only APIs.

2. **Group posts by page.** Build `Map<pageNum, postsOnPage[]>` from
   `sortedPosts`, sorted by `post.number` ascending.

3. **Per page, identify the route cable.**
   - Call `cablesByPage.get(pageNum)` → array of `PathOp[]`.
   - Pick the polyline whose `nearestPointOnPathOps` distance to the **first
     post on the page** is smallest AND ≤ 80 pt (reuse `CABLE_NEAR_POST_PT`
     from `cable-boundary-calibrator.js` as a constant — duplicate it locally
     so this module stays decoupled).
   - If none qualify, mark this page `skipped` with reason `no-route-cable`.

4. **Determine the page anchor post.** The anchor is the **lowest-numbered
   post on the page** that is NOT a tap. Compute its arc-length `s_0` on the
   selected cable via `nearestPointOnPathOps(post.x, post.y, routeOps).t`.

5. **Compute the page's scale (meters per PDF point).** Call
   `perPageScale(pageNum)`. If `null`, mark page `skipped` reason
   `no-scale`. The caller wires `perPageScale` from `pageTransforms` —
   `(pn) => pageTransforms.get(pn)?.x_scale_sf ?? scaleFactor ?? null`.

6. **Walk forward.** For each subsequent post on the page in increasing
   `number` order:
   - Skip the post entirely if `isOffRouteCablePost(post, postByNum, cablesByPage)`
     — record in `skipped` with reason `tap`. **Tap poles never get
     overwritten.**
   - Look up `m = distMap.get(\`${prev.number}->${curr.number}\`)`. If
     `m == null || m <= 0`, do NOT overwrite — record `skipped` with reason
     `no-label`. Keep the existing position so the downstream label chain can
     still help.
   - Compute `Δs = m / scale_K` in PDF points. Advance
     `s_curr = s_prev + Δs`.
   - Compute `point = pointAtArcLength(routeOps, s_curr)`. If `null`
     (overshot the cable), record `skipped` reason `arc-overflow`.
   - Validate: `nearestPointOnPathOps(post.x, post.y, routeOps).d` (current
     pole-to-cable distance) — if this exceeds 80 pt, the post snap may be on
     a different branch; keep its pole position and record reason
     `off-route-validation`.
   - Otherwise: overwrite `post.x = point.x; post.y = point.y;`. Push into
     `placed`. Update `s_prev` for the next iteration.

7. **Walk backward (optional but recommended).** If the lowest-numbered
   on-route post on the page is not number 1 of that page's sequence, also
   walk backwards from it using `distMap.get(\`${curr.number}->${prev.number}\`)`
   distances. (Brazilian distance labels are not directional — `augmentCrossPageDistances`
   already sets both `from->to` and `to->from`.) This matters when the page's
   anchor sits in the middle of its sequence (rare but possible after future
   plan changes).

8. **Cross-page seams.** Do NOT chain *across* pages in this module. Each page
   uses its own scale and its own cable, anchored on its own first on-route
   post. Cross-page consistency is delivered by the per-page projection
   (`projectPost`) which already uses `pageTransforms`. The
   `augmentCrossPageDistances` map is consumed only to fill in
   `prev->curr` when `prev` and `curr` are on the same page but the label
   was synthesised — N1 doesn't care if a same-page label was inferred.

9. **Return shape.** Include `pagesPlaced` — the set of pages where
   `placed.size ≥ 2` on that page. The caller uses this to skip the in-page
   label chain only where N1 was effective.

10. **Wire into `coordinate-calculator.js`.** After `buildPageTransforms`
    succeeds and `pageTransforms` is non-empty, BEFORE the post projection loop
    at line ~932:
    ```
    const placer = placePostsOnCableByArcLength({
      sortedPosts: sorted,
      distMap: augDistMap,
      cablesByPage,                 // already built via buildCablesByPage above
      perPageScale: pn => pageTransforms.get(pn)?.x_scale_sf ?? scaleFactor ?? null,
      postByNum: postMap,
      warnings,
    });
    ```
    (Note: `cablesByPage` is currently built *after* the LSQ/cable-boundary
    block at line ~946. Move that construction up — it's pure data and has no
    side effects.)

11. **Skip in-page chains where N1 placed posts.** In the
    `applyDistanceLabelGpsChain` / `applyPerPageLabelGpsChain` block
    (lines ~951–989), branch on `placer.pagesPlaced`:
    - If `placer.pagesPlaced.size >= viewportBoxes.length - 1` (N1 covered
      essentially every detail page), skip both chains entirely.
    - Else, fall back to `applyDistanceLabelGpsChain` /
      `applyPerPageLabelGpsChain` for the pages NOT in `pagesPlaced`. The
      simplest implementation: if `placer.pagesPlaced.size === 0` keep
      existing behaviour; otherwise skip the per-page chain and let the
      direct projection carry pages N1 covered.

12. **Tap-pole reaffirmation.** Tap poles' `post.x, post.y` are NOT modified
    by N1. Their projection uses the pole position (post-N2: pole, not
    anchor) so they project to the Poste symbol coordinate, which is the
    correct off-cable location. `resolveLabelChainGps` already handles them
    via `isOffRouteCablePost` — no change needed there.

13. **Emit a summary warning.**
    ```
    warnings.push(
      `[cable-arc-placer] placed ${placer.placed.size}/${sorted.length} posts on cable; ` +
      `skipped: ${placer.skipped.map(s => s.number + ':' + s.reason).join(', ')}.`
    );
    ```

**Browser-compatibility check.** All math is `Math.*` only. No `fs`, no
`Buffer`, no streams. Module uses only existing exports from `cable-builder.js`
which are already dual-target.

**Verification.** Run all three harness modes (G-2 thresholds):
```
node debug-run-calc.mjs                 # Valmor 11/11 <5m, max <5m (G-1 + unchanged)
node debug-run-calc.mjs joao-born       # max <10m, 25+/33 <5m (stretch: max <5m)
node debug-run-calc.mjs joao-born --two-anchor   # max <5m, 30+/33 <5m
```
Inspect warnings for `[cable-arc-placer] placed N/M posts` to confirm the
module actually fired on João Born pages 3–5.

**Regression gate.** G-1 — if Valmor regresses, revert
`parser/geo/cable-arc-placer.js` (delete) and the `coordinate-calculator.js`
wiring. If João Born regresses (max worse than 73.7 m baseline from
CALIBRATION-APPROACHES.md §Verification), revert and treat as failed-N1; do
NOT proceed to N3/N4 in that case — open a debugging task.

**Estimated effort.** ~25–30% context (new module ~120–180 lines; wiring
~25 lines; three harness runs; investigation of `cablesByPage` move).

---

# N3 — Joint pole-to-label assignment minimising label residual

**Activation gate.** Implement N3 ONLY if N1 verification met Valmor pass but
fell short on João Born `<5m` count (`<` 25/33 on 1-anchor or `<` 30/33 on
2-anchor) — see decision-gate diagram. Skip N3 entirely if N1 passes G-2.

**Goal.** Today `assignPostPositionsFromPosteSymbols` picks each post's Poste
symbol greedily by `labelDistance + 0.35·anchor→cable + 1.5·arcDelta`. With 144
candidate symbols vs. 14 actual posts on João Born page 3, local-best decisions
collide and produce zig-zag bearings. Replace the greedy match with a
global assignment that minimises `Σ_i |pole_dist(i,i+1) × scale − label_m(i,i+1)|`
subject to one-to-one pole assignment.

**Files touched.**
- `parser/post-positioning.js` (add new exported function
  `assignPolesGloballyByLabels(posts, posteRaw, cablePaths, distMap, perPageScale, warnings, opts)`;
  do NOT delete `assignPostPositionsFromPosteSymbols` — keep as a fallback)
- `parser/pdf-parser.js` (orchestration — call the new function when distance
  labels are available; fall back to existing when not)

**Contract change.** Same shape — mutates `posts[].x, .y` in place. Adds
opt-in path: if a `distMap` is provided, use global assignment; otherwise
behave like today.

**Implementation steps.**

1. **Decide algorithm.** Two options, both acceptable; prefer Hungarian when
   page candidate count ≤ ~200, else beam search.
   - **Hungarian** (O((N·M)²) for N posts × M candidates): build an
     `N × M` cost matrix where rows are posts on the page and columns are
     Poste-symbol candidates within `labelMax` of any post's anchor. Cost
     `C[i][j] = α · dLabel(i,j) + β · |arcΔ(i,j)|`, then solve. Distances
     between consecutive posts feed in via a secondary unary cost that
     penalises picks deviating from a pre-computed "consistent arc-length
     walk" anchored at post-1. Simpler version: include a pairwise term by
     iterating Hungarian within a beam, or post-process the Hungarian
     assignment with a 2-opt swap that minimises
     `Σ_i |arc(i,i+1) × scale − label_m(i,i+1)|`.
   - **Beam search along the cable** (preferred — matches existing arc-length
     mental model): order posts on the page by number; for each post, keep
     the top-K (K=4) candidate Poste symbols on the route polyline ordered by
     arc length. The state vector is the current pick at each post. At each
     step, advance to the next post and prune the beam by cumulative cost
     `cost(state) = Σ |arc(s_i, s_{i+1}) × scale − label_m(i,i+1)|`. Beam
     width 8 is sufficient. Total per-page cost: O(N · K · beam).

2. **Off-route tap exclusion.** Posts where `isOffRouteCablePost(post, postByNum, cablesByPage)`
   returns true are NOT in the global assignment — they get their existing
   greedy snap (per current logic in `repositionOffRoutePostsBetweenNeighbors`).
   For Hungarian, exclude them from rows. For beam, walk the route
   considering only non-tap posts; tap posts are placed in a post-processing
   pass.

3. **Multiple branches per page.** If a page has multiple `Cabo Projetado`
   paths (Luiz Carolino page 4 has 3, Siriu page 7 has 6), partition posts by
   which path their label anchor is nearest to. Solve assignment per
   partition.

4. **Fallback path.** If `distMap` is empty for the page (no labels) OR
   `pos te symbol count < posts on page × 1.5` (insufficient candidates), fall
   back to `assignPostPositionsFromPosteSymbols`. Emit a warning naming the
   page.

5. **Integration in `parser/pdf-parser.js`.** Replace the current call to
   `assignPostPositionsFromPosteSymbols` (search for it in `pdf-parser.js`)
   with a call to the new function. Distance labels are produced by
   `parser/distance-associator.js`; they need to be available at the position
   step — either pre-compute distances before positions, or run positions
   twice (once to get an initial set, then once with labels in hand for
   refinement). The cheaper option is to refactor the parser orchestration so
   distances come before final positions.

**N3 vs N1 interaction.** N3 improves the *input* (which Poste symbol belongs
to which post number). N1 improves the *transformation* from the input to the
projected position. They are complementary: N3 reduces the chance that N1's
"validate ≤ 80 pt" check rejects a placement, and reduces the per-segment
noise that N1 falls back on when a label is missing.

**Verification.** G-2 thresholds. Specifically check João Born page 3
per-segment bearings (the table in RESEARCH.md §2.2) — after N1+N3 the bearing
deltas should drop from ±25–40° to within ±5°.

**Regression gate.** G-1 + an additional check: if N3 mis-assigns any pole
(detectable by `[post-positioning]` warning count rising by >2× on Valmor),
roll back the new function call site (one-line revert in `pdf-parser.js`) and
keep the old `assignPostPositionsFromPosteSymbols` active.

**Estimated effort.** ~30% context (algorithm decision + new function ~150 lines
+ orchestration refactor in `pdf-parser.js` + tests).

---

# N4 — Per-page rotation parameter (3-DoF page transform)

**Activation gate.** Implement N4 ONLY if N1 met Valmor pass but João Born
`<5m` count fell short — see diagram. N4 is paired with N3, but can ship
independently. If chosen, ship N4 before N3 (rotation is a cheaper diagnostic
to evaluate before reworking the matcher).

**Goal.** RESEARCH.md §2.1 shows João Born page 3 end-to-end bearing is off by
2.5° even though the route is straight. A 2.5° rotation over 320 m is ~14 m of
end displacement. Today's transform has 3 DoF per page (origin_e, origin_n,
scale); extend to 4 DoF by adding a per-page `theta` rotation.

**Files touched.**
- `parser/geo/utm-calibrator.js` (extend `buildPageTransforms` to include
  `theta`; extend `projectPost` to rotate before adding origin; add
  `dominantLineOrientation(pathOps)` helper using PCA of grid line direction
  vectors)
- `parser/geo/label-lsq-calibrator.js` (extend
  `refinePageOriginsByLabelLsq` to optimise 3 params per non-anchor page —
  `origin_e, origin_n, theta` — instead of 2; update Jacobian)

**Contract change.** Per-page transform object grows from
`{ origin_e, origin_n, x_scale_sf, y_scale_sf, zone }` to
`{ origin_e, origin_n, x_scale_sf, y_scale_sf, theta, zone }`. `theta` is
radians, default `0`, applied as a 2D rotation of `(px, py)` before adding
origin (NOTE the flip-Y sign convention — north is `-y`).

**Implementation steps.**

1. **Add `dominantLineOrientation`.** Helper in `utm-calibrator.js`:
   compute per-segment direction vectors of all UTM line ops (M→L) and run
   PCA on the (signed) angle distribution modulo π (lines have no
   orientation). Return the dominant angle in radians. Tolerance: only emit
   non-zero `theta` when the dominant orientation is ≥ 1° AND grid line count
   ≥ 10.

2. **Relax `classifyGridLinesFromOps` tolerance.** Today TOLERANCE = 2 pt
   filters out lines that are not axis-aligned. For a tilted grid the lines
   may be axis-aligned in their LOCAL frame but not in the page frame. After
   `dominantLineOrientation` is known, rotate ops by `-theta` before applying
   the H/V classifier. This keeps the existing `computeScaleFactor` math
   working in a rotated frame.

3. **Stamp `theta` in `buildPageTransforms`.** For each viewport page,
   compute its `theta` from `utmGridPathsPerPage.get(pageNum)`. If none,
   inherit from the anchor page (post-1's page) so cross-page deltas remain
   consistent.

4. **Update `projectPost`.**
   ```
   export function projectPost(px, py, t) {
     const { origin_e, origin_n, x_scale_sf, y_scale_sf, theta = 0, zone } = t;
     const cos = Math.cos(theta), sin = Math.sin(theta);
     // Rotate (px, py) in page frame: north = -y, so apply (cos, -sin; sin, cos)
     // and then scale + offset.
     const rx =  cos * px + sin * py;
     const ry = -sin * px + cos * py;
     const e = origin_e + rx * x_scale_sf;
     const n = origin_n - ry * y_scale_sf;
     return utmToLatLon(e, n, zone);
   }
   ```
   (Validate the sign of the rotation by checking that a known UTM grid
   point projects to its expected GPS — see `02-VERIFICATION.md` UTM
   constants. If the sign is wrong on Valmor, flip `theta → -theta` and
   re-test before moving on.)

5. **Extend LSQ.** In `refinePageOriginsByLabelLsq`, add `theta` as a free
   variable per non-anchor page. The Jacobian gains two extra entries per
   page (∂eI/∂θ_prev and ∂nI/∂θ_prev, similarly for `curr`). The chord-length
   residual stays the same; only the projection step changes.

6. **Initial `theta` per page.** Use `dominantLineOrientation` as the seed
   for LSQ. If grid orientation can't be computed (< 10 grid line ops on
   that page), seed with `theta = 0` and let LSQ optimise from scratch.

7. **Update all consumers that read transform objects.** Search the codebase:
   - `projectPost` — handled in step 4.
   - `lockPageOriginAtGps` — must preserve `theta` (today it spreads `...t`,
     which already does — verify).
   - `cable-boundary-calibrator.js:adjustPageOriginsByCableContinuity` — uses
     `lockPageOriginAtGps`, OK by spread.
   - `label-lsq-calibrator.js:labelDistanceRmse` — needs to apply `theta` in
     the chord computation. Today it does
     `eI = tp.origin_e + pp.x * tp.x_scale_sf`; update to rotate first.

**Verification.** Run G-2. Specifically check João Born page 3 end-to-end
bearing (RESEARCH.md §2.1) — should drop from 70.4° toward the reference 72.7°.

**Regression gate.** G-1 + Valmor `theta` must end < 0.5° absolute after LSQ
(Valmor doesn't need rotation — if LSQ converges with `|theta| > 0.5°`, the
math is wrong, revert).

**Estimated effort.** ~25% context (transform extension + LSQ update + all
consumer audits + verification).

---

# N5 — Full per-page affine from UTM grid intersections (deferred)

**Activation gate.** Defer unless N1+N3+N4 still miss G-2. The thumbnail-offset
math is shaky, especially for Siriu (6 sheets); N5 replaces it with a per-page
6-DoF affine fit from grid intersections — a structural improvement.

**Goal.** Each UTM grid line is at a known easting OR northing (multiples of
50 m). Intersections give known control points in UTM-relative space. With ≥ 4
intersections on a page, solve a full 6-DoF affine (translation + rotation +
per-axis scale + shear) from PDF→UTM directly, without thumbnail extrapolation.

**Files touched.**
- New module: `parser/geo/grid-affine-calibrator.js`
- `parser/geo/utm-calibrator.js:buildPageTransforms` (call the new module
  per page; use its output instead of the thumbnail-offset origin when
  residual is lower)

**Contract change.** Per-page transform object gains optional
`x_scale_sf_y, y_scale_sf_x, shear` (or replace the existing isotropic scale
with a 2×2 matrix `M = [a b; c d]`). If present, projection becomes
`(e, n) = origin + M · (px, py_negated)`. Keep `theta` as a separate field for
N4 compatibility — N5 absorbs `theta` into `M`, but consumers built for N4
should still work.

**Implementation steps.**

1. **Detect grid intersections.** From `utmGridPathsPerPage.get(pageNum)`,
   classify H/V lines (existing helper) and compute pairwise intersections.
   With H_count × V_count candidates, deduplicate within 2 pt.

2. **Number grid lines by spacing.** Use the existing `medianGridSpacing` to
   determine that consecutive lines are 50 m apart. Assign each line an index
   `0, 50, 100, …` along its axis. Absolute easting/northing values are NOT
   known from the grid alone — but they don't need to be for a relative fit:
   we get an affine UTM-relative.

3. **Bind absolute origin.** Post 1's GPS provides the absolute offset. Use
   the affine to map post 1's PDF position to UTM-relative, then add the
   offset `e1 - relative_e1, n1 - relative_n1` so all other intersections
   land at their correct absolute easting/northing.

4. **Solve.** Linear least squares on
   `[e, n]^T = origin + M · [px, -py]^T`. With 4+ control points, fully
   determined; with fewer, fall back to thumbnail-offset.

5. **Compute residual.** Sum-of-squared-distance from each control point's
   computed UTM to its grid-derived UTM. If `residual_n5 < residual_thumbnail`
   AND `residual_n5 < 2 m` per intersection, accept N5's transform; else keep
   the thumbnail-offset transform for that page.

**Verification.** G-2. Specifically check Siriu (when added to harness) —
RESEARCH.md identifies Siriu as the case where N5 helps most.

**Regression gate.** G-1. Also: per-page residual must be lower than
thumbnail-offset baseline; if not, the affine acceptance check should fall
through and N5 won't activate for that page.

**Estimated effort.** ~30% context.

---

# N6 — Multi-page cable similarity (replaces thumbnail offset for page > 1)

**Activation gate.** Defer unless cross-page seam errors dominate after N1.
N6 generalises A6 (`adjustPageOriginsByCableContinuity`) from
"lock new page origin to cable point" to "fit a 2D similarity (translation +
rotation + uniform scale) using last 20 m of page N cable to first 20 m of
page N+1 cable."

**Files touched.**
- `parser/geo/cable-boundary-calibrator.js` (replace
  `adjustPageOriginsByCableContinuity` body OR add a sibling
  `fitCrossPageSimilarity` that the existing function calls in similarity
  mode)

**Contract change.** Same return value (number of pages adjusted) — internal
math becomes similarity fit.

**Implementation steps.**

1. **Sample cable tails.** For each cross-page transition `N → N+1`:
   - Find the cable polyline on page N nearest to the last on-route post of
     page N (`selectRouteCableOps`).
   - Sample 20 m of cable arc back from the post-N exit point — use
     `pointAtArcLength` to walk backward. Output: 4–6 PDF-points along the
     tail.
   - Repeat on page N+1 for the cable head (forward from the first on-route
     post).
   - **Match length.** Match the shorter of the two tails (do not extrapolate
     past either cable's end). If both are < 10 m, skip — same gating
     threshold as current A6.

2. **Project sampled points to UTM.** Apply each page's current transform to
   convert sampled PDF points to (e, n). Page N tail → known UTM points P_tail;
   page N+1 head → known UTM points P_head computed from page N+1's *current*
   transform.

3. **Fit similarity.** Compute the 2D similarity transform
   `(e', n') = R · (e, n) + t` that minimises
   `|P_head_transformed − P_tail|²` (closed-form via Umeyama 1991 / Kabsch
   with scale — simple SVD on the 2×2 covariance matrix; for 2D this is
   trivial).

4. **Apply to page N+1's origin.** Update `transforms[N+1].origin_e/n` to
   compose the inherited similarity. Update `theta` (when N4 is present) by
   adding the rotation component. Do NOT change `x_scale_sf` / `y_scale_sf`
   unless the similarity scale deviates from 1.0 by < 2 % (else the math is
   over-fitting).

5. **RMSE gating.** Same gating as today's A6 — re-compute
   `labelDistanceRmse` before and after; rollback the page's transform if
   RMSE worsens by > 0.25 m.

**Verification.** G-2, plus inspect João Born post 15 (the seam) — the
cliff in RESEARCH.md §1 should disappear or shrink.

**Regression gate.** G-1 + the RMSE check in step 5.

**Estimated effort.** ~20% context.

---

# N7 — OCR easting/northing labels on the UTM grid (gated by source feasibility)

**Activation gate.** N7's first step is a one-shot feasibility check. If no
PDF contains the labels, N7 is `dropped-no-source` and no further work occurs.

**Goal.** Find absolute UTM coordinate labels in the PDFs (e.g. `740,500 E` or
`6,941,000 N`). If present, they are absolute control points and replace the
post-1-only anchor approach.

**Files touched.**
- New diagnostic script: `analyze-utm-labels.mjs` (sibling of
  `analyze-pdf-layers.mjs`, runs through all 4 PDFs)
- New module: `parser/geo/utm-label-extractor.js` (if feasibility check passes)
- `parser/geo/utm-calibrator.js` (replace the post-1 anchor block in
  `buildPageTransforms` when labels are detected on the page)

**Implementation steps.**

1. **Feasibility diagnostic.** Create `analyze-utm-labels.mjs` that:
   - Iterates each PDF in repo root.
   - For each page, gets `getTextContent()`.
   - Searches text items for regex matches:
     `\b\d{6,7}\s*[mM]?\s*[EeNn]\b` (e.g. "740500 E", "6,941,000 N") OR
     `\b\d{3,4}[\s,]\d{3}\b` (e.g. "740,500", "6,941,000").
   - For each match, output the page, text, transform/position, and bounding box.
   - Save to `docs/utm-label-detection.md`.

2. **Decision point.** If across all 4 PDFs there are **zero** matches that
   look like absolute easting/northing values, mark N7 status
   `dropped-no-source` in this plan and stop.

3. **If matches found:** continue with `parser/geo/utm-label-extractor.js`:
   - `extractGridCoordinateLabels(pageNum, pageHeight, textContent) → Array<{ value: number, axis: 'E'|'N', x: number, y: number }>`
   - Match a label to the nearest grid line — H line for `N` (constant
     northing), V line for `E` (constant easting).
   - With ≥ 2 of each axis on a page, you have 4 absolute control points →
     solve the affine directly (similar to N5 step 4, but with absolute UTM
     values, no post-1 anchor needed).

4. **Wire into `buildPageTransforms`.** Per page: if the label extractor
   returns ≥ 2 of each axis, use those control points to compute the page's
   transform absolutely. Else fall back to today's thumbnail-offset / N5
   transform.

**Verification.** Per-PDF, residual at the labelled control points must be
< 0.5 m. Then G-2 across the harness.

**Regression gate.** G-1. If N7 mis-reads a non-coordinate text as a UTM
value (e.g. a phone number, sheet number, dimension), the residual at
control points will be huge — gate on per-page residual < 5 m before
applying.

**Estimated effort.** Feasibility check: ~5 % context. Implementation (if
feasibility passes): ~25 % context. **Total worst case ~30 %; best case 5 %.**

---

## Consolidated verification table

`debug-run-calc.mjs` produces three numbers we care about: `max_error_m`,
`<5m` count out of total, and `nulls`. The table below captures the
expected/required state after each approach passes its gate.

| After approach | Valmor (max / <5m) | João Born 1-anchor (max / <5m) | João Born 2-anchor (max / <5m) | Notes |
|----------------|-----------------|------------------------------|------------------------------|-------|
| baseline (5/18) | <5 m / 11/11    | 36 m / 2/33                  | 35 m / 13/33                 | Today's debug_results.txt |
| **N2**          | <5 m / 11/11    | ~36 m / 2-5/33 (info)        | ~35 m / 13-15/33 (info)      | No gate fail allowed |
| **N1**          | <5 m / 11/11    | **<10 m / 25+/33**           | **<5 m / 30+/33**            | G-2 pass criteria |
| **N1 stretch**  | <5 m / 11/11    | **<5 m / 30+/33**            | **<5 m / 32+/33**            | If hit, stop |
| **N1+N4**       | <5 m / 11/11    | <8 m / 28+/33                | <5 m / 32+/33                | Cumulative improvement |
| **N1+N4+N3**    | <5 m / 11/11    | <5 m / 30+/33                | <5 m / 33/33                 | João Born fully closed |
| **N1+N6**       | <5 m / 11/11    | <8 m / 27+/33                | <5 m / 31+/33                | Cross-page seam improvement |
| **N1+N5**       | <5 m / 11/11    | <6 m / 28+/33                | <5 m / 31+/33                | Useful for Siriu; modest for João Born |
| **N1+N7**       | depends on label presence — see G-3 | | | If labels exist → step-function improvement |

Numbers in the cumulative rows are estimates derived from RESEARCH.md §2 and
the per-segment noise analysis. The absolute requirement at every row is
G-1: Valmor `11/11 <5m, max <5m`. Any row that fails Valmor is reverted.

---

## Goal-backward check vs RESEARCH.md §6 pass criteria

The original pass criteria are reproduced verbatim below with the
approach(es) that deliver each one.

| Pass criterion | Delivered by |
|----------------|--------------|
| **Valmor: max < 5 m, 11/11 < 5 m (unchanged from baseline)** | G-1 gate on every approach. N2 is the first risk point (anchor→pole change). N1 is the second risk point (mutating `post.x, .y`). Both have explicit revert paths. |
| **João Born (1 anchor): max < 10 m, 25+/33 < 5 m** | **N1.** Walking the cable by `Distância_Poste × scale_K` is bounded by label rounding + grid-scale precision (< 2 m on page 3, < 5 m end-to-end per RESEARCH.md §4 — N1 paragraph "Why it should work"). |
| **João Born (2 anchor): max < 5 m, 30+/33 < 5 m** | **N1** (primary) + the existing `applyPinnedRouteLabelChain` (already in `coordinate-calculator.js`). N1 places posts; pinned chain refines via the 2nd anchor. |
| **Stretch: João Born 1-anchor < 5 m max** | **N1 + N4** (rotation tightens end-to-end bearing) OR **N1 + N3** (joint matching removes per-segment noise on page 3). If N1 alone hits this, N3/N4 are deferred. |
| **(Implicit) No regression at sheet boundaries** | **N1** removes the in-page chains as the per-page error source; **N6** improves cross-page seams when N1 + label-LSQ aren't enough. |
| **(Future) Luiz Carolino, Siriu added to harness** | RESEARCH.md §6 final paragraph — they are out-of-scope for THIS plan's pass criteria. **N5 and N6** are the approaches designed for Siriu's 6-sheet stress test; N7 (if labels exist) is also a Siriu win. |

**Uncovered criteria.** None of RESEARCH.md §6's explicit pass criteria fall
through. The four reference PDFs' broader validation (Luiz Carolino + Siriu)
is explicitly deferred by RESEARCH.md §6 itself.

**Note on N8 (out of scope).** Per task brief, the multi-anchor UI is not
planned here. If after N1+N3+N4+N5+N6+(N7) Siriu still fails G-2 thresholds,
N8 becomes the natural next plan — but that's a follow-up plan, not a
deferred item in this one.

---

## Per-approach effort summary

| Approach | Effort (% context) | Risk | Activation |
|----------|-------------------|------|------------|
| N2 | ~5 % | low (1-line + audits) | always |
| N1 | ~25–30 % | medium (new module + wiring) | always |
| N3 | ~30 % | medium-high (refactor pdf-parser orchestration) | only if N1 misses G-2 |
| N4 | ~25 % | medium (3-DoF transform; touches all consumers) | only if N1 misses G-2 |
| N5 | ~30 % | high (new module; replaces buildPageTransforms branch) | only if N1+N3+N4 miss G-2 |
| N6 | ~20 % | medium (similarity fit; RMSE-gated) | only if cross-page seams dominate post-N1 |
| N7 feasibility | ~5 % | low (read-only diagnostic) | always run as first step of N7 path |
| N7 implementation | ~25 % | medium | only if feasibility passes |

The committed work (N2 + N1) is ~30 % of one context window — well within
the 50 % budget per `gsd-quick` guidance. Each gated follow-up is its own
agent session.

---

*End of PLAN. After implementation start, update the `status` frontmatter to
`in-progress`, and per-approach add a small status line (e.g. `[N2 done — Valmor 4.19m / 11/11]`)
under each section header.*
