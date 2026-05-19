# Phase 2: Coordinate Calculator - Context

**Gathered:** 2026-05-15 (original) / 2026-05-18 (accuracy revision) / 2026-05-19 (N1+Viterbi revision)
**Status:** Ready for planning — N1+Viterbi iteration

<domain>
## Phase Boundary

Implement GPS coordinate calculation for all extracted posts using a UTM-grid-based per-page calibration approach. Starting from a user-provided GPS for post #1, calibrate each detail page's coordinate system from the UTM grid and viewport layout visible on page 2 (overview), then project every post's GPS directly from its page-local PDF position — no sequential GPS chaining within a page. Handle branching routes and route gaps. Output enriched posts with lat/lon and a connections array for Phase 3.

**Current accuracy state (2026-05-19):**
- Valmor G-1 baseline: 4.19m max, 11/11 < 5m ✓ (preserved through all N3–N6 iterations)
- João Born: ~53m max 1-anchor — G-2 requires max <10m / 25+/33 < 5m (not yet met)
- N3 (beam search), N4 (rotation LSQ), N5 (grid affine), N6 (cable similarity) all implemented but insufficient
- N1 (cable arc-length walk) exists in `cable-arc-placer.js` but is **opt-in only** — this is the next primary fix

**2026-05-19 iteration goal:** Enable N1 as default + replace N3 beam search with Viterbi-HMM → João Born stretch goal: max <5m, 1-anchor.

</domain>

<decisions>
## Implementation Decisions

### N1 — Cable arc-length walk (primary accuracy fix)

- **D-N1-01: Remove `enableCableArcPlacer` opt-in gate. N1 is default ON** whenever `Cabo Projetado` is detected on the page. The opt-in flag becomes dead code and should be deleted.
- **D-N1-02: Arc anchor input = pole symbol position (post.x/post.y), NOT anchorX/anchorY.** The pole symbol is the semantic target; the label centroid is incidental. N1 snaps the pole position to the nearest cable point — a few-meter snap error only shifts the arc-length anchor, which subsequent arc-walk and label-LSQ corrects.
  - Note: D-N1-02 depends on Viterbi (D-V-01) having correctly assigned the symbol first. With Viterbi, post.x/post.y is the correctly assigned symbol position. Without Viterbi, anchorX/anchorY may be more accurate (as seen in N2 revert).
- **D-N1-03: Missing-label fallback = `augmentCrossPageDistances()`.** When a Distância_Poste label is absent for a post pair (cross-page seam or unlabeled segment), use the Euclidean-derived estimate already computed by `augmentCrossPageDistances()`. Zero new code needed.
- **D-N1-04: N1 does NOT chain across pages.** Each page uses its own cable and its own scale. Cross-page consistency comes from per-page projection (`projectPost`), not from arc-length chaining.
- **D-N1-05: Tap poles are excluded from N1.** `isOffRouteCablePost(post, postByNum, cablesByPage)` is the canonical detector. Tap poles retain their `post-positioning.js` snap and are not overwritten.

### Viterbi-HMM (N3 replacement)

- **D-V-01: Replace beam search with full Viterbi-HMM** in `assignPolesGloballyByLabels()` in `parser/post-positioning.js`. Full O(n×k²) Viterbi — ~30 lines of plain JS, no external library. Never prunes the correct branch (unlike beam search width=8).
  - Emission: Gaussian on distance from label anchor to symbol candidate
  - Transition: exponential on |arcLen(sym_k, sym_j) × scale − label_m(i, i+1)| — the arc-length term beam search was missing
  - The old `assignPolesGloballyByLabels` beam-search body is replaced; the function signature stays the same. Keep `assignPostPositionsFromPosteSymbols` as a no-distMap fallback.
- **D-V-02: Use Viterbi for BOTH full assignment AND anchor selection (post 1 per page).** For anchor selection, use a short lattice: k=5 candidates, first 3 posts on the page. This replaces the greedy nearest-cable-snap for the anchor post.
- **D-V-03: Parameters — Claude's discretion based on João Born geometry.** João Born page 3 posts are ~35m apart; distance labels accurate to 0.1m. Recommended starting values:
  - `sigma = 20 PDF pt` (~7m) — emission noise; wider than web research's 15pt to account for OCR label drift on dense pages
  - `beta = 5m` — transition tolerance; tighter than web research's 15m to enforce cable order on a straight route
  - Expose as named module-level constants (`VITERBI_SIGMA_PT`, `VITERBI_BETA_M`) — one-line tuning, no refactor
  - Tune empirically via `debug-run-calc.mjs` after implementation

