---
status: investigating
trigger: DWG graph-walk capped at 12 posts; no-connection at 24; posts 13+ pdf-fallback
created: 2026-05-28
updated: 2026-05-28
harness: debug-run-calc-dwg-from-pdf-siriu.mjs
---

## Root cause (posts 13–24 cap) — FIXED

`calculateCoordinatesWithDwg` passed **PDF parse order** `posts` to `pairPostsByGraphWalk`, but `pdfResult.connections` are built for **numeric sort order** (`calculateCoordinates` returns `posts: sorted`).

Siriu parse order after post 12: `…, 12, 24, 23, 22, …, 13, 25, …`

Walker step `12→24` had **no connection** (`connections` only had `12→13`) → `dwg-graph-walk-fail` at post 24, partial coords stopped at 12.

**Fix:** `parser/dwg/coordinate-calculator-dwg.js` — use `pdfResult.posts` (route order) for the DWG cascade.

## Verification (PDF harness, after fix)

Partial DWG walk: **31 posts** (was 12), errors mostly &lt; 11 m for posts 1–27.

Still fails at **post 32** (`tolerance-exceeded`): walker at wrong INSERT chain from ~27→28 (`148→104` vs GT `149→150`).

## Next

- Page-5 / posts 27–32: wrong 1-hop at 27→28 (label 45.2 m); BFS shows no path within tol to GT #150 from current node.
- Consider non-consecutive hints or page-break gap handling on sheet 5.
