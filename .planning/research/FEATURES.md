# Feature Research: v1.1 — Generalized DXF-Driven Accuracy

**Domain:** Geospatial document-extraction pipeline (fiber-infrastructure PDF → georeferenced KMZ)
**Researched:** 2026-06-05
**Confidence:** MEDIUM-HIGH (internal consistency patterns well-established in photogrammetry/GIS literature; KMZ styling verified against official docs; pipeline-specific design informed by existing codebase)

---

## Scope

This file covers only the **four NEW capability areas** of v1.1. Existing shipped features
(PDF parse/OCR, per-post coordinate calc, DWG graph-walk, KMZ generation, browser UI,
hybrid IndexedDB/cloud region library) are not re-researched here.

The four areas:

1. Truth-free accuracy/confidence (no GPS ground truth needed)
2. Graceful degradation + diagnostics ("fail loud, never silently wrong")
3. Per-post confidence surfacing in KMZ output
4. DXF region corpus management (ingest, list, lookup by GPS)

---

## Category 1: Truth-Free Accuracy / Confidence Scoring

### What "good" looks like in mature tools

Photogrammetry pipelines (Pix4D, COLMAP, Metashape) treat **reprojection error** as the
canonical internal-consistency signal: project 3D points back through camera models and
measure pixel-space discrepancy. No GPS needed. Pix4D flags tie points where reprojection
error exceeds ~1 pixel and surfaces them to the user. The analogue for this pipeline is:

- **Span residual:** `|printed_distance_m - haversine(postA, postB)|` per edge
- **Aggregate RMSE:** RMS of all span residuals across the route
- **Region reprojection residual:** after affine registration of the PDF route graph onto the
  DXF cable graph, residual = distance between paired DWG node and its claimed PDF post

Both measure internal consistency; neither requires GPS ground truth. This pattern appears in
road network map-matching (HERE API confidence 0–1, based on GPS-to-edge distance), and in
georeferencing workflows where RMSE < 1 pixel/cell is the threshold for "good fit."

**Key insight from literature:** A low aggregate RMSE can coexist with a silently wrong
result if the transformation is globally consistent but locally anchored wrong. Per-edge
flagging is more actionable than a single global score. Pix4D's practice of flagging
individual high-residual tie points — not just reporting global RMSE — is the right model.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Span residual per edge (printed m vs haversine m) | Without this, there is no internal signal — every coord claim looks equally trustworthy | LOW | Already have distances from PDF parser and coords from DWG walker; this is subtraction + haversine |
| Aggregate route RMSE | Users need one number to judge "is this route reliable overall" | LOW | RMS of span residuals; report in meters |
| Per-post confidence flag (HIGH / MEDIUM / LOW / UNRESOLVABLE) | Users need to know which individual posts to spot-check, not just the overall score | MEDIUM | Assign based on: residual vs threshold, pairing source (DWG vs PDF fallback), OCR confidence |
| CI gate: route passes / fails / partial | The existing pipeline already has a "DWG succeeded" boolean; formalizing it as a threshold-gated CI check is the natural extension | LOW | Fail route if RMSE > threshold OR if unresolvable posts > N% |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Per-edge directional residual (not just magnitude) | Signed residual reveals systematic drift vs random noise; drift = calibration problem, noise = pairing problem | MEDIUM | Requires computing bearing delta between printed and computed direction |
| Confidence score decomposition (span residual + pairing distance + OCR confidence) | Allows diagnosing *why* a post is LOW — is it an OCR miss, a pairing gap, or a DXF topology discontinuity? | MEDIUM | Attach source breakdown to each post object |
| Historical cross-route calibration (if >1 route in same DXF region) | When multiple routes share a DXF region, their residuals should agree; disagreement flags a calibration fault | HIGH | Deferred — requires multi-route session context |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Single global "accuracy %" number displayed prominently | Feels like a quality seal of approval | A low RMSE across well-spaced posts can hide a 100 m anchor error; users stop reading details after seeing "98% accurate" | Display RMSE in meters with explicit caveats: "internal consistency only — not verified against GPS" |
| Decimal precision on residuals (e.g., "residual: 2.3471 m") | Seems more informative | Implies measurement precision far beyond what the pipeline actually has (PDF rasterization, OCR, DXF layer ambiguity all introduce multi-meter uncertainty) | Round to 0.1 m for display; flag anything > 5 m as HIGH residual without finer precision |
| Confidence score without a stated basis | Confidence numbers in isolation create miscalibrated trust (see arxiv:2402.07632 — miscalibrated AI confidence impairs decision-making and trust does not recover after correction) | Always label the basis: "confidence based on span residual vs printed distance" |

