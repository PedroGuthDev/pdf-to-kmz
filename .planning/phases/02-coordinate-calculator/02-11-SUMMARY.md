---
phase: 02-coordinate-calculator
plan: "11"
subsystem: dwg-tests
tags: [dwg, tests, fixtures, rbush, pairing]
status: complete
dependency_graph:
  requires:
    - "02-08"
    - "02-09"
  provides:
    - parser/__tests__/region-pairing.test.mjs
tech_stack:
  added: []
key_files:
  created:
    - parser/__tests__/region-pairing.test.mjs
metrics:
  last_updated: "2026-05-27"
  commits:
    - "17871d3 test(02-11): add DWG region pairing suite"
---

# Phase 2 Plan 11: DWG pairing unit tests — Summary

**One-liner:** Added a Node test suite for the DWG path that validates Siriu fixtures, rbush indexing, adjacency graph behavior, anchor pairing, failure on out-of-tolerance anchors, collision detection, and a minimal 2-post walk.

## What Was Built

- `parser/__tests__/region-pairing.test.mjs` (node:test)
  - Fixture assertions:
    - Siriu UTM coordinate ranges
    - block names follow `pod_*` and include `pod_con_dtt`
    - cable endpoint snap ratio sanity check (subset-based)
  - Algorithm assertions:
    - rbush search finds the nearest post to GT post-01 GPS within 5m
    - adjacency graph has at least one neighbour for the anchor post
    - anchor-only pairing returns coordinates within 5m of ground truth
    - anchor failure when GPS is ~20m away
    - collision detection when two posts would claim the same INSERT
    - 2-post walk pairs posts 1–2 within 8m of ground truth

## Validation

- `node parser/__tests__/region-pairing.test.mjs`: **PASS** (9 tests)
- `node parser/__tests__/coordinate-calculator.test.mjs`: **PASS** (22/22)

