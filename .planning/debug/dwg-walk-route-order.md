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

## Post 28 fix (2026-05-28)

**Cause:** At 26→27 the label 26.9 m is the chord 147→#149, but a 1-hop to #148 (24.1 m, Δ≈2.8 m) was taken instead of continuing to #149 (cable via #148, better 27→28 lookahead).

**Fix in `graph-walker.js`:** `findMultiHopByLabel` accepts `nextLabelM` and scores candidates by next-segment fit; when multi-hop extends through the direct neighbor (`intermediates` includes `directBestIdx`) and next-span delta is >1 m better, use the longer chain.

**Result:** Post 28 err **2.79 m** (was ~86 m). Partial walk **49 posts** (was 31).

## Next

- Posts 38+ on page 6+ (new failure region).
- Posts 16–17 still ~8–10 m / 41–87 m (separate).
