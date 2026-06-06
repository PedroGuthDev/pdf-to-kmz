# Phase 06: DXF Ingestion & Region Lookup - Pattern Map

**Mapped:** 2026-06-06
**Files analyzed:** 7 (5 modified, 2 new)
**Analogs found:** 7 / 7 (all in-repo; this is additive hardening, not greenfield)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `parser/dwg/region-library.js` (MODIFY) | service / store | CRUD + transform | itself (extend `addRegion`/`lookupByGps`/`listRegions` in place) | self / exact |
| `parser/dwg/dxf-parse.worker.js` (NEW) | worker | transform (request-response) | `parser/ocr-extractor.js::createOcrWorker` (isNodeRuntime branch) | role-match |
| `parser/dwg/dxf-loader.js` (REUSE in worker) | utility | transform | itself (imported unchanged by worker) | self / exact |
| `parser/dwg/region-pairing.js` (REUSE in worker) | utility | transform | itself (`buildPostIndex`/`restorePostIndexFromDump` unchanged) | self / exact |
| `parser/geo/utm-calibrator.js` (REUSE) | utility | transform | itself (`utmToLatLon`, `haversineMeters` consumed, no edit) | self / exact |
| `tools/run-dxf-ingest-timing-gate.mjs` (NEW) | test / gate | batch (file-I/O) | `tools/run-siriu-regression-gate.mjs` | exact |
| `parser/__tests__/dxf-ingestion.test.mjs` (NEW) | test | batch | `parser/__tests__/region-pairing.test.mjs` | exact |

**Integration-point file (caller, MODIFY):** `parser/dwg/region-library-hybrid.js::lookupByGps` — see Shared Pattern "NO_REGION synthesis location" (the load-bearing decision per RESEARCH Pitfall 5 / A5).

---

## Pattern Assignments

### `parser/dwg/region-library.js` — `addRegion()` (service, CRUD + transform) — MODIFY IN PLACE

**Analog:** itself. D-03 mandates additive extension, not a new module. Insert validation between the parse and the `db.put`.

**Imports pattern** (lines 1-5) — add `haversineMeters` to the existing utm-calibrator import:
```js
import { openDB } from "idb";
import { parseDxfText } from "./dxf-loader.js";
import { buildAdjacencyGraph, buildPostIndex, restorePostIndexFromDump } from "./region-pairing.js";
import { utmToLatLon } from "../geo/utm-calibrator.js";
// ADD: haversineMeters lives in utm-calibrator.js (NOT coordinate-calculator.js — RESEARCH Open Q1)
//   → import { utmToLatLon, haversineMeters } from "../geo/utm-calibrator.js";
```

**Existing `addRegion` body to extend** (lines 50-89) — the current flow that the new guards wrap. The parse+index step (lines 56-68) is what moves behind the worker call; validation slots in before `record` is assembled (line 70) and `db.put` (line 86):
```js
const dxfText = await dxfBlob.text();
const { posts, cableEdges, primaryCableEdges, extmin, extmax } = parseDxfText(dxfText);
// ^ becomes: const {...} = await runParse(dxfText);  // worker round-trip (D-04, Pattern 2)

const crs = { ...DEFAULT_CRS };
const bboxUtm = { minE: extmin.x, maxE: extmax.x, minN: extmin.y, maxN: extmax.y };
const ll0 = utmToLatLon(extmin.x, extmin.y, crs.zone);   // returns {lat, lon}
const ll1 = utmToLatLon(extmax.x, extmax.y, crs.zone);
const bboxLatLon = normalizeBboxLatLon(ll0, ll1);
const postIndex = buildPostIndex(posts);                 // ^ moves to worker; restore from rbushDump
const rbushDump = postIndex.toJSON();
// INSERT D-01/D-02 envelope+retry and D-09 Brazil-bbox BEFORE the record below.
// crs gains `confidence` (D-08).
const record = { id: name, name, uploadedAt: Date.now(), crs, bboxUtm, bboxLatLon, posts, ... };
const db = await openRegionsDb(idbFactory);
await db.put("regions", record);
```

