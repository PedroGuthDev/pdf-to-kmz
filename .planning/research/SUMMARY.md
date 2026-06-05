# Research Summary — v1.1 Generalized DXF-Driven Accuracy

**Synthesized:** 2026-06-05 from STACK.md · FEATURES.md · ARCHITECTURE.md · PITFALLS.md
**Overall confidence:** HIGH — all four files converge independently on the same build order, the same two-sub-score gate requirement, and the same fail-loud boundaries.

> Supersedes the v1.0 research summary (PDF→KMZ stack decision), now archived in git history.

## Executive Summary

v1.1 adds four capabilities to the browser-only PDF→KMZ converter: a truth-free accuracy gate, DXF ingestion with coordinate-system normalization, a global PDF↔DXF route-graph solver, and diagnostic confidence surfacing in the KMZ. All four insert into the existing `runDwgPairingCascade()` as **non-breaking extensions**, preserving the 2,723-line Siriu-tuned `graph-walker.js` intact as the level-1 fallback (strangler-fig).

The central correctness requirement is a **two-sub-score residual gate**: shape-fidelity (internal distance consistency) AND absolute-anchor (georeferencing correctness). The LC posts 21–31 case — a ~179 m rigid offset that scores ~9.6 m on a shape-only metric — is the proof-of-concept failure this must prevent. **HIGH confidence requires BOTH sub-scores to pass; either failing alone fails the route.** A confident-but-globally-wrong KMZ is more dangerous than an over-cautious failure because it propagates into field work.

## Key Decisions

### Single new dependency: `munkres-js@2.0.3`
< 3 kB, MIT, pure-JS, browser-compatible, added only at P7. The global PDF↔DXF pairing is a **weighted bipartite assignment** (Hungarian algorithm), **not** graph isomorphism: build a sparse (post × INSERT) cost matrix where cost = distance-label residual weighted by cable-adjacency penalty; O(n³) Munkres is < 50 ms for ≤ 300 posts client-side.

### Explicit do-NOT-add list
| Package | Why rejected |
|---------|-------------|
| `proj4` (~87 kB) | `utm-calibrator.js` Snyder TM already covers SIRGAS-2000/WGS-84 (identical < 1 mm in S. America); only needs an explicit-zone param (~2 lines) |
| `graphology` (+shortest-path) | Provides traversal, not assignment; wrong problem class |
| graph-isomorphism libs | Wrong class — pairing is bipartite assignment |
| `turf.js` (~400 kB) | haversine + UTM already in-house |
| `lap-jv` | Unmaintained GitHub port, no npm |

Reuse: `rbush@4.0.1` (already installed) for the GPS-bbox region index; pure `Math.*` for residuals.

### Two-sub-score residual gate (hard requirement)
1. **Shape-fidelity** (primary): `mean(|haversine(A,B) − printed_dist| / printed_dist)` over labelled edges. Initial thresholds 5% trust / 15% fallback / >15% fail — **calibrate against Siriu first**.
2. **Absolute-anchor** (secondary): haversine(first-post computed GPS, known reference anchor).
Either failing independently → fail. **Required P5 regression fixture: LC 21–31 rigid-offset MUST fail the gate.**

