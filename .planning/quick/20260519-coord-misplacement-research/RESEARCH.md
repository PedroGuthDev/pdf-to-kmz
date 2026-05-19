---
slug: coord-misplacement-research
created: 2026-05-19
status: researched
tags: [accuracy, coordinate-calculator, calibration, multi-sheet]
---

# Research: New approaches to fix coordinate misplacement

**Inputs reviewed:** `docs/PDF-LAYER-ANALYSIS.md`, `docs/CALIBRATION-APPROACHES.md`,
`.planning/debug/joao-born-coords-off.md`, `debug_results.txt`,
`parser/coordinate-calculator.js`, `parser/geo/{utm-calibrator,label-lsq-calibrator,cable-boundary-calibrator}.js`,
`parser/post-positioning.js`, `parser/pdf-parser.js`, `parser/cable-builder.js`,
`coordenadas postes rua {valmor,joao born}.txt`, and the four reference PDFs.

---

## 1. Where the system stands today

| Sample | 1 anchor | 2 anchors | Target |
|--------|----------|-----------|--------|
| Valmor (1 detail sheet, 11 posts) | < 5 m, 11/11 ✓ | — | <5 m |
| **João Born** (3 detail sheets, 34 posts) | **36 m max**, 2/33 < 5 m | **35 m max**, 13/33 < 5 m | <5 m |
| Luiz Carolino (3 sheets, 31 posts) | not validated | — | <5 m |
| Siriu (6 sheets, 85 posts) | not validated | — | <5 m |

João Born is the regression case. Currently implemented:
boundary-locked page origins (A1), label LSQ on page origins (A3),
two-anchor pinned chain (A4), cable continuity (A6, RMSE-gated).
Rejected: thumbnail rescale (A2), per-page UTM only (A5).

---

## 2. New diagnosis from this round

I dropped down to per-segment numbers on João Born page 3 and the picture is **not** the same as on Valmor.

### 2.1 The route bearing is correct in aggregate

| Source | Total length (1→14) | End-to-end bearing |
|--------|--------------------|--------------------|
| Reference | 322.5 m | 72.7° |
| Pole positions (snapped Poste symbols) | 309.5 m | 75.2° |
| Anchor positions (Numero_Poste centroids) | 326.6 m | 70.4° |

Page-3 aggregate scale is within ~5 % and aggregate bearing within ~2.5°. So
**the page transform isn't fundamentally broken** — it's drifting a few degrees.

### 2.2 But individual segments are extremely noisy

Per-segment bearing of consecutive pole positions on page 3 (real route is ~73° everywhere):

```
seg   ref°   pole°   delta
1→2   75.8   113.1   +37
2→3   74.6    99.3   +25
3→4   72.5    28.2   −44
4→5   20.9    38.6   +18   (post 4 = "N tem cabo", off-route)
5→6   73.1    93.3   +20
6→7   73.3    45.6   −28
7→8   76.5    74.5    −2  ✓
8→9   73.7    39.2   −35
9→10  70.8   110.4   +40
10→11 79.9    74.7    −5
11→12 72.8    82.9   +10
12→13 73.5    72.1    −1  ✓
13→14 72.9   103.2   +30
```

Same story per-segment scale: implied scale ranges 0.20 – 0.82 m/pt (median ≈ 0.29,
UTM-grid says 0.36). **Adjacent posts on a straight street are zig-zagging on the PDF.**

That's not what a straight cable looks like. Cabo Projetado is one continuous polyline drawn
along the actual route — *it* runs at ~73°. The poles must therefore be **mis-assigned**:
many of the snapped Poste symbols are not the correct pole for that number.

### 2.3 Best-fit affine residual is ~5 m

Solving a full 6-DoF affine on page 3 (12 anchor positions → UTM coords from reference) gives:

| Source | scale_x | scale_y | rotation | shear | RMS residual | max residual |
|--------|---------|---------|----------|-------|--------------|--------------|
| Anchors | 0.360 | 0.110 | 11.0° | −26.6° | 5.13 m | 11.5 m |
| Poles | 0.373 | 0.049 | 15.0° | −49.6° | 5.33 m | 15.2 m |

Two implications:

