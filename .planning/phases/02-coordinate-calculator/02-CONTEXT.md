# Phase 2: Coordinate Calculator - Context

**Gathered:** 2026-05-15 (original) / 2026-05-18 (accuracy revision)
**Status:** Ready for replanning — accuracy iteration to reach <5 m on most posts

<domain>
## Phase Boundary

Implement GPS coordinate calculation for all extracted posts using a UTM-grid-based per-page calibration approach. Starting from a user-provided GPS for post #1, calibrate each detail page's coordinate system from the UTM grid and viewport layout visible on page 2 (overview), then project every post's GPS directly from its page-local PDF position — no sequential GPS chaining within a page. Handle branching routes and route gaps. Output enriched posts with lat/lon and a connections array for Phase 3.

**Why this replaces the original approach:** The original sequential chaining approach (GPS(N+1) = GPS(N) + bearing + meters) had two critical flaws: (1) not all post pairs have cable distance labels, causing error accumulation via scale-factor fallback; (2) detail page coordinates are page-local (not unified across pages), making cross-page PDF bearing calculations meaningless. The UTM-grid approach solves both.

**2026-05-18 accuracy target:** Most posts within 5 m of ground-truth GPS. Current baseline (hybrid scales + OCR circle centroids) sits at 12–68 m per post on the Palhoça sample, max 68 m at post 06. Diagnosis (see `<specifics>` below) shows the dominant residual is parser-reported post `(x, y)` — not the transform math. Per-segment bearings on page 3 drift up to 30°, far beyond what any scale tweak can explain. This revision targets the position source first, then simplifies the scale model.

</domain>

<decisions>
## Implementation Decisions

### Accuracy fix (2026-05-18) — polyline-vertex post positions, isotropic per-page scale

