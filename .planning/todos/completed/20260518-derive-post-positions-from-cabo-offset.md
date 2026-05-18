---
created: 2026-05-18T12:00:00Z
completed: 2026-05-18T18:00:00Z
title: Derive post positions from Cabo Projetado offset
area: general
status: completed
resolution: Superseded — Poste-layer symbol matching with label + cable arc met <5 m UAT without inverting cable offset.
files:
  - parser/post-positioning.js
  - parser/pdf-parser.js
  - parser/cable-builder.js
  - .planning/phases/02-coordinate-calculator/02-VERIFICATION.md
---

## Problem

Cabo Projetado may be a parallel offset from center-to-center pole path; vertices might not be pole centers.

## Outcome

Implemented **Poste symbol centroids** as canonical `(x,y)` with label proximity + Cabo Projetado arc matching instead of cable-offset inversion. Palhoça verification: **11/11 posts < 5 m**, max **4.19 m**. See `02-VERIFICATION.md`.
