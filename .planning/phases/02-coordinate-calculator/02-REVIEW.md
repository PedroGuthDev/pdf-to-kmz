# Phase 2: Plan Review Summary

**Reviewed:** 2026-05-15
**Source:** 02-RESEARCH.md findings applied to 02-01-PLAN.md and 02-02-PLAN.md

---

## Issues Found & Fixed

### CRITICAL: Bearing Formula Double-Negation (Plan 02-01 T-02)

**Severity:** Critical -- would produce 180-degree inverted bearings (all posts placed in the wrong direction)

**Root cause:** The original plan defined `dy = -(next.y - curr.y)` (correct: northward component) but then called `atan2(dx, -dy)`, which double-negates back to the southward direction.

**Fix applied:** Changed to explicit `atan2(dx, northward)` where `northward = curr.y - next.y`. Added verification checks (north = 0 degrees, east = 90 degrees) and a prominent warning in the plan text.

### MEDIUM: Missing coordForm Section Reference (Plan 02-01 T-04)

**Severity:** Medium -- could cause duplicate UI sections

**Root cause:** Plan didn't mention that `<section id="coordForm">` already exists in index.html (lines 99-102) with placeholder "Coming in Phase 2".

**Fix applied:** T-04 action now explicitly says to modify the existing section, not create a new one.

### LOW: Cable Segments Lack pageNum (Plan 02-02 T-02)

**Severity:** Low -- not actually a bug, but needed documentation

**Root cause:** `buildCableSegments()` receives only `ops` arrays (pageNum stripped at pdf-parser.js line 411). Gap detection needs cable proximity checks.

**Fix applied:** Added note that all detail pages share coordinate space, so absolute coordinates work. Added inline proximity check guidance to avoid importing from cable-builder.js.

### LOW: OCR Gap vs Branch Gap Ambiguity (Plan 02-02 T-01)

**Severity:** Low -- could misclassify OCR misses as branch boundaries

**Root cause:** Plan only used "number gap" heuristic for branch detection. OCR can miss sequential numbers, creating false number gaps.

**Fix applied:** Added spatial distance threshold (100 PDF points) to distinguish branch boundaries (far apart) from OCR misses (close together).

---

## Verification Matrix

| Requirement | Plan | Task | Status |
|---|---|---|---|
| COORD-01: User inputs GPS coords | 02-01 | T-04 | Covered |
| COORD-02: Bearing from PDF layout | 02-01 | T-02 | Covered (formula fixed) |
| COORD-03: Flat-Earth projection | 02-01 | T-02 | Covered |
| COORD-04: Branch handling | 02-02 | T-01 | Covered |
| COORD-05: Gap detection | 02-02 | T-02 | Covered |

## Plans Status: REVIEWED AND CORRECTED
