# Phase 8: Global PDF-DXF Solver - Research

**Researched:** 2026-06-08
**Domain:** Global bipartite graph alignment (Hungarian assignment) of a PDF numbered route-graph onto a DXF cable-graph, as cascade level-0, with post-hoc topology gating, in a browser-side geospatial pipeline.
**Confidence:** HIGH (cascade integration, gate policy, Phase 6 state, fixtures all verified from source; one corrected dependency-name finding below).

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Hybrid algorithm — Hungarian (`munkres`) computes the global cost-minimal post→DXF-node assignment; arc-order monotonicity + hub-degree are verified post-hoc. Any topology violation **rejects** the assignment and escalates to the walker. ARCHITECTURE.md's constrained-BFS sketch is **SUPERSEDED**.
- **D-02:** Combined cost function = weighted sum of (a) geometric residual between anchor-propagated PDF position and DXF node, and (b) edge-span fit (DXF incident cable spans vs printed inter-post distances).
- **D-03:** Tractability = crop (already done by `cropRegionToBbox`) + per-post candidate prune to **k ≤ 30** nearest nodes via `rbush`; non-candidates get a sentinel (high) cost; warn when unpruned set exceeds the ceiling.
- **D-04:** Strict cascade + gate demotion. Solver runs first; on accept the walker is **NOT run** (short-circuit); on any failure log `"solver demoted; using graph-walker"` and run the walker unchanged.
- **D-05:** Solver accept bar = ALL THREE: (1) Phase-5 residual gate returns `"trust"` (both shape AND anchor sub-scores pass); (2) topology gate passes (arc-monotonicity + hub-degree); (3) run finished within 2s budget. Any one failing → demote. (Mid-flight: absolute-anchor fence may be RED during dev per 07 D-18; acceptance bar at phase EXIT requires full gate trust.)
- **D-06:** All four routes green to exit — Siriu (85-post regression + per-post position), LC (position), João Born, Valmor.
- **D-07:** Single hard anchor on post 1, pinned to nearest DXF INSERT within tolerance using user lat1/lon1; all else solved relative. Input contract identical for production and reference routes; extra GPS is NOT a solve input.
- **D-08:** Both medians, cross-validated. All thresholds derive from median printed inter-post distance (PDF) AND median DXF cable-span (cropped region). Require the two medians to agree within a factor before solving; disagreement → raise scale/unit-mismatch flag.
- **D-09:** Fold Phase 6 (DXF Ingestion) into Phase 8 as **Wave 0**. Solver requirements (SOLVE-01..04) execute only after Wave 0 is green. Strict in-phase dependency. (Phase 6 plans 06-01..06-03 are the basis — reuse-vs-regenerate is planner discretion; sequencing is LOCKED.)
- **D-10:** Arc-order monotonicity is per-branch-segment (junction-aware). Monotonic only WITHIN each linear run between junctions; reset at each junction using Phase-7 junction ground-truth.
- **D-11:** Hub-degree matching uses degree-class buckets (1=endpoint, 2=through, ≥3=hub). A PDF post's authoritative-edge (phantom-filtered, 07 D-15) degree class must equal the assigned DXF node's cable-degree class.
- **D-12:** All-or-nothing demotion. Any acceptance failure → whole route demotes to walker. Solver returns `partialCoords`/`reason` for diagnostics ONLY (never emitted as final coords).
- **D-13:** Structured result fields (`solverPath`, `solverDemoted`, `demotionReason`, `solverScore`) + human-readable `warnings[]`/`userWarnings` entry + `console.log` for dev.
- **Strangler-fig:** solver = level-0; walker untouched level-1; assert walker output byte-identical on Siriu when solver not invoked.
- **Phantom-edge filtering (07 D-15):** only source-tagged authoritative edges seed the route-graph fed to the solver.
- **`munkres`** is the ONLY new external dependency permitted. (See "Package Legitimacy Audit" — the CONTEXT name `munkres-js@2.0.3` resolves to the `munkres` package; flagged for user confirmation.)

### Claude's Discretion
- Rectangular-matrix / sentinel-cost handling when |PDF posts| ≠ |DXF candidate nodes|; treatment of posts with no viable candidate.
- Anchor-tolerance failure handling when no DXF INSERT near post 1 (`"no-anchor"` demotion vs tolerance relaxation).
- Exact weighting between position-residual and edge-span terms (D-02).
- Exact agreement factor for the D-08 median cross-validation flag.
- Wave 0 plan reuse-vs-regenerate (D-09).
- Order/granularity of solver plan waves after Wave 0.

### Deferred Ideas (OUT OF SCOPE)
- Partial-emission (stitched solver + walker output) → Phase 9.
- KMZ/UI tier surfacing + Portuguese failure messages → Phase 9.
- Multi-anchor GPS-confirmed solving as a required input → not viable.
- Multi-zone CRS auto-detection → MZONE-01 backlog.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SOLVE-01 | Align PDF numbered route-graph to DXF cable-graph via global bipartite assignment (Hungarian), no per-route tuning | `munkres` package provides Hungarian over rectangular cost matrices; cost matrix built from D-02 cost; thresholds adaptive per D-08 medians (§ munkres API, § Cost Function) |
| SOLVE-02 | Solver runs as cascade level-0; falls back to walker when residual confidence low (strangler-fig) | Level-0 inserts in `runDwgPairingCascade()` before `pairPostsByGraphWalk`; demotion via `applyResidualGate` (§ Cascade Integration) |
| SOLVE-03 | Solver enforces anchor hard-constraint, arc-order monotonicity, hub-degree matching; thresholds adaptive to scale | Anchor = D-07 pinned post 1; monotonicity = D-10 per-branch from junction GT; hub-degree = D-11 degree-class from phantom-filtered fixtures; scale = D-08 medians (§ Topology Gate, § Median Cross-Validation) |
| SOLVE-04 | Re-clear Siriu (85-post regression + per-post position) and LC per-post position with ZERO regression | Hard red-lines in 07-GATE-AUDIT; strangler-fig keeps walker byte-identical when uninvoked (§ Validation Architecture) |
| DXF-01..07 | DXF ingestion & region lookup (Wave 0) | **Already shipped in Phase 6** — see § Phase 6 State; Wave 0 is verify/wire, not build-from-scratch |
</phase_requirements>

