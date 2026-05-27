# Phase 2 Iteration: DWG Base as Authoritative Coordinate Source — Context

**Gathered:** 2026-05-27
**Status:** Ready for research (several open inspections of `siriu.dwg` required before planning)
**Scope:** New architecture branch within Phase 2. Adds DWG-based coordinate sourcing as the **primary** path when a regional DWG covers the user's GPS; the existing PDF-only pipeline (UTM calibration + Viterbi + N1 + label-LSQ) becomes the **fallback** when no DWG match exists.

<domain>
## Phase Boundary

Introduce a per-user **regional DWG library** (cached in browser IndexedDB) that supplies authoritative real-world coordinates for every post in a converted PDF. When the user submits a PDF and the post-01 GPS, the app:

1. Selects the regional DWG whose bbox contains the GPS (spatial lookup).
2. Pairs each PDF post to its corresponding DWG post entity by walking the PDF's logical sequence from the user's GPS anchor.
3. Returns DWG-sourced lat/lon for every paired post.

This iteration does NOT replace the existing PDF coordinate pipeline — it sits in front of it. The PDF pipeline still runs when:

- The user has no regional DWG library, or
- No regional DWG covers the user's GPS, or
- The strict pairing algorithm fails (any PDF post cannot be paired within tolerance).

User question that triggered this iteration: *"Can we get coordinates out of AutoCAD?"* — **Verdict: yes, via DXF export.** Feasibility is high; the main risk is verifying the structural assumptions about `siriu.dwg` (coordinate system, layer names, post entity type — all flagged below as open research questions).

</domain>

<decisions>
## Implementation Decisions

### DWG library architecture

- **D-DWG-AVAIL-01: Coordinates come from user-curated REGIONAL DWGs (city-scale), not per-project files.** Each DWG covers a contiguous region and contains every post in that region. The user produces and maintains these DWGs in AutoCAD.
- **D-DWG-STORAGE-01: Per-user library cached in browser IndexedDB.** User uploads a regional DWG (via DXF) once; the app parses it, indexes it, and caches the parsed result + the source DXF blob in IndexedDB. Subsequent jobs in the same region reuse the cache. **No backend** — preserves the existing client-side-only constraint (`PROJECT.md`).
- **D-DWG-LOOKUP-01: Region selection is driven by the user-submitted post-01 GPS.** Each cached region carries a precomputed bbox in WGS84. The lookup is a simple "which bbox contains this lat/lon" filter; if none match, the PDF-only fallback runs. If multiple match (overlapping regions), prefer the smallest bbox (most specific).
- **D-DWG-LIB-UX-01: Library management is part of the app UI.** User can list, add, rename, and delete regions from a library panel. (Detailed UI lives in Phase 04; this iteration ships a minimal "upload region DXF" affordance.)

### Role vs the existing PDF pipeline

- **D-DWG-ROLE-01: When a regional DWG covers the user's GPS, the DWG is AUTHORITATIVE for every post's lat/lon.** The PDF coordinate calc pipeline (UTM calibration, Viterbi-HMM, N1 cable-arc walk, label-LSQ) is **bypassed** for the GPS step. The PDF still supplies post numbers, connections, cable identity (`Cabo Projetado`), gap/branch topology, and the user's post-01 GPS anchor.
- **D-DWG-FALLBACK-01: When no regional DWG covers the user's GPS, or library is empty, or strict pairing fails, run the existing PDF pipeline as today.** The two pipelines coexist; DWG is the high-accuracy default when available, PDF-only is the always-works fallback.
- **D-DWG-COEXIST-01: All current Phase 02 decisions remain in force for the fallback path.** See `02-CONTEXT.md` (N1+Viterbi iteration), `02-POSTS9-11-CONTEXT.md` (Posts 9-11 sub-iteration). No regressions allowed in the PDF-only path: Valmor G-1 (11/11 <5m) and João Born session-7 gains must remain.

### Ingestion format

