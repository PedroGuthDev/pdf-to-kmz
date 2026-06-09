---
status: complete
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
  artifacts: []
  missing: []
