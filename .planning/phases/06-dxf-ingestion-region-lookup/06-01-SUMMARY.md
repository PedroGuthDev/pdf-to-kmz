# Phase 06 Plan 01 — Summary

**Completed:** 2026-06-06

## What shipped

- Golden bbox baseline captured in `parser/__tests__/fixtures/siriu-bbox-golden.json` before validation edits.
- `addRegion()` hardened with zone-22S envelope check, mm÷1000 retry (`confidence: low`), Brazil-bbox corner validation, and absent/zero-extents `confidence: inferred` branch (D-08).
- `crs.confidence` field on all ingested regions (`high` / `low` / `inferred`).
- Test suite `parser/__tests__/dxf-ingestion.test.mjs` with fixtures `mm-scale.dxf` and `no-extents.dxf`.

## Key exports

- `ZONE_22S`, `inZone22S`, `inBrazil`, `validateBrazilExtents` from `region-library.js`.

## Verification

- `node --test parser/__tests__/dxf-ingestion.test.mjs` — green
- Siriu `bboxLatLon` deep-equals golden fixture (zero drift)

## Notes

- Brazil-bbox throw is tested via `validateBrazilExtents` with synthetic out-of-envelope UTM corners; all zone-22S envelope corners map inside Brazil when converted with zone 22.
- `confidence: low` path is implemented but no corpus file triggers it.
