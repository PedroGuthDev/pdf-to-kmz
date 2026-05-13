# Requirements: PDF to KMZ Converter

**Defined:** 2026-05-12
**Core Value:** Accurately extract post data from INFOVIAS PDF files and produce a georeferenced KMZ file

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### PDF Parsing

- [ ] **PDF-01**: Tool can parse INFOVIAS-format PDF files in-browser
- [ ] **PDF-02**: Tool extracts post/pole identifiers and types from PDF text layer
- [ ] **PDF-03**: Tool extracts inter-post distances (e.g., "34,3", "37,8") from PDF text
- [ ] **PDF-04**: Tool extracts post x,y drawing positions from PDF to determine spatial layout
- [ ] **PDF-05**: Tool handles PDF text encoding issues (special characters like ç, ã)

### Coordinate Calculation

- [ ] **COORD-01**: User can input GPS coordinates (latitude, longitude) for the first post
- [ ] **COORD-02**: Tool calculates bearing between posts using PDF x,y drawing positions
- [ ] **COORD-03**: Tool calculates GPS coordinates for all posts using distances and bearings
- [ ] **COORD-04**: Tool handles branching routes (posts forking to multiple paths)
- [ ] **COORD-05**: Tool handles route gaps (posts that stop and start on a different section)

### KMZ Generation

- [ ] **KMZ-01**: Tool generates valid KML content with placemarks for each post
- [ ] **KMZ-02**: Each placemark is labeled "Poste (number)"
- [ ] **KMZ-03**: Tool generates lines connecting consecutive posts in the route
- [ ] **KMZ-04**: Tool packages KML into a downloadable KMZ (zipped KML) file
- [ ] **KMZ-05**: Generated KMZ opens correctly in Google Earth

### Customization

- [ ] **CUST-01**: User can customize post icon style (color, shape, size)
- [ ] **CUST-02**: User can customize connection line color and thickness
- [ ] **CUST-03**: User can customize label size and color

### User Interface

- [ ] **UI-01**: Single-page web interface with PDF file upload input
- [ ] **UI-02**: User sees a download button/link for the generated KMZ file
- [ ] **UI-03**: User can input first post GPS coordinates before generation
- [ ] **UI-04**: User can access customization options for KMZ appearance
- [ ] **UI-05**: Tool shows progress/feedback during PDF processing

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Multi-format

- **MULTI-01**: Support additional PDF template formats from other ISPs
- **MULTI-02**: Auto-detect PDF format and apply appropriate parser

### Enhanced Output

- **ENH-01**: Preview posts on an interactive map before downloading KMZ
- **ENH-02**: Include cable specification data in KMZ placemarks
- **ENH-03**: Include pole type information in placemark descriptions

## Out of Scope

| Feature | Reason |
|---------|--------|
| Server-side processing | Personal tool, client-side is simpler |
| User accounts | No need for data persistence |
| Mobile app | Web browser on desktop is sufficient |
| Post editing in-app | Use Google Earth for post-generation adjustments |
| Multiple PDF format support | Single format for v1, expand later |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| PDF-01 | Phase 1 | Pending |
| PDF-02 | Phase 1 | Pending |
| PDF-03 | Phase 1 | Pending |
| PDF-04 | Phase 1 | Pending |
| PDF-05 | Phase 1 | Pending |
| COORD-01 | Phase 2 | Pending |
| COORD-02 | Phase 2 | Pending |
| COORD-03 | Phase 2 | Pending |
| COORD-04 | Phase 2 | Pending |
| COORD-05 | Phase 2 | Pending |
| KMZ-01 | Phase 3 | Pending |
| KMZ-02 | Phase 3 | Pending |
| KMZ-03 | Phase 3 | Pending |
| KMZ-04 | Phase 3 | Pending |
| KMZ-05 | Phase 3 | Pending |
| CUST-01 | Phase 3 | Pending |
| CUST-02 | Phase 3 | Pending |
| CUST-03 | Phase 3 | Pending |
| UI-01 | Phase 4 | Pending |
| UI-02 | Phase 4 | Pending |
| UI-03 | Phase 4 | Pending |
| UI-04 | Phase 4 | Pending |
| UI-05 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 23 total
- Mapped to phases: 23
- Unmapped: 0 ✓

---
*Requirements defined: 2026-05-12*
*Last updated: 2026-05-12 after initial definition*
