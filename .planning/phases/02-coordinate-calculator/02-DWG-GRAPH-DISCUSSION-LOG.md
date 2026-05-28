# Phase 2: Coordinate Calculator (DWG-graph-first) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `02-DWG-GRAPH-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-05-28
**Phase:** 02-coordinate-calculator (DWG-graph-first sub-iteration)
**Areas discussed:** Numbering convention, Junction disambiguation, Jumpback handling, Pivot strategy, Validation gate

---

## Numbering convention (user-provided up-front, not a multi-choice)

User clarified mid-discussion: numbers are always sequential without repeats, but the physical sequencing has two patterns:
- **Case A (vai-volta):** spine 1-2-3, branch 4-5-6, spine resumes 7-8-9.
- **Case B (spine-then-jump):** spine 1-10, then 11 "volta lá atrás" to start a parallel-street branch.

No multiple-choice was presented; the constraint was locked as D-DWGG-NUM-01..03 directly.

**Implication used downstream:** the algorithm cannot assume "numbers follow the longest unbranched spine." It must read each connection's `gap` flag and switch between adjacent-walk and jumpback re-anchor accordingly.

---

## A1 — Junction disambiguation (deg > 2 with multiple unclaimed neighbors)

| Option | Description | Selected |
|--------|-------------|----------|
| Span do cabo ≈ distância PDF | Compare DXF edge span (metres, UTM) vs `Distância_Poste` PDF label. Bearing not used. Vizinho with smallest delta wins. | ✓ |
| Bearing local + span (combined) | 60% bearing match, 40% span match. More robust when distance is noisy, but reintroduces the bearing the user distrusts. | |
| Lookahead K hops | Simulate each candidate K=3 hops ahead; vence o que casa mais hops sem falhar. Combinatorial cost on multi-branch routes, may mask PDF bugs. | |

**User's choice:** Span-only. Rationale captured in D-DWGG-JCT-02 / `<specifics>` in CONTEXT.

---

## A2 — Jumpback handling (gap edges, Case B)

| Option | Description | Selected |
|--------|-------------|----------|
| Vizinho de junção visitada + validação de span no próximo hop | Find unclaimed posts cable-adjacent to visited junction nodes; tie-break by span(N+1, N+2) vs `Distância_Poste(N+1, N+2)`. No bearing/PDF-position. | ✓ |
| GPS 2ª âncora (input do usuário) | Require user to provide GPS for first post of branch. Robust but adds UI burden and user must know when branch starts. | |
| Falhar jumpback, fallback PDF pipeline | Abort DWG path on any gap edge, fall back to PDF-only Viterbi. Siriu would never reach 85/85 via DWG. | |

**User's choice:** Junction re-entry with span-match tiebreak. Encoded as D-DWGG-JMP-01..03.

---

## A3 — Pivot strategy in code

| Option | Description | Selected |
|--------|-------------|----------|
| Novo módulo `graph-walker.js`, flag-on por padrão, PDF-walk como fallback | New module; `coordinate-calculator-dwg.js` runs 3-level cascade (graph-walk → pdf-walk → pdf-only). Preserves existing tests; A/B-able. | ✓ |
| Substituir `pairPostsAgainstRegion` in-place | Rewrite existing file. Cleaner, smaller surface, but breaks existing tests and loses pdf-walk fallback. | |
| Refatorar com parameter mode: 'graph' \| 'pdf-walk' | Single file, two internal modes. File grows to ~700+ lines. | |

**User's choice:** New module + 3-level cascade. Encoded as D-DWGG-PIV-01..04.

---

## A4 — Validation gate (done criteria)

| Option | Description | Selected |
|--------|-------------|----------|
| Siriu 85/85 + Valmor/João Born sem regressão | G-3: 85/85 paired via graph-walk only, max error ≤ ~2 m. G-1/G-2 non-regression on PDF-only fallback. | ✓ |
| Só Siriu, fim | Only G-3, no PDF-only re-test. Relies on the fact that the PDF-only code is untouched. | |
| Siriu + Luiz Carolino (com DXF novo) | Adds G-4 but requires user to export `luiz-carolino.dxf`. Delays the iteration. | |

**User's choice:** Siriu primary + Valmor/João Born non-regression. Luiz Carolino deferred. Encoded as D-DWGG-DONE-01..04.

---

## Claude's Discretion

- Span tolerance formula for D-DWGG-JCT-03 (start `max(2 m, 0.15 × label_m)`, ceiling `10 m`).
- Lookahead depth for D-DWGG-JMP-01 tie-break (start 1 hop, extend if Siriu requires).
- Whether to memoize `adjacency` and the live `junctionSet` across the walk.
- Warning shape for failed cascade levels.
- Exact wiring location in `coordinate-calculator-dwg.js` for the `runDwgPairingCascade` helper.

---

## Deferred Ideas

- `luiz-carolino.dxf` export and G-4 validation — follow-up plan after Siriu closes.
- Multi-region DWG support — already deferred in `02-DWG-CONTEXT.md`.
- Interactive disambiguation UI when graph-walk hits a genuine junction tie — Phase 04.
- Second-anchor GPS input for ambiguous jumpbacks — Phase 04 UI enhancement.
- Memoization of cable-edge span lookups for larger-than-Siriu regions.
- Auto-tuned span tolerance via per-region sampling.
- Cross-validation telemetry (graph-walk vs pdf-walk divergence warning).
