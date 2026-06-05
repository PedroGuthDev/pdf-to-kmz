# Phase 5: Truth-Free Residual Gate - Pattern Map

**Mapped:** 2026-06-05
**Files analyzed:** 5 (2 new, 2 modified, 1 new fixture)
**Analogs found:** 5 / 5 (all have strong in-repo analogs)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `parser/dwg/residual-gate.js` (NEW) | utility (pure-math judge) | transform (coords+distances → scores/tiers) | `parser/dwg/cable-topology.js` | role-match (pure-math dwg module, named ESM exports) |
| `parser/dwg/coordinate-calculator-dwg.js` (MODIFIED) | service (cascade integration) | request-response (additive attach to result) | self (`calculateCoordinatesWithDwg` success path, lines 314–420) | exact (same file) |
| `tools/run-residual-gate.mjs` (NEW) | test (CI gate) | batch (load → run → assert → exit 1) | `tools/run-route-dwg-accuracy-gate.mjs` | exact (same gate shape) |
| `tools/residual-gate-harness.mjs` (NEW, optional) | test (per-route runner) | batch (PDF→DWG pipeline per route) | `tools/route-dwg-accuracy-harness.mjs` | exact (reuse, not rewrite) |
| `package.json` `scripts.test:gate` (MODIFIED) | config | — | self (existing `test:gate` chain) | exact (same file) |
| `parser/__tests__/fixtures/luizcarolino-residual-mustfail.json` (NEW) | test fixture | file-I/O (JSON read) | `parser/__tests__/fixtures/luizcarolino-ground-truth.json` | role-match (route coord fixture) |

## Pattern Assignments

### `parser/dwg/residual-gate.js` (utility, transform)

**Analog:** `parser/dwg/cable-topology.js` (pure-math `parser/dwg` module: named exports, geo import, JSDoc, returns plain object).

**Imports pattern** — reuse in-house haversine, no new deps (STACK.md do-NOT-add lock):
```js
// Source: parser/geo/utm-calibrator.js:770 (haversineMeters), mirrors cable-topology.js:1 import style
import { haversineMeters } from "../geo/utm-calibrator.js";
// haversineMeters(lat1, lon1, lat2, lon2) → metres (spherical R=6371000), verified at source
```

**Module/JSDoc convention** (copy from `cable-topology.js` lines 3–28):
- File-level block comment explaining "why" + algorithm before each exported function.
- `@param`/`@returns` typed JSDoc on every export.
- Named `export function`, ESM only (`"type": "module"` confirmed). No CommonJS, no default export.

**Core pattern — `computeResiduals(coords, distances)`** (RESEARCH.md Pattern 1; median NOT mean):
```js
export function computeResiduals(coords, distances) {
  // coords: [{ postNumber, lat, lon }] ; distances: [{ from, to, meters, source }]
  const byNum = new Map(coords.filter(c => c.lat != null).map(c => [c.postNumber, c]));
  const perEdge = [];
  for (const d of distances) {
    if (!(d.meters > 0)) continue;           // skip cleared/blocked edges (meters null) — V5 input-validation
    const A = byNum.get(d.from), B = byNum.get(d.to);
    if (!A || !B) continue;                   // endpoint unpaired → not a shape edge
    const hav = haversineMeters(A.lat, A.lon, B.lat, B.lon);
    const relError = Math.abs(hav - d.meters) / d.meters;
    perEdge.push({ from: d.from, to: d.to, printed: d.meters, hav, relError,
                   residualM: Math.abs(hav - d.meters), source: d.source });
  }
  const rels = perEdge.map(e => e.relError).sort((a, b) => a - b);
  const median = rels.length ? rels[Math.floor(rels.length / 2)] : null;
  const p95 = rels.length ? rels[Math.floor(rels.length * 0.95)] : null;
  return { medianRelError: median, p95RelError: p95, edgeCount: perEdge.length, perEdge };
}
```
> CRITICAL (RESEARCH.md State of the Art, Pitfall 1): route-level aggregate MUST be **median**, not mean — Siriu mean is 60.5% vs median 0.3%. Keep `perEdge` for outlier-based per-post tiering.

