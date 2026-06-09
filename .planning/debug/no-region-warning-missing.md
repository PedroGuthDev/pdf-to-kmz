# Debug: No-region / region-mismatch warning not visible

**Discovered:** Phase 06 UAT, Test 4
**Symptoms:** User uploaded a non-Siriu DXF, ran Siriu PDF. Calculation completes but DXF does not cover the route and no warning is shown.

## Investigation

### Expected path (lookup miss)
When `lookupByGps` returns null, `calculateCoordinatesWithDwg` returns:
- `dwgStatus: "pdf-fallback"`
- `warnings: [{ kind: "dwg-region-miss", lat, lon }]`
- `dwgNoRegion: { code: "NO_REGION", nearest: { name, distanceKm } }`
- `userWarnings: ["Precisão limitada: coordenadas calculadas só pelo PDF..."]`

Verified via Node simulation — backend emits all fields correctly.

### UI surfacing gap
1. **`dwg-region-miss` warnings** are appended to `#warningsList` inside `#warnings`, which lives in `#debugSection` (hidden until user clicks "Show developer tools"). Not visible in main workflow.
2. **`#calcNotices`** (main workflow) shows generic PDF-only precision text via `buildCalcUserWarnings`, but:
   - Does NOT mention that no region covers the GPS
   - Does NOT include `dwgNoRegion.nearest` distance hint (deferred to Phase 9)
3. **False-positive bbox match**: If the wrong DXF's `bboxLatLon` still contains post-1 GPS, `lookupByGps` matches that region. Cascade may run on geographically wrong data; no `dwg-region-miss` warning is emitted. User sees silent PDF-only or partial DWG behavior without an explicit "wrong region / no coverage" message.

### Cloud hybrid
`region-library-hybrid.js::lookupByGps` falls back to cloud Siriu when local miss — may mask local wrong-DXF scenario if cloud is configured.

## Root cause

**Phase 6 structured no-region signal (`dwgNoRegion`, `dwg-region-miss`) is not surfaced in the main user-facing UI.** Technical warnings are hidden in developer tools; `calcNotices` only shows a generic precision disclaimer and may not appear when the user perceives zero DXF contribution without checking the panel.

## Suggested fix direction

- In `browser/main.js`, after calculation, if `result.dwgNoRegion` is present, push an explicit user notice (Portuguese) into `calcNotices` with nearest region name + distance.
- Also surface `dwg-region-miss` from `result.warnings` into `calcNotices` (not only hidden dev panel).
- Consider warning when `dwgCount === 0` but a region was matched (bbox false positive).

## Files involved

- `browser/main.js` — calc result warning surfacing (`showCalcNotices`, warnings append to hidden `#debugSection`)
- `parser/dwg/coordinate-calculator-dwg.js` — emits `dwgNoRegion` and `userWarnings` (backend OK)
- `index.html` — `#calcNotices` in main flow vs `#warnings` in dev tools
