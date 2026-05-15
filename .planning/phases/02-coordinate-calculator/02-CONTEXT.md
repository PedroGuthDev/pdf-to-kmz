# Phase 2: Coordinate Calculator - Context

**Gathered:** 2026-05-15 (revised)
**Status:** Ready for replanning

<domain>
## Phase Boundary

Implement GPS coordinate calculation for all extracted posts using a UTM-grid-based per-page calibration approach. Starting from a user-provided GPS for post #1, calibrate each detail page's coordinate system from the UTM grid and viewport layout visible on page 2 (overview), then project every post's GPS directly from its page-local PDF position — no sequential GPS chaining within a page. Handle branching routes and route gaps. Output enriched posts with lat/lon and a connections array for Phase 3.

**Why this replaces the original approach:** The original sequential chaining approach (GPS(N+1) = GPS(N) + bearing + meters) had two critical flaws: (1) not all post pairs have cable distance labels, causing error accumulation via scale-factor fallback; (2) detail page coordinates are page-local (not unified across pages), making cross-page PDF bearing calculations meaningless. The UTM-grid approach solves both.

</domain>

<decisions>
## Implementation Decisions

### Algorithm pivot — per-page UTM calibration

- **D-REV-01:** Replace sequential GPS chaining with per-page UTM-grid calibration. Every post's GPS is computed directly from its page-local PDF position via the page's PDF→UTM transform. No chaining within a page; errors do not accumulate.
- **D-REV-02:** All posts including branch posts are projected from their page's UTM origin (not from post #1 globally). Every detail page is independently calibrated. This makes all posts on all pages equivalent — no "anchor hierarchy."
- **D-REV-03:** Gap detection is preserved. The `gap: true` flag in the connections array is still needed by Phase 3 to know where NOT to draw cable lines. Gaps no longer affect GPS calculation but must still be detected.
- **D-REV-04:** Preserve connections contract shape `{ from, to, meters, bearing, gap }` — Phase 3 contract is unchanged.

### UTM grid extraction — scale factor

- **D-REV-05:** Extract the "UTM" OCG layer from both page 2 (overview) and detail pages. This layer contains the 50m UTM grid lines.
- **D-REV-06:** Scale factor derived from UTM grid line spacing: `scaleFactor = 50 / grid_line_spacing_pdf` (meters per PDF point). Grid lines are every 50m at 1:1000 scale — do NOT rely on cable distance labels for scale. This completely replaces the previous distance-label-based scale computation.
- **D-REV-07:** Scale factor is global (one value per page, should be consistent across pages). Use the median of all detected same-direction grid line spacings on the page to reject outliers.

### Page 2 overview — calibrating detail page coordinate systems

- **D-REV-08:** Page 2 is used for coordinate calibration — NOT ignored entirely. Page 2 provides: (a) the UTM grid for scale/orientation, (b) the viewport rectangle positions of each detail page labeled "03", "04", "05"… The viewport labels are large PDF text elements readable via `getTextContent()` (no OCR). Post OCR is still skipped on page 2 (D-04 partially preserved).
- **D-REV-09:** Viewport boxes on page 2 are matched to detail pages by extracting the large label text ("03", "04", "05") near each rectangle via `getTextContent()`. The rectangle geometry comes from the **"Padrão"** OCG layer (confirmed by user inspection of real INFOVIAS PDF, 2026-05-15).
- **D-REV-10:** Post #1 is never looked for on page 2 via OCR. Post #1's page-3 coordinates are already known from detail page parsing (Phase 1). To establish the page-2 coordinate system, post #1's position is mathematically projected from page-3 space into page-2 space using the viewport box geometry:
  ```
  x_p2 = box.x + (x1_p3 / page3_width)  * box.width
  y_p2 = box.y + (y1_p3 / page3_height) * box.height
  ```
  This gives post #1's location in page 2's coordinate system without any OCR on page 2.
- **D-REV-11:** With post #1's GPS (user-provided) at its computed page-2 position, plus the UTM grid on page 2, the full page-2 PDF→UTM affine transform is established (origin + scale + North-up orientation from D-01).
- **D-REV-12:** Each detail page's UTM origin is derived from its viewport box position on page 2, using the page-2 PDF→UTM transform. This gives every detail page an independent UTM calibration without any cross-page GPS chaining.

### Cross-page connections (no GPS chaining needed)

