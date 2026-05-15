---
phase: 02-coordinate-calculator
plan: "03"
subsystem: coordinate-calculator
tags: [utm, geo, calibration, pdf-parser, layer-sources]
dependency_graph:
  requires: []
  provides:
    - parser/geo/utm-calibrator.js (UTM math module — 7 exports)
    - parser/layer-sources.js isUtmGridLayerName + isViewportRectLayerName
    - parser/pdf-parser.js utmGridPathsPerPage + viewportBoxes + pageDimensions fields
  affects:
    - parser/pdf-parser.js (return contract extended)
    - parser/layer-sources.js (2 new functions)
tech_stack:
  added: []
  patterns:
    - Snyder Transverse Mercator series (forward + inverse, no external dependency)
    - Median-based outlier rejection for UTM grid spacing
    - flipY-aware coordinate extraction from PathOps
key_files:
  created:
    - parser/geo/utm-calibrator.js
  modified:
    - parser/layer-sources.js
    - parser/pdf-parser.js
decisions:
  - "Implement TM formulas directly (no proj4js) — ~50 lines, sub-millimeter accuracy, no CDN dep"
  - "computeScaleFactor takes combined h+v spacings into one median pool for robustness"
  - "extractRectFromSubpath operates on raw PDF coords, converts to flipY at return (avoids double-flip)"
  - "pairLabelsToRects converts label.y to flipY before centroid distance to avoid coord-space mismatch"
metrics:
  duration: "5 minutes"
  completed_date: "2026-05-15"
  tasks_completed: 3
  tasks_total: 3
  files_created: 1
  files_modified: 2
---

# Phase 2 Plan 03: UTM Calibration Foundation Summary

**One-liner:** Snyder TM forward/inverse UTM math module + layer matchers + extended parsePdf() data pipeline for per-page coordinate calibration.

## What Was Built

### Task 1: parser/geo/utm-calibrator.js (new)

Browser-compatible ESM module with 7 named exports implementing the full UTM calibration pipeline:

| Export | Purpose | Verified |
|--------|---------|---------|
| `latLonToUtm(lat, lon)` | WGS-84 → UTM forward (Snyder TM series) | zone=22, easting=729751 for Palhoça |
| `utmToLatLon(e, n, zone)` | UTM → WGS-84 inverse (Snyder TM series) | Round-trip error < 1e-6 deg |
| `computeScaleFactor(pathArrays, warnings)` | 50/medianSpacing from UTM grid PathOps | ~0.352778 for 141.73pt spacing |
| `buildPageTransforms(post1, pageDims, viewportBoxes, sf, zone)` | Per-page UTM affine from viewport boxes | Returns Map with origin_e/n, x/y_scale_sf |
| `projectPost(px, py, pageTransform)` | Page-local flipY → GPS via UTM inverse | Origin post returns GPS within float precision |
| `haversineMeters(lat1,lon1,lat2,lon2)` | Great-circle distance | ~400m for 0.0036 deg lat delta |
| `gpsBearing(lat1,lon1,lat2,lon2)` | GPS vector bearing 0–360° | 0.000000° for due-north displacement |

Key implementation choices:
- WGS-84 constants (`a=6378137, f=1/298.257223563`) — identical semi-major axis to SIRGAS-2000 (< 1mm positional diff)
- `computeScaleFactor`: collects hLines+vLines from all PathOps, computes medians separately, pools into one final median — rejects outliers (D-REV-07)
- `buildPageTransforms`: missing viewport box guard returns empty Map + warning (T-02-03-01 mitigated)
- `gpsBearing`/`haversineMeters`: local variable names `y2/x2` and `a2` avoid shadowing WGS-84 constant `a`

### Task 2: parser/layer-sources.js (extended)

Two new exported functions appended to the end of the file, preserving all 5 existing functions:

- `isUtmGridLayerName(rawName)`: matches "UTM" OCG layer via `normalizeName(rawName) === 'utm'`
- `isViewportRectLayerName(rawName)`: matches "Padrão" via `normalizeName(rawName) === normalizeName('Padrão')` — confirmed by user inspection 2026-05-15

### Task 3: parser/pdf-parser.js (extended)

7 targeted changes, no existing logic altered:

1. **Import update**: Added `isViewportRectLayerName, isUtmGridLayerName` to the layer-sources.js import line
2. **New collectors**: `utmGridPathsPerPage`, `viewportBoxes`, `viewportLabels`, `pageDimensions` — declared alongside `allPosteRaw`
3. **Per-page dimensions**: `pageWidth = page.view[2]`; `pageDimensions.set(pageNum, {w, h})` immediately after `pageHeight`
4. **UTM path collection**: Per-page loop collects all paths from the "UTM" OCG layer, applies `flipYInOp`, stores in `utmGridPathsPerPage`
5. **Page-2 viewport data**: `if (pageNum === 2)` branch collects rectangles from "Padrão" layer (via `extractRectFromSubpath`) and 2-digit labels >= 3 from `getTextContent()`
6. **Post-loop pairing**: `pairLabelsToRects(viewportLabels, viewportBoxes, page2Height)` → `pairedViewportBoxes`
7. **cableSegments pageNum re-attachment**: `allCablePaths.forEach((path, idx) => { if (cableSegments[idx]) cableSegments[idx].pageNum = path.pageNum; })`

**Extended return contract:**
```javascript
{
  posts, distances, cableSegments, warnings, layerMap,  // unchanged
  utmGridPathsPerPage,   // Map<pageNum, PathOp[][]> — UTM layer, flipY applied
  viewportBoxes,         // Array<{pageNum, rect}> — page-2 boxes in flipY space
  pageDimensions,        // Map<pageNum, {w, h}>
}
```

## Round-Trip UTM Test Results

| Test | Expected | Actual | Pass |
|------|----------|--------|------|
| Palhoça zone | 22 | 22 | Yes |
| Easting | 700000–800000 | 729751.76 | Yes |
| Round-trip lat error | < 1e-6 deg | 7.7e-9 deg | Yes |
| Round-trip lon error | < 1e-6 deg | 4.7e-7 deg | Yes |
| Scale factor (141.73pt) | ~0.352778 | 0.352783 | Yes |
| Haversine (0.0036 deg lat) | 390–410 m | 400.30 m | Yes |
| Bearing due north | < 1° | 0.000000° | Yes |

## Deviations from Plan

None — plan executed exactly as written.

The plan described `computeScaleFactor` combining h+v spacings into one list and taking a median. Implementation matches: separate `medianGridSpacing` calls for hLines and vLines, then pool the two median values and take the final median. This correctly handles cases where only one direction has lines (pools size = 1, median = that value).

## Known Stubs

None — this plan produces math modules and data pipeline wiring. No UI rendering and no stub patterns introduced.

## Threat Flags

None — no new network endpoints, auth paths, or external APIs introduced. All code is browser-local math.

## Self-Check: PASSED

- parser/geo/utm-calibrator.js: FOUND (5594f59)
- parser/layer-sources.js updated: FOUND (f42023e)
- parser/pdf-parser.js updated: FOUND (7d62c8c)
- All 5 verification assertions: PASSED
- 7 exports in utm-calibrator.js: CONFIRMED (grep -c = 7)
- 2 new functions in layer-sources.js: CONFIRMED (grep -c = 2)
