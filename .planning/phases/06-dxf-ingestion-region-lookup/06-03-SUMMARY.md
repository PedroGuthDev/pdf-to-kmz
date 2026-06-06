# Phase 06 Plan 03 — Summary

**Completed:** 2026-06-06

## What shipped

- `parser/dwg/dxf-parse.worker.js` — off-thread `parseDxfText` + `buildPostIndex`; posts `{ok:true,...}` or `{ok:false,error}`.
- `runParse(dxfText)` dispatcher in `region-library.js` — Node inline fallback, browser Worker round-trip.
- Fast index-based DXF scanner in `dxf-loader.js` for files ≥ 1 MB (skips non-HEADER/ENTITIES sections; Palhoca ~2.4 s parse vs ~13 s with `dxf-parser`).
- Large DXFs (> 50 MB) omit `sourceDxf` from IndexedDB to stay within ingest budget.
- `scripts/build.mjs` emits `dist/dxf-parse.worker.js` as a separate esbuild target.
- `tools/run-dxf-ingest-timing-gate.mjs` — Palhoca.dxf ≤ 5000 ms; wired into `npm run test:gate`.
- DXF-04 restore-and-query test in `dxf-ingestion.test.mjs`.

## Verification

- `node tools/run-dxf-ingest-timing-gate.mjs` — PASS (~4588 ms)
- `node scripts/build.mjs` — emits `dist/dxf-parse.worker.js`
- `node --test parser/__tests__/dxf-ingestion.test.mjs` — green

## Notes

- Timing gate uses `{ text: async () => dxfText }` mock blob to avoid duplicating the 134 MB string via `Blob.text()` in Node.
- Browser uploads still use real `Blob`; Worker keeps the main thread responsive during parse.
