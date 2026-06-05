# Architecture Research: PDF to KMZ Converter — v1.1 DXF-Driven Accuracy

**Domain:** Browser-side geospatial PDF-to-KMZ pipeline (client-only, no server)
**Researched:** 2026-06-05
**Confidence:** HIGH (based on reading the actual source code, not external sources)

---

## v1.0 Architecture (Baseline — Do Not Break)

```
PDF upload
    ↓
PDF Parser (pdf.js) → text items + page positions
    ↓
Data Extractor → { posts[], distances[], cableSegments[], connections[], walkConnections[] }
    ↓
calculateCoordinatesWithDwg(posts, distances, lat1, lon1, cableSegments, opts, regionLibrary)
    │
    ├─ regionLibrary.lookupByGps(lat1, lon1) → region record
    │       └─ regionLibrary.getRegionWithIndex(id) → { posts[], cableEdges[], bboxLatLon, crs, postIndex, adjacencyGraph }
    │
    ├─ calculateCoordinates() → pdfResult (PDF-only path; also seeds gpsByPostNumber)
    │
    ├─ cropRegionToBbox() → croppedRegion
    │
    ├─ buildPostIndex() + buildAdjacencyGraph() → postIndex, adjacencyGraph
    │
    └─ runDwgPairingCascade()
            ├─ Level 1: pairPostsByGraphWalk()   → { ok, coords[], dwgPath: "dwg-graph-walk" }
            ├─ Level 2: pairPostsAgainstRegion() → { ok, coords[], dwgPath: "dwg-pdf-walk" }
            └─ Level 3: (caller falls through)   → dwgStatus: "pdf-fallback"
    ↓
KML Builder → KMZ download
```

The caller of `calculateCoordinatesWithDwg` receives a result object with shape:
```
{
  posts: [{ number, lat, lon, source: "dwg"|"pdf", dwg_block }],
  connections: [...],
  walkConnections: [...],
  warnings: [...],
  userWarnings: [...],
  dwgStatus: "dwg-graph-walk"|"dwg-pdf-walk"|"pdf-fallback",
  dwgRegionId: string | null,
}
```

---

## v1.1 Extended Architecture: Four New Capabilities

v1.1 inserts new components into the existing pipeline without removing anything.
The strangler-fig approach: wrap, extend, gate — do not rewrite.

```
PDF upload
    ↓
PDF Parser (pdf.js) → text items + page positions
    ↓
Data Extractor → { posts[], distances[], cableSegments[], connections[], walkConnections[] }
    ↓
calculateCoordinatesWithDwg(posts, distances, lat1, lon1, cableSegments, opts, regionLibrary)
    │
    ├─ [UNCHANGED] regionLibrary.lookupByGps(lat1, lon1)          ← P6: extended backend
    │       └─ getRegionWithIndex(id)                             ← P6: normalizes CRS on ingest
    │
    ├─ [UNCHANGED] calculateCoordinates() → pdfResult
    │
    ├─ [UNCHANGED] cropRegionToBbox() + buildPostIndex() + buildAdjacencyGraph()
    │
    ├─ [NEW P7] solveGlobalGraphAlignment()                        ← level-0 solver
    │       Input:  pdfGraph (posts[], distances[], connections[])
    │               dxfGraph (regionPosts[], regionEdges[], adjacencyGraph)
    │               anchor (lat1, lon1 → UTM)
    │       Output: { ok, coords[], confidence, residuals[], solverPath: "global-solve" }
    │                                  OR
    │               { ok: false, reason, partialCoords[] }
    │
    ├─ [MODIFIED] runDwgPairingCascade()   — now 4 levels:
    │       Level 0: solveGlobalGraphAlignment()  → "global-solve"          [P7]
    │       Level 1: pairPostsByGraphWalk()       → "dwg-graph-walk"        [unchanged]
    │       Level 2: pairPostsAgainstRegion()     → "dwg-pdf-walk"          [unchanged]
    │       Level 3: (caller falls through)       → "pdf-fallback"          [unchanged]
    │
    ├─ [NEW P5] computeResiduals(coords[], distances[])           ← residual gate
    │       For every paired edge: |printed_distance - haversine(A,B)| / printed_distance
    │       Returns: { meanRelError, maxRelError, perPost: [{postNumber, residualM, relError}] }
    │       Gate decision:
    │         meanRelError < TRUST_THRESHOLD    → trust (keep coords, emit confidence)
    │         meanRelError < FALLBACK_THRESHOLD → fallback (demote to next level)
    │         else                              → diagnostic-fail (surface errors, PDF-only)
    │
    └─ [NEW P8] buildConfidenceResult()                           ← confidence surfacing
            Input:  dwgPosts[], residuals[], solverPath, gateDecision
            Output: posts with perPost { confidence: "high"|"medium"|"low"|"fail" }
                    + result.dwgConfidence: { overall, gate, perPost[] }
                    + result.userWarnings[] (extended with failure detail)
    ↓
KML Builder → KMZ download
    ↑
    [NEW P8] Confidence flags propagate into KMZ placemark descriptions
             and into UI diagnostic panel
```