**Fail-loud pattern to apply** (envelope + retry, D-01/D-02 — from RESEARCH Code Examples, derived from verified Siriu/Palhoça extents):
```js
const ZONE_22S = { minE: 600000, maxE: 800000, minN: 6700000, maxN: 7100000 };
const inZone22S = (e, n) =>
  e >= ZONE_22S.minE && e <= ZONE_22S.maxE && n >= ZONE_22S.minN && n <= ZONE_22S.maxN;
let scale = 1, confidence = "high";
if (!inZone22S(extmax.x, extmax.y)) {
  if (inZone22S(extmax.x / 1000, extmax.y / 1000)) { scale = 1 / 1000; confidence = "low"; }
  else throw new Error("DXF unit mismatch suspected"); // D-02 exact message — never store
}
```

**Brazil-bbox corner validation** (D-09 — only the two corners, never 60k posts):
```js
const BRAZIL = { minLat: -33.8, maxLat: 5.3, minLon: -73.0, maxLon: -34.8 };
const inBrazil = (p) => p.lat >= BRAZIL.minLat && p.lat <= BRAZIL.maxLat
                     && p.lon >= BRAZIL.minLon && p.lon <= BRAZIL.maxLon;
// utmToLatLon returns {lat, lon} — see region-library.js lines 63-65 normalizeBboxLatLon usage
if (!inBrazil(ll0) || !inBrazil(ll1)) throw new Error("DXF coordinates outside Brazil ...");
```

> NOTE: `utmToLatLon(e, n, zone)` returns `{lat, lon}` (consumed as `a.lat`/`a.lon` in `normalizeBboxLatLon`, lines 39-46). The Brazil-bbox `inBrazil(p)` predicate reads `p.lat`/`p.lon` — same shape, no adapter needed.

### `parser/dwg/region-library.js` — `lookupByGps()` (request-response) — MODIFY NULL PATH

**Analog:** itself, lines 104-118. Current null-path is `if (!hits.length) return null;` (line 115).

**CRITICAL (Pitfall 5 / A5):** Do NOT make the leaf `lookupByGps` return a truthy `{code:'NO_REGION'}` — the hybrid wrapper's `if (local) return local;` (region-library-hybrid.js line 114) would short-circuit the cloud fallback. Keep leaf returning `null`; synthesize the structured error at the cascade level. See Shared Patterns.

**Existing bbox-filter pattern to preserve** (lines 109-117):
```js
const hits = (all ?? []).filter((r) => {
  const b = r?.bboxLatLon; if (!b) return false;
  return lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon;
});
if (!hits.length) return null;   // ← KEEP null at the leaf
hits.sort((r1, r2) => bboxArea(r1.bboxLatLon) - bboxArea(r2.bboxLatLon));
return hits[0];
```

### `parser/dwg/region-library.js` — `listRegions()` (CRUD read) — VERIFY (likely no change)

**Analog:** itself, lines 91-102. Already returns `bboxLatLon` + `crs` per item (lines 95-101) → SC-5/DXF-07 already satisfied at the data layer. `crs.confidence` rides along automatically once stored (it is part of the spread `crs`). Only a UI surface change (browser/main.js dropdown) may be needed per SC-5 — planner's discretion.

---

### `parser/dwg/dxf-parse.worker.js` (worker, transform) — NEW

**Analog (worker shape):** RESEARCH Pattern 1. **Analog (Node fallback):** `parser/ocr-extractor.js` `isNodeRuntime()` branch.

**Worker entry pattern** (RESEARCH Pattern 1 — keep `new URL(...)` literal inline for esbuild detection, Pitfall 4):
```js
// dxf-parse.worker.js
import { parseDxfText } from "./dxf-loader.js";
import { buildPostIndex } from "./region-pairing.js";
self.onmessage = (e) => {
  if (e.data?.type !== "PARSE_DXF") return;
  try {
    const { posts, cableEdges, primaryCableEdges, extmin, extmax } = parseDxfText(e.data.dxfText);
    const rbushDump = buildPostIndex(posts).toJSON();
    self.postMessage({ ok: true, posts, cableEdges, primaryCableEdges, rbushDump, extmin, extmax });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err?.message ?? err) }); // never swallow (Pitfall 7)
  }
};
```

