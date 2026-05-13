---
phase: 1
plan_id: 01-B
title: "Layer-Filtered Data Extraction"
wave: 1
depends_on: []
files_modified:
  - src/text-extractor.js
  - src/graphic-extractor.js
autonomous: true
requirements:
  - PDF-02
  - PDF-03
  - PDF-04
  - PDF-05
must_haves:
  truths:
    - "Text extraction filtered by OCG layer (D-06)"
    - "Posts identified by red circles on Numero_Poste + sequential numbers on TEXTO (D-01)"
    - "Distances from Distância_Poste layer (D-03)"
    - "Cable polyline from Cabo Projetado layer as graphic path data (D-04)"
    - "Graphic operators extracted via page.getOperatorList() (D-17)"
    - "Text content extracted via page.getTextContent() (D-17)"
    - "Skip unparseable elements with warning accumulation (D-07)"
    - "Encoding issues irrelevant — only numeric data and geometry needed (D-05)"
---

# Plan 01-B: Layer-Filtered Data Extraction

<objective>
Extract post data (sequential numbers, positions), inter-post distances, circle markers, and cable polyline geometry from PDF pages by filtering content through OCG layers. Uses both text content API and graphic operator API from pdf.js.
</objective>

## Tasks

<task id="B1">
<title>Implement layer-filtered text extraction</title>
<read_first>
- .planning/research/STACK.md (pdf.js getTextContent API, transform[4,5])
- .planning/phases/01-pdf-parser-engine/01-CONTEXT.md (D-01, D-03, D-05, D-06, D-17)
- .planning/research/PITFALLS.md (Pitfall #1: text grouping, Pitfall #7: encoding)
</read_first>
<action>
Create `src/text-extractor.js` as ES module:
- Export async function `extractTextByLayer(page, layerMapping)` that:
  1. Calls `page.getTextContent({ includeMarkedContent: true })` to get text items with their marked content (OCG) associations
  2. Filters text items by their OCG group membership to separate:
     - TEXTO layer items → post sequential numbers (01, 02, 03...)
     - Distância_Poste layer items → distance values
  3. For each text item, captures: `{ str, x: transform[4], y: transform[5], layerName }`
  4. Returns `{ textoItems: [], distanciaItems: [] }`
- Export function `parsePostNumbers(textoItems)` that:
  1. Filters items matching sequential number pattern: `/^\d{1,3}$/` (01, 02, 1, 2, etc.)
  2. Returns array of `{ number: int, x: float, y: float }` sorted by number
- Export function `parseDistances(distanciaItems)` that:
  1. Matches distance patterns: both comma-decimal `/\d+,\d+/` and dot-decimal `/\d+\.\d+/`
  2. Normalizes comma to dot for numeric value
  3. Returns array of `{ value: float, x: float, y: float }`
- Accumulate warnings for items that don't match expected patterns (D-07) in a module-level warnings array
- Export function `getWarnings()` returning accumulated warnings
</action>
<acceptance_criteria>
- src/text-extractor.js exports `extractTextByLayer`, `parsePostNumbers`, `parseDistances`, `getWarnings`
- `extractTextByLayer` calls `page.getTextContent({ includeMarkedContent: true })`
- Text items are filtered by OCG layer membership before parsing
- `parsePostNumbers` extracts sequential numbers like 01, 02, 03 with x,y positions
- `parseDistances` handles both "34,3" (comma) and "34.3" (dot) formats
- Unparseable text items generate a warning entry, not an error (D-07)
- 5-digit utility pole IDs (21169, 21170) are NOT extracted as post numbers (D-02)
</acceptance_criteria>
</task>

<task id="B2">
<title>Implement graphic operator extraction for circles and polylines</title>
<read_first>
- .planning/phases/01-pdf-parser-engine/01-CONTEXT.md (D-01: red circles, D-04: cable polyline, D-17: getOperatorList)
- .planning/research/STACK.md (pdf.js API)
- .planning/research/PITFALLS.md (Pitfall #2: Y-axis inversion)
</read_first>
<action>
Create `src/graphic-extractor.js` as ES module:
- Export async function `extractGraphicsByLayer(page, layerMapping)` that:
  1. Calls `page.getOperatorList()` to get OPS (operator list)
  2. Iterates through operators tracking current OCG group via OPS.beginMarkedContentProps / OPS.endMarkedContent
  3. Separates operators by OCG layer membership
  4. Returns `{ numeroPosteOps: [], caboProjetadoOps: [] }`
- Export function `extractCircles(numeroPosteOps)` that:
  1. Identifies circle/ellipse drawing operations (arc operators or Bézier curves forming circles)
  2. Extracts center position (x, y) from the transformation matrix
  3. Returns array of `{ centerX: float, centerY: float, radius: float }`
- Export function `extractPolylines(caboProjetadoOps)` that:
  1. Identifies moveTo (m), lineTo (l), curveTo (c) operators
  2. Builds path segments as arrays of {x, y} points
  3. Preserves Bézier control points for curve fidelity (D-04, D-16)
  4. Returns array of path segments: `[{ points: [{x, y}, ...], isCurved: boolean }]`
- Accumulate warnings for unrecognized graphic operators (D-07)
- Export function `getGraphicWarnings()` returning accumulated warnings
</action>
<acceptance_criteria>
- src/graphic-extractor.js exports `extractGraphicsByLayer`, `extractCircles`, `extractPolylines`, `getGraphicWarnings`
- `extractGraphicsByLayer` calls `page.getOperatorList()`
- Operators are filtered by OCG layer (Numero_Poste for circles, Cabo Projetado for polylines)
- `extractCircles` returns center coordinates for each circle marker
- `extractPolylines` returns path segments preserving curve geometry
- Bézier control points are preserved (not simplified to straight lines) for cable path fidelity
- Unrecognized operators generate warnings, not errors (D-07)
</acceptance_criteria>
</task>

<task id="B3">
<title>Handle PDF Y-axis coordinate normalization</title>
<read_first>
- .planning/research/PITFALLS.md (Pitfall #2: PDF Y-axis inversion)
- .planning/phases/01-pdf-parser-engine/01-CONTEXT.md (D-18: coordinate normalization left to planner)
- src/text-extractor.js (text positions from B1)
- src/graphic-extractor.js (graphic positions from B2)
</read_first>
<action>
Add to both `src/text-extractor.js` and `src/graphic-extractor.js`:
- Export function `normalizeCoordinates(items, pageViewport)` that:
  1. Gets page dimensions from `page.getViewport({ scale: 1.0 })`
  2. Flips Y-axis: `normalizedY = pageViewport.height - rawY`
  3. Keeps X as-is (left-to-right is correct)
  4. Returns items with normalized {x, y} coordinates
- Apply normalization immediately after extraction in both extractTextByLayer and extractGraphicsByLayer
- Decision: use raw PDF points (not 0-1 relative) since all data from same PDF shares the same coordinate space (D-18)
</action>
<acceptance_criteria>
- Both extractors apply Y-axis flip using `pageViewport.height - y`
- Page viewport obtained via `page.getViewport({ scale: 1.0 })`
- All returned coordinates have Y=0 at top (screen convention) not bottom (PDF convention)
- X coordinates unchanged (left-to-right is correct in both systems)
- Text items and graphic items use the same coordinate space after normalization
</acceptance_criteria>
</task>

## Verification

```
Load sample PDF → extract text from TEXTO layer → verify sequential numbers (01, 02, 03...) are found with positions → extract from Distância_Poste → verify distance values parsed → extract circles from Numero_Poste → verify center positions → extract polylines from Cabo Projetado → verify path segments exist → all Y coordinates are flipped (top-origin)
```
