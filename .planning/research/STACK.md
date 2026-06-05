# Technology Stack

**Project:** pdf-to-kmz v1.1 — Generalized DXF-Driven Accuracy
**Researched:** 2026-06-05
**Scope:** NEW capabilities only. The v1.0 stack (pdfjs-dist, Tesseract.js, dxf-parser@1.1.2,
rbush@4.0.1, idb@8.0.3, fake-indexeddb, jszip, @vercel/blob) is locked and not re-researched here.

---

## Capability A — Global PDF↔DXF Route-Graph Solver

### Problem Statement

The existing `graph-walker.js` (level-1 in the 3-level cascade in `coordinate-calculator-dwg.js`)
is a sequential greedy walker: it steps post-by-post in numeric order, using PDF bearing + printed
distance to predict the next DXF INSERT. It fails structurally at hubs and multi-branch junctions
because it has no global view of cost.

The new level-0 solver must align the **PDF route-graph** (numbered posts, printed inter-post
distances, branching topology from `walkConnections`) onto the **DXF cable-graph** (INSERT
points, LWPOLYLINE adjacency already in `adjacencyGraph`) by minimizing the total
distance-residual across all post-to-INSERT pairings. Printed distances arbitrate when PDF
topology is ambiguous.

### Recommended Approach: Custom Cost-Matrix + Hungarian Assignment

**Do NOT add a graph-isomorphism library.** The problem is NOT graph isomorphism (the graph
structures are not expected to be structurally identical; the DXF may have more nodes, different
edge counts at hubs, and split polylines). It is a **weighted bipartite assignment**: for each
PDF post, find the best INSERT such that the total spanning-distance residual is minimized
globally.

**Algorithm (implement in-house, ~200–300 lines):**

1. **Candidate enumeration.** For each PDF post `p_i`, the candidate DXF INSERTs are those
   within `GPS_ANCHOR_RADIUS_M` (≈ 30 m) of the PDF-predicted UTM position (using the existing
   `gpsByPostNumber` map from the PDF-only run). This keeps the cost matrix sparse.

2. **Cost function per (post, INSERT) pair.** Sum the absolute difference between each printed
   inter-post distance label and the Euclidean distance (in DXF UTM metres) between the two
   INSERT positions that would be assigned to those consecutive posts. Penalize pairings that
   break cable-graph adjacency (assign `adjacencyGraph` penalty weight, e.g. ×3).

3. **Assignment.** Solve the rectangular cost matrix using **munkres-js** (Hungarian algorithm,
   O(n³)). For route sizes seen in practice (Siriu: 85 posts; a "large" route is 200 posts),
   200×200 is solved in < 50 ms client-side. Above 500 posts, switch to a greedy nearest-
   neighbour initialisation with 2-opt local search (implement inline; no library needed).

4. **Validation gate.** Accept the global solution only if the mean per-edge residual is below
   `GLOBAL_SOLVER_RESIDUAL_THRESHOLD_M` (tunable, suggested 8 m). If it fails, fall through to
   the existing graph-walker (level-1).

### Library: munkres-js

| Attribute | Value |
|-----------|-------|
| npm package | `munkres-js` |
| Version | `2.0.3` (last published 2017; no breaking changes since; API is stable) |
| Bundle size | < 3 kB minified (single file, no dependencies) |
| Browser compatible | YES — pure JS, no Node.js APIs, UMD + browser global exposed |
| License | MIT |
| Maintenance | Dormant but complete; the algorithm is correct and finished |
| Confidence | MEDIUM — verified browser-compatible, API confirmed, but version staleness noted |

**Why munkres-js and not lap-jv:** `lap-jv` (Fil/lap-jv) has only 9 commits, no npm package,
and is a low-maintenance port. `munkres-js` has broad adoption, is 3 kB, and O(n³) is
acceptable for route sizes ≤ 300 posts. If profiling shows it is a bottleneck for large drawings,
replace with an inline 2-opt heuristic rather than adding a heavier library.

