# Phase 08: Global PDF-DXF Solver - Context

**Gathered:** 2026-06-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Build a **global Hungarian bipartite solver** as cascade **level-0** that aligns
the PDF's numbered, distance-labeled route graph onto the DXF cable graph in a
single global assignment — replacing the greedy graph-walker's local hub/branch
decisions. The 2,723-line graph-walker is kept **byte-identical** as the level-1
strangler-fig fallback. Siriu's 85-post regression gate and the LC per-post
position gate must re-clear with **zero regression**, and the solver runs within
a 2-second budget on all named routes.

**In scope (SOLVE-01..04 + ROADMAP SC-1..4):**
1. `parser/dwg/global-solver.js` — `solveGlobalGraphAlignment()` returning the
   existing `{ ok, coords[] }` shape; never modifies level-1/level-2 code.
2. Hungarian global assignment (`munkres`, the one pre-authorized new dep) +
   post-hoc topology gate (arc-order monotonicity + hub-degree).
3. Level-0 integration into `runDwgPairingCascade()` with strict cascade +
   gate-based demotion and observable fallback.
4. **Wave 0 prerequisite:** DXF ingestion (Phase 6 work) executed and green
   FIRST, before any solver plan runs (see D-09).
5. Re-clear all four route gates (Siriu/LC/João Born/Valmor) with zero
   regression; walker byte-identical when uninvoked.

**Out of scope:** KMZ/UI tier surfacing + Portuguese failure messages (Phase 9),
partial-emission / stitched output (Phase 9), multi-zone CRS auto-detect
(MZONE-01), multi-anchor solving as a required input (production PDFs supply
only post 1).

</domain>

<decisions>
## Implementation Decisions

### Solver algorithm contract
- **D-01:** **Hybrid algorithm — Hungarian + post-hoc topology gate.** Hungarian
  (`munkres`) computes the global cost-minimal post→DXF-node assignment; then
  arc-order monotonicity and hub-degree are verified as post-hoc constraints. Any
  topology violation **rejects** the assignment and escalates to the walker. This
  reconciles SOLVE-01 (Hungarian) with SOLVE-03 (topology) — neither alone is
  sufficient (pure Hungarian can't enforce topology; pure BFS reintroduces greedy
  local minima). **Resolves the REQUIREMENTS-vs-ARCHITECTURE.md conflict:**
  ARCHITECTURE.md's "constrained BFS/DFS subgraph isomorphism" description is
  **superseded** — the assignment engine is Hungarian, not a BFS walk.
- **D-02:** **Combined cost function.** Cost(post i → DXF node j) = weighted sum
  of (a) geometric residual between the anchor-propagated PDF position and the
  DXF node, and (b) edge-span fit (DXF incident cable spans vs the post's printed
  inter-post distances). Uses both the absolute anchor AND distance constraints —
  hardest to fool by either alone (counters Pitfall 1 "confident but wrong").
- **D-03:** **Tractability = crop + candidate prune.** The region is already
  cropped to the route bbox before the cascade (`cropRegionToBbox`). On top of
  that, prune each post's candidates to **k ≤ 30** nearest nodes via `rbush`
  spatial query around its anchor-predicted position; non-candidates receive a
  sentinel (high) cost. Log a warning when the unpruned candidate set exceeds the
  ceiling. Guards the 2s budget on large DXFs (Pitfall 8 — Palhoça 35k INSERTs).

### Cascade selection rule
- **D-04:** **Strict cascade + gate demotion.** Solver runs first. On accept it is
  used and the walker is **NOT run** (short-circuit). On any failure, log
  `"solver demoted; using graph-walker"` and run the walker unchanged. Matches
  SC-3's observable-fallback wording and keeps the walker truly uninvoked on
  success (preserving byte-identical fallback behavior, Pitfall 2).