- **D-REV-13:** Cross-page GPS chaining is ELIMINATED. Because every page has its own UTM calibration from the overview, GPS for posts on page 4 is computed from page 4's calibration, not from any post on page 3. Cross-page post pairs in the connections array use GPS-vector bearing (compute bearing from final GPS(curr) → GPS(next)) and `meters = haversine(GPS(curr), GPS(next))` since PDF coordinates are not comparable across pages.

### Connections array values

- **D-REV-14:** Same-page connections: `meters = pdfDist(curr→next) × scaleFactor`, `bearing = atan2(dx, dy)` from PDF coords (D-02 preserved).
- **D-REV-15:** Cross-page connections: `meters` and `bearing` computed from final GPS positions after all posts are calibrated (haversine distance, GPS-vector bearing). Mark these with `cross_page: true` in the connections entry (additive field — Phase 3 can use or ignore it).

### Decisions from original context that are preserved

- **D-01:** PDF top = geographic North. The "norte" layer compass rose always points straight up — hardcoded, no rotation needed.
- **D-02:** Within-page bearing = `atan2(dx, dy)` on page-local PDF coords (flipY applied). Valid within a single page's coordinate space.
- **D-05:** Flat-Earth approximation with cos(lat) correction for GPS projection. Accurate at street scale.
- **D-06 through D-09:** Branch topology detection unchanged. Branches are identified by number-gap + spatial-proximity heuristic. Branch posts are projected from their page's UTM origin (not from junction post).
- **D-10:** Route gap = sequential posts with no cable polyline connecting them.
- **D-12:** Output marks gaps with `gap: true` in connections array.
- **D-13:** User input: decimal degrees, Google Maps paste format (`-27.645312, -48.671234`).
- **D-14:** Always provide GPS for post #1 only (lowest-numbered post). No multi-post input.
- **D-15:** Brazil bounding box validation on user input. Warn, don't reject.
- **D-16:** Post output: `{ number, x, y, lat, lon, postType?, pageNum? }`.
- **D-17:** Connections output: `[{ from, to, meters, bearing, gap, cross_page? }]`.

### Decisions from original context that are SUPERSEDED

- ~~D-03~~: "Detail pages share the same viewport/coordinate system" — **WRONG**. Detail pages have page-local coordinate systems. Replaced by D-REV-08 through D-REV-12.
- ~~D-11~~: "Scale factor from distance labels" — **REPLACED** by D-REV-06 (scale from UTM grid spacing).

### No-distances fallback

- **D-REV-16:** All real INFOVIAS PDFs have distance labels AND the UTM grid, so the zero-labels and zero-grid cases won't occur in practice. If the UTM grid is missing or produces no measurable spacing, emit a warning and fall back to distance-label-based scale for that page. If both are missing, warn and output `lat: null, lon: null` for affected posts — never produce silent garbage.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 1 output contract (input to Phase 2)
- `parser/pdf-parser.js` — `parsePdf()` orchestrator. Returns `{ posts, distances, cableSegments, warnings, layerMap }`. Phase 2 consumes `posts[]`, `cableSegments[]`, and `layerMap.allNames`. Note: the "UTM" layer must now also be extracted here (new requirement for Phase 2).
- `parser/post-assembler.js` — `deduplicatePostsPreferLowerPage()`. Posts already deduplicated before reaching Phase 2. Each post has `{ number, x, y, pageNum }` with page-local coordinates.
- `parser/distance-associator.js` — `associateDistances()`. Returns `{ from, to, meters }` per pair. `meters` may be null when no label found. Still used for connections array population but NOT for scale factor derivation.
- `parser/cable-builder.js` — `detectBranches()`, `buildCableSegments()`. Cable segments used for gap detection.
- `parser/coordinate-calculator.js` — Current implementation (sequential chaining). This module needs significant rewrite for the UTM-grid approach.

### Layer naming
- `parser/layer-sources.js` — Layer name matching functions. A new `isUtmGridLayerName()` function must be added to recognize the "UTM" layer. The viewport rectangle layer name (likely "Moldura" or similar) also needs to be added once confirmed from real PDF inspection.

### Project reference
- `.planning/PROJECT.md` — Scope (client-side only, KMZ output)
- `.planning/REQUIREMENTS.md` — COORD-01 through COORD-05 requirements
- `.planning/phases/01-pdf-parser-engine/01-CONTEXT.md` — Phase 1 decisions

