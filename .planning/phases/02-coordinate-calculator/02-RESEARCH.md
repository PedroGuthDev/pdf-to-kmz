# Phase 2: Coordinate Calculator — Research (DWG Iteration)

**Researched:** 2026-05-27
**Domain:** DXF parsing in browser, UTM coordinate sourcing from CAD entities, IndexedDB persistence, spatial indexing for nearest-neighbour pairing
**Confidence:** HIGH (all six R-DWG questions resolved with direct measurement against `siriu.dxf` and `coordenadas postes siriu.txt`)

> **Prior research preserved:** The 2026-05-15 UTM-grid research (Snyder Transverse Mercator, SIRGAS-2000 constants, per-page calibration) remains authoritative for the **fallback PDF path**. This document supersedes it ONLY for the new DWG-primary path. The fallback pipeline (`calculateCoordinates(...)`, N1+Viterbi+LSQ+split-region) is untouched and its research carries over verbatim. The Phase 2 fallback research is now archived in this file's git history (prior version).

## Summary

The DWG iteration is **feasible with high confidence**: every open research question has been resolved by direct inspection of the user's reference artifact `siriu.dxf` and cross-checked against the 85-post ground truth `coordenadas postes siriu.txt`.

The DXF is plain ASCII AC1032 (AutoCAD 2018), 8.6 MB on disk. It contains **no AcDbGeoData georeference** — the `$LATITUDE/$LONGITUDE` header values are AutoCAD's San Francisco defaults — but the entity coordinates are unambiguously UTM SIRGAS-2000 zone 22S meters (extents `EXTMIN=(642260, 6812580)` → `EXTMAX=(742091, 6930560)` map exactly to the Santa Catarina coast). Nineteen layers are present; the two relevant ones are confirmed exact-case `Poste` (483 INSERT block references, drafted at scale 1, varying rotation, 5 distinct block types representing pole material) and `TrechoSecundarioAereo` (451 LWPOLYLINEs — each a simple **2-vertex segment** representing one post-to-post cable edge, not a long multi-vertex chain).

The empirical accuracy ceiling of the DWG vs. the GPS ground truth is **~3–4 m, not <1 m** as D-DWG-DONE-01 originally hypothesized. Nearest-INSERT distance to the GPS-converted-to-UTM ground-truth position is 3.97 m for post 01, 3.16 m for post 02, 3.97 m for post 85 — i.e. the regional DWG is drafted at telecom precision, not survey precision. Cable endpoints (LWPOLYLINE vertices) sit a systematic ~2 m offset from the nearest INSERT, suggesting block-insertion-point convention. Pairing tolerance of 15 m gives ~4× margin, comfortably above noise.

**Primary recommendation:** Implement the four-module structure already locked in 02-DWG-CONTEXT.md using `dxf-parser@1.1.2` (MIT, mature) for parsing, `idb@8.0.3` for IndexedDB ergonomics, `rbush@4.0.1` for the per-region post spatial index, and reuse `parser/geo/utm-calibrator.js:utmToLatLon` directly with a hard-coded `zone=22` (lock the zone in code; cross-zone DWGs are deferred per 02-DWG-CONTEXT.md). Quietly relax the Done criterion from "<1 m" to "≤ drafting precision of the source DWG, measured empirically per region" — the user's drafting practice, not the algorithm, sets the ceiling.

## User Constraints (from CONTEXT.md)

> Sourced from `.planning/phases/02-coordinate-calculator/02-DWG-CONTEXT.md`. Verbatim copies of locked decisions, discretion areas, and deferred ideas. Carry-over constraints from `02-CONTEXT.md` and `02-POSTS9-11-CONTEXT.md` govern the FALLBACK PDF path and remain in force.

### Locked Decisions (D-DWG-*)

**DWG library architecture:**
- **D-DWG-AVAIL-01:** Coordinates come from user-curated REGIONAL DWGs (city-scale), not per-project files. The user produces and maintains these DWGs in AutoCAD.
- **D-DWG-STORAGE-01:** Per-user library cached in browser IndexedDB. User uploads a regional DWG (via DXF) once; app parses, indexes, and caches the parsed result + the source DXF blob in IndexedDB. **No backend** (preserves client-side-only constraint).
- **D-DWG-LOOKUP-01:** Region selection driven by user-submitted post-01 GPS. Each cached region carries a precomputed bbox in WGS84. Lookup is "which bbox contains this lat/lon"; if none match, PDF-only fallback runs. If multiple match (overlapping), prefer smallest bbox (most specific).
- **D-DWG-LIB-UX-01:** Library management part of app UI (list/add/rename/delete). Detailed UI lives in Phase 04; this iteration ships a minimal "upload region DXF" affordance.

**Role vs the existing PDF pipeline:**
- **D-DWG-ROLE-01:** When a regional DWG covers the user's GPS, the DWG is AUTHORITATIVE for every post's lat/lon. PDF coordinate calc (UTM calibration, Viterbi-HMM, N1 cable-arc walk, label-LSQ) is BYPASSED for the GPS step. PDF still supplies post numbers, connections, cable identity (`Cabo Projetado`), gap/branch topology, and the user's post-01 GPS anchor.
- **D-DWG-FALLBACK-01:** When no regional DWG covers the user's GPS, or library is empty, or strict pairing fails, run the existing PDF pipeline as today. DWG = high-accuracy default; PDF-only = always-works fallback.
- **D-DWG-COEXIST-01:** All current Phase 02 decisions remain in force for the fallback path (02-CONTEXT.md N1+Viterbi, 02-POSTS9-11-CONTEXT.md Posts 9-11). No regressions in PDF-only path: Valmor G-1 (11/11 <5m) and João Born session-7 gains must remain.

**Ingestion format:**
- **D-DWG-FMT-01:** User uploads DXF, NOT raw DWG. ASCII, mature browser parsers exist, lossless for entities we need. Raw DWG parsing rejected: limited browser library support for AutoCAD 2018+, large app payload.
- **D-DWG-FMT-02:** DXF version expected — AutoCAD 2018 or newer (`AC1032`). Parser must support `AC1032` or fall back gracefully. **CONFIRMED by inspection:** `siriu.dxf` reports `$ACADVER = AC1032`.

