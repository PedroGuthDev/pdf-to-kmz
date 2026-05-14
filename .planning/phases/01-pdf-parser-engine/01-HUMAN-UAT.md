---
status: partial
phase: 01-pdf-parser-engine
source: [01-VERIFICATION.md]
started: 2026-05-13T00:00:00Z
updated: 2026-05-13T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Walking Skeleton console run on real INFOVIAS PDF

expected: |
  Open test/skeleton-test.html in Chrome or Firefox.
  Select INFOVIAS_PJC INTERNET_Palhoça_RUA VALMOR FRANCISCO_v1.pdf.
  Open DevTools (F12) → Console. Confirm all of the following:
  a. 'pdf.js version:' shows 5.7.284
  b. 'All OCG layer names:' array has ≥4 entries including Numero_Poste, TEXTO, Distância_Poste, Cabo Projetado
  c. 'AC3 hasBeginMarked: true'
  d. 'AC4 TEXTO items:' array contains digit strings (all-page fallback — layer filter not possible due to OCMD)
  e. 'AC5 Numero_Poste constructPath count:' shows 11
  f. 'A1 first Numero_Poste constructPath ops:' logs non-null Float32Array bounding box [-35.5, -35.5, 35.5, 35.5]
  g. 'A2 distance layer name:' shows 'Distância_Poste' (non-empty accented form)
result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
