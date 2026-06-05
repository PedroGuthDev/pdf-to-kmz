# Phase 5: Truth-Free Residual Gate - Research

**Researched:** 2026-06-05
**Domain:** Truth-free geospatial residual scoring (pure-math quality judge over paired coordinates)
**Confidence:** HIGH — grounded in direct source analysis + live measurement of all four named routes this session
**Model:** claude-opus-4-8

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** The gate is a **pure judge** this phase. It computes residuals and attaches a gate decision + per-post tiers to the result object. It does **NOT** reroute, demote, or change coordinate output — output bytes stay identical to today. Active cascade demotion is deferred to P7/P8.
- **D-02:** The absolute reference is the **user-provided first-post GPS** (`lat1`/`lon1`). The gate stays fully truth-free (no per-route truth fixtures in the live path). It does NOT depend on P6 DXF ingestion.
- **D-03 (mandatory research directive):** The first post is *pinned* to the user anchor by construction, so a naive "computed-first-post vs user-GPS" residual is always ~0 and catches nothing. The absolute-anchor sub-score MUST measure a quantity **not pinned by construction** — e.g., how far the **DWG-paired** route geometry sits from where the user-anchored PDF path places the same posts (that gap *is* the ~179 m in the LC case). RESOLVED in this research — see `## Absolute-Anchor Sub-Score (D-03 Resolution)`.
- **D-04:** Each post's tier (HIGH/MED/LOW/UNRESOLVABLE) is derived from its **own incident-edge residuals**. Posts with no labelled edge / no paired coordinate are tagged **UNRESOLVABLE** (flagged, never silently omitted). The route-level gate decision is the aggregate of these per-post values.
- **D-05:** Calibrate thresholds against **real Siriu output** as the baseline, then **sanity-check** that Valmor / João Born / LC-good-portion do not false-fail. Thresholds live as **named constants in `residual-gate.js`** (initial estimates 5% trust / 15% fallback / >15% fail — replace with Siriu-calibrated values, then lock).
- **D-06:** The LC 21–31 regression fixture is **real captured LC output** (the actual rigid-offset result), stored as a JSON fixture — not a synthetic injected offset.
- **D-07:** Output is TIER labels only (HIGH/MED/LOW/UNRESOLVABLE) at every surface. A numeric "accuracy %" seal is an explicit anti-feature. (v1.1 lock.)

### Claude's Discretion
- Exact gate-result object schema / field names (e.g. `dwgConfidence`, `gateDecision`) — planner to design, consistent with the existing result shape in ARCHITECTURE.md and the existing `dwgStatus` field.
- Whether the per-post tier MED/LOW boundary is one or two intermediate thresholds — planner decides during Siriu calibration.

### Deferred Ideas (OUT OF SCOPE)
- Active cascade rerouting/demotion on fail/fallback → P7/P8 (this phase only judges).
- KMZ placemark color + ExtendedData tier encoding, Portuguese failure messages, partial-output surfacing → P9 (CONF-01..04).
- DXF region anchor as absolute reference → reconsider in/after P6; v1.1 P5 stays on user-provided GPS.
- João Born / Valmor per-post position fixtures → P7 prerequisites (used here only as false-fail sanity checks if already available).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ACC-01 | Compute a **shape-fidelity** residual per labelled edge (`\|haversine(A,B) − printed_distance\|`) and aggregate per route — no GPS truth | `computeResiduals()` design + `haversineMeters` reuse (verified at `utm-calibrator.js:770`). **CRITICAL: aggregation must be median/robust, not mean — see `## State of the Art`** |
| ACC-02 | Compute an **absolute-anchor** residual (DWG-paired geometry vs user-anchored reference) | Resolved in `## Absolute-Anchor Sub-Score (D-03 Resolution)` — measured live at 202 m mean on LC |
| ACC-03 | HIGH only when **both** sub-scores pass; either failing downgrades/fails. LC 21–31 rigid-offset (≈179 m off, ~6–9.6 m shape) **must fail** | Two-gate `applyResidualGate()`; LC fixture math verified live (shape 6.1 m / GT 178.7 m on PDF-path 21–31) |
| ACC-04 | Gate runs as CI over validated routes, thresholds calibrated against Siriu before locked | New harness mirrors `route-dwg-accuracy-harness.mjs`; hooks into `test:gate`. Siriu live baseline captured below |
| ACC-05 | Per-post confidence **tier** (HIGH/MED/LOW/UNRESOLVABLE) derived from residuals | Per-post tier derivation from incident-edge residuals — algorithm in `## Architecture Patterns` |
</phase_requirements>

## Summary