---

## Component Inventory: New vs Modified

### New Components (create from scratch)

| File | Phase | Responsibility |
|------|-------|----------------|
| `parser/dwg/global-solver.js` | P7 | `solveGlobalGraphAlignment()` — constrained graph match of PDF route graph onto DXF cable graph |
| `parser/dwg/residual-gate.js` | P5 | `computeResiduals()` + `applyResidualGate()` — truth-free error metric and trust/fallback/fail routing |
| `parser/dwg/dxf-ingestion.js` | P6 | Multi-CRS DXF normalization: detect coordinate system, reproject to SIRGAS-2000 zone-22S if needed, validate bbox sanity |
| `parser/dwg/confidence-surface.js` | P8 | `buildConfidenceResult()` — per-post confidence tagging; KMZ/UI diagnostic payload builder |

### Modified Components (extend, not rewrite)

| File | Phase | Change |
|------|-------|--------|
| `parser/dwg/coordinate-calculator-dwg.js` | P5+P7+P8 | `runDwgPairingCascade()` gains level-0 call; residual gate wraps every level's result; confidence surfacing added to success path |
| `parser/dwg/region-library.js` | P6 | `addRegion()` calls dxf-ingestion normalizer before storing; `lookupByGps()` gains "no region" boundary signal |
| `parser/dwg/region-library-hybrid.js` | P6 | `addRegion()` + `importRegionFromManifest()` pass through CRS metadata from normalizer |
| `parser/dwg/dxf-loader.js` | P6 | Handle multi-CRS DXFs: detect zone from header hints, expose raw extent for normalizer |

### Unchanged Components (must stay intact)

| File | Why Untouched |
|------|---------------|
| `parser/dwg/graph-walker.js` | Proven level-1 fallback; 2,723 lines; strangler-fig keeps it |
| `parser/dwg/region-pairing.js` | Level-2 primitives; `pairPostsAgainstRegion()` stays as-is |
| `parser/dwg/region-crop.js` | Cropping logic is independent of new solver |
| `parser/dwg/cable-topology.js` | Used post-pairing for KMZ connection derivation; no change needed |
| `parser/coordinate-calculator.js` | PDF-only fallback path; not touched |

---

## Integration Points — Exact Call Sites

### Integration Point 1: Residual Gate in `runDwgPairingCascade` (P5)

Current shape (coordinate-calculator-dwg.js line 112–170):
```js
function runDwgPairingCascade({ posts, distances, ... }) {
  const level1 = pairPostsByGraphWalk(...);
  if (level1.ok) return { ok: true, coords: level1.coords, dwgPath: "dwg-graph-walk" };
  const level2 = pairPostsAgainstRegion(...);
  if (level2.ok) return { ok: true, coords: level2.coords, dwgPath: "dwg-pdf-walk" };
  return { ok: false };
}
```

