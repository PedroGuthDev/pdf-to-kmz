# Research Summary: PDF to KMZ Converter

## Stack Decision

| Component | Choice | Confidence |
|-----------|--------|------------|
| PDF Parsing | **pdf.js** (pdfjs-dist) via CDN | HIGH |
| KML Generation | **Template strings** (no library) | HIGH |
| KMZ Packaging | **JSZip** 3.10.x via CDN | HIGH |
| Coordinate Math | **Custom** haversine destination formula | HIGH |
| File Download | **Native** Blob API | HIGH |
| UI | **Vanilla** HTML/CSS/JS | HIGH |

**Total external dependencies: 2** (pdf.js + JSZip) — both via CDN, no build step needed.

## Key Findings

### What Works Well
- pdf.js provides text positions via `transform[4,5]` — exactly what we need for bearing inference
- KML format is simple XML — template strings are sufficient
- JSZip is the proven standard for client-side ZIP creation
- Haversine destination formula is 10 lines of code

### Critical Risks (from Pitfalls)
1. **PDF text grouping** — text items may be fragmented; needs proximity-based merging
2. **Distance-to-post association** — distances float as labels; must infer which posts they connect
3. **Multi-page continuity** — posts repeat at page boundaries; deduplicate by ID
4. **PDF Y-axis inversion** — must flip for correct bearings

### Architecture
- 6 sequential components: PDF Parser → Data Extractor → Coordinate Calculator → KML Builder → KMZ Packager → Download Handler
- Clean data pipeline: each component transforms data and passes it forward
- No state management needed — single-pass processing

## Impact on Requirements
- No requirements changes needed — research confirms all v1 requirements are feasible
- The stack is lightweight (2 CDN dependencies + vanilla JS) — no build tool needed
- Research confirmed that PDF x,y positions CAN be used for bearing inference

## Impact on Roadmap
- Phase 1 (PDF Parser) is the highest-risk phase due to text grouping and distance association challenges
- Phase 2 (Coordinates) has well-established math — lower risk
- Phase 3 (KMZ) is straightforward — KML is simple XML
- Phase 4 (UI) is standard web dev — lowest risk

**Recommendation:** Spend extra time on Phase 1 testing with the real PDF to validate extraction accuracy before proceeding.

---
*Synthesized: 2026-05-12*