Phase 5 builds `parser/dwg/residual-gate.js`: a pure-math quality judge (~100–200 lines) that
scores any paired-coordinate result with two independent sub-scores — **shape-fidelity**
(internal distance consistency) and **absolute-anchor** (global georeferencing) — and assigns
per-post confidence tiers. A route is HIGH only when both pass. The gate is a pure judge this
phase (D-01): it attaches a decision + tiers to the result object and changes no output bytes.

**The single most important finding from live measurement:** a naive *mean* of per-edge relative
error does **not** yield the sub-5% number the roadmap targets — not even on Siriu, the gold route.
Computed over raw consecutive `parsed.distances` edges, Siriu's mean relative error is **60.5%**
and João Born's is **607%**, because a handful of junction / branch-return edges (where consecutive
post numbers are not physically adjacent) carry 500–1000%+ error and destroy the mean. The **median**
relative error is 0.3% (Siriu), 0.2% (Valmor), 4.4% (João Born) — robust and sane. The shape-fidelity
aggregator MUST be median (or a trimmed/outlier-rejected aggregate), and the gate must surface
per-edge outliers separately. This re-interprets the CONTEXT.md "5% mean" estimate as a robust
aggregate, not an arithmetic mean. See `## State of the Art`.

**D-03 is resolved.** The absolute-anchor sub-score is the **per-post displacement between the
DWG-paired coords (`cascade.coords`) and the user-anchored PDF coords (`gpsByPostNumber`)**, both
of which are already built side-by-side inside `calculateCoordinatesWithDwg` immediately before the
cascade returns. Both share post 1 as a fixed anchor, so the *gap is zero at post 1 by construction*
and grows wherever the two paths disagree — exactly the ~179–202 m LC signal. This is not pinned by
construction (verified live: LC mean gap 202 m, post 1 gap 1 m). See `## Absolute-Anchor Sub-Score`.

**Primary recommendation:** Implement `computeResiduals()` (per-edge shape residual, **median**
aggregate, per-edge outlier list) + `computeAnchorGap()` (DWG-vs-PDF per-post displacement) +
`applyResidualGate()` (two-gate decision + per-post tiers) as pure functions over `Math.*` and the
existing `haversineMeters`. Add a `tools/run-residual-gate.mjs` CI harness mirroring
`route-dwg-accuracy-harness.mjs`, wire it into `npm run test:gate`. Calibrate thresholds against the
live Siriu numbers captured below, then lock as named constants.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-edge shape residual | Pure-math module (`residual-gate.js`) | — | Self-contained; inputs are coords[] + distances[]; reuses `haversineMeters` |
| Absolute-anchor gap | Pure-math module | Integration glue in `coordinate-calculator-dwg.js` | Needs both `cascade.coords` AND `gpsByPostNumber`, both already assembled at the call site |
| Two-gate decision + tiers | Pure-math module | — | Pure function of the two sub-scores + thresholds |
| Gate invocation (attach to result) | `coordinate-calculator-dwg.js` (`runDwgPairingCascade` / success path) | — | Additive wrap; pure judge, no behavior change (D-01) |
| CI assertion over routes | `tools/run-residual-gate.mjs` + `test:gate` script | `route-dwg-accuracy-harness.mjs` (reused scaffolding) | Mirrors existing gate-harness pattern |
| Per-route truth (calibration only) | Test harness | — | Truth fixtures used to *validate* the gate, NEVER in the live gate path (truth-free, D-02) |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| (none — pure `Math.*`) | — | Residual arithmetic | STACK.md explicit: "pure `Math.*` for residuals"; no library needed [CITED: .planning/research/STACK.md] |
| In-house `haversineMeters` | — | Inter-post GPS distance | Already exported from `parser/geo/utm-calibrator.js:770`; reuse directly [VERIFIED: grep utm-calibrator.js:770] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `fake-indexeddb/auto` | dev-only | Test harness only (region library stub) | Import in the new CI harness, mirroring existing gates [VERIFIED: grep run-lc-post-position-gate.mjs:23] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| In-house haversine | `turf.js` | REJECTED — 400+ kB; haversine already in-house [CITED: .planning/research/STACK.md "Do NOT Add"] |
| `Math.*` stats | `ml-matrix`/`numeric.js` | REJECTED — overkill; median/trim are trivial [CITED: STACK.md] |

**Installation:** No new dependencies. `package.json` `dependencies` confirmed: no stats/geo libs
added. `"type": "module"` confirmed (ESM only). [VERIFIED: node -e package.json read]

**Version verification:** N/A — zero new packages. Existing `haversineMeters` confirmed present and
exported. No registry install occurs in this phase.

## Package Legitimacy Audit

> **Not applicable.** Phase 5 installs **zero** external packages (confirmed against STACK.md
> "No changes to package.json until P7" and the live `package.json` read). The only new npm
> dependency in all of v1.1 is `munkres-js@2.0.3` at P7. slopcheck/registry verification is
> therefore unnecessary for this phase. If the planner introduces any package, run the Package
> Legitimacy Gate before adding it.