- **D-05:** **Solver accept bar = all three must hold:** (1) Phase-5 residual gate
  returns `"trust"` — both shape-fidelity AND absolute-anchor sub-scores pass (the
  sub-score that caught LC's 179m offset); (2) topology gate passes
  (arc-monotonicity + hub-degree); (3) the run finished within the 2s budget. Any
  one failing → demote. Strongest guard against confident-but-wrong final output.
  (Note: per 07 D-18 the absolute-anchor fence may be RED *mid-flight* during dev,
  but the *acceptance bar at phase exit* requires full gate trust.)

### Phase 6 sequencing (USER DIRECTIVE)
- **D-09:** **Fold Phase 6 (DXF Ingestion & Region Lookup) into Phase 8 as
  Wave 0 / "plan 0".** Phase 8 executes the DXF-ingestion deliverables FIRST;
  the solver requirements (SOLVE-01..04) execute only **after** Wave 0 completes
  and is green. No solver plan runs against un-normalized DXF inputs (Pitfall 5
  mis-zone risk). Strict dependency order is enforced *within* the phase.
  - The existing Phase 6 plans (`.planning/phases/06-dxf-ingestion-region-lookup/06-01..06-03-PLAN.md`)
    are the **basis** for Wave 0. **Planner discretion:** reuse them verbatim as
    Wave 0 vs. regenerate under the `08-` namespace — but the sequencing contract
    (ingestion green before solver) is LOCKED.

### Exit-gate scope & anchor
- **D-06:** **All four routes green to exit.** Phase 8 exits only when Siriu
  (85-post regression + per-post position), Luiz Carolino (position), João Born,
  and Valmor all pass their Phase-7-locked gates — solver either pairs within
  tolerance OR cleanly falls back to the walker with no regression. Exceeds the
  literal ROADMAP SC (Siriu + LC) to use the full Phase-7 fixture investment.
- **D-07:** **Single hard anchor on post 1.** Post 1 is pinned to the nearest DXF
  INSERT within tolerance using the user-provided lat1/lon1; all else solved
  relative to it (ARCHITECTURE.md Step 1). Keeps the solver's input contract
  **identical** for production and reference routes (production PDFs supply only
  post 1's GPS). Extra known GPS is NOT a solve input.

### Scale-derived thresholds (Pitfall 9 / SOLVE-03)
- **D-08:** **Both medians, cross-validated.** All thresholds (span tolerance,
  candidate window, monotonicity tolerance, anchor tolerance) derive from the
  **median printed inter-post distance** (PDF distance table) AND the **median
  DXF cable-span** in the cropped region. Require the two medians to agree within
  a factor before solving; **disagreement → raise a scale/unit-mismatch flag**
  (the signal doubles as a Pitfall 4/5 guard against silently-wrong units/zones).
  No fixed Siriu-calibrated point counts.

### Topology gate definition
- **D-10:** **Arc-order monotonicity is per-branch-segment (junction-aware).**
  Arc-position must increase monotonically only WITHIN each linear run between
  junctions; reset at each junction using the Phase-7 junction ground-truth.
  Correctly handles Siriu's forks and LC off-cable arms without firing false
  violations (a global single-sequence check would falsely fail every branch).
- **D-11:** **Hub-degree matching uses degree-class buckets** (1 = endpoint,
  2 = through, ≥3 = hub). A PDF post's **authoritative-edge** (phantom-filtered,
  per 07 D-15) degree class must equal the assigned DXF node's cable-degree class.
  Tolerant of DXF stub/spur edges that inflate raw degree.

### Solver failure granularity
- **D-12:** **All-or-nothing demotion.** Any acceptance failure → the whole route
  demotes to the walker, which produces the actual emitted output. The solver
  still returns `partialCoords`/`reason` for **diagnostics only** (never emitted
  as final coords). Single source of coordinates per route — easy to validate
  against the locked gates; matches SC-3 and the ARCHITECTURE.md output contract.
  Partial-emission (stitched solver+walker) is explicitly deferred to Phase 9.

### Demotion / confidence channel
- **D-13:** **Structured result fields + `warnings[]`.** Add stable fields to the
  cascade/success result (e.g. `solverPath`, `solverDemoted`, `demotionReason`,
  `solverScore`) AND push a human-readable string to the existing
  `warnings[]`/`userWarnings` array the diagnostic panel already reads;
  `console.log` for dev. Gives Phase 9 a clean contract to surface tiers without
  string-parsing; satisfies SC-3 observability. (UI rendering itself is Phase 9.)

### Cross-cutting (carried forward, not re-decided)
- **Strangler-fig:** solver = level-0; walker untouched level-1 fallback; assert
  walker output byte-identical on Siriu when solver not invoked (Pitfall 2).
- **Mid-flight gate policy (07 D-18):** hard red-lines (per-post position gates,
  Siriu regression, junction GT) stay green at every checkpoint; cumulative
  accuracy fences / absolute-anchor sub-score may go RED mid-flight only if
  audit-marked in `07-GATE-AUDIT.md`.
- **Phantom-edge filtering (07 D-15):** only source-tagged authoritative edges
  seed the route-graph fed to the solver; no degree≥3 junction from inferred-label
  edges alone (Pitfall 10).
- **`munkres`** (`munkres@2.0.3`, havelessbemore) is the ONLY new external dependency permitted (REQUIREMENTS).

### Claude's Discretion
- `munkres` rectangular-matrix / sentinel-cost handling when |PDF posts| ≠
  |DXF candidate nodes|, and treatment of posts with no viable candidate.
- Anchor-tolerance failure handling when no DXF INSERT is near post 1 (reason
  `"no-anchor"` demotion vs. tolerance relaxation).
- Exact weighting between position-residual and edge-span terms in D-02 cost.
- Exact agreement factor for the D-08 median cross-validation flag.
- Wave 0 plan reuse-vs-regenerate (D-09).
- Order/granularity of solver plan waves after Wave 0.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` §SOLVE-01..04 — solver requirements (Hungarian,
  level-0 strangler-fig, anchor/monotonicity/hub-degree, zero-regression). Note
  the "new deps beyond munkres" out-of-scope row.
- `.planning/ROADMAP.md` §"Phase 8: Global PDF-DXF Solver" — goal + SC-1..4.

### v1.1 research (MANDATORY — design + pitfalls)
- `.planning/research/ARCHITECTURE.md` §"P7: Global Solver — Component Design"
  (uses OLD numbering: its "P7 solver" = this Phase 8; "P8 confidence" = Phase 9).
  Integration Point 3 lists solver inputs already available at the call site.
  **NOTE:** its constrained-BFS algorithm sketch is SUPERSEDED by D-01 (Hungarian).
- `.planning/research/PITFALLS.md` — Pitfall 1 (confident-but-wrong / D-02),
  Pitfall 2 (Siriu regression via shared subsystems), Pitfall 3 (symmetric
  topology local minima / D-10), Pitfall 8 (in-browser perf / D-03), Pitfall 9
  (scale-threshold generalization / D-08), Pitfall 10 (phantom edges into solver).

### Phase prerequisites & gate policy
- `.planning/phases/07-solver-prerequisites/07-CONTEXT.md` — locked fixtures,
  txt ground-truth, four-tier accuracy, junction GT (D-12..D-15).
- `.planning/phases/07-solver-prerequisites/07-GATE-AUDIT.md` — every gate
  classified fence vs accuracy + Phase-8 mid-flight policy (referenced by D-05).
- `.planning/phases/05-truth-free-residual-gate/05-CONTEXT.md` — residual gate as
  pure judge; shape vs absolute-anchor sub-scores; tiers never numeric %.
- `.planning/phases/06-dxf-ingestion-region-lookup/06-CONTEXT.md` — DXF ingestion
  design; its plans become Phase-8 Wave 0 (D-09).
- `.planning/phases/06-dxf-ingestion-region-lookup/06-01-PLAN.md`,
  `06-02-PLAN.md`, `06-03-PLAN.md` — Wave 0 basis (reuse-or-regenerate).

### Code to extend (NOT rewrite)
- `parser/dwg/coordinate-calculator-dwg.js` — `runDwgPairingCascade()` (~line 134)
  gains level-0; success path (`applyResidualGate` ~line 452) is where confidence
  fields attach (D-13). Solver inputs assembled at the call site (~lines 277–319).
- `parser/dwg/graph-walker.js` — level-1 fallback; must stay byte-identical.
- `parser/dwg/residual-gate.js` — `computeResiduals`/`computeAnchorGap`/
  `applyResidualGate`; the solver's quality judge (D-05).
- `parser/dwg/global-solver.js` — **NEW** file for `solveGlobalGraphAlignment()`.

### Ground truth & gates (all four routes — must re-clear, D-06)
- `coordenadas postes siriu.txt` (85), `coordenadas postes rua luiz carolino pereira..txt`,
  `coordenadas postes rua joao born.txt`, `coordenadas postes rua valmor.txt`.
- `tools/run-siriu-post-position-gate.mjs`, `tools/run-lc-post-position-gate.mjs`,
  `tools/run-joaoborn-post-position-gate.mjs`, Valmor position gate,
  `tools/run-siriu-regression-gate.mjs`, `tools/run-residual-gate.mjs`,
  `parser/__tests__/fixtures/*-junction-ground-truth.json` — `npm run test:gate`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`runDwgPairingCascade()`** (`coordinate-calculator-dwg.js` ~line 134) — currently
  2 DWG levels (graph-walk → pdf-walk) + pdf-fallback; insert `solveGlobalGraphAlignment()`
  as level-0 ahead of `pairPostsByGraphWalk`.
- **`applyResidualGate(shape, anchor)`** (~line 452) — already applied post-cascade
  to the success result; reuse as the solver accept judge (D-05).
- **`rbush`** (already in package.json) — spatial index for the k≤30 candidate prune (D-03).
- **`cropRegionToBbox` + `buildAdjacencyGraph`** — already shrink/structure the DXF
  graph before the cascade; solver consumes `croppedRegion.posts`/`.cableEdges`/
  `adjacencyGraph` (ARCHITECTURE Integration Point 3) — no new upstream fetches.
- **Phase-7 junction GT fixtures** — feed D-10 per-branch monotonicity reset and
  D-11 phantom-filtered authoritative-degree computation.

### Established Patterns
- **Strangler-fig / additive** — new solver returns the same `{ ok, coords[] }`
  shape; never edits walker or associator thresholds (Pitfall 2).
- **Dual measurement** — PDF position gates catch layer-B regressions; txt GPS
  gates catch final accuracy; both must stay green (07 D-04).
- **Scale-derived, not constant** — derive all tolerances per-drawing (D-08); the
  failure mode of fixed Siriu constants is documented in Pitfall 9.

### Integration Points
- `runDwgPairingCascade()` — level-0 call + demotion log (D-04/D-13).
- Success result — new `solverPath`/`solverDemoted`/`demotionReason`/`solverScore`
  + `warnings[]` entry (D-13), read later by Phase 9 UI.
- `npm run test:gate` — single green-bar exit gate across all four routes (D-06).

</code_context>

<specifics>
## Specific Ideas

- The REQUIREMENTS↔ARCHITECTURE.md algorithm conflict is resolved in favor of a
  **Hungarian engine with a topology gate bolted on top** (D-01) — the user
  explicitly wanted the locked "Hungarian" requirement honored, not the older
  BFS sketch.
- The median cross-validation (D-08) is intended to **double as a unit/zone
  sanity check**, not just threshold derivation — a PDF-median vs DXF-median
  mismatch is treated as a loud signal, not silently absorbed.
- Phase 6 is **not** a separate run — the user directed it to live as Wave 0
  inside Phase 8 so the solver never executes against un-normalized DXF inputs.

</specifics>

<deferred>
## Deferred Ideas

- **Partial-emission (stitched solver + walker output)** → Phase 9 partial-output
  + per-post tier design.
- **KMZ/UI tier surfacing + Portuguese failure messages** → Phase 9 (Phase 8 only
  emits the structured data channel, D-13).
- **Multi-anchor GPS-confirmed solving as a required input** → not viable
  (production PDFs supply only post 1); extra GPS stays a read-only cross-check
  idea, not a Phase-8 solve input.
- **Multi-zone CRS auto-detection** → MZONE-01 backlog.

None of the discussion strayed outside the Phase-8 solver domain; the Phase-6
fold (D-09) is a sequencing directive, not scope creep.

</deferred>

---

*Phase: 08-global-pdf-dxf-solver*
*Context gathered: 2026-06-08*