### Phase 01 symbol filtering (144-symbol noise reduction)

- **D-SYM-01: Tighten cable-proximity threshold for Poste symbol candidates in Phase 01 from 150 pt to 60 pt (~22m).** This reduces João Born page 3 from 144 candidates to approximately 14 (one per route post) before Viterbi even runs. The tight threshold eliminates off-route building symbols and tap poles from the candidate set.
  - Applies to `assignPostPositionsFromPosteSymbols` / `assignPolesGloballyByLabels` candidate filtering in `post-positioning.js`.
  - If a valid post's nearest cable distance exceeds 60 pt, emit a warning and fall back to the 150 pt threshold for that post.
- **D-SYM-02: Add a warning** when a post's nearest cable distance > 50 pt after final assignment. This flags cases where the threshold may be too tight for a particular PDF without breaking the pipeline.

### N2 root cause diagnostic (prerequisite to N1 implementation)

- **D-N2-01: Before implementing N1, add a unit test for `assignPostPositionsFromPosteSymbols` on Valmor page-4 cases.** Write a test fixture with the Valmor page-4 Poste symbols (from `debug_results.txt`) and the known correct assignment (from `coordenadas postes.txt`). The test should confirm which page-4 posts are being snapped to wrong symbols vs correct symbols.
  - Location: `parser/__tests__/post-positioning.test.mjs` (existing test file)
  - This diagnoses WHY N2 regressed Valmor page 4 and validates that Viterbi (D-V-01) fixes the assignment before N1 relies on it.

### Phase 02 done criteria

- **D-DONE-01: Primary close-out = João Born 1-anchor stretch goal:** max <5m, 30+/33 < 5m.
- **D-DONE-02: Acceptable fallback** if N1+Viterbi+N4 stack is exhausted and stretch is not reached: accept max <8m as Phase 02 close. Document the remaining gap in VERIFICATION.md.
- **D-DONE-03: Valmor G-1 is non-negotiable throughout** — 11/11 < 5m, max < 5m after every change. Any regression triggers immediate revert (no exceptions).
- **D-DONE-04: Luiz Carolino and Siriu are NOT blockers for Phase 02 close.** They are validation targets for a follow-up plan, not Phase 02 success criteria.

### Accuracy fix (2026-05-18) — Poste pole symbols as PDF position (verified, still active)

- **D-ACC-10: Canonical post (x, y) from Poste-layer pole symbol centroids (2026-05-18, verified).** `assignPostPositionsFromPosteSymbols()` in `post-positioning.js` matches raw Poste centroids using: label proximity (≤100 pt), label near Cabo Projetado (≤95 pt), same-polyline arc (≤150 pt → NOW 60 pt per D-SYM-01), one-to-one greedy assignment; relaxed arc + label-only fallbacks for branches. `calculateCoordinates()` does **not** re-snap posts to cable vertices — N1 does the walk instead. Palhoça UAT: max error 4.19 m, 11/11 < 5 m.

### Accuracy fix (2026-05-18) — partially superseded decisions

- **D-ACC-01 through D-ACC-09:** See `02-CONTEXT.md` revision 2026-05-18. Key surviving decisions:
  - D-ACC-08: Distance labels = sanity-check only after GPS computed (haversine vs label_meters). Still active.
  - D-ACC-09: Connections contract `{ from, to, meters, bearing, gap, cross_page? }` — unchanged.
  - D-ACC-07: Optional 2nd GPS anchor (post 01 + last post) — still deferred from Phase 04 UI.
- **D-ACC-06 (per-page UTM isotropic scale):** Still active for pages where N1 is skipped (no cable). For N1-covered pages, scale is used by `cable-arc-placer.js:perPageScale` to convert label meters → PDF points.

### Algorithm pivot (2026-05-15) — per-page UTM calibration

