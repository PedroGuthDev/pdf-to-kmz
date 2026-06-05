# Phase 05: Truth-Free Residual Gate - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-05
**Phase:** 05-truth-free-residual-gate
**Areas discussed:** Gate role, Anchor reference, Per-post tier derivation, Calibration & fixtures

---

## Gate role in P5

| Option | Description | Selected |
|--------|-------------|----------|
| Pure judge | Computes residuals + attaches gate decision/tiers; no rerouting; output bytes identical to today. Demotion deferred to P7/P8. | ✓ |
| Active gatekeeper now | Demotes cascade / drops to PDF-only on fail this phase. Risks Siriu regression before solver exists. | |
| Judge + advisory warning | Pure judge but also pushes a userWarning on fail/fallback. | |

**User's choice:** Pure judge (recommended)
**Notes:** Matches research "wraps cascade, no behavior change". P5 measures, does not change pipeline output.

---

## Absolute-anchor reference source

| Option | Description | Selected |
|--------|-------------|----------|
| User-provided first-post GPS | Anchor = lat1/lon1; checks route doesn't drift off where the anchor implies. Fully truth-free; no P6 dependency. | ✓ |
| DXF region anchor | Use matched DXF geometry as reference. Couples P5 to P6 ingestion. | |
| Per-route truth fixture | Stored truth coords per route. Works for 4 known routes but NOT truth-free. | |

**User's choice:** User-provided first-post GPS (recommended)
**Notes:** Surfaced a key subtlety — first post is pinned to the anchor by construction, so a naive computed-vs-anchor residual is always ~0. Captured as mandatory research directive D-03: the anchor sub-score must measure a quantity not pinned by construction (DWG-paired geometry vs anchored PDF placement gap = the LC ~179 m).

---

## Per-post tier derivation

| Option | Description | Selected |
|--------|-------------|----------|
| Per-post from incident edges | Each post's tier from its own incident-edge residuals; UNRESOLVABLE when no edge/coord. Route decision = aggregate. | ✓ |
| Route-level uniform tier | One decision stamped on every post. Loses per-post diagnostic value P9 needs. | |
| Hybrid: route gate + per-post flags | Route-level headline plus secondary per-post flag. | |

**User's choice:** Per-post from incident edges (recommended)
**Notes:** Preserves granularity for P9 KMZ coloring/ExtendedData.

---

## Calibration & regression fixtures

| Option | Description | Selected |
|--------|-------------|----------|
| Siriu-baseline + all-route sanity | Calibrate to real Siriu, sanity-check other routes don't false-fail. Constants in residual-gate.js. LC fixture = real captured output. | ✓ |
| Siriu-only, hardcoded | Calibrate strictly to Siriu, no sanity-check. Risks other routes false-failing. | |
| Synthetic LC fixture | Inject ~179 m offset into clean route instead of capturing real LC output. | |

**User's choice:** Siriu-baseline + all-route sanity (recommended)
**Notes:** LC 21–31 fixture sourced from real captured output (faithful to the actual failure mode).

---

## Claude's Discretion

- Exact gate-result object schema / field names (consistent with existing result shape + `dwgStatus`).
- Whether MED/LOW per-post boundary uses one or two intermediate thresholds (decided during Siriu calibration).

## Deferred Ideas

- Active cascade rerouting/demotion → P7/P8.
- KMZ tier color + ExtendedData, Portuguese failure messages, partial output → P9.
- DXF region anchor as absolute reference → reconsider in/after P6.
- João Born / Valmor per-post position fixtures → P7 prerequisites.
