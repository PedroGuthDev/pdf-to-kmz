# Phase 1: PDF Parser Engine - Context

**Gathered:** 2026-05-14 (updated — original 2026-05-12 decisions superseded by live PDF inspection)
**Status:** Ready for planning (rewrite)

<domain>
## Phase Boundary

Build the core PDF parsing engine that extracts fiber post positions, inter-post distances, and cable route geometry from INFOVIAS-format PDFs in the browser.

**Critical correction from live inspector run (2026-05-14):** The entire prior approach of "find text inside Numero_Poste circles" is fundamentally broken. The sequential post numbers (07, 08, 09...) visible inside the circles are VECTOR PATHS rendered by AutoCAD PDF export, NOT text characters in the PDF stream. `getTextContent()` does not return them at the circle positions at all. Every layer-based, masked-digit, and proximity-text strategy has been chasing phantom data.

**New approach:** Extract circle positions (working) → render page to canvas → OCR each circle crop → read sequential number.

</domain>

<decisions>
## Implementation Decisions

### Root cause — why the prior approach fails
- **D-01:** Sequential post numbers (07, 08, 09...) inside circles are VECTOR PATHS (AutoCAD block export). `getTextContent()` on pages 2, 3, 4 returns ZERO whole-digit items near the circles. The "07" that accidentally matched one circle came from `"PCN07-3#2 CA-13.8kV(1)-RST"` (cable spec containing the network ID "PCN07"), not a real post number.
- **D-02:** Layer `Numero_Poste` does NOT exist in this PDF's OCG list. Circles come from layer `"0"`. `isCircleCentroidLayerName("0")` already returns true — no change needed there.
- **D-03:** Layer `TEXTO` does NOT exist. The aliases `Texto_3`, `TEXTO_80`, `txt_moldura_intelig` do exist but contain ZERO sequential post numbers (confirmed: `operator-list route digits = 0` on all pages). These layers hold pole type labels, cable specs, electrical annotations only.
- **D-04:** What IS near circles in `getTextContent`: `"RST - 75 - PCN07"` (electrical specs), `"10-150 (U)"` (pole type), `"21169"` (utility pole registry IDs), `"PCN07-3#2 CA-13.8kV(1)-RST"` (cable attachments). All utility infrastructure data, none of it fiber sequential numbers.
- **D-05:** ALL text-inside-circle logic must be DELETED from `parser/pdf-parser.js`: `selectPostAssemblyCircles`, `refinePostMarkersByInsideDigitsAndCable`, `circlesWithSequentialTextInsideFromLayers`, `circlesWithMaskedRouteTextInsideFromLayers`, `circlesWithStrictWholeDigitInsideFromGettext`, `computePageCircleAnchorStats`, `circlesFromAnchorDensityPages`, `circlesNearLayerSequentialDigits`. This is dead code for this PDF format.

### Sequential numbering — new strategy
- **D-06:** Use OCR (Tesseract.js) to read post numbers from rendered circles. Implementation: render each route page to canvas at 2× scale → for each circle centroid (cx, cy), crop a ~60pt window (120px at 2×) → run Tesseract with digits-only whitelist → parse the number string.
- **D-07:** OCR failure handling: infer the missing number from the logical sequence. Sort circles by arc-length projection onto the cable path, assign known OCR numbers, interpolate gaps in sequence. Add a warning per gap.
- **D-08:** Full-page render first, then crop per circle. One `page.render()` call per page; multiple crops from the same canvas. Do NOT attempt per-circle viewport renders.
- **D-09:** Tesseract config: digits whitelist `0123456789`, PSM-7 (single text line) or PSM-13 (raw line, no OSD). Language model: `eng` (numeric glyphs are font-independent).