- **D-REV-01 through D-REV-15:** All still active. See `02-CONTEXT.md` revision 2026-05-15. No changes.

### Decisions SUPERSEDED

- ~~N3 beam search (width 8)~~ — Replaced by Viterbi-HMM per D-V-01.
- ~~`enableCableArcPlacer` opt-in gate~~ — Removed per D-N1-01.
- ~~Hybrid X/Y scale~~ — Already superseded by D-ACC-06.
- **N2 (pole position for GPS projection):** REVERTED — Valmor page 4 regressed (6/11 → 11/11 revert). Root cause: some page-4 Poste symbols were mis-assigned, making anchorX/anchorY more accurate than post.x/post.y for those posts. See D-N2-01 for diagnostic plan.

### Claude's Discretion

- Viterbi parameters: start at sigma=20pt, beta=5m per D-V-03. Tune empirically.
- Which cable to use as route cable when multiple Cabo Projetado paths exist on a page: pick the one whose `nearestPointOnPathOps` distance to the **first on-route post** is smallest and ≤ 80 pt (existing logic in `cable-arc-placer.js`).
- When N1's arc-length overshot the cable (`arc-overflow`): keep the original pole position, emit a warning, and let label-LSQ carry the post.
- Walk backward from the page anchor when the lowest-numbered on-route post is not sequence-first (rare but possible after future plan changes).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Research — current iteration

- `.planning/quick/20260519-web-research-accuracy/20260519-RESEARCH.md` — Viterbi-HMM formulation, arc-length parameterization, PDF precision analysis, SIRGAS-2000 confirmation. **Primary source for D-V-01 and D-N1-01.**
- `.planning/quick/20260519-web-research-accuracy/20260519-SUMMARY.md` — Priority order: N1 default → Viterbi → Hungarian (tap poles). Key finding: Viterbi with arc-length transition beats beam search by never pruning.
- `.planning/quick/20260519-coord-misplacement-research/PLAN.md` — N1–N7 implementation plan, gate conditions (G-1/G-2), invariants, effort estimates. N2 status: REVERTED. N3/N4/N5/N6 status: implemented, João Born still ~53m.
- `.planning/quick/20260519-coord-misplacement-research/SUMMARY.md` — Root cause analysis for N2 revert; N6 RMSE gate rejections; N7 dropped (no UTM labels).
- `.planning/quick/20260518-fix-posts-3-4-9-accuracy/` — Prior accuracy iteration artifacts (if present).

### Phase 02 carry-overs (still authoritative)

- `.planning/phases/02-coordinate-calculator/02-RESEARCH.md` — UTM math, SIRGAS constants, page-2 viewport calibration approach.
- `.planning/phases/02-coordinate-calculator/.continue-here.md` — Blocking anti-patterns: Poste text vs route digits (blocking), pure isotropic UTM replace (blocking — note: isotropic is now valid WITH D-ACC-01 positions; the ban applied to old OCR centroids). Also contains current_state metrics.
- `.planning/phases/02-coordinate-calculator/02-VERIFICATION.md` — Palhoça/Valmor verification data; UTM constants; ground truth comparison.
- `.planning/HANDOFF.json` — Accuracy iteration tasks, baseline metrics.

### Phase 01 output contract (input to Phase 02)

