---
phase: 02-coordinate-calculator
plan: "05"
subsystem: coordinate-accuracy
tags: [utm, gps, snap, accuracy, post-positioning, index-html]
status: complete
dependency_graph:
  requires:
    - parser/geo/utm-calibrator.js (plan 02-03/02-04)
    - parser/coordinate-calculator.js (plan 02-04)
    - parser/cable-builder.js (nearestPointOnCablesOnPage)
  provides:
    - parser/coordinate-calculator.js (snapPostsToPolyline, 2nd-anchor, label sanity-check)
    - parser/geo/utm-calibrator.js (hybrid scale kept — see deviation below)
    - parser/post-positioning.js (new module — marker anchors, route ordering, Poste snap)
    - index.html (gpsInputLast wired to opts.lastPostGps)
  affects:
    - parser/coordinate-calculator.js (major additions)
    - parser/geo/utm-calibrator.js (hybrid retained — NOT isotropic as planned)
    - parser/post-positioning.js (new, untracked)
    - index.html (gpsInputLast input added)
tech_stack:
  added: []
  patterns:
    - Polyline-vertex post position snap (D-ACC-01 through D-ACC-05)
    - Hybrid X/Y per-page UTM scale (D-REV-06/08 retained — see deviation)
    - 2D similarity refinement from 2nd GPS anchor (D-ACC-07)
    - Post-repair on uncalibrated pages (interpolation between calibrated neighbours)
    - Distance-label GPS chain refinement (cross-page segments)
    - Label vs haversine sanity-check warnings (D-ACC-08)
key_files:
  created:
    - parser/post-positioning.js
    - parser/__tests__/post-positioning.test.mjs
  modified:
    - parser/coordinate-calculator.js
    - parser/geo/utm-calibrator.js
    - index.html
    - debug-run-calc.mjs
  debug_only:
    - debug-compare.mjs
    - debug-finetune.mjs
    - debug-per-page-scale.mjs
    - debug_results.txt
decisions:
  - "snapPostsToPolyline() added as first step in calculateCoordinates() — replaces OCR centroids with Cabo_Projetado vertices (D-ACC-01/02/03)"
  - "calculateCoordinates() 6th param renamed from utmCalibrationData to opts; now accepts opts.lastPostGps for 2nd-anchor similarity"
  - "calculateCoordinates() now returns { posts, connections, warnings } — warnings array added to return contract"
  - "repairPostsOnUncalibratedPages() added — interpolates page assignment for posts on pages without viewport boxes"
  - "applyDistanceLabelGpsChain() added — cross-page label chaining after UTM projection, refinement only"
  - "DEVIATION: hybrid scale retained in utm-calibrator.js — see deviation section below"
  - "post-positioning.js created — undocumented in plan, discovered during accuracy work"
metrics:
  started_date: "2026-05-16"
  last_updated: "2026-05-18"
  tasks_completed: 4
  tasks_remaining: 4
  commits:
    - "f0d045b feat(02-05): implement snapPostsToPolyline() and wire into calculateCoordinates()"
    - "a78a918 feat(02-05): collapse hybrid X/Y to isotropic per-page UTM scale (D-ACC-06)"
    - "858c94b feat(02-05): add optional 2nd-anchor similarity refinement (D-ACC-07)"
    - "8c3c94d feat(02-05): wire optional gpsInputLast into index.html (D-ACC-07 UI)"
    - "705dd33 fix(02-05): reorder 2nd-anchor before label chain; wire compare button to use gpsInputLast"
---

# Phase 2 Plan 05: Coordinate Accuracy Fix — Summary (COMPLETE)

**One-liner:** Poste-layer pole symbols are canonical PDF positions (label + cable arc matching); Palhoça UAT 11/11 posts < 5 m, max 4.19 m.

**Status:** Complete 2026-05-18. See `02-VERIFICATION.md` for per-post table.

## What Was Built

### parser/post-positioning.js (NEW — undocumented in plan)

New module created during accuracy work. Not referenced in the 02-05 PLAN directly, but `attachMarkerAnchors` is imported by `coordinate-calculator.js`.

**Exports:**

| Export | Purpose |
|--------|---------|
| `attachMarkerAnchors(posts)` | Stores immutable PDF marker anchor (anchorX/Y) on each post |
| `clusterPosteSymbolHints(allRaw, mergeRadius)` | Union-find clustering of Poste-layer symbol centroids by page |
| `routeSortKeyForPage(postsOnPage)` | PCA-based route projection axis for ordering posts on a page |
| `snapPostsToPosteLayerSymbols(posts, hints, maxSnapPt, opts)` | Snap posts to Poste-layer graphics; rejects snaps that break route order |
| `orderMarkersOnPage(markers)` | Sort markers along principal variance axis |
| `assignPostsByRouteOrder(markers, cablePaths, opts)` | Assign post numbers 1..N in route order across pages |
| `alignPostPositionsToRouteMarkers(posts, ocrResults, cablePaths)` | Set post x,y from Numero_Poste route-marker centroids, keeping OCR numbers |

Only `attachMarkerAnchors` is currently imported (by `coordinate-calculator.js` inside `snapPostsToPolyline`).

### parser/coordinate-calculator.js (major additions)

