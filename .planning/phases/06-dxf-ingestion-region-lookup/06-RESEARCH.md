# Phase 06: DXF Ingestion & Region Lookup - Research

**Researched:** 2026-06-06
**Domain:** Browser DXF ingestion hardening — UTM envelope validation, fail-loud boundaries, Web Worker off-thread parsing, rbush index transfer, structured no-region errors
**Confidence:** HIGH (all claims grounded in this codebase, verified file reads, and the project's own converged v1.1 research)

## Summary

Phase 6 is an **additive hardening** of an already-working ingestion pipeline, not a greenfield build. `region-library.js::addRegion()` already parses DXF, converts UTM→LatLon via the in-house Snyder TM inverse, builds an rbush post-index, and stores to IndexedDB. The phase adds five guards on top of that flow: (1) coordinate-range unit-mismatch detection with a mm→m ÷1000 retry, (2) Brazil-bbox validation on the two extmin/extmax corners, (3) a `crs.confidence` field, (4) a structured `NO_REGION` error from `lookupByGps()`, and (5) a Web Worker that moves the two expensive operations (`parseDxfText` + `buildPostIndex`) off the main thread so the 134 MB / 60k-INSERT Palhoça file ingests in ≤ 5 s.

The single most important factual correction this research surfaces: **the real Siriu extents are E 642260–742091, N 6812580–6930560** (verified by reading `siriu.dxf` `$EXTMIN`/`$EXTMAX`), not the "≈730000" rough figure in CONTEXT.md §specifics. Palhoça shares the identical SW corner (E 642260, N 6812580) and extends to E 761089 / N 6996762. The zone-22S envelope constants MUST be derived from these real values with margin, or Siriu's own re-ingest (SC-1) will false-positive as a unit mismatch. The recommended envelope (E 600000–800000, N 6700000–7100000) comfortably contains both files while still rejecting mm-scale coordinates (which land at 10^8–10^9).

**Primary recommendation:** Extend `addRegion()` in place (D-03), add a single `dxf-parse.worker.js` entry to the esbuild build, transfer `{ posts, cableEdges, primaryCableEdges, rbushDump, extmin, extmax }` back via structured clone (no `Transferable` needed — see Pitfall 3), validate the two bbox corners only (D-09), and verify the 5 s budget with a Node.js timing harness mirroring `tools/run-siriu-regression-gate.mjs`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| DXF text parse (`parseDxfText`) | Web Worker | — | CPU-bound on 134 MB string; blocks main thread if inline (D-04, Pitfall 8) |
| rbush post-index build (`buildPostIndex`) | Web Worker | — | O(n) bulk-load of 60k posts; expensive, runs alongside parse (D-04) |
| Unit-mismatch detection + ÷1000 retry | Main thread (`addRegion`) | — | Cheap arithmetic on extmin/extmax; must own fail-loud decision (D-01/D-02) |
| Brazil-bbox corner validation | Main thread (`addRegion`) | — | 2 `utmToLatLon` calls; trivial cost (D-09) |
| CRS confidence assignment | Main thread (`addRegion`) | — | Derived from validation outcome (D-08) |
| IndexedDB write | Main thread (`addRegion`) | — | `idb` is main-thread-bound in this codebase; cheap (synchronous-ish put) |
| GPS region lookup + nearest hint | Main thread (`lookupByGps`) | — | Reads from IndexedDB; haversine over region centroids is O(regions), tiny (D-06/D-07) |
| Region listing UI | Main thread (browser/main.js) | — | Already satisfies DXF-07; surface bboxLatLon per SC-5 |

**Key tier insight:** Only the two genuinely expensive operations cross into the Worker. All validation, fail-loud decisions, and storage stay on the main thread because they are cheap and because `idb` / IndexedDB access in this codebase is main-thread-scoped. This keeps `addRegion()` as the single owner of the fail-loud contract (Pitfall 7 — never let the Worker silently swallow a unit mismatch).

## Standard Stack

No new dependencies. Every capability is satisfied by an existing dependency or a browser built-in.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `dxf-parser` | 1.1.2 (installed) | Parse DXF text to entities + `$EXTMIN`/`$EXTMAX` header | Already the ingestion parser; `parseSync` runs inside the Worker [VERIFIED: package.json] |
| `rbush` | 4.0.1 (installed) | Spatial post-index; `toJSON()`/`fromJSON()` serialize the tree | Already used by `region-pairing.js`; transfer-safe (see Pitfall 3) [VERIFIED: package.json + node_modules read] |
| `idb` | 8.0.3 (installed) | IndexedDB wrapper for region storage | Already wrapped by `openRegionsDb()`; unchanged [VERIFIED: package.json] |
| Web Worker | Browser built-in | Off-thread `parseDxfText` + `buildPostIndex` | No dependency; esbuild bundles via `new URL(..., import.meta.url)` [CITED: esbuild.github.io/api] |

### Supporting (all in-house, no install)
| Module | Function | Purpose | When to Use |
|--------|----------|---------|-------------|
| `parser/geo/utm-calibrator.js` | `utmToLatLon(e, n, zone)` | Convert extmin/extmax corners to WGS84 for Brazil-bbox check | DXF-03 corner validation [VERIFIED: file read] |
| `parser/geo/utm-calibrator.js` | `haversineMeters(lat1,lon1,lat2,lon2)` | Great-circle distance for nearest-region hint | D-07 (note: lives here, NOT in `coordinate-calculator.js` — see Open Q1) [VERIFIED: file read] |
| `parser/dwg/region-pairing.js` | `buildPostIndex` / `restorePostIndexFromDump` | Build/restore rbush from dump | Moves to Worker, otherwise unchanged [VERIFIED: file read] |
| `parser/dwg/dxf-loader.js` | `parseDxfText(text)` | DXF → `{posts, cableEdges, primaryCableEdges, extmin, extmax}` | Moves to Worker; "DO NOT scale $INSUNITS" invariant preserved [VERIFIED: file read] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Web Worker | Inline async + `setTimeout` yield | Does NOT prevent main-thread block on the 134 MB parse; would freeze the tab (Pitfall 8). Worker is the only real fix. |
| rbush `toJSON()` transfer | Rebuild index on main thread from `posts` | `buildPostIndex` on 60k posts is the expensive step — rebuilding on main thread defeats the Worker (D-04). Transfer the dump. |
| in-house haversine | turf.js / geolib | Explicitly forbidden by no-new-deps lock; in-house `haversineMeters` exists [CITED: STACK.md do-not-add list] |

**Installation:** None. `npm install` is unchanged.

**Version verification:** All packages already present and locked in `package.json`. No registry lookup needed because no package is being added. rbush 4.0.1 `toJSON`/`fromJSON` API confirmed by direct read of `node_modules/rbush/rbush.js` lines 241–246: `toJSON()` returns `this.data` (a plain nested tree); `fromJSON(data)` assigns it back. [VERIFIED: node_modules read]

## Package Legitimacy Audit

> No external packages are installed in this phase. The Package Legitimacy Gate is **not applicable** — every dependency already exists in `package.json` and was vetted in prior phases. Web Worker is a browser built-in.

| Package | Registry | Disposition |
|---------|----------|-------------|
| (none added) | — | N/A — phase adds zero dependencies per no-new-deps lock |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                          MAIN THREAD                                    WEB WORKER
                          ───────────                                    ──────────
  UI upload handler
  (browser/main.js)
       │ file (Blob)
       ▼
  hybrid.addRegion(name, file) ──► local.addRegion(name, dxfBlob)
                                          │
                                          │ await dxfBlob.text()  (134 MB string)
                                          │
                                          │ postMessage({type:'PARSE_DXF', dxfText})
                                          │ ─────────────────────────────────────►  parseDxfText(dxfText)
                                          │                                              │  (dxf-parser parseSync)
                                          │                                              ▼
                                          │                                          buildPostIndex(posts)
                                          │                                              │  (rbush bulk load)
                                          │                                              ▼
                                          │  ◄─────────────────────────────────────  postMessage({posts, cableEdges,
                                          │     {posts, cableEdges, primaryCableEdges,    primaryCableEdges, rbushDump,
                                          │      rbushDump, extmin, extmax}               extmin, extmax})
                                          ▼
                              ┌───────────────────────────────┐
                              │  VALIDATION (cheap, main thread)│
                              │                                 │
                              │  1. extmax in zone-22S envelope?│──NO──► retry ÷1000 ──in envelope?──NO──► THROW
                              │     (D-01)                       │            (D-01)         (D-02)    "DXF unit
                              │     │YES                         │                                     mismatch
                              │     ▼                            │                                     suspected"
                              │  2. confidence = high|low (D-08) │
                              │     │                            │
                              │     ▼                            │
                              │  3. utmToLatLon(extmin),         │
                              │     utmToLatLon(extmax)          │
                              │     both inside Brazil bbox?     │──NO──► THROW (DXF-03 fail loud)
                              │     (D-09)                        │
                              │     │YES                         │
                              │     ▼                            │
                              │  4. crs={...zone22S, confidence} │
                              └───────────────┬─────────────────┘
                                              ▼
                                   db.put('regions', record)   (IndexedDB, idb)
                                              │
                                              ▼
                                   return record ──► (hybrid: optional cloud upload)


  Cascade caller (coordinate-calculator-dwg.js)
       │ lat, lon
       ▼
  lookupByGps(lat, lon)
       │  bbox filter over stored regions
       ▼
   hit? ──YES──► return region (existing behavior)
       │
       NO
       ▼
   compute haversine from (lat,lon) to each region's bboxLatLon centroid (D-07)
       ▼
   return { code:'NO_REGION', nearest:{ name, distanceKm } }   (D-06, structured — not null)
```

### Recommended Project Structure
```
parser/dwg/
├── region-library.js        # EXTEND addRegion (validation + Worker call) + lookupByGps (NO_REGION)
├── dxf-loader.js            # UNCHANGED logic; now imported by the worker
├── region-pairing.js        # UNCHANGED; buildPostIndex imported by the worker
├── dxf-parse.worker.js      # NEW — Worker entry: imports parseDxfText + buildPostIndex
└── dxf-envelope.js          # OPTIONAL NEW — pure envelope/Brazil-bbox constants + predicates
                             #   (keeps addRegion readable; still "additive", not a rewrite of the flow)

tools/
└── run-dxf-ingest-timing-gate.mjs   # NEW — Node.js 5s budget gate, mirrors run-siriu-regression-gate.mjs

parser/__tests__/
└── dxf-ingestion.test.mjs   # NEW — node --test: SC-1 (Siriu identical bbox), SC-2 (mm fail), SC-3 (NO_REGION)
```

Note on D-03: CONTEXT.md says "no new `dxf-ingestion.js` module — extend `addRegion()`." A *pure-constants/predicates* helper (`dxf-envelope.js`) holding the envelope numbers and `isInZone22S()` / `isInBrazil()` does **not** violate this — the ingestion *flow* stays in `addRegion()`. The worker file is mandated by D-04. The planner should confirm this reading with the user if strict.

### Pattern 1: esbuild-bundled module Worker
**What:** Spawn the worker with `new URL` + `import.meta.url` so esbuild detects it as an entry point and emits a hashed chunk.
**When to use:** The single ingestion worker.
**Example:**
```js
// Source: esbuild.github.io/api (worker entry detection) — pattern, [CITED]
// region-library.js (main thread)
function spawnParseWorker() {
  return new Worker(
    new URL("./dxf-parse.worker.js", import.meta.url),
    { type: "module" }
  );
}

// dxf-parse.worker.js
import { parseDxfText } from "./dxf-loader.js";
import { buildPostIndex } from "./region-pairing.js";

self.onmessage = (e) => {
  if (e.data?.type !== "PARSE_DXF") return;
  try {
    const { posts, cableEdges, primaryCableEdges, extmin, extmax } =
      parseDxfText(e.data.dxfText);
    const rbushDump = buildPostIndex(posts).toJSON();
    self.postMessage({
      ok: true,
      posts, cableEdges, primaryCableEdges, rbushDump, extmin, extmax,
    });
  } catch (err) {
    // Propagate the error string — do NOT swallow (Pitfall 7).
    self.postMessage({ ok: false, error: String(err?.message ?? err) });
  }
};
```
**esbuild config change required:** `scripts/build.mjs` currently has a single entry point (`browser/main.js`). esbuild auto-detects `new Worker(new URL(...))` and bundles the worker as a side entry **only when the worker file is reachable from the bundled graph** — which it is, since `region-library.js` is imported by `browser/main.js`. Verify the emitted `dist/` contains the worker chunk after building; if esbuild does not emit it, add `parser/dwg/dxf-parse.worker.js` explicitly to `entryPoints`. [CITED: esbuild.github.io/api; GitHub evanw/esbuild#312]

### Pattern 2: Node.js fallback for the Worker (test + non-browser)
**What:** `addRegion()` runs in Node for the timing gate and unit tests, where browser `Worker` is unavailable.
**When to use:** Mirror the `isNodeRuntime()` branch already used in `ocr-extractor.js::createOcrWorker`.
**Example:**
```js
// Mirror parser/ocr-extractor.js isNodeRuntime() pattern [VERIFIED: file read]
async function runParse(dxfText) {
  if (typeof Worker === "undefined") {
    // Node / test path: run inline (still measures real parse+index cost for the 5s gate)
    const { parseDxfText } = await import("./dxf-loader.js");
    const { buildPostIndex } = await import("./region-pairing.js");
    const r = parseDxfText(dxfText);
    return { ...r, rbushDump: buildPostIndex(r.posts).toJSON() };
  }
  // Browser path: postMessage round-trip to dxf-parse.worker.js
  return parseViaWorker(dxfText);
}
```
This makes the Node timing gate (D-05) measure the same parse+index work the browser does, satisfying SC-4 without a browser test runner.

### Anti-Patterns to Avoid
- **Swallowing the unit-mismatch in a try/catch that returns a stored region (Pitfall 7):** the retry path must `throw`, never `return record`. The CONTEXT D-02 message string `"DXF unit mismatch suspected"` must be the thrown `Error.message`.
- **Deriving the envelope from CONTEXT's rough "≈730000":** that figure is wrong; real Siriu extmin.x is 642260. Use 600000–800000 E.
- **Reading `$INSUNITS` (D-01 forbids it):** detection is coordinate-range-only, consistent with dxf-loader's "DO NOT scale $INSUNITS" invariant.
- **Validating all 60k posts against the envelope/Brazil bbox:** blows the 5 s budget (D-09). Validate only the two extmin/extmax corners.
- **Transferring `posts` AND `rbushDump` and assuming low cost:** the rbush leaf nodes *reference the same post objects*, so structured-clone serializes the post coordinates twice. Acceptable at 60k, but the planner should be aware (Pitfall 3).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| UTM→WGS84 for corners | New projection code | `utmToLatLon()` in utm-calibrator.js | Snyder TM inverse already verified against Siriu; new code risks coordinate drift (SC-1) |
| Great-circle distance | New haversine | `haversineMeters()` in utm-calibrator.js | Already battle-tested; turf/geolib forbidden by no-new-deps |
| rbush serialization | Manual tree walk / JSON.stringify of nodes | `tree.toJSON()` / `tree.fromJSON()` | v4 `toJSON` returns the raw `data` tree (structured-clone-safe); manual walking risks breaking the index |
| Off-thread parsing | Chunked `setTimeout`/`requestIdleCallback` cooperative parser | Web Worker | dxf-parser is synchronous `parseSync`; cooperative yielding cannot interrupt it. Only a Worker frees the main thread. |
| Timing gate harness | Custom benchmark framework | Mirror `tools/run-siriu-regression-gate.mjs` + `npm run test:gate` | Established `node --test` + `process.exit(1)` gate pattern; no new test-runner dep (D-05) |

**Key insight:** Every "hard" problem in this phase already has a verified in-house solution. The only genuinely new code is the Worker plumbing and the validation predicates — both thin.

## Runtime State Inventory

> This phase is **additive code + validation**, not a rename/refactor/migration. It introduces a new persisted field (`crs.confidence`) and changes the shape of one return value (`lookupByGps`). The inventory below covers the data-shape and re-ingest implications.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data (IndexedDB) | Existing region records have `crs = {datum, zone, hemisphere}` with **no `confidence`** field. DB_NAME=`pdf-to-kmz-dwg-library`, DB_VERSION=1, store `regions`. | Code edit: tolerate `crs.confidence === undefined` on read (treat as `'inferred'` or re-derive). No IndexedDB version bump needed — new optional field on an object store is additive. Re-ingesting a DXF overwrites the record (keyPath `id`=name) with the new field. SC-1 requires the *re-ingested* Siriu record to show `confidence:'high'`. |
| Stored data (Vercel Blob cloud) | `manifestFromRecord()` in region-library-hybrid.js builds the cloud manifest from `{crs, bboxUtm, ...}`. It already spreads `crs`, so `confidence` rides along automatically on new uploads. **But** `manifestFromRecord` omits `primaryCableEdges` (only `cableEdges`) — pre-existing, out of P6 scope. | Verify: new uploads carry `crs.confidence`. Existing cloud manifests lack it — `importRegionFromManifest` defaults `crs ?? DEFAULT_CRS` (no confidence) → reads as `undefined`. Tolerate on read. |
| Live service config | None — no external service stores the renamed/new field by key. | None — verified: only IndexedDB + Vercel Blob, both handled above. |
| Secrets/env vars | None touched. Vercel Blob token unchanged. | None. |
| Build artifacts | esbuild `dist/app.js` is regenerated each build. New `dist/dxf-parse.worker-*.js` chunk will be emitted. | Verify `dist/` contains the worker chunk after `npm run build`; ensure deploy serves it (same dir as app.js). |

**Caller-contract change (the load-bearing one):** `lookupByGps()` currently returns `null` on no-hit (region-library.js line 115). D-06 changes it to return `{code:'NO_REGION', nearest:{...}}`. The hybrid wrapper (region-library-hybrid.js line 112–125) does `const local = await localLibrary.lookupByGps(...); if (local) return local;` — **a truthy `NO_REGION` object would short-circuit the cloud fallback**. The planner MUST update the hybrid wrapper to distinguish "no local hit, try cloud" from "definitively no region anywhere." Recommended: keep `lookupByGps` returning `null` for "no local hit" internally, and have the *cascade caller* (`coordinate-calculator-dwg.js`) synthesize the `NO_REGION` structured error after both local and cloud miss. **This is the highest-risk integration point in the phase.** [VERIFIED: file reads of both libraries]

## Common Pitfalls

### Pitfall 1: Envelope derived from the wrong Siriu extents (false unit-mismatch on SC-1)
**What goes wrong:** Using CONTEXT.md's "extmin.x ≈ 730000" to set a tight envelope (e.g., 700000–760000 E). Real Siriu extmin.x is 642260 → Siriu re-ingest fails the envelope check → triggers ÷1000 retry → 642 is outside → THROWS "DXF unit mismatch suspected" on a perfectly valid file. SC-1 and SC-2 both break.
**Why it happens:** The CONTEXT "specifics" figure was a rough guess; the actual header value differs by ~88 km.
**How to avoid:** Read the real extents (done here). Siriu: E 642260–742091, N 6812580–6930560. Palhoça: E 642260–761089, N 6812580–6996762. Use envelope **E 600000–800000, N 6700000–7100000** (generous margin both sides; still rejects mm-scale 10^8+ values and rejects zone-21S/23S eastings).
**Warning signs:** Siriu re-ingest throws; the ÷1000 retry fires on any known-good file.

### Pitfall 2: Unit-retry path swallows the error (PITFALLS.md Pitfall 7)
**What goes wrong:** The ÷1000 retry is wrapped so that a double-failure stores a low-confidence region instead of throwing. The system is then permanently "internally consistent but wrong" — exactly the compensated-error trap.
**Why it happens:** Defensive try/catch around validation that falls through to `db.put`.
**How to avoid:** D-02 is explicit: double-failure → `throw new Error("DXF unit mismatch suspected")`. No `confidence:'low'` store on a failed retry. The `confidence:'low'` value is reserved for a *successful* ÷1000 retry (see Open Q2 — likely unreachable).
**Warning signs:** A region record exists with coordinates outside the envelope; no error surfaced to the UI.

### Pitfall 3: rbush dump double-serializes post objects across the Worker boundary
**What goes wrong:** `tree.toJSON()` returns `this.data`, whose leaf nodes hold references to the **same** post objects in the `posts` array. `postMessage({posts, rbushDump})` structured-clones both, duplicating every post's `{x,y,block}`. At 60k posts this is ~2× the necessary serialization work and memory spike.
**Why it happens:** rbush stores actual item references in leaves, not indices.
**How to avoid:** Acceptable at Palhoça scale (measured against the 5 s budget — see timing gate). If the budget is tight, the planner can post only `rbushDump` and reconstruct `posts` from the leaf nodes on the main thread, OR post only `posts` and rebuild the index on the main thread (defeats the Worker — not recommended). **Transferable objects do NOT help** here: the data is plain objects, not `ArrayBuffer`, so there is nothing to transfer zero-copy. Just structured-clone both and measure.
**Warning signs:** Worker round-trip dominates the 5 s budget; heap spike on `postMessage`.

### Pitfall 4: esbuild does not emit the worker chunk
**What goes wrong:** Build succeeds but `dist/` has no worker file; `new Worker(new URL('./dxf-parse.worker.js', import.meta.url))` 404s at runtime.
**Why it happens:** esbuild only rewrites `new URL(..., import.meta.url)` when the literal is *directly inside* the `Worker()` constructor and the format/target supports `import.meta` (esm + es2020+, which this build uses). Indirection through a variable breaks detection.
**How to avoid:** Keep the `new URL(...)` literal inline in the constructor call. After build, assert the worker chunk exists in `dist/`. If absent, add the worker to esbuild `entryPoints` explicitly and reference the emitted filename.
**Warning signs:** Runtime 404 for the worker URL; worker `onerror` fires immediately.

### Pitfall 5: `lookupByGps` return-shape change breaks the hybrid cloud fallback
**What goes wrong:** Returning a truthy `{code:'NO_REGION'}` from the local lookup makes `if (local) return local` in the hybrid wrapper skip the cloud lookup entirely — regions stored only in the cloud become unreachable.
**Why it happens:** The hybrid wrapper treats any truthy return as "found."
**How to avoid:** Synthesize the structured `NO_REGION` error at the cascade level (after local AND cloud both miss), not inside the leaf `lookupByGps`. See Runtime State Inventory caller-contract note. **This is the load-bearing integration decision of the phase.**
**Warning signs:** Cloud-only regions stop resolving after the D-06 change.

## Code Examples

### Unit-mismatch detection with ÷1000 retry (D-01/D-02)
```js
// Source: derived from CONTEXT D-01/D-02 + real Siriu/Palhoca extents [VERIFIED: dxf header reads]
const ZONE_22S = { minE: 600000, maxE: 800000, minN: 6700000, maxN: 7100000 };

function inZone22S(e, n) {
  return e >= ZONE_22S.minE && e <= ZONE_22S.maxE
      && n >= ZONE_22S.minN && n <= ZONE_22S.maxN;
}

// inside addRegion, after worker returns {posts, extmin, extmax, ...}
let scale = 1;
let confidence = "high";
if (!inZone22S(extmax.x, extmax.y)) {
  // retry millimetres → metres
  if (inZone22S(extmax.x / 1000, extmax.y / 1000)) {
    scale = 1 / 1000;
    confidence = "low"; // successful mm→m retry (see Open Q2: may be unreachable in practice)
  } else {
    throw new Error("DXF unit mismatch suspected"); // D-02 — fail loud, never store
  }
}
// apply scale to extmin/extmax AND every post before indexing/storing
```

### Brazil-bbox corner validation (D-09 / DXF-03)
```js
// Source: utm-calibrator.utmToLatLon [VERIFIED: file read] + Brazil bbox [CITED: CONTEXT D-09]
const BRAZIL = { minLat: -33.8, maxLat: 5.3, minLon: -73.0, maxLon: -34.8 };
function inBrazil(p) {
  return p.lat >= BRAZIL.minLat && p.lat <= BRAZIL.maxLat
      && p.lon >= BRAZIL.minLon && p.lon <= BRAZIL.maxLon;
}
const ll0 = utmToLatLon(extmin.x * scale, extmin.y * scale, crs.zone);
const ll1 = utmToLatLon(extmax.x * scale, extmax.y * scale, crs.zone);
if (!inBrazil(ll0) || !inBrazil(ll1)) {
  throw new Error("DXF coordinates outside Brazil — wrong UTM zone or datum suspected");
}
```

### Structured NO_REGION error with nearest hint (D-06/D-07)
```js
// Source: CONTEXT D-06/D-07 + haversineMeters [VERIFIED: file read]
// Synthesize at cascade level after local + cloud both miss (NOT inside leaf lookupByGps — Pitfall 5)
function noRegionError(lat, lon, allRegions) {
  let best = null;
  for (const r of allRegions) {
    const b = r.bboxLatLon; if (!b) continue;
    const cLat = (b.minLat + b.maxLat) / 2;
    const cLon = (b.minLon + b.maxLon) / 2;
    const km = haversineMeters(lat, lon, cLat, cLon) / 1000;
    if (!best || km < best.distanceKm) best = { name: r.name, distanceKm: km };
  }
  return { code: "NO_REGION", nearest: best }; // nearest may be null if corpus empty
}
```

### Node.js timing gate (D-05 / SC-4), mirroring run-siriu-regression-gate.mjs
```js
// Source: pattern from tools/run-siriu-regression-gate.mjs [VERIFIED: file read]
import { readFileSync } from "node:fs";
import { createRegionLibrary } from "../parser/dwg/region-library.js";
import { IDBFactory } from "fake-indexeddb"; // already a devDependency

const BUDGET_MS = 5000;
const dxfText = readFileSync(new URL("../Palhoca.dxf", import.meta.url), "utf8");
const lib = createRegionLibrary(new IDBFactory());
const blob = { text: async () => dxfText }; // mimic Blob.text()

const t0 = performance.now();
await lib.addRegion("Palhoca-timing", blob);
const ms = performance.now() - t0;

if (ms > BUDGET_MS) {
  console.error(`DXF ingest gate FAILED: ${ms.toFixed(0)} ms > ${BUDGET_MS} ms budget`);
  process.exit(1);
}
console.log(`PASS — Palhoca ingest ${ms.toFixed(0)} ms ≤ ${BUDGET_MS} ms`);
```
Note: in Node, `Worker` is undefined → the inline fallback (Pattern 2) runs parse+index synchronously, measuring the real CPU cost. The browser adds Worker round-trip overhead on top, so a comfortable Node margin (e.g., ≤ 3 s) is advisable. Add to `npm run test:gate`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `addRegion` stores any parse result unconditionally | Validate envelope + Brazil bbox, fail loud | Phase 6 | No silently-wrong regions stored |
| `lookupByGps` returns `null` on miss | Structured `NO_REGION` with nearest hint (synthesized at cascade) | Phase 6 | Machine-readable failure; Phase 9 renders Portuguese |
| Synchronous inline parse on main thread | Web Worker off-thread parse + index | Phase 6 | 134 MB / 60k INSERTs ingest without freezing the tab |
| `crs = {datum, zone, hemisphere}` | adds `confidence: high\|low\|inferred` | Phase 6 | Downstream P7/P8 can read ingest trust level |

**Deprecated/outdated:**
- The CONTEXT.md §specifics Siriu figure "extmin.x ≈ 730000" is **superseded** by the verified header value 642260. Do not use the 730000 figure for envelope derivation.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Recommended zone-22S envelope E 600000–800000, N 6700000–7100000 is generous enough for all SC routes yet rejects mm-scale | Code Examples / Pitfall 1 | Too tight → false unit-mismatch on a valid file (SC-1 break). Derived from verified Siriu+Palhoça extents with margin; LOW risk but planner should confirm against João Born / Valmor / Valmor extents if those DXFs are available. |
| A2 | Brazil bbox lat −33.8…+5.3, lon −73.0…−34.8 | Code Examples | Standard Brazil bounding box; matches CONTEXT D-09. Wrong values could pass an out-of-country corner. LOW risk. |
| A3 | esbuild auto-emits the worker chunk from the reachable import graph without an explicit entryPoint | Pattern 1 / Pitfall 4 | If wrong, build needs an explicit entryPoint line. MEDIUM — must be verified empirically during planning/execution. |
| A4 | `confidence:'low'` (successful mm→m retry) is effectively unreachable for real SC DXFs because no real local file is authored in mm | D-08 / Open Q2 | If a real mm DXF appears, the low path stores a valid region. CONTEXT grants discretion to make it unreachable + assert. LOW risk. |
| A5 | Structured `NO_REGION` should be synthesized at cascade level, not inside leaf `lookupByGps`, to preserve the hybrid cloud fallback | Runtime State Inventory / Pitfall 5 | If the planner instead changes the leaf return, cloud-only regions break. This is an architectural recommendation, not a locked decision — planner/user should confirm. MEDIUM. |

## Open Questions

1. **`haversineMeters` location.** CONTEXT D-07 / §code_context say "in-house haversine from `parser/coordinate-calculator.js`." Verified: the haversine is actually exported from `parser/geo/utm-calibrator.js` (line 770), and `coordinate-calculator.js` *imports* it from there. Functionally identical; import from utm-calibrator.js directly.
   - Recommendation: import `haversineMeters` from `../geo/utm-calibrator.js` in region-library.js. No new code.

2. **Is `confidence:'low'` reachable?** D-08 defines it for a *successful* ÷1000 retry, but D-02 fails loud on a *failed* retry. A successful retry only happens if a real DXF is authored in mm yet lands in-envelope after ÷1000. No such file exists in the corpus (Siriu/Palhoça are native metres).
   - What we know: the value is defined and storable in principle.
   - What's unclear: whether any real SC DXF will ever trigger it.
   - Recommendation: implement the path (cheap), add a unit test with a synthetic mm DXF to exercise it, but per CONTEXT discretion the planner may instead assert it never stores and treat any mm-scale input as fail-loud. Confirm with user.

3. **D-03 strictness vs. a constants helper.** CONTEXT forbids a new `dxf-ingestion.js`. A pure `dxf-envelope.js` (constants + predicates, no flow) is arguably compliant and improves readability.
   - Recommendation: planner proposes the helper; if the user wants strict in-file, inline the constants at the top of region-library.js. Either satisfies D-03's intent (no flow rewrite).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `Palhoca.dxf` (134 MB) | SC-4 timing gate | ✓ | repo root | — (gate cannot run without it) |
| `siriu.dxf` | SC-1 identical-bbox test | ✓ | repo root | — |
| `dxf-parser` | parse | ✓ | 1.1.2 | — |
| `rbush` | index | ✓ | 4.0.1 | — |
| `idb` | storage | ✓ | 8.0.3 | — |
| `fake-indexeddb` | Node tests/gate | ✓ | 6.2.5 (devDep) | — |
| `esbuild` | bundle worker | ✓ | 0.25.5 (devDep) | — |
| Web Worker | browser off-thread | ✓ | browser built-in | Node inline fallback (Pattern 2) |
| `performance.now()` | timing gate | ✓ | Node + browser global | `Date.now()` |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** Web Worker → inline parse in Node (by design, for the timing gate).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node --test` (built-in) + bespoke gate scripts via `node tools/*.mjs` |
| Config file | none — scripts wired in `package.json` `test:gate` |
| Quick run command | `node --test parser/__tests__/dxf-ingestion.test.mjs` |
| Full suite command | `npm run test:gate` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DXF-01 | Ingest resolves CRS zone-22S at ingest | unit | `node --test parser/__tests__/dxf-ingestion.test.mjs` | ❌ Wave 0 |
| DXF-02 | mm DXF → ÷1000 retry → fail loud "DXF unit mismatch suspected" | unit | same (SC-2 case) | ❌ Wave 0 |
| DXF-03 | extmin/extmax corners validated in Brazil bbox; out-of-range throws | unit | same | ❌ Wave 0 |
| DXF-04 | rbush index built + restorable from dump; region indexed by bbox | unit | extend `region-pairing.test.mjs` (exists) | ✅ (extend) |
| DXF-05 | no-region GPS → structured NO_REGION + nearest hint | unit | same dxf-ingestion test (SC-3) | ❌ Wave 0 |
| DXF-06 | Palhoça 60k INSERTs ingest ≤ 5 s | timing gate | `node tools/run-dxf-ingest-timing-gate.mjs` | ❌ Wave 0 |
| DXF-07 | list regions with name + bboxLatLon | unit | dxf-ingestion test (listRegions shape) | ❌ Wave 0 |
| SC-1 | Siriu re-ingest → identical bbox + confidence 'high' | regression | dxf-ingestion test (golden bbox compare) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `node --test parser/__tests__/dxf-ingestion.test.mjs`
- **Per wave merge:** `npm run test:gate` (adds the Palhoça timing gate)
- **Phase gate:** full `test:gate` green + Siriu regression gate still green (no drift) before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `parser/__tests__/dxf-ingestion.test.mjs` — covers DXF-01/02/03/05/07 + SC-1 golden bbox
- [ ] `tools/run-dxf-ingest-timing-gate.mjs` — covers DXF-06/SC-4 (Palhoça ≤ 5 s)
- [ ] Golden reference: capture current Siriu `bboxLatLon` from a pre-change ingest as the SC-1 fixture **before** touching `addRegion` (so any drift is detectable)
- [ ] Synthetic mm-scale DXF fixture (small) for the SC-2 fail-loud test — e.g., a 4-INSERT DXF with coords ×1000 outside envelope
- [ ] Wire both into `package.json` `test:gate`

## Security Domain

> Browser-side client app, no auth/session/network-trust surface introduced by this phase. ASVS exposure is limited to untrusted file input (the uploaded DXF) and the existing Vercel Blob upload path (unchanged by P6).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — (no auth in app) |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | DXF is untrusted input. Envelope + Brazil-bbox checks are validation; dxf-parser handles malformed DXF (throws → caught → user error). Binary-DWG sniff already exists in browser/main.js. |
| V6 Cryptography | no | — (no secrets handled in P6; Blob token is server-side, unchanged) |

### Known Threat Patterns for browser DXF ingestion
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious/huge DXF → memory exhaustion (134 MB+ ArrayBuffer) | Denial of Service | Parse in Worker (isolates crash from main tab); existing 134 MB target is the known ceiling. A size guard (reject > ~200 MB) is a reasonable addition. |
| Malformed DXF → parser throw | Denial of Service (tab) | `parseSync` throw is caught in `addRegion`/Worker and surfaced as a user error (existing pattern) |
| Coordinate poisoning → silently-wrong GPS | Tampering (data integrity) | Envelope + Brazil-bbox fail-loud (the core of this phase) prevents storing wrong-coordinate regions |
| Binary DWG masquerading as DXF | (input confusion) | Already mitigated: browser/main.js sniffs `AC1` magic bytes [VERIFIED: file read] |

## Sources

### Primary (HIGH confidence — direct file reads, this session)
- `parser/dwg/region-library.js` — addRegion/lookupByGps/listRegions/importRegionFromManifest current behavior
- `parser/dwg/dxf-loader.js` — parseDxfText output shape + "DO NOT scale $INSUNITS" invariant
- `parser/dwg/region-pairing.js` — buildPostIndex/restorePostIndexFromDump, PostIndex extends RBush
- `parser/dwg/region-library-hybrid.js` — hybrid addRegion/lookupByGps fallback chain (Pitfall 5 source)
- `parser/geo/utm-calibrator.js` — utmToLatLon (line 62), haversineMeters (line 770)
- `parser/ocr-extractor.js` — isNodeRuntime() worker pattern (Pattern 2 source)
- `node_modules/rbush/rbush.js` — toJSON/fromJSON (lines 241–246)
- `siriu.dxf` / `Palhoca.dxf` `$EXTMIN`/`$EXTMAX` headers — real envelope constants
- `package.json` — installed deps + test scripts
- `scripts/build.mjs` — esbuild config (esm/browser, single entry point)
- `tools/run-siriu-regression-gate.mjs` — gate harness pattern (D-05 mirror)
- `.planning/research/PITFALLS.md` — Pitfalls 4/5/6/7/8 map directly to this phase

### Secondary (MEDIUM — official docs)
- esbuild.github.io/api — worker bundling via `new Worker(new URL(..., import.meta.url))` [CITED]
- GitHub evanw/esbuild#312 — worker support discussion [CITED]

### Tertiary (LOW — none load-bearing)
- WebSearch on esbuild worker patterns — corroborated the inline-URL requirement; cross-verified against esbuild docs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all deps installed and version-confirmed; no new packages
- Architecture: HIGH — every integration point verified by file read; the one architectural recommendation (NO_REGION synthesis location) is flagged as A5 for confirmation
- Pitfalls: HIGH — derived from the project's own PITFALLS.md + verified codebase behavior; envelope-constants correction (Pitfall 1) is the highest-value finding
- Envelope constants: HIGH for Siriu/Palhoça (read from headers); MEDIUM for João Born/Valmor (DXFs not inspected — A1)

**Research date:** 2026-06-06
**Valid until:** 2026-07-06 (stable; no fast-moving external deps — all in-house/built-in)
</content>
</invoke>