v1.1 shape (P5 wraps each successful level with residual gate):
```js
function runDwgPairingCascade({ posts, distances, ... }) {
  // Level 0 (P7 adds this)
  const level0 = solveGlobalGraphAlignment(...);
  if (level0.ok) {
    const gate0 = applyResidualGate(level0.coords, distances);
    if (gate0.decision === "trust") return { ok: true, coords: level0.coords, dwgPath: "global-solve", residuals: gate0 };
    if (gate0.decision === "fail") return { ok: false, diagnosticFail: true, residuals: gate0 };
    // "fallback" → continue to level 1
  }

  // Level 1 (unchanged call; new gate wrapper)
  const level1 = pairPostsByGraphWalk(...);
  if (level1.ok) {
    const gate1 = applyResidualGate(level1.coords, distances);
    if (gate1.decision !== "fail") return { ok: true, coords: level1.coords, dwgPath: "dwg-graph-walk", residuals: gate1 };
    // gate says fail → fall through
  }

  // Level 2 (unchanged call; new gate wrapper)
  const level2 = pairPostsAgainstRegion(...);
  if (level2.ok) {
    const gate2 = applyResidualGate(level2.coords, distances);
    if (gate2.decision !== "fail") return { ok: true, coords: level2.coords, dwgPath: "dwg-pdf-walk", residuals: gate2 };
  }

  return { ok: false };
}
```

The gate is the ONLY new caller of `computeResiduals()`. Both existing levels gain the gate in P5, before the solver exists. This is the "measure before you change" step.

### Integration Point 2: `lookupByGps` in `calculateCoordinatesWithDwg` (P6)

Current (lines 207–213): calls `regionLibrary.lookupByGps(lat1, lon1)` which returns `null` or a region record. When null, falls to pdf-fallback.

v1.1 change: `lookupByGps` gains a structured "no-region boundary" return:
```js
// null         → no region at all (GPS not covered by any DXF)  [unchanged behavior]
// { id, ... }  → region found                                    [unchanged behavior]
// { noRegion: true, nearestRegionId, distanceKm }                [NEW: P6]
```

The `calculateCoordinatesWithDwg` caller does NOT need to change its null-guard — the existing `if (!region)` branch already handles the pdf-fallback. The new `noRegion` shape is additive: it just enriches the warning pushed to `warnings[]` before the existing fallback path runs.

### Integration Point 3: Level-0 Solver Input Requirements (P7)

`solveGlobalGraphAlignment()` needs exactly the data already assembled in `calculateCoordinatesWithDwg` before `runDwgPairingCascade` is called. No new upstream data fetches are required.

**PDF-side inputs** (already in scope at call site):
```
posts[]          — sorted by number, from routePosts (line 285–289)
distances[]      — distMap-ready { from, to, meters }
connections[]    — walkConnections (line 277–279), which preserves branch-return edges
```

**DXF-side inputs** (already built before cascade call):
```
regionPosts[]    — croppedRegion.posts (line 299)
regionEdges[]    — croppedRegion.cableEdges (line 300)
adjacencyGraph   — built at line 302–303
anchorUtm        — derived from lat1, lon1 (solver anchors on post 1)
zoneExpected     — regionData.crs.zone (line 291)
```

**New solver-specific inputs** (small additions):
```
gpsByPostNumber  — already a Map<number,{lat,lon}> built at lines 314–319
                   solver uses it for multi-anchor GPS confirmation where available
```

**Solver output contract:**
```js
{
  ok: true,
  coords: [{ postNumber, lat, lon, source: "dwg", dwg_block, solverScore }],
  confidence: 0.0–1.0,          // overall alignment score
  residuals: [],                 // per-edge for gate consumption
  solverPath: "global-solve",
}
// OR on failure:
{
  ok: false,
  reason: "no-anchor" | "low-confidence" | "ambiguous-topology" | "solver-error",
  partialCoords: [],             // best partial result for diagnostic surfacing
}
```

### Integration Point 4: Confidence Surfacing in `calculateCoordinatesWithDwg` (P8)

Current success path (lines 405–420) builds `successResult` with `posts: dwgPosts`.

v1.1 adds a post-processing call after the cascade:
```js
// After cascade.ok check, before return:
const confidenceResult = buildConfidenceResult({
  posts: dwgPosts,
  residuals: cascade.residuals ?? null,
  dwgPath: cascade.dwgPath,
  gateDecision: cascade.residuals?.decision ?? "unknown",
});
successResult.dwgConfidence = confidenceResult.summary;
successResult.posts = confidenceResult.posts;  // posts now carry .confidence field
```