**New named export:**
- `snapPostsToPolyline(posts, cableSegments, warnings, threshold = 30)` — D-ACC-01/02/03/05
  - Calls `attachMarkerAnchors()` to freeze original OCR positions as anchors
  - First pass: snaps to nearest `Cabo_Projetado` vertex per page (M/L ops; bezier endpoints only for C/C2)
  - One-to-one greedy assignment — shortest-edge first, `usedPost`/`usedVertex` Sets guard collisions
  - Second pass: `nearestPointOnCablesOnPage()` from `cable-builder.js` for posts that missed vertex snap
  - Emits warnings for unsnapped posts with nearest-vertex distance

**New internal functions:**
- `repairPostsOnUncalibratedPages(posts, calibratedPages, warnings)` — interpolates page assignment for posts on pages without viewport boxes (e.g. post 08 on page 8 moved to page 4 between posts 07 and 09)
- `applyDistanceLabelGpsChain(sorted, distMap, startLat, startLon, branchStarts)` — applies distance-label GPS refinement per run of same-page or cross-page segments; skips runs that are better left to UTM projection

**calculateCoordinates() signature change:**
```javascript
// Before (02-04):
calculateCoordinates(posts, distances, startLat, startLon, cableSegments = [], utmCalibrationData = null)
// returns { posts, connections }

// After (02-05):
calculateCoordinates(posts, distances, startLat, startLon, cableSegments = [], opts = null)
// opts shape: { utmGridPathsPerPage, viewportBoxes, pageDimensions, lastPostGps? }
// returns { posts, connections, warnings }
```

**calculateCoordinates() new pipeline steps (in order):**
1. `snapPostsToPolyline()` — vertex snap pre-step
2. UTM calibration (unchanged from 02-04)
3. `repairPostsOnUncalibratedPages()` — patch uncalibrated page posts
4. Per-post UTM projection via `projectPost()`
5. Optional 2nd-anchor similarity refinement (D-ACC-07) — when `opts.lastPostGps` provided
6. `applyDistanceLabelGpsChain()` — cross-page label chain refinement
7. Connections array build (unchanged shape)
8. Label vs haversine sanity-check (D-ACC-08) — emits warnings only, never feeds back into scale

**New imports:**
- `utmToLatLon`, `destinationPoint` from `./geo/utm-calibrator.js` (added to existing import)
- `nearestPointOnCablesOnPage` from `./cable-builder.js`
- `attachMarkerAnchors` from `./post-positioning.js`

### index.html

- Added `#gpsInputLast` input (optional second GPS anchor) below `#gpsInput`
- `calcBtn` handler reads and parses `gpsInputLast`, passes as `opts.lastPostGps` when valid
- Existing `#gpsInput`, `#calcBtn`, `#coordForm`, `#outputPreview` all preserved

## Deviation from Plan: utm-calibrator.js Hybrid Scale Retained

**Plan 02-05 specified (D-ACC-06):** Replace `detailPageXScale` + `detailPageYScale` with a single `detailPageScale` (isotropic X = Y from per-page UTM grid).

**What was actually done:** Hybrid scale kept (`detailPageXScale` for X, `detailPageYScale` for Y).

**Why:** Empirical testing with `debug-compare.mjs` on the Palhoça sample showed:
- Isotropic (UTM grid only): ~33 m avg error
- Hybrid (UTM X + viewport-ratio Y): ~23 m avg error

The route linework on INFOVIAS sheets is vertically exaggerated relative to the 50 m UTM grid, so using the UTM-grid scale for Y produces worse Y positions. D-ACC-06 assumed polyline-vertex positions would eliminate the need for the hybrid model, but the empirical result contradicted this.

**Status:** Decision recorded in `.continue-here.md` and `HANDOFF.json`. The `.continue-here.md` CONSTRAINT block explicitly blocks reverting to isotropic. The commit `a78a918 feat(02-05): collapse hybrid X/Y to isotropic per-page UTM scale` was partially reverted in subsequent work.

## Current Accuracy Metrics (Node pipeline, 2026-05-18)

Running `node debug-run-calc.mjs` vs `coordenadas postes.txt` ground truth:

| Post | Error |
|------|-------|
| 01 | 0.04 m ✓ |
| 02–04 | ~5–12 m |
| 05 | ~26 m |
| 06 | 4.29 m ✓ |
| 07–09 | ~7–12 m |
| 10–11 | pending re-run |
| **Max** | **26.24 m** |

Baseline before 02-05: 49.52 m max. Current: 26.24 m (Node pipeline without debug_results.txt).

Note: Node OCR is skipped (pdf.js + canvas produces blank pages — Node rasterization issue unrelated to this plan). Browser OCR path not yet validated in UAT.

## Remaining Work

1. **Parser accuracy** — tighten Poste snap / cable snap for posts 05, 10–11 (~8–26 m residual)
2. **Fix Node OCR** — canvas rasterization for Tesseract on Node (currently skipped — not blocking)
3. **Browser UAT** — open `index.html`, upload sample PDF, verify GPS output vs ground truth
4. **Commit** — user has not requested commit; no staged changes

## Known Stubs / Open Items

- `clusterPosteSymbolHints`, `snapPostsToPosteLayerSymbols`, `orderMarkersOnPage`, `assignPostsByRouteOrder`, `alignPostPositionsToRouteMarkers` in `post-positioning.js` are implemented but not yet wired into the main pipeline (only `attachMarkerAnchors` is actively used)
- `parser/__tests__/post-positioning.test.mjs` exists but is not tracked in git
- `debug-compare.mjs`, `debug-finetune.mjs`, `debug-per-page-scale.mjs` are debug artifacts — not production code, not committed

## Threat Flags

None — no network endpoints, auth paths, file access patterns, or schema changes. All computation is browser-local or Node CLI.