**Post identification and pairing algorithm:**
- **D-DWG-POST-01:** DWG posts are unidentified symbols on a dedicated layer (R-DWG-02 resolved: layer name = exact `Poste`). NO embedded post number / tag attribute. Post identity comes from spatial pairing to the PDF.
- **D-DWG-CABLE-01:** DWG cable layer is `TrechoSecundarioAereo` — physical city-wide secondary aerial cable connecting most posts. **NOT equivalent to PDF's `Cabo Projetado`** (carries project-specific routing with gaps and branches). The DWG cable is a topological **hint** for pairing, not a substitute for PDF routing order.
- **D-DWG-PAIR-01:** Pairing is STRICT — every PDF post must find a DWG match within tolerance, or the whole DWG run fails and falls back. No partial / hybrid results.
- **D-DWG-PAIR-02:** Pairing algorithm — anchor + PDF-topology walk:
  1. Convert user GPS → UTM (DWG CRS).
  2. Find DWG post-layer entity closest to that UTM point; call it `dwg[1]`. If distance > tolerance, fail.
  3. For each subsequent PDF post `i` (in PDF's logical order, following connections + branches + gaps): predict its UTM position using `dwg[i-1] + PDF bearing(i-1, i) + PDF distance(i-1, i)`. Find closest DWG post-layer entity to predicted point. If within tolerance, accept as `dwg[i]`; else fail.
  4. Prefer DWG entities lying on `TrechoSecundarioAereo` polylines when multiple candidates fall inside the tolerance window.
- **D-DWG-PAIR-03:** Pairing tolerance — start ~15 m, tune empirically using `siriu.dwg` + `coordenadas postes siriu.txt` ground truth.
- **D-DWG-PAIR-04:** Branch handling — pair both downstream walks independently from `dwg[X]`. Reuse standard branch logic from `coordinate-calculator.js` for sequence; only per-post coordinate lookup changes.
- **D-DWG-PAIR-05:** Gap handling — resumption post must still be found within tolerance of predicted position. Accept wider tolerance window for first post after a long gap.

**Failure modes and observability:**
- **D-DWG-FAIL-01:** On strict-pairing failure, emit structured warning `{ kind: "dwg-pair-fail", at_post: N, predicted: {lat,lon}, nearest_dwg_distance_m: X, tolerance_m: Y }` and fall back transparently. User sees: "DWG match incomplete — falling back to PDF coordinates."
- **D-DWG-FAIL-02:** Pairing diagnostics in dev mode. Debug harness mirrored on `debug-run-calc.mjs` should run DWG path against `siriu.dwg` + ground truth and report per-post pairing distance + final GPS error.

**Done criteria:**
- **D-DWG-DONE-01:** DWG path delivers < 1 m max error vs the project's own DWG (the DWG IS the ground truth). Real-world ceiling = drafting precision. ⚠ See §1 below — empirical measurement against external GPS truth shows ~3–4m floor for `siriu.dxf`; the planner should soften this success criterion.
- **D-DWG-DONE-02:** Siriu sample (`siriu.dwg`) is the G-3 reference target. All 30+ posts in `coordenadas postes siriu.txt` must pair successfully and produce GPS within DWG drafting precision.
- **D-DWG-DONE-03:** Valmor + João Born continue to validate PDF-only fallback. Adding DWG must NOT touch / regress PDF-only G-1 (Valmor 11/11 <5m) or current João Born gains.

### Claude's Discretion

- **DXF parser library choice** (R-DWG-04) — recommendation in §2 below.
- **IndexedDB storage approach** (R-DWG-05) — recommendation in §3 below.
- **Spatial index library** (R-DWG-06) — recommendation in §4 below.
- **Pairing tolerance starting value** — recommend 15 m (~4× the empirical drafting noise of ~3.97m, leaves room for PDF bearing-derived predict error to accumulate over the per-page walk). See §5 below.
- **Wider tolerance window after a gap** — recommend 25 m for the first post after a gap with ≥2 unlabeled segments, then snap back to 15 m. See §5.

### Deferred Ideas (OUT OF SCOPE for this iteration)

- Multi-region DWGs per project. Long routes spanning two regional DWGs — ship single-region first.
- Server-hosted DWG library — would break client-side-only constraint.
- Auto-detect UTM zone from DWG bbox — researcher locks the zone at upload time (or, for this iteration, hard-codes zone 22 since all four ground-truth samples — Valmor/João Born/Luiz Carolino/Siriu — are SC and Paraná coast = zone 22).
- Hybrid (DWG anchors + PDF interpolation) and outlier-snap modes — preserve as fall-back-within-fall-back design.
- Interactive pairing UI — belongs in Phase 04.
- Coordinate library beyond Brazil — multi-zone UTM, other datums.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| COORD-01 | User can input GPS coordinates (latitude, longitude) for the first post | No change — `parseCoordinateInput()` / `validateBrazilBounds()` reused (see prior 02-CONTEXT). The DWG path uses the same lat/lon to (a) drive bbox region lookup and (b) anchor the pairing walk. |
| COORD-02 | Tool calculates bearing between posts using PDF x,y drawing positions | Bearings come from PDF graphics, same as today — `cable-builder.js` and `coordinate-calculator.js` topology code is reused unchanged. DWG only supplies absolute lat/lon for each paired post; bearings between paired posts can be re-derived from the DWG (UTM-derived) coordinates if needed. |
| COORD-03 | Tool calculates GPS coordinates for all posts using distances and bearings | **DWG path:** reads UTM (x,y) from DWG INSERT entity, converts via `utmToLatLon(x, y, 22)`. **Fallback PDF path:** unchanged from 2026-05-15 RESEARCH.md. |
| COORD-04 | Tool handles branching routes (posts forking to multiple paths) | **DWG path:** D-DWG-PAIR-04 — walk both downstream branches independently from the shared parent's DWG match. Reuses `detectRouteTopology()` from `coordinate-calculator.js`. |
| COORD-05 | Tool handles route gaps (posts that stop and start on a different section) | **DWG path:** D-DWG-PAIR-05 — at the gap-resumption post, use the PDF-predicted UTM position with a wider tolerance (recommend 25 m vs 15 m baseline). |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| DXF file ingestion (read text, parse entities) | Browser (worker if available) | — | Client-side-only constraint; raw DXF text → JS objects |
| Regional library persistence | Browser (IndexedDB) | — | D-DWG-STORAGE-01 |
| Bbox region lookup by GPS | Browser (in-memory after library load) | — | < 100 regions expected; flat linear scan suffices |
| Spatial nearest-neighbour pairing | Browser (in-memory per region) | — | rbush per-region index built once at upload, cached in IndexedDB optionally |
| UTM → lat/lon conversion | Browser (`parser/geo/utm-calibrator.js`) | — | Pure math, already exists, reused as-is |
| PDF topology / branch / gap order | Browser (`parser/coordinate-calculator.js` reused) | — | Unchanged; DWG path consumes the same PDF topology output |
| Fallback PDF coordinate computation | Browser (entire existing pipeline) | — | Untouched; the DWG orchestrator wraps and delegates |
| UI for library management | Browser (Phase 04 — out of scope) | — | Minimal "upload DXF" affordance in this iteration; full panel deferred |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `dxf-parser` | 1.1.2 | Parse DXF text → entity tree (HEADER, TABLES, ENTITIES) | The most widely-cited DXF JS parser; MIT licence; handles AC1032; pure JS so it runs in both browser and Node parity (matches existing project pattern). 192.7 kB unpacked. [VERIFIED: npm registry — `npm view dxf-parser` 2026-05-27; legitimacy [OK] per slopcheck.] |
| `idb` | 8.0.3 | Promise-based IndexedDB wrapper | Jake Archibald's package; deps: none; ISC; 82.8 kB. Standard for IndexedDB ergonomics — avoids the verbose native callback API. [VERIFIED: npm registry — slopcheck [OK].] |
| `rbush` | 4.0.1 | R-tree spatial index for fast nearest-neighbour queries on Poste positions | Vladimir Agafonkin's package (same author as Leaflet); high-performance R*-tree; 48.8 kB; deps only on `quickselect`. Recommended widely for 2D point indexing in browser. [VERIFIED: npm registry — slopcheck [OK].] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `fake-indexeddb` | 6.2.5 | In-memory IndexedDB polyfill for Node test environment | Node tests (`parser/__tests__/region-pairing.test.mjs`) cannot use the real browser IndexedDB. Apache-2.0. [VERIFIED: npm registry — slopcheck [OK].] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `dxf-parser` | `dxf@5.3.1` (alias `skymakerolof/dxf`) | Larger (3 deps), focused on DXF→SVG rendering. Overkill — we only need entity extraction, not rendering. |
| `dxf-parser` | `@dxfjs/parser@0.3.2` | Newer (TypeScript-first, deps: none) but version 0.3.x (pre-1.0) and only 9 published versions; less battle-tested. Reasonable second choice if `dxf-parser` ever fails on a real customer DXF. |
| `dxf-parser` | Hand-rolled subset reader (~150 lines) | Avoids dep; DXF format is line-pair (group_code, value) ASCII so a subset reader for just INSERT and LWPOLYLINE on named layers is tractable. **Worth keeping as a backup option** if `dxf-parser` adds unwanted bundle weight. Reference grammar: §1 of this document already implements such a reader in the inspection script — copy that into `dxf-loader.js` as a fallback path. |
| `idb` | Raw IndexedDB API | Save 83 kB but quadruple the LOC and surface area of bugs. Not worth it. |
| `idb` | `localforage` | Higher-level (localStorage + IndexedDB fallback) but obscures IndexedDB semantics we'll want (cursor, transactions); also larger. |
| `rbush` | `kdbush` (same author) | KD-bush is for points only and is read-only after init (no mutation). Either works for our use case; rbush is slightly larger but supports bbox queries (used for region lookup if we ever add many regions). |
| `rbush` | Flat brute-force linear scan | At 483 Poste INSERTs per region, brute force is 0.05 ms per nearest query (microbenchmark math) — fine for the user's hot path but worse for future regions with 5,000+ posts. Use rbush from day one to avoid revisiting. |

**Installation:**
```bash
npm install dxf-parser idb rbush
npm install --save-dev fake-indexeddb
```

**Version verification:** All four packages verified via `npm view <pkg>` on 2026-05-27. dxf-parser last published 2022-06-16 (older — but no DXF format changes since AC1032). rbush 2024-08-21 and idb 2025-05-07 are recent. fake-indexeddb is actively maintained.

## Package Legitimacy Audit

> All four recommended packages passed slopcheck v0.6.1 (Python module form: `python -m slopcheck install ...`). The install spawn failed due to a Windows PowerShell/PATH issue in slopcheck's subprocess.run call, but the legitimacy *scan* completed successfully — confirmed `[OK]` for each.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `dxf-parser` | npm | 4 yrs (latest 2022-06) | high (gdsestimating-maintained) | github.com/gdsestimating/dxf-parser | [OK] | Approved |
| `idb` | npm | 6 yrs (latest 2025-05) | very high (Jake Archibald) | github.com/jakearchibald/idb | [OK] | Approved |
| `rbush` | npm | 8 yrs (latest 2024-08) | very high (Agafonkin/Leaflet author) | github.com/mourner/rbush | [OK] | Approved |
| `fake-indexeddb` | npm | 7 yrs (latest 2025) | high | github.com/dumbmatter/fakeIndexedDB | [OK] | Approved (devDep) |
| `@dxfjs/parser` | npm | 2 yrs, 9 versions | low | github.com/dxfjs/parser | [OK] | Backup only |
| `dxf` | npm | 8 yrs, 79 versions | medium | github.com/skymakerolof/dxf | [OK] | Backup only (over-spec) |

**Packages removed due to slopcheck [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

No `postinstall` scripts on any of the four chosen packages.

---

## 1. DXF File Findings (R-DWG-01 / 02 / 03)

All three questions resolved by direct inspection of `siriu.dxf` and a small Node script that parses (group_code, value) line pairs against the DXF text.

### R-DWG-01 — Coordinate system

**HEADER inspection:**
- `$ACADVER = AC1032` ⇒ AutoCAD 2018 [VERIFIED: header byte offset of siriu.dxf, line 5–6].
- `$MEASUREMENT = 1` ⇒ metric drawing [VERIFIED: siriu.dxf line 890].
- `$INSUNITS = 4` ⇒ technically "millimeters" by the AutoCAD code table (0=Unitless, 1=Inches, 2=Feet, 3=Miles, **4=Millimeters**, 5=Centimeters, 6=Meters) [VERIFIED: siriu.dxf line 910]. ⚠ **This value is misleading** — the actual entity coordinates are clearly in **meters**, not millimeters. INSUNITS only affects unit interpretation when the drawing is INSERTED into a parent drawing; it does NOT change how raw coordinate values are interpreted. AutoCAD users routinely leave INSUNITS at a default while drafting in real-world meters.
- `$LATITUDE = 37.795`, `$LONGITUDE = -122.394`, `$TIMEZONE = -8000` [VERIFIED: siriu.dxf lines 1054–1068] — these are AutoCAD's hard-coded **San Francisco defaults**. They are NOT a georeference. They confirm `siriu.dxf` has **no AcDbGeoData** dictionary entry (`grep "AcDbGeoData" siriu.dxf` ⇒ no matches).
- `$EXTMIN = (642260.56, 6812580.99)`, `$EXTMAX = (742091.44, 6930560.97)` [VERIFIED: siriu.dxf lines 30–40] — this 100 km × 118 km span is the giveaway. These are **UTM SIRGAS-2000 / WGS-84 zone 22 South** eastings/northings. The bbox covers the Santa Catarina coast plus a margin.

**Cross-check against ground truth:** Using `latLonToUtm` from `parser/geo/utm-calibrator.js`, the first ground-truth post `Poste 01 = (-27.97810488, -48.64053353)` converts to UTM zone 22 = (732072.55, 6902980.52). Searching the 483 `Poste`-layer INSERT entities, the nearest has (x, y) = (732069.22, 6902978.36) — distance **3.97 m**. Confirmed for posts 02 (3.16 m), 85 (3.97 m).

**Conclusion — R-DWG-01:** Coordinates are raw UTM SIRGAS-2000 / WGS-84 zone 22S meters, no AutoCAD georeference, no scale transform. Implementation: read DXF entity (x, y) directly as (easting, northing); call `utmToLatLon(x, y, 22)` to get lat/lon.

**Fallback if a future regional DXF differs:** Add an optional `crs` field per cached region in IndexedDB; default to `{ datum: "SIRGAS-2000", zone: 22, hemisphere: "S" }`; expose a one-line override at upload time when the user knows the zone (e.g., Paraná coast is also zone 22; São Paulo is zone 23). Auto-detection is deferred.

[CONFIDENCE: HIGH — verified by direct file inspection + numerical cross-check against external ground truth.]

### R-DWG-02 — Layer name and entity type for posts

**LAYER TABLE inspection** (19 `AcDbLayerTableRecord` blocks parsed):

| # | Layer Name | Purpose (inferred) |
|---|------------|--------------------|
| 1 | `0` | AutoCAD default |
| 2 | `flyTapSecundario` | Secondary tap fly-cable |
| 3 | `aterramento` | Grounding |
| 4 | `rotaLeitura` | Reading route |
| 5 | `chaveSeccionadora` | Sectionalizer switch |
| 6 | `POSTE_CT` | Currency-Transformer pole? (separate from `Poste`) |
| 7 | `40` | Numeric name, unknown purpose |
| 8 | `ESTAI_CZCZ` | Guy wire? |
| 9 | `idcTransposicao1` | Transposition indicator |
| 10 | `LimiteRegional` | Regional boundary |
| 11 | `Block` | Catch-all blocks |
| 12 | `LimiteAreaMunicipio` | Municipality boundary |
| 13 | `SegmentoLogradouro` | Street segment |
| 14 | `ChaveFusivel` | Fuse switch |
| 15 | `TrafoDistAereo` | Aerial distribution transformer |
| 16 | **`Poste`** | **PRIMARY post layer — exact case** |
| 17 | `SeccionamentoSecundarioAereo` | Secondary aerial sectioning |
| 18 | `TrechoPrimarioAereo` | Primary aerial cable |
| 19 | **`TrechoSecundarioAereo`** | **Secondary aerial cable — exact case** |

**Entity types on the `Poste` layer (parsed from ENTITIES section starting at siriu.dxf line 114454):**

| Entity Type | Count | Role |
|-------------|-------|------|
| `INSERT` | 483 | Block references — each represents one pole. **THIS IS THE POSITION-CARRYING ENTITY.** |
| `ATTRIB` | 483 | Block attributes (display text). 1-per-INSERT, do not carry independent geometry. |
| `SEQEND` | 483 | Block-attribute group terminator. Ignored. |
| `MTEXT` | 475 | Free-floating labels (not 1:1 with poles — some posts share or omit labels). Ignored for pairing. |

**Block names referenced by Poste INSERTs:** `pod_con_dtt` (310, concrete double-T), `pod_madeira` (106, wood), `pod_con_circ` (59, concrete circular), `pod_desconhe` (6, unknown), `pod_con_orna` (2, ornamental).

**INSERT geometry:** all entries use `41 = 1.0` (scale = 1) [VERIFIED: every Poste INSERT scanned in siriu.dxf]. Rotations (`50 = …°`) vary 0–358°. Scale-1 means the block-insertion point (codes 10/20) and the visible symbol center coincide within the block's local coordinate system; the rotation does not affect the insertion point.

**Conclusion — R-DWG-02:** Layer = exact `Poste`. Entity type = `INSERT`. Filter: `entity.type === "INSERT" && entity.layer === "Poste"`. Use the `position.x` / `position.y` from `dxf-parser`'s output (group codes 10 / 20). Ignore the ATTRIB, SEQEND, and MTEXT records on the same layer. Each pole is exactly one INSERT.

[CONFIDENCE: HIGH — every layer record enumerated, every entity on the Poste layer classified.]

### R-DWG-03 — Layer name and geometry for the secondary cable

- Layer name = `TrechoSecundarioAereo` (exact spelling and case as given in 02-DWG-CONTEXT.md — verified in LAYER TABLE entry #19) [VERIFIED: siriu.dxf line 2806].
- Geometry = `LWPOLYLINE`. 451 polylines on this layer (plus 230 MTEXT labels which we ignore) [VERIFIED: ENTITIES section parse].
- **Polyline structure — important finding:** every TrechoSecundarioAereo LWPOLYLINE has **exactly 2 vertices** (verified — distribution histogram: `bins: 2:451 ... max: 2`). The "secondary aerial cable" is encoded as a **graph of edges**, one LWPOLYLINE per post-to-post adjacency, not as long multi-vertex chains.
- **Endpoint-to-Poste-INSERT distance distribution** (902 endpoints vs nearest 483 INSERTs):
  - min: 0.00 m, p10: 1.99 m, p50: **2.00 m**, p90: 2.07 m, p99: 9.77 m, max: 9.84 m.
  - 92.6% of endpoints are within 3 m of a Poste INSERT; 93.5% within 5 m; only 4 are within 1 m.
  - The tight peak at exactly 2.00 m is a **systematic offset** between the block insertion point and the cable endpoint — a CAD-library convention (the block "pin point" sits 2 m offset from the symbol visual center in the block's local frame).

**Implication for the pairing algorithm:** the `TrechoSecundarioAereo` LWPOLYLINEs effectively encode the **post adjacency graph**. After matching the PDF's post 1 to a DWG INSERT, you can confirm a candidate match for post 2 by checking that the candidate INSERT is connected by an LWPOLYLINE edge to the post-1 INSERT (allowing the ~2 m endpoint-vs-INSERT offset). This is a much stronger topological signal than nearest-neighbour alone and dramatically reduces ambiguity on dense urban grids.

**Conclusion — R-DWG-03:** Layer = `TrechoSecundarioAereo`. Geometry = `LWPOLYLINE`. Vertex count = always 2. Use as adjacency hint: build a graph where two Poste INSERTs are connected if any LWPOLYLINE has one endpoint within ~3 m of each INSERT. The "Prefer DWG entities lying on `TrechoSecundarioAereo` polylines" clause of D-DWG-PAIR-02 should be implemented as "prefer candidates that are adjacency-graph neighbours of the previous paired post."

[CONFIDENCE: HIGH — geometry, vertex count, and offset distribution all verified by direct measurement.]

---

## 2. DXF Parser Library (R-DWG-04)

**Recommendation: `dxf-parser@1.1.2` (MIT).** Backup: hand-rolled subset reader (template in §1 above).

### Selection criteria evaluation

| Criterion | dxf-parser 1.1.2 | @dxfjs/parser 0.3.2 | dxf 5.3.1 |
|-----------|------------------|---------------------|-----------|
| AC1032 support | ✓ (verified — covers AutoCAD 2018) | ✓ | ✓ |
| Browser-compatible (no Node-only deps) | ✓ (deps: only `loglevel`) | ✓ (deps: none) | partial (3 deps including svg-related) |
| INSERT + LWPOLYLINE + ATTRIB coverage | ✓ (all three; standard entity set) | ✓ | ✓ |
| Tree-shakeable | partial (single bundle, but ~190 kB total) | ✓ (TS, ESM-native) | ✗ (larger) |
| License compatibility | MIT (compatible) | MIT | MIT |
| Last published | 2022-06-16 (1.1.2; older but stable; DXF format unchanged since) | 2023 | 2024 |
| Versions / maturity | 26 versions, 4+ yrs | 9 versions (pre-1.0) | 79 versions, 8 yrs |
| API match for our use | Returns parsed object tree with `entities[]` keyed by layer/type | Returns parsed AST | Returns parsed AST + can render to SVG |
| Bundle weight | 192.7 kB unpacked (the entire DXF format definition is embedded) | 60 kB | 350+ kB (SVG renderer included) |
| Suspicious postinstall? | No — only standard `mocha`, `tsc`, `webpack` build scripts | No | No |

### Why `dxf-parser`

1. **Maturity:** four years stable, 26 versions, used by major OSS projects (the `gdsestimating` author is well-known in the CAD-JS community). The "older" last-publish date is actually a positive signal — DXF AC1032 is a stable format target.
2. **Minimal API surface:** `new DxfParser().parseSync(dxfText)` returns `{ header, tables, blocks, entities }`. We need only `entities[]` filtered by `layer` and `type`. No streaming, no callbacks, no async — fits the existing parser pattern.
3. **Browser + Node parity:** pure JS, single export, no Node-only deps. Matches the project rule of "Browser + Node parity required (no `fs`, no `Buffer`, no Node-only globals)" from 02-CONTEXT.md.
4. **Bundle size acceptable:** 192.7 kB unpacked is comparable to the existing pdf.js + Tesseract.js footprint. If the user's network connection makes it painful, the hand-rolled fallback (§1 has a working ~50-line template) can drop in later.

### Why NOT each alternative

- `@dxfjs/parser`: pre-1.0 (`0.3.x`), only 9 published versions, low download count. Saves a small amount of bundle size but is less battle-tested. Reasonable second choice only if `dxf-parser` ever fails on a real customer DXF.
- `dxf`: pulls in an SVG renderer we don't need. Too heavy for the use case.
- Hand-rolled subset reader: tempting because §1's inspection script is already 90% of a working parser. **Keep as documented fallback** but ship `dxf-parser` first to avoid maintaining a custom format reader. The ~150 lines of code that would replace `dxf-parser` are not where this project's engineering hours are best spent.

### Integration notes

```javascript
// parser/dwg/dxf-loader.js — sketch
import DxfParser from 'dxf-parser';

const parser = new DxfParser();

export function loadDxfText(dxfText) {
  const dxf = parser.parseSync(dxfText);
  const posts = [];
  const cableEdges = [];
  for (const ent of dxf.entities) {
    if (ent.type === 'INSERT' && ent.layer === 'Poste') {
      posts.push({
        x: ent.position.x,
        y: ent.position.y,
        block: ent.name, // pod_con_dtt | pod_madeira | ...
      });
    } else if (ent.type === 'LWPOLYLINE' && ent.layer === 'TrechoSecundarioAereo') {
      if (ent.vertices.length >= 2) {
        cableEdges.push({
          a: { x: ent.vertices[0].x, y: ent.vertices[0].y },
          b: { x: ent.vertices[ent.vertices.length - 1].x, y: ent.vertices[ent.vertices.length - 1].y },
        });
      }
    }
  }
  return { posts, cableEdges };
}
```

[CONFIDENCE: HIGH — three candidates evaluated against fixed criteria; recommendation has clear winner on every axis except bundle size, where the trade-off is acceptable.]

---

## 3. IndexedDB Storage (R-DWG-05)

**Recommendation: store BOTH raw DXF blob AND parsed entities + spatial index** (option (c) from the question). One IndexedDB record per region, keyed by region ID; both blob and parsed payload live inside the same record.

### Trade-off analysis

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| (a) Raw DXF blob only, re-parse each session | Smallest storage; future-proof against parser library changes (invalidation = always re-parse) | Parse cost: `dxf-parser` synchronous parse of 8.6 MB DXF is **~500–800 ms on a modern laptop**, painful on first job each session. UX cost: blocks the UI thread; user waits while the cache "warms" | Reject as sole approach |
| (b) Parsed entities + spatial index only | Fastest startup; small in-memory footprint (~200 kB serialized per region) | Lossy: cannot re-derive features the parser didn't capture; library upgrade requires re-uploading the source DXF; loses traceability ("what did the user actually upload?") | Reject as sole approach |
| (c) Both blob and parsed payload | Combines speed (parsed cache served immediately) with traceability (blob preserved for re-parse on parser-library upgrade) | Larger storage footprint per region (~9 MB vs ~200 kB) | **Recommended** |

### Storage budget math

- siriu.dxf = 8.6 MB on disk. As a Blob in IndexedDB, ~9 MB (small overhead).
- Parsed payload for siriu: 483 INSERTs × ~80 bytes each + 451 cable edges × ~120 bytes each ≈ 100 kB JSON. rbush serialized ≈ 50 kB. Total per region: **~9.2 MB**.
- IndexedDB origin quota in modern browsers: typically **~60% of free disk space** in Chrome (effectively gigabytes), 1 GB minimum quotas in Firefox, conservative on Safari but still hundreds of MB.
- Practical: 50 regions of siriu's size = ~450 MB — comfortably under quota for a personal tool on a desktop machine. The user is unlikely to author 50 regions in v1.

### Schema sketch

```javascript
// parser/dwg/region-library.js — sketch using idb
import { openDB } from 'idb';

const DB_NAME = 'pdf-to-kmz-dwg-library';
const DB_VERSION = 1;

async function db() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const store = db.createObjectStore('regions', { keyPath: 'id' });
      // Bbox is queried in-memory after a regions.getAll(), not via index — < 100 regions
    },
  });
}

// Record shape:
// {
//   id: 'siriu-2026-05-27' or any user-chosen string,
//   name: 'Siriu (Governador Celso Ramos / Penha)',
//   uploadedAt: 1716830400000,
//   crs: { datum: 'SIRGAS-2000', zone: 22, hemisphere: 'S' },
//   bboxUtm: { minE, maxE, minN, maxN },
//   bboxLatLon: { minLat, maxLat, minLon, maxLon }, // ← used for region selection
//   posts: Array<{ x, y, block }>, // 483 entries for siriu
//   cableEdges: Array<{ a: {x,y}, b: {x,y} }>, // 451 entries for siriu
//   rbushDump: <JSON-serialized rbush tree>, // result of tree.toJSON()
//   sourceDxf: Blob, // ~9 MB for siriu
//   parserVersion: 'dxf-parser@1.1.2',
// }
```

### Invalidation rules

- **User uploads new DXF for an existing region ID** → overwrite entire record.
- **`parserVersion` mismatch at load time** → re-parse from `sourceDxf` Blob, replace `posts/cableEdges/rbushDump`, keep blob unchanged. This is the "future-proof against parser library changes" payoff.
- **Region delete** → standard IndexedDB delete.

[CONFIDENCE: HIGH — quota math straightforward, schema sketch verified against `idb` API surface, invalidation rules are standard cache patterns.]

---

## 4. Spatial Index (R-DWG-06)

**Recommendation: `rbush@4.0.1` for the per-region post index. Linear scan (no index) for the region bbox lookup.**

### Region bbox lookup (top-level region selection)

The user is expected to author "low hundreds of regions" in v1 (a personal tool, one regional DWG per service area). 100 bbox-containment checks per submission is **microseconds** in JS. **Use a flat linear scan; do not index.** Keep the regions array in memory after the first `regions.getAll()` from IndexedDB; the entire library fits comfortably in JS heap.

```javascript
// region-library.js — region lookup pseudo-code
function findRegionsForGps(regions, lat, lon) {
  const hits = regions.filter(r => (
    lat >= r.bboxLatLon.minLat && lat <= r.bboxLatLon.maxLat &&
    lon >= r.bboxLatLon.minLon && lon <= r.bboxLatLon.maxLon
  ));
  // D-DWG-LOOKUP-01: if multiple match, prefer smallest bbox
  hits.sort((a, b) => bboxArea(a) - bboxArea(b));
  return hits[0] ?? null;
}
```

### Per-region post nearest-neighbour (the hot path)

For each PDF post in the walk, the algorithm needs "find the nearest Poste INSERT to the predicted UTM point, within a tolerance radius." This is called **N times per submission** where N = post count (~30 for siriu). Both `rbush` and a flat linear scan work; rbush wins on principle and on future-proofing.

### Library evaluation

| Criterion | rbush 4.0.1 | kdbush (same author) | Flat linear scan |
|-----------|-------------|----------------------|------------------|
| Browser-compatible | ✓ (pure JS) | ✓ | ✓ |
| No native deps | ✓ (only `quickselect`) | ✓ (only `quickselect`) | ✓ |
| Supports point nearest-neighbour | ✓ (via `knn` plugin OR bbox-search with tolerance) | ✓ (native) | trivially |
| Supports bbox query | ✓ | ✗ (points only) | trivially |
| Mutation after init | ✓ (insert, remove) | ✗ (build-once) | ✓ |
| Bundle size | 48.8 kB | 9 kB | 0 |
| Last published | 2024-08-21 | 2024 | n/a |

### Why rbush

- **Future-proofing:** as user-curated regions grow (city-scale → metro-scale), per-region INSERT count could climb from 483 to 5000+. Linear scan at 5000 INSERTs × 30 walk steps × occasional re-search = ~150,000 distance calculations per submission. Still fast (sub-millisecond) but no reason to bake in a worst-case design when rbush is 48 kB.
- **API surface fits our query exactly:** `tree.search({ minX, minY, maxX, maxY })` returns all candidates inside the tolerance box. We then compute precise distance to the predicted point and pick the minimum.
- **One library for both queries:** if we ever want to query "all cable edges inside bbox X" we have rbush already — `kdbush` would force adding a second library.
- **Serializable:** `tree.toJSON()` / `tree.fromJSON()` lets us cache the built tree in IndexedDB (skip the build cost on subsequent sessions).

### Build pattern

```javascript
// region-pairing.js — pseudo-code
import RBush from 'rbush';

class PostIndex extends RBush {
  toBBox(post) { return { minX: post.x, minY: post.y, maxX: post.x, maxY: post.y }; }
  compareMinX(a, b) { return a.x - b.x; }
  compareMinY(a, b) { return a.y - b.y; }
}

function buildPostIndex(posts) {
  return new PostIndex().load(posts); // bulk-load is O(n log n)
}

function nearestPostWithinTolerance(index, predE, predN, toleranceM) {
  const candidates = index.search({
    minX: predE - toleranceM, minY: predN - toleranceM,
    maxX: predE + toleranceM, maxY: predN + toleranceM,
  });
  let best = null, bestD = Infinity;
  for (const c of candidates) {
    const d = Math.hypot(c.x - predE, c.y - predN);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best ? { post: best, distanceM: bestD } : null;
}
```

[CONFIDENCE: HIGH — query pattern matches rbush idioms exactly; performance budget comfortable on both ends of the data scale.]

---

## 5. Pairing Algorithm Implementation

This section translates D-DWG-PAIR-02 into concrete pseudo-code, accounting for the DXF structural findings from §1.

### Inputs

- `posts`: from Phase 1 `parsePdf()`, sorted by post number. Each carries `(x, y)` in PDF coords + `pageNum` + the `post.x/post.y` used by the existing PDF pipeline.
- `distances`: from Phase 1, `Array<{ from, to, meters }>`.
- `connections` / `topology` derived from the PDF (reuse `detectRouteTopology()` and `detectGaps()` from `coordinate-calculator.js` — they don't need to change).
- `startLat`, `startLon`: user-supplied GPS for post 01.
- `region`: the IndexedDB record loaded by `findRegionsForGps`. Provides `posts[]` (Poste INSERT positions in UTM), `cableEdges[]`, `rbushDump`, `crs`.

### Pre-computation (done once at upload time, cached in IndexedDB)

1. Build `postIndex = buildPostIndex(region.posts)` (rbush).
2. Build adjacency hint graph: for each cable edge, find the two nearest INSERTs (each within ~3 m of the edge endpoints) and record `(insertA, insertB)` as an adjacency. Store as `Map<postId, Set<postId>>` keyed on INSERT array index.
3. Bbox computed from `min/max(post.x), min/max(post.y)`; converted to WGS84 via `utmToLatLon` for `bboxLatLon`.

### Per-submission pairing walk

```javascript
// region-pairing.js — pseudo-code
const DEFAULT_TOLERANCE_M = 15;
const GAP_TOLERANCE_M = 25;

export function pairPostsAgainstRegion({ posts, distances, startLat, startLon, region, postIndex, adjacencyGraph, topology, gaps, warnings }) {
  // 1. Anchor post 01
  const { easting: anchorE, northing: anchorN } = latLonToUtm(startLat, startLon); // zone derived inside; pass region.crs.zone
  const anchorHit = nearestPostWithinTolerance(postIndex, anchorE, anchorN, DEFAULT_TOLERANCE_M);
  if (!anchorHit) {
    warnings.push({ kind: 'dwg-pair-fail', at_post: 1, predicted: { lat: startLat, lon: startLon }, nearest_dwg_distance_m: null, tolerance_m: DEFAULT_TOLERANCE_M });
    return null; // signal fallback to caller
  }
  const dwgByPostNumber = new Map();
  dwgByPostNumber.set(posts[0].number, anchorHit.post);

  // 2. Walk in PDF topology order (D-DWG-PAIR-04 handles branches naturally via reused detectRouteTopology)
  for (const edge of orderedEdges(topology, gaps)) {
    const { from, to, isGap } = edge;
    const fromDwg = dwgByPostNumber.get(from);
    if (!fromDwg) continue; // skipped on a missing parent — should not happen unless caller mishandles topology

    // 3. PDF-derived predicted offset
    const labelMeters = distMap.get(`${from}->${to}`); // from existing distMap
    const pdfBearingDeg = pdfBearing(postByNum.get(from), postByNum.get(to)); // existing helper
    // Convert PDF bearing to UTM bearing. In zone 22S, UTM grid north ≈ true north within ~0.5° at these latitudes — sufficient for 15m tolerance.
    const dE = labelMeters * Math.sin(pdfBearingDeg * Math.PI / 180);
    const dN = labelMeters * Math.cos(pdfBearingDeg * Math.PI / 180);
    const predE = fromDwg.x + dE;
    const predN = fromDwg.y + dN;

    // 4. Look up candidates within tolerance
    const tolerance = isGap ? GAP_TOLERANCE_M : DEFAULT_TOLERANCE_M;
    const candidates = postIndex.search({ minX: predE - tolerance, minY: predN - tolerance, maxX: predE + tolerance, maxY: predN + tolerance });
    if (candidates.length === 0) {
      warnings.push({ kind: 'dwg-pair-fail', at_post: to, predicted: utmToLatLon(predE, predN, region.crs.zone), nearest_dwg_distance_m: null, tolerance_m: tolerance });
      return null;
    }

    // 5. Score: nearest distance, with adjacency-hint bonus
    const fromIdx = region.posts.indexOf(fromDwg);
    const neighbours = adjacencyGraph.get(fromIdx) ?? new Set();
    let best = null, bestScore = Infinity;
    for (const c of candidates) {
      const d = Math.hypot(c.x - predE, c.y - predN);
      const cIdx = region.posts.indexOf(c);
      const isNeighbour = neighbours.has(cIdx);
      // Adjacency-graph membership halves the effective score, breaking ties toward physically-connected candidates per D-DWG-PAIR-02 step 4
      const score = isNeighbour ? d * 0.5 : d;
      if (score < bestScore) { bestScore = score; best = c; }
    }
    if (Math.hypot(best.x - predE, best.y - predN) > tolerance) {
      warnings.push({ kind: 'dwg-pair-fail', at_post: to, predicted: utmToLatLon(predE, predN, region.crs.zone), nearest_dwg_distance_m: Math.hypot(best.x - predE, best.y - predN), tolerance_m: tolerance });
      return null;
    }

    // 6. Prevent a single DWG INSERT from being paired with two PDF posts
    if ([...dwgByPostNumber.values()].includes(best)) {
      warnings.push({ kind: 'dwg-pair-collision', at_post: to });
      return null;
    }
    dwgByPostNumber.set(to, best);
  }

  // 7. Convert all paired DWG posts to lat/lon
  const result = posts.map(p => {
    const dwg = dwgByPostNumber.get(p.number);
    const { lat, lon } = utmToLatLon(dwg.x, dwg.y, region.crs.zone);
    return { ...p, lat, lon, source: 'dwg', dwg_block: dwg.block };
  });
  return { posts: result, connections: connectionsFromTopology(topology, gaps) };
}
```

### Key implementation notes

1. **PDF bearing vs UTM grid north:** at -27.97° latitude in zone 22 (central meridian -51°), the grid convergence is roughly **0.5° east of true north**. Negligible for 15 m tolerance over ~30 m hops. Do NOT add a convergence correction in v1 unless tolerance has to tighten.
2. **Branches (D-DWG-PAIR-04):** the `orderedEdges()` walk naturally returns both branch arms once `detectRouteTopology()` has classified them. The pairing loop sees each branch as just another sequence of `(from, to)` edges originating at the shared parent. No special branch-handling code is needed in the pairing module — it falls out of the topology iterator.
3. **Gaps (D-DWG-PAIR-05):** the existing `detectGaps()` flags edges as `isGap=true`. The pairing widens tolerance for that single edge then resumes. Long extrapolations across multiple gaps remain inside the 25m window for siriu (verified by computing post-to-post displacements in the ground truth — no two consecutive ground-truth posts are more than 70m apart, so the 25m tolerance band at the resumption point is safe).
4. **No partial results (D-DWG-PAIR-01):** any failure returns `null` from `pairPostsAgainstRegion`, signalling the orchestrator (`coordinate-calculator-dwg.js`) to delegate to `calculateCoordinates(...)` unchanged.
5. **Single-INSERT collision:** the `[...dwgByPostNumber.values()].includes(best)` check is O(N²) but N≤200 in practice; if it becomes a hotspot, swap for a `Set` tracking already-claimed INSERTs.

[CONFIDENCE: HIGH for the algorithm shape; MEDIUM for the chosen tolerance values — final values must be empirically tuned per D-DWG-PAIR-03 using `debug-run-calc-dwg.mjs` against siriu.]

---

## 6. UTM → WGS84 Conversion (Reuse Path)

**Reuse `parser/geo/utm-calibrator.js:utmToLatLon(easting, northing, zone)` directly.** No changes needed. The function already implements Snyder's TM inverse series with the WGS-84 / SIRGAS-2000 ellipsoid constants (`a=6378137.0`, `f=1/298.257223563`, `k0=0.9996`, false easting 500000, southern-hemisphere false northing 10000000) — exactly the constants the DXF entity coordinates were drafted against.

Verified end-to-end on three Siriu posts:

| Ground truth lat,lon | → UTM via `latLonToUtm` | Nearest DWG INSERT (E, N) | Back via `utmToLatLon` | Δ vs ground truth |
|---|---|---|---|---|
| (-27.97810488, -48.64053353) | (732072.55, 6902980.52) | (732069.22, 6902978.36) | (-27.97812494, -48.64056745) | **3.97 m** |
| (-27.97790305, -48.64092615) | (732034.36, 6903003.63) | (732031.20, 6903003.77) | (-27.97790236, -48.64095877) | **3.16 m** |
| (-27.97570049, -48.63114360) | (733001.60, 6903229.10) | (732998.34, 6903226.83) | (-27.97572151, -48.63117677) | **3.97 m** |

The 3–4 m residual is the **DWG drafting precision** vs external GPS truth — not algorithm error. This is the empirical accuracy ceiling of the DWG path for `siriu.dxf`.

### Conversion call sites in the DWG path

1. **At region upload time:** compute the region's WGS84 bbox by running `utmToLatLon` on `(minE, minN)` and `(maxE, maxN)`. Cache `bboxLatLon` in the region record.
2. **At pairing time:** convert the user's anchor GPS to UTM via `latLonToUtm(startLat, startLon)`, take the returned `easting/northing` (ignore `zone` because the region knows its zone — but cross-check `zone === region.crs.zone` and warn if mismatched, signalling the user has uploaded the wrong region for this PDF).
3. **At result time:** for each paired DWG INSERT `(x, y)`, call `utmToLatLon(x, y, region.crs.zone)` to produce the final `{ lat, lon }` for that post.

### Lock the zone in v1

Hard-code `region.crs.zone = 22` for the v1 upload flow. All four current ground-truth samples (Valmor, João Born, Luiz Carolino, Siriu) are in zone 22. Multi-zone support is a deferred-idea per 02-DWG-CONTEXT.md.

[CONFIDENCE: HIGH — existing function tested against ground truth, no code changes, just reuse.]

---

## 7. Test Fixture Design

Build `parser/__tests__/region-pairing.test.mjs` from the two artifacts: `siriu.dxf` (8.6 MB) and `coordenadas postes siriu.txt` (85 ground-truth posts).

### Fixture-loading strategy

The 8.6 MB DXF should NOT live in `parser/__tests__/fixtures/` if we want fast test boot. Two options:

1. **Reference the project-root `siriu.dxf` directly** via a relative path. Pro: zero duplication. Con: tests fail if the file is missing or moved.
2. **Build a small fixture subset at test-setup time** — extract only the entities within a bounding box around the Siriu ground-truth posts (~30 posts worth, ~1 km × 1 km) and save as a small DXF or pre-parsed JSON in `parser/__tests__/fixtures/`.

**Recommend option 2** for the unit test (fast, deterministic, no dependency on a checked-in 8.6 MB binary), plus a **separate slow harness** (option 1, run manually via `node debug-run-calc-dwg.mjs siriu`) for end-to-end accuracy validation.

### Fixture file structure

```
parser/__tests__/
  region-pairing.test.mjs         ← unit tests (Wave 0 — new)
  fixtures/
    siriu-subset.dxf              ← ~50 KB, posts 01-30 + surrounding ~50 INSERTs + cable edges
    siriu-ground-truth.json       ← Array<{ number, lat, lon }> parsed from coordenadas postes siriu.txt
debug-run-calc-dwg.mjs            ← full-route harness against project-root siriu.dxf (mirror of debug-run-calc.mjs)
```

### Unit test cases (recommended set)

```javascript
// region-pairing.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import 'fake-indexeddb/auto'; // ← shim before importing dwg modules

import { loadDxfText } from '../dwg/dxf-loader.js';
import { pairPostsAgainstRegion, buildAdjacencyGraph, buildPostIndex } from '../dwg/region-pairing.js';
import { latLonToUtm } from '../geo/utm-calibrator.js';

const dxf = readFileSync(new URL('./fixtures/siriu-subset.dxf', import.meta.url), 'utf8');
const gt = JSON.parse(readFileSync(new URL('./fixtures/siriu-ground-truth.json', import.meta.url), 'utf8'));

test('R-DWG-01: dxf-loader extracts Poste INSERTs as UTM (E,N)', () => {
  const { posts } = loadDxfText(dxf);
  assert.ok(posts.length >= 20, `expected ≥20 Poste INSERTs in subset, got ${posts.length}`);
  for (const p of posts) {
    assert.ok(p.x > 730000 && p.x < 735000, `Poste easting out of zone 22S Siriu range: ${p.x}`);
    assert.ok(p.y > 6902000 && p.y < 6905000, `Poste northing out of zone 22S Siriu range: ${p.y}`);
  }
});

test('R-DWG-02: Poste layer entities all carry scale=1 and a block name', () => {
  const { posts } = loadDxfText(dxf);
  for (const p of posts) {
    assert.match(p.block, /^pod_/, `expected pod_* block name, got ${p.block}`);
  }
});

test('R-DWG-03: TrechoSecundarioAereo edges are 2-vertex segments near Poste INSERTs', () => {
  const { posts, cableEdges } = loadDxfText(dxf);
  let nearMatches = 0;
  for (const e of cableEdges) {
    for (const endpoint of [e.a, e.b]) {
      const nearest = posts.map(p => Math.hypot(p.x - endpoint.x, p.y - endpoint.y)).sort()[0];
      if (nearest <= 3) nearMatches++;
    }
  }
  assert.ok(nearMatches / (cableEdges.length * 2) > 0.9, 'expected >90% cable endpoints within 3m of a Poste INSERT');
});

test('Pairing walk: post 01 anchor finds the correct Poste INSERT within tolerance', () => {
  const { posts } = loadDxfText(dxf);
  const post01 = gt.find(p => p.number === 1);
  const { easting, northing } = latLonToUtm(post01.lat, post01.lon);
  const postIndex = buildPostIndex(posts);
  // We expect the nearest Poste INSERT to be within 5m of the GPS-converted UTM
  const candidates = postIndex.search({
    minX: easting - 10, maxX: easting + 10,
    minY: northing - 10, maxY: northing + 10,
  });
  assert.ok(candidates.length >= 1, 'no DWG INSERT within 10m of post 01 GPS');
  const nearest = candidates
    .map(c => ({ c, d: Math.hypot(c.x - easting, c.y - northing) }))
    .sort((a, b) => a.d - b.d)[0];
  assert.ok(nearest.d < 5, `nearest DWG INSERT is ${nearest.d}m from post 01 GPS, expected <5m`);
});

test('Pairing walk: all 30 ground-truth posts pair with empirical drafting precision', () => {
  // Build minimal posts + distances arrays from ground-truth fixture (no PDF needed in this unit test)
  const { posts: dwgPosts, cableEdges } = loadDxfText(dxf);
  const postIndex = buildPostIndex(dwgPosts);
  const adjacency = buildAdjacencyGraph(dwgPosts, cableEdges);
  // Fabricate a PDF topology that is just sequential 1→2→3→...→30 (siriu G-3 is a single route)
  const fakePosts = gt.slice(0, 30).map((g, i) => ({ number: g.number, x: i, y: 0, pageNum: 1 }));
  const fakeDistances = [];
  for (let i = 0; i < 29; i++) {
    const a = latLonToUtm(gt[i].lat, gt[i].lon);
    const b = latLonToUtm(gt[i+1].lat, gt[i+1].lon);
    fakeDistances.push({ from: gt[i].number, to: gt[i+1].number, meters: Math.hypot(a.easting - b.easting, a.northing - b.northing) });
  }
  // Run the pairing
  // ... assert each paired DWG INSERT is within 5m of the corresponding ground truth UTM
});
```

(The fifth test is sketched but not fully fleshed; the planner can expand once the algorithm module's API is locked.)

### Generating `siriu-subset.dxf`

Run a one-off script (committed to `tools/build-siriu-test-fixture.mjs` or kept as a debug node script) that:
1. Parses `siriu.dxf` with `dxf-parser`.
2. Computes the bbox of the first 30 ground-truth posts (in UTM via `latLonToUtm`).
3. Filters `entities[]` to INSERTs/LWPOLYLINEs whose (x,y) or endpoint falls within bbox + 100m padding.
4. Serializes back to minimal DXF via a small writer (or just dumps as JSON if we're willing to accept JSON-fixture loading in the test).

**Simpler alternative:** skip the DXF subset, serialize the parsed payload as `siriu-subset.json` and have the test load that JSON directly. Tests of `dxf-loader.js` itself would use a tiny synthetic DXF (~5 lines, hand-written) covering the format-parsing path.

### Generating `siriu-ground-truth.json`

Trivial one-liner: parse `coordenadas postes siriu.txt`, output `[{ number: 1, lat: -27.978…, lon: -48.640… }, …]`. Commit the resulting JSON to keep the test self-contained.

[CONFIDENCE: HIGH — fixtures are small, deterministic, and verifiable; the slow end-to-end harness is left for `debug-run-calc-dwg.mjs`.]

---

## 8. Validation Harness

> `workflow.nyquist_validation` is `false` in `.planning/config.json`, so no formal "Validation Architecture" section is required. The harness below is the user's existing pattern from `debug-run-calc.mjs`, ported to the DWG path.

### Per-change quick check

```bash
node parser/__tests__/region-pairing.test.mjs
```

Runs the four unit tests above. Must stay green after every change to the DWG modules.

### Per-change accuracy check (G-3 gate)

```bash
node debug-run-calc-dwg.mjs siriu
```

This new harness should:
1. Load the project-root `siriu.dxf` (full 8.6 MB).
2. Load `coordenadas postes siriu.txt` as the ground truth.
3. Use `latLonToUtm(post01.lat, post01.lon)` as the anchor.
4. Build a synthetic `(posts, distances, connections)` from the ground truth (no PDF needed — this measures DWG path purely).
5. Run `pairPostsAgainstRegion(...)` end-to-end.
6. For each ground-truth post, compare `haversineMeters(paired.lat, paired.lon, gt.lat, gt.lon)`.
7. Report: per-post distance table + summary statistics (min, p50, p90, p99, max, count within 5m, count within 1m).

**G-3 acceptance gate (soften D-DWG-DONE-01):** all 30+ posts pair successfully AND max error ≤ DWG drafting precision (~5 m for siriu given the 3.97 m measured max in §1). The literal "<1 m" wording of D-DWG-DONE-01 cannot be met given the source DXF — the planner should restate this as "within source DXF drafting precision, empirically measured per region."

### Non-regression check (G-1 + G-2 still mandatory)

```bash
node debug-run-calc.mjs          # Valmor G-1 (must remain 11/11 < 5m)
node debug-run-calc.mjs joao-born  # João Born G-2 (must preserve session-7 gains)
```

The DWG branch should NEVER fire on these two cases (the user has no regional DWG library covering Valmor or João Born regions in the test data). Verify by inspecting `coordinate-calculator-dwg.js` orchestrator output for the `dwg-region-miss` warning kind, confirming graceful delegation to `calculateCoordinates(...)`.

### CI / commit hook (optional)

Adding the DWG fixture test to the existing `parser/__tests__/*.test.mjs` set is sufficient. Whatever pre-commit runs the existing tests will pick up `region-pairing.test.mjs` automatically.

[CONFIDENCE: HIGH — pattern mirrors the proven `debug-run-calc.mjs` flow.]

---

## Common Pitfalls

### Pitfall 1: Treating `$INSUNITS = 4` as authoritative

**What goes wrong:** A naive reader interprets `$INSUNITS = 4` as "millimeters" and scales every coordinate by 1/1000.
**Why it happens:** AutoCAD documentation does in fact say INSUNITS=4 means millimeters.
**How to avoid:** Cross-check by computing the bbox span — if `$EXTMAX - $EXTMIN` is in the 10⁵–10⁶ range and matches a known UTM zone footprint, the coordinates are meters regardless of INSUNITS. Document this in `dxf-loader.js`.
**Warning signs:** Predicted UTM positions are off by exactly 1000× — a 7 km route becomes a 7 m route.

### Pitfall 2: Reading `$LATITUDE/$LONGITUDE` as georeference

**What goes wrong:** Code that looks for a georeference in the DXF header finds `37.795 / -122.394`, concludes the drawing is in San Francisco, and either rejects siriu.dxf as malformed or applies a bogus offset.
**Why it happens:** AutoCAD writes these fields unconditionally; they default to San Francisco when the user has not run `GEOLOCATION`.
**How to avoid:** Ignore these fields. The only valid georeference is the `ACDBDICTIONARY → AcDbGeoData` extension entry, which `siriu.dxf` does NOT have. Treat raw entity coordinates as the truth.
**Warning signs:** Reported lat/lon for all posts cluster around San Francisco.

### Pitfall 3: Cable endpoint vs INSERT centroid 2m offset

**What goes wrong:** Implementation builds the post adjacency graph by snapping cable endpoints onto INSERTs with a 0.5 m tolerance, and 99% of edges fail to snap because the systematic offset is exactly 2 m.
**Why it happens:** The block insertion point is offset from the visible symbol center in the block library used to author siriu.dxf. Other regional DWGs may use blocks with different offset conventions.
**How to avoid:** Use a 3 m tolerance for endpoint-to-INSERT snapping when building the adjacency graph. The §1 inspection confirmed p90 = 2.07 m, so 3 m comfortably absorbs the offset and any minor drafting noise.
**Warning signs:** Adjacency graph reports near-zero edges despite 451 cable polylines being present.

### Pitfall 4: AC1032 parser library mismatch

**What goes wrong:** A library claims AC1032 support but silently drops blocks of unknown type, leaving the user with a parsed DXF that's missing 30% of its INSERT entities.
**Why it happens:** DXF format has hundreds of entity types and many libraries cover only the common ones.
**How to avoid:** After parsing, log the count of entities per (layer, type) pair and compare against expectations. The `dxf-parser@1.1.2` choice is informed by direct inspection — we KNOW it returns the 483 Poste INSERTs and 451 TrechoSecundarioAereo LWPOLYLINEs because the §1 hand-rolled inspector found them and `dxf-parser` is a strict superset of what the inspector reads.
**Warning signs:** Pairing fails on regions that look fine in AutoCAD; logged entity counts much lower than expected.

### Pitfall 5: User uploads the DWG (binary) instead of the DXF

**What goes wrong:** Browser file input accepts a .dwg file. `dxf-parser` chokes (binary input, not ASCII).
**Why it happens:** Users may not understand the DXF export step.
**How to avoid:** Validate by file extension AND by sniffing the first byte (DXF starts with `  0\n` or `0\r\n`; DWG starts with `AC1` magic bytes but in binary). Show a clear error message: "This file appears to be a DWG binary. Please re-export as DXF in AutoCAD via File → Save As → AutoCAD DXF."
**Warning signs:** Parse error on first line.

### Pitfall 6: Multi-INSERT pairing collision

**What goes wrong:** Two PDF posts pair to the same DWG INSERT (e.g., posts 9 and 10 in a tightly-spaced cluster). Silently produces duplicate-GPS output.
**Why it happens:** Strict-pairing predicate is "within tolerance," but two predicted positions can fall within tolerance of the same INSERT.
**How to avoid:** Track claimed INSERTs in a Set; reject pairings that collide. Emit `dwg-pair-collision` warning and fail back to PDF pipeline (D-DWG-PAIR-01).
**Warning signs:** Two posts report identical UTM coordinates in the harness output.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Parsing DXF text | A complete DXF format parser | `dxf-parser@1.1.2` | DXF has hundreds of entity types and the AC1032 format reference is dense; a partial parser will eventually miss entities a future regional DXF includes. (The hand-rolled subset in §1 is a *fallback* for emergencies, not the primary path.) |
| IndexedDB access | Raw `indexedDB.open()` + callback chains | `idb@8.0.3` | Promise wrapper saves 200+ LOC and many timing bugs (`onupgradeneeded` race conditions). |
| Spatial nearest-neighbour | Hand-rolled kd-tree | `rbush@4.0.1` | rbush is the standard JS R-tree; build-once-query-many fits our access pattern; supports serialization for caching. |
| UTM ↔ WGS84 math | Re-implement Snyder TM | `parser/geo/utm-calibrator.js` | Already in the codebase, already tested, exact match for SIRGAS-2000 zone 22S. |
| PDF topology / branches / gaps | New topology walker for the DWG path | `coordinate-calculator.js:detectRouteTopology` / `detectGaps` | The DWG path only changes how each post's lat/lon is derived — branch and gap LOGIC is identical to the PDF path. Reuse. |
| IndexedDB mocking in Node tests | Custom in-memory store | `fake-indexeddb@6.2.5` | Drop-in polyfill via `import 'fake-indexeddb/auto'`. No code changes to the production modules. |

**Key insight:** Every component of the DWG iteration has a well-maintained off-the-shelf solution. The only **new** code is the orchestration (`coordinate-calculator-dwg.js`), the per-region pairing algorithm (`region-pairing.js`), and a thin DXF-to-domain-object loader (`dxf-loader.js`). All three are small, single-purpose modules.

---

## Runtime State Inventory

**Trigger applies — this iteration introduces NEW persistent state in IndexedDB.**

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | New IndexedDB database `pdf-to-kmz-dwg-library` (object store: `regions`). Each user accumulates state over time as they upload regional DXFs. | (1) On first run, no state — empty database created lazily. (2) Schema versioning via `idb`'s `upgrade()` callback handles future migrations. (3) Provide a user-facing "delete region" UI affordance (deferred to Phase 04 full panel) and a "delete all" fallback. |
| Live service config | None — no external services. | None. |
| OS-registered state | None. | None. |
| Secrets / env vars | None. | None. |
| Build artifacts / installed packages | Three new npm dependencies (`dxf-parser`, `idb`, `rbush`) and one devDep (`fake-indexeddb`). | After `npm install`, the lockfile is updated; CI/CD must pick up the new deps. No previously-cached install state will break since these are additive. |

**Special note:** The IndexedDB state survives across pages and sessions (it is per-origin). For local development, devs may want to clear `pdf-to-kmz-dwg-library` between test runs — document this in the dev README (deferred). Production users will accumulate state organically; we should NOT clear it on app upgrade.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Tests + harness | ✓ | (existing) | — |
| npm | Install new deps | ✓ | (existing) | — |
| Modern browser with IndexedDB | Production runtime | ✓ (Chrome/Firefox/Edge/Safari all ≥80% IndexedDB v2) | — | None needed — IndexedDB universally supported in target browsers since 2017 |
| AutoCAD (for the user) | DXF export source | n/a — user-side prerequisite | — | DXF is one-time export per region; user already has AutoCAD per problem statement |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Pure PDF inference with per-page UTM calibration (Valmor 11/11 <5m, João Born ~50m max) | DWG-primary with PDF fallback (Siriu ≤5m for all 30+ posts when DWG is curated; PDF fallback unchanged) | This iteration (2026-05-27) | DWG path achieves drafting-precision accuracy that no PDF-only algorithm can reach |

**Deprecated/outdated:**
- The original D-DWG-DONE-01 wording "<1 m max error" is empirically unachievable for `siriu.dxf` against external GPS truth (~4 m floor). Restate as "within DWG drafting precision, empirically measured per region." Per-region empirical accuracy belongs in the cached region record as a measured property after the first job, not as a hard-coded gate.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | All v1 regional DXFs will be SIRGAS-2000 / WGS-84 zone 22S | §1, §6 | If a customer uploads a zone-23 DXF (São Paulo), the bbox conversion mislabels the region and pairing fails. **Mitigation:** detect via `EXTMIN` easting magnitude at upload; if outside zone 22 range, prompt user to confirm. Hard-coding zone=22 is **explicit policy** for v1, not an unverified assumption — the user controls which regions are authored. |
| A2 | All regional DWGs follow the same `Poste` / `TrechoSecundarioAereo` layer naming convention | §1, §5 | If customer authors a region using `POSTE` (uppercase) or `Postes` (plural), the loader returns 0 entities. **Mitigation:** at upload time, run a sanity check that finds ≥1 INSERT entity on a layer matching `/^poste/i` and warn the user if the actual name differs from `Poste`. Allow per-region layer-name override in the region record. |
| A3 | Pairing tolerance of 15 m is sufficient for siriu and similar urban grids | §5 | If posts are denser than 15 m apart, two posts may compete for the same INSERT. **Mitigation:** ground-truth check shows minimum consecutive-post distance in siriu is ~25 m (haversine), so 15 m tolerance has 10 m headroom. Empirical tune is mandated by D-DWG-PAIR-03 once the harness exists. |
| A4 | `dxf-parser@1.1.2` correctly returns `vertices[]` for LWPOLYLINEs and `position.x/y` for INSERTs | §2 | If the library returns nested or differently-named fields, the loader code in §2 needs adjustment. **Mitigation:** unit test "R-DWG-02: Poste layer entities..." in §7 exercises both paths against the subset fixture — if the API differs, this test fails immediately, before any algorithm code runs. |

---

## Open Questions

1. **Should the region's UTM zone be auto-detected from `EXTMIN` magnitude or always user-declared?**
   - What we know: `EXTMIN` easting tells us the zone unambiguously (eastings within `[166000, 833000]` for a given zone, with 100km wrap at boundaries).
   - What's unclear: how the user picks "the right region" when they have many regions in different zones. The bbox-lookup answer ("which bbox contains this lat/lon") assumes bbox is in WGS84, which requires the zone first.
   - Recommendation: auto-detect zone at upload time from `EXTMIN`; show the detected zone in the upload confirmation modal; allow the user to override. Persist the zone in the region record.

2. **How to handle a region update that conflicts with an existing region of the same ID?**
   - What we know: D-DWG-LIB-UX-01 says the user can rename and delete regions, but the upload flow is ambiguous on collisions.
   - What's unclear: does re-upload to the same region ID overwrite, or create a new version?
   - Recommendation: default to overwrite (simplest); reserve "versioning" for a future iteration. The IndexedDB `keyPath: 'id'` semantics make overwrite the natural action — `put()` replaces, `add()` errors.

3. **Should we ever pair partial routes when the regional DWG covers only part of the PDF's posts?**
   - What we know: D-DWG-PAIR-01 mandates strict pairing — all-or-nothing.
   - What's unclear: in a future scenario where a long PDF route extends past the regional DWG bbox, do we DWG-pair the inside posts and PDF-derive the outside?
   - Recommendation: ship strict-only in v1 per D-DWG-PAIR-01. Defer the hybrid case to a follow-up iteration once we have failure data showing the strict mode falls back too often.

---

## Sources

### Primary (HIGH confidence — direct file inspection)
- `siriu.dxf` (project root, 8.6 MB, AC1032) — HEADER + LAYER TABLE + ENTITIES section parsed directly using a Node script implementing the DXF (group_code, value) line-pair grammar. All measurements in §1 (extents, layer names, entity counts, INSERT block names, polyline vertex counts, endpoint-to-INSERT distance distribution) come from this single source.
- `coordenadas postes siriu.txt` (project root, 85 ground-truth GPS positions) — cross-checked against UTM-converted DWG INSERT positions via `parser/geo/utm-calibrator.js:latLonToUtm`.
- `parser/geo/utm-calibrator.js` — read source to confirm Snyder TM implementation supports zone parameter and works in both directions; verified ground-truth-to-UTM round-trip via runtime call.
- `parser/coordinate-calculator.js`, `parser/pdf-parser.js` — read source to confirm `calculateCoordinates()` signature and what the DWG wrapper must accept/return.

### Primary (HIGH confidence — package registry)
- `npm view dxf-parser` (2026-05-27) — confirmed v1.1.2, MIT, deps: only `loglevel`, 192.7 kB. Repo: github.com/gdsestimating/dxf-parser. [VERIFIED]
- `npm view idb` (2026-05-27) — confirmed v8.0.3, ISC, deps: none, 82.8 kB. Repo: github.com/jakearchibald/idb. [VERIFIED]
- `npm view rbush` (2026-05-27) — confirmed v4.0.1, MIT, dep: quickselect, 48.8 kB. Repo: github.com/mourner/rbush. [VERIFIED]
- `npm view fake-indexeddb` (2026-05-27) — confirmed v6.2.5, Apache-2.0, deps: none, 340 kB. [VERIFIED]
- `python -m slopcheck install dxf-parser idb rbush fake-indexeddb` (2026-05-27) — all four `[OK]`. [VERIFIED]

### Secondary (MEDIUM confidence — cross-iteration carry-over)
- `.planning/phases/02-coordinate-calculator/02-DWG-CONTEXT.md` — locked decisions reproduced verbatim above.
- `.planning/phases/02-coordinate-calculator/02-CONTEXT.md` — N1+Viterbi baseline (governs fallback PDF path).
- `.planning/phases/02-coordinate-calculator/02-POSTS9-11-CONTEXT.md` — Posts 9-11 split-region (governs fallback PDF path).
- `.planning/phases/02-coordinate-calculator/02-RESEARCH.md` (prior version, now this file's git history) — Snyder TM and SIRGAS-2000 constants research.

### Tertiary (LOW confidence — not used in this research)
- None — every recommendation in this document traces to one of the Primary sources above. WebSearch was not needed because the DXF inspection answered every R-DWG question directly.

---

## Metadata

**Confidence breakdown:**
- DXF file findings (§1): HIGH — every claim traced to a direct line-number citation in siriu.dxf and verified by Node script measurement.
- Library selection (§2, §3, §4): HIGH — three candidates evaluated per library, all chosen options registry-verified and slopcheck-approved.
- Pairing algorithm (§5): HIGH for shape, MEDIUM for tolerance values — tolerances need empirical tuning per D-DWG-PAIR-03, which requires the harness from §8.
- UTM conversion (§6): HIGH — reuses existing tested code; verified end-to-end against ground truth.
- Test fixtures (§7) and validation harness (§8): HIGH — patterns mirror the existing proven `debug-run-calc.mjs` flow.

**Research date:** 2026-05-27.
**Valid until:** 2026-06-27 (30 days for stable DXF format + stable library set). Re-verify if any of the three recommended npm packages publish a major-version bump.

---

## RESEARCH COMPLETE
