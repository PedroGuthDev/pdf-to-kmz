# Stack Research: PDF to KMZ Converter

## Recommended Stack (2025)

### PDF Parsing — pdf.js (Mozilla)
- **Library:** `pdfjs-dist` (npm) or CDN via `mozilla.github.io/pdf.js`
- **Version:** Latest stable (4.x+)
- **Why:** Only mature, browser-native PDF parser. Extracts text content with x,y positions via `getTextContent()` API
- **Key API:**
  - `pdfjsLib.getDocument(data)` → loads PDF from ArrayBuffer
  - `page.getTextContent()` → returns `items[]` with `str` (text) and `transform[4,5]` (x,y coords)
  - `transform[4]` = X position, `transform[5]` = Y position (bottom-left origin)
  - PDF coordinate system has origin at bottom-left; Y-axis is flipped vs screen
- **Confidence:** HIGH — industry standard, well-documented

### KML Generation — Template Strings (no library needed)
- **Approach:** Build KML XML as template literals
- **Why:** KML is simple XML. For our use case (placemarks + lines), a library adds unnecessary weight
- **KML Structure:**
  - `<Document>` → contains styles and placemarks
  - `<Style>` → `<IconStyle>` for post icons, `<LineStyle>` for connection lines, `<LabelStyle>` for labels
  - `<Placemark>` with `<Point>` → each post
  - `<Placemark>` with `<LineString>` → each connection line
- **Color format:** KML uses `aabbggrr` (NOT standard `rrggbb`)
- **Confidence:** HIGH — minimal complexity

### KMZ Compression — JSZip
- **Library:** `jszip` v3.10.x
- **CDN:** `https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js`
- **Why:** Standard browser-side ZIP creation. KMZ = ZIP containing `doc.kml`
- **Workflow:** `new JSZip()` → `zip.file("doc.kml", kmlString)` → `zip.generateAsync({type: "blob"})` → download
- **Confidence:** HIGH — 14k+ stars, battle-tested

### Coordinate Math — Custom (Haversine destination formula)
- **Approach:** Implement destination point calculation inline
- **Formula:** Given (lat, lon, bearing, distance) → calculate new (lat, lon)
- **Earth radius:** 6371e3 meters (spherical model sufficient for <1km distances)
- **Key considerations:**
  - All trig functions require radians
  - Bearing: 0° = North, 90° = East
  - Longitude normalization: `(deg + 540) % 360 - 180`
- **Why not a library:** Formula is 10 lines of code, no need for turf.js or similar
- **Confidence:** HIGH — well-established math

### File Download — Native Blob API
- **Approach:** `URL.createObjectURL(blob)` + temporary `<a>` element
- **Why:** No need for FileSaver.js, native API works in all modern browsers
- **Confidence:** HIGH

### UI Framework — Vanilla HTML/CSS/JS
- **Why:** Single-page tool, no routing, no state management complexity
- **Confidence:** HIGH — simplest approach for scope

## What NOT to Use

| Library | Why Not |
|---------|---------|
| `tokml` | Only converts GeoJSON → KML; we build KML directly from our data |
| `turf.js` | Overkill — we only need one coordinate function |
| `FileSaver.js` | Native Blob download works fine |
| `pdf-parse` / `pdf2json` | Node.js only, won't work in browser |
| React/Vue/Angular | Massive overhead for a single form page |

---
*Researched: 2026-05-12*
