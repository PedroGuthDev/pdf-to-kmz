# PDF to KMZ Converter

## Current State

**Shipped:** v1.0 — Working PDF → KMZ Converter (2026-06-05). Full client-side pipeline
delivered: INFOVIAS PDF → OCR + layout extraction → per-post GPS via UTM-grid calibration
(plus an optional DWG/DXF region-pairing graph-walk path) → customizable KMZ for Google
Earth. Proven end-to-end on multiple real routes (Siriu DWG 85 posts, Valmor, João Born,
Luiz Carolino) with regression gates. See `.planning/milestones/v1.0-ROADMAP.md`.

**Next milestone:** v1.1 — **Cross-PDF Compatibility.** The system today is calibrated
against a handful of routes; the goal of v1.1 is to make it work reliably across many
different PDFs. This explicitly reopens v1.0's "single format only" scope decision.

**Next Milestone Goals (v1.1):**
1. Generalize parsing/coordinate extraction across varied INFOVIAS (and other-ISP) PDF layouts.
2. Robustness over per-route hand-calibration — replace brittle route-specific tuning with
   geometry/topology predicates that hold across PDFs.
3. Carry-forward accuracy debt where it blocks generalization (LC post-positioning rework,
   per-sheet UTM georef offsets) — see STATE.md → Deferred Items.

<details>
<summary>v1.0 original brief (archived)</summary>

## What This Is

A single-page web application that converts fiber optic infrastructure PDF project files (INFOVIAS/FTTH format) into KMZ files for Google Earth. Users upload a PDF, provide the GPS coordinates of the first post, and the tool extracts post positions, calculates remaining coordinates using inter-post distances, and generates a downloadable KMZ with customizable placemarks and connection lines.

## Core Value

Accurately extract post data from INFOVIAS PDF files and produce a georeferenced KMZ file where posts are placed at correct relative positions with lines connecting them.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- ✓ Parse INFOVIAS-format PDFs to extract post IDs and inter-post distances — Phase 1
- ✓ Infer post-to-post bearing from PDF x,y drawing positions — Phase 1 (positions extracted; bearing calc is Phase 2)

### Active

<!-- Current scope. Building toward these. -->

- [ ] Accept user-provided GPS coordinates for the first post
- [ ] Calculate GPS coordinates for all remaining posts using distances and PDF layout bearings
- [ ] Handle branching routes (forks to multiple paths)
- [ ] Handle route gaps (posts that stop and start later)
- [ ] Generate KMZ file with placemarks labeled "Poste (number)"
- [ ] Generate KMZ lines connecting consecutive posts
- [ ] Customizable post icon (style, color, shape, size)
- [ ] Customizable line color and thickness
- [ ] Customizable label size and color
- [ ] Single-page web interface with PDF upload and KMZ download

### Out of Scope

- Multiple PDF format support — only INFOVIAS/FTTH format for now
- User accounts or data persistence — stateless, single-use tool
- Mobile app — web-only
- Editing posts after generation — use Google Earth for adjustments
- Cable specification data in KMZ — only posts and lines

## Context

- PDF format: INFOVIAS FTTH project files from FORTNET PJC INTERNET
- PDFs contain 8 pages: cover page, route maps (pages 2-4), technical details (pages 5-8)
- Route maps contain: pole IDs (e.g., 21169, 21170), pole types (e.g., 10-150, 11-300), distances between poles (e.g., 34.3m, 37.8m), street names
- Posts are positioned along streets with the PDF having x,y drawing coordinates that indicate relative spatial layout
- Distances are shown as labels near the route lines (e.g., "40,2", "29,7", "42,2")
- Cable type is CFOA SM ASU 80S 12 (fiber optic)
- Coordinate system reference: DATUM SIRGAS-2000, GPS georeferenced
- PDF text has encoding issues with special characters (ç, ã, etc.) — needs robust parsing
- Posts are labeled with pole utility codes like "RST - 75 - PCN07"
- Personal tool for single user

## Constraints

- **Tech stack**: Client-side web app (HTML/CSS/JS) — no server needed, all processing in browser
- **PDF parsing**: Must work in-browser using libraries like pdf.js
- **KMZ generation**: Must generate valid KMZ/KML files client-side
- **Format**: Only needs to handle the INFOVIAS PDF template format initially

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Client-side only (no backend) | Personal tool, simpler deployment, no server costs | ✓ Confirmed — pdf.js + Tesseract.js CDN run fully in-browser |
| Infer bearings from PDF x,y positions | PDF drawing positions reflect real-world spatial layout | ✓ Positions extracted — bearing calc in Phase 2 |
| Single PDF format support | Start with known format, expand later if needed | ✓ Confirmed — INFOVIAS template parsing working |
| OCR via Tesseract.js (per-page crop) | Post numbers are vector paths in Numero_Poste layer — text extraction impossible | ✓ Working — 2x canvas crop, digit whitelist, pageseg 7 |
| Bad-CTM page filter (x<10 AND y<10) | FlipY pages produce garbage coordinates; reliable heuristic via coordinate ranges | ✓ Confirmed — correctly skips non-route pages |
| Sequence inference for OCR misses | OCR occasionally misses a number; neighbours give reliable interpolation | ✓ Confirmed — inferred ≥ 1 guard prevents negative post numbers |

</details>

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-15 after Phase 1 complete*
