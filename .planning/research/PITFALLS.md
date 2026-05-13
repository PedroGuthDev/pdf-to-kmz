# Pitfalls Research: PDF to KMZ Converter

## Critical Pitfalls

### 1. PDF Text Grouping Is Unreliable
**Risk:** HIGH
**Warning signs:** Post IDs split across multiple text items, or distance labels fragmented
**Problem:** pdf.js returns text in arbitrary chunks based on how the PDF was authored. A single "21169" could come as ["2", "1169"] or ["21", "169"]. Text items near each other spatially may not be adjacent in the items array.
**Prevention:**
- Sort text items by position (y first, then x) before processing
- Implement spatial proximity grouping: merge text items within ~2 PDF units
- Use regex on merged text to find patterns, not on individual items
**Phase:** Phase 1

### 2. PDF Coordinate System Is Inverted
**Risk:** MEDIUM
**Warning signs:** Posts appear mirrored or upside-down in KMZ
**Problem:** PDF origin is bottom-left (Y increases upward), but screen/map coordinates have Y increasing downward (for latitude, south = negative). Bearings calculated from raw PDF coords will be wrong if Y-axis isn't flipped.
**Prevention:**
- Flip Y coordinates immediately after extraction: `y = pageHeight - y`
- Test with known post layout to verify orientation
**Phase:** Phase 1, Phase 2

### 3. Distance Labels Are Hard to Associate with Post Pairs
**Risk:** HIGH  
**Warning signs:** Distances assigned to wrong post pairs, resulting in wildly incorrect GPS positions
**Problem:** Distance labels (like "34,3") are just floating text near the route line. There's no explicit metadata saying "this distance is between Post A and Post B." The tool must infer this from spatial proximity.
**Prevention:**
- For each distance label, find the two nearest posts
- Validate: distances should form a continuous chain along the route
- Cross-check: sum of distances should roughly match total cable length from page 1
- Flag suspicious distances (>100m or <5m) for user review
**Phase:** Phase 1, Phase 2

### 4. Multi-Page Route Continuity
**Risk:** MEDIUM
**Warning signs:** Route breaks at page boundaries, duplicate posts at page edges
**Problem:** The route spans pages 2-4. The same posts appear at page edges (the "VER PRANCHA 03/04" references). Posts must be deduplicated across pages and the route stitched together.
**Prevention:**
- Match posts by ID across pages (same 5-digit ID = same post)
- Use "VER PRANCHA" labels to identify page transition points
- Process all pages before building topology
**Phase:** Phase 1

### 5. Branch Detection Ambiguity
**Risk:** MEDIUM
**Warning signs:** Tool creates wrong connections, posts connected across streets they shouldn't be
**Problem:** At street intersections, multiple posts are close together. The tool might incorrectly connect posts from different streets.
**Prevention:**
- Use street name labels as context: posts along the same street name are likely sequential
- Use distance labels as connectors: if a distance label is between two posts, they're connected
- Build a graph, not a list — allow nodes with multiple edges
**Phase:** Phase 2

### 6. KML Color Format Gotcha
**Risk:** LOW (but 100% of first-time KML developers hit this)
**Warning signs:** Colors appear wrong in Google Earth (red shows as blue)
**Problem:** KML uses `aabbggrr` format (alpha, blue, green, red) — NOT the standard `rrggbbaa`. Everyone gets this wrong the first time.
**Prevention:**
- Create a `hexToKmlColor(hex)` utility that converts standard `#RRGGBB` to KML `ff[BB][GG][RR]`
- Unit test the conversion
**Phase:** Phase 3

### 7. Encoding Issues with Brazilian Characters
**Risk:** MEDIUM
**Warning signs:** Street names garbled, "Palhoça" becomes garbage text
**Problem:** PDF text may use non-standard encoding for ç, ã, é, etc. The extracted PDF in our sample shows garbled text for some labels.
**Prevention:**
- Use pdf.js's built-in encoding handling (usually handles this)
- For the specific INFOVIAS format, some text uses symbol fonts — detect and skip these
- Focus on extracting numeric data (IDs, distances) which is encoding-safe
- Street names are nice-to-have context, not critical data
**Phase:** Phase 1

### 8. PDF Scale and Units
**Risk:** LOW
**Warning signs:** Posts too close or too far apart in KMZ
**Problem:** PDF coordinates are in "points" (1/72 inch). The scale between PDF positions and real-world distances varies by PDF zoom/layout. Don't use PDF coordinate distances as real-world distances — use the labeled distances instead.
**Prevention:**
- Use PDF x,y ONLY for bearing/direction inference
- Use extracted distance labels for actual distances
- Never confuse PDF coordinate distance with real-world meters
**Phase:** Phase 2

---
*Researched: 2026-05-12*
