# Phase 05: Truth-Free Residual Gate - Context

**Gathered:** 2026-06-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Build an objective, **truth-free** quality judge — `parser/dwg/residual-gate.js`
(~100–150 lines of pure math) — that rates any paired-coordinate result using
**two** sub-scores and assigns per-post confidence tiers:

1. **Shape-fidelity** — `mean(|haversine(A,B) − printed_distance| / printed_distance)`
   over labelled edges. No GPS ground truth required.
2. **Absolute-anchor** — how far the paired route geometry sits from where the
   user-provided first-post anchor implies it should be.

A route is rated HIGH **only when both sub-scores pass**; either failing alone
downgrades/fails it. The gate wraps the existing cascade (strangler-fig) and runs
as a CI gate via `npm run test:gate`. The LC posts-21–31 rigid-offset
(~179 m off, ~9.6 m shape residual) is a **locked regression fixture that MUST
fail** the gate.

**In scope:** residual computation (ACC-01, ACC-02), two-sub-score HIGH/fail
logic + LC must-fail fixture (ACC-03), CI gate calibrated against Siriu (ACC-04),
per-post tier derivation (ACC-05).

**Out of scope (later phases):** active cascade rerouting/demotion (P7/P8), DXF
ingestion (P6), the global solver (P8), KMZ/UI surfacing of tiers (P9). This phase
**measures**, it does not change pipeline output.

</domain>

<decisions>
## Implementation Decisions

### Gate role in P5
- **D-01:** The gate is a **pure judge** this phase. It computes residuals and
  attaches a gate decision + per-post tiers to the result object. It does **NOT**
  reroute, demote, or change coordinate output — output bytes stay identical to
  today. Active cascade demotion is deferred to P7/P8. (Rationale: research's
  "wraps cascade, no behavior change"; avoids Siriu regression before the solver
  exists.)

### Absolute-anchor reference source
- **D-02:** The absolute reference is the **user-provided first-post GPS**
  (`lat1`/`lon1`). The gate stays fully truth-free (no per-route truth fixtures in
  the live path). It does NOT depend on P6 DXF ingestion.
- **D-03 (mandatory research directive):** The first post is *pinned* to the user
  anchor by construction, so a naive "computed-first-post vs user-GPS" residual is
  always ~0 and catches nothing. The absolute-anchor sub-score MUST measure a
  quantity **not pinned by construction** — e.g., how far the **DWG-paired** route
  geometry sits from where the user-anchored PDF path places the same posts (that
  gap *is* the ~179 m in the LC case). The researcher/planner MUST resolve the
  exact formulation so success-criterion #2 holds: shape passes, anchor fails. See
  `<canonical_refs>` PITFALLS Pitfall 1.

### Per-post tier derivation
- **D-04:** Each post's tier (HIGH/MED/LOW/UNRESOLVABLE) is derived from its
  **own incident-edge residuals**. Posts with no labelled edge / no paired
  coordinate are tagged **UNRESOLVABLE** (flagged, never silently omitted). The
  route-level gate decision is the aggregate of these per-post values. Granularity
  is preserved for P9 KMZ coloring/ExtendedData.

### Threshold calibration & regression fixtures
- **D-05:** Calibrate thresholds against **real Siriu output** as the baseline,
  then **sanity-check** that Valmor / João Born / LC-good-portion do not
  false-fail. Thresholds live as **named constants in `residual-gate.js`**
  (initial estimates 5% trust / 15% fallback / >15% fail — replace with
  Siriu-calibrated values, then lock).
- **D-06:** The LC 21–31 regression fixture is **real captured LC output**
  (the actual rigid-offset result), stored as a JSON fixture — not a synthetic
  injected offset.

### Tiers are labels, never percentages (carried-forward lock)
- **D-07:** Output is TIER labels only (HIGH/MED/LOW/UNRESOLVABLE) at every
  surface. A numeric "accuracy %" seal is an explicit anti-feature. (v1.1 lock.)

### Claude's Discretion
- Exact gate-result object schema / field names (e.g. `dwgConfidence`,
  `gateDecision`) — planner to design, consistent with the existing result shape
  in ARCHITECTURE.md and the existing `dwgStatus` field.
- Whether the per-post tier MED/LOW boundary is one or two intermediate thresholds
  — planner decides during Siriu calibration.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v1.1 research (HIGH confidence — direct source analysis)