### Key insight — multi-page PDF geometry
- Page 2 screenshot: `C:\Users\INFORMAC PAULO LOPES\Downloads\Screenshot_5.png` — shows the overview layout with overlapping page viewport boxes (03, 04, 05) and continuous UTM grid. This is the reference for understanding how pages relate spatially.
- Text in INFOVIAS PDFs: "O Projeto Óptico foi geo referenciado em toda a rota utilizando tecnologia GPS considerando o DATUM SIRGAS Quadriculas a cada 50m na escala 1:1000" — confirms SIRGAS datum, 50m UTM grid, 1:1000 scale.

</canonical_refs>

<code_context>
## Existing Code Insights

### What changes in this phase
- `parser/coordinate-calculator.js` — Major rewrite. The `calculateCoordinates()` function needs to be replaced with a UTM-grid-based approach. `detectRouteTopology()` and `detectGaps()` are preserved (still needed).
- `parser/layer-sources.js` — Add `isUtmGridLayerName()` for "UTM" layer. Add viewport rectangle layer matcher once layer name is confirmed.
- `parser/pdf-parser.js` — Must extract the "UTM" layer graphics per page and the page-2 viewport rectangles, then pass them to the coordinate calculator.

### What stays the same
- `parseCoordinateInput()`, `validateBrazilBounds()` — unchanged (user input parsing)
- `detectRouteTopology()` — unchanged (branch detection logic)
- `detectGaps()` — unchanged (gap detection logic)
- All Phase 1 parser modules — unchanged

### Reusable assets
- `distance-associator.js` — `distPointToSegment()` utility reusable for spatial proximity
- `cable-builder.js` — `detectBranches()` and gap detection helpers
- `graphics-extractor.js` — Already extracts paths per layer; UTM grid lines can be extracted using the same pattern as cable paths, filtered by the "UTM" layer name

### Established patterns
- ESM modules with named exports only (no default, no CommonJS)
- Mutable `warnings[]` accumulator passed through pipeline
- flipY applied per page by `pdf-parser.js` before downstream modules see coordinates
- All processing is client-side (browser, no Node.js)
- `pageNum` attached to all items for cross-page disambiguation

### New module structure
- New function (or new module `geo/utm-calibrator.js`): UTM grid line detection, page-2 viewport extraction, per-page PDF→UTM transform computation, and GPS projection per post
- UTM ↔ GPS conversion: SIRGAS datum, zone auto-detected from post #1 longitude (Brazil: zones 18–25S)

### Integration points
- `pdf-parser.js` passes UTM grid data and viewport box data to `calculateCoordinates()`
- Phase 3 (KMZ generator) consumes `{ posts, connections }` — contract shape unchanged

</code_context>

<specifics>
## Specific Ideas

- The "UTM" OCG layer name is confirmed — add to `layer-sources.js`.
- The viewport box labels "03", "04", "05" on page 2 are large PDF text elements (not rendered image) — readable via `getTextContent()` without OCR.
- The viewport box rectangle geometry on page 2 comes from the **"Padrão"** OCG layer (confirmed by user inspection of real INFOVIAS PDF, 2026-05-15).
- The overview page 2 is the same PDF page that D-04 excluded from post OCR. D-04 remains in effect for OCR. What changes: the "UTM" layer and viewport rectangles ARE extracted from page 2 for calibration purposes.
- Post #1 location in page-2 overview space is computed, not OCR'd: `x_p2 = box.x + (x1_p3 / page3_width) * box.width` (and similarly for y). No rendering needed.
- SIRGAS zone for Brazil: determine from longitude — zone = floor((lon + 180) / 6) + 1. Most of Brazil falls in zones 18–25S.
- The 50m grid at 1:1000 scale means 50 real meters = 50 PDF points at 1:1 mapping, but actual PDF export scale may differ. Always measure the grid spacing empirically rather than assuming PDF units = drawing units.

</specifics>

<deferred>
## Deferred Ideas

- Support for anchoring on any post (not just post #1)
- DMS coordinate format input
- Automatic UTM label extraction if a future INFOVIAS version adds text labels to the UTM grid
- Visual preview of calculated coordinates on a map before KMZ generation (ENH-01)
- Using overlapping posts (posts appearing on both page N and page N+1) as additional cross-page calibration anchors — not needed given per-page calibration from overview, but could improve accuracy if viewport box extraction is imprecise

</deferred>

---

*Phase: 2-Coordinate Calculator*
*Context revised: 2026-05-15*