---

## Category 2: Graceful Degradation + Diagnostics

### What "good" looks like in mature tools

Geocoding APIs (Google, HERE) return a `status` field and `partial_match` flag alongside
results — never silently emit a wrong coordinate. GIS pipelines (Palantir Foundry, QGIS
georeferencer) surface per-control-point residuals and block propagation if transformation
quality is below threshold. The geospatial mapping pipeline literature notes: "it is
critically important to know where and how much a spatial model is extrapolating vs
interpolating."

The existing pipeline already has partial degradation machinery: `dwgStatus` ("pdf-fallback",
"dwg-pdf-walk"), `buildCalcUserWarnings()`, and structured warning objects (`dwg-region-miss`,
`dwg-pair-fail`, `dwg-tolerance-relaxed`). v1.1 needs to formalize and extend this into a
complete failure taxonomy with actionable messages.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Named failure modes with machine-readable codes | Users and future automation need to distinguish "no DXF region covers this GPS" from "pairing diverged at post N" from "DXF file corrupt" — a plain string message doesn't allow programmatic branching | LOW | Extend existing `kind` field in warning objects: `no-region`, `pairing-diverged`, `residual-exceeded`, `dxf-parse-error`, `ocr-miss-chain` |
| Actionable failure message in UI (Portuguese) | User needs to know what to do: "upload the DXF for zone 22S sector X", not "DWG pairing failed" | LOW | Already partially done in `formatDwgWarning`; extend coverage |
| Partial output with per-post source tags | Emit a KMZ even when only some posts were DWG-paired; tag each post's source in ExtendedData | MEDIUM | Existing `post.source` field ("dwg" vs "pdf") — pass it through to KMZ |
| Hard stop with diagnostic for unrecoverable failures | If DXF file is corrupt, GPS is outside any known region, or OCR confidence is too low to infer any post numbers — emit NO KMZ and explain clearly why | MEDIUM | Currently the pipeline falls back silently; needs an explicit "abort with reason" path |
| Failure location pinpointing ("pairing diverged at post N, residual X m") | Without a specific post number, user has no way to diagnose or manually correct | LOW | Already have `at_post` in `dwg-pair-fail`; extend to residual-exceeded case |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Structured diagnostic report (JSON/text) downloadable alongside KMZ | Power users can inspect the full residual table, pairing decisions, and walk trace without reading source code | MEDIUM | Serialize the internal diagnostic objects into a sidecar file |
| Failure cascade detection ("post 23 failed → posts 24–31 inherited bad anchor") | Warn when a single pairing failure propagates downstream, so user knows the real impact is larger than one post | MEDIUM | Walk the topology graph from failure point; count downstream dependents |
| Region coverage visualization ("your GPS bbox overlaps region X at 67%") | Helps user understand why a partial DXF match occurred | HIGH | Requires bbox intersection math + UI overlay |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Auto-retry with relaxed tolerances on failure | Seems helpful — more matches = better result | Silently relaxing tolerances is the primary cause of "looks reasonable but is wrong" outputs; the existing `dwg-tolerance-relaxed` warning is already a yellow flag | Relax once with a visible warning; do not chain retries without user acknowledgment |
| Suppress low-confidence posts from output | Cleaner output | Removes the information the user needs to decide whether to trust or fix the route; a missing post is worse than a flagged wrong post | Flag with LOW confidence and include with a distinct icon; never silently drop |
| "Best effort" mode that always produces a KMZ | Avoids empty-handed user | When anchor calibration has failed, a KMZ with seemingly valid coordinates is actively misleading and can propagate errors into field work | Emit KMZ only if at least one meaningful confidence tier is satisfied; otherwise show diagnostic and offer PDF-only fallback explicitly labeled |

---

## Category 3: Per-Post Confidence Surfacing in KMZ Output

### What "good" looks like in mature tools

KML/KMZ supports per-`Placemark` inline style override over shared document styles
(verified against official KML Reference). Each `Placemark` can set its own `<Style>` with
`<IconStyle>` and `<LineStyle>` using AABBGGRR hex color. `ExtendedData` with `<Data>`
name/value pairs stores arbitrary metadata (confidence score, source, residual) that appears
in Google Earth's info balloon. GeoServer uses per-feature styling at render time via SLD.
The pattern is: shared "normal" style in `<Document>`, inline per-placemark overrides for
flagged posts.