The KML builder (currently unaware of confidence) receives posts with a new optional `.confidence` field. If the KML builder ignores unknown fields, no change is needed there in P8 — the data is carried through and surfaced via `userWarnings` and the diagnostic panel.

---

## Data Flow: Full v1.1 Pipeline

```
[PDF text items]  →  Data Extractor
                         │
           ┌─────────────┤
           │             │
    posts[]          distances[]
    connections[]    cableSegments[]
    walkConnections[]
           │
           ▼
    calculateCoordinatesWithDwg()
           │
           ├─ 1. regionLibrary.lookupByGps(lat1, lon1)      [P6: extended]
           │         └─ dxf-ingestion.normalizeOnIngest()    [P6: new, runs at addRegion time]
           │
           ├─ 2. calculateCoordinates() → pdfResult          [UNCHANGED]
           │
           ├─ 3. cropRegionToBbox()                          [UNCHANGED]
           │    buildPostIndex() + buildAdjacencyGraph()
           │
           ├─ 4. runDwgPairingCascade()                      [MODIFIED]
           │         │
           │    Level 0: solveGlobalGraphAlignment()         [P7: new]
           │         │       ↓
           │         │  applyResidualGate()                  [P5: new]
           │         │       ↓ trust/fallback/fail
           │         │
           │    Level 1: pairPostsByGraphWalk()              [UNCHANGED]
           │         │       ↓
           │         │  applyResidualGate()                  [P5: new]
           │         │
           │    Level 2: pairPostsAgainstRegion()            [UNCHANGED]
           │         │       ↓
           │         │  applyResidualGate()                  [P5: new]
           │         │
           │    Level 3: pdf-fallback                        [UNCHANGED]
           │
           └─ 5. buildConfidenceResult()                     [P8: new]
                      └─ posts[].confidence attached
                      └─ dwgConfidence summary in result
           │
           ▼
    KML Builder  →  KMZ
    [P8: diagnostic panel reads dwgConfidence from result]
```

---

## P5: Residual Gate — Component Design

**File:** `parser/dwg/residual-gate.js`

**Core function:**
```js
export function computeResiduals(coords, distances) {
  // coords: [{ postNumber, lat, lon }]
  // distances: [{ from, to, meters }]
  // For each distance edge where both endpoints have coords:
  //   haversineM = haversine(coords[from], coords[to])
  //   residualM  = |haversineM - printed_meters|
  //   relError   = residualM / printed_meters
  // Returns: { meanRelError, maxRelError, medianRelError, perEdge[] }
}

export function applyResidualGate(coords, distances, opts = {}) {
  const {
    TRUST_THRESHOLD    = 0.05,   // 5% mean relative error → trust
    FALLBACK_THRESHOLD = 0.15,   // 15% → demote to next level
    // above 15% → diagnostic-fail
  } = opts;
  const r = computeResiduals(coords, distances);
  const decision =
    r.meanRelError < TRUST_THRESHOLD    ? "trust" :
    r.meanRelError < FALLBACK_THRESHOLD ? "fallback" :
                                          "fail";
  return { ...r, decision };
}
```

**Threshold calibration note:** TRUST_THRESHOLD and FALLBACK_THRESHOLD are not guesses — they must be calibrated against the known-good Siriu result (which has ~6m accuracy on 85 posts with printed distances of 20–60m, so ~10–30% would be a very bad result). P5's first task is to run `computeResiduals()` on Siriu graph-walk output to establish a baseline before tuning thresholds.

---

## P6: DXF Ingestion — Component Design

**File:** `parser/dwg/dxf-ingestion.js`

**Problem:** Existing `dxf-loader.js` hardcodes SIRGAS-2000 zone-22S and blindly trusts entity coordinates as raw UTM meters. New DXFs from different zones or different coordinate systems will produce silently wrong GPS bboxes.

