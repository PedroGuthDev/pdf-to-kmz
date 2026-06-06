# Phase 06: DXF Ingestion & Region Lookup - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-06
**Phase:** 06-dxf-ingestion-region-lookup
**Areas discussed:** Unit mismatch detection, Ingest performance arch, No-region error format, CRS confidence field

---

## Unit mismatch detection

| Option | Description | Selected |
|--------|-------------|----------|
| Coordinate-range only | Check extmax.x against zone-22S UTM envelope; never reads $INSUNITS. Consistent with existing "DO NOT scale $INSUNITS" principle. | ✓ |
| Try $INSUNITS first, then range fallback | Read DXF header $INSUNITS; fall back to coordinate range. Revisits Phase 2 decision to ignore $INSUNITS. | |
| Range check + $INSUNITS as confirming signal | Coordinate range is primary; $INSUNITS only affects CRS confidence level. | |

**User's choice:** Coordinate-range only

---

| Option | Description | Selected |
|--------|-------------|----------|
| Fail loud: "DXF unit mismatch suspected" | Surface DXF-02 exact error. Matches SC-2 verbatim. | ✓ |
| Fail loud with both sub-reasons | Surface two reasons: out-of-envelope + retry also failed. More diagnostic context. | |
| Accept with confidence: 'low' | Store with low confidence. Conflicts with fail-loud principle. | |

**User's choice:** Fail loud: "DXF unit mismatch suspected" (after ÷1000 retry also fails zone-22S envelope)

---

| Option | Description | Selected |
|--------|-------------|----------|
| Keep in addRegion() | Strangler-fig: extend existing code, no new module. | ✓ |
| New dxf-ingestion.js module | Separate parsing+validation from storage. More testable but adds file+import chain. | |

**User's choice:** Keep validation in addRegion()

---

## Ingest performance arch

| Option | Description | Selected |
|--------|-------------|----------|
| Web Worker for parsing + indexing | Off-thread parseDxfText() + buildPostIndex(). Main thread stays responsive. No new deps. | ✓ |
| Synchronous, just measure | Parse on main thread, verify <5s via timing test. Tab freezes during ingest. | |
| Synchronous with yield (chunked) | Yield every N entities via setTimeout(0). More complex than Worker. | |

**User's choice:** Web Worker for parsing + indexing

---

| Option | Description | Selected |
|--------|-------------|----------|
| Worker receives DXF text, returns structured result | postMessage dxfText → worker parses + indexes → returns { posts, cableEdges, rbushDump, extmin, extmax }. Main thread handles storage. | ✓ |
| Worker handles full ingest including IndexedDB | Worker does parse + index + db.put(). More complex. | |

**User's choice:** Worker receives DXF text, returns structured result

---

| Option | Description | Selected |
|--------|-------------|----------|
| Node.js timing test is sufficient | Node.js test with actual Palhoça.dxf gives reliable timing signal. No Playwright deps. | ✓ |
| Browser integration test (Playwright/puppeteer) | More accurate for Worker overhead but adds deps (contradicts no-new-deps constraint). | |

**User's choice:** Node.js timing test is sufficient

---

## No-region error format

| Option | Description | Selected |
|--------|-------------|----------|
| Structured JS error object | { code: 'NO_REGION', nearest: { name, distanceKm } }. Phase 9 renders in Portuguese. | ✓ |
| Portuguese message now | "Nenhuma região encontrada. Região mais próxima: [nome] (~X km)". May be redone in Phase 9. | |
| Throw a typed Error | throw new RegionLookupError({ code, nearest }). Typed class. | |

**User's choice:** Structured JS error object

---

| Option | Description | Selected |
|--------|-------------|----------|
| Haversine to bbox centroid | Compute centroid from bboxLatLon, haversine to query GPS. Reuses in-house haversine. Simple and correct. | ✓ |
| Minimum distance to bbox edge | Closest point on bbox rectangle to query GPS. More precise for large regions, more complex. | |
| Haversine to bbox corners, take minimum | Haversine to 4 corners, take min. Approximation between centroid and edge. | |

**User's choice:** Haversine from GPS anchor to nearest bbox centroid

---

## CRS confidence field

| Option | Description | Selected |
|--------|-------------|----------|
| 'high' / 'low' / 'inferred' | high = native zone-22S. low = mm→m retry accepted. inferred = no extmin/extmax. | ✓ |
| 'high' only | If ingest succeeds, always 'high'. Fail loud for all others. Simpler. | |
| 'high' / 'assumed' | high = validated. assumed = no envelope data. Two states only. | |

**User's choice:** 'high' / 'low' / 'inferred'

---

| Option | Description | Selected |
|--------|-------------|----------|
| Check only extmin/extmax bbox corners at ingest | Validate bboxLatLon against Brazil bbox. Fast — only 2 point conversions. | ✓ |
| Check every post UTM→WGS84 at ingest | Comprehensive but too slow for 60k posts (conflicts with 5s budget). | |
| Check bbox corners + spot-check 100 random posts | Balanced but more complex. | |

**User's choice:** Check only extmin/extmax bbox corners at ingest time

---

## Claude's Discretion

- Exact zone-22S UTM envelope constants (min/max E and N) — planner derives from Siriu extents with generous margin
- Whether `confidence: 'low'` path is reachable in practice (planner may assert it never stores given D-02)
- Additional fields on the `NO_REGION` error object beyond `code`, `nearest.name`, `nearest.distanceKm`
- Minimal UI change for DXF-07 to surface `bboxLatLon` per SC-5

## Deferred Ideas

- Multi-zone CRS auto-detection (UTM 21S/23S) → MZONE-01 backlog
- Per-post UTM validation (all 60k posts) → too slow for Phase 6
- Portuguese error message rendering for DXF-05 → Phase 9 / CONF-01
- Active cascade demotion on no-region → Phase 7/8
- Interactive region bbox map preview → ENH-01 backlog