1. **No linear page transform can match reference within < 5 m** with these post positions.
   The positions themselves contain non-linear noise that exceeds the target. Any approach
   that re-fits the page transform (label LSQ, more anchors, rotation correction) has a
   floor at ~5 m for this PDF until the **inputs** are cleaned up.
2. The "best fit" looks like a sheared anisotropic transform — pathological for an axis-aligned
   page. That's evidence of bad point assignments, not a real anisotropy.

### 2.4 Other observed details

- **João Born page 3 has 144 Poste symbols** vs. only 14 actual route posts. The pole-symbol
  matcher (`assignPostPositionsFromPosteSymbols`) has a 10:1 ratio of false candidates
  to real ones — easy to mis-assign.
- `pdfPos()` in `coordinate-calculator.js` uses `anchorX/anchorY` (the **label** centroid)
  for projection, **not** the snapped pole `(x, y)`. So even when pole-snap is correct,
  it isn't actually used by the projector. (Comment line in `coordinate-calculator.js:39–46`.)
- Post 4 (`N tem cabo`) is a tap pole — explicitly off the main cable in the source data.
  It must not be in any "place on cable" pipeline.

### 2.5 What this means

The error on João Born is **not** a calibration-math bug, it's an **input-quality** bug:
the canonical PDF position the projector receives is unreliable. Approaches 1, 3, 4, 6 all
work on the assumption that `pdfPos(post)` is the true PDF location of the pole — fine on
Valmor (where labels track poles), broken on João Born (where labels and the 144-candidate
Poste layer fight each other).

Therefore the most leverage is in **fixing the position source**, not adding another
calibration layer.

---

## 3. Approaches already implemented or rejected

For completeness, recapping `docs/CALIBRATION-APPROACHES.md`:

| # | Idea | Status |
|---|------|--------|
| A1 | Boundary-locked page origins (label chain across pages) | Implemented |
| A2 | Rescale thumbnail offset by detail scale | Rejected (regressed Valmor) |
| A3 | Global least-squares fit of page origins to labels | Implemented |
| A4 | Two anchors (post 1 + last post) pin route ends | Implemented |
| A5 | Per-page UTM only (no thumbnail offset) | Rejected (209 m on João Born) |
| A6 | Cable continuity at boundaries | Implemented, RMSE-gated, often skipped |
| A7 | Non-isotropic per-page X/Y scale | Deferred |

These all tune the **page transform**. They cannot push residuals below the ~5 m noise floor in §2.3.

---

## 4. New approach proposals

Ordered by expected impact on João Born, grouped by what they fix.

### Group I — Fix the position source (highest leverage)

#### N1 — Place posts on the cable by arc-length × Distância_Poste

**Idea.** Treat `Cabo Projetado` as the canonical route. For each detail page:

1. Snap post 1 (or the page's anchor post) to the nearest cable point → arc-length `s_1` PDF-pt.
2. For each next labeled segment `i → i+1` with distance `d_i` meters, advance along the
   cable by `Δs = d_i / scale_K` PDF-pt. The cable point at arc-length `s_i + Δs` is
   post `i+1`'s canonical PDF position.
3. Run the page transform on that cable point.

**Why it should work on João Born.** Cable polyline shape is correct
(it's the engineering drawing of the actual route). Labels are precise to ~0.1 m. The
combined error is bounded by `(label rounding) + (scale × per-page UTM error)`, which is
< 2 m at 50 m grid precision.

**Cost.** Medium. Needs: arc-length walker on `Cabo Projetado` (we already have
`pointAtArcLength` and `nearestPointOnPathOps` in `cable-builder.js`); cross-page anchoring;
off-route handling (tap poles like João Born post 4 stay at their original snap).

**Caveats.**
- Posts at branch junctions need disambiguation (which branch to follow).
- Missing labels (cross-page seam, sparse pages) → fall back to PDF distance for that hop.
- Doesn't fix Valmor *better* — Valmor already works — but should not regress it.

#### N2 — Use snapped pole `(x, y)` not label `(anchorX, anchorY)` for projection

**Idea.** Flip the precedence in `coordinate-calculator.js:pdfPos`. Today it returns
`anchorX ?? x` (label-first). After D-ACC-10 the pole snap is supposed to be canonical,
but the projector silently ignores it.

**Why.** On any PDF where the Numero_Poste label is offset for readability, the label is at
the wrong physical position. The snapped pole — when assignment is correct — is at the actual
pole. Valmor labels happen to track poles; João Born labels don't (anchors are scattered up
to 70 PDF pt off the snapped pole, well over 20 m).

**Cost.** Trivial (1-line swap + adjust `buildPageTransforms` to take pole, not anchor, for
post 1).

**Caveat.** **On its own this won't be enough for João Born** — §2.2 shows pole assignments
are also unreliable. But it removes one consistent source of bias and is a prerequisite for
N3 / N4. Worth shipping standalone; verify Valmor stays < 5 m.

#### N3 — Constrain pole-to-label assignment by labeled distances (joint matching)

**Idea.** Today's `assignPostPositionsFromPosteSymbols` greedily matches each Numero_Poste
label to the nearest Poste symbol along the cable. With 144 candidates per page and ~14
posts, locally-best decisions collide. Replace with a **global matching that minimizes
total `|pole_dist(i,i+1) × scale − label_m(i,i+1)|`** subject to one-to-one pole assignment.

**Why.** Forces consecutive pole picks to agree with Distância_Poste labels. The current
zig-zag (§2.2) disappears because no global assignment can produce a 28°→113°→28° bearing
sequence when labels say the route is straight.

**Cost.** Medium-high. Hungarian assignment or a beam search along the cable
(O(N × candidates) per page). Existing helpers: `cableArcLengthPt`,
`nearestCableHitOnPage`, `bearingForDistanceLabelChain`.

**Caveat.** Off-route taps must be excluded from the constraint (already detected by
`isOffRouteCablePost`). Tap poles inherit position from their cable-arc anchor.

### Group II — Add a missing degree of freedom to the page transform

#### N4 — Per-page rotation parameter (3-DoF page transform)

**Idea.** Extend the page transform from `{origin_e, origin_n, scale}` (3 DoF) to
`{origin_e, origin_n, scale, theta}` (4 DoF). Fit `theta` from the UTM grid lines'
dominant orientation, OR from the cable's bearing relative to the post 1→last-post
reference vector. Apply rotation in `projectPost`.

**Why.** §2.1 shows page 3's end-to-end bearing is off by 2.5° even though the route is
straight in reality. A 2.5° rotation over 320 m moves the far end by ~14 m. If
`classifyGridLinesFromOps` only sees H/V lines within 2 pt tolerance, a tilted grid is
silently discarded and the residual rotation is unobserved.

**Cost.** Low-medium. Add `dominantLineOrientation()` (PCA on grid line directions). Extend
`projectPost`. Extend label-LSQ to optimize 3 params per page instead of 2.

**Caveat.** This alone cannot reach < 5 m on João Born because of the per-segment noise
(§2.3). Pair with N1 or N3.

#### N5 — Solve full per-page affine from UTM grid intersections

**Idea.** Each UTM grid line is at a known easting *or* northing (multiples of 50 m).
Intersections give known control points in UTM space. With 4+ intersections on a page,
solve a full 6-DoF affine (translation + rotation + per-axis scale + shear) from
PDF→UTM directly — no extrapolation from post 1, no viewport-thumbnail math.

**Why.** Uses the same grid the drawing was built on, with several control points per page
instead of relying on the user-supplied post 1 GPS to position the entire page. Especially
strong for Siriu (6 detail sheets, hard to chain).

**Cost.** Medium. Needs: detection of H/V (and possibly diagonal) grid lines including
tilted cases; intersection finder; numbering of grid lines (which easting is line N?).

**Caveat.** Lines aren't labeled with their actual easting/northing in any sample we've
inspected. So this approach gives a **relative** affine — the absolute origin still requires
one GPS anchor (post 1). What it adds is correct rotation and scale per page without depending
on the thumbnail offset.

### Group III — Use information we're not using yet

#### N6 — Multi-page cable similarity (replace thumbnail offset for page > 1)

**Idea.** For cross-page transitions, fit a 2D similarity (translation + rotation + uniform
scale) that maps the last 20 m of cable on page N to the first 20 m of cable on page N+1.
Cable endpoints are precisely-drawn engineering geometry; the thumbnail-offset math is a
proxy with multiple known failure modes.

**Why.** A6 (cable continuity) is implemented but RMSE-gated and disabled when label RMSE
worsens. Generalize it to a similarity fit rather than just origin-locking the next page —
gives correct page-to-page rotation, not just translation.

**Cost.** Medium. Extends `cable-boundary-calibrator.js`.

**Caveat.** Only works when there *is* cable continuity. Valmor has it on every page;
Siriu's overview merges 9 paths so the boundary detection needs care.

#### N7 — OCR the easting/northing labels on the UTM grid (if present)

**Idea.** INFOVIAS plates *sometimes* have explicit text along the grid like
`740,500 E` or `6,941,000 N`. If detected, those are absolute UTM control points.

**Cost.** High (per-PDF dependent). Low priority — verify presence first by inspecting one
plate per client. If not present on these four, drop the approach.

#### N8 — Multi-anchor UI (3+ user-provided GPS)

**Idea.** Today the UI accepts 1 or 2 anchors. Accept 1 per detail page. Each anchor
fully pins its page; no inter-page chaining required.

**Cost.** Low (UI + plumbing). High UX cost — users would need to source GPS for 3–6 posts
on Siriu-scale projects.

**Caveat.** Probably worth supporting as a **manual override** for problem PDFs, not as the
default path.

---

## 5. Recommendation

The dominant error on João Born is at the **input layer** (which PDF coordinate represents
post N), not the **calibration layer**. Spend the next iteration on Group I, not Group II.

### Phase 1 (cheap baseline) — ship N2 first

Change `pdfPos` (and `buildPageTransforms` post-1 input) to prefer pole over anchor.
Verify Valmor stays < 5 m on `node debug-run-calc.mjs`. This unblocks N1/N3 from "label
position contaminates the metric" and is essentially free.

### Phase 2 (the actual fix) — ship N1

Place posts on the cable by `Distância_Poste` arc-length. Walk Cabo Projetado from the
anchor post forward and backward; clamp to existing snap for tap poles
(`isOffRouteCablePost`). Cross-page seams use `augmentCrossPageDistances` (already exists).

Expected outcome on João Born: error drops to within label-rounding + grid-scale precision
(< 2 m on page 3, < 5 m end-to-end).

### Phase 3 (if Phase 2 still misses target) — N4 + N3

Add per-page rotation. Rebuild pole-label assignment as a globally-consistent match. These
are the heavier interventions; only spend if Phase 2 doesn't close.

### Defer

N5 (full grid affine), N6 (cable similarity), N7 (grid OCR), N8 (multi-anchor UI). Useful
follow-ups for Siriu but unnecessary if Phase 2 alone fixes João Born and Luiz Carolino.

---

## 6. Verification harness

Run after each step:

```bash
node debug-run-calc.mjs                  # Valmor regression
node debug-run-calc.mjs joao-born        # primary target
node debug-run-calc.mjs joao-born --two-anchor
```

Pass criteria:
- Valmor: max < 5 m, 11/11 < 5 m (unchanged from baseline)
- João Born (1 anchor): max < 10 m, 25+/33 < 5 m
- João Born (2 anchor): max < 5 m, 30+/33 < 5 m

Stretch (for N1 specifically): João Born 1-anchor < 5 m max.

Add the other two PDFs to the harness once João Born clears: Luiz Carolino is structurally
similar (3 sheets), Siriu is the stress test (6 sheets, 85 posts).

---

## 7. Files most relevant to the new approaches

| Approach | Primary files |
|----------|---------------|
| N1 — cable arc-length placement | `coordinate-calculator.js`, `cable-builder.js` (already has `pointAtArcLength`, `nearestPointOnPathOps`) |
| N2 — pole-position projection | `coordinate-calculator.js:pdfPos`, `buildPageTransforms` call site |
| N3 — joint pole-label matching | `post-positioning.js:assignPostPositionsFromPosteSymbols` |
| N4 — per-page rotation | `geo/utm-calibrator.js:buildPageTransforms`/`projectPost`, `geo/label-lsq-calibrator.js` |
| N5 — grid-affine | `geo/utm-calibrator.js:classifyGridLinesFromOps` |
| N6 — cable similarity | `geo/cable-boundary-calibrator.js` |

---

*Output of `/gsd-quick --research` — no code changes made. Pick the path forward
(suggested: N2 then N1) and we can plan it as a quick task.*
