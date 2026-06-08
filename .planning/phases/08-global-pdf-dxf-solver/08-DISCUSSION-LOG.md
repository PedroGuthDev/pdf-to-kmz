# Phase 08: Global PDF-DXF Solver - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-08
**Phase:** 08-global-pdf-dxf-solver
**Areas discussed:** Solver algorithm contract, Cascade selection rule, Phase 6 sequencing, Exit-gate scope & anchor, Scale-derived thresholds, Topology gate definition, Solver failure granularity, Demotion / confidence channel

---

## Solver algorithm contract

### Q1 — Hungarian vs constrained-BFS authority

| Option | Description | Selected |
|--------|-------------|----------|
| Hybrid: Hungarian + topology checks | Hungarian global assignment + post-hoc arc-monotonicity/hub-degree gate; violation rejects→escalates. Honors SOLVE-01 + SOLVE-03. | ✓ |
| Pure Hungarian (requirements win) | Straight bipartite cost-matrix; can't enforce topology natively — Pitfall 3 risk. | |
| Constrained-BFS (architecture wins) | ARCHITECTURE.md subgraph walk; amend SOLVE-01. Not globally optimal. | |

**User's choice:** Hybrid: Hungarian + topology checks
**Notes:** Resolves the REQUIREMENTS↔ARCHITECTURE.md conflict — Hungarian engine is authoritative, BFS sketch superseded.

### Q2 — Hungarian cost basis

| Option | Description | Selected |
|--------|-------------|----------|
| Combined: position + edge-span fit | Weighted anchor-propagated position residual + edge-span fit. Counters Pitfall 1. | ✓ |
| Geometric position residual only | Anchor-propagated Euclidean distance only; rigid offset can still score well. | |
| Edge-span distance fit only | Pure shape-fidelity; invariant to global displacement (LC 179m mode). | |

**User's choice:** Combined: position + edge-span fit

### Q3 — Cost-matrix tractability (2s budget)

| Option | Description | Selected |
|--------|-------------|----------|
| Crop + candidate prune (k≤30) | Region crop + per-post rbush prune to k≤30, sentinel cost otherwise; warn over ceiling. | ✓ |
| Rely on region crop only | Full matrix over cropped posts; dense crop could blow budget. | |
| Candidate prune only | Always prune vs full region; pays spatial-query cost every run. | |

**User's choice:** Crop + candidate prune (k≤30)

---

## Cascade selection rule

### Q1 — How level-0 wins vs falls through

| Option | Description | Selected |
|--------|-------------|----------|
| Strict cascade + gate demotion | Solver first; short-circuit walker on accept; on fail log "solver demoted; using graph-walker", walker runs unchanged. | ✓ |
| Best-of comparison | Always run both, pick lower residual; walker always executes. | |
| Solver-first, walker-confirm on Siriu only | Strict cascade but assert solver ≤ walker on Siriu fixture. | |

**User's choice:** Strict cascade + gate demotion

### Q2 — Solver accept bar

| Option | Description | Selected |
|--------|-------------|----------|
| All three: gate trust + topology + budget | Residual gate "trust" (shape AND absolute-anchor) + topology pass + within 2s. Any fail → demote. | ✓ |
| Gate trust + topology only | 2s budget treated as soft warning. | |
| Shape sub-score + topology only | Defers absolute-anchor (mid-flight); not the final bar. | |

**User's choice:** All three: gate trust + topology + budget

---

## Phase 6 sequencing

### Q1 — Handle unexecuted Phase 6 dependency

| Option | Description | Selected |
|--------|-------------|----------|
| Proceed now on existing region data | Build solver against existing v1.0-normalized data; Phase 6 stays prerequisite for new DXFs only. | |
| Block on Phase 6 first | Strict roadmap order: full Phase 6, then Phase 8. | |
| Minimal Phase 6 slice first | Pull only crs.zone guarantee; defer rest of Phase 6. | |
| **(User override)** Fold Phase 6 in as Wave 0 / plan 0 | Phase 6 work executes as the opening wave inside Phase 8; solver reqs run after. | ✓ |

