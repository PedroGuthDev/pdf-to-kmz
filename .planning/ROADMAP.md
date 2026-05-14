# Roadmap: PDF to KMZ Converter

**Created:** 2026-05-12
**Milestone:** v1.0 — Working PDF to KMZ converter
**Phases:** 4
**Mode:** mvp

---

## Current Phase: Phase 1

---

### Phase 1: PDF Parser Engine

**Goal:** Build the core PDF parsing engine that extracts post data (IDs, types, distances, positions) from INFOVIAS-format PDFs in the browser
**Mode:** mvp
**Plans:** 3 plans

Plans:
- [x] 01-01-PLAN.md — Walking Skeleton: prove OCG layer extraction on real PDF, resolve A1/A2 assumptions
- [ ] 01-02-PLAN.md — Parser modules: all 8 parser/ modules implementing the full PDF extraction pipeline
- [ ] 01-03-PLAN.md — Browser UI: index.html wiring file input to parsePdf() with result summary display

**Success Criteria**:

1. PDF file can be loaded and parsed in-browser using pdf.js
2. Post sequential numbers (01, 02, 03...) are correctly extracted from TEXTO layer
3. Inter-post distances are extracted from Distância_Poste layer
4. Post x,y drawing positions are extracted from Numero_Poste layer circles
5. Cable route geometry is extracted from Cabo Projetado layer
6. parsePdf() returns the SKELETON.md output contract on the real sample PDF

**Requirements:** PDF-01, PDF-02, PDF-03, PDF-04

---

### Phase 2: Coordinate Calculator

**Goal:** Implement GPS coordinate calculation from a user-provided starting point, using extracted distances and inferred bearings from PDF layout
**Mode:** mvp
**Success Criteria**:

1. User can input latitude/longitude for the first post
2. Bearings between consecutive posts are calculated from PDF x,y positions
3. GPS coordinates are calculated for all posts using distance + bearing
4. Branching routes produce correct coordinates on each branch
5. Route gaps are handled (disconnected segments get correct positions)

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
_Last updated: 2026-05-13 after adding Plans 01-02 and 01-03_