---

## Summary

Phase 8 inserts a **new** `parser/dwg/global-solver.js` as cascade **level-0** ahead of the existing graph-walker, using a Hungarian bipartite assignment (the `munkres` npm package) to align all PDF posts to DXF cable-nodes in one global optimization, then verifying arc-monotonicity and hub-degree as post-hoc topology constraints. The existing 2,723-line `graph-walker.js` stays byte-identical as the level-1 strangler-fig fallback. All inputs the solver needs are already assembled at the cascade call site (`coordinate-calculator-dwg.js` lines ~313–393) — no new upstream fetches. The accept bar (D-05) reuses the already-built `applyResidualGate` (residual-gate.js) plus a new topology gate plus a 2s budget; any failure demotes the entire route to the walker.

**Critical correction (verify with user):** The CONTEXT's `munkres-js@2.0.3` does not exist — `munkres-js` (addaleax) tops out at 1.2.2 (2017) and has no rectangular-matrix or sentinel support documented. Version `2.0.3` exists on the **`munkres`** package (havelessbemore), which explicitly advertises rectangular-matrix support, `Infinity`/`-Infinity` sentinels, ESM + TypeScript types, MIT license, and is actively maintained (2.1.1, 2024). The locked intent (Hungarian, v2.0.3) maps cleanly to `munkres`; the name `-js` suffix is almost certainly a transcription error. **The planner must surface this for user confirmation before install** (gated below).

Wave 0 (Phase 6 DXF ingestion, DXF-01..07) is **already fully executed and green** — all three Phase 6 plans have SUMMARY files and the timing gate is wired into `npm run test:gate`. Wave 0 therefore becomes a *verification/integration* wave (confirm green, confirm solver consumes normalized cropped region), not a build-from-scratch wave.

**Primary recommendation:** Install `munkres` (confirm name with user first), build `global-solver.js` as a pure additive level-0 returning the existing `{ ok, coords[] }` shape, derive all thresholds from the D-08 dual medians, gate accept on residual-trust + topology + 2s budget, and demote all-or-nothing to the untouched walker. Sequence: Wave 0 = verify Phase 6 green + median cross-validation harness; Wave 1 = candidate-prune + cost-matrix + Hungarian core; Wave 2 = topology gate (monotonicity + hub-degree); Wave 3 = cascade wiring + demotion channel + four-route exit gate.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Hungarian global assignment | Browser (client-side pure JS module) | — | Entire pipeline is client-only (no server, per REQUIREMENTS out-of-scope). `munkres` is pure JS/ESM. |
| Candidate pruning (rbush) | Browser (pure JS) | — | `rbush` already in deps; runs in `global-solver.js`. |
| DXF ingestion / CRS normalize | Browser + Worker | IndexedDB | Phase 6 shipped: `dxf-parse.worker.js` off-thread parse; region records in IndexedDB. |
| Region lookup by GPS | Browser (region-library) | Vercel Blob (DXF storage only) | `lookupByGps` already returns region or null; Phase 6 added `noRegionError`. |
| Residual gating | Browser (residual-gate.js) | — | Pure-math judge, already built; reused as solver accept judge. |
| Topology gate (monotonicity/hub-degree) | Browser (new in global-solver.js) | Phase-7 JSON fixtures | Junction GT fixtures are static JSON consumed at runtime/test. |
| Coordinate output | Browser → KML builder | — | Solver returns same `{ postNumber, lat, lon, source:"dwg", dwg_block }` coords shape. |

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `munkres` | `2.0.3` (latest `2.1.1`) | Hungarian / Munkres optimal assignment over rectangular cost matrices | The one pre-authorized new dep (per CONTEXT intent). Explicit rectangular + sentinel support, ESM, TS types, MIT. `[VERIFIED: npm registry]` for existence; `[ASSUMED]` that this is the package CONTEXT meant (name correction — see audit). |
| `rbush` | `^4.0.1` (in deps) | 2D spatial index for k≤30 candidate prune around each post's anchor-predicted position (D-03) | Already a project dependency; used by region-pairing. `[VERIFIED: package.json]` |

### Supporting (all already in-tree — no install)
| Library / Module | Purpose | When to Use |
|---------|---------|-------------|
| `parser/dwg/residual-gate.js` | `computeResiduals`/`computeAnchorGap`/`applyResidualGate` — solver accept judge (D-05) | Reuse verbatim; do NOT modify thresholds. |
| `parser/geo/utm-calibrator.js` | `latLonToUtm`/`utmToLatLon`/`haversineMeters` | Anchor → UTM (D-07); coords output; residual math. |
| `parser/dwg/region-pairing.js` | `buildPostIndex`/`buildAdjacencyGraph`/`DEFAULT_TOLERANCE_M` | Already build the postIndex + adjacencyGraph fed to the solver. |
| `parser/dwg/region-crop.js` | `cropRegionToBbox`/`routeUtmBbox` | Already crop the region before the cascade (D-03 first stage). |
| Phase-7 junction GT JSON fixtures | `{siriu,luizcarolino,joaoborn,valmor}-junction-ground-truth.json` | D-10 per-branch monotonicity reset + D-11 authoritative-degree (test-time + structure reference). |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `munkres` (havelessbemore) | `munkres-js` (addaleax) 1.2.2 | The literal CONTEXT name, BUT no 2.0.3 exists, last published 2017, no documented rectangular/sentinel API. Inferior; only chosen if user explicitly insists on that exact package name. |
| Hungarian (`munkres`) | Hand-rolled Hungarian | **Don't** — see Don't Hand-Roll. Hungarian is O(n³) and subtle; a buggy implementation produces confident-but-wrong assignments (Pitfall 1). |
| Combined cost (D-02) | Pure constrained-BFS (ARCHITECTURE sketch) | SUPERSEDED by D-01 — BFS reintroduces greedy local minima (Pitfall 3). |

**Installation:**
```bash
npm install munkres@2.0.3   # PENDING user confirmation of package name (see audit)
```

