---
phase: 06-dxf-ingestion-region-lookup
reviewed: 2026-06-09T00:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - package.json
  - scripts/build.mjs
  - browser/main.js
  - parser/dwg/region-library.js
  - parser/dwg/dxf-parse.worker.js
  - parser/dwg/dxf-loader.js
  - parser/dwg/coordinate-calculator-dwg.js
  - parser/dwg/region-library-hybrid.js
  - parser/__tests__/dxf-ingestion.test.mjs
  - parser/__tests__/no-region-lookup.test.mjs
  - parser/__tests__/fixtures/siriu-bbox-golden.json
  - parser/__tests__/fixtures/mm-scale.dxf
  - parser/__tests__/fixtures/no-extents.dxf
  - tools/run-dxf-ingest-timing-gate.mjs
findings:
  critical: 1
  warning: 6
  info: 5
  total: 12
status: issues_found
---

# Phase 6: Code Review Report

**Reviewed:** 2026-06-09
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

Phase 6 hardens DXF ingestion (`addRegion` envelope/Brazil validation + `crs.confidence`),
adds off-thread parsing via `dxf-parse.worker.js` with a Node inline fallback, surfaces
structured `NO_REGION` errors at the cascade caller, and wires a Palhoca timing gate into
`test:gate`. The core validation logic in `resolveGeoreference` is clean and the Pitfall-5
decision (leaf/hybrid `lookupByGps` stays `null`; cascade synthesizes `dwgNoRegion`) is
correctly implemented.

However the review surfaced one operational blocker: the Palhoca timing gate is **RED on
the review host** (6035–7597 ms vs 5000 ms budget), so `npm run test:gate` fails end-to-end
here despite the 06-03 summary recording ~4588 ms. Several test-coverage gaps also weaken
confidence: Phase 6 unit suites are not wired into `test:gate`, DXF-03 lacks an
`addRegion` integration path, the browser Worker round-trip is never exercised in CI, and
the DXF-04 restore test does not actually perform a GPS nearest-post query.

## Critical Issues

### CR-01: Palhoca timing gate exceeds budget on review hardware — `test:gate` is RED

**File:** `tools/run-dxf-ingest-timing-gate.mjs:15-36`, `package.json:14`
**Issue:** The gate hard-caps ingest at `BUDGET_MS = 5000`. On the review host, two
consecutive runs measured **7597 ms** and **6035 ms** — both fail. The 06-03 summary
records a prior PASS at ~4588 ms, so the gate appears sensitive to host CPU/IO variance
rather than a deterministic regression, but the effect is the same: `npm run test:gate`
exits non-zero and blocks phase verification on slower machines. The 06-RESEARCH.md
note ("a comfortable Node margin, e.g. ≤ 3 s, is advisable") was not acted on; the
budget sits at the SC-4 ceiling with no slack.
**Fix:** Re-baseline with margin: either (a) raise `BUDGET_MS` to ~8000–10000 ms with an
explicit comment that Node inline path measures CPU-only and browser adds Worker overhead,
or (b) split into a "hard" functional gate (must complete) and a "soft" perf telemetry
gate. At minimum, re-run on CI hardware and document the observed P95 before locking the
threshold. Do not leave a gate that passes on one executor machine and fails on another
without documented intent.

## Warnings

### WR-01: Phase 6 unit tests are not wired into `npm run test:gate`

**File:** `package.json:11-14`, `parser/__tests__/dxf-ingestion.test.mjs`,
`parser/__tests__/no-region-lookup.test.mjs`
**Issue:** Only `run-dxf-ingest-timing-gate.mjs` was appended to `test:gate`. The two
Phase 6 correctness suites (`dxf-ingestion.test.mjs` — DXF-01/02/03/04/08 + SC-1;
`no-region-lookup.test.mjs` — DXF-04 positive + DXF-05 + hybrid contract) are run
manually during execution but never in the gate chain. 06-RESEARCH.md §Wave 0 Gaps
explicitly lists wiring both into `test:gate` as unfinished. A green gate therefore does
not attest envelope validation, Brazil-bbox throws, NO_REGION shape, or restore-and-query
— only Palhoca wall-clock.
**Fix:** Append to `test:gate` (or `test:gate:fixtures`):
```bash
node --test parser/__tests__/dxf-ingestion.test.mjs && \
node --test parser/__tests__/no-region-lookup.test.mjs
```

