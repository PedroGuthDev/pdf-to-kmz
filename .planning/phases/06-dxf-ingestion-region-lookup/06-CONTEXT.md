# Phase 06: DXF Ingestion & Region Lookup - Context

**Gathered:** 2026-06-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Harden the existing DXF ingestion pipeline in `region-library.js::addRegion()`:
add coordinate-range-based unit mismatch detection (mm→m retry), Brazil bbox
validation on the extmin/extmax corners, CRS confidence field, fail-loud
no-region with a nearest-hint error object, and a Web Worker for off-thread
parsing of large DXFs (Palhoça 134 MB / 60k INSERTs ≤ 5 s). Close requirements
DXF-01 through DXF-07.

**What already exists (less work than it looks):**
- `region-library.js::addRegion()` already parses DXF, converts UTM→LatLon,
  builds rbush post-index, stores in IndexedDB — no rewrite needed, just
  additive validation and the Worker split.
- `lookupByGps()` already does GPS bbox filtering; only the null-path needs
  a nearest-hint error.
- `listRegions()` + UI dropdown already satisfy DXF-07 list; Phase 6 may
  surface bboxLatLon in the listing (per SC-5).
- `utmToLatLon()` in `parser/geo/utm-calibrator.js` is the in-house Snyder TM
  inverse — reuse directly, no new math needed.

**Out of scope:** active cascade demotion on fail (P7/P8), Portuguese error
message rendering (P9 / CONF-01), per-post UTM validation (would blow the 5s
budget), multi-zone CRS auto-detection (MZONE-01 deferred).

</domain>

<decisions>
## Implementation Decisions

### Unit mismatch detection (DXF-02)
- **D-01:** Detection is **coordinate-range only** — never reads `$INSUNITS`.
  Check whether `extmax.x` (and `extmax.y`) from `$EXTMAX` fall inside the
  zone-22S UTM envelope (roughly 640 000 – 840 000 m E; 6 450 000 – 7 050 000
  m N for Santa Catarina). If outside, the DXF is assumed to use millimeters →
  retry all post coordinates with ÷1000. Consistent with the existing "DO NOT
  scale $INSUNITS" principle in `dxf-loader.js`.
- **D-02:** If the ÷1000 retry result is **also** outside the zone-22S envelope
  → fail loud with the exact DXF-02 message: **"DXF unit mismatch suspected"**.
  Never store a silently-wrong region.
- **D-03:** All validation logic stays **inside `region-library.js::addRegion()`** —
  no new `dxf-ingestion.js` module. Strangler-fig principle: extend existing
  code additively.

### Ingest performance (DXF-06)
- **D-04:** Off-thread parsing via **Web Worker**. Protocol:
  - Main thread posts `{ type: 'PARSE_DXF', dxfText }` to the worker.
  - Worker runs `parseDxfText()` + `buildPostIndex()` (the expensive ops).
  - Worker returns `{ posts, cableEdges, primaryCableEdges, rbushDump, extmin, extmax }`.
  - Main thread receives the result and calls `addRegion()` for validation +
    IndexedDB storage (synchronous path, cheap).
  - No new dependencies — Web Worker is a browser built-in.
- **D-05:** The ≤5 s gate is verified by a **Node.js timing test** with the
  actual Palhoça.dxf file. A browser-based Playwright test is not required —
  no new test-runner deps allowed.

### No-region error format (DXF-05)
- **D-06:** When `lookupByGps()` finds no covering region it returns a
  **structured error object**:
  ```js
  { code: 'NO_REGION', nearest: { name, distanceKm } }
  ```
  The `code` field is machine-readable for the cascade; the UI layer (Phase 9 /
  CONF-01) renders it in Portuguese. Phase 6 does not produce a user-visible
  string.
- **D-07:** "Nearest region" distance = **haversine from the query GPS anchor
  to the centroid of each region's `bboxLatLon`**. Pick the closest. Reuses
  the in-house haversine from `parser/coordinate-calculator.js`.

### CRS confidence field (DXF-01, DXF-03)
- **D-08:** The `crs` record gains a `confidence` field with three possible
  values:
  - `'high'` — coordinates natively inside zone-22S UTM envelope (normal case).
  - `'low'` — accepted only after mm→m retry (edge case; in practice should
    almost never store because a low-confidence ingest that also fails is
    fail-loud per D-02).
  - `'inferred'` — `$EXTMIN`/`$EXTMAX` absent or zero; CRS is assumed from
    project default.
- **D-09:** Brazil bbox validation (DXF-03) = check **only the two
  `extmin`/`extmax` bbox corners** after UTM→WGS84 at ingest time, against
  Brazil's bounding box (~−33.7° to +5.3° lat, −73.0° to −34.8° lon). If
  either corner is outside → fail loud. Checking all 60k posts would exceed
  the 5 s budget.

### Claude's Discretion
- Exact zone-22S UTM envelope constants (precise min/max E and N for the
  Palhoça / SC region) — planner to derive from the known Siriu extents and
  add a generous margin.
- Whether the `confidence: 'low'` path is reachable in practice given D-02
  (planner may choose to make it unreachable and assert it never stores).
- Field names on the structured `NO_REGION` error object beyond `code` and
  `nearest.name` / `nearest.distanceKm`.