**Version verification (performed this session):**
- `npm view munkres-js versions` → `["1.1.0" … "1.2.2"]`; `dist-tags.latest = 1.2.2`; **no 2.0.3**. `[VERIFIED: npm registry]`
- `npm view munkres versions` → includes `2.0.3`, `2.0.4`, `2.0.5`, `2.1.0`, `2.1.1`; latest `2.1.1` (2024-03-27). `[VERIFIED: npm registry]`
- `npm view munkres@2.0.3` → `main: ./dist/munkres.js`, `module: ./dist/munkres.mjs`, `types: ./dist/munkres.d.ts`, no `postinstall`. `[VERIFIED: npm registry]`

---

## Package Legitimacy Audit

> slopcheck 0.6.1 is installed but its `install` subcommand returned "not available" in this environment (CLI surface mismatch). Per the graceful-degradation rule, the new package is tagged `[ASSUMED]` and the planner MUST gate its install behind a `checkpoint:human-verify` task — which is independently warranted here because of the name discrepancy.

| Package | Registry | Age | Source Repo | postinstall | slopcheck | Disposition |
|---------|----------|-----|-------------|-------------|-----------|-------------|
| `munkres` (havelessbemore) | npm | created 2024-03-27; 2.0.3 in version chain; latest 2.1.1 | github.com/havelessbemore/munkres | none | unavailable | **Flagged [ASSUMED]** — planner inserts `checkpoint:human-verify` to confirm this is the intended package vs the literal `munkres-js` name |
| `munkres-js` (addaleax) | npm | 2014–2017, latest 1.2.2 | github.com/addaleax/munkres-js | none | unavailable | **NOT recommended** — version 2.0.3 does not exist; no documented rectangular/sentinel API |
| `rbush` | npm | mature, already in deps | github.com/mourner/rbush | none | n/a | Approved (existing dependency) |

**Packages removed due to slopcheck [SLOP] verdict:** none.
**Packages flagged for human verification:** `munkres` — confirm (a) the package name (`munkres`, not `munkres-js`) and (b) the version (`2.0.3` vs the maintained `2.1.1`) with the user before install. The locked intent ("Hungarian, the one new dep, v2.0.3") is satisfiable ONLY by `munkres`.

---

## Phase 6 State (Wave 0 reality)

**Phase 6 is fully executed and green.** All three plans have SUMMARY files. `[VERIFIED: 06-01/02/03-SUMMARY.md]`

| Plan | Shipped | Key exports / artifacts |
|------|---------|------------------------|
| 06-01 | `addRegion()` hardened: zone-22S envelope check, mm÷1000 retry (`confidence: low`), Brazil-bbox corner validation, absent-extents `confidence: inferred`; `crs.confidence` on every region | `ZONE_22S`, `inZone22S`, `inBrazil`, `validateBrazilExtents` from `region-library.js`; fixtures `mm-scale.dxf`, `no-extents.dxf`; golden `siriu-bbox-golden.json` |
| 06-02 | `noRegionError(lat,lon,regions)` exported from `coordinate-calculator-dwg.js`; cascade attaches `dwgNoRegion:{code,nearest}` on miss; `lookupByGps` still returns null on miss (cloud fallback preserved); region dropdown shows GPS bbox | `noRegionError`; `no-region-lookup.test.mjs` |
| 06-03 | `dxf-parse.worker.js` off-thread parse; `runParse(dxfText)` dispatcher; fast index-based scanner for files ≥1 MB (Palhoça ~2.4 s vs ~13 s); >50 MB omit `sourceDxf` from IndexedDB; `tools/run-dxf-ingest-timing-gate.mjs` (Palhoça ≤5000 ms, ~4588 ms) wired into `npm run test:gate`; DXF-04 restore-and-query test | `runParse`; `dist/dxf-parse.worker.js` build target |

**Implication for Wave 0 (D-09):** Since Phase 6 already shipped, Wave 0 is **verify + adapt**, not build:
1. Confirm `npm run test:gate` (incl. `run-dxf-ingest-timing-gate.mjs`) is green at the Phase-8 start commit.
2. Confirm the solver's DXF input (`croppedRegion.posts`/`.cableEdges` + `adjacencyGraph` + `regionData.crs.zone`) is the **normalized** output of the Phase-6 pipeline (CRS-validated, unit-checked). It is — these are produced after `getRegionWithIndex` + `cropRegionToBbox` in `calculateCoordinatesWithDwg`.
3. Add the **median cross-validation harness** (D-08) as the Wave-0-to-Wave-1 seam — this is genuinely new (Phase 6 validated units/zone at ingest; D-08 adds a per-solve PDF-median vs DXF-median agreement check). Recommend this lives in Wave 0 because it is a pre-solve guard, not solver logic.

The DXF-01..07 requirement IDs are satisfied by Phase-6 code; Wave 0 re-attests them under the Phase-8 namespace (planner discretion: reuse 06-0x plans verbatim as 08-00, or regenerate a thin verification plan).

---

## munkres API (verified)

`[CITED: github.com/havelessbemore/munkres]`

```js
import { munkres } from "munkres";

// costMatrix[y][x] = cost of assigning row y (PDF post) to column x (DXF candidate node)
const costMatrix = [
  [1, 2, 3],
  [2, 4, 6],
  [3, 6, 9],
];
const assignments = munkres(costMatrix);   // → [[0,2],[1,1],[2,0]]  (length = min(rows,cols))
```

| Property | Behavior | Phase-8 usage |
|----------|----------|---------------|
| Input | `number[][]` (or `bigint[][]`/typed-array `MatrixLike`); `costMatrix[y][x]` = cost(row y → col x) | rows = PDF posts (in number order), cols = pruned DXF candidate nodes |
| Direction | **Minimizes** by default (`invertMatrix` helper to maximize) | We minimize the D-02 combined cost — direct fit |
| Rectangular | Handled natively; "unmatched ones are simply absent" from result; result length = `min(rows, cols)` | When |posts| ≠ |candidates|, some posts/nodes go unassigned — must detect and treat as a topology/coverage failure |
| Sentinel — forbid | `Infinity` → used only as a last resort when no finite alternative | D-03 non-candidate cells get a high finite sentinel OR `Infinity`; prefer a **large finite** sentinel so the solver still produces a result (Infinity-only rows can force pathological last-resort picks) |
| Sentinel — force | `-Infinity` → chosen whenever possible | D-07 anchor: post 1 → its pinned DXF INSERT can be forced with `-Infinity` |
| Return | `Array<[y, x]>` row/col index pairs | map y→post number, x→candidate node index |

