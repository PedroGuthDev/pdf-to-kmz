---
phase: 1
plan_id: 01-A
title: "PDF Loading & Layer Discovery"
wave: 1
depends_on: []
files_modified:
  - index.html
  - src/pdf-loader.js
  - src/layer-manager.js
autonomous: true
requirements:
  - PDF-01
must_haves:
  truths:
    - "pdf.js loaded via CDN — no build step"
    - "OCG (Optional Content Group) layers are the primary filtering mechanism (D-06)"
    - "All pages processed — no hardcoded page ranges (D-09)"
    - "If expected layers missing, list available layers and ask user to map them (D-08)"
---

# Plan 01-A: PDF Loading & Layer Discovery

<objective>
Load a PDF file in the browser using pdf.js, discover all OCG (Optional Content Group) layers, validate expected layer names against the INFOVIAS format, and provide a fallback manual mapping UI when expected layers are not found. This is the foundation that all extraction plans depend on.
</objective>

## Tasks

<task id="A1">
<title>Create project HTML shell with pdf.js CDN</title>
<read_first>
- index.html (if exists — currently does not)
- .planning/research/STACK.md (pdf.js CDN details)
- package.json (existing dependencies — only pdfjs-dist relevant)
</read_first>
<action>
Create `index.html` with:
- DOCTYPE html5, lang="pt-BR"
- pdf.js loaded via CDN: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs` (ES module)
- Set `pdfjsLib.GlobalWorkerOptions.workerSrc` to matching CDN worker URL
- A file input element with id="pdf-upload" accepting ".pdf"
- A div with id="status" for progress messages
- A div with id="layer-mapping" (hidden by default) for the fallback mapping UI
- A div with id="parse-summary" (hidden by default) for result display
- Script tag loading `src/pdf-loader.js` as type="module"
</action>
<acceptance_criteria>
- index.html exists at project root
- index.html contains `<input type="file" id="pdf-upload" accept=".pdf">`
- index.html contains script tag referencing pdf.js CDN version 4.x+
- index.html contains `<script type="module" src="src/pdf-loader.js">`
- Opening index.html in a browser shows the file upload input without console errors
</acceptance_criteria>
</task>

<task id="A2">
<title>Implement PDF loading and page iteration</title>
<read_first>
- .planning/research/STACK.md (pdf.js API: getDocument, getPage)
- .planning/phases/01-pdf-parser-engine/01-CONTEXT.md (D-09: process all pages)
- extract_pdf.js (existing Node.js prototype — reference only, wrong library)
</read_first>
<action>
Create `src/pdf-loader.js` as ES module:
- Export async function `loadPdf(file)` that:
  1. Reads File object as ArrayBuffer via FileReader
  2. Calls `pdfjsLib.getDocument({ data: arrayBuffer })` 
  3. Returns the PDFDocumentProxy object
- Export async function `getAllPages(pdfDoc)` that:
  1. Iterates from 1 to `pdfDoc.numPages`
  2. Calls `pdfDoc.getPage(i)` for each
  3. Returns array of PDFPageProxy objects
- Wire up the file input change event to call loadPdf then pass to layer discovery
- Update status div with "Loading PDF..." and "Loaded N pages"
</action>
<acceptance_criteria>
- src/pdf-loader.js exports `loadPdf` and `getAllPages` functions
- `loadPdf` accepts a File object and returns a PDFDocumentProxy
- `getAllPages` returns an array with length === pdfDoc.numPages
- Status div shows "Loaded N pages" after successful load
- No hardcoded page ranges — all pages from 1 to numPages are returned (D-09)
</acceptance_criteria>
</task>

<task id="A3">
<title>Implement OCG layer discovery</title>
<read_first>
- src/pdf-loader.js (PDF loading from A2)
- .planning/phases/01-pdf-parser-engine/01-CONTEXT.md (D-06: OCG extraction, PDF Layer Map table)
</read_first>
<action>
Create `src/layer-manager.js` as ES module:
- Define constant `EXPECTED_LAYERS` mapping:
  - `Numero_Poste` → { type: "graphic", description: "Red circles marking posts" }
  - `TEXTO` → { type: "text", description: "Post sequential numbers" }
  - `Distância_Poste` → { type: "text", description: "Distances between posts" }
  - `Cabo Projetado` → { type: "graphic", description: "Cable route polyline" }
- Export async function `discoverLayers(pdfDoc)` that:
  1. Calls `pdfDoc.getOptionalContentConfig()` to get OCG configuration
  2. Extracts all layer names from the OCG groups
  3. Returns object: `{ availableLayers: string[], matchedLayers: Map<expectedName, ocgId>, unmatchedExpected: string[] }`
- Match is by exact string comparison (including space in "Cabo Projetado" per D-04)
- Export function `allLayersFound(discoveryResult)` returning boolean
</action>
<acceptance_criteria>
- src/layer-manager.js exports `discoverLayers` and `allLayersFound`
- `EXPECTED_LAYERS` contains exactly 4 entries: Numero_Poste, TEXTO, Distância_Poste, Cabo Projetado
- `discoverLayers` uses `pdfDoc.getOptionalContentConfig()` API
- When all 4 layers found, `allLayersFound` returns true
- When any layer missing, `unmatchedExpected` array contains the missing layer names
</acceptance_criteria>
</task>

<task id="A4">
<title>Implement fallback layer mapping UI</title>
<read_first>
- src/layer-manager.js (layer discovery from A3)
- index.html (layer-mapping div from A1)
- .planning/phases/01-pdf-parser-engine/01-CONTEXT.md (D-08: list available layers, ask user to map)
</read_first>
<action>
Add to `src/layer-manager.js`:
- Export function `showLayerMappingUI(availableLayers, unmatchedExpected)` that:
  1. Makes the `#layer-mapping` div visible
  2. For each unmatched expected layer, creates a `<select>` dropdown populated with all available PDF layers plus a "Not present" option
  3. Labels each dropdown with the expected layer name and its description
  4. Adds a "Confirm Mapping" button
  5. Returns a Promise that resolves with the user's mapping when button clicked
- Export function `applyManualMapping(mapping)` that updates the matchedLayers map with user selections
- The mapping UI should show: "Expected layer '{name}' not found. Select the matching layer:"
- Update the main flow in pdf-loader.js: after discoverLayers, if not allLayersFound, show mapping UI and wait for user input before proceeding
</action>
<acceptance_criteria>
- When expected layers are missing, #layer-mapping div becomes visible
- Each missing layer gets a select dropdown with all available PDF layers listed
- Select dropdown includes "Not present" option as first choice
- "Confirm Mapping" button resolves the mapping promise
- After mapping, parsing continues with the user-selected layer names
- If all layers found initially, mapping UI is never shown
</acceptance_criteria>
</task>

## Verification

```
Open index.html in browser → upload sample INFOVIAS PDF → status shows "Loaded N pages" → layer discovery runs → if layers match, no mapping UI appears → console.log confirms 4 matched layers
```