**`computeAnchorGap(coords, gpsByPostNumber)`** (RESEARCH.md Pattern 2 — the D-03 resolution):
```js
export function computeAnchorGap(coords, gpsByPostNumber) {
  // coords: DWG-paired [{ postNumber, lat, lon }]; gpsByPostNumber: Map<postNumber,{lat,lon}> (user-anchored PDF)
  const perPost = [];
  for (const c of coords) {
    if (c.lat == null) continue;
    const pdf = gpsByPostNumber.get(c.postNumber);
    if (!pdf) continue;                       // unpaired in PDF path → skip (post-1 pinned ⇒ ~0 by design)
    perPost.push({ postNumber: c.postNumber, gapM: haversineMeters(c.lat, c.lon, pdf.lat, pdf.lon) });
  }
  const gaps = perPost.map(p => p.gapM).sort((a, b) => a - b);
  const mean = gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : null;
  const p95 = gaps.length ? gaps[Math.floor(gaps.length * 0.95)] : null;
  return { meanGapM: mean, p95GapM: p95, perPost };
}
```

**`applyResidualGate(shape, anchor, thresholds)`** — two-gate decision + per-post tiers (RESEARCH.md Pattern 3):
- HIGH only when **both** sub-scores pass (PITFALLS Pitfall 1 — single shape-only gate passes the LC rigid offset).
- Per-post: `shapeScore = max(relError over incident edges)` (fail-loud), `anchorScore = perPost gapM`.
- No paired coord OR no labelled incident edge → `UNRESOLVABLE` (flag, never drop — project lock).
- Thresholds are **named constants in this file** (D-05): seeds 5% trust / 15% fallback / >15% fail for shape; ANCHOR_* derived from known-good ceiling during calibration. Output is TIER labels only, never percentages (D-07).

**Input-validation guards** (RESEARCH.md Security Domain V5): filter `meters > 0`, `lat != null`; return `null` aggregates on empty sets; avoid divide-by-zero on `relError`.

---

### `parser/dwg/coordinate-calculator-dwg.js` (service, additive integration)

**Analog:** self — the `calculateCoordinatesWithDwg` success path. Integration is **additive only** (strangler-fig, D-01: no coord/byte change).

**In-scope variables at the call site** (verified by read):
- `gpsByPostNumber` Map built at **lines 314–319** (user-anchored PDF coords).
- `cascade` returned from `runDwgPairingCascade(...)` at **lines 352–365**; shape is `{ ok, coords, dwgPath }` (cascade returns confirmed at lines 144/165/169). `cascade.coords` entries are `{ postNumber, lat, lon, dwg_block }` (consumed at line 378).
- `distances` is the post-augmentation snapshot in scope (Pitfall 4 — consistent with `cascade.coords`).
- `successResult` object built at **lines 405–419**, returned at **421**.

**Insertion point** — after `successResult` is built (line 405–412) and BEFORE `successResult.userWarnings = ...` / `return` (lines 419–420):
```js
// Add import at top with the other ./ dwg imports (lines 6–13):
import { computeResiduals, computeAnchorGap, applyResidualGate } from "./residual-gate.js";

// ... inside calculateCoordinatesWithDwg, after successResult is assembled (line ~418):
const shape  = computeResiduals(cascade.coords, distances);
const anchor = computeAnchorGap(cascade.coords, gpsByPostNumber);
successResult.dwgConfidence = applyResidualGate(shape, anchor);   // ATTACH ONLY — no coord change (D-01)
// successResult.posts/.connections/.dwgStatus unchanged ⇒ output bytes identical
```
> Field name `dwgConfidence` is Claude's-Discretion (D-01); keep consistent with existing `dwgStatus`/`dwgRegionId` sibling fields on `successResult`.

