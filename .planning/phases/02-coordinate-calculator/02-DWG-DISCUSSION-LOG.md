# Phase 2 DWG Iteration — Discussion Log

**Date:** 2026-05-27
**Mode:** discuss (default)
**Areas covered:** 4/4

---

## User question that triggered the discussion

> "I want to discuss the possibility of using a DWG base. My idea: we get which posts are in the project, map their positions, then we use the DWG to find those posts and draw the KMZ above that. The DWG is geographically referenced, the posts are in the same position as real life, but I don't know exactly how to get their coordinates out of AutoCAD — is that possible?"

**Direct answer given:** Yes, three practical paths: (1) export DWG → DXF and parse in-browser; (2) parse raw DWG with a JS lib (heavier, less coverage of 2018+); (3) AutoCAD LISP script that pre-exports a CSV. DXF is the practical client-side answer.

---

## Area 1 — DWG's role vs PDF pipeline

### Q1: How often will you actually have a DWG to work with?
- Options: Always / Usually / Sometimes / Rarely
- **User answer (freeform):** *"I'm going to make big DWGs for regions, like cities. We would have to search which has the information at the coordinates the user submits. Is that possible?"*
- **Reframing accepted:** Big regional/city DWGs maintained by user, indexed by bbox, looked up by user GPS.

### Q2: Where do these regional DWGs live, and who can access them?
- Options: Server-backed / User-supplied per-job / Bundled static / **Per-user IndexedDB cache**
- **User answer:** Per-user uploaded library cached in browser (IndexedDB).
- Locked: D-DWG-STORAGE-01 (no backend, preserves client-side-only constraint).

### Q3: When a regional DWG covers the user's GPS, what role does it play vs the current PDF pipeline?
- Options: **DWG authoritative** / DWG anchors + PDF interpolates / DWG validates + PDF computes / User picks per project
- **User answer:** DWG is authoritative for all post coordinates.
- Locked: D-DWG-ROLE-01 (DWG bypass for GPS step), D-DWG-FALLBACK-01 (PDF pipeline is the fallback).

---

## Area 2 — Ingestion format (DWG / DXF / CSV)

### Q1: What format will the user upload to the library?
- Options: **DXF (recommended)** / raw DWG / pre-processed JSON / multiple formats
- **User answer:** DXF — user exports from AutoCAD once.
- Locked: D-DWG-FMT-01 (DXF only).

### Q2: Are the DWG/DXF entities drawn directly in UTM meters (SIRGAS-2000), or in some local CRS?
- Options: UTM SIRGAS-2000 directly / WGS84 lat/lon / Local CRS + georef transform / **Not sure — verify on siriu.dwg**
- **User answer:** Not sure — flag for researcher.
- Captured as: R-DWG-01 (open research question, default assumption UTM SIRGAS-2000 zone 22S until verified).

---

## Area 3 — Post identification inside the DWG

### Q1: In the DWG, how are posts identified?
- Options: Block INSERT + tag attribute / **Points/symbols on a dedicated layer (no per-post identity)** / TEXT label nearby / Not sure
- **User answer:** Points/symbols on a dedicated layer with no embedded post number.
- Locked: D-DWG-POST-01 (identity comes from spatial pairing to PDF, not DWG attributes).

### Q2: Is the fiber cable route drawn in the DWG too?
- Options: Yes on dedicated layer / Yes but same layer as posts / No / Not sure
- **User answer (freeform):** *"The `Cabo Projetado` layer does not exist [in the DWG], but there is a `TrechoSecundarioAereo` cable that goes on the majority of posts linking them, but this won't have the gaps/bifurcations of `Cabo Projetado`, so we need to match that."*
- Key insight captured: DWG cable ≠ PDF projected cable. DWG cable is the physical city-wide secondary aerial (topological hint only).
- Locked: D-DWG-CABLE-01 (TrechoSecundarioAereo is a hint for pairing, not a substitute for PDF routing).

---

## Area 4 — PDF ↔ DWG correspondence

### Q1: How should the pairing algorithm behave when PDF ↔ DWG don't match perfectly?
- Options: **Strict (fail loud on miss)** / Best-effort / Anchor-only / Interactive
- **User answer:** Strict — every PDF post must find a DWG match within tolerance, else fall back to PDF pipeline.
- Locked: D-DWG-PAIR-01 (strict pairing), D-DWG-FAIL-01 (structured warning + transparent fallback).

---

## Claude's Discretion (deferred to research/planning)

- Pairing tolerance value (start ~15 m, tune on siriu.dwg ground truth) — D-DWG-PAIR-03.
- DXF parser library choice (`dxf-parser`, `@dxfjs/parser`, hand-rolled) — R-DWG-04.
- IndexedDB cache schema: raw DXF blob, parsed structure, or both — R-DWG-05.
- Spatial index implementation (rbush, kd-tree, flat) — R-DWG-06.
- Gap-window tolerance widening — D-DWG-PAIR-05.

---

## Deferred Ideas (not in this iteration)

- Multi-region DWGs per project (route spans 2+ regional DWGs).
- Server-hosted DWG library (would break client-side-only constraint).
- Auto-detect UTM zone from bbox.
- Hybrid DWG-anchors + PDF-interpolation mode (kept as future fall-back-within-fall-back).
- Interactive pairing UI (belongs in Phase 04).
- Coordinate support beyond Brazil (multi-zone, other datums).

---

## Open Research Questions (block planning until resolved)

| ID | Question | Verification path |
|----|----------|-------------------|
| R-DWG-01 | What coordinate system does `siriu.dwg` use? | Convert to DXF; inspect `$INSUNITS`, AcDbGeoData; sample entity (X,Y) vs ground truth UTM. |
| R-DWG-02 | Exact layer name and entity type for posts? | Enumerate DXF layers; match entity counts to known region post count. |
| R-DWG-03 | Confirm `TrechoSecundarioAereo` layer name + geometry type. | DXF layer listing. |
| R-DWG-04 | Best DXF parser library for browser (AC1032 support, bundle size). | Benchmark candidates. |
| R-DWG-05 | IndexedDB caching strategy: raw DXF / parsed / both. | Measure parse cost and storage size. |
| R-DWG-06 | Spatial index choice for nearest-neighbour pairing inside a region. | Pick library; benchmark on Siriu post count. |
