# Features Research: PDF to KMZ Converter

## Table Stakes (must have)

### PDF Processing
- **Upload PDF file** — drag-and-drop or file picker
- **Extract text with positions** — get all text items with x,y coordinates
- **Parse post identifiers** — regex-match pole IDs (5-digit numbers like 21169, 21170)
- **Parse pole types** — match patterns like "10-150 (U)", "11-300 (U)", "12-600 (U)"
- **Parse distances** — match decimal numbers near route lines (e.g., "34,3", "37,8")
- **Handle encoding** — Brazilian Portuguese characters (ç, ã, é, etc.)

### Coordinate Calculation
- **First post GPS input** — user provides lat/lng for starting point
- **Bearing inference** — calculate direction between posts from PDF x,y positions
- **Distance-based positioning** — place each post at correct distance along bearing
- **Multi-page support** — combine data from pages 2-4 (route maps)

### KMZ Output
- **Post placemarks** — labeled "Poste 1", "Poste 2", etc.
- **Connection lines** — LineString between consecutive posts
- **Valid KMZ** — ZIP containing doc.kml, opens in Google Earth
- **Download trigger** — one-click download

### Customization
- **Post icon style** — color, shape, size
- **Line style** — color, thickness
- **Label style** — size, color

## Differentiators (nice to have, not v1)

- **Map preview** — show posts on interactive map before download
- **Route editing** — drag posts to adjust positions
- **Batch processing** — multiple PDFs at once
- **Cable data in KMZ** — include cable type, specs in placemark descriptions
- **Export formats** — GeoJSON, Shapefile, GPX alternatives
- **Template detection** — auto-detect different PDF formats

## Anti-features (deliberately NOT building)

- **OCR** — PDFs have text layers; don't add image processing complexity
- **Server upload** — keep everything client-side for privacy and simplicity
- **User accounts** — no persistence needed
- **PDF editing** — out of scope, use dedicated tools

---
*Researched: 2026-05-12*
