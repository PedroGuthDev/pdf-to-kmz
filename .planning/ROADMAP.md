# Roadmap: PDF to KMZ Converter

**Created:** 2026-05-12
**Milestone:** v1.0 — Working PDF to KMZ converter
**Phases:** 4
**Mode:** mvp

---

## Current Phase: Phase 2

---

### Phase 1: PDF Parser Engine ✓ COMPLETE — 2026-05-15

**Goal:** Build the core PDF parsing engine that extracts post data (IDs, types, distances, positions) from INFOVIAS-format PDFs in the browser
**Mode:** mvp
**Plans:** 4/4 complete

Plans:

- [x] 01-01-PLAN.md — Walking Skeleton: prove OCG layer extraction on real PDF, resolve A1/A2 assumptions
- [x] 01-02-PLAN.md — Parser modules: all 8 parser/ modules implementing the full PDF extraction pipeline
- [x] 01-03-PLAN.md — Browser UI: index.html wiring file input to parsePdf() with result summary display
- [x] 01-04-PLAN.md — OCR rewrite: replace broken text-proximity with Tesseract.js OCR for post numbers ✓ 2026-05-14

**Success Criteria**:

1. PDF file can be loaded and parsed in-browser using pdf.js
2. Post sequential numbers (01, 02, 03...) are correctly extracted via OCR (Tesseract.js)
3. Inter-post distances are extracted from Distância_Poste layer
4. Post x,y drawing positions are extracted from layer "0" circle centroids
5. Cable route geometry is extracted from Cabo Projetado layer
6. parsePdf() returns the SKELETON.md output contract on the real sample PDF

**Requirements:** PDF-01, PDF-02, PDF-03, PDF-04

---

### Phase 2: Coordinate Calculator

**Goal:** Implement GPS coordinate calculation from a user-provided starting point, using per-page UTM-grid calibration from PDF layout
**Mode:** mvp
**Plans:** 13 plans (02-01/02-02 obsolete; 02-03 through 02-07 shipped/planned; 02-08 through 02-13 DWG iteration)

Plans:

- [x] 02-01-PLAN.md — OBSOLETE (sequential GPS chaining — replaced)
- [x] 02-02-PLAN.md — OBSOLETE (sequential GPS chaining — replaced)
- [x] 02-03-PLAN.md — UTM calibration foundation: utm-calibrator.js module, layer-sources.js extensions, pdf-parser.js pipeline extension
- [x] 02-04-PLAN.md — Coordinate calculation rewrite: calculateCoordinates() UTM projection, detectGaps() page filter, index.html wiring ✓ 2026-05-15
- [x] 02-05-PLAN.md — Accuracy fix: Poste-symbol PDF positions + cable-aware match; Palhoça 11/11 < 5 m ✓ 2026-05-18
- [ ] 02-06-PLAN.md — N1+Viterbi-HMM accuracy iteration: Viterbi symbol assignment, N1 default-on, 60 pt cable-proximity, Valmor p4 fixture (D-V-*, D-SYM-*, D-N1-*, D-N2-01)
- [ ] 02-07-PLAN.md — Posts 9-11 under 10m: diagnose refineAnchorPageByDownstreamChord silent failure + split-region calibration (D-P911-01..12)

**DWG iteration (02-08 through 02-13):**

**Wave 1**
- [ ] 02-08-PLAN.md — npm install (dxf-parser, idb, rbush, fake-indexeddb) + test fixture generation (siriu-ground-truth.json, siriu-subset.json)

**Wave 2** *(depends on 02-08)*
- [ ] 02-09-PLAN.md — DWG core modules: parser/dwg/dxf-loader.js + parser/dwg/region-pairing.js (strict pairing algorithm, rbush spatial index, adjacency graph)

**Wave 3** *(depends on 02-09)*
- [ ] 02-10-PLAN.md — DWG orchestration: parser/dwg/region-library.js (IndexedDB CRUD) + parser/dwg/coordinate-calculator-dwg.js (calculateCoordinatesWithDwg wrapper)
- [ ] 02-11-PLAN.md — Unit tests: parser/__tests__/region-pairing.test.mjs (7+ tests, siriu-subset.json fixture)

**Wave 4** *(depends on 02-10 + 02-11)*
- [ ] 02-12-PLAN.md — G-3 validation harness: debug-run-calc-dwg.mjs (30/30 siriu posts, max <= 6m)
- [ ] 02-13-PLAN.md — Minimal UI affordance: "Carregar região DXF" button + calculateCoordinatesWithDwg wiring in index.html (has human checkpoint)

**Success Criteria**:

1. User can input latitude/longitude for the first post
2. Bearings between consecutive posts are calculated from PDF x,y positions
3. GPS coordinates are calculated for all posts using per-page UTM-grid calibration (not sequential chaining)
4. Branching routes produce correct coordinates on each branch
5. Route gaps are handled (disconnected segments get correct positions)
6. (DWG path) When a regional DXF is loaded, GPS coordinates are derived from DWG INSERT positions (max error <= DWG drafting precision, ~6m for siriu.dxf)
7. (DWG path) PDF-only fallback fires transparently when no DWG region covers the user's GPS

**Requirements:** COORD-01, COORD-02, COORD-03, COORD-04, COORD-05

---

### Phase 3: KMZ Generator with Customization

**Goal:** Generate downloadable KMZ files with customizable placemarks and connection lines
**Mode:** mvp
**Success Criteria**:

1. Valid KML is generated with one placemark per post, labeled "Poste N"
2. Lines connect consecutive posts along each route segment
3. KML is packaged into a downloadable .kmz file (ZIP format)
4. User can customize post icon (color, shape, size)
5. User can customize line color and thickness
6. User can customize label size and color
7. Generated KMZ opens correctly in Google Earth

**Requirements:** KMZ-01, KMZ-02, KMZ-03, KMZ-04, KMZ-05, CUST-01, CUST-02, CUST-03

---

### Phase 4: Web UI & Integration

**Goal:** Build the single-page web interface that ties PDF upload, coordinate input, customization, and KMZ download into a polished user experience
**Mode:** mvp
**UI hint**: yes
**Plans:** 0/3 complete (planned 2026-05-26)

Plans:

**Wave 1**
- [ ] 04-01-PLAN.md — Upload zone, drag-and-drop, staged parse progress, session reset (UI-01, UI-05)

**Wave 2** *(blocked on Wave 1 completion)*
- [ ] 04-02-PLAN.md — Appearance panel, second-anchor expander, mergeOptions wiring (UI-03, UI-04, CUST-01–03)

**Wave 3** *(blocked on Wave 2 completion)*
- [ ] 04-03-PLAN.md — KMZ filename, copy pass, developer-tools toggle, human UAT (UI-02)

**Success Criteria**:

1. User can upload a PDF file via drag-and-drop or file picker
2. User can input first post GPS coordinates
3. User can adjust KMZ appearance settings (icons, lines, labels)
4. User can download the generated KMZ with one click
5. Progress/feedback is shown during processing
6. Interface is clean, single-page, and works in modern browsers

**Requirements:** UI-01, UI-02, UI-03, UI-04, UI-05

---

## Phase Dependencies

```
Phase 1 (PDF Parser) → Phase 2 (Coordinates) → Phase 3 (KMZ Gen) → Phase 4 (UI)
```

All phases are sequential — each depends on the previous phase's output.

---

_Roadmap created: 2026-05-12_
_Last updated: 2026-05-27 — DWG iteration plans 02-08 through 02-13 added_
