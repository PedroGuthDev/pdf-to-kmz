---
status: diagnosed
phase: 06-dxf-ingestion-region-lookup
source: 06-01-SUMMARY.md, 06-02-SUMMARY.md, 06-03-SUMMARY.md
started: 2026-06-09T12:00:00Z
updated: 2026-06-09T12:25:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Region List with GPS Bounding Boxes

expected: Region dropdown shows each ingested region name plus GPS bbox lat/lon ranges formatted to 4 decimal places
result: pass

### 2. Valid DXF Upload Success

expected: Upload a known-good SC DXF (e.g. Siriu). Status shows success ("Região ... carregada"). The new region appears in the dropdown with its GPS bounding box. No coordinate drift from prior ingest.
result: pass

### 3. DXF Unit Mismatch Loud Error

expected: Upload parser/**tests**/fixtures/mm-scale.dxf (or any out-of-envelope DXF). Upload status shows an error containing "DXF unit mismatch suspected". The bad DXF is NOT added to the region library.
result: pass

### 4. No-Region GPS Fallback

expected: With at least one SC region ingested, process a PDF whose post-1 GPS is far outside all region bboxes (e.g. São Paulo: -23.55, -46.63). Calculation falls back to PDF-only (dwgStatus pdf-fallback in debug). Warning states no region covers the GPS. No DXF region is silently matched.
result: issue
reported: "actually, i tested it, i uploaded a dxf file without siriu region, then used the siriu pdf, the system runs, but the dxf does not include that pdf. There is also no warning about this"
severity: major

### 5. Large DXF Non-Blocking Upload

expected: Upload a large DXF (Palhoça ~134 MB if available, or any multi-MB file). The browser UI stays responsive during processing (no tab freeze). Upload completes with a success message within a reasonable time.
result: pass

## Summary

total: 5
passed: 4
issues: 1
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "Calculation falls back to PDF-only (dwgStatus pdf-fallback in debug). Warning states no region covers the GPS. No DXF region is silently matched."
  status: failed
  reason: "User reported: actually, i tested it, i uploaded a dxf file without siriu region, then used the siriu pdf, the system runs, but the dxf does not include that pdf. There is also no warning about this"
  severity: major
  test: 4
  root_cause: "dwgNoRegion and dwg-region-miss signals are emitted by the calculator but only dwg-region-miss is appended to #warningsList inside hidden #debugSection; main #calcNotices shows generic PDF-only text at best and does not state no region covers GPS or nearest-region hint"
  artifacts:
    - path: "browser/main.js"
      issue: "calc warnings appended to hidden dev-tools #warningsList; dwgNoRegion not rendered in main UI"
    - path: "index.html"
      issue: "#warnings inside #debugSection (display:none by default)"
    - path: "parser/dwg/coordinate-calculator-dwg.js"
      issue: "backend emits dwgNoRegion correctly; UI layer does not consume it"
  missing:
    - "Surface dwgNoRegion in calcNotices with nearest region name + distanceKm (Portuguese)"
    - "Promote dwg-region-miss warnings to main workflow, not only dev tools"
  debug_session: ".planning/debug/no-region-warning-missing.md"
  resolution: |
    Fixed 2026-06-10. buildCalcUserWarnings (parser/dwg/coordinate-calculator-dwg.js)
    now prepends an explicit Portuguese notice on the no-region miss path:
    "Nenhuma região DXF carregada cobre o GPS do poste 1 — o cálculo usou apenas o
    PDF. Região mais próxima: <name> (<km> km). Carregue o DXF da região correta e
    calcule novamente." This flows into #calcNotices via result.userWarnings (main
    workflow, not dev tools). Phase 09's confidence banner additionally hard-blocks
    KMZ download with the same nearest-region hint (hardBlock=true on miss).
    Regression test: "phase-06 UAT-4" in coordinate-calculator-dwg-no-region.test.mjs.
    Needs user re-test to confirm visually.