**Node-fallback pattern — copy from `parser/ocr-extractor.js::createOcrWorker`** (lines 271-288). The codebase's established runtime-branch idiom is `isNodeRuntime()` from `node-canvas-setup.js`; for the worker spawn the equivalent guard is `typeof Worker === "undefined"`:
```js
// ocr-extractor.js lines 273-281 — the established "Node vs browser" branch to mirror:
export async function createOcrWorker() {
  let createWorker;
  if (isNodeRuntime()) {
    try { ({ createWorker } = await import("tesseract.js")); }
    catch { ({ createWorker } = (await import(TESSERACT_CDN)).default); }
  } else {
    ({ createWorker } = (await import(TESSERACT_CDN)).default);
  }
  ...
}
```
Apply the same branch shape in `region-library.js` as `runParse(dxfText)` (RESEARCH Pattern 2): Node → inline `parseDxfText` + `buildPostIndex`; browser → `postMessage` round-trip to the worker. This makes the Node timing gate measure real parse+index cost without a browser runner (D-05/SC-4).

**Worker reuses these UNCHANGED** — extract nothing new, just import:
- `parser/dwg/dxf-loader.js` `parseDxfText(dxfText)` → `{posts, cableEdges, primaryCableEdges, extmin, extmax}` (lines 14-87). Preserves the "DO NOT scale $INSUNITS" invariant (lines 8-12) which D-01 depends on.
- `parser/dwg/region-pairing.js` `buildPostIndex(posts)` (lines 20-24) → `PostIndex extends RBush` (lines 8-18); `restorePostIndexFromDump(dump)` (lines 26-30) uses `fromJSON`. The `toJSON()` dump is structured-clone-safe (RESEARCH Pitfall 3 — leaf nodes reference the same post objects).

---

### `tools/run-dxf-ingest-timing-gate.mjs` (test / gate, batch) — NEW

**Analog:** `tools/run-siriu-regression-gate.mjs` (exact structural match).

