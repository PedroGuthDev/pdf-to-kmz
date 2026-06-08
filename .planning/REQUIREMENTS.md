# Requirements: PDF to KMZ Converter — Milestone v1.1 (Generalized DXF-Driven Accuracy)

**Defined:** 2026-06-05
**Core Value:** Produce a georeferenced KMZ that is *trustworthy across many different drawings* — anchored to the DXF, gated by truth-free residuals, and failing loud rather than silently wrong.

Continues REQ-ID numbering from v1.0 (new categories: ACC, DXF, SOLVE, CONF).

## v1.1 Requirements

### Accuracy Gate — truth-free residual (ACC) → Phase 5

- [ ] **ACC-01**: System computes a **shape-fidelity** residual per labelled edge (`|haversine(A,B) − printed_distance|`) and aggregates it per route — no GPS ground truth required.
- [x] **ACC-02**: System computes an **absolute-anchor** residual (first-post computed GPS vs the known reference anchor).
- [x] **ACC-03**: A route is rated HIGH only when **both** sub-scores pass; either failing alone downgrades or fails it. The LC posts-21–31 rigid-offset (≈179 m off, ~9.6 m shape residual) is a regression fixture that **must fail** the gate.
- [x] **ACC-04**: The residual gate runs as a CI gate over the existing validated routes, with thresholds calibrated against the Siriu baseline before they are locked.
- [ ] **ACC-05**: A per-post confidence **tier** (HIGH/MED/LOW/UNRESOLVABLE) is derived from the residuals (consumed by CONF-*).

### DXF Ingestion & Region Lookup (DXF) → Phase 6

- [x] **DXF-01**: User can ingest a DXF into the region library; the system resolves its coordinate system (UTM zone-22S / SIRGAS-2000) at ingest time.
- [x] **DXF-02**: Ingestion validates units (mm→m retry) and **fails loud** on out-of-envelope drawings ("DXF unit mismatch suspected").
- [x] **DXF-03**: Every UTM→WGS84 conversion is validated inside Brazil's bounding box; out-of-range **fails loud** (never confidently-wrong GPS).
- [x] **DXF-04**: Regions are indexed by GPS bounding box; lookup by the first post's GPS returns the covering region.
- [x] **DXF-05**: When no region covers the GPS, the system **fails loud** with a nearest-region hint + distance — never a silent wrong-region match.
- [x] **DXF-06**: Large DXFs (e.g. Palhoça ~60k INSERTs) ingest within an acceptable budget (~5 s target) via spatial indexing.
- [x] **DXF-07**: User can list the ingested regions in the library.

### Solver Prerequisites (SOLVE-05) → Phase 7

- [ ] **SOLVE-05**: Solver prerequisites are satisfied and gated: per-post position fixtures green for Siriu, LC, **João Born, and Valmor**; junction ground-truth green; and every existing gate audited and classified fence-vs-accuracy.

### Global PDF↔DXF Solver (SOLVE) → Phase 8

- [x] **SOLVE-01**: System aligns the PDF's numbered, distance-labeled route graph to the DXF cable graph via a **global bipartite assignment** (Hungarian), with no per-route tuning.
- [ ] **SOLVE-02**: The solver runs as cascade **level-0**; when its residual confidence is low it falls back to the existing graph-walker (strangler-fig).
- [ ] **SOLVE-03**: The solver enforces anchor as a hard constraint, arc-order monotonicity, and hub-degree matching, with thresholds adaptive to each drawing's scale.
- [ ] **SOLVE-04**: The solver re-clears Siriu (85-post regression + per-post position gate) and the LC per-post position gate with **zero regression**.

### Diagnostic Failure & Confidence Surfacing (CONF) → Phase 9

- [ ] **CONF-01**: Failures surface a clear, actionable reason (no region / unit mismatch / "diverged at post N, residual X m") in the UI, consistent with the existing Portuguese warning taxonomy.
- [ ] **CONF-02**: The generated KMZ encodes per-post confidence **tier** via placemark color + ExtendedData.
- [ ] **CONF-03**: On partial success, the system emits the resolvable posts and **flags** low-confidence ones, rather than failing silently or emitting confidently-wrong coordinates.
- [ ] **CONF-04**: Confidence is shown as **tier labels only** — never a numeric percentage "quality seal".

## Future Requirements (deferred)

- **MZONE-01**: Auto-detect and support UTM zones beyond 22S (21S/23S) — v1.1 is zone-22S + fail-loud.
- **MULTI-01**: Other-ISP / other-vendor DXF template formats.
- **ENH-01**: Interactive map preview of posts (with confidence tiers) before download.
- **ENH-02**: Cable-specification data in KMZ placemarks.

## Out of Scope (v1.1)

| Excluded | Reason |
|----------|--------|
| PDF-only accuracy path | Proven too brittle/inaccurate to generalize; demoted to acceptable-failure (no DXF → fail loud) |
| Multi-zone CRS auto-detection | v1.1 targets zone-22S (southern SC); out-of-zone is handled by fail-loud, not silent guessing |
| Fuzzy / nearest-region auto-match | A GPS outside every region bbox almost certainly means the wrong DXF — matching it would be confidently wrong |
| Server-side processing | Stays client-side (Vercel Blob API is DXF storage only) |
| New external deps beyond `munkres` | Reuse in-house Snyder TM, rbush, pure-math residuals (see research) |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| ACC-01 | Phase 5 | Pending |
| ACC-02 | Phase 5 | Complete |
| ACC-03 | Phase 5 | Complete |
| ACC-04 | Phase 5 | Complete |
| ACC-05 | Phase 5 | Pending |
| DXF-01 | Phase 6 | Complete |
| DXF-02 | Phase 6 | Complete |
| DXF-03 | Phase 6 | Complete |
| DXF-04 | Phase 6 | Complete |
| DXF-05 | Phase 6 | Complete |
| DXF-06 | Phase 6 | Complete |
| DXF-07 | Phase 6 | Complete |
| SOLVE-05 | Phase 7 | Pending |
| SOLVE-01 | Phase 8 | Complete |
| SOLVE-02 | Phase 8 | Pending |
| SOLVE-03 | Phase 8 | Pending |
| SOLVE-04 | Phase 8 | Pending |
| CONF-01 | Phase 9 | Pending |
| CONF-02 | Phase 9 | Pending |
| CONF-03 | Phase 9 | Pending |
| CONF-04 | Phase 9 | Pending |

**Coverage:** 21/21 v1.1 requirements mapped across 5 phases (P5–P9). No orphans.

---

_Requirements defined 2026-06-05 from converged v1.1 research (see `.planning/research/SUMMARY.md`)._
_Traceability finalized 2026-06-05 by roadmapper (SOLVE-05 extracted to Phase 7 prerequisites; SOLVE-01..04 in Phase 8)._