- `parser/pdf-parser.js` — `parsePdf()` orchestrator. Returns `{ posts, distances, cableSegments, warnings, layerMap, utmGridPathsPerPage, viewportBoxes, pageDimensions, distanceLabelItems }`. Phase 02 consumes `posts[]`, `cableSegments[]`, `utmGridPathsPerPage`, `viewportBoxes`, `pageDimensions`.
- `parser/post-assembler.js` — `assemblePostsFromOcr`, `applyPosteHintPositions`. Posts come out with OCR-derived `(x, y)` then Poste-symbol-snapped positions.
- `parser/post-positioning.js` — `assignPostPositionsFromPosteSymbols`, `assignPolesGloballyByLabels`. **Site of D-V-01 and D-SYM-01 changes:** Viterbi replaces beam search; 60pt cable-proximity threshold.
- `parser/cable-builder.js` — `buildCableSegments`, `detectBranches`, `minDistancePointToCablesOnPage`, `isOffRouteCablePost`, `pointAtArcLength`. **Key exports for N1.** Each `cableSegment.ops` contains M/L/C operations — M and L carry polyline vertices.
- `parser/coordinate-calculator.js` — Current implementation. **Site of D-N1-01/D-N1-04 wiring:** `placePostsOnCableByArcLength` called after `buildPageTransforms`, before projection loop. Remove `enableCableArcPlacer` gate.
- `parser/geo/utm-calibrator.js` — `buildPageTransforms`, `projectPost`, `dominantLineOrientation`, `theta` per page (N4). Read before touching transforms.
- `parser/geo/cable-arc-placer.js` — Existing N1 module (currently opt-in). **Site of D-N1-01 default-on change.**
- `parser/geo/label-lsq-calibrator.js` — LSQ label refinement, `augmentCrossPageDistances`. Used by N1 for missing-label fallback (D-N1-03).
- `parser/layer-sources.js` — `isUtmGridLayerName`, `isCableLayerName`. No changes needed.

### Tests (must pass after every change)

- `parser/__tests__/post-positioning.test.mjs` — **Add D-N2-01 Valmor page-4 fixture here.** Existing tests cover current `assignPostPositionsFromPosteSymbols`.
- `parser/__tests__/coordinate-calculator.test.mjs` — 20/20 passing. Must remain green.

### Debug & validation harness (MUST run after each change)

- `debug-run-calc.mjs` — End-to-end accuracy vs ground truth. Run after every change. G-1: Valmor max <5m, 11/11. G-2: João Born 1-anchor max <10m, 25+/33 <5m; stretch max <5m.
- `debug_results.txt` — Latest parser dump (post positions, viewport boxes, UTM grid stats).
- `coordenadas postes.txt` — Ground-truth GPS for posts 01–11 (Palhoça/Valmor sample).
- `INFOVIAS_PJC INTERNET_Palhoça_RUA VALMOR FRANCISCO_v1.pdf` — Valmor sample PDF (G-1 reference).

### Project reference

- `.planning/PROJECT.md` — Scope (client-side only, KMZ output).
- `.planning/REQUIREMENTS.md` — COORD-01 through COORD-05.
- `.planning/phases/01-pdf-parser-engine/01-CONTEXT.md` — Phase 01 decisions.

</canonical_refs>

<code_context>
## Existing Code Insights

### What changes in this iteration (N1+Viterbi scope)

- `parser/post-positioning.js` — Replace beam search in `assignPolesGloballyByLabels` with Viterbi-HMM (D-V-01). Add unit test fixture for Valmor page-4 (D-N2-01). Tighten cable-proximity from 150 pt to 60 pt (D-SYM-01).
- `parser/geo/cable-arc-placer.js` — Remove `enableCableArcPlacer` check; N1 runs by default when cable is detected (D-N1-01). Arc anchor input: post.x/post.y → cable snap (D-N1-02).
- `parser/coordinate-calculator.js` — Remove opt-in gate for `placePostsOnCableByArcLength`. Ensure the call site passes pole positions (D-N1-02).
- `parser/__tests__/post-positioning.test.mjs` — Add Valmor page-4 fixture test (D-N2-01).

### What stays the same

- Phase 01 parser pipeline (`parsePdf`, `assemblePostsFromOcr`, `applyPosteHintPositions`, `buildCableSegments`).
- `parseCoordinateInput()`, `validateBrazilBounds()` — user input parsing.
- `detectRouteTopology()`, `detectGaps()` — branch & gap detection.
- UTM ↔ GPS math (`latLonToUtm`, `utmToLatLon`, `haversineMeters`, `gpsBearing`, `destinationPoint`).
- Connections contract shape (D-ACC-09). Output: `{ from, to, meters, bearing, gap, cross_page? }`.
- N4 (per-page rotation) and N6 (cable similarity) remain wired as they are. N5 remains inactive (no pages pass RMSE gate).

### Reusable assets