**Standard color tier convention in geospatial tools:**
- Green (HIGH confidence / within threshold)
- Yellow/Orange (MEDIUM confidence / relaxed tolerance used)
- Red (LOW confidence / fallback to PDF or unresolvable)
- Gray or distinct icon (source = PDF-only, no DXF)

This matches traffic-light conventions users already know from Google Maps, navigation apps,
and GIS quality control overlays.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Per-placemark icon color by confidence tier (green/orange/red/gray) | Users opening the KMZ need to immediately see which posts to inspect — color is faster than reading labels | LOW | KML inline `<IconStyle><color>` per Placemark; 4 tier colors + shared base style |
| Confidence tier label in placemark name or description | Users inspecting individual posts in Google Earth need the confidence reason without opening a separate report | LOW | Append tier tag to `<name>` or put in `<description>`: "Poste 42 [LOW — PDF fallback]" |
| ExtendedData fields per post (source, residual_m, confidence_tier) | Power users want to filter/inspect via the KML data panel; also enables future processing | LOW | Already have `post.source`; add `residual_m` and `confidence_tier` fields |
| Legend / summary description in KMZ document-level description | Without a legend, color coding is unexplained | LOW | Add `<description>` to KML `<Document>` element with tier meanings and RMSE summary |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Distinct line color for segments connecting LOW-confidence posts | Lines between posts inherit confidence from the weaker endpoint; helps users trace where the route drifts | MEDIUM | `<LineStyle>` per edge segment (needs per-segment KML structure rather than single polyline) |
| Confidence-tiered folder organization in KMZ | Separate KML Folders for HIGH/MEDIUM/LOW posts; Google Earth shows them as separate toggleable layers | LOW | Wrap placemarks in `<Folder>` by tier; zero implementation cost beyond grouping logic |
| Balloon template with residual sparkline (text table) | Show printed distance vs computed distance per edge in the balloon for a selected post | MEDIUM | BalloonStyle template with ExtendedData entity replacement |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Animated pulsing or blinking icons for LOW-confidence posts | Makes flagged posts unmissable | Google Earth KML does not support CSS animation; workaround hacks (multiple time-stamped copies) are brittle and bloat file size | Use distinct icon shape (cross or X) instead of animation for LOW confidence |
| Confidence heatmap overlay (raster GroundOverlay) | Visually impressive | Requires rendering a raster from scattered point residuals (interpolation introduces false precision in sparse areas); far more complex than icon coloring | Stick to per-point color coding; heatmap is a v2 candidate |
| Numeric confidence score in placemark name (e.g., "Poste 12 [87.3%]") | Precise number feels informative | Implies calibration far beyond actual pipeline precision; users anchor on the number and trust it even when the basis is weak (false precision anti-pattern) | Use tier labels (HIGH/MEDIUM/LOW/UNRESOLVABLE) not numeric percentages in display |

---

## Category 4: DXF Region Corpus Management

### What "good" looks like in mature tools