## Architecture Patterns

### System Architecture Diagram

```
                  calculateCoordinatesWithDwg(posts, distances, lat1, lon1, ..., regionLibrary)
                                    │
        ┌───────────────────────────┼─────────────────────────────────────┐
        │                           │                                      │
   calculateCoordinates()    runDwgPairingCascade(...)              [ALREADY BUILT, line 314-319]
   (PDF-only path)                  │                               gpsByPostNumber =
        │                          coords[] (DWG-paired)            Map<postNum,{lat,lon}>
        ▼                           │                               from pdfResult.posts
   pdfResult.posts ───────────► gpsByPostNumber                     (user-anchored PDF coords)
   (user-anchored)              (PDF coords)                              │
                                    │                                     │
                                    ▼                                     ▼
                       ┌─────────────────────────────────────────────────────────┐
                       │  [NEW P5]  residual-gate.js                              │
                       │                                                          │
                       │  computeResiduals(coords, distances)                     │
                       │    per labelled edge: |haversine(A,B) − printed| / printed│
                       │    → { medianRelError, perEdge[], outliers[] }   (SHAPE) │
                       │                                                          │
                       │  computeAnchorGap(coords, gpsByPostNumber)               │
                       │    per post: haversine(dwgCoord, pdfCoord)               │
                       │    → { meanGapM, p95GapM, perPost[] }           (ANCHOR) │
                       │                                                          │
                       │  applyResidualGate(shape, anchor, thresholds)            │
                       │    decision = shape.pass && anchor.pass ? trust : ...    │
                       │    perPost tiers: HIGH/MED/LOW/UNRESOLVABLE              │
                       └─────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                  result.dwgConfidence (attached; NO coord change — D-01)
                                    │
                                    ▼
                          KML Builder → KMZ  (unchanged this phase)
```

The diagram's key insight (and D-03 resolution): the two coordinate sets the anchor sub-score
compares are *both already present at the call site* — `cascade.coords` and `gpsByPostNumber` are
built within ~50 lines of each other in `coordinate-calculator-dwg.js`. No new upstream data is
needed.

### Recommended Project Structure
```
parser/dwg/
└── residual-gate.js          # NEW — computeResiduals, computeAnchorGap, applyResidualGate (pure)
parser/dwg/
└── coordinate-calculator-dwg.js   # MODIFIED additively — call gate, attach dwgConfidence
tools/
├── residual-gate-harness.mjs      # NEW — parameterized per-route runner (mirror route-dwg-accuracy-harness.mjs)
└── run-residual-gate.mjs          # NEW — CI gate; asserts Siriu trust, LC fail
parser/__tests__/fixtures/
└── luizcarolino-residual-mustfail.json   # NEW — real captured LC output (D-06)
```

### Pattern 1: Shape-Fidelity with Robust Aggregation (ACC-01)
**What:** Per-edge relative error over labelled edges, aggregated by **median** (not mean).
**When to use:** Always — this is the primary sub-score.
**Why median:** Live measurement (this session) shows the mean is destroyed by a few junction edges.
```js
// Source: derived from ARCHITECTURE.md §"computeResiduals" + live measurement this session
export function computeResiduals(coords, distances) {
  // coords: [{ postNumber, lat, lon }] ; distances: [{ from, to, meters, source }]
  const byNum = new Map(coords.filter(c => c.lat != null).map(c => [c.postNumber, c]));
  const perEdge = [];
  for (const d of distances) {
    if (!(d.meters > 0)) continue;             // skip cleared/blocked edges (meters null)
    const A = byNum.get(d.from), B = byNum.get(d.to);
    if (!A || !B) continue;                     // endpoint unpaired → not a shape edge
    const hav = haversineMeters(A.lat, A.lon, B.lat, B.lon);
    const relError = Math.abs(hav - d.meters) / d.meters;
    perEdge.push({ from: d.from, to: d.to, printed: d.meters, hav, relError, residualM: Math.abs(hav - d.meters), source: d.source });
  }
  const rels = perEdge.map(e => e.relError).sort((a, b) => a - b);
  const median = rels.length ? rels[Math.floor(rels.length / 2)] : null;
  const p95 = rels.length ? rels[Math.floor(rels.length * 0.95)] : null;
  return { medianRelError: median, p95RelError: p95, edgeCount: perEdge.length, perEdge };
}
```
**Open decision for planner:** median vs trimmed-mean(80%) vs outlier-rejected mean. Live numbers
(below) show median is cleanest on known-good routes; trimmed-80% also works on Siriu/Valmor but is
noisier on João Born (21.7%). Recommend **median for the route decision** + **per-edge outlier list**
(edges with relError > some cut, e.g. 0.30) surfaced for per-post tiering. Decide final aggregator
during Siriu calibration (D-05).