- **D-ACC-01: Replace OCR circle centroids with cable-polyline vertices as the canonical post (x, y).** OCR + `Numero_Poste` circle centroids place posts at the *label circle* (drafted for readability), not at the pole. The `Cabo_Projetado` polyline physically passes through every pole — its vertices are the true positions.
- **D-ACC-02: Snap each post to its nearest polyline vertex by proximity to the OCR-derived position.** OCR is still authoritative for *which* post is which (number + initial rough position). Snap each post independently to the nearest `Cabo_Projetado` vertex on the same page within a threshold (e.g. 30 PDF pt). If no vertex is within threshold, keep the OCR centroid as fallback and emit a warning.
- **D-ACC-03: One-to-one assignment guard at branch points.** At branch junctions (already detected by `cable-builder.js:detectBranches`), multiple polyline vertices converge. Use globally-shortest-edge greedy assignment (same pattern as `assemblePostData`'s OCR matching) so two posts cannot snap to the same vertex. Each post gets a unique vertex.
- **D-ACC-04: Branch / page-jump safety.** Per-post proximity matching is inherently branch-safe — each post is identified independently by OCR; the snap step does not walk the chain. The user's scenario (e.g., pages 4–5 form one branch, page 6 restarts off the end of page 3) works automatically: post 06's OCR position lives on its own branch, so it snaps to the vertex on its own branch.
- **D-ACC-05: Vertex-snap step lives in Phase 02, not Phase 01.** Implement as a `snapPostsToPolyline()` pre-step at the top of `coordinate-calculator.js:calculateCoordinates()`. Phase 1's `parsePdf()` output contract is unchanged — posts still come in with their OCR `(x, y)`; Phase 02 snaps before projecting.
- **D-ACC-06: Drop the hybrid scale — use per-page UTM grid isotropic scale (X = Y).** Once polyline-vertex positions remove the OCR position noise, the empirical justification for the hybrid model (D-REV-06 / D-REV-08 / pages 3-4 fix) goes away. Use each detail page's own UTM grid spacing for *both* X and Y scales. Falls back to overview-scaled viewport ratio only if the detail page has no UTM grid paths.
- **D-ACC-07: Optional 2nd GPS anchor — post 01 + last post.** UI accepts GPS for post 01 (required) and optionally the final post. When both are given, solve a global 2D affine (translation + rotation + scale) constrained by both anchors instead of relying solely on UTM-grid orientation. When only post 01 is given, fall back to today's anchor-and-grid behavior. Per-page anchors remain deferred (see `<deferred>`).
- **D-ACC-08: Distance labels = sanity-check only.** After GPS is computed, compare each labeled segment's `haversine(GPS_curr, GPS_next)` against the parsed label meters. Warn if `|delta|` > 5 m OR > 10% of the label. Do NOT feed labels into the scale math (avoid overfitting to rounded labels like "40m"). Labels still pass through to the `connections` array for Phase 3.
- **D-ACC-09: Connections contract unchanged.** Shape stays `{ from, to, meters, bearing, gap, cross_page? }`. The `meters` value now comes from haversine on computed GPS (post-snap), so it's already consistent with the new positions.

### Algorithm pivot (2026-05-15) — per-page UTM calibration

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
- **D-REV-10:** Post #1 is never looked for on page 2 via OCR. Post #1's page-3 coordinates are already known from detail page parsing (Phase 1). To establish the page-2 coordinate system, post #1's position is mathematically projected from page-3 space into page-2 space using the viewport box geometry.
- **D-REV-11:** With post #1's GPS (user-provided) at its computed page-2 position, plus the UTM grid on page 2, the full page-2 PDF→UTM affine transform is established (origin + scale + North-up orientation from D-01).
- **D-REV-12:** Each detail page's UTM origin is derived from its viewport box position on page 2, using the page-2 PDF→UTM transform. This gives every detail page an independent UTM calibration without any cross-page GPS chaining.

### Cross-page connections (no GPS chaining needed)

- **D-REV-13:** Cross-page GPS chaining is ELIMINATED. Because every page has its own UTM calibration from the overview, GPS for posts on page 4 is computed from page 4's calibration, not from any post on page 3. Cross-page post pairs in the connections array use GPS-vector bearing and `meters = haversine(GPS(curr), GPS(next))` since PDF coordinates are not comparable across pages.

### Connections array values

- **D-REV-14:** Same-page connections: `meters = pdfDist(curr→next) × scaleFactor`, `bearing = atan2(dx, dy)` from PDF coords (D-02 preserved).
- **D-REV-15:** Cross-page connections: `meters` and `bearing` computed from final GPS positions after all posts are calibrated (haversine distance, GPS-vector bearing). Mark these with `cross_page: true` in the connections entry.

### Decisions from original context that are preserved

- **D-01:** PDF top = geographic North. The "norte" layer compass rose always points straight up — hardcoded, no rotation needed.
- **D-02:** Within-page bearing = `atan2(dx, dy)` on page-local PDF coords (flipY applied). Valid within a single page's coordinate space.
- **D-05:** Flat-Earth approximation with cos(lat) correction for GPS projection. Accurate at street scale.
- **D-06 through D-09:** Branch topology detection unchanged. Branches are identified by number-gap + spatial-proximity heuristic.
- **D-10:** Route gap = sequential posts with no cable polyline connecting them.
- **D-12:** Output marks gaps with `gap: true` in connections array.
- **D-13:** User input: decimal degrees, Google Maps paste format (`-27.645312, -48.671234`).
- **D-14:** ~~Always provide GPS for post #1 only.~~ **Superseded by D-ACC-07** — optional 2nd anchor (last post) also accepted.
- **D-15:** Brazil bounding box validation on user input. Warn, don't reject.
- **D-16:** Post output: `{ number, x, y, lat, lon, postType?, pageNum? }`.
- **D-17:** Connections output: `[{ from, to, meters, bearing, gap, cross_page? }]`.

### Decisions SUPERSEDED by the 2026-05-18 accuracy revision

- ~~Hybrid X/Y scale (X = page UTM grid, Y = page-2 viewport-height ratio × overview scale)~~ — `buildPageTransforms` in `utm-calibrator.js`. Replaced by **D-ACC-06** (per-page UTM-grid isotropic). The hybrid was a workaround for OCR-centroid position noise; once D-ACC-01 fixes the positions, the simpler isotropic model is mathematically correct.
- ~~`repairPostsOnUncalibratedPages` interpolation~~ — added for post 08 on page 8. Still keep as fallback for posts on pages without a viewport box, but it should become rare once vertex-snap is in place (post 08 should snap on its viewport-calibrated page 4 instead).
- ~~D-14 single-anchor exclusivity~~ — Superseded by **D-ACC-07** (optional 2nd anchor).

### Claude's Discretion

- Snap threshold value (30 pt is a starting suggestion). Tune empirically against `debug-run-calc.mjs` on the Palhoça sample.
- Exact greedy vs. Hungarian one-to-one assignment is an implementation detail — greedy by globally shortest edge is sufficient at expected vertex counts (≤ ~50 posts per page).
- Affine solver when 2 anchors are given: simple closed-form (translation + uniform scale + rotation) is fine; full affine with per-axis scale only if isotropic doesn't hit <5 m.
- UI wiring for the optional 2nd anchor (separate field, single textarea, etc.) — defer to Phase 04 conventions if any.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 02 carry-overs (still authoritative)
- `.planning/phases/02-coordinate-calculator/02-RESEARCH.md` — UTM math, SIRGAS constants, page-2 viewport calibration approach.
- `.planning/phases/02-coordinate-calculator/.continue-here.md` — Blocking anti-patterns: Poste text vs route digits, pure isotropic UTM replace caveat (the isotropic ban applied to the *old* parser positions; with polyline-vertex positions per D-ACC-01, isotropic becomes valid — see D-ACC-06).
- `.planning/HANDOFF.json` — Accuracy iteration tasks 5–8, baseline metrics.

### Phase 1 output contract (input to Phase 2)
- `parser/pdf-parser.js` — `parsePdf()` orchestrator. Returns `{ posts, distances, cableSegments, warnings, layerMap, utmGridPathsPerPage, viewportBoxes, pageDimensions, distanceLabelItems }`. Phase 2 consumes `posts[]`, `cableSegments[]`, `utmGridPathsPerPage`, `viewportBoxes`, `pageDimensions`. **Contract unchanged by D-ACC-05.**
- `parser/post-assembler.js` — `assemblePostsFromOcr`, `applyPosteHintPositions`. Posts come out with OCR-derived `(x, y)`. Phase 02 snap step replaces these positions with polyline vertices.
- `parser/cable-builder.js` — `buildCableSegments`, `detectBranches`, `minDistancePointToCablesOnPage`. **Each `cableSegment.ops` contains M/L/C operations**: M and L ops carry the polyline vertices we'll snap to. C (bezier) ops should be flattened or ignored for vertex extraction in the snap step.
- `parser/coordinate-calculator.js` — Current implementation. **Site of D-ACC-05 changes:** add `snapPostsToPolyline()`; simplify scale model per D-ACC-06; add 2nd-anchor branch per D-ACC-07; add label-vs-haversine sanity check per D-ACC-08.
- `parser/geo/utm-calibrator.js` — `buildPageTransforms`, `detailPageXScale`, `detailPageYScale`. **Simplification target:** D-ACC-06 collapses X/Y scale into a single per-page UTM-grid value. Hybrid functions can be removed once isotropic is verified.

### Layer naming
- `parser/layer-sources.js` — `isUtmGridLayerName`, `isCableLayerName`. No changes needed.

### Project reference
- `.planning/PROJECT.md` — Scope (client-side only, KMZ output).
- `.planning/REQUIREMENTS.md` — COORD-01 through COORD-05.
- `.planning/phases/01-pdf-parser-engine/01-CONTEXT.md` — Phase 1 decisions.

### Debug & validation harness (MUST run after each change)
- `debug-run-calc.mjs` — End-to-end accuracy check vs ground truth. Run after every change.
- `debug-compare.mjs` — Compares calibration models (hybrid vs isotropic etc.).
- `debug_results.txt` — Latest parser dump (post positions, viewport boxes, UTM grid stats).
- `coordenadas postes.txt` — Ground-truth GPS for posts 01–11 (Palhoça sample).
- `INFOVIAS_PJC INTERNET_Palhoça_RUA VALMOR FRANCISCO_v1.pdf` — Sample PDF in repo root.

### Key insight — page 2 overview geometry
- Page 2 screenshot: `C:\Users\INFORMAC PAULO LOPES\Downloads\Screenshot_5.png` — overview layout with overlapping page viewport boxes and continuous UTM grid.
- Text in INFOVIAS PDFs: "SIRGAS Quadriculas a cada 50m na escala 1:1000" — confirms SIRGAS datum, 50m UTM grid, 1:1000 scale.

</canonical_refs>

<code_context>
## Existing Code Insights

### What changes in this phase (D-ACC scope)
- `parser/coordinate-calculator.js` — Add `snapPostsToPolyline(posts, cableSegments)` pre-step. Replace hybrid-scale call sites with isotropic per-page UTM scale. Add optional 2nd-anchor parameter to `calculateCoordinates`. Add post-computation label-vs-haversine sanity warnings.
- `parser/geo/utm-calibrator.js` — Simplify: collapse `detailPageXScale` + `detailPageYScale` into a single `detailPageScale` per D-ACC-06. Retain viewport-ratio fallback only for pages without a UTM grid. Drop hybrid X/Y split in `buildPageTransforms`.
- `index.html` — Add optional 2nd-anchor input (last post GPS). Wire to `calculateCoordinates` second arg. Surface label-vs-haversine warnings in the warnings list.

### What stays the same
- Phase 1 parser pipeline (`parsePdf`, `assemblePostsFromOcr`, `applyPosteHintPositions`, `buildCableSegments`).
- `parseCoordinateInput()`, `validateBrazilBounds()` — user input parsing.
- `detectRouteTopology()`, `detectGaps()` — branch & gap detection.
- UTM ↔ GPS math (`latLonToUtm`, `utmToLatLon`, `haversineMeters`, `gpsBearing`, `destinationPoint`).
- Connections contract shape (D-REV-04, D-ACC-09).

### Reusable assets for the snap step
- `cable-builder.js:minDistancePointToPathOps` — Already iterates M/L/C ops; the same iteration produces the vertex list we need.
- `post-assembler.js:applyPosteHintPositions` — Template for one-to-one greedy assignment with proximity threshold. Snap step has nearly identical structure.
- `coordinate-calculator.js:repairPostsOnUncalibratedPages` — Pattern for "fix posts after primary projection." Snap is the same shape but earlier in the pipeline.

### Established patterns
- ESM modules with named exports only.
- Mutable `warnings[]` accumulator passed through pipeline.
- `flipY` applied per page by `pdf-parser.js` before downstream modules see coordinates — all snap math operates in flipY space.
- All processing is client-side (browser, no Node.js).
- `pageNum` attached to all items for cross-page disambiguation.

### Integration points
- `pdf-parser.js` → `calculateCoordinates(posts, distances, lat1, lon1, cableSegments, opts)` (already wired in `debug-run-calc.mjs`).
- Phase 3 (KMZ generator) consumes `{ posts, connections }` — contract shape unchanged.

</code_context>

<specifics>
## Specific Ideas & Diagnostic Notes (2026-05-18)

- **Effective per-segment scales measured against ground truth:**
  - Page 3, post-to-post: scale varies 0.12–0.50 m/pt; per-segment bearing offset varies −29° to −17° (real route bearing is ~277° everywhere).
  - Page 4, post-to-post: scale varies 0.20–0.37 m/pt; bearing within ~2° of real. So page 4's geometry is fine — page 3 has wildly inconsistent post positions.
  - Conclusion: source of error is the parser-reported `(x, y)` per post, not the transform. This drove D-ACC-01.
- **Current `parser/post-assembler.js` post (x, y) source:** `Numero_Poste` circle centroid, optionally snapped to nearest `Poste` graphical symbol within 150 pt (`POSTE_POSITION_MAX_PT`). Label circles are drafted for readability — not at the actual pole location.
- **Cable polyline vertex extraction:** iterate `cableSegments[i].ops` and collect `op.x, op.y` for every `M` and `L`. Flatten `C` (cubic) ops by sampling control endpoints — most INFOVIAS cables are M/L only.
- **Snap threshold starting point:** 30 PDF pt (≈ 11 m on detail pages at 0.3546 m/pt). Tune via `debug-run-calc.mjs`. Threshold should be larger than the OCR centroid offset but smaller than the typical post-to-post spacing.
- **Anchor input format for 2nd anchor:** same Google Maps paste format as post 01 (`-27.659066, -48.702999`). Optional — UI shows it as collapsed/secondary.
- **Label sanity-check threshold:** warn when `|haversine(curr,next) − label_meters| > max(5m, 10% of label)`.
- **Branch safety reaffirmed:** per-post proximity snap is independent — no chain-walking — so cross-branch scenarios (e.g., page 4–5 = branch A, page 6 = branch B starting near end of page 3) are correct by construction. The one-to-one greedy guard (D-ACC-03) prevents two posts from snapping to the same junction vertex.

</specifics>

<deferred>
## Deferred Ideas

- **Per-page GPS anchors** (one anchor per detail page) — Would guarantee <1 m. Costs significant UI complexity. Revisit only if D-ACC-01 + D-ACC-06 + D-ACC-07 don't hit <5 m on most posts.
- **DMS coordinate format input.**
- **Automatic UTM label extraction** if a future INFOVIAS version adds text labels to the UTM grid.
- **Visual preview of calculated coordinates on a map before KMZ generation (ENH-01).**
- **Using overlapping posts** (posts appearing on both page N and page N+1) as additional cross-page calibration anchors.
- **Full affine solver with per-axis scale** when 2 anchors are provided — only needed if isotropic + 2 anchors doesn't reach <5 m.

</deferred>

---

*Phase: 2-Coordinate Calculator*
*Context revised: 2026-05-18 (accuracy fix decisions D-ACC-01 through D-ACC-09 added)*
