# Phase 2: Coordinate Calculator - Context

**Gathered:** 2026-05-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement GPS coordinate calculation for all extracted posts. Starting from a user-provided GPS coordinate for post #1, compute latitude/longitude for every post using PDF x,y drawing positions for bearing and extracted inter-post distances for spacing. Handle branching routes (separate number sequences forking from a junction post) and route gaps (sequential posts with no cable connecting them).

</domain>

<decisions>
## Implementation Decisions

### Bearing calculation
- **D-01:** PDF top = geographic north (always). The "norte" layer in every INFOVIAS PDF contains a compass rose pointing straight up. No rotation extraction or user input needed — hardcode the relationship.
- **D-02:** Bearing between two posts = `atan2(dx, dy)` on PDF coordinates (flipY already applied). In flipped coords: +x = east, -y = north (smaller y = higher on page = north).
- **D-03:** Detail pages (3+) share the same viewport/coordinate system. Cross-page bearings are valid — coordinates are in a unified drawing space. The staggered page arrangement (following the street) does not affect this.
- **D-04:** Page 2 (overview) MUST be ignored — different scale, numbers too small for reliable OCR. Only detail pages (3+) are used for coordinate extraction. Phase 1's `deduplicatePostsPreferLowerPage` (which prefers page 2) needs adjustment to prefer detail pages instead.
- **D-05:** Use flat-Earth approximation with cos(lat) correction for GPS projection. At street-level distances (tens of meters between posts), the error is negligible compared to haversine.

### Route topology and branching (COORD-04)
- **D-06:** Branches are separate numbering sequences. Main route = posts 1–15, branch = posts 16–22. Each branch post is a distinct post (no shared numbers with the main route). The project never assigns two numbers to the same physical post.
- **D-07:** Junction detection via spatial proximity. The first post of a new number sequence (e.g., post 16) will be physically close to a main-route post (e.g., post 7) in PDF space. The nearest existing post is the junction.
- **D-08:** Branch start detected by number gap heuristic. When consecutive post numbers place them spatially far apart in the PDF, that signals a branch start. The system finds the nearest existing post to establish the junction.
- **D-09:** GPS propagation on branches: branch post 16 gets GPS = post 7's GPS + bearing(7→16) + distance(7→16). Subsequent branch posts (17, 18...) continue the chain from post 16.

### Route gaps (COORD-05)
- **D-10:** A route gap = sequential posts (e.g., 10→11) with no cable polyline connecting them. The numbering is continuous but the `Cabo Projetado` geometry is disconnected.
- **D-11:** GPS calculation across gaps uses PDF positions + scale factor. The scale factor is derived from posts that DO have distance labels (meters per PDF point). The gap doesn't break coordinate calculation since all detail pages share the same coordinate space.
- **D-12:** Output marks gaps with `gap: true` flag in the connections array. Phase 3 uses this to know where NOT to draw cable lines in the KMZ.

### First-post GPS input (COORD-01)
- **D-13:** Accept decimal degrees with Google Maps paste support. Parse format like `-27.645312, -48.671234` (comma-separated lat, lon).
- **D-14:** Always provide coordinates for post #1 (the first/lowest-numbered post). No support needed for anchoring on arbitrary posts.
- **D-15:** Brazil bounding box validation. Warn if coordinates fall outside approximate Brazil bounds (lat -34 to 5, lon -74 to -35). Don't reject — just flag as likely error.

### Output contract
- **D-16:** Enrich existing post objects with `lat` and `lon` fields: `{ number, x, y, lat, lon, postType?, pageNum? }`.
- **D-17:** Add a `connections` array to the output: `[{ from, to, meters, bearing, gap }]`. This describes the route graph — which posts connect to which, with distance, bearing, and gap flag. Phase 3 uses this for line rendering.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 1 output contract (input to Phase 2)
- `parser/pdf-parser.js` — Top-level `parsePdf()` orchestrator. Returns `{ posts, distances, cableSegments, warnings, layerMap }`. Phase 2 consumes `posts[]` and `distances[]`.
- `parser/post-assembler.js` — `assemblePostsFromOcr()` and `deduplicatePostsPreferLowerPage()`. The dedup function needs adjustment per D-04 (prefer detail pages, not page 2).
- `parser/distance-associator.js` — `associateDistances()` pairs sequential posts (N→N+1) with nearest distance label. Returns `{ from, to, meters }`. Does NOT handle branch connections (7→16) — Phase 2 must extend or supplement this.
- `parser/cable-builder.js` — `buildCableSegments()` and `detectBranches()`. Cable segments have `startPoint`/`endPoint`. Branch detection finds shared endpoints. Useful for gap detection (D-10) and route graph construction.

### Project reference
- `.planning/PROJECT.md` — Scope (client-side only, KMZ output), key decisions
- `.planning/REQUIREMENTS.md` — COORD-01 through COORD-05 requirements
- `.planning/phases/01-pdf-parser-engine/01-CONTEXT.md` — Phase 1 decisions (OCR approach, page filtering, output contract)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `distance-associator.js` — `distPointToSegment()` utility for point-to-segment distance. Reusable for spatial proximity calculations.
- `cable-builder.js` — `detectBranches()` finds cable segments that share endpoints. Can help identify route gaps (no shared cable endpoint = gap).
- `cable-builder.js` — `minDistancePointToPathOps()` checks if a point lies near a cable path. Useful for gap detection (is there a cable between posts 10 and 11?).
- `post-assembler.js` — `deduplicatePostsPreferLowerPage()` dedup logic. Needs modification to prefer detail pages over page 2 (D-04).

### Established Patterns
- ESM modules with named exports only (no default, no CommonJS)
- Mutable `warnings[]` accumulator passed through the pipeline
- flipY applied by pdf-parser.js before data reaches downstream modules
- All processing is client-side (browser, no Node.js)

### Integration Points
- Phase 2 module receives `parsePdf()` output and adds GPS coordinates
- New module(s) in `parser/` or a new `geo/` directory for coordinate calculation
- Phase 3 (KMZ generator) will consume the enriched posts + connections array

</code_context>

<specifics>
## Specific Ideas

- The "norte" layer exists in INFOVIAS PDFs with a compass rose always pointing straight up. This confirms PDF-up = North without any parsing needed.
- Detail pages (3, 4, 5...) are arranged in a staggered layout following the street direction, but they all share the same underlying coordinate system — bearings across page boundaries are valid.
- Google Maps right-click → "Copy coordinates" gives the exact decimal format the input parser should handle.
- The scale factor for gap-crossing can be computed as: average(meters / pdf_distance) for all post pairs that have distance labels. This gives meters-per-PDF-point.

</specifics>

<deferred>
## Deferred Ideas

- Support for anchoring on any post (not just post #1) — could be useful if post 1 is hard to locate on Google Maps
- DMS coordinate format input — only decimal degrees for now
- Automatic north-arrow rotation extraction from the "norte" layer — not needed since it always points up, but could be added for other PDF formats
- Visual preview of calculated coordinates on a map before KMZ generation (ENH-01 in REQUIREMENTS.md)

</deferred>

---

*Phase: 2-Coordinate Calculator*
*Context gathered: 2026-05-15*