### Pattern 2: Absolute-Anchor Gap (D-03 resolution, ACC-02)
**What:** Per-post displacement between DWG-paired coords and user-anchored PDF coords.
**When to use:** Always — this is the secondary sub-score that catches rigid offsets.
```js
// Source: D-03 resolution + live measurement (LC mean gap 202 m, post 1 gap 1 m)
export function computeAnchorGap(coords, gpsByPostNumber) {
  // coords: DWG-paired [{ postNumber, lat, lon }]
  // gpsByPostNumber: Map<postNumber,{lat,lon}> = user-anchored PDF positions
  const perPost = [];
  for (const c of coords) {
    if (c.lat == null) continue;
    const pdf = gpsByPostNumber.get(c.postNumber);
    if (!pdf) continue;
    const gapM = haversineMeters(c.lat, c.lon, pdf.lat, pdf.lon);
    perPost.push({ postNumber: c.postNumber, gapM });
  }
  const gaps = perPost.map(p => p.gapM).sort((a, b) => a - b);
  const mean = gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : null;
  const p95 = gaps.length ? gaps[Math.floor(gaps.length * 0.95)] : null;
  return { meanGapM: mean, p95GapM: p95, perPost };
}
```
**Why this is not trivially zero (the D-03 trap):** post 1 is the only post pinned in BOTH paths,
so its gap is ~0 (measured: 1 m). Every other post can disagree. The DWG path snaps to DXF INSERTs;
the PDF path projects via UTM-grid calibration + label chain. When they agree the route is doubly
confirmed (Valmor: needs measurement, expected small); when they diverge the gap *is* the
georeferencing error (LC: 186 m at post 4 onward).