- `.planning/research/SUMMARY.md` — converged build order, two-sub-score gate
  requirement, threshold estimates, file inventory.
- `.planning/research/ARCHITECTURE.md` §"computeResiduals" / cascade diagram —
  exact insertion point, result-object shape, gate decision routing.
- `.planning/research/PITFALLS.md` — Pitfall 1 (confident-but-wrong / rigid-offset;
  grounds D-03 anchor formulation), Pitfall 7 (compensated-error gate trap),
  Pitfall 2 (Siriu regression through shared subsystems).
- `.planning/research/STACK.md` — do-NOT-add list; pure `Math.*` residuals, reuse
  in-house haversine.

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` §ACC-01..ACC-05 — the requirements this phase closes.
- `.planning/ROADMAP.md` §"Phase 5" — goal + 4 success criteria (LC must-fail,
  Siriu trust <5%, per-post tiers, `npm run test:gate`).

### Existing code (reuse / integration)
- `parser/dwg/coordinate-calculator-dwg.js` — `runDwgPairingCascade()`; gate wraps
  cascade output here (MODIFIED, additively).
- `parser/coordinate-calculator.js` — existing haversine + PDF coordinate path
  (seeds `gpsByPostNumber`; source of the user-anchored PDF positions for D-03).
- `tools/run-siriu-regression-gate.mjs`, `tools/run-lc-post-position-gate.mjs`,
  `tools/run-siriu-post-position-gate.mjs` — existing gate harness pattern to mirror
  for the new residual CI gate.
- `tools/route-dwg-accuracy-harness.mjs`, `tools/run-route-dwg-accuracy-gate.mjs` —
  existing per-route accuracy measurement; reusable scaffolding for residual calc.
- `package.json` §scripts.`test:gate` — where the new gate hooks in.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- In-house **haversine** (in `coordinate-calculator.js`) — reuse directly; do NOT
  add turf.js (research do-not-add list).
- Existing **gate harness scripts** under `tools/run-*-gate.mjs` + `node --test`
  pattern wired into `npm run test:gate` — mirror this for the residual gate.
- `gpsByPostNumber` seeded by `calculateCoordinates()` — the user-anchored PDF
  positions, candidate input for the D-03 anchor-gap computation.
- Per-post position truth fixtures already shipped (Siriu 85-post, LC) — usable for
  *calibration/validation*, NOT in the truth-free live gate path.

### Established Patterns
- **Strangler-fig**: wrap/extend/gate, never rewrite. `graph-walker.js`,
  `region-pairing.js`, `coordinate-calculator.js` are permanently untouched.
- **Fail-loud, never silently-wrong** — UNRESOLVABLE posts are flagged, not dropped.
- Gates classified fence-vs-accuracy (P7 concern) — this NEW gate is an **accuracy
  assertion**, not a regression fence.

### Integration Points
- New `parser/dwg/residual-gate.js` exposes `computeResiduals()` +
  `applyResidualGate()`.
- Invoked from `runDwgPairingCascade()` in `coordinate-calculator-dwg.js` after
  pairing produces `coords[]` — attaches decision/tiers to the result object
  (pure-judge: no behavior change).
- CI: new harness script added to the `test:gate` npm script.

</code_context>

<specifics>
## Specific Ideas

- LC posts-21–31: ~179 m absolute offset, ~9.6 m shape residual — the canonical
  proof-of-concept the anchor sub-score must catch while shape alone passes.
- Siriu graph-walk output: target shape-fidelity mean relative error **< 5%** →
  "trust".
- Threshold seeds from research: 5% trust / 15% fallback / >15% fail — calibrate
  against real Siriu before locking.

</specifics>

<deferred>
## Deferred Ideas

- **Active cascade rerouting/demotion on fail/fallback** → P7/P8 (this phase only
  judges).
- **KMZ placemark color + ExtendedData tier encoding, Portuguese failure messages,
  partial-output surfacing** → P9 (CONF-01..04).
- **DXF region anchor as absolute reference** → reconsider in/after P6 once
  ingestion exists; v1.1 P5 stays on user-provided GPS.
- **João Born / Valmor per-post position fixtures** → P7 prerequisites (used here
  only as false-fail sanity checks if already available).

</deferred>

---

*Phase: 05-truth-free-residual-gate*
*Context gathered: 2026-06-05*