### Confidence = TIER labels, never numeric %
`HIGH / MED / LOW / UNRESOLVABLE` at every surface (KMZ placemark, ExtendedData, UI). A numeric "accuracy %" seal is an explicit **anti-feature** (false precision; miscalibrated trust doesn't recover after correction).

### Fail-loud boundaries (P6), not silent fallbacks
- DXF INSERT centroid outside UTM zone-22S envelope → try ÷1000 (mm→m) → else FAIL LOUD "DXF unit mismatch suspected".
- Every UTM→WGS84 result validated inside Brazil bbox (−35..+5 lat, −75..−30 lon) → else FAIL LOUD.
- GPS anchor outside all regions → FAIL LOUD with nearest-region hint + distance; never silent wrong-region.
- Anti-feature: fuzzy/nearest-region auto-match (a GPS outside every region bbox almost certainly means the wrong DXF).

## Build Order — strict P5 → P6 → P7 → P8

Architecturally non-negotiable (all four files agree):

1. **P5 — Truth-free residual gate.** ~100–150 lines of pure math; wraps existing cascade levels with no behavior change. *Measure before you change* — it's the objective judge for P7. Two-sub-score design from the start; LC rigid-offset fixture must fail.
2. **P6 — DXF ingestion + GPS region lookup.** Battle-test the data plumbing the solver depends on (wrong zone = silently wrong solver inputs). `Palhoca.dxf` (60k INSERTs, 134 MB) must ingest < 5 s — spatial indexing is required, not an optimization. Zone/unit/Brazil-bbox + "no region" fail-loud gates.
3. **P7 — Global graph solver.** Highest-risk. munkres cost-matrix assignment; anchor as hard constraint; arc-monotonicity check; hub-degree matching; adaptive thresholds from per-drawing scale; candidate ceiling + time-budget fallback. **Hard prerequisites (must be green before any solver code):**
   - Per-post position gates GREEN for Siriu **and** LC (already built this session).
   - Junction ground-truth GREEN for named routes (no phantom edges poisoning the input graph).
   - **Gate audit**: classify every active gate as *regression fence* vs *accuracy assertion*; fence gates marked "expected red mid-flight" (the LC Phase-2 block was fence gates vetoing four individually-correct fixes).
4. **P8 — Diagnostic failure + confidence surfacing.** Additive/low-risk; synthesizes P5 + P7 outputs into per-post TIER labels, KMZ placemark color + ExtendedData, Portuguese failure messages. Log the strangler-fig fallback when the old walker is used.

## File inventory

| New file | Phase | | Modified | Phase |
|----------|-------|---|----------|-------|
| `parser/dwg/residual-gate.js` | P5 | | `coordinate-calculator-dwg.js` | P5/P7/P8 |
| `parser/dwg/dxf-ingestion.js` | P6 | | `region-library.js` (+hybrid) | P6 |
| `parser/dwg/global-solver.js` | P7 | | `dxf-loader.js` | P6 |
| `parser/dwg/confidence-surface.js` | P8 | | `utm-calibrator.js` (explicit-zone) | P6 |

**Permanently untouched:** `graph-walker.js`, `region-pairing.js`, `region-crop.js`, `coordinate-calculator.js`.

## Flags / gaps to resolve in planning

- **P7 needs a research phase** (`/gsd:plan-phase --research-phase 7`): the constrained BFS/DFS × munkres interaction, hub-degree hard constraint, and candidate-window pruning need live `walkConnections`/`adjacencyGraph` inspection. P5/P6/P8 are standard patterns, no extra research.
- Thresholds (5%/15%, ~8 m) are estimates — **P5 calibrates against real Siriu output** before hardening.
- **João Born and Valmor per-post position fixtures don't exist yet** — they're P7 prerequisites (work outside the solver). Siriu + LC fixtures already shipped.
- `Palhoca.dxf` INSERT spatial-index structure (grid vs rbush) — decide in P6 planning. (Note: Palhoca already validated to contain the LC route, 31/31 GT < 5 m, mean 1.0 m — but not yet through the P6 ingestion pipeline.)
- Zone-22S is a documented v1.1 known limitation; the out-of-zone fail-loud gate is the sufficient mitigation, to be noted in the P6 deliverable.

## Per-dimension confidence

| Dimension | Confidence | Basis |
|-----------|-----------|-------|
| Stack | HIGH | One new dep; do-not-add list well-argued; others extend existing packages |
| Features | HIGH | Anti-features/table-stakes grounded in observed failures + KML Reference |
| Architecture | HIGH | Direct source analysis at specific line numbers; explicit integration contracts |
| Pitfalls | HIGH | 10 pitfalls each grounded in a named observed failure (260603-n4k, -acc, -decouple) |