Tile cache systems (e.g., indexed-db-tile-cache) use IndexedDB for browser-side spatial data
storage with bounding-box lookup. RBush (already used in `region-pairing.js`) is the
established JS R-tree for browser spatial indexing — it supports GPS lat/lon bbox queries
natively. The existing `region-library.js` already implements an IndexedDB-backed store with
bbox-based lookup and the hybrid cloud/local `region-library-hybrid.js` adds Vercel Blob
for cloud-side storage. The v1.1 work is about making this robust enough to serve "many
drawings" reliably.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Ingest DXF with automatic bbox extraction | Without this, the user must manually enter GPS bounds for each drawing; defeats the purpose | LOW | Already done in `addRegion()` via `extmin`/`extmax` → UTM → lat/lon conversion; validate it handles edge cases (missing extents, wrong zone) |
| List all stored regions (name, bbox, UTM zone, post count, date added) | Users need to see what's in the corpus before uploading a new PDF | LOW | `listRegions()` exists; expose in UI as a management panel |
| GPS-based region lookup (given lat/lon, return candidate regions sorted by bbox overlap) | Core to the generalization goal — pipeline auto-selects the right DXF without user specifying it | LOW | RBush bbox search already in place; verify tie-breaking when GPS falls in multiple overlapping regions |
| Reject / warn on duplicate region (same bbox already stored) | Prevents stale/conflicting copies of the same drawing | LOW | Hash on bbox + post count; warn on near-duplicate |
| Delete / replace a stored region | Corpus management requires fixing bad uploads | LOW | IndexedDB delete by key; cloud Blob delete |
| No-region boundary: explicit failure when GPS outside all regions | The "never silently wrong" contract — must emit a clear error, not fall through to PDF-only silently | LOW | Already partially implemented (`dwg-region-miss`); harden as a first-class gate |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Region metadata validation on ingest (checks SIRGAS-2000 zone, post layer presence, minimum post count) | Catches bad DXF files before they poison the corpus | MEDIUM | Validate CRS, post count > 0, bbox area > minimum threshold |
| Overlap / coverage gap visualization (text list of "uncovered areas") | Tells user which geographic areas lack DXF coverage before they try to convert a PDF | HIGH | Requires computing complement of union of region bboxes — complex; defer |
| Cloud sync status indicator (local-only vs synced to Vercel Blob) | Hybrid library users need to know if a region is available on other devices | LOW | Already have hybrid library; expose sync state in list UI |
| Region version / provenance tracking (which PDF project was this DXF associated with?) | When a DXF is updated by the infrastructure team, users need to know which corpus entry is stale | MEDIUM | Store provenance metadata (filename, upload date, uploader) at ingest time |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Auto-download DXF regions from a central server | Seamless UX — user never has to think about corpus management | Requires a server and authenticated storage, contradicting the client-side-only architecture constraint; also raises data governance questions for infrastructure drawings | Keep hybrid local/Vercel Blob model; document upload workflow clearly |
| Fuzzy region matching (use "nearest" region even if GPS is outside its bbox) | Handles edge cases where GPS is slightly off | A post 500 m outside a region bbox is almost certainly in the wrong DXF — a "nearest" fallback produces coordinates from the wrong drawing | Only match if GPS is inside bbox; reject cleanly otherwise |
| Auto-split large DXF into sub-regions | Handles city-scale DXF files | Arbitrary geometric splitting destroys the cable topology graph, which is the entire basis of the graph-walk pairing | Keep the DXF intact; if a file is too large, require the infrastructure team to provide properly scoped regional files |

---

## Feature Dependencies

```
[Category 1: Span Residual per edge]
    └──requires──> [Existing: distances from PDF parser]
    └──requires──> [Existing: per-post GPS coords from DWG walker]
    └──produces──> [Category 1: Aggregate RMSE]
    └──produces──> [Category 1: Per-post confidence flag]

[Category 1: Per-post confidence flag]
    └──requires──> [Category 1: Span residual per edge]
    └──feeds──> [Category 3: KMZ icon color by confidence tier]
    └──feeds──> [Category 3: ExtendedData fields per post]

[Category 2: Named failure modes]
    └──requires──> [Category 1: Confidence / residual gate]
    └──feeds──> [Category 2: Actionable UI message]
    └──feeds──> [Category 2: Hard stop with diagnostic]

[Category 2: Partial output with per-post source tags]
    └──requires──> [Existing: post.source field ("dwg" vs "pdf")]
    └──feeds──> [Category 3: KMZ per-placemark color]

[Category 3: Per-placemark icon color]
    └──requires──> [Category 1: Per-post confidence flag]
    └──requires──> [Existing: KMZ generator (Phase 3)]

[Category 4: GPS-based region lookup]
    └──requires──> [Existing: RBush spatial index in region-pairing.js]
    └──requires──> [Existing: IndexedDB region library]
    └──feeds──> [Category 2: No-region boundary failure mode]

[Category 4: Region metadata validation on ingest]
    └──requires──> [Category 4: Ingest DXF with bbox extraction]
    └──blocks──> [Category 1: residual is meaningful only if DXF geometry is valid]
```

### Dependency Notes

- **Category 3 requires Category 1:** Confidence surfacing in KMZ is meaningless without a
  computed confidence signal. Do not implement KMZ color coding before the residual/confidence
  pipeline is in place.
- **Category 2 requires Category 1:** Meaningful failure messages depend on having a
  residual gate to trip them. The existing boolean `dwgStatus` is insufficient for v1.1 —
  the CI gate gives the threshold.
- **Category 4 is foundational:** Without a reliable corpus lookup, the global graph solver
  (P7) cannot find its DXF input. Corpus management gates the solver, not the residual.
- **Existing `post.source` field is the critical bridge:** It already distinguishes DWG vs
  PDF origin per post. All of Category 3 and most of Category 2 depend on this field being
  accurate and propagated through the pipeline.

---

## MVP Definition for v1.1

### Launch With (v1.1)

Minimum required to deliver on the milestone goal ("generalize across many drawings"):

