---
created: 2026-05-18T12:00:00Z
title: Derive post positions from Cabo Projetado offset
area: general
files:
  - parser/coordinate-calculator.js:283-414
  - parser/graphics-extractor.js:74
  - parser/cable-builder.js
  - .planning/phases/02-coordinate-calculator/02-CONTEXT.md:20-26
---

## Problem

On INFOVIAS PDFs, the red **Cabo Projetado** polyline is not drawn through post symbol centers. CAD workflow appears to be: connect post centers center-to-center, then apply a **uniform parallel offset** to produce the visible cable geometry. The current accuracy fix (D-ACC-01) treats polyline **vertices as canonical post (x,y)**, which may still be wrong if vertices lie on the offset cable rather than on pole centers — visible in sample maps where the red line runs beside double-circle / square-X post symbols with a consistent perpendicular gap.

User hypothesis: post positions can be recovered **from the cable geometry** by inverting that offset (or by relating vertices to nearby Poste symbols), instead of assuming vertex = pole.

## Solution

TBD — research spike before implementation:

1. **Validate offset model** on Palhoça sample: measure perpendicular distance from cable segments/vertices to nearest Poste symbol centers; check constancy across spans and at elbows.
2. **Estimate offset vector** per page (or per segment): e.g. median normal from cable to OCR/Poste hints; compare to treating vertices as poles (current `snapPostsToPolyline`).
3. **Recover centerline**: offset polyline by −d along inward normal (or reconstruct center-to-center path from vertex graph), then snap posts to that centerline with existing one-to-one greedy matching (D-ACC-03).
4. **Fallback chain**: offset-corrected centerline → vertex snap → segment snap → OCR centroid (align with D-ACC-02 warnings).
5. Document whether offset magnitude/sign is stable per PDF template or must be inferred per drawing.

Related: D-ACC-01 assumed vertices = poles; this todo explores the CAD-offset alternative if accuracy remains >5 m after vertex snap.