### Page filtering
- **D-10:** Route content lives on pages 2, 3, 4. Pages 1, 5, 6, 7 have 0 circles (silently skipped already). Page 8 has a CTM matrix bug causing all 20 circles to cluster at position (2, 840) — no route content, confirmed by user. Filter out page 8 (and any future page with this symptom) by detecting circles where all centroids have `x < 10` AND `flipY > pageHeight - 10`. Do NOT hardcode page numbers.

### What IS extractable without OCR
- **D-11:** Circle positions (centroid x, y): working correctly on pages 2, 3, 4. Layer "0" in graphics extractor. No change needed.
- **D-12:** Inter-post distances: `Distância_Poste` layer IS working. Extracted: `"34,3"`, `"37,8"`, `"41,2"`, `"38,8"`, `"40,2"`, `"29,7"` on page 2 (Brazilian decimal comma format). Parser already converts `,` → `.`. KEEP as-is.
- **D-13:** Cable path geometry: `Cabo Projetado` layer. Keep existing `extractLayerGraphics` / `buildCableSegments`. No changes.
- **D-14:** Post type labels `"10-150 (U)"` from `Poste` layer text: extractable and useful as a position validation anchor. Keep `attachPostTypeLabels` logic.

### Output contract (unchanged structure, new number source)
- **D-15:** `posts[]`: `{ number (from OCR), x, y (circle centroid), pageNum, postType? }` — same shape as before, but `number` now comes from OCR, not text-proximity matching.
- **D-16:** `distances[]`: unchanged — from `Distância_Poste` layer.
- **D-17:** `cableSegments[]`: unchanged — from `Cabo Projetado` layer.
- **D-18:** Failure modes unchanged: `{ error: 'missing_layers' }`, `{ error: 'parse_failed' }`. Warnings accumulate per-page for OCR failures.

### Decisions carried forward (still valid)
- **D-CF-07:** Skip unparseable elements, accumulate warnings, do not stop.
- **D-CF-08:** If expected layer names not found, list available layers (for manual mapping fallback). Still applies — OCR is the new path but layer validation stays.
- **D-CF-09:** Process all pages dynamically; pages without valid circles are silently skipped.
- **D-CF-13:** Deduplicate posts across pages by sequential number (prefer lower page).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Live diagnostic evidence (read before touching pdf-parser.js)
- `inspect-route-markers.mjs` — the inspector that proved the "no text near circles" root cause. Run `node inspect-route-markers.mjs --all` to reproduce. Look at `gettext whole≤54: 0` on all pages.
- `.planning/phases/01-pdf-parser-engine/.continue-here.md` — blocking constraints from prior sessions (two blocking anti-patterns about layer names + masked-global approach). Still valid as historical context.

### Parser modules to change
- `parser/pdf-parser.js` — the main orchestrator. Remove all text-inside-circle functions (D-05). Add OCR pipeline (D-06 through D-09).
- `parser/layer-sources.js` — layer classification. Still correct: layer "0" for circles, `Distância_Poste` for distances.
- `parser/text-extractor.js` — used for distances and Poste text. No changes needed.
- `parser/graphics-extractor.js` — used for circles and cable paths. No changes needed.
- `parser/post-assembler.js` — assembles posts from candidates. May need simplification now that candidates = OCR results, not text-proximity.

### Project reference
- `.planning/PROJECT.md` — scope (client-side only, KMZ output)
- `.planning/REQUIREMENTS.md` — PDF-01 through PDF-05 requirements

### Real PDF data (verified 2026-05-14)
- `INFOVIAS_PJC INTERNET_Palhoça_RUA VALMOR FRANCISCO_v1.pdf` — Sample PDF. OCG layers confirmed: circles in `"0"`, distances in `"Distância_Poste"`, cable in `"Cabo Projetado"`, pole types in `"Poste"`. No `Numero_Poste` layer. No `TEXTO` layer.
- `Screenshot_1.png` — Clear view of route page: circles with numbers 07–11 visible, distances 34.3, 37.8, 41.2, 38.8 along cable.
- `Screenshot_3.png` — Overview view of full route.