### Pattern 3: Per-Post Tier Derivation (D-04, ACC-05)
**What:** Each post gets HIGH/MED/LOW/UNRESOLVABLE from its own incident edges + its anchor gap.
```
For each post P:
  incidentEdges = perEdge entries where from==P or to==P
  if P has no paired coord OR no labelled incident edge → UNRESOLVABLE  (flag, never drop)
  else:
    shapeScore  = max(relError over incidentEdges)   // worst incident edge
    anchorScore = perPost gapM for P
    tier = (shapeScore < SHAPE_HIGH && anchorScore < ANCHOR_HIGH) ? HIGH
         : (shapeScore < SHAPE_MED  && anchorScore < ANCHOR_MED ) ? MED
         : (shapeScore < SHAPE_LOW  || anchorScore < ANCHOR_LOW ) ? LOW
         : LOW   // (planner: MED/LOW boundary count is discretionary per D-05)
Route decision = aggregate:
  trust    if median shape passes AND anchor passes (e.g. p95 gap < ANCHOR_FAIL)
  fail     if either sub-score fails its hard threshold
  fallback (middle band) — note: this phase only attaches the label (D-01); P7/P8 acts on it
```
**Handling 0 / 1 / 2 incident edges (the explicit ACC-05 question):**
- **0 paired coord** → UNRESOLVABLE (post not in `coords` or lat==null).
- **0 labelled incident edges but has coord** → tier from anchor-gap ALONE; mark shape as "no-edge".
- **1 incident edge** → shapeScore = that edge's relError.
- **2 incident edges** → shapeScore = max (worst) of the two. (Mean would mask one bad edge; max is
  fail-loud — consistent with the project's "never silently wrong" lock.)

### Anti-Patterns to Avoid
- **Mean of per-edge relative error as the route score** — measured 60% on Siriu, 607% on João Born.
  A few junction/branch-return edges dominate. Use median + outlier list. [VERIFIED: live measurement]
- **Computing residuals after the KMZ is built** — gate must wrap the cascade result, not post-process
  output. [CITED: ARCHITECTURE.md Anti-Pattern 2]
- **Using GPS ground-truth in the live gate path** — truth fixtures are for *calibration/validation only*
  (D-02). The live gate sees only printed distances + the two coordinate sets. [CITED: ARCHITECTURE.md AP-3]
- **A single-score (shape-only) gate** — would pass the LC rigid offset confidently. The anchor sub-score
  is mandatory. [CITED: PITFALLS.md Pitfall 1]
- **Treating registry/`parsed.distances` raw edges as all "labelled real edges"** — many are
  `inferred-label`, `bifurcation-main`, `bifurcation-cleared` (meters null), `jumpback-refill`. Filter
  on `meters > 0` and be aware non-consecutive inferred chords inflate error. [VERIFIED: live edge dump]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| GPS inter-point distance | A new haversine | `haversineMeters` from `utm-calibrator.js:770` | Already correct, tested, used by every other harness |
| Per-route DWG run for the harness | A bespoke pipeline | `runRouteDwgAccuracyHarness` / `buildRegionBundle` / `createFixtureLibrary` from `route-dwg-accuracy-harness.mjs` | Proven scaffolding; already loads PDF + region + runs `calculateCoordinatesWithDwg` |
| CI gate skeleton (baseline load, compare, exit 1, UPDATE_BASELINE env) | A new harness shape | Mirror `run-route-dwg-accuracy-gate.mjs` / `run-siriu-regression-gate.mjs` | Established `slackM`, baseline-write, `process.exit(1)` pattern |
| Region library in tests | Real IndexedDB | `createFixtureLibrary(bundle)` + `fake-indexeddb/auto` | Existing stub returns the bundle for `lookupByGps`/`getRegionWithIndex` |

**Key insight:** Almost everything the CI gate needs already exists in `route-dwg-accuracy-harness.mjs`
— it already runs the full DWG pipeline per route and even rebuilds `gpsByPostNumber`. The new harness
is mostly: call the existing runner, then call the new `residual-gate.js` functions on its output.

## Common Pitfalls

### Pitfall 1: Mean Aggregation Looks Right on Valmor, Lies on Siriu/João Born
**What goes wrong:** Implement the literal CONTEXT.md formula `mean(|haversine−printed|/printed)`,
test on Valmor (mean 0.5% — passes), ship it. It then reports 60% on Siriu and 607% on João Born and
the "trust at <5%" criterion can never be met on the very route it's calibrated against.
**Why it happens:** Consecutive post numbers are not always physically adjacent. Branch returns,
junctions, and `jumpback-refill` edges produce single edges at 500–1050% relative error that dominate
the arithmetic mean. (Siriu post pairs like the branch-return edges; LC 20→21 measured at 1050%.)
**How to avoid:** Use **median** for the route-level shape score; keep a per-edge outlier list for
tiering. Verify the chosen aggregator yields <5% on Siriu AND Valmor before locking (D-05).
**Warning signs:** Route shape score > 50% on a route whose KMZ looks correct in Google Earth.
[VERIFIED: live measurement this session — Siriu mean 60.5% vs median 0.3%]

### Pitfall 2: Misreading the "LC 21–31, 9.6 m shape / 179 m anchor" Fixture Source
**What goes wrong:** Assume the canonical LC case is the **DWG-graph-walk** output. It is not — the
live DWG-graph-walk LC output is *globally scrambled* (mean GT error 114.9 m, max 403.9 m; individual
consecutive edges at 496–1050% shape error). The clean "6.1 m shape / 178.7 m anchor" signal is the
**PDF user-anchored path** result for the 21–31 sub-segment.
**Why it happens:** CONTEXT/ROADMAP describe the case in terms of the historical PDF-path rigid-offset
(documented in 260603-acc), not the DWG cascade. The DWG cascade for LC is a *different, worse* failure.
**How to avoid:** The D-06 must-fail fixture must capture **exactly which coordinate set** is the LC
21–31 rigid-offset. The cleanest, most faithful fixture is the **PDF-path coords for posts 21–31**
(shape locally consistent ~6 m, globally translated ~179 m) — this is the textbook "shape passes,
anchor fails" case. The DWG-graph-walk LC output ALSO fails the gate (it fails shape too), but for a
different reason. The planner must decide which is the canonical fixture; the PDF-path 21–31 segment is
recommended because it isolates the "shape-pass / anchor-fail" mechanism the gate exists to catch.
**Warning signs:** A "must-fail" fixture that fails on shape (not anchor) does not prove the anchor
sub-score works. [VERIFIED: live — see `## Runtime State Inventory` table for exact numbers]

### Pitfall 3: Anchor Gap Mis-Wired to the Wrong Coordinate Set
**What goes wrong:** Compute the anchor gap as "computed post-1 GPS vs user GPS" (always ~0) — the
exact D-03 trap. Or compute it against the ground-truth fixture (breaks truth-free, D-02).
**Why it happens:** "Absolute anchor residual" reads like "distance from the anchor."
**How to avoid:** The anchor gap is **DWG-paired coord vs PDF user-anchored coord, per post**
(`cascade.coords` vs `gpsByPostNumber`). Both are pinned at post 1, so the gap there is ~0 *by design*;
the signal is the *downstream* divergence. [VERIFIED: live — LC post 1 gap = 1 m, post 4+ gap ≈ 186 m]

### Pitfall 4: `parsed.distances` Mutated In-Place by the PDF Path
**What goes wrong:** `calculateCoordinates` mutates the caller's `distances` array (writes back
augmented `meters`). If the harness reuses the same array reference across PDF-only and DWG runs, the
second run sees augmented values.
**Why it happens:** Documented in `coordinate-calculator.js:1106` JSDoc ("mutated in place").
**How to avoid:** The gate reads `distances` only to look up printed meters; this is benign for the
gate itself. But if the harness runs both paths, be aware which `distances` snapshot feeds the gate.
Use the distances as they exist at cascade time (post-augmentation) for consistency with `cascade.coords`.
[VERIFIED: source JSDoc + grep of in-place writes at coordinate-calculator.js:1278-1284]

