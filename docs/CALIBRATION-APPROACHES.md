# Multi-Sheet Page Calibration — Approaches

**Created:** 2026-05-18  
**Status:** Approaches 1, 3, and 4 implemented; approach 2 evaluated and rejected (see below)  
**Related:** `docs/PDF-LAYER-ANALYSIS.md`, `.planning/phases/02-coordinate-calculator/02-CONTEXT.md`

---

## Problem

INFOVIAS PDFs split long routes across **detail sheets** (pages 3…N). Each sheet has its own PDF coordinate system. GPS accuracy requires linking those systems without asking the user for **one GPS coordinate per sheet**.

**Observed failure (João Born):** Posts on the first detail sheet stay within ~3–9 m; at the first sheet boundary (post 15) error jumps to ~30 m and stays there — classic **sheet-to-sheet offset** error, not within-sheet scale error.

**Root cause in the original model:**

1. **Thumbnail offset** used page-2 overview `m/pt` for translation between viewport boxes, while points on each sheet used detail-page `m/pt`.
2. **Boundary adjustment** used GPS bearing toward the *already-wrong* projected position at the first post on the new sheet, instead of the **route exit bearing** on the previous sheet.

---

## Design goals

| Goal | Target |
|------|--------|
| User input | Post 1 GPS only (optional last-post GPS for global pin) |
| No per-sheet manual GPS | Yes |
| Target accuracy | &lt; 5 m vs ground truth on stress-test PDFs |
| Use PDF ground truth | `Distância_Poste`, UTM grid, `Padrão` viewports, `Cabo Projetado` |

---

## Implemented approaches (2026-05-18)

### Approach 1 — Boundary-locked page origins

**Idea:** At each **cross-page** segment, walk GPS from the last post on the previous sheet using the **labeled distance** and **PDF exit bearing** (direction of the last in-page segment). Set the **new sheet’s UTM origin** so the first post on that sheet projects exactly to that GPS.

**Implementation:** `adjustPageOriginsAtBoundaries()` in `utm-calibrator.js`

- Same page: `pdfBearing(prev, curr)` + `destinationPoint`.
- Cross page: `pdfBearing(prevPrev, prev)` when both are on the previous page; then re-anchor `transforms` for `curr.pageNum`.
- Runs when `viewportBoxes.length >= 3` (multi-sheet), after `buildPageTransforms`, before projecting posts.

### Approach 2 — Thumbnail offset scale (evaluated, not changed)

**Idea:** Use detail-page `scale_K` instead of overview `scaleFactor` for thumbnail box deltas.

**Result (2026-05-18):** **Rejected.** Deltas `(box_K - rect_pk)` are in **page-2 overview** PDF points; multiplying by detail UTM `scale_K` (or `ratio × scale_K`) regressed Valmor (max error 36 m+). Blending `(scale_pk + scale_K)/2` also regressed (222 m).

**Kept:** Overview `scaleFactor` for thumbnail offsets per D-REV-12. Accuracy gains come from **approach 1** (boundary lock), not rescaling thumbnails.

---

### Approach 3 — Global label least-squares (implemented 2026-05-18)

**Idea:** Adjust free per-page UTM origins so labeled segment lengths match UTM distance between projected posts. Post #1 page origin stays fixed to the user anchor.

**Steps:**

1. **Augment** missing cross-page labels (e.g. 14→15) using the average of the previous and next labeled spans on adjacent sheets.
2. **Gauss–Newton** on `(origin_e, origin_n)` per non-anchor page to minimize `(UTM_dist − label_m)²` over all consecutive labeled pairs.

**Implementation:** `parser/geo/label-lsq-calibrator.js` — `refinePageOriginsByLabelCalibration()`; called from `calculateCoordinates()` after `buildPageTransforms()`. Skips approach 1 boundary lock when LSQ improves; skips per-page label GPS chain when LSQ runs.