- How the existing UI dropdown (DXF-07) surfaces `bboxLatLon` per SC-5 —
  planner decides the minimal UI change needed.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` §DXF-01..DXF-07 — all 7 requirements this
  phase must close.
- `.planning/ROADMAP.md` §"Phase 6" — goal + 5 success criteria (SC-1..SC-5).
  SC-1: Siriu re-ingest → identical bbox + confidence 'high'.
  SC-2: mm-scale DXF → retry fail → "DXF unit mismatch suspected".
  SC-3: GPS outside all regions → structured NO_REGION error with nearest hint.
  SC-4: Palhoça 134MB / 60k INSERTs ≤ 5 s (Node.js timing test).
  SC-5: User can list regions with name + GPS bboxes.

### Existing code to extend (NOT rewrite)
- `parser/dwg/region-library.js` — `addRegion()` (extend with D-01–D-09
  validation), `lookupByGps()` (extend null path with D-06 error object),
  `listRegions()` (extend response to include bboxLatLon per SC-5 if not
  already included).
- `parser/dwg/dxf-loader.js` — `parseDxfText()` moves into the Web Worker
  (D-04); the "DO NOT scale $INSUNITS" invariant is preserved (D-01).
- `parser/dwg/region-pairing.js` — `buildPostIndex()` also moves to the Worker
  (expensive rbush indexing step).
- `parser/geo/utm-calibrator.js` — `utmToLatLon()` used for bbox corners
  validation (DXF-03); `latLonToUtm` / Snyder TM — no changes needed.
- `parser/coordinate-calculator.js` — in-house haversine reused for D-07
  nearest-region distance.

### Test harness patterns (mirror these)
- `tools/run-siriu-regression-gate.mjs`, `tools/run-siriu-post-position-gate.mjs` —
  existing Node.js timing / gate harness pattern to mirror for the DXF-06
  timing test.

### v1.1 research (cross-phase constraints)
- `.planning/research/SUMMARY.md` — build order, no-new-deps list.
- `.planning/research/STACK.md` — do-NOT-add list; no new deps in Phase 6.
- `.planning/research/PITFALLS.md` — Pitfall 7 (compensated-error gate trap):
  do not let the unit-retry path silently swallow errors that should fail loud.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`utmToLatLon(easting, northing, zone)`** in `utm-calibrator.js` — pure
  Snyder TM inverse, browser-compatible (Math.* only). Used for bbox corner
  validation (DXF-03) and the existing bboxLatLon computation.
- **In-house haversine** in `parser/coordinate-calculator.js` — reuse for
  nearest-centroid distance (D-07). Do NOT add turf.js.
- **`buildPostIndex(posts)` / `restorePostIndexFromDump(dump)`** in
  `region-pairing.js` — rbush-backed post spatial index. Moves to Worker but
  is otherwise unchanged.
- **Existing gate harness pattern** (`tools/run-*-gate.mjs` + `node --test`)
  — mirror for the DXF-06 timing test.

### Established Patterns
- **Strangler-fig / additive extension**: extend `addRegion()`, do not rewrite
  or split into a new module (D-03).
- **Fail-loud, never silently-wrong**: unit mismatch after retry → throw/reject,
  not store with low confidence (D-02).
- **No new external deps in Phase 6**: Web Worker is built-in; haversine and
  Snyder TM are in-house. `dxf-parser` is already a dependency.
- **IndexedDB via `idb`**: `openRegionsDb()` helper wraps the idb pattern used
  throughout `region-library.js`; keep using it.

### Integration Points
- `addRegion()` is called from the UI upload handler and cloud import path —
  the Worker split (D-04) means `addRegion()` now awaits a Worker message
  before proceeding to validation + storage.
- `lookupByGps()` is called from `coordinate-calculator-dwg.js` in the live
  pairing cascade — the structured error return (D-06) must be handled by that
  caller.
- The new `crs.confidence` field is stored in IndexedDB and returned by
  `listRegions()` / `getRegionWithIndex()` — downstream P7/P8 code may read it.

</code_context>

<specifics>
## Specific Ideas

- Siriu extmin/extmax from the existing DXF: extmin.x ≈ 730 000, extmax.x ≈
  730 500 (rough). Use these to derive the zone-22S envelope constants with a
  generous margin (e.g., 600 000 – 900 000 E; 6 400 000 – 7 200 000 N).
- Palhoça DXF is at ~134 MB / ~60k INSERTs. The 5 s target is the TOTAL
  ingest time including Worker round-trip + IndexedDB write.
- Success criterion SC-1 says "re-ingesting the existing Siriu DXF" must
  produce "identical GPS bounding box" — the existing stored bboxLatLon is
  the golden reference. Any change to the ingestion path must not drift it.

</specifics>

<deferred>
## Deferred Ideas

- **Multi-zone CRS auto-detection** (UTM 21S / 23S) → MZONE-01 backlog.
  Phase 6 is zone-22S + fail-loud.
- **Per-post UTM→WGS84 validation** (all 60k posts) → too slow for P6 budget;
  bbox-corner check (D-09) is sufficient.
- **Portuguese error message rendering for DXF-05** → Phase 9 / CONF-01.
  Phase 6 emits a structured object only.
- **Active cascade demotion when no region** → Phase 7/8 (solver
  prerequisites + global solver handle cascade routing).
- **Interactive region bbox map preview** → ENH-01 backlog.

</deferred>

---

*Phase: 06-dxf-ingestion-region-lookup*
*Context gathered: 2026-06-06*