**Normalization pipeline (runs at `addRegion()` time, not at lookup time):**
```
parseDxfText(dxfText)
    ↓
detectCrs(extmin, extmax, entities)
    │
    ├─ Heuristic 1: entity x in [600_000..900_000] AND y in [6_500_000..7_800_000]
    │               → likely SIRGAS-2000 zone-22S (no reprojection needed)
    ├─ Heuristic 2: entity x in [100_000..900_000] AND y in [6_500_000..8_000_000]
    │               → could be another zone; check $EXTMIN/$EXTMAX spread
    └─ Heuristic 3: entity coordinates < 100_000 in any axis
                    → likely not UTM (local grid or unknown); flag as "crs-unknown"
    ↓
normalizeToCrs(posts, cableEdges, detectedCrs, targetCrs)
    │  If source == target: passthrough
    │  If source zone differs: proj4 reproject easting/northing
    │  If "crs-unknown": store as-is, set crs.confidence = "low"
    ↓
validateBbox(posts)  → reject if bbox spans > 200 km (implausible single region)
    ↓
store record with crs = { datum, zone, hemisphere, confidence: "high"|"low" }
```

**Integration into `region-library.js` `addRegion()`:**
Replace current lines 57–67 (direct parseDxfText call) with:
```js
const raw = parseDxfText(dxfText);
const normalized = normalizeDxfForStorage(raw);  // from dxf-ingestion.js
// normalized = { posts, cableEdges, primaryCableEdges, extmin, extmax, crs }
```

**`lookupByGps` no-region boundary:**
Current implementation (lines 109–118) returns `null` silently. Add:
```js
if (!hits.length) {
  // Find nearest non-covering region for diagnostic hint
  const nearest = findNearestRegion(all, lat, lon);  // returns { id, distanceKm } or null
  return nearest ? { noRegion: true, nearestRegionId: nearest.id, distanceKm: nearest.distanceKm } : null;
}
```

---

## P7: Global Solver — Component Design

**File:** `parser/dwg/global-solver.js`

**Problem the solver addresses:** The sequential graph-walker fails at hubs and branches because it makes greedy local decisions. A global solver aligns the entire PDF route graph onto the entire DXF cable graph simultaneously, using distances as edge-weight constraints to arbitrate topology disputes.

**Algorithm (constrained subgraph isomorphism with distance scoring):**

```
Step 1 — Anchor
  Find DXF INSERT closest to (lat1, lon1) within DEFAULT_TOLERANCE_M.
  This fixes post[0] → dxfPost[anchor_idx].

Step 2 — Build PDF route graph
  Nodes: posts[] (by number)
  Edges: connections[] / walkConnections[] with weight = distances[from→to]

Step 3 — Build DXF cable graph (already built: adjacencyGraph + regionPosts)
  Nodes: regionPosts[] (by index)
  Edges: adjacencyGraph (by UTM span = sqrt((a.x-b.x)²+(a.y-b.y)²))

Step 4 — Constrained BFS/DFS assignment
  For each PDF edge (fromPdf → toPdf, weight=D):
    DXF anchor for fromPdf is known (from previous step or from anchor)
    Enumerate all DXF cable-graph paths of span ≈ D (±spanTol) from anchor
    Score each candidate: spanDelta + topology_penalty (candidate degree mismatch)
    Pick best candidate not in claimed set
    If no candidate within tolerance: solver fails this sub-tree

Step 5 — Score entire assignment
  For all N edges assigned: mean(|dxf_span - pdf_distance| / pdf_distance)
  This IS the residual — the gate in P5 reads this directly.

Step 6 — Return
  { ok, coords, confidence, residuals[], solverPath: "global-solve" }
```

**Key invariant:** The global solver NEVER modifies the existing level-1 or level-2 code. It is a separate function that returns the same `{ ok, coords[] }` shape. `runDwgPairingCascade()` in coordinate-calculator-dwg.js calls it first; if it fails or if the gate demotes it, the existing levels run unchanged.

**Inputs already available at call site (no new data fetching):**
- `routePosts[]` — sorted post array (line 285)
- `distances[]` — original distances array
- `connections` / `walkConnections` — topology (line 277–279)
- `regionPosts[]` — croppedRegion.posts (line 299)
- `regionEdges[]` — croppedRegion.cableEdges (line 300)
- `adjacencyGraph` — built at lines 302–303
- anchor: `lat1, lon1` → UTM via `latLonToUtm`
- `zoneExpected` — regionData.crs.zone (line 291)