**Discretion guidance (rectangular / no-candidate, CONTEXT discretion):**
- Build a **square padded** matrix when convenient: pad to `max(rows, cols)` with high-finite sentinel rows/cols so every post gets a slot, then post-filter assignments whose chosen cost ≥ sentinel as "no viable candidate" → topology/coverage fail (D-12 all-or-nothing demote).
- Prefer a **large finite** sentinel (e.g. `10 * maxRealCost`) over `Infinity` for non-candidate cells, reserving `Infinity` for truly illegal cells (wrong degree-class if you choose to encode hub-degree as a hard cost) so a single isolated post cannot poison the whole solve into last-resort territory.
- A post that lands on a sentinel-cost assignment is a **demotion signal**, not a silent emit.

---

## Cascade Integration (the exact insertion point)

`[VERIFIED: coordinate-calculator-dwg.js]`

`runDwgPairingCascade()` (lines 134–192) currently has **2 DWG levels** (the docstring says "three-level" but counts the caller fallback as level 3):
- Level 1: `pairPostsByGraphWalk(...)` → `dwgPath: "dwg-graph-walk"`
- Level 2: `pairPostsAgainstRegion(...)` → `dwgPath: "dwg-pdf-walk"`
- Caller fallback: `pdf-fallback`

**Level-0 inserts at the very top of `runDwgPairingCascade()`, before the Level-1 `pairPostsByGraphWalk` call.** It receives the exact same destructured params already passed in. Existing levels shift down conceptually (graph-walk becomes the demotion target).

**Inputs already assembled at the call site** (lines 313–393, ARCHITECTURE Integration Point 3) — no new fetches:

| Solver input | Source at call site | Shape |
|--------------|---------------------|-------|
| `posts` (routePosts) | line 313–317 `deduplicatePostsPreferLowerPage(...).sort(by number)` | `[{ number, x, y, lat?, lon?, page, ... }]` |
| `distances` | passed through | `[{ from, to, meters, source }]` |
| `connections` | line 304–307 prefers `walkConnections` (preserves branch-return edges) | `[{ from, to, gap }]` |
| `startLat/startLon` | `lat1/lon1` | anchor (D-07) |
| `regionData` | `getRegionWithIndex` result | `{ crs:{zone,confidence}, posts, cableEdges, ... }` |
| `regionPosts` | line 327 `croppedRegion.posts` | `[{ x, y, block }]` (UTM) |
| `regionEdges` | line 328 `croppedRegion.cableEdges` | cable polyline edges (UTM endpoints) |
| `postIndex` | line 329 `buildPostIndex(regionPosts)` | rbush over DXF nodes |
| `adjacencyGraph` | line 330 `buildAdjacencyGraph(...)` | DXF cable adjacency (degree info) |
| `gpsByPostNumber` | line 342–347 `Map<number,{lat,lon}>` (PDF-anchored) | for anchor sub-score / median |

**Cascade return shape (must preserve):** `{ ok: true, coords: [...], dwgPath: "..." }` or `{ ok: false }`. Solver success adds `dwgPath: "global-solve"` (D-13 adds `solverPath`/`solverDemoted`/`demotionReason`/`solverScore` at the success-result build in `calculateCoordinatesWithDwg`, lines 433–452).

**Coords entry shape (must match walker, lines 1165–1171):** `{ postNumber, lat, lon, source: "dwg", dwg_block }`. Convert DXF node UTM `(x,y)` → lat/lon via `utmToLatLon(x, y, zoneExpected)`.

**Demotion (D-04):** on any accept-bar failure, the solver returns `{ ok: false, reason, partialCoords }`; `runDwgPairingCascade` logs `"solver demoted; using graph-walker"` and proceeds to call `pairPostsByGraphWalk` **unchanged with the same pristine inputs** (Pitfall 2 integration gotcha — never pass walker a state mutated by the solver attempt; the solver must not mutate `posts`/`distances`/`regionPosts`).

---

## Architecture Patterns

### System Architecture Diagram

```
PDF route (posts[], distances[], walkConnections[])     DXF region (croppedRegion.posts[], cableEdges[], adjacencyGraph)
        │                                                         │
        └──────────────┬──────────────────────────────┬──────────┘
                       ▼                                ▼
            [D-08] median cross-validate:  median(PDF inter-post dist) vs median(DXF cable span)
                       │  disagree → raise scale/unit flag → demote ("scale-mismatch")
                       ▼  agree (within factor)
            [D-07] anchor: post1 → nearest DXF INSERT within tol
                       │  none → demote ("no-anchor")
                       ▼
            [D-03] per post: rbush k≤30 nearest DXF nodes around anchor-propagated position
                       │  (warn if unpruned > 30)
                       ▼
            [D-02] build cost matrix  cost[post][cand] = w_pos·posResidual + w_span·spanFit
                       │  non-candidate cells → high-finite sentinel; anchor row → -Infinity force
                       ▼
            [SOLVE-01] munkres(costMatrix) → assignments [[postIdx, candIdx], ...]
                       ▼
            map assignments → coords[{postNumber,lat,lon,source,dwg_block}]
                       ▼
            ┌──────────────── ACCEPT BAR (D-05, all three) ────────────────┐
            │ (1) applyResidualGate(shape, anchor) === "trust"             │
            │ (2) topology gate: arc-monotonicity[D-10] + hub-degree[D-11] │
            │ (3) wall-clock < 2000 ms                                     │
            └──────────────────────────────────────────────────────────────┘
                  │ all pass                         │ any fail
                  ▼                                  ▼
        { ok:true, coords, dwgPath:"global-solve" }  log "solver demoted; using graph-walker"
                                                     │
                                                     ▼
                                   pairPostsByGraphWalk(...) [UNCHANGED level-1]
```

