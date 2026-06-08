# Roadmap: PDF to KMZ Converter

**Active milestone:** v1.1 — Generalized DXF-Driven Accuracy
**Mode:** mvp

---

## Shipped Milestones

- **v1.0 — Working PDF → KMZ Converter** ✅ SHIPPED 2026-06-05 — full client-side pipeline
  (parse → coordinates → KMZ), proven on multiple routes. Archive:
  [v1.0-ROADMAP.md](./milestones/v1.0-ROADMAP.md) · see [MILESTONES.md](./MILESTONES.md).

---

## v1.1 — Generalized DXF-Driven Accuracy

**Theme:** Anchor the converter's accuracy to the DXF (not per-route PDF calibration); a
truth-free residual gate decides trust; no matching DXF means fail loud, never wrong.

---

## Phases

- [x] **Phase 5: Truth-Free Residual Gate** — Two-sub-score gate (shape-fidelity + absolute-anchor) wraps the cascade; LC 179 m rigid-offset must fail it. (completed 2026-06-06)
- [ ] **Phase 6: DXF Ingestion & Region Lookup** — Ingest DXFs with CRS normalization, spatial indexing, and fail-loud boundaries; GPS-based region lookup.
- [ ] **Phase 7: Solver Prerequisites** — Lock per-post position fixtures for all four named routes, audit all gates (fence vs. accuracy), and confirm junction ground-truth is clean; green gate for solver entry.
- [ ] **Phase 8: Global PDF-DXF Solver** — Hungarian bipartite solver as cascade level-0; strangler-fig fallback; re-clears Siriu 85-post gate and LC per-post position gate with zero regression.
- [ ] **Phase 9: Diagnostic Failure & Confidence Surfacing** — Per-post TIER labels in KMZ/UI; Portuguese failure messages; partial output on low confidence; no numeric percentage seals.

---

## Phase Details

### Phase 5: Truth-Free Residual Gate

**Goal**: The pipeline has an objective, truth-free quality judge that rates any paired-coordinate result HIGH only when both shape fidelity and absolute georeferencing are correct — and the LC 179 m rigid-offset failure case is a locked regression fixture that MUST fail the gate.
**Depends on**: Nothing (first v1.1 phase; all v1.0 outputs are inputs)
**Requirements**: ACC-01, ACC-02, ACC-03, ACC-04, ACC-05
**Success Criteria** (what must be TRUE):

  1. Running the gate on the Siriu graph-walk output yields a "trust" decision and the computed shape-fidelity mean relative error is below 5%.
  2. The LC posts 21-31 rigid-offset fixture (approx. 179 m off, approx. 9.6 m shape residual) produces a gate decision of "fail" — shape alone would pass but the absolute-anchor sub-score fails, downgrading the result.
  3. Every existing paired route (Siriu, Valmor, João Born, LC) receives a per-post confidence tier (HIGH/MED/LOW/UNRESOLVABLE) in the gate output without crashing or silently omitting posts.
  4. The CI gate runs over all validated routes as part of `npm run test:gate` with thresholds calibrated and locked against the Siriu baseline.

**Plans**: 2 plans in 2 waves

  **Wave 1**

  - [x] 05-01-PLAN.md — Pure residual-gate module (computeResiduals/computeAnchorGap/applyResidualGate) + unit tests

  **Wave 2** *(blocked on Wave 1 completion)*

  - [x] 05-02-PLAN.md — Live wire (dwgConfidence), LC must-fail fixture, Siriu-calibrated thresholds, CI gate in test:gate

  **Cross-cutting constraints:**

  - Gate must be a pure judge (no coord change, D-01): `coordinate-calculator-dwg.js` output bytes identical before/after
  - Median aggregator (not mean): `computeResiduals` must sort + median, confirmed by test
  - LC must-fail via anchor sub-score (not shape): anchor gap ≈178.7 m on PDF-path 21–31 fixture

### Phase 6: DXF Ingestion & Region Lookup