---

## P8: Confidence Surfacing — Component Design

**File:** `parser/dwg/confidence-surface.js`

**Per-post confidence tagging:**
```js
// confidence field on each post:
// "high"   → residual < 5% for this post's edges
// "medium" → residual < 15%
// "low"    → residual < 30%
// "fail"   → residual ≥ 30% or post unpaired
```

**Result shape additions (backwards-compatible):**
```js
// Existing result fields unchanged.
// New fields added to successResult:
{
  dwgConfidence: {
    overall: "high" | "medium" | "low" | "fail",
    gate: "trust" | "fallback" | "fail",
    meanResidualM: number,
    maxResidualM: number,
    perPost: [{ postNumber, residualM, relError, confidence }],
  }
}
// Each post in posts[] gains:
{
  ...existing,
  confidence: "high" | "medium" | "low" | "fail",  // optional, undefined on PDF-only posts
}
```

**`buildCalcUserWarnings` extension (coordinate-calculator-dwg.js lines 22–55):**
Current logic keys on `dwgStatus`. v1.1 adds a branch for `diagnosticFail`:
```js
if (result.dwgConfidence?.gate === "fail") {
  notices.push("Falha de qualidade: o DWG foi pareado mas as distâncias são inconsistentes (erro médio " + ...);
}
```

**KMZ propagation:** Per-post `confidence` field flows into KML placemark description via KML Builder. If KML Builder currently ignores unknown fields on post objects, no change is needed in Phase 8 — the field is there when the builder iterates posts.

---

## Dependency-Ordered Build Sequence: P5–P8

### Why This Order

The "measure before you change" discipline: the residual gate (P5) must exist and be validated against known-good results (Siriu) before the global solver (P7) is built. Otherwise there is no way to tell whether the solver is producing better results than the graph-walker — the residual IS the quality metric.

DXF ingestion (P6) must precede the solver (P7) because the solver depends on well-normalized DXF coordinates. A mis-zoned DXF fed to the solver produces wrong UTM spans that make every candidate comparison fail.

Confidence surfacing (P8) is last because it synthesizes outputs from P5 (residuals) and P7 (solver confidence score) — it cannot be built until both produce stable outputs.

```
P5  Residual Gate
│   NEW: parser/dwg/residual-gate.js
│   MOD: parser/dwg/coordinate-calculator-dwg.js
│        runDwgPairingCascade() — wrap level 1 and level 2 results with applyResidualGate()
│        Calibrate thresholds against Siriu (TRUST=5%, FALLBACK=15% are initial guesses)
│   GATE: Run siriu-walk-regression.test.mjs; confirm gate says "trust" on existing passes
│
├── P6  DXF Ingestion + Region Index
│   NEW: parser/dwg/dxf-ingestion.js
│   MOD: parser/dwg/dxf-loader.js (expose CRS hints)
│        parser/dwg/region-library.js (call normalizer at addRegion; structured noRegion return)
│        parser/dwg/region-library-hybrid.js (pass CRS metadata through)
│   GATE: Re-ingest Siriu DXF; confirm bboxLatLon unchanged; confirm zone=22S detected "high"
│
└── P7  Global Graph Solver
    NEW: parser/dwg/global-solver.js
    MOD: parser/dwg/coordinate-calculator-dwg.js
         runDwgPairingCascade() — add level-0 call to solveGlobalGraphAlignment()
         gate routes between trust/fallback/fail for level-0 result
    GATE: Siriu 85-post regression; LC João Born regression;
          Confirm level-0 "trust" on Siriu, confirm graph-walker still wins on Siriu if solver
          demoted; confirm no regression on existing passing routes
    │
    └── P8  Diagnostic Failure + Confidence Surfacing
        NEW: parser/dwg/confidence-surface.js
        MOD: parser/dwg/coordinate-calculator-dwg.js
             buildCalcUserWarnings() — diagnosticFail branch
             success path — attach dwgConfidence to result
        MOD: (UI) diagnostic panel reads result.dwgConfidence
        GATE: End-to-end: upload Siriu PDF + Siriu DXF → result.dwgConfidence.overall === "high"
              Upload PDF without DXF → result.dwgStatus === "pdf-fallback", no confidence field
              Simulate bad DXF (wrong zone) → result.dwgConfidence.gate === "fail", user warning shown
```