**Why not graphology/graphology-shortest-path for this capability:** graphology is a general
graph object library (v0.26.0, Feb 2025, ~45 kB minified). It provides Dijkstra/A* for
single-source shortest path, not bipartite assignment. It would be useful IF the solver needed
to propagate anchor GPS through the DXF cable-graph to seed candidates — but the existing
`gpsByPostNumber` map from the PDF-only run already provides per-post GPS estimates, making
graph propagation unnecessary. Do not add graphology for v1.1.

**Integration point in `coordinate-calculator-dwg.js`:**

```
runDwgPairingCascade()
  ├── [NEW] level-0: globalGraphSolver()  → dwgPath: "dwg-global-solve"
  ├── level-1: pairPostsByGraphWalk()     → dwgPath: "dwg-graph-walk"  (unchanged)
  └── level-2: pairPostsAgainstRegion()   → dwgPath: "dwg-pdf-walk"   (unchanged)
```

`globalGraphSolver` receives the same inputs as `pairPostsByGraphWalk`:
`{ posts, distances, connections, startLat, startLon, regionPosts, regionEdges, postIndex,
adjacencyGraph, gpsByPostNumber }` and returns `{ ok, coords, dwgPath }`.

---

## Capability B — Truth-Free Accuracy / Confidence Metric

### Problem Statement

New drawings have no GPS ground truth. The metric must be computable from internal data only:
printed inter-post distances (from the PDF parser) and the DXF-derived coordinates output by the
solver.

### Recommended Approach: Internal-Consistency Residual (implement in-house, no library)

**Do NOT add a statistics library for this.** The math is straightforward.

Two components, computed after the solver assigns each post a DXF coordinate:

**Component 1 — Distance Residual (primary)**

For every edge `(post_i → post_j)` where a printed distance label `d_printed` exists:

```
residual_ij = |haversine(lat_i, lon_i, lat_j, lon_j) - d_printed|
```

Aggregate as:
- `mean_residual_m` — mean absolute error in metres across all labelled edges
- `p95_residual_m` — 95th percentile (flag outlier posts)
- `residual_fraction` = `mean_residual_m / mean(d_printed)` — scale-free ratio

Gate threshold: `mean_residual_m < CONFIDENCE_THRESHOLD_M` (suggest 8 m, matching the global
solver acceptance threshold).

The existing `haversine` implementation is already in `parser/geo/utm-calibrator.js` (as the
`latLonToUtm` / `utmToLatLon` round-trip path). Extract or add a direct haversine function
there; no new library needed.

**Component 2 — Reprojection Score (secondary)**

After converting assigned DXF INSERTs to lat/lon (`utmToLatLon`), the posts should lie on or
near the cable LWPOLYLINE geometry. For each post, compute the distance from its assigned
lat/lon to the nearest cable edge segment (from `croppedRegion.cableEdges`). This is point-to-
segment distance in UTM metres — pure geometry, no library needed.

```
reprojection_score = fraction_of_posts_within_SNAP_M_of_cable
```

Suggested `SNAP_M = 3` (matches existing `ADJACENCY_SNAP_M` in `region-pairing.js`).

**Output shape** (attach to the result object):

```js
{
  confidence: {
    mean_residual_m,       // primary gate
    p95_residual_m,        // per-post flag threshold
    residual_fraction,     // dimensionless, good for cross-route comparison
    reprojection_score,    // fraction 0–1
    edge_count,            // number of edges evaluated
    pass: boolean          // mean_residual_m < threshold AND reprojection_score > 0.8
  }
}
```

Per-post confidence flag: mark any post where its two adjacent residuals are both > `p95` as
`confidence: "low"` on the post object. This feeds P8 diagnostic surfacing.

**No new library required.** All math uses `Math.*`, existing `utmToLatLon`, and the existing
`haversine` formula (≈ 5 lines).

---

## Capability C — DXF Coordinate-System Normalization and GPS-Bbox Region Lookup

### C1 — Coordinate System Normalization (zone/datum detection)

**Current state:** `dxf-loader.js` already correctly reads DXF entity coordinates as raw UTM
metres and ignores `$LATITUDE/$LONGITUDE` (AutoCAD defaults). `region-library.js` hardcodes
`DEFAULT_CRS = { datum: "SIRGAS-2000", zone: 22, hemisphere: "S" }`.