**Files:** `label-lsq-calibrator.js`, `coordinate-calculator.js`

---

### Approach 4 — Two global anchors (implemented 2026-05-18)

**Idea:** User supplies GPS for **post #1** and **last post** only. Interior posts are placed by walking the full route with `Distância_Poste` labels, pinning both endpoints exactly.

**Implementation:**

- `opts.lastPostGps` in `calculateCoordinates()`
- Primary: `applyPinnedRouteLabelChain()` with **augmented** distance map (same cross-page inference as approach 3)
- Cross-page segments use **in-page exit bearing** (not bearing toward wrong projection)
- Fallback: UTM similarity transform if the chain cannot run

**CLI test:** `node debug-run-calc.mjs joao-born --two-anchor`

---

### Approach 5 — Per-page UTM only (evaluated, rejected 2026-05-18)

**Idea:** Drop thumbnail origin offset; each detail page keeps its own UTM scale; origins seeded only via boundary lock + label LSQ.

**Result:** **Rejected** on João Born (`--utm-only` prototype). Max error **209–214 m** vs **73.7 m** with thumbnail + LSQ. Boundary-first seeding before LSQ did not recover accuracy — thumbnail offset is a necessary initial guess for global LSQ on multi-sheet PDFs.

---

## Deferred / future approaches

### Approach 6 — Cable continuity at boundaries

Match end of `Cabo Projetado` on sheet N to start on sheet N+1; solve 2D similarity between page coordinate systems.

### Approach 7 — Non-isotropic per-page transform

Separate `scale_x` / `scale_y` from horizontal vs vertical UTM grid spacing when exports squash thumbnails.

### Not recommended

| Addition | Reason |
|----------|--------|
| More OCG layers as calibration sources | Noise |
| OCR / post count on overview page 2 | Overview ≠ route posts |
| Per-sheet user GPS | Works but poor UX |
| Pure sequential chaining from post 1 only | Error accumulates |

---

## Verification

| PDF | Command | Reference file |
|-----|---------|----------------|
| Valmor (regression) | `node debug-run-calc.mjs` | `coordenadas postes rua valmor.txt` (via script defaults) |
| João Born (multi-sheet) | `node debug-run-calc.mjs --pdf joao-born` | `coordenadas postes rua joao born.txt` |

**Pass criteria:** Max error &lt; 5 m; no cliff at sheet boundaries (João Born post 15).

### Results (2026-05-18)

| Sample | Positions source | Max error | &lt; 5 m | Notes |
|--------|------------------|-----------|--------|--------|
| João Born (1 anchor) | `debug_results.txt` | **73.7 m** | **3/34** | Approach 3; post 15 ~20 m |
| João Born (2 anchors) | same + `--two-anchor` | **54.5 m** | **4/34** | Post 34 pinned 0 m; posts 27–33 still ~48–54 m on sheet 5 |
| Valmor | Node OCR (11 posts) | — | — | Use browser/Poste positions for regression; run `node debug-run-calc.mjs` |

Approach 3 adds inferred cross-page label **14→15** and fits pages 4–5 origins globally. Approach 4 (second anchor on post 34) cuts max error **73.7 → 54.5 m** and adds one more post under 5 m, but sheet 5 interior drift remains. Next levers: infer **25→26** if missing, approach 5–6, or better Poste positions on page 5.

---

## Related code

| File | Role |
|------|------|
| `parser/geo/utm-calibrator.js` | `buildPageTransforms`, `adjustPageOriginsAtBoundaries`, `projectPost` |
| `parser/geo/label-lsq-calibrator.js` | `refinePageOriginsByLabelCalibration` (approach 3) |
| `parser/coordinate-calculator.js` | Orchestration, label chains, 2nd anchor |
| `parser/pdf-parser.js` | Viewport pairing, UTM path collection |
| `debug-run-calc.mjs` | CLI accuracy check |

---

*Re-run tests after calibration changes; update this doc if additional approaches are implemented.*