- **D-DWG-FMT-01: User uploads DXF, NOT raw DWG.** User exports their regional DWG to DXF (`Save As → AutoCAD DXF`) once per region update. DXF is ASCII, mature browser parsers exist (e.g., `dxf-parser`), and lossless for the entities we need (POINT / INSERT / LWPOLYLINE on named layers). Raw DWG parsing is rejected: limited browser library support for AutoCAD 2018+ and significantly larger app payload.
- **D-DWG-FMT-02: DXF version expected — AutoCAD 2018 or newer.** `siriu.dwg` reports as AutoCAD 2018/2019/2020; DXF export from that version is `AC1032`. Parser library must support `AC1032` or fall back gracefully (Claude's discretion at planning time which library: `dxf-parser`, `@dxfjs/parser`, or hand-rolled subset).

### Post identification and pairing algorithm

- **D-DWG-POST-01: DWG posts are unidentified symbols on a dedicated layer** (likely `Poste` or similar — exact name flagged as research question R-DWG-02 below). NO embedded post number / tag attribute. Therefore post identity comes from spatial pairing to the PDF.
- **D-DWG-CABLE-01: DWG cable layer is `TrechoSecundarioAereo`** — the physical city-wide secondary aerial cable connecting most posts. **This is NOT equivalent to the PDF's `Cabo Projetado` layer** — `Cabo Projetado` carries the project-specific routing (with gaps and branches) while `TrechoSecundarioAereo` is the underlying real-world cable network. The DWG cable is a **topological hint** (posts on it are more likely real route posts), not a substitute for PDF routing order.
- **D-DWG-PAIR-01: Pairing is STRICT** — every PDF post must find a DWG match within tolerance, or the whole DWG run fails and falls back to the PDF-only pipeline. No partial / hybrid results. Rationale: a regional DWG that the user curates is expected to be complete; a partial match probably means we picked the wrong region or the PDF/DWG are out of sync, both of which warrant falling back rather than silently mixing accuracy sources.
- **D-DWG-PAIR-02: Pairing algorithm — anchor + PDF-topology walk:**
  1. Convert user GPS → UTM (using whatever CRS the DWG uses; see R-DWG-01).
  2. Find the DWG post-layer entity closest to that UTM point; call it `dwg[1]` (corresponds to PDF post 01). If distance > tolerance, fail.
  3. For each subsequent PDF post `i` (in PDF's logical order, following connections + branches + gaps):
     - Predict its UTM position using `dwg[i-1] + PDF bearing(i-1, i) + PDF distance(i-1, i)`.
     - Find the closest DWG post-layer entity to the predicted point.
     - If within tolerance, accept as `dwg[i]`; else fail.
  4. Prefer DWG entities lying on `TrechoSecundarioAereo` polylines when multiple candidates fall inside the tolerance window.
- **D-DWG-PAIR-03: Pairing tolerance — Claude's discretion at research/planning time** (start ~15 m, tune empirically using `siriu.dwg` + `coordenadas postes siriu.txt` ground truth). Tolerance must be large enough to absorb PDF bearing/distance noise but small enough to disambiguate posts on a dense urban grid.
- **D-DWG-PAIR-04: Branch handling.** When PDF reports a branch (post X → post Y AND post X → post Z), the algorithm pairs both downstream walks independently from `dwg[X]`. Standard branch logic from `coordinate-calculator.js` is reused for sequence; only the per-post coordinate lookup changes.
- **D-DWG-PAIR-05: Gap handling.** When PDF reports a gap (route stops, resumes later), the resumption post must still be found within tolerance of its predicted position. If the gap is long and bearing extrapolation drifts, accept a wider tolerance window for the first post after the gap (Claude's discretion).

### Failure modes and observability

- **D-DWG-FAIL-01: On strict-pairing failure, emit a structured warning** (`{ kind: "dwg-pair-fail", at_post: N, predicted: {lat,lon}, nearest_dwg_distance_m: X, tolerance_m: Y }`) and fall back to the PDF-only pipeline transparently. User sees: "DWG match incomplete — falling back to PDF coordinates."
- **D-DWG-FAIL-02: Pairing diagnostics in dev mode.** A debug harness mirrored on `debug-run-calc.mjs` should run the DWG path against `siriu.dwg` + `coordenadas postes siriu.txt` and report per-post pairing distance + final GPS error. Acceptance gate: DWG-sourced GPS within ~1 m of ground truth (effectively cartographic precision of the DWG itself).

### Done criteria

- **D-DWG-DONE-01: DWG path delivers < 1 m max error vs the project's own DWG** (the DWG IS the ground truth). The real-world accuracy ceiling is set by how accurately the user surveyed/drafted the DWG.
- **D-DWG-DONE-02: Siriu sample (siriu.dwg) is the G-3 reference target.** All 30+ posts in `coordenadas postes siriu.txt` must pair successfully and produce GPS within the DWG's drafting precision.
- **D-DWG-DONE-03: Valmor + João Born continue to validate the PDF-only fallback path.** Adding DWG must NOT touch / regress the PDF-only G-1 (Valmor 11/11 <5m) or current João Born gains.

</decisions>

<open_research>
## Open Questions — Researcher MUST resolve before planning

These were flagged "I'm not sure — verify on siriu.dwg" during discussion and decision-locking deferred to research.

- **R-DWG-01: Coordinate system of `siriu.dwg`.**
  - Hypothesis: UTM SIRGAS-2000 zone 22S (entity X = Easting m, Y = Northing m). Standard for Brazilian telecom drafting in SC.
  - Verification path: convert `siriu.dwg` → DXF (any free DWG viewer / LibreCAD / ODA File Converter); inspect `$INSUNITS` header, look for `AcDbGeoData` / `GEORICOOR` dictionary, sample a Poste entity's (X, Y) and check if it matches the known UTM of a ground-truth post in `coordenadas postes siriu.txt`.
  - Fallback if not UTM: read AcDbGeoData transform; or ask user to declare the CRS at upload time.

- **R-DWG-02: Exact layer name and entity type for posts in `siriu.dwg`.**
  - Hypothesis: a layer named `Poste` (or similar) with INSERT entities referencing a block (or raw POINTs / CIRCLEs).
  - Verification path: list all layers in the DXF; for each, count entity types; identify the layer whose entity count ≈ post count for the region.
  - Output: lock the layer name in implementation; if it varies across regions, expose as a per-region setting at upload time.

- **R-DWG-03: Exact layer name and geometry type for the secondary cable.**
  - User-confirmed name: `TrechoSecundarioAereo`. Verify spelling/case on actual DXF and confirm geometry is LWPOLYLINE / POLYLINE / LINE chain.

- **R-DWG-04: DXF parser library selection.**
  - Candidates: `dxf-parser` (npm, BSD, mature, supports AC1032), `@dxfjs/parser`, hand-rolled subset reader.
  - Selection criteria: AC1032 support, browser bundle size, INSERT + LWPOLYLINE coverage, license compatibility.

- **R-DWG-05: IndexedDB storage approach for the regional library.**
  - Should we cache (a) raw DXF blob only and re-parse on each session, (b) parsed entities + spatial index only, or (c) both?
  - Trade-off: blob is small (DXF ~few MB) but parse cost; parsed structure is fast but possibly larger and tied to parser schema.
  - Researcher proposes; planner locks.

- **R-DWG-06: Spatial index choice for bbox lookup and nearest-neighbour pairing.**
  - For region selection: a flat list of regions with bbox check is fine until ~hundreds of regions.
  - For pairing: per-region kd-tree / R-tree of post coordinates for nearest-neighbour queries inside tolerance.
  - Library choice (e.g., `rbush`, custom kd-tree) is Claude's discretion at planning.

</open_research>

<canonical_refs>
## Canonical References

Downstream agents (researcher, planner, executor) MUST read these before planning or implementing DWG support. Existing Phase 02 refs in `02-CONTEXT.md` and `02-POSTS9-11-CONTEXT.md` remain authoritative for the **fallback** PDF-only path.

### New DWG-iteration inputs (sample artifacts)

- `siriu.dwg` — Reference regional DWG, AutoCAD 2018+, ~2.8 MB. Researcher must convert to DXF and inspect.
- `siriu.dwl`, `siriu.dwl2` — AutoCAD lock files (ignore).
- `coordenadas postes siriu.txt` — Ground-truth GPS for the Siriu project (30+ posts). Used as the DWG-path G-3 reference target.
- `coordenadas postes rua luiz carolino pereira..txt` — Secondary ground truth (Luiz Carolino route).

### Phase 02 existing carry-overs (govern the fallback path; unchanged)

- `.planning/phases/02-coordinate-calculator/02-CONTEXT.md` — N1+Viterbi iteration decisions.
- `.planning/phases/02-coordinate-calculator/02-POSTS9-11-CONTEXT.md` — Posts 9-11 sub-iteration.
- `.planning/phases/02-coordinate-calculator/.continue-here.md` — Blocking anti-patterns (Poste text vs route digits; pure isotropic UTM replace).
- `.planning/phases/02-coordinate-calculator/02-VERIFICATION.md` — Palhoça / Valmor verification data; UTM constants; ground truth comparison.

### Phase 01 output contract (input to DWG pairing)

- `parser/pdf-parser.js` — `parsePdf()` returns `{ posts, distances, cableSegments, connections, ... }`. The DWG path consumes `posts[]` (for ordering / connections) and the user's GPS anchor; it does NOT consume `cableSegments` or `utmGridPathsPerPage` for the GPS computation itself.
- `parser/coordinate-calculator.js` — The current entrypoint that the DWG path branches in front of. The DWG implementation should wrap, not replace, this module (`calculateCoordinatesWithDwg(...)` → tries DWG, falls back to `calculateCoordinates(...)`).
- `parser/geo/utm-calibrator.js` — UTM ↔ lat/lon math will be reused for the DWG path (converting DWG UTM entity coords back to WGS84 lat/lon).

### Project reference

- `.planning/PROJECT.md` — Reaffirms client-side-only constraint. DWG library architecture (D-DWG-STORAGE-01) must respect this.
- `.planning/REQUIREMENTS.md` — COORD-01..COORD-05. DWG path satisfies the same requirements as the PDF path; no new requirements introduced.
- `.planning/ROADMAP.md` — DWG work fits inside Phase 02 scope ("GPS coordinate calculation from a user-provided starting point") — the mechanism changes but the goal does not.

</canonical_refs>

<code_context>
## Existing Code Insights

### What this iteration adds (DWG path)

- `parser/dwg/` (new directory) —
  - `dxf-loader.js` — parse DXF, extract Poste-layer entities + cable polylines.
  - `region-library.js` — IndexedDB CRUD for the regional library (add region, list, lookup-by-bbox, delete).
  - `region-pairing.js` — strict pairing algorithm (D-DWG-PAIR-02): anchor + PDF-topology walk against a region's spatial index.
  - `coordinate-calculator-dwg.js` — orchestrator. Branches on library hit → pairing → result or fallback to existing `calculateCoordinates`.
- `parser/__tests__/region-pairing.test.mjs` (new) — fixtures from `siriu.dwg` DXF + `coordenadas postes siriu.txt`.
- `debug-run-calc-dwg.mjs` (new, parallel to `debug-run-calc.mjs`) — end-to-end DWG path accuracy harness.

### What stays the same

- Entire PDF parser pipeline (`parser/pdf-parser.js`, OCR, `assemblePostsFromOcr`, `applyPosteHintPositions`, `buildCableSegments`, `post-positioning.js`, `cable-arc-placer.js`, `coordinate-calculator.js`).
- `parseCoordinateInput`, `validateBrazilBounds`, `detectRouteTopology`, `detectGaps`.
- UTM ↔ GPS math.
- Connections contract shape (`{ from, to, meters, bearing, gap, cross_page? }`).
- Phase 01 → Phase 02 → Phase 03 boundaries.
- All N1 / Viterbi / N4 / N6 / label-LSQ logic — preserved as the fallback path; non-regression invariants (D-DONE-03 in `02-CONTEXT.md`; D-P911-03 in `02-POSTS9-11-CONTEXT.md`) still apply.

### Reusable assets

- `parser/geo/utm-calibrator.js` — `utmToLatLon` (DWG entity UTM → WGS84) and `latLonToUtm` (user GPS → query point for kd-tree lookup).
- `parser/coordinate-calculator.js` — topology / branch / gap walking logic reused for PDF-order traversal.
- Existing `warnings[]` accumulator pattern — DWG path emits its own kinds (`dwg-pair-fail`, `dwg-region-miss`, `dwg-tolerance-exceeded`).

### Established patterns

- ESM modules, named exports only.
- Browser + Node parity (DXF parser must work in both — `dxf-parser` is pure JS, fine).
- No `fs` / `Buffer` / Node-only globals in `parser/` modules. IndexedDB access lives behind a thin adapter so tests can mock it under Node (e.g., `fake-indexeddb`).
- G-1 / G-2 gates remain mandatory; G-3 (DWG path on `siriu.dwg`) is added.

### Integration points

- `pdf-parser.js` → `calculateCoordinatesWithDwg(posts, distances, lat1, lon1, cableSegments, opts, regionLibrary?)`. If `regionLibrary` is provided and contains a matching region, runs DWG path; else delegates to `calculateCoordinates(...)` unchanged.
- Phase 03 (KMZ generator) consumes the same `{ posts, connections }` shape regardless of source.

</code_context>

<specifics>
## Specific Notes from Discussion

- **User's reframing of "where do DWGs come from":** Originally the question implied per-project DWG files. The user clarified mid-discussion that they plan to **author large regional DWGs (city-scale)** themselves, then the app picks the right region for each PDF job. This is closer to a personal GIS library than a per-project workflow.
- **`TrechoSecundarioAereo` vs `Cabo Projetado` distinction is critical.** They are NOT the same cable. Treating the DWG's secondary aerial as if it were the PDF's projected fiber routing would produce wrong adjacency. The DWG cable is a topological hint for pairing; PDF routing remains authoritative for connections.
- **Coordinate system unknown.** User answered "I'm not sure" to whether `siriu.dwg` uses UTM directly or has a georeferencing transform. Discussion proceeded under the assumption "UTM SIRGAS-2000 zone 22S" (regional standard) with verification flagged as R-DWG-01.
- **Strict pairing chosen over best-effort.** Rationale: regional DWGs are user-curated, so a partial match probably means wrong-region or PDF/DWG drift — both should fall back to the PDF pipeline rather than silently mix sources.
- **DXF parser library deliberately left to research/planning.** Several candidates; selection depends on AC1032 support and bundle size, which researcher will benchmark.
- **DWG-path accuracy ceiling is the DWG itself.** Unlike the PDF path (where accuracy is limited by OCR + drafting + bearing inference), the DWG path's ceiling is the surveyed precision of the user's drafting. If the user surveys posts to GPS-accuracy, the output is GPS-accurate.
- **No new requirements.** This is a different mechanism to satisfy the same COORD-01..05 requirements — the roadmap goal is unchanged.

</specifics>

<deferred>
## Deferred Ideas

- **Multi-region DWGs per project.** Long routes that span two regional DWGs. Out of scope for this iteration; first ship single-region case. Possible future: chain pairing across adjacent regions seamlessly.
- **Server-hosted DWG library.** If the user wants to share regions across multiple users / devices, IndexedDB-only is insufficient. Out of scope (would break client-side-only constraint).
- **Auto-detect UTM zone from DWG bbox.** Currently researcher will lock the zone at upload time. Auto-detection from coordinate magnitudes / bbox lat/lon is a nice-to-have.
- **Hybrid (DWG anchors + PDF interpolation) and outlier-snap modes from the original option set** — preserved here in case strict pairing proves too brittle and we want a fall-back-within-fall-back design later.
- **Interactive pairing UI** — when strict pairing fails, show the conflict and let the user pick the right DWG entity. Belongs in Phase 04; defer until DWG path ships and we have failure data.
- **Coordinate library beyond Brazil** — multi-zone UTM, other datums. Not in v1.

</deferred>

---

*Phase: 2-Coordinate Calculator (DWG iteration)*
*Context gathered: 2026-05-27*
*Status: Pending research on `siriu.dwg` (R-DWG-01..R-DWG-06) before planning can lock the implementation.*