**Gate harness skeleton to copy** (from run-siriu-regression-gate.mjs lines 1-15, 129-162) — shebang, node:fs/url imports, `main()` + `.catch(process.exit(1))`, and the `process.exit(1)` on budget breach:
```js
#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// ... resolve repo-root path to Palhoca.dxf via fileURLToPath(import.meta.url)
async function main() {
  console.log("DXF ingest timing gate…");
  // ... run ingest, measure
  if (ms > BUDGET_MS) { console.error(`FAILED: ${ms}ms > ${BUDGET_MS}ms`); process.exit(1); }
  console.log(`PASS — ...`);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

**Timing body** (RESEARCH Code Examples — uses `fake-indexeddb` IDBFactory, already a devDep; `performance.now()`):
```js
import { createRegionLibrary } from "../parser/dwg/region-library.js";
import { IDBFactory } from "fake-indexeddb";
const BUDGET_MS = 5000;
const dxfText = readFileSync(new URL("../Palhoca.dxf", import.meta.url), "utf8");
const lib = createRegionLibrary(new IDBFactory());
const blob = { text: async () => dxfText };   // mimic Blob.text()
const t0 = performance.now();
await lib.addRegion("Palhoca-timing", blob);
const ms = performance.now() - t0;
```
In Node, `Worker` is undefined → `runParse` inline fallback measures real parse+index CPU cost. Wire into `package.json` `test:gate` (append `&& node tools/run-dxf-ingest-timing-gate.mjs`).

---

### `parser/__tests__/dxf-ingestion.test.mjs` (test, batch) — NEW

**Analog:** `parser/__tests__/region-pairing.test.mjs` (lines 1-26) — the established `node --test` + fixture-load idiom.

**Test header pattern to copy** (region-pairing.test.mjs lines 1-25) — note `import "fake-indexeddb/auto";` FIRST (required because `addRegion` touches IndexedDB), then `node:test`/`assert/strict`, then fixture reads via `new URL(..., import.meta.url)`:
```js
import "fake-indexeddb/auto";              // MUST be first — addRegion uses IndexedDB
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
const subset = JSON.parse(readFileSync(new URL("./fixtures/siriu-subset.json", import.meta.url), "utf8"));
import { createRegionLibrary } from "../dwg/region-library.js";
```
Cover: SC-1 (Siriu re-ingest → golden `bboxLatLon` + `confidence:'high'`), SC-2 (synthetic mm DXF → `throws(/DXF unit mismatch suspected/)`), SC-3 (NO_REGION structured error), DXF-07 (`listRegions` shape includes `bboxLatLon`). Capture the golden Siriu `bboxLatLon` from a pre-change ingest BEFORE editing `addRegion` (RESEARCH Wave 0 Gaps).

---

## Shared Patterns

### Fail-loud / never-store-silently-wrong
**Source:** project principle (CONTEXT D-02, RESEARCH Pitfall 2/7), mirrors `dxf-loader.js` "DO NOT scale $INSUNITS" invariant (lines 8-12).
**Apply to:** `addRegion` envelope-retry path and Brazil-bbox path, and the worker `catch` (post `{ok:false,error}`, never a partial result).
```js
throw new Error("DXF unit mismatch suspected"); // exact string; no confidence:'low' store on failed retry
```

### NO_REGION synthesis location (LOAD-BEARING — RESEARCH A5 / Pitfall 5)
**Source:** `parser/dwg/region-library-hybrid.js::lookupByGps` (lines 112-126) + RESEARCH Code Examples.
**Apply to:** the cascade caller (`coordinate-calculator-dwg.js`), AFTER local AND cloud both miss — NOT inside leaf `lookupByGps` (which must keep returning `null` so the hybrid `if (local) return local` at line 114 still falls through to cloud).
```js
function noRegionError(lat, lon, allRegions) {
  let best = null;
  for (const r of allRegions) {
    const b = r.bboxLatLon; if (!b) continue;
    const km = haversineMeters(lat, lon, (b.minLat+b.maxLat)/2, (b.minLon+b.maxLon)/2) / 1000;
    if (!best || km < best.distanceKm) best = { name: r.name, distanceKm: km };
  }
  return { code: "NO_REGION", nearest: best };
}
```

### In-house geo math (no new deps)
**Source:** `parser/geo/utm-calibrator.js` — `utmToLatLon(e,n,zone)` (line 62, returns `{lat,lon}`), `haversineMeters(lat1,lon1,lat2,lon2)` (line 770, returns meters).
**Apply to:** Brazil-bbox corner check (utmToLatLon) and nearest-region hint (haversineMeters ÷ 1000 for km). Do NOT add turf/geolib.

### IndexedDB via `openRegionsDb`
**Source:** `parser/dwg/region-library.js` lines 13-30 — wraps `idb.openDB`, injects `idbFactory` for Node/fake-indexeddb.
**Apply to:** unchanged. `crs.confidence` is an additive optional field; NO DB_VERSION bump (still 1). Tolerate `crs.confidence === undefined` on read of pre-existing records.

### esbuild worker bundling (build config)
**Source:** `scripts/build.mjs` lines 29-39 (single entryPoint `browser/main.js`, `format:"esm"`, `platform:"browser"`).
**Apply to:** worker auto-detected via inline `new Worker(new URL("./dxf-parse.worker.js", import.meta.url), {type:"module"})`. RESEARCH A3/Pitfall 4: VERIFY `dist/` emits the worker chunk after `npm run build`; if absent, add the worker to `entryPoints` explicitly.

---

## No Analog Found

None. Every file has an in-repo analog (this phase is additive hardening of a working pipeline). The two "new" files (`dxf-parse.worker.js`, `run-dxf-ingest-timing-gate.mjs`) both have strong structural analogs (`ocr-extractor.js` worker branch and `run-siriu-regression-gate.mjs` gate harness respectively).

## Metadata

**Analog search scope:** `parser/dwg/`, `parser/geo/`, `parser/`, `tools/`, `parser/__tests__/`, `scripts/`, `package.json`
**Files scanned:** region-library.js, dxf-loader.js, region-pairing.js, utm-calibrator.js, region-library-hybrid.js, ocr-extractor.js, run-siriu-regression-gate.mjs, build.mjs, region-pairing.test.mjs (full or targeted reads)
**Pattern extraction date:** 2026-06-06
