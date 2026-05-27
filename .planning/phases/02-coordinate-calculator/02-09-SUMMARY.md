---
phase: 02-coordinate-calculator
plan: "09"
subsystem: dwg-core
tags: [dwg, dxf, pairing, rbush, adjacency]
status: complete
dependency_graph:
  requires:
    - "02-08"
  provides:
    - parser/dwg/dxf-loader.js
    - parser/dwg/region-pairing.js
tech_stack:
  added: []
key_files:
  created:
    - parser/dwg/dxf-loader.js
    - parser/dwg/region-pairing.js
metrics:
  last_updated: "2026-05-27"
  commits: []
---

# Phase 2 Plan 09: DWG DXF loader + strict pairing — Summary

**One-liner:** Implemented the two DWG core modules: DXF entity extraction (`Poste` INSERTs + `TrechoSecundarioAereo` edges) and the strict anchor+walk pairing algorithm backed by an `rbush` spatial index and a cable-adjacency hint graph.

## What Was Built

- `parser/dwg/dxf-loader.js`
  - `parseDxfText(dxfText)` → `{ posts, cableEdges, extmin, extmax }`
  - Extracts:
    - **Posts**: `entity.type === "INSERT" && entity.layer === "Poste"` → `{ x, y, block }`
    - **Cable edges**: `entity.type === "LWPOLYLINE" && entity.layer === "TrechoSecundarioAereo"` → `{ a, b }` endpoints
  - Includes the two critical DXF traps in-module (no $INSUNITS scaling; ignore $LATITUDE/$LONGITUDE).

- `parser/dwg/region-pairing.js`
  - `buildPostIndex(posts)` (rbush point index)
  - `buildAdjacencyGraph(posts, cableEdges)` (snaps edge endpoints within 3m to posts, builds undirected adjacency)
  - `pairPostsAgainstRegion(...)` implements D-DWG-PAIR-02 (anchor + PDF-topology walk) with:
    - strict all-or-nothing pairing
    - gap tolerance widening (25m) on edges flagged `gap`
    - collision detection (two PDF posts claiming the same DWG INSERT) → `dwg-pair-collision`
    - structured failure warnings (`dwg-pair-fail`) + zone mismatch warning

## Validation

- `parseDxfText(siriu.dxf)` extracted: **483 posts**, **451 cable edges** (matches 02-RESEARCH measurements)
- `node parser/__tests__/coordinate-calculator.test.mjs`: **PASS** (22/22)