- `cable-builder.js:pointAtArcLength` — already implements the arc-length walk N1 uses.
- `cable-builder.js:nearestPointOnPathOps` — used for cable-snap in anchor selection.
- `cable-builder.js:isOffRouteCablePost` — tap pole detector (D-N1-05).
- `label-lsq-calibrator.js:augmentCrossPageDistances` — missing-label fallback (D-N1-03).
- `post-positioning.js:assignPostPositionsFromPosteSymbols` — kept as no-distMap fallback when Viterbi cannot run.

### Established patterns

- ESM modules with named exports only.
- Mutable `warnings[]` accumulator passed through pipeline.
- `flipY` applied per page by `pdf-parser.js` — all N1/Viterbi math operates in flipY space.
- Browser + Node parity required (no `fs`, no `Buffer`, no Node-only globals).
- G-1 gate: run `node debug-run-calc.mjs` after every change; revert immediately if Valmor regresses.

### Integration points

- `pdf-parser.js` → `calculateCoordinates(posts, distances, lat1, lon1, cableSegments, opts)`.
- Phase 03 (KMZ generator) consumes `{ posts, connections }` — contract shape unchanged.

</code_context>

<specifics>
## Specific Notes (2026-05-19 discussion)

- **144-symbol root cause:** João Born page 3 has 144 Poste symbols vs 14 route posts (10:1 false candidate ratio). Tightening to 60 pt cable-proximity threshold in Phase 01 should reduce this to ~14 candidates before Viterbi runs, making the assignment problem tractable.
- **N1 arc anchor is semantic:** The pole symbol IS on the cable. The label centroid is drafted for readability (offset for visual clarity). Using pole position for cable snap is correct semantically; the few-meter snap variance is corrected by the arc-length walk itself.
- **Viterbi arc-length transition term is the key:** N3 beam search failed because it scored on bearing and proximity without penalizing arc-length deviations. Viterbi's transition term `exp(-|arcLen×scale − label_m| / beta)` enforces cable order and distance consistency simultaneously.
- **N2 revert root cause:** For Valmor page 4 posts 7–11, `anchorX/anchorY` (OCR label centroid set by `attachMarkerAnchors`) was more accurate than `post.x/post.y` (Poste-symbol-snapped). This means D-ACC-10 ("pole symbols are canonical") does not hold empirically for those posts — the Poste-symbol snap picked wrong symbols. Viterbi should fix this; the D-N2-01 unit test will confirm.
- **Anchor priority for N1:** D-N1-02 and D-N2-01 are sequenced: first add the unit test to understand the page-4 mismatch, then implement Viterbi (which fixes it), then wire N1 to use the now-correct post.x/post.y. If Viterbi still doesn't fix page-4, fall back to anchorX/anchorY for the cable snap.
- **João Born harness:** `node debug-run-calc.mjs joao-born` and `node debug-run-calc.mjs joao-born --two-anchor` are the G-2 checks. Current baseline: ~53m / ~49m two-anchor (N3+N4+N6 active).

</specifics>

<deferred>
## Deferred Ideas

- **Per-page GPS anchors** — one anchor per detail page guarantees <1 m but costs significant UI complexity. Revisit only if N1+Viterbi+N4 can't hit <8m.
- **Luiz Carolino + Siriu harness validation** — add to `debug-run-calc.mjs` as follow-up to Phase 02 close. Siriu (6-sheet, ~85 posts) may need Kalman smoothing (N1 walk drift over long routes).
- **Kalman filter (1D)** — for Siriu arc-length drift. Deferred until Siriu is in the harness.
- **N8 multi-anchor UI** — multiple GPS anchors per sheet. Deferred until the N1+Viterbi+N4 stack is exhausted.
- **Hungarian for tap poles** — web research recommends `munkres-js` for unordered tap-pole assignment. Current greedy snap is sufficient for Valmor; evaluate after João Born is closed.
- **DMS coordinate format input.**
- **Visual preview of calculated coordinates on a map before KMZ generation (ENH-01).**
- **Full affine solver with per-axis scale** when 2 anchors are provided — only if isotropic + 2 anchors doesn't reach <5 m.

</deferred>

---

*Phase: 2-Coordinate Calculator*
*Context revised: 2026-05-19 (N1 default + Viterbi-HMM decisions; research from 20260519-web-research-accuracy and 20260519-coord-misplacement-research)*
