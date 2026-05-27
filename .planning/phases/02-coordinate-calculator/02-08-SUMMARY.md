---
phase: 02-coordinate-calculator
plan: "08"
subsystem: dwg-foundation
tags: [dwg, dxf, indexeddb, rbush, fixtures, tooling]
status: complete
dependency_graph:
  requires: []
  provides:
    - package.json (DWG deps)
    - tools/build-siriu-test-fixture.mjs (fixture generator)
    - parser/__tests__/fixtures/siriu-ground-truth.json (Siriu GT)
    - parser/__tests__/fixtures/siriu-subset.json (Siriu DXF subset)
tech_stack:
  added:
    - dxf-parser@1.1.2
    - idb@8.0.3
    - rbush@4.0.1
    - fake-indexeddb@6.2.5 (dev)
key_files:
  created:
    - tools/build-siriu-test-fixture.mjs
    - parser/__tests__/fixtures/siriu-ground-truth.json
    - parser/__tests__/fixtures/siriu-subset.json
  modified:
    - package.json
    - package-lock.json
metrics:
  last_updated: "2026-05-27"
  commits:
    - "913fe28 chore(02-08): add DWG deps and Siriu fixtures"
---

# Phase 2 Plan 08: DWG deps + Siriu fixtures — Summary

**One-liner:** Installed the DWG iteration dependencies and added deterministic Siriu fixtures + a one-shot generator script to support unit tests and the DWG validation harness.

## What Was Built

- **Dependencies added** (per 02-RESEARCH package audit):
  - `dxf-parser@1.1.2`, `idb@8.0.3`, `rbush@4.0.1` (production deps)
  - `fake-indexeddb@6.2.5` (devDep for Node tests/harness)
- **Deterministic fixtures** in `parser/__tests__/fixtures/`:
  - `siriu-ground-truth.json`: 85 entries `{ number, lat, lon }` parsed from `coordenadas postes siriu.txt`
  - `siriu-subset.json`: `{ posts, cableEdges }` extracted from `siriu.dxf` inside a padded bbox around posts 1–30
- **Repeatable generator** `tools/build-siriu-test-fixture.mjs`:
  - Rebuilds both fixtures from project-root `coordenadas postes siriu.txt` + `siriu.dxf`

## Validation

- `node parser/__tests__/coordinate-calculator.test.mjs`: **PASS** (22/22)
- `node debug-run-calc.mjs` (Valmor G-1 non-regression): **PASS** (unchanged)
- `node tools/build-siriu-test-fixture.mjs`: **PASS**
  - Ground truth: 85 posts
  - Subset: 196 posts, 215 cable edges (within bbox of posts 1–30)

## Notes / Decisions

- Fixture extraction treats DXF entity coordinates as **raw UTM meters** (no scaling).
- Fixture extraction intentionally ignores DXF header `$LATITUDE/$LONGITUDE` (AutoCAD defaults; not a georef).