**Goal**: Any DXF can be ingested into the region library with coordinate-system normalization, validated inside Brazil's bounding box, and indexed for GPS-based lookup — with hard fail-loud boundaries for unit mismatches, out-of-envelope coordinates, and missing regions; Palhoca.dxf (134 MB, 60k INSERTs) ingests within 5 seconds.
**Depends on**: Phase 5 (gate must be in place to validate DXF-sourced coordinates against the residual quality judge)
**Requirements**: DXF-01, DXF-02, DXF-03, DXF-04, DXF-05, DXF-06, DXF-07
**Success Criteria** (what must be TRUE):

  1. Re-ingesting the existing Siriu DXF through the new pipeline produces an identical GPS bounding box and a CRS record showing zone=22S with confidence "high" — no silent coordinate drift.
  2. Ingesting a synthetic DXF with millimeter-scale coordinates triggers the mm-to-m ÷1000 retry and, if that also fails the Zone 22S envelope, surfaces "DXF unit mismatch suspected" as a loud user-visible error, not a silent fallback.
  3. A GPS anchor placed outside all defined regions returns a structured "no region" failure with a nearest-region hint and distance — never a wrong-region silent match.
  4. Palhoca.dxf (134 MB, 60k INSERTs) ingests and indexes in under 5 seconds in a browser environment, verified by a timed integration test.
  5. The user can list all ingested regions in the region library UI (region names and their GPS bounding boxes).

**Plans**: 3 plans in 2 waves

  **Wave 1**

  - [ ] 06-01-PLAN.md — Fail-loud ingestion validation (unit-mismatch + Brazil-bbox + crs.confidence) + Siriu golden-bbox test
  - [ ] 06-02-PLAN.md — NO_REGION structured error at cascade caller + region-bbox listing UI

  **Wave 2** *(blocked on 06-01 — shared region-library.js)*

  - [ ] 06-03-PLAN.md — Web Worker off-thread parse/index + Palhoca 5s timing gate

  **Cross-cutting constraints:**

  - Fail-loud, never silently-wrong: all unit/bbox failures throw, never store (D-01–D-03, D-09)
  - NO_REGION synthesized at cascade caller (`coordinate-calculator-dwg.js`); leaf `lookupByGps()` stays null — preserves hybrid cloud fallback
  - Zone-22S envelope: E 600,000–800,000 / N 6,700,000–7,100,000 (verified from Siriu + Palhoça DXF headers)
  - No new external dependencies

**UI hint**: yes

### Phase 7: Solver Prerequisites

**Goal**: Every input graph, fixture, and gate required to build and validate the global solver is confirmed green before a single line of solver code is written — so no correct solver fix can be blocked by compensated-error gates or phantom-edge-poisoned input graphs.
**Depends on**: Phase 6 (DXF ingestion must be stable so region data fed to fixture generation is correct)
**Requirements**: SOLVE-05
**Success Criteria** (what must be TRUE):

  1. Per-post position fixtures exist and pass for all four named routes: Siriu (already green), Luiz Carolino (already green), João Born (new), and Valmor (new) — `tools/run-*-post-position-gate.mjs` exits 0 for each.
  2. Junction ground-truth fixture assertion passes for all named routes (no phantom degree>=3 junctions remain in the label graph fed to the solver).
  3. Every active gate is explicitly classified as "regression fence" or "accuracy assertion" in a written audit document, with fence gates annotated "expected red mid-flight" during Phase 8 development.
  4. A baseline run of the full cascade on all four routes can complete with the gate from Phase 5 active and without any solver code present — confirming the measurement baseline is stable before any solver changes touch shared code.

**Plans**: 7 plans in 4 waves

  **Wave 1** *(truth foundation — blocks everything)*

  - [x] 07-01-PLAN.md — txt→JSON ground-truth import + JB post-35 anomaly fix + Siriu position/junction regression net in test:gate

  **Wave 2** *(parallel additive fixtures; blocked on 07-01)*

  - [ ] 07-02-PLAN.md — João Born PDF per-post position fixture + gate (hand-known anchors, all 34 posts)
  - [ ] 07-03-PLAN.md — Valmor PDF per-post position fixture + gate (parse-viability gated, all 11 posts)
  - [ ] 07-04-PLAN.md — Junction ground-truth fixtures + DFS-oracle tests for LC/JB(linear)/Valmor
  - [x] 07-05-PLAN.md — Per-route txt GPS accuracy gates with four-tier classifier (Siriu/Valmor hard; LC/JB soft fence — deferred to Phase 8)

  **Wave 3** *(LC layer-B fix under all-green discipline; blocked on 07-01..07-05)*

  - [ ] 07-06-PLAN.md — LC layer-B placement fix (additive predicate; Siriu 1.0-pt gate stays green)

  **Wave 4** *(phase exit; blocked on 07-06)*

  - [ ] 07-07-PLAN.md — 07-GATE-AUDIT.md (fence vs accuracy) + full test:gate wiring + 4-route baseline cascade

  **Cross-cutting constraints:**

  - All-green checkpoint discipline (D-11): every commit during the LC fix keeps the full gate suite green; no intentional RED mid-flight
  - Additive predicates only — never edit Siriu-calibrated constants; never re-seed the Siriu baseline to mask a regression (Pitfall 2)
  - No new external dependencies (munkres-js is added only at Phase 8)

