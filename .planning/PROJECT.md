# PDF to KMZ Converter

## What This Is

A single-page web application that converts fiber optic infrastructure PDF project files (INFOVIAS/FTTH format) into KMZ files for Google Earth. Users upload a PDF, provide the GPS coordinates of the first post, and the tool extracts post positions, calculates remaining coordinates using inter-post distances, and generates a downloadable KMZ with customizable placemarks and connection lines.

## Core Value

Accurately extract post data from INFOVIAS PDF files and produce a georeferenced KMZ file where posts are placed at correct relative positions with lines connecting them.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- Current scope. Building toward these. -->

- [ ] Parse INFOVIAS-format PDFs to extract post IDs, types, and inter-post distances
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
- [ ] Infer post-to-post bearing/direction from PDF drawing positions

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
| Client-side only (no backend) | Personal tool, simpler deployment, no server costs | — Pending |
| Infer bearings from PDF x,y positions | PDF drawing positions reflect real-world spatial layout | — Pending |
| Single PDF format support | Start with known format, expand later if needed | — Pending |

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
*Last updated: 2026-05-12 after initialization*
