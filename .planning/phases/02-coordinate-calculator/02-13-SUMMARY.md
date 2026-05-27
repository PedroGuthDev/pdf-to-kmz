---
phase: 02-coordinate-calculator
plan: "13"
subsystem: ui-integration
tags: [dwg, ui, dxf, indexeddb]
status: complete
dependency_graph:
  requires:
    - "02-10"
  provides:
    - index.html (DXF upload + calculateCoordinatesWithDwg wiring)
tech_stack:
  added: []
key_files:
  modified:
    - index.html
metrics:
  last_updated: "2026-05-27"
  commits:
    - "89da6ff feat(02-13): add DXF region upload and DWG calculation wiring"
---

# Phase 2 Plan 13: Wire DWG path into UI — Summary

**One-liner:** Updated `index.html` to support a minimal “Biblioteca de regiões DXF” upload flow (persisted in IndexedDB) and switched both calculation call sites to `calculateCoordinatesWithDwg` (async) with transparent fallback.

## What Changed

- **Imports / init**
  - Imports `calculateCoordinatesWithDwg` and `createRegionLibrary`
  - Initializes a singleton `regionLibrary` at module load (IndexedDB-backed)

- **UI**
  - Adds a compact “Biblioteca de regiões DXF” panel under the GPS input:
    - region name field (`#dxfRegionName`)
    - hidden file input (`#dxfFileInput`)
    - upload button (`#dxfUploadBtn`)
    - status text (`#dxfUploadStatus`)
  - Binary DWG detection via file header (`AC1*`) with a pt-BR error message.

- **Calculation wiring**
  - Main calculate button: `calculateCoordinates` → `await calculateCoordinatesWithDwg(..., regionLibrary)`
  - Reference compare block: same replacement for the second call site
  - When no DXF is loaded (or pairing fails), behavior falls back to the existing PDF pipeline unchanged.

## Validation

- `node parser/__tests__/region-pairing.test.mjs`: PASS
- `node parser/__tests__/coordinate-calculator.test.mjs`: PASS (22/22)