</canonical_refs>

<code_context>
## Existing Code Insights

### What to KEEP (working correctly)
- `parser/graphics-extractor.js` — circle extraction from layer "0", cable path extraction from `Cabo Projetado`, Poste symbol extraction. All correct for pages 2-4.
- `parser/text-extractor.js` — CTM+Tm correlation for `Distância_Poste` and `Poste` layers. Working.
- `parser/cable-builder.js` — `buildCableSegments`. Working.
- `parser/distance-associator.js` — `associateDistances`. Working.
- `parser/post-assembler.js` — post deduplication (`deduplicatePostsPreferLowerPage`). May need adaptation for OCR-sourced candidates.
- `parser/ocg-map.js` — `buildOcgMap`, `validateLayers`. Working (note: `Numero_Poste` and `TEXTO` are in the "required" list but don't exist — the fallback flow needs to not crash when they're missing).
- `attachPostTypeLabels` in `pdf-parser.js` — reads Poste layer text for "10-150 (U)" type labels. Working.

### What to REMOVE (dead code for this PDF format)
Functions in `parser/pdf-parser.js` that must be deleted (D-05):
- `selectPostAssemblyCircles`
- `refinePostMarkersByInsideDigitsAndCable`
- `circlesWithSequentialTextInsideFromLayers`
- `circlesWithMaskedRouteTextInsideFromLayers`
- `circlesWithStrictWholeDigitInsideFromGettext`
- `computePageCircleAnchorStats`
- `circlesFromAnchorDensityPages`
- `circlesNearLayerSequentialDigits`
- `integerTextsNearCircles`
- `integerTextsNearCircles`
- `strictDigitsNearCircleCentroids`
- `maskedDigitsNearCentroids`
- `dedupePostDigitCandidatesNearestCircle`

### What to ADD
- OCR pipeline: Tesseract.js integration. New function `ocrCircleNumbers(page, pageHeight, circles)` → `Promise<Array<{circle, number}>>`. Called once per page with the page proxy and circle list.
- Page canvas render: `page.render({ canvasContext, viewport })` at scale 2× (viewport scale = 2). Extract canvas ImageData. Crop per circle.
- Bad-page filter: filter out pages where ALL circles cluster at near-origin (D-10).

### Integration Points
- `parsePdf()` in `pdf-parser.js` exports the top-level contract. Output shape stays the same (`posts`, `distances`, `cableSegments`, `warnings`, `layerMap`).
- Phase 2 (coordinate calculator) consumes `posts[].number`, `posts[].x`, `posts[].y`, `distances[]`.

</code_context>

<specifics>
## Specific Ideas

- The circles in the screenshots have a white fill with black numbers and black outline. Standard Tesseract with default binarization should work without extra preprocessing.
- The 60pt crop window at 2× scale = 120px crops. Numbers are 1-2 digits, font is clean and printed — OCR confidence should be high.
- The `Numeração_Cabo` layer (2 items per page) and `Reserva_Projetada` layer are visible in the PDF but not needed for the KMZ output. Leave them alone.
- The garbled text items (`";;..."`) are cable specs in a non-standard font encoding. They are not sequential post numbers. Ignore them.
- Page 8 exclusion pattern: circles at `(2.0, 840.0)` = CTM bug specific to that page. Filter by detecting all circles within 10pt of (0, pageHeight). A real route page will never have all circles at one corner.

</specifics>

<deferred>
## Deferred Ideas

- Parse `Numeração_Cabo` layer (cable sequence numbers) — potentially useful for bifurcation detection but not needed for MVP.
- Parse `Travessia` layer (crossings) — annotations about cable crossings could enrich the KMZ but out of scope for phase 1.
- Decode garbled font items (cable specs in custom encoding) — out of scope.

</deferred>

---

*Phase: 1-PDF Parser Engine*
*Context gathered: 2026-05-14 (full rewrite from live PDF inspection)*