**What v1.1 needs:** Ingest DXFs from multiple regions, which may sit in zones 21S, 22S, or 23S
(Brazilian telecom deployments cover Mato Grosso do Sul→São Paulo→southern states). Zone must be
auto-detected rather than hardcoded.

**Recommended approach: coordinate-range heuristic (implement in-house, no library)**

UTM zones have fixed easting ranges (always 100 000 – 900 000 m) and zone-specific northing
ranges for the southern hemisphere. The DXF `$EXTMIN` / `$EXTMAX` bounding box (already read by
`parseDxfText`) is sufficient to determine zone:

```
Zone 21S central meridian 57°W → easting 100k–900k, northing 6000k–9000k
Zone 22S central meridian 51°W → easting 100k–900k, northing 6000k–9000k
Zone 23S central meridian 45°W → easting 100k–900k, northing 6000k–9000k
```

Because the easting range is identical across zones, use the GPS of the first post (known at
ingestion time from the user or from a previously-processed PDF) to determine zone:

```js
function detectUtmZone(lon_deg) {
  return Math.floor((lon_deg + 180) / 6) + 1;  // already exists in latLonToUtm()
}
```

If no GPS is available at ingestion, parse the centroid of `$EXTMIN`/`$EXTMAX` and compare its
easting/northing to the three candidate zones via round-trip: convert to lat/lon under each zone
assumption and accept the zone whose output lat/lon falls within Brazil's bounding box
(-34°S to 5°N, -74°W to -34°W). This is 3 UTM inverse projections — pure math, no library.

**Do NOT add proj4 for this.** proj4 (v2.20.8, ~87 kB minified / ~27 kB gzipped) is a large
dependency whose full feature set (datum grids, WKT parsing, 60+ projections) is not needed.
The project already has a correct Snyder Transverse Mercator implementation in
`parser/geo/utm-calibrator.js` that handles SIRGAS-2000/WGS-84 (ellipsoid constants are
identical; difference is < 1 mm in South America). Extending `latLonToUtm` / `utmToLatLon` to
accept an explicit zone parameter (it currently auto-derives zone) is the only change needed.

**$INSUNITS handling:** Retain the existing explicit decision from `dxf-loader.js`: do NOT scale
by `$INSUNITS`. Brazilian telecom DXFs use raw UTM metres regardless of `$INSUNITS` value. If a
future DXF's extents fall outside the plausible UTM range (easting 100k–900k, northing
2000k–10000k), emit a `dwg-crs-suspect` warning and fall through to pdf-only.

### C2 — GPS-Bbox Region Lookup and Overlap Resolution

**Current state:** `lookupByGps` in `region-library.js` performs a linear scan of all stored
regions and returns the one with the smallest bounding-box area that contains the query point.
This is correct but O(n) over all stored regions.

**What v1.1 needs:** Support a corpus of many regions (10–100) without the scan becoming a
bottleneck, and handle GPS points that fall on bbox boundaries (edge case: a city split across
two DXFs).

**Recommended approach: rbush for GPS-bbox indexing (already a dependency)**

Replace the linear filter in `lookupByGps` with an rbush tree keyed on `bboxLatLon` coordinates.
`rbush@4.0.1` (already installed) supports rectangular bounding-box search — index each region's
`bboxLatLon` as a rectangle and query with a point bbox (`minX=lon, maxX=lon, minY=lat,
maxY=lat`).

```js
// Build once on library init (or lazily on first lookup)
const bboxTree = new RBush();
bboxTree.load(regions.map(r => ({
  minX: r.bboxLatLon.minLon, maxX: r.bboxLatLon.maxLon,
  minY: r.bboxLatLon.minLat, maxY: r.bboxLatLon.maxLat,
  id: r.id
})));
const hits = bboxTree.search({ minX: lon, maxX: lon, minY: lat, maxY: lat });
```

Tie-break (multiple hits): keep existing smallest-area heuristic applied only to the `hits`
subset, not the full collection. For < 10 overlapping regions this is O(1) in practice.

