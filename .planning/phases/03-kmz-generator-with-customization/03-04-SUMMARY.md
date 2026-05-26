# Phase 3: KMZ Generator — Plan 03-04 Summary

## Completed Tasks

- **T-03-04-01:** Download block in `#resultSection` — `#downloadKmzBtn`, `#downloadKmzHint`, `#kmzStats` per UI-SPEC.
- **T-03-04-02:** Wired `lastCalcResult` after Calculate Route; download handler calls `buildKml` → `packageKmz`, stats panel, `[kmz]` warnings, object URL revoke on re-calc.
- **T-03-04-03:** Google Earth manual verification — **PENDING** (requires human: upload João Born PDF, calc, download, open in Earth).

## Automated Checks

- KMZ smoke archive validates (`route-smoke.kmz` has `doc.kml`, valid KML 2.2 namespace).
- UI copy matches UI-SPEC: **Download KMZ**, disabled hint, **Building KMZ…**, success message.

## Manual QA (KMZ-05)

| Check | Status |
|-------|--------|
| `route.kmz` opens in Google Earth without error | PENDING |
| ≥11 placemarks on João Born fixture | PENDING |
| Route lines match expected branches (spot-check 3 edges) | PENDING |
| `placemark_square.png` icon acceptable | PENDING — default href in `kmz-defaults.js` |

Run: open `index.html` → upload PDF → Calculate Route → Download KMZ → open in Google Earth Pro.

## Key Files

- `index.html`
