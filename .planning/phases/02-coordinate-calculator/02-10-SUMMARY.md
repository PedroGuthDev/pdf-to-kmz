---
phase: 02-coordinate-calculator
plan: "10"
subsystem: dwg-integration
tags: [dwg, indexeddb, idb, orchestrator, fallback]
status: complete
dependency_graph:
  requires:
    - "02-09"
  provides:
    - parser/dwg/region-library.js
    - parser/dwg/coordinate-calculator-dwg.js
tech_stack:
  added: []
key_files:
  created:
    - parser/dwg/region-library.js
    - parser/dwg/coordinate-calculator-dwg.js
  modified:
    - parser/dwg/region-pairing.js
metrics:
  last_updated: "2026-05-27"
  commits: []
---

# Phase 2 Plan 10: IndexedDB region library + DWG orchestrator — Summary

**One-liner:** Added an IndexedDB-backed regional DXF library (`createRegionLibrary`) and a single async entrypoint (`calculateCoordinatesWithDwg`) that selects a region by GPS bbox, attempts strict DWG pairing, and falls back transparently to the existing PDF pipeline.

## What Was Built

- `parser/dwg/region-library.js`
  - Stores region records in IndexedDB (`pdf-to-kmz-dwg-library`, store `regions`, keyPath `id`).
  - `addRegion(name, blob)`: parses DXF, builds rbush dump, persists blob + parsed data + bbox (UTM + WGS84).
  - `lookupByGps(lat, lon)`: bbox contains check, prefers the smallest bbox on overlaps.
  - `getRegionWithIndex(id)`: restores rbush from dump and rebuilds adjacency graph deterministically.
  - Node support: accepts an `idbFactory` (fake-indexeddb) by temporarily overriding `globalThis.indexedDB` inside DB open.

- `parser/dwg/coordinate-calculator-dwg.js`
  - `calculateCoordinatesWithDwg(...)` (async):
    - If no library: delegates directly to `calculateCoordinates` (non-regression).
    - If region miss: emits `{ kind: "dwg-region-miss" }` then falls back.
    - If pairing fails: returns fallback output + DWG warnings.
    - If pairing succeeds: keeps PDF-derived topology output but replaces post lat/lon with DWG-derived coordinates and sets `source: "dwg"`.

## Validation

- `node parser/__tests__/coordinate-calculator.test.mjs`: **PASS** (22/22)
- Export checks:
  - `createRegionLibrary`, `DB_NAME`, `DB_VERSION` present
  - `calculateCoordinatesWithDwg` present