---

## Structural Invariants (Do Not Violate)

| Invariant | Where It Lives | Why It Cannot Break |
|-----------|---------------|---------------------|
| `runDwgPairingCascade` returns `{ ok, coords[], dwgPath }` | coordinate-calculator-dwg.js | Caller (calculateCoordinatesWithDwg) uses this shape directly |
| `pairPostsByGraphWalk` signature and return shape | graph-walker.js | 2,723-line file; Siriu regression gates it; no changes allowed |
| `pairPostsAgainstRegion` signature | region-pairing.js | Used directly by level-2 in cascade; must stay callable with same args |
| `calculateCoordinatesWithDwg` return shape (posts[], connections[], dwgStatus, warnings[]) | coordinate-calculator-dwg.js | KML builder and UI both read this; new fields are additive, no existing field removed |
| `lookupByGps` returns `null` or region record | region-library*.js | All callers null-guard; `{ noRegion: true }` treated as null by null-guard, additive only |
| `addRegion` stores `{ id, posts[], cableEdges[], bboxLatLon, crs, rbushDump }` | region-library.js | `getRegionWithIndex` deserializes this schema; `importRegionFromManifest` uses it for cloud sync |

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Mutating the graph-walker

**What people do:** Add per-route special-cases to graph-walker.js for new routes that the global solver fails on.
**Why it's wrong:** graph-walker.js is already 2,723 lines of special-cases for one route. Adding more makes generalization impossible and entangles the fallback with the solver's responsibilities.
**Do this instead:** If the global solver fails a new route, debug the solver's constraint engine. Use graph-walker as an untouched fallback. Track failures with diagnostic output.

### Anti-Pattern 2: Computing residuals after the KMZ is built

**What people do:** Post-process the output KMZ to validate coordinates.
**Why it's wrong:** Residuals must gate the cascade decision BEFORE committing to a solver level. Post-processing cannot fall back to a lower level.
**Do this instead:** `applyResidualGate()` is called inside `runDwgPairingCascade()`, immediately after each level's `{ ok, coords[] }` is returned, before the cascade exits.

### Anti-Pattern 3: Adding GPS ground truth for residual calibration

**What people do:** Use known GPS coordinates for every post to validate residuals on new routes.
**Why it's wrong:** New routes don't have GPS ground truth. The whole point of the truth-free residual is that `|printed_distance - haversine(A,B)|` is self-contained.
**Do this instead:** The only ground truth needed is: does the printed distance match the GPS span? That's computable from DXF + PDF alone.

### Anti-Pattern 4: Building the solver before the gate

**What people do:** Build the global solver first, then add residual measurement later.
**Why it's wrong:** Without the gate, you can't tell if the solver is producing better or worse results than the graph-walker. "It looks right on the map" is not a quality signal for a new route.
**Do this instead:** P5 (gate) before P7 (solver). Confirm the gate says "trust" on Siriu's graph-walk output before trusting it on solver output.

---

## Sources

All findings are from direct source code analysis of the actual codebase:
- `parser/dwg/coordinate-calculator-dwg.js` — cascade structure, call sites, result shape
- `parser/dwg/graph-walker.js` (lines 1047–2723) — exported function signature, return shape
- `parser/dwg/region-pairing.js` — tolerances, `pairPostsAgainstRegion` signature
- `parser/dwg/region-library.js` — `lookupByGps`, `addRegion`, `getRegionWithIndex` implementations
- `parser/dwg/region-library-hybrid.js` — cloud sync integration points
- `parser/dwg/dxf-loader.js` — coordinate handling, layer names, entity extraction
- `.planning/PROJECT.md` — v1.1 locked decisions and candidate phases

---
*Architecture research for: PDF-to-KMZ v1.1 DXF-Driven Accuracy*
*Researched: 2026-06-05*