### WR-02: DXF-03 `addRegion` Brazil-bbox throw is not integration-tested

**File:** `parser/__tests__/dxf-ingestion.test.mjs:49-69`
**Issue:** The test named "DXF-03: corners outside Brazil throw and store nothing"
calls `validateBrazilExtents` directly with synthetic out-of-envelope UTM corners — a
pure helper unit test. The second `assert.rejects` ingests `mm-scale.dxf`, which throws
`"DXF unit mismatch suspected"` (SC-2), not `"outside Brazil"`. There is no fixture DXF
whose scaled `$EXTMIN`/`$EXTMAX` pass the zone-22S envelope but convert outside Brazil,
and no assertion that `listRegions()` is empty after a Brazil throw. Plan 06-01 acceptance
criteria require `addRegion` to throw on out-of-Brazil corners and store nothing.
**Fix:** Add a minimal DXF fixture with in-envelope UTM header corners that map outside
Brazil (e.g. `$EXTMAX` at E=600001, N=6700001 in zone 22 — passes `inZone22S` but
`utmToLatLon` lands south of −33.8°), assert `addRegion` rejects with `/outside Brazil/`,
then assert the region id is absent from `listRegions()`.

### WR-03: Worker silently ignores unknown `postMessage` types — `runParse` can hang

**File:** `parser/dwg/dxf-parse.worker.js:4-5`, `parser/dwg/region-library.js:162-195`
**Issue:** The worker returns immediately when `e.data?.type !== "PARSE_DXF"` without
posting any response. `runParse` creates a `Promise` that resolves only on `onmessage` or
rejects on `onerror` — there is no timeout. A mistyped message, a future protocol
extension, or a stray `postMessage` leaves the promise pending forever and the Worker
alive until tab close. Pitfall 7 covers parse failures; this is the complementary
"no-response" hole.
**Fix:** Post `{ ok: false, error: "unknown message type" }` on unrecognized types, or
add a `setTimeout` reject in `runParse` with worker termination. At minimum, never `return`
silently from `onmessage`.

### WR-04: Browser Worker path is never exercised in automated tests

**File:** `parser/dwg/region-library.js:155-196`, `parser/dwg/dxf-parse.worker.js`
**Issue:** All Phase 6 tests and the timing gate run in Node where `typeof Worker ===
"undefined"`, so every test hits the inline `parseDxfText` + `buildPostIndex` branch.
The Worker spawn, `postMessage` structured-clone of 134 MB `dxfText`, `{ok:false}` error
relay, and `worker.terminate()` lifecycle are unverified in CI. DXF-06's browser goal
("tab not frozen during 134 MB ingest") has no automated coverage beyond the separate
esbuild emission check.
**Fix:** Add a minimal Worker round-trip test using `node:worker_threads` or a headless
browser harness that posts a tiny DXF to `dxf-parse.worker.js` and asserts `{ok:true}`
shape. Alternatively document Worker coverage as manual-only and add a build-time assertion
that `dist/dxf-parse.worker.js` exports the `PARSE_DXF` handler.

### WR-05: `catch` path on region lookup omits `dwgNoRegion`

**File:** `parser/dwg/coordinate-calculator-dwg.js:282-304` vs `307-330`
**Issue:** When `regionLibrary.lookupByGps` / `getRegionWithIndex` throws (IndexedDB
failure, corrupt record, etc.), the `catch` block returns `dwgStatus: "pdf-fallback"` with
a `dwg-region-miss` warning but **no** `dwgNoRegion` field. The intentional miss path at
lines 307–330 always attaches `dwgNoRegion` via `noRegionError`. Downstream Phase 9
(CONF-01 / D-12) uses `dwgNoRegion` presence to distinguish hard no-region blocks from
other pdf-fallback cases — a thrown lookup is indistinguishable from a matched-region
degradation on the `dwgNoRegion` signal alone.
**Fix:** In the `catch` block, also call `noRegionError(lat1, lon1, regions)` (best-effort
if `listRegions` is available) and attach `dwgNoRegion`, or add a distinct
`dwgRegionLookupError` field so Phase 9 can render the correct Portuguese message.

### WR-06: `noRegionError` / cascade miss path lacks end-to-end integration test