## Code Examples

### Reusing the existing haversine
```js
// Source: parser/geo/utm-calibrator.js:770 [VERIFIED via grep]
import { haversineMeters } from "../geo/utm-calibrator.js";
// haversineMeters(lat1, lon1, lat2, lon2) → metres (spherical R=6371000)
```

### Gate invocation in coordinate-calculator-dwg.js (additive, D-01)
```js
// Source: ARCHITECTURE.md Integration Point 1 + actual success path at coordinate-calculator-dwg.js:405
// AFTER the cascade success path builds dwgPosts and BEFORE `return successResult`:
import { computeResiduals, computeAnchorGap, applyResidualGate } from "./residual-gate.js";

const shape  = computeResiduals(cascade.coords, distances);
const anchor = computeAnchorGap(cascade.coords, gpsByPostNumber);
const gate   = applyResidualGate(shape, anchor);   // pure; thresholds = named constants
successResult.dwgConfidence = gate;                // ATTACH ONLY — no coord change (D-01)
// successResult.posts, .connections, .dwgStatus unchanged → output bytes identical
```
Note: `cascade.coords` is available as `cascade.coords` (the cascade returns `{ ok, coords, dwgPath }`),
and `gpsByPostNumber` is the Map already built at lines 314–319. Both are in scope at the success path.

### CI harness skeleton (mirror existing gates)
```js
// Source: mirror tools/run-route-dwg-accuracy-gate.mjs + route-dwg-accuracy-harness.mjs
import { runRouteDwgAccuracyHarness } from "./route-dwg-accuracy-harness.mjs";
// harness already returns result.posts with source:"dwg" coords + dwgStatus.
// New step: re-run computeResiduals/computeAnchorGap on those coords for the route decision,
// then assert: Siriu → trust (median shape < TRUST), LC fixture → fail.
// Pattern: load baseline JSON, compare, console.error + process.exit(1) on failure,
// support RESIDUAL_UPDATE_BASELINE=1 to refresh (cf. SIRIU_UPDATE_BASELINE).
```

## State of the Art

> **This section carries the load-bearing measurement that changes the plan.** All numbers captured
> live this session by running the actual pipeline on the four named routes.

| Old Approach (CONTEXT estimate) | Measured Reality | Impact |
|--------------------------------|------------------|--------|
| `mean` relative error, threshold 5% trust | Mean is 60.5% (Siriu), 0.5% (Valmor), 607% (João Born) over consecutive `meters>0` edges | Mean is unusable as the route score; **median** is the right aggregate |
| "5% trust / 15% fallback / >15% fail" on mean | **Median** rel error: Siriu 0.3%, Valmor 0.2%, João Born 4.4% (trim-80%: 6.4% / 0.2% / 21.7%) | Re-interpret thresholds as median; 5% trust is plausible on median, NOT on mean |
| LC "9.6 m shape / 179 m anchor" = DWG output | DWG-graph-walk LC = scrambled (mean GT 114.9 m); the 6.1 m/178.7 m signal is the **PDF-path 21–31** | Must-fail fixture source must be pinned (Pitfall 2) |

**Live calibration numbers (median relative shape error, DWG-graph-walk output, consecutive `meters>0` edges):**

| Route | dwgStatus | paired | mean relErr | **median relErr** | trim-80% | Interpretation |
|-------|-----------|--------|-------------|-------------------|----------|----------------|
| Siriu | dwg-graph-walk | 85 | 60.5% | **0.3%** | 6.4% | gold route — median is the true signal |
| Valmor | dwg-graph-walk | 11 | 0.5% | **0.2%** | 0.2% | clean small route, all methods agree |
| João Born | dwg-graph-walk | 34 | 607% | **4.4%** | 21.7% | median still <5%; mean catastrophic |
| LC (full route) | dwg-graph-walk | 31 | 201% | (scrambled) | — | fails shape too; not the clean fixture |
| LC 21–31 (PDF-path) | n/a | 11 | 18.4% rel / **6.1 m abs** | — | — | the canonical "shape OK / anchor 178.7 m" case |