### Recommended Project Structure
```
parser/dwg/
├── global-solver.js          # NEW — solveGlobalGraphAlignment(): anchor, prune, cost, munkres, topology gate
├── coordinate-calculator-dwg.js  # MODIFIED — level-0 call in runDwgPairingCascade + D-13 fields
├── graph-walker.js           # UNCHANGED — byte-identical level-1 fallback
├── residual-gate.js          # UNCHANGED — reused as accept judge
├── region-pairing.js         # UNCHANGED — buildPostIndex/buildAdjacencyGraph reused
└── region-crop.js            # UNCHANGED — cropRegionToBbox reused
tools/
└── run-solver-*-gate.mjs     # NEW (optional) — solver-path assertions if separate from existing gates
```

### Pattern 1: Additive level-0, pristine fallback inputs
**What:** `solveGlobalGraphAlignment` is a pure function returning `{ ok, coords[] }`; it never edits the walker or any shared threshold; it never mutates its inputs so the walker gets a pristine run on demotion.
**When:** Always — this is the strangler-fig contract and the Pitfall-2 guard.

### Pattern 2: Scale-derived thresholds (no Siriu constants)
**What:** Derive span tolerance, candidate window, monotonicity tolerance, anchor tolerance from `median(PDF inter-post)` and `median(DXF span)` (D-08). No fixed point counts.
**When:** Everywhere a tolerance appears. The walker's `SPAN_TOL_FRAC=0.15` (graph-walker.js:11) is a reasonable seed *fraction* but the absolute meters must come from the per-drawing median.

### Anti-Patterns to Avoid
- **Mutating the graph-walker** to fix a route the solver fails — debug the solver instead (ARCHITECTURE Anti-Pattern 1).
- **Computing residuals after KMZ build** — the gate must run inside the cascade before committing a level (Anti-Pattern 2).
- **Global single-sequence monotonicity** — falsely fails every branch; must reset per junction segment (D-10).
- **Feeding raw inferred-label edges to the solver** — phantom degree≥3 junctions poison topology matching (Pitfall 10, D-15). Filter to authoritative-source edges first.
- **`Infinity`-everywhere non-candidate cells** — can force last-resort pathological picks; prefer large-finite sentinels.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Optimal bipartite assignment | Custom Hungarian / greedy matcher | `munkres` package | O(n³) algorithm with subtle dual-variable bookkeeping; a buggy version yields confident-but-wrong assignments (Pitfall 1). |
| Nearest-k spatial query | Linear scan over all DXF nodes | `rbush` (already in deps) | O(N) scan freezes on Palhoça-scale (Pitfall 8); rbush gives k≤30 in log time. |
| Truth-free quality judge | New residual metric | `applyResidualGate` (residual-gate.js) | Already calibrated (shape median <5%, anchor p95 <10m) and catches the LC 179m rigid offset (Pitfall 1). |
| UTM↔WGS84 conversion | New projection math | `utm-calibrator.js` (in-house Snyder TM) | REQUIREMENTS explicitly forbids new geo deps; reuse the validated path. |
| DXF unit/zone normalization | New ingestion path | Phase-6 `addRegion`/`runParse` | Already shipped and gated (06-01/03). |

**Key insight:** Every numeric constant in `distance-associator.js`/`post-positioning.js`/`graph-walker.js` is Siriu-calibrated. Building the solver on top of those constants (rather than deriving from per-drawing medians) is the documented Pitfall-9 failure mode. The solver's only legitimate "constants" are *fractions* and *factors*, never absolute point/meter counts.

---

## Topology Gate Detail (D-10 + D-11)

### Arc-order monotonicity, per-branch-segment (D-10)
`[VERIFIED: siriu-junction-ground-truth.json + 07-GATE-AUDIT.md]`

The junction GT fixtures define, per route, the authoritative junctions and their arms:
- Siriu junctions: **5, 14, 36, 48, 60, 62, 70** (the ONLY label-degree≥3 posts). Post 36 is degree-4 (2 DFS slots).
- Each junction lists `arms: [{ to, meters, inbound }]` and `forbiddenArms` (phantom edges that must be absent, e.g. `36→39`, `48→51`).
- JB is **linear** (zero junctions); Valmor linear/near-linear.

**How the gate works:** Partition the post sequence into **linear runs between junctions** using the GT junction set. Within each run, require the assigned DXF node's **arc-position** (cumulative cable-span distance from the run's start node along the cable path) to increase monotonically post-to-post (within a tolerance derived from D-08 median). **Reset the monotonic accumulator at each junction** — do not carry arc-position across a fork. A violation *within a run* ⇒ local-minimum signal ⇒ reject (Pitfall 3).

**Why GT fixtures prevent false positives:** A naive global single-sequence monotonicity check would fire on every legitimate branch (Siriu has 7 forks; LC has off-cable arms at posts 9–10). The fixtures tell the gate *where the legitimate resets are*, so the check only fires on genuine non-monotonic mis-assignments inside a linear run — not on the route's real topology. Mid-flight, the junction GT oracles (`branch-traversal*.test.mjs`) are **hard red-lines** (07-GATE-AUDIT §3) and must already be green before the solver trusts any solution.

### Hub-degree matching, degree-class buckets (D-11)
`[VERIFIED: 07-GATE-AUDIT.md D-15 phantom filtering]`

Bucket degree into classes: **1 = endpoint, 2 = through, ≥3 = hub**.
- Compute the PDF post's degree from **authoritative-source edges only** (07 D-15): `bifurcation-main`, `branch-arm-rehomed`, `override` — NEVER from `inferred-label` edges alone (those create phantom degree≥3, Pitfall 10).
- Compute the assigned DXF node's cable-degree from `adjacencyGraph`, then bucket it (tolerant of DXF stub/spur edges that inflate raw degree — bucket ≥3 collapses the distinction).
- **Constraint:** PDF post's degree-class must equal the DXF node's degree-class. Mismatch (e.g. a PDF junction post assigned to a DXF cable-tip) ⇒ reject (Pitfall 3 warning sign).

Implementation choice (CONTEXT discretion): encode hub-degree mismatch either as a **post-hoc rejection** (cleaner, matches D-01 "post-hoc gate") OR as a hard `Infinity` cost in the matrix (forces munkres to avoid it). Recommend **post-hoc rejection** to keep the cost matrix purely geometric and the topology gate auditable as a separate stage.

---

## Median Cross-Validation Detail (D-08)