**User's choice:** "yes phase 06, place it inside phase 08 as a plan 0, and actual phase 08 req to be done after the phase 06 plan execution"
**Notes:** User initially typed "phase 03" — clarified to mean Phase 6 (the only unexecuted Phase 8 dependency; Phases 5 and 7 complete, Phase 3 shipped in v1.0). Existing 06-* plans are the Wave 0 basis; planner decides reuse-vs-regenerate, sequencing contract locked.

---

## Exit-gate scope & anchor

### Q1 — Exit-gate route scope

| Option | Description | Selected |
|--------|-------------|----------|
| All four routes green | Siriu + LC + João Born + Valmor all pass locked gates. | ✓ |
| SC routes only (Siriu + LC) | Literal ROADMAP SC; JB/Valmor informational. | |
| All four, JB/Valmor soft fence | Siriu+LC hard; JB/Valmor reported but non-blocking. | |

**User's choice:** All four routes green

### Q2 — Anchor strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Single hard anchor (post 1) | Post 1 pinned to nearest DXF INSERT; identical input contract for all routes. | ✓ |
| Multi-anchor where GPS exists | Extra known-GPS posts as anchors; only reference routes have multi-post GPS. | |
| Single hard anchor + GPS cross-check | Anchor on post 1; extra GPS read-only validation into gate sub-score. | |

**User's choice:** Single hard anchor (post 1)

---

## Scale-derived thresholds

### Q1 — Scale signal source

| Option | Description | Selected |
|--------|-------------|----------|
| Both, cross-validated | Median printed inter-post distance AND median DXF cable-span; agree-within-factor or raise scale/unit-mismatch flag. | ✓ |
| Median printed inter-post distance | Pitfall 9 literal; PDF-only; no DXF cross-check. | |
| DXF cable-span distribution | Geometry-grounded; trusts DXF; no unit cross-check. | |

**User's choice:** Both, cross-validated

---

## Topology gate definition

### Q1 — Arc-order monotonicity scope

| Option | Description | Selected |
|--------|-------------|----------|
| Per-branch-segment (junction-aware) | Monotonic within linear runs between junctions; reset at junctions via Phase-7 GT. | ✓ |
| Global single-sequence | Monotonic across entire post-number ordering; breaks on branches. | |

**User's choice:** Per-branch-segment (junction-aware)

### Q2 — Hub-degree matching

| Option | Description | Selected |
|--------|-------------|----------|
| Degree-class (endpoint/through/hub) | Bucket 1/2/≥3; PDF authoritative-edge class = DXF cable-degree class. Tolerant of stubs. | ✓ |
| Exact degree equality | Exact integer match; DXF spurs cause false rejects. | |

**User's choice:** Degree-class (endpoint/through/hub)

---

## Solver failure granularity

### Q1 — Fallback granularity

| Option | Description | Selected |
|--------|-------------|----------|
| All-or-nothing demotion | Any failure → whole route to walker; solver partialCoords for diagnostics only. | ✓ |
| Partial stitch (solver + walker) | Keep valid sub-trees, walker fills failing region; mixes two systems. | |
| All-or-nothing now; partial in Phase 9 | Lock all-or-nothing; defer partial-emission to Phase 9. | |

**User's choice:** All-or-nothing demotion

---

## Demotion / confidence channel

### Q1 — Where to emit demotion + confidence

| Option | Description | Selected |
|--------|-------------|----------|
| Structured result fields + warnings[] | solverPath/solverDemoted/demotionReason/solverScore + warnings[] string + console. | ✓ |
| warnings[] string only | Human string only; Phase 9 must parse strings. | |
| Console/log only for now | Defer all surfacing to Phase 9; weak observability. | |

**User's choice:** Structured result fields + warnings[]

---

## Claude's Discretion

- munkres-js rectangular-matrix / sentinel-cost handling and no-candidate posts.
- Anchor-tolerance failure when no DXF INSERT is near post 1.
- Exact position-residual vs edge-span weighting in the cost function.
- Exact agreement factor for the median cross-validation flag.
- Wave 0 plan reuse-vs-regenerate.
- Order/granularity of solver plan waves after Wave 0.

## Deferred Ideas

- Partial-emission (stitched solver + walker) → Phase 9.
- KMZ/UI tier surfacing + Portuguese failure messages → Phase 9.
- Multi-anchor GPS-confirmed solving as required input → not viable (production PDFs supply only post 1).
- Multi-zone CRS auto-detection → MZONE-01 backlog.