**Error-handling pattern to mirror** (lines 367–376): the cascade-fail branch returns a `{ ...pdfResult, dwgStatus: "pdf-fallback" }` early. The gate sits on the **success** path only — when `!cascade.ok` the function already returned, so no gate call is needed there.

---

### `tools/run-residual-gate.mjs` (test, CI gate)

**Analog:** `tools/run-route-dwg-accuracy-gate.mjs` (exact shape) + `tools/run-siriu-regression-gate.mjs` (the one already wired into `test:gate`).

**Header + imports pattern** (copy from `run-route-dwg-accuracy-gate.mjs` lines 1–17):
```js
#!/usr/bin/env node
/**
 * Truth-free residual gate — Siriu must trust, LC 21–31 must fail.
 * Run:  node tools/run-residual-gate.mjs
 * Refresh baseline: RESIDUAL_UPDATE_BASELINE=1 node tools/run-residual-gate.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "parser", "__tests__", "fixtures");
```

**slack helper** (copy verbatim, `run-route-dwg-accuracy-gate.mjs` lines 27–29 / `run-siriu-regression-gate.mjs` 29–31):
```js
function slackM(observed) { return Math.ceil((observed + 0.5) * 10) / 10; }
```

**Existence-check + run pattern** (lines 34–52): `existsSync` guard each input path → `console.error` + `process.exit(1)` on missing; then `await runRouteDwgAccuracyHarness({ pdfPath, dwgRegionPath, groundTruthPath, regionId })`.

**Baseline / UPDATE_BASELINE pattern** (lines 73–93): `const updateBaseline = process.env.RESIDUAL_UPDATE_BASELINE === "1" || !existsSync(BASELINE_PATH);` → if set, `writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n", "utf8")` and return; else load + compare.

**Compare / fail pattern** (lines 95–122): accumulate `failures[]`; on non-empty → `console.error` each with `  x ` prefix, print count, print the refresh hint, `process.exit(1)`; else `console.log("PASS — …")`. Gate-specific assertions for this phase: Siriu route → decision `trust` (median shape < TRUST const); LC must-fail fixture → decision `fail` on the **anchor** sub-score (Pitfall 2: prove anchor, not just shape).

**Catch-all tail** (copy verbatim, lines 129–132): `main().catch((e) => { console.error(e); process.exit(1); });`

---

### `tools/residual-gate-harness.mjs` (test, per-route runner) — REUSE, do not rewrite

**Analog:** `tools/route-dwg-accuracy-harness.mjs`. RESEARCH "Don't Hand-Roll" + Key insight: the harness **already** runs the full DWG pipeline per route AND rebuilds `gpsByPostNumber` (lines 144–149) and returns `result.posts` with `source:"dwg"` coords. Prefer importing `runRouteDwgAccuracyHarness` directly and calling the new `residual-gate.js` functions on its output; only add a thin wrapper if a different return shape is needed.

**Reusable scaffolding to call, not reimplement** (route-dwg-accuracy-harness.mjs):
- `buildRegionBundle(id, posts, cableEdges)` (lines 37–45)
- `createFixtureLibrary(bundle)` + `import "fake-indexeddb/auto"` (lines 11, 52–62)
- `runRouteDwgAccuracyHarness({ pdfPath, dwgRegionPath, groundTruthPath, regionId })` (lines 82–198) — already calls `calculateCoordinatesWithDwg` and returns `posts`, `dwgStatus`, `errorsByPost`.

---

### `parser/__tests__/fixtures/luizcarolino-residual-mustfail.json` (test fixture)

**Analog:** `parser/__tests__/fixtures/luizcarolino-ground-truth.json` (array of `{ number, lat, lon }`).