**Two medians:**
1. `medianPDF` = median of printed inter-post `distances[].meters` (consecutive labelled edges).
2. `medianDXF` = median of cable-span lengths in the cropped region (`hypot(edge.b.x-edge.a.x, edge.b.y-edge.a.y)` over `regionEdges`).

**Agreement check (before solving):** require `1/F ≤ medianPDF/medianDXF ≤ F` for an agreement factor `F` (CONTEXT discretion — recommend `F ≈ 2`, aligning with Pitfall 9's "within 2x of Siriu baseline" guidance). Disagreement ⇒ raise a **scale/unit-mismatch flag** and demote with reason `"scale-mismatch"` (do not silently proceed).

**Why it doubles as a unit/zone guard (Pitfall 4/5):** A mm-vs-m unit error inflates `medianDXF` ~1000×; a wrong-zone DXF inflates spans wildly. Either makes `medianPDF/medianDXF` fall outside `[1/F, F]`, so the same agreement check that derives tolerances also catches silently-wrong units/zones that slipped past ingestion. The medians then **set the absolute tolerances**: span tolerance ≈ `SPAN_TOL_FRAC · medianPDF`, candidate window ≈ a multiple of `medianPDF`, etc.

---

## Wave Plan Breakdown (recommended)

| Wave | Goal | Depends on | Deliverables |
|------|------|-----------|--------------|
| **Wave 0** (D-09 prerequisite) | DXF ingestion green + pre-solve scale guard | — | (a) attest Phase-6 `npm run test:gate` green incl. ingest-timing gate; (b) confirm solver consumes normalized cropped region; (c) **new** median cross-validation module + unit test (D-08). |
| **Wave 1** | Hungarian core | Wave 0 + `munkres` installed (after user confirm) | `global-solver.js` skeleton: anchor (D-07), rbush prune k≤30 (D-03), D-02 cost matrix, `munkres()` call, coords mapping, 2s timer. Returns `{ok,coords}` without topology gate yet. Unit tests on a synthetic small graph. |
| **Wave 2** | Topology gate | Wave 1 | Arc-monotonicity per-branch (D-10) + hub-degree class (D-11) using junction GT + authoritative-edge filtering (D-15). Accept bar assembled (residual-trust + topology + budget, D-05). Synthetic degenerate fixtures (uniform-spacing, swapped-node, off-cable arm) that must REJECT. |
| **Wave 3** | Cascade wiring + exit | Wave 2 | Level-0 insertion in `runDwgPairingCascade`; demotion log + D-13 structured fields/warnings; pristine-input guarantee; four-route exit gate green (D-06); Siriu byte-identical-when-uninvoked assertion. |

Dependencies are strictly linear (each wave gates the next). Wave 0 MUST be green before Wave 1 runs any solve (D-09 LOCKED). The `munkres` install checkpoint sits at the Wave-0→Wave-1 boundary.

CONTEXT discretion (D-09): Wave 0 may reuse `06-0x` plans verbatim under the `08-00` namespace OR be a thin verification+median-guard plan. Recommend the **thin verification + new median-guard** form, since the build work already shipped.

---

## Common Pitfalls

### Pitfall 1: Confident-but-wrong rigid offset (Pitfall 1 / D-02 / D-05)
**What goes wrong:** A globally shifted/rotated assignment reproduces all printed distances (low shape residual) but is absolutely mis-positioned — the LC posts 21–31 ~179m offset with ~9.6m shape residual.
**How to avoid:** Accept bar requires the **anchor** sub-score to pass too (D-05 reuses `applyResidualGate`, which already encodes anchor p95 <10m). Never accept on shape alone.
**Warning sign:** tight cluster (low shape residual) far from the anchor.

### Pitfall 2: Siriu regression through shared subsystems
**What goes wrong:** Touching shared placement code regresses Siriu's 85-post output invisibly under cumulative gates.
**How to avoid:** Solver is purely additive; walker byte-identical; assert "solver bypassed, walker output" on Siriu; run **per-post position gates** (the hard red-lines) at every checkpoint, never just cumulative ceilings.
**Warning sign:** position gate drifts even 1–2 posts while `test:gate` "passes".

### Pitfall 3: Symmetric-topology local minima
**What goes wrong:** Uniform-spacing runs produce cost-symmetric assignments; munkres picks one, possibly node-skipping or trunk/tap swap.
**How to avoid:** Anchor hard-constraint (D-07), arc-monotonicity reject (D-10), hub-degree class match (D-11). Anchor-free ⇒ FAIL, not low-confidence.
**Warning sign:** multiple solutions within ~5% cost; degree-1 DXF node assigned to a PDF junction post.

### Pitfall 8: In-browser perf on large DXF
**What goes wrong:** Unpruned O(n²)–O(n³) over Palhoça-scale freezes the tab.
**How to avoid:** crop (done) + rbush k≤30 prune (D-03) + 2s wall-clock budget that demotes. Warn when unpruned candidate set >30.
**Warning sign:** candidate count routinely >30; solve >2s.

### Pitfall 9: Scale-threshold generalization
**How to avoid:** Derive every absolute tolerance from D-08 medians; only fractions/factors are constants.

### Pitfall 10: Phantom edges into the solver
**How to avoid:** Filter the route-graph to authoritative-source edges (07 D-15) before computing post degree; junction GT oracles must be green first.

### Integration gotcha: planar vs haversine in the cost
`[CITED: PITFALLS.md Integration Gotchas]` Printed distances are UTM-planar. Use **planar Euclidean on UTM** `(x,y)` for span/residual comparison inside the solver/cost; use haversine ONLY for the final lat/lon output and for the residual-gate's anchor sub-score. Mixing the two introduces a systematic ~cos(lat) bias.

### Integration gotcha: label rounding tolerance
Printed labels are 0.1m precision; apply ±5% rounding tolerance in the distance-match cost term.

---

## Runtime State Inventory

> Phase 8 is additive code + one new dependency. No rename/refactor/migration of stored state.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — solver reads region records produced by Phase 6; writes no new persisted keys. | none |
| Live service config | None. | none |
| OS-registered state | None. | none |
| Secrets/env vars | Test-only env flags (`GW_RETURN_IDX`, `*_UPDATE_BASELINE`); no new secrets. Do NOT re-seed hard red-line baselines (07-GATE-AUDIT §5). | none |
| Build artifacts | `scripts/build.mjs` already emits `dist/dxf-parse.worker.js` (Phase 6). Adding `munkres` to deps requires `npm install`; if the solver is bundled for browser, confirm esbuild picks up `munkres` ESM (`module: ./dist/munkres.mjs`). | verify esbuild resolves `munkres` ESM during `node scripts/build.mjs` |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ARCHITECTURE.md constrained-BFS subgraph isomorphism | Hungarian (`munkres`) + post-hoc topology gate | D-01 (CONTEXT 2026-06-08) | BFS sketch SUPERSEDED; assignment engine is Hungarian. |
| `munkres-js` (addaleax) 1.2.2 | `munkres` (havelessbemore) 2.x | package ecosystem 2024 | Rectangular + sentinel + ESM + TS; the `-js` package is stale (2017). |
| Fixed Siriu point constants | Per-drawing median-derived tolerances | D-08 | Generalization across drawings (Pitfall 9). |

**Deprecated/outdated:**
- `munkres-js@2.0.3` — **does not exist**; the maintained path is `munkres@2.x`.
- ARCHITECTURE.md §"P7: Global Solver" Steps 4 (constrained BFS) — superseded; Steps 1–3, 5–6 (anchor, build graphs, score=residual, return shape) remain valid.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The CONTEXT-locked `munkres-js@2.0.3` is the `munkres` package (havelessbemore), not the literal `munkres-js` (addaleax). | Standard Stack / Audit | HIGH if wrong — wrong package installed. **Must confirm with user** (the only Hungarian package at 2.0.3 with rectangular support is `munkres`). |
| A2 | esbuild resolves `munkres`'s ESM (`module: ./dist/munkres.mjs`) cleanly for the browser bundle. | Runtime State | LOW — fallback to `main` CJS or import the `.mjs` directly; verify at Wave 1. |
| A3 | Agreement factor F≈2 for D-08 median cross-validation (aligns with Pitfall 9 "within 2x"). | Median Cross-Validation | MEDIUM — too tight false-flags legit drawings; too loose misses unit errors. Calibrate against the four routes. CONTEXT-marked discretion. |
| A4 | Cost weighting w_pos / w_span (D-02) starts balanced and is tuned against Siriu/LC. | Cost Function | MEDIUM — CONTEXT-marked discretion; tune so the gate stays "trust" on Siriu. |
| A5 | Hub-degree is enforced post-hoc (rejection) rather than as in-matrix `Infinity` cost. | Topology Gate | LOW — both valid; post-hoc keeps cost matrix geometric and auditable. CONTEXT discretion. |

---

## Open Questions

1. **Exact `munkres` package + version** — `munkres@2.0.3` vs maintained `munkres@2.1.1`.
   - What we know: 2.0.3 exists on `munkres`; latest is 2.1.1; both advertise the same rectangular API.
   - Recommendation: confirm package name with user (checkpoint), then prefer the CONTEXT-pinned `2.0.3` for reproducibility unless the user accepts `2.1.1`.

2. **Anchor-tolerance failure handling (D-07, CONTEXT discretion)** — `"no-anchor"` demotion vs tolerance relaxation when no DXF INSERT is near post 1.
   - Recommendation: demote with `reason:"no-anchor"` (fail loud) rather than silently relaxing; relaxation risks the Pitfall-3 anchor-free local minimum.

3. **Square-padding vs native-rectangular munkres call** — padding to `max(rows,cols)` with sentinels simplifies "every post gets a slot" detection.
   - Recommendation: native rectangular call + explicit unassigned-post detection (result length = min(rows,cols)); treat any unassigned post as coverage-fail → demote.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js + npm | install/build/test | ✓ | (project baseline) | — |
| `rbush` | candidate prune (D-03) | ✓ | 4.0.1 (in deps) | — |
| `munkres` (havelessbemore) | Hungarian core (SOLVE-01) | ✗ (not yet installed) | 2.0.3 available on registry | none viable — `munkres-js` lacks the rectangular API; hand-roll forbidden |
| Phase-6 ingestion pipeline | Wave 0 (DXF-01..07) | ✓ shipped | — | — |
| `npm run test:gate` harness | exit gate (D-06) | ✓ | — | — |

**Missing dependencies with no fallback:** `munkres` — must be installed (after user name/version confirmation). This is the single blocking install; planner gates it behind a `checkpoint:human-verify` (also covers the A1 name discrepancy).

---

## Validation Architecture

> nyquist_validation is not explicitly disabled — section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node built-in `node:test` (`node --test`) + bespoke `tools/run-*-gate.mjs` exit-code gates |
| Config file | none (script-driven via `package.json` `test:gate` / `test:gate:fixtures`) |
| Quick run command | `node --test parser/__tests__/<solver>.test.mjs` |
| Full suite command | `npm run test:gate` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SOLVE-01 | munkres assignment on synthetic + real route | unit | `node --test parser/__tests__/global-solver.test.mjs` | ❌ Wave 1 |
| SOLVE-02 | level-0 runs first; demotes to walker on fail | unit | `node --test parser/__tests__/global-solver-cascade.test.mjs` | ❌ Wave 3 |
| SOLVE-03 | anchor hard-constraint, arc-monotonicity, hub-degree, adaptive thresholds | unit | `node --test parser/__tests__/global-solver-topology.test.mjs` | ❌ Wave 2 |
| SOLVE-03 (scale) | D-08 median cross-validation flags unit/zone mismatch | unit | `node --test parser/__tests__/median-crossval.test.mjs` | ❌ Wave 0 |
| SOLVE-04 | Siriu 85-post regression + per-post position zero-regression | gate | `node tools/run-siriu-regression-gate.mjs && node tools/run-siriu-post-position-gate.mjs` | ✅ exists |
| SOLVE-04 | LC per-post position zero-regression | gate | `node tools/run-lc-post-position-gate.mjs` | ✅ exists |
| D-06 | JB + Valmor position green | gate | `node tools/run-joaoborn-post-position-gate.mjs && node tools/run-valmor-post-position-gate.mjs` | ✅ exists |
| D-10/D-11 | junction GT oracles stay green (phantom-free) | test | `node --test parser/__tests__/branch-traversal*.test.mjs` | ✅ exists |
| Pitfall 8 | solve <2s on each route | gate | (assert inside solver test / new `run-solver-timing-gate.mjs`) | ❌ Wave 1 |
| DXF-01..07 | ingestion green (Wave 0) | gate | `node tools/run-dxf-ingest-timing-gate.mjs` (+ `dxf-ingestion.test.mjs`) | ✅ exists |

### Hard red-lines (must stay green at EVERY checkpoint — 07-GATE-AUDIT §3)
- `run-{siriu,lc,joaoborn,valmor}-post-position-gate.mjs` (per-post position)
- `run-siriu-regression-gate.mjs`
- `branch-traversal{,-lc,-joaoborn,-valmor}.test.mjs` (junction GT / phantom)
- Foundational units: `graph-walker.test.mjs`, `distance-associator.test.mjs`, `coordinate-calculator.test.mjs`

### Soft mid-flight fences (may go RED on a CORRECT solver fix — re-baseline deliberately per 07-GATE-AUDIT §5)
- `run-residual-gate.mjs` (LC 21–31 anchor must-fail — solver is *expected* to flip this)
- `run-route-joaoborn-pdf-accuracy-gate.mjs`, `run-valmor-accuracy-gate.mjs` (cumulative ceilings)
- LC/JB txt-accuracy zero-bad-tier exit rules (`run-{lc,joaoborn}-txt-accuracy-gate.mjs`)
- Siriu/Valmor txt-accuracy zero-bad-tier exit rules

**Re-baseline protocol (07-GATE-AUDIT §5):** before re-seeding any soft fence, confirm ALL hard red-lines green; confirm the RED is an intended improvement; never re-seed a hard red-line to make it pass.

### Sampling Rate
- **Per task commit:** the relevant new `global-solver*.test.mjs` + the four per-post position gates (fast hard red-lines).
- **Per wave merge:** `npm run test:gate` (full four-route + junction + ingest).
- **Phase gate:** full `npm run test:gate` single green bar across all four routes (D-06).

### Wave 0 Gaps
- [ ] `parser/__tests__/median-crossval.test.mjs` — D-08 PDF/DXF median agreement + unit/zone-mismatch flag (Wave 0).
- [ ] `parser/__tests__/global-solver.test.mjs` — munkres core on synthetic + Siriu region (Wave 1).
- [ ] `parser/__tests__/global-solver-topology.test.mjs` — monotonicity/hub-degree reject fixtures incl. uniform-spacing degenerate + off-cable arm (Wave 2).
- [ ] `parser/__tests__/global-solver-cascade.test.mjs` — level-0-then-demote; pristine-walker-input; Siriu byte-identical-when-uninvoked (Wave 3).
- [ ] (optional) `tools/run-solver-timing-gate.mjs` — 2s budget assertion (Pitfall 8).

---

## Security Domain

> `security_enforcement` not located as `false`; included minimally. This phase is client-side pure computation over already-ingested local data with one new pure-JS math dependency.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | n/a (no auth surface in solver) |
| V3 Session Management | no | n/a |
| V4 Access Control | no | n/a (client-side) |
| V5 Input Validation | yes | Validate region/PDF inputs: skip NaN/null coords (residual-gate already does); D-08 median guard rejects out-of-envelope DXF; fail-loud not silently-wrong (REQUIREMENTS core value). |
| V6 Cryptography | no | n/a |
| Supply chain (V14) | yes | New dep `munkres` — verify name/version (checkpoint), MIT license, no postinstall (verified), pin exact version. |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Slopsquat / wrong-package install (`munkres-js` vs `munkres`) | Tampering | Human-verify checkpoint before install; pin exact version; confirm repo (havelessbemore/munkres). |
| Silently-wrong GPS output (confident-but-wrong) | Information disclosure (misleading data) | D-05 accept bar + anchor sub-score + D-08 scale guard → demote/fail loud, never emit wrong coords. |
| DoS via unbounded matrix on large DXF | DoS | rbush k≤30 prune + 2s budget demotion (D-03, Pitfall 8). |

---

## Sources

### Primary (HIGH confidence)
- `parser/dwg/coordinate-calculator-dwg.js` — cascade structure, level-0 insertion point, call-site inputs, result shape (read in full).
- `parser/dwg/residual-gate.js` — accept-judge API and thresholds (read in full).
- `parser/dwg/graph-walker.js` lines 1047–1174 — `pairPostsByGraphWalk` signature, coords push shape, anchor step.
- `parser/dwg/region-pairing.js` — DXF node `{x,y,block}` shape, span math.
- `parser/__tests__/fixtures/siriu-junction-ground-truth.json` — junction set, arms, forbiddenArms structure (D-10/D-11).
- `.planning/phases/06-dxf-ingestion-region-lookup/06-0{1,2,3}-SUMMARY.md` — Phase 6 shipped state (Wave 0).
- `.planning/phases/07-solver-prerequisites/07-GATE-AUDIT.md` — hard red-line vs soft fence classification, re-baseline protocol.
- `.planning/research/ARCHITECTURE.md`, `PITFALLS.md` — design + 10 pitfalls.
- `npm view munkres / munkres-js` (this session) — version existence, main/module/types, no postinstall. `[VERIFIED: npm registry]`

### Secondary (MEDIUM confidence)
- `github.com/havelessbemore/munkres` (WebFetch) — API: `munkres(costMatrix)`, `costMatrix[y][x]`, rectangular handling, `Infinity`/`-Infinity` sentinels, minimization, `invertMatrix`. `[CITED]`

### Tertiary (LOW confidence)
- A1 package-identity inference (`munkres-js@2.0.3` → `munkres`) — needs user confirmation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH for `rbush`/in-tree modules; MEDIUM for `munkres` (API verified, package-name identity assumed pending user confirm).
- Cascade integration / inputs: HIGH — read directly from source.
- Topology gate (D-10/D-11): HIGH — junction GT fixtures and gate audit verified.
- Phase 6 / Wave 0 state: HIGH — all three SUMMARYs confirm shipped + gated.
- Pitfalls: HIGH — grounded in this codebase's documented failure history.

**Research date:** 2026-06-08
**Valid until:** ~2026-07-08 (stable; the `munkres` package and in-tree code are not fast-moving). Re-verify `munkres` version before install.