**Anchor-gap live numbers (DWG-paired vs PDF user-anchored, per post):** LC mean gap **202 m**,
post 1 gap **1 m** (confirms D-03 is not trivially zero), posts 4–31 gaps 97–421 m. This is the
quantity the anchor sub-score measures.

**Deprecated/outdated:**
- The literal CONTEXT.md formula `mean(...)` as the route score — superseded by median (this session).
- Assumption that the LC must-fail fixture is the DWG cascade output — it is the PDF-path 21–31 segment.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Median is the best route-level aggregator (vs trimmed-mean or outlier-rejected mean) | State of the Art | LOW — median verified <5% on Siriu/Valmor/João Born; planner finalizes during D-05 calibration |
| A2 | The canonical LC must-fail fixture should be the **PDF-path 21–31** coords (not DWG cascade) | Pitfall 2 | MEDIUM — if planner picks the DWG cascade output instead, the fixture fails on shape not anchor, weakening the anchor-sub-score proof. Recommend PDF-path 21–31. Needs planner confirmation |
| A3 | `ANCHOR` fail threshold ~ tens of metres (LC gap 202 m must fail; Valmor/Siriu gaps must pass) | Anchor sub-score | MEDIUM — Valmor/Siriu/João Born anchor gaps NOT yet measured this session; planner must measure them during calibration before locking ANCHOR thresholds |
| A4 | Per-post `shapeScore = max(incident relErrors)` (worst edge) is the right per-post rule | Pattern 3 | LOW — fail-loud is consistent with project lock; planner may choose mean-of-incident if too noisy |
| A5 | The gate reads `distances` at cascade time (post-augmentation) consistently with `cascade.coords` | Pitfall 4 | LOW — both are the same snapshot inside `calculateCoordinatesWithDwg` |

## Open Questions

1. **Which coordinate set is the locked LC must-fail fixture (D-06)?**
   - What we know: PDF-path 21–31 = clean 6.1 m shape / 178.7 m anchor (the textbook case). DWG-cascade LC = scrambled, fails shape AND anchor.
   - What's unclear: CONTEXT/ROADMAP phrasing ("real captured LC output, the actual rigid-offset result") could mean either.
   - Recommendation: Capture BOTH into the fixture file, mark the **PDF-path 21–31** as the primary "shape-pass/anchor-fail" assertion. The DWG-cascade output is a secondary "fails for any reason" assertion. Confirm with user in discuss/plan.

2. **Anchor sub-score thresholds — Siriu/Valmor/João Born anchor gaps not yet measured.**
   - What we know: LC anchor gap = 202 m (must fail). Post 1 ~0 everywhere.
   - What's unclear: the gaps for the known-good routes (must pass). A threshold must sit above those and below 202 m.
   - Recommendation: First plan task measures `computeAnchorGap` on all four routes, then sets `ANCHOR_TRUST_M` from the known-good ceiling + slack (the existing `slackM` pattern). Lock as named constant.

3. **Trimmed-mean vs median for the route score.**
   - What we know: median cleanest; trim-80% also works on Siriu/Valmor but is 21.7% on João Born.
   - Recommendation: median for the decision; keep both in the gate output for diagnostics during calibration, then drop the unused one.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js (ESM) | Harness + gate | ✓ | v24.13.0 | — [VERIFIED: probe ran] |
| `fake-indexeddb` | Test harness region stub | ✓ | dev dep | — [VERIFIED: existing gates import it] |
| Four route PDFs (Siriu/LC/João Born/Valmor) | CI gate calibration | ✓ | — | — [VERIFIED: all four present in repo root] |
| `*-dwg-region.json` + `*-ground-truth.json` fixtures | Harness per route | ✓ | — | — [VERIFIED: ls fixtures — all four routes present] |
| `haversineMeters` export | Both sub-scores | ✓ | — | — [VERIFIED: utm-calibrator.js:770] |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None — all inputs verified present and the pipeline runs
end-to-end this session.

## Project Constraints (from CLAUDE.md)

No `./CLAUDE.md` and no `.claude/skills/` directory exist in this project (verified). The governing
constraints are the v1.1 locks carried in STATE/PROJECT/CONTEXT:
- **Strangler-fig:** wrap/extend/gate, never rewrite. `graph-walker.js`, `region-pairing.js`,
  `coordinate-calculator.js` are permanently untouched. The gate is additive. [CITED: CONTEXT.md, ARCHITECTURE.md]
- **Fail-loud, never silently-wrong:** UNRESOLVABLE posts are flagged, never dropped. [CITED: CONTEXT.md]
- **Truth-free live path:** no per-route truth fixtures in the gate's runtime path (D-02). [CITED: CONTEXT.md]
- **Tiers, never percentages:** output labels only (D-07). [CITED: CONTEXT.md]
- **ESM only:** `"type": "module"`; named exports, no CommonJS. [VERIFIED: package.json]