**File:** `parser/__tests__/no-region-lookup.test.mjs`, `parser/dwg/coordinate-calculator-dwg.js`
**Issue:** Tests cover `noRegionError` as a pure function and leaf/hybrid `lookupByGps`
contracts, but never invoke `calculateCoordinatesWithDwg` with a stubbed `regionLibrary`
returning `null` to assert the returned `missResult.dwgNoRegion` shape on the real cascade
path. A refactor that drops the `dwgNoRegion` attachment at line 327 would not be caught
by the current suite.
**Fix:** Add `coordinate-calculator-dwg-no-region.test.mjs` that stubs
`regionLibrary.lookupByGps → null`, `listRegions → [seeded region]`, calls
`calculateCoordinatesWithDwg(...)`, and asserts `result.dwgNoRegion.code === "NO_REGION"`
with a finite `nearest.distanceKm`.

## Info

### IN-01: `parseDxfTextFast` (≥ 1 MB) has no legacy parity gate

**File:** `parser/dwg/dxf-loader.js:245-255`
**Issue:** Files ≥ 1 MB (including Siriu at 8.6 MB) use the hand-rolled fast scanner;
smaller files use `dxf-parser`. SC-1 golden-bbox guards coordinate output for Siriu on
the fast path, but there is no test comparing post counts / cable-edge counts between
`parseDxfTextFast` and `parseDxfTextLegacy` on the same input. A divergence in layer
filtering or entity flushing would only surface indirectly.
**Fix:** Add a parity test on a medium synthetic DXF (or a trimmed Siriu slice) asserting
identical `{ posts.length, cableEdges.length, extmin, extmax }` from both parsers.

### IN-02: `confidence: 'low'` mm→m retry success path is implemented but untested

**File:** `parser/dwg/region-library.js:132-138`, `parser/__tests__/dxf-ingestion.test.mjs`
**Issue:** `resolveGeoreference` sets `confidence = "low"` when raw extmax is outside
zone-22S but `/1000` lands inside. The test suite only exercises the failed-retry throw
(`mm-scale.dxf` with extmax 9 999 999). 06-01 SUMMARY documents "no corpus file triggers
it" — acceptable for production, but the reachable code path has zero test coverage.
**Fix:** Add a fixture with extmax e.g. 700 000 000 / 6 900 000 000 (÷1000 → in-envelope)
asserting `crs.confidence === "low"` and scaled post coordinates.

### IN-03: DXF-04 restore test title says "GPS query" but uses UTM bbox search

**File:** `parser/__tests__/dxf-ingestion.test.mjs:84-120`
**Issue:** The test restores `rbushDump` then searches a ±10 m UTM window around
`expected.x/y`. `latLonToUtm` is called but only used in `assert.ok(typeof easting ===
"number")` — the GPS→UTM conversion is not part of the query. The test proves dump
round-trip integrity, not the GPS nearest-post accessor used in pairing.
**Fix:** Rename the test to "rbushDump restores and UTM nearest-post search matches", or
invoke the actual nearest-post GPS helper from `region-pairing.js` if one exists.

### IN-04: Large DXFs omit `sourceDxf` from IndexedDB but cloud upload still receives blob

**File:** `parser/dwg/region-library.js:263`, `parser/dwg/region-library-hybrid.js:84-93`
**Issue:** `sourceDxf` is set to `null` when `dxfText.length > MAX_SOURCE_DXF_STORE_BYTES`
(50 MB) to stay within the ingest budget. Local re-export of Palhoca cannot recover the
raw DXF from IndexedDB, but `createHybridRegionLibrary.addRegion` still passes the
original `dxfBlob` to `cloudClient.uploadRegion`. Behavior is intentional but
asymmetric — document in UI or manifest that large regions are cloud-DXF-dependent for
re-download.

### IN-05: Unit-mismatch detection checks `extmax` only, not `extmin`

**File:** `parser/dwg/region-library.js:132`
**Issue:** Per plan D-01, only `extmax.x/y` gate the mm retry. A DXF with a valid extmax
but an extmin still in mm-scale (or vice versa) could pass envelope detection while post
coordinates remain wrong. Low practical risk for SC corpus where header corners are
consistent, but worth noting if envelope constants are tightened.
**Fix:** Also evaluate `extmin` when either corner is outside zone-22S, or document
extmax-only as an explicit D-01 trade-off.

---

_Reviewed: 2026-06-09_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
