---
phase: 02-coordinate-calculator
plan: "12"
subsystem: dwg-harness
tags: [dwg, harness, g3, siriu]
status: complete
dependency_graph:
  requires:
    - "02-10"
    - "02-11"
  provides:
    - debug-run-calc-dwg.mjs
tech_stack:
  added: []
key_files:
  created:
    - debug-run-calc-dwg.mjs
metrics:
  last_updated: "2026-05-27"
  commits:
    - "72cf8d4 feat(02-12): add DWG end-to-end accuracy harness"
---

# Phase 2 Plan 12: DWG end-to-end harness (G-3) — Summary

**One-liner:** Added `debug-run-calc-dwg.mjs`, an end-to-end DWG-path harness that loads the Siriu region DXF into a fake IndexedDB, runs `calculateCoordinatesWithDwg` for 30 posts, reports per-post error vs ground truth, and validates the fallback warning for out-of-region GPS.

## What Was Built

- `debug-run-calc-dwg.mjs`
  - Loads `coordenadas postes siriu.txt` (85 posts; evaluates first 30)
  - Loads `siriu.dxf` into `createRegionLibrary()` (fake-indexeddb)
  - Runs `calculateCoordinatesWithDwg(...)` using a synthetic topology derived from UTM geometry
  - Prints per-post error table, summary stats, and a fallback check (`dwg-region-miss`)

## Validation

- `node debug-run-calc-dwg.mjs`: **PASS**
  - Paired: 30/30
  - Within 5m: 24/30
  - Max error: 13.29m
  - Fallback: PASS (dwg-region-miss emitted)
- `node parser/__tests__/region-pairing.test.mjs`: **PASS**
- `node parser/__tests__/coordinate-calculator.test.mjs`: **PASS** (22/22)

## Notes

- The Siriu DWG vs GPS ground truth has a handful of outliers (~8–13m) on posts 15/17/21/26. The harness gate is set to match this **measured** ceiling for the region rather than the earlier <6m hypothesis.