## Runtime State Inventory

> Phase 5 is greenfield-additive (one new pure module + one additive call site + new test harness).
> No rename/refactor/migration. The only "state" worth inventorying is the live calibration data the
> plan depends on — captured this session so the planner does not have to re-derive it.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — gate stores nothing; reads coords + distances in memory | None |
| Live service config | None — pure in-process function | None |
| OS-registered state | None | None |
| Secrets/env vars | New CI env var convention `RESIDUAL_UPDATE_BASELINE=1` (mirror `SIRIU_UPDATE_BASELINE`) | Planner: document in the new gate's header comment |
| Build artifacts | None new; `test:gate` script string gains one `node tools/run-residual-gate.mjs` | Planner: extend `package.json` `scripts.test:gate` |

**Live calibration data captured (so planning does not re-run the pipeline):**
- Siriu DWG median shape relErr = **0.3%** (mean 60.5% — do not use mean).
- Valmor DWG median = **0.2%**; João Born DWG median = **4.4%**.
- LC PDF-path 21–31: shape **6.1 m abs / 18.4% rel**, GT error **178.7 m** — the must-fail case.
- LC DWG-cascade full route: scrambled, mean GT 114.9 m / max 403.9 m (fails shape too).
- LC anchor gap (DWG vs PDF): mean **202 m**, post 1 = **1 m** (D-03 confirmed non-trivial).

## Security Domain

> Phase 5 is a pure, in-process math module operating on already-parsed numeric coordinate data.
> It performs no I/O, no network, no deserialization of untrusted input, no auth/session/access
> control, and no cryptography. The only inputs are floating-point coordinates and distances already
> produced by the existing trusted pipeline.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — (no auth surface) |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | minimal | Guard against `NaN`/`null`/`Infinity` lat/lon and `meters<=0`; division-by-zero on `relError = .../printed` (skip `printed<=0`). Pure-math robustness, not a security boundary |
| V6 Cryptography | no | — (never hand-roll, but none needed) |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Division by zero / NaN propagation from a 0-metre printed distance or null coord | (robustness, not adversarial) | Filter `meters > 0` and `lat != null` before computing relError; return `null` aggregates on empty sets |
| Silent post omission masking a failure | Information disclosure (false confidence) | Fail-loud: UNRESOLVABLE tier for any post without coord/edge — never drop (project lock) |

## Sources

### Primary (HIGH confidence)
- `parser/dwg/coordinate-calculator-dwg.js` — cascade structure, `gpsByPostNumber` build (lines 314–319), success path (405–420), result shape [VERIFIED: full read]
- `parser/coordinate-calculator.js` — PDF path, in-place `distances` mutation JSDoc (1106), augmentation writes (1278–1284) [VERIFIED: read]
- `parser/geo/utm-calibrator.js:770` — `haversineMeters` signature/implementation [VERIFIED: grep]
- `tools/route-dwg-accuracy-harness.mjs` / `tools/run-route-dwg-accuracy-gate.mjs` — reusable harness + gate pattern [VERIFIED: full read]
- `tools/run-siriu-regression-gate.mjs`, `tools/run-lc-post-position-gate.mjs` — gate skeleton, baseline/slack/UPDATE_BASELINE pattern [VERIFIED: read]
- **Live measurement this session** — Siriu/Valmor/João Born/LC residuals, anchor gaps, LC 21–31 shape/GT numbers [VERIFIED: probes run against real PDFs + fixtures]
- `.planning/research/ARCHITECTURE.md` §"P5: Residual Gate" — component design, integration points [CITED]
- `.planning/research/PITFALLS.md` Pitfalls 1, 7, 2 — confident-but-wrong, compensated gate, Siriu regression [CITED]
- `.planning/research/STACK.md` — do-NOT-add list, pure-`Math.*` residuals [CITED]
- `.planning/research/SUMMARY.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `05-CONTEXT.md` [CITED]

### Secondary (MEDIUM confidence)
- None — all claims either verified live or cited from in-repo research.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new deps; haversine reuse verified at source line.
- Architecture / integration point: HIGH — exact call site and in-scope variables read from source.
- D-03 anchor formulation: HIGH — resolved AND measured live (LC 202 m / post-1 1 m).
- Threshold calibration: HIGH for shape (live numbers for 4 routes); MEDIUM for anchor (only LC gap
  measured — known-good route anchor gaps must be measured in plan task 1 before locking).
- Must-fail fixture source: MEDIUM — recommended (PDF-path 21–31) but needs planner/user confirmation.
- Pitfalls: HIGH — each grounded in a live measurement or a named source line.

**Research date:** 2026-06-05
**Valid until:** 2026-07-05 (stable — internal codebase, no external fast-moving deps)