**Content (D-06 — real captured output, not synthetic):** store the **PDF-path coords for LC posts 21–31** as the primary "shape-pass / anchor-fail" assertion (shape ~6.1 m abs / 18.4% rel, GT/anchor 178.7 m). Per RESEARCH Pitfall 2 + Open Question 1: this isolates the anchor sub-score mechanism; the DWG-cascade scrambled output is at most a secondary "fails for any reason" assertion. Confirm canonical source with planner/user. Suggested shape: `{ "lc-21-31-pdfpath": [ {postNumber, lat, lon}, … ], "expectedDecision": "fail", "expectedFailSubScore": "anchor" }`.

---

## Shared Patterns

### Haversine (inter-post GPS distance)
**Source:** `parser/geo/utm-calibrator.js:770` — `haversineMeters(lat1, lon1, lat2, lon2)`
**Apply to:** both sub-scores in `residual-gate.js` and the harness.
```js
import { haversineMeters } from "../geo/utm-calibrator.js";  // from parser/dwg/*
import { haversineMeters } from "../parser/geo/utm-calibrator.js";  // from tools/*
```
Do NOT add turf.js or any geo/stats lib (STACK.md "Do NOT Add", RESEARCH Package Audit: zero new deps this phase).

### CI gate skeleton (baseline / slack / UPDATE_BASELINE / exit 1)
**Source:** `tools/run-siriu-regression-gate.mjs` (the one in `test:gate`) + `tools/run-route-dwg-accuracy-gate.mjs`
**Apply to:** `tools/run-residual-gate.mjs`
- `slackM(observed) = Math.ceil((observed + 0.5) * 10) / 10` (both gates, verbatim)
- `process.env.<ROUTE>_UPDATE_BASELINE === "1"` → `writeFileSync(..., JSON.stringify(x, null, 2) + "\n")`
- failure list → `console.error` + `process.exit(1)`; success → `console.log("PASS — …")`
- `main().catch(e => { console.error(e); process.exit(1); })`

### Region-library stub for tests
**Source:** `tools/route-dwg-accuracy-harness.mjs` lines 11, 52–62 — `import "fake-indexeddb/auto"` + `createFixtureLibrary(bundle)`
**Apply to:** any new harness code (the existing `runRouteDwgAccuracyHarness` already wires this; reuse it).

### ESM named-export module convention
**Source:** `parser/dwg/cable-topology.js` lines 1–29
**Apply to:** `parser/dwg/residual-gate.js` — leading geo import, file/function JSDoc with typed `@param`/`@returns`, named `export function`, plain-object returns, `"type": "module"` (no CommonJS, no default export).

### `package.json` `test:gate` extension
**Source:** self — current value:
`node --test parser/__tests__/graph-walker.test.mjs parser/__tests__/distance-associator.test.mjs parser/__tests__/coordinate-calculator.test.mjs && node tools/run-siriu-regression-gate.mjs`
**Apply:** append ` && node tools/run-residual-gate.mjs` to the chain (RESEARCH Runtime State Inventory — Build artifacts row). No other script changes; no dependency additions.

## No Analog Found

None. Every file has a strong in-repo analog. (`residual-gate.js`'s two-gate decision + tier-derivation **logic** is novel, but its module shape, imports, and helper patterns all map to existing `parser/dwg` modules and gate harnesses.)

## Metadata

**Analog search scope:** `parser/dwg/`, `parser/geo/`, `tools/`, `parser/__tests__/fixtures/`, `package.json`
**Files scanned (read):** `tools/run-route-dwg-accuracy-gate.mjs`, `tools/route-dwg-accuracy-harness.mjs`, `tools/run-siriu-regression-gate.mjs`, `parser/dwg/coordinate-calculator-dwg.js` (lines 1–60, 108–169, 295–421), `parser/geo/utm-calibrator.js` (760–779), `parser/dwg/cable-topology.js` (1–40), `parser/__tests__/fixtures/luizcarolino-ground-truth.json`, `package.json` scripts.
**Pattern extraction date:** 2026-06-05