**No new library required.** rbush is already in `package.json` at 4.0.1.

The GPS-bbox index should be rebuilt in memory each time the browser session loads the region
library (the `listRegions` call already fetches all records from IndexedDB). For a 100-region
corpus this is negligible.

---

## Existing Stack — Do Not Re-Research or Change

| Component | Package | Version | Notes |
|-----------|---------|---------|-------|
| DXF parsing | `dxf-parser` | 1.1.2 | Already correct; do not upgrade (breaking changes in alpha branch) |
| Spatial index | `rbush` | 4.0.1 | Already used for PostIndex; extend for bbox lookup |
| IndexedDB | `idb` | 8.0.3 | Region library persistence; unchanged |
| Blob storage | `@vercel/blob` | 2.4.0 | DXF file cloud storage; unchanged |
| UTM math | Custom (utm-calibrator.js) | — | Extend `latLonToUtm`/`utmToLatLon` for explicit zone param |
| PDF OCR | `tesseract.js` | 5.1.1 | Unchanged |
| PDF parse | `pdfjs-dist` | 5.7.x | Unchanged |
| ZIP/KMZ | `jszip` | 3.10.1 | Unchanged |

---

## New Dependencies Summary

| Package | Version | Why | Bundle | Phase |
|---------|---------|-----|--------|-------|
| `munkres-js` | 2.0.3 | Hungarian assignment for global solver cost matrix | < 3 kB min | P7 |

That is the only new npm dependency. All other v1.1 capabilities are implemented in-house using
existing code and math.

---

## Explicit "Do NOT Add" List

| Package | Why Not |
|---------|---------|
| `proj4` / `proj4js` | ~87 kB minified (~27 kB gzipped); far larger than needed; the custom Snyder TM in utm-calibrator.js is already correct for SIRGAS-2000/WGS-84; only zone parameter needs extending |
| `graphology` + `graphology-shortest-path` | ~45 kB+; provides graph traversal, NOT bipartite assignment; GPS estimates from the PDF-only run make graph propagation unnecessary |
| `lap-jv` | No npm package; 9-commit GitHub port; unmaintained; munkres-js is sufficient and packaged |
| Any graph-isomorphism library | Wrong problem class; the PDF↔DXF pairing is assignment, not isomorphism |
| `turf.js` | Huge (400+ kB) geospatial suite; only haversine and UTM needed, both already implemented |
| `ml-matrix` / `numeric.js` | Overkill for 200×200 cost matrices; munkres-js handles the solve |
| Any server-side or WASM binary | Hard constraint: must remain client-side/browser-only |
| `dxf` (skymakerolof) or `dxf-json` | Different parsers; dxf-loader.js is proven on production files and has known-good layer handling for `Poste`, `TrechoSecundarioAereo`, `TrechoPrimarioAereo` |
| `fake-indexeddb` in production | Already dev-only; keep it that way |

---

## Installation

No changes to `package.json` until P7:

```bash
# P7 only
npm install munkres-js@2.0.3
```

---

## Sources

- graphology v0.26.0: https://github.com/graphology/graphology (release Feb 2025, browser ESM confirmed)
- graphology-shortest-path v2.1.0: https://graphology.github.io/standard-library/shortest-path.html
- munkres-js: https://github.com/addaleax/munkres-js (v2.0.3, MIT, pure JS, browser UMD)
- lap-jv (JS LAPJV): https://github.com/Fil/lap-jv (9 commits, no npm package — NOT recommended)
- proj4js v2.20.8: https://github.com/proj4js/proj4js (active, April 2026 release)
- EPSG:31982 SIRGAS-2000 UTM zone 22S: https://epsg.io/31982
- dxf-parser v1.1.2: https://github.com/gdsestimating/dxf-parser (last npm publish 2021, repo active Jul 2025)
- rbush v4.0.1: https://github.com/mourner/rbush (existing dep, ESM only)
- DXF $INSUNITS documentation: https://ezdxf.readthedocs.io/en/stable/concepts/units.html
- Existing project context: parser/dwg/coordinate-calculator-dwg.js, region-pairing.js, region-library.js, dxf-loader.js