- [x] **Span residual per edge + aggregate RMSE** — provides the truth-free confidence signal
- [x] **Per-post confidence tier (HIGH/MEDIUM/LOW/UNRESOLVABLE)** — gates the KMZ output
- [x] **Named failure modes with actionable messages** — "fail loud, never wrong"
- [x] **Partial output with per-post source tags in ExtendedData** — user sees which posts are DWG-sourced
- [x] **Per-placemark icon color by confidence tier** — user can spot-check in Google Earth
- [x] **Hard stop with diagnostic for unrecoverable failures** — no silent wrong output
- [x] **Region ingest validation (bbox + post count + UTM zone)** — prevents bad DXF poisoning corpus
- [x] **Region list UI** — users can manage corpus

### Add After Validation (v1.1.x)

- [ ] **Structured diagnostic report (downloadable sidecar)** — once users confirm the residual signal is stable
- [ ] **Failure cascade detection** — once the global solver (P7) is in place to create real cascade chains
- [ ] **Confidence-tiered folder organization in KMZ** — low complexity, add when UI is polished
- [ ] **Region version / provenance tracking** — once corpus grows beyond a handful of entries

### Future Consideration (v2+)

- [ ] **Historical cross-route calibration** — requires multi-route session context
- [ ] **Region coverage gap visualization** — significant complexity; defer until corpus is large enough to need it
- [ ] **Per-edge line color by confidence** — requires per-segment KML restructure; high implementation cost for moderate gain

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Span residual per edge | HIGH | LOW | P1 |
| Aggregate route RMSE | HIGH | LOW | P1 |
| Per-post confidence tier | HIGH | MEDIUM | P1 |
| CI gate (pass/fail/partial) | HIGH | LOW | P1 |
| Named failure modes (machine-readable) | HIGH | LOW | P1 |
| Actionable UI failure messages | HIGH | LOW | P1 |
| Hard stop for unrecoverable failures | HIGH | MEDIUM | P1 |
| Per-placemark icon color (confidence) | HIGH | LOW | P1 |
| ExtendedData per post | MEDIUM | LOW | P1 |
| Confidence tier label in name/description | MEDIUM | LOW | P1 |
| Region ingest validation | HIGH | MEDIUM | P1 |
| Region list UI | MEDIUM | LOW | P1 |
| Structured diagnostic sidecar download | MEDIUM | MEDIUM | P2 |
| Failure cascade detection | MEDIUM | MEDIUM | P2 |
| Confidence-tiered KMZ folders | LOW | LOW | P2 |
| Per-edge line color by confidence | MEDIUM | HIGH | P3 |
| Region coverage gap visualization | LOW | HIGH | P3 |
| Historical cross-route calibration | MEDIUM | HIGH | P3 |

**Priority key:**
- P1: Must have for v1.1 launch
- P2: Add after v1.1 core is validated
- P3: Future milestone consideration

---

## Sources

- [KML Reference — Google Developers](https://developers.google.com/kml/documentation/kmlreference) — verified per-Placemark style override, color format (AABBGGRR), inline vs shared style precedence
- [KML ExtendedData — Google Developers](https://developers.google.com/kml/documentation/extendeddata) — verified Data/SchemaData techniques for custom metadata per feature
- [Pix4D Reprojection Error](https://support.pix4d.com/hc/en-us/articles/202559369) — benchmark: reprojection error ≤ 1 pixel = good quality; per-tie-point flagging model
- [Georeferencing RMSE — Digital Geography](https://digital-geography.com/rmse/) — RMSE as internal-consistency signal; caveat: low RMSE can coexist with wrong anchor
- [Geometry Consistency Confidence for Feature Matching — ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0262885620301165) — per-edge geometric consistency scoring
- [Miscalibrated AI Confidence — arxiv:2402.07632](https://arxiv.org/html/2402.07632v4) — empirical: confidently-wrong outputs destroy user trust and it does not recover; basis for anti-feature on false-precision numeric confidence
- [RBush spatial index — mourner/rbush](https://github.com/mourner/rbush) — confirmed GPS lat/lon bbox query support; already used in region-pairing.js
- [SHRUG-FM Reliability-Aware Earth Observation — arxiv:2511.10370](https://arxiv.org/pdf/2511.10370) — flagging/abstaining on low-confidence geospatial predictions
- Existing codebase: `parser/dwg/coordinate-calculator-dwg.js` (existing warning taxonomy), `parser/dwg/region-library.js` (IndexedDB + bbox ingest), `parser/dwg/region-pairing.js` (RBush), `parser/dwg/graph-walker.js` (span-tolerance logic)

---

*Feature research for: v1.1 Generalized DXF-Driven Accuracy*
*Researched: 2026-06-05*