### Phase 8: Global PDF-DXF Solver

**Goal**: A global Hungarian bipartite solver operates as cascade level-0, aligning the PDF numbered route-graph to the DXF cable-graph with anchor hard-constraint, arc-order monotonicity, and hub-degree matching; the existing graph-walker is kept untouched as the level-1 strangler-fig fallback; Siriu re-clears the 85-post regression gate and the LC per-post position gate with zero regression.
**Depends on**: Phase 7 (all prerequisites green), Phase 5 (residual gate is the solver's quality judge), Phase 6 (normalized DXF coordinates are the solver's inputs)
**Requirements**: SOLVE-01, SOLVE-02, SOLVE-03, SOLVE-04
**Success Criteria** (what must be TRUE):

  1. The Siriu 85-post regression gate passes with the global solver as level-0 and the graph-walker as fallback — the cascade chooses level-0 for Siriu and the gate says "trust".
  2. The LC per-post position gate passes: the solver either pairs LC posts correctly (within position tolerance) or correctly falls through to the graph-walker, which must itself remain byte-identical to its pre-P8 behavior.
  3. A deliberate low-confidence solver run (synthetic fixture with ambiguous topology) causes the cascade to fall back to the graph-walker and logs "solver demoted; using graph-walker" — fallback activation is observable, not silent.
  4. The solver completes within 2 seconds for all current named routes (85 posts max) in a browser environment; if the time budget is exceeded, a confidence downgrade is emitted and the graph-walker runs.

**Plans**: TBD

### Phase 9: Diagnostic Failure & Confidence Surfacing

**Goal**: Every failure surfaces a clear Portuguese-language reason in the UI; every KMZ post carries a TIER confidence label (HIGH/MED/LOW/UNRESOLVABLE) in its placemark color and ExtendedData; partial successes emit the resolvable posts rather than failing entirely; no numeric percentage confidence seals appear anywhere.
**Depends on**: Phase 8 (solver confidence scores) and Phase 5 (residual gate tiers) — confidence surfacing synthesizes both
**Requirements**: CONF-01, CONF-02, CONF-03, CONF-04
**Success Criteria** (what must be TRUE):

  1. Uploading a Siriu PDF with the correct Siriu DXF produces a KMZ where every placemark description shows "HIGH" tier; the UI diagnostic panel shows `dwgConfidence.overall = "high"`.
  2. Uploading a PDF with no matching DXF region shows a Portuguese failure message including the nearest-region hint; no KMZ is emitted with silently-wrong coordinates.
  3. Simulating a partially-resolved route (some posts below the LOW threshold) produces a KMZ with resolvable posts emitted and their confidence tiers encoded in placemark colors — unresolvable posts are flagged, not silently omitted.
  4. No UI, KMZ description, or ExtendedData field anywhere in the output shows a numeric percentage confidence value (e.g., "87%" is forbidden; "HIGH" is correct).

**Plans**: TBD
**UI hint**: yes

---

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 5. Truth-Free Residual Gate | 2/2 | Complete   | 2026-06-06 |
| 6. DXF Ingestion & Region Lookup | 0/3 | Planned | - |
| 7. Solver Prerequisites | 2/7 | Executing (Wave 2 done) | - |
| 8. Global PDF-DXF Solver | 0/? | Not started | - |
| 9. Diagnostic Failure & Confidence Surfacing | 0/? | Not started | - |

---

_v1.0 roadmap archived 2026-06-05. Phase numbering continues from Phase 5 in v1.1 (never restarts)._
