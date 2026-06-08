---
phase: 07-solver-prerequisites
plan: 05
status: complete
completed: "2026-06-08"
commits:
  - 6296d49  # feat(07-05-T1): accuracy-tiers + Siriu/LC txt-accuracy gates
  - 75120c1  # feat(07-05-T2): JB/Valmor gates + harness distanceLabelItems/cablePaths
---

# 07-05 Summary — Per-Route txt GPS Accuracy Gates (Wave 2)

## What Was Done

Implemented per-route txt GPS accuracy gates for all four named routes using a shared
four-tier classifier (perfect ≤5 m / good ≤10 m / acceptable ≤15 m / bad >15 m).

### Task 1 — Shared tier classifier + Siriu & LC gates

- **`tools/lib/accuracy-tiers.mjs`** — exports `tierOf`, `histogram`, `badPosts`,
  `formatHistogramLine` (D-03 four-tier vocabulary).
- **`tools/lib/txt-accuracy-gate-runner.mjs`** — shared runner that wraps
  `runRouteDwgAccuracyHarness`, prints histogram, and supports a `softFence` option.
  When `softFence: true`, bad-tier posts are listed to stderr with a
  `[SOFT FENCE — deferred to Phase 8]` header but the process always exits 0.
- **`tools/run-siriu-txt-accuracy-gate.mjs`** — hard zero-bad-tier gate (Siriu: 0 bad).
- **`tools/run-lc-txt-accuracy-gate.mjs`** — soft-fence gate; posts 21–31 excluded via
  `EXCLUDED_POSTS` (mirrors `_meta.scope`); remaining 13 bad-tier posts reported but
  exit 0.

### Task 2 — João Born & Valmor gates + harness fix

- **`tools/run-joaoborn-txt-accuracy-gate.mjs`** — soft-fence gate; 34 posts (post 35
  excluded in 07-01); 29 bad-tier posts reported but exit 0.
- **`tools/run-valmor-txt-accuracy-gate.mjs`** — hard zero-bad-tier gate (Valmor: 0 bad,
  all 11 posts at perfect tier).
- **`tools/route-dwg-accuracy-harness.mjs`** — forwarded `distanceLabelItems` and
  `cablePaths` from parsed PDF topology into the cascade caller so label-lsq and
  cable-arc-placer have complete inputs across all routes.

## Scoping Decision (Option A — Soft Fence)

Per Wave 2 scoping decision:

| Route | Gate type | Bad posts | Exit |
|-------|-----------|-----------|------|
| Siriu | Hard (zero-bad-tier) | 0 | 0 |
| Valmor | Hard (zero-bad-tier) | 0 | 0 |
| LC | Soft fence (deferred Phase 8) | 13 (posts 1–20 block + 21–31 excluded) | 0 |
| João Born | Soft fence (deferred Phase 8) | 29 | 0 |

LC and JB accuracy improvements are deferred to the Phase 8 global solver.
No exclusion lists were added to JB; the full histogram is always printed.

## Verification

```
node tools/run-siriu-txt-accuracy-gate.mjs    → EXIT 0 (PASS — 0 bad)
node tools/run-lc-txt-accuracy-gate.mjs       → EXIT 0 (SOFT-FENCE PASS — 13 bad deferred)
node tools/run-joaoborn-txt-accuracy-gate.mjs → EXIT 0 (SOFT-FENCE PASS — 29 bad deferred)
node tools/run-valmor-txt-accuracy-gate.mjs   → EXIT 0 (PASS — 0 bad)
```

## Must-Have Checklist

- [x] `tools/lib/accuracy-tiers.mjs` exports `tierOf`/`histogram`/`badPosts`
- [x] All four gates run the cascade, print tier histograms
- [x] Siriu and Valmor: hard zero-bad-tier floor (already green — no change needed)
- [x] LC and JB: soft fence — full histogram + bad-post list to stderr, exit 0
- [x] LC posts 21–31 excluded from exit rule via `EXCLUDED_POSTS` (mirrors `_meta.scope`)
- [x] No wide exclusion lists added to JB — report-only mode via `softFence: true`
- [x] Task 1 commit boundary respected (accuracy-tiers, runner, Siriu, LC)
- [x] Task 2 commit boundary respected (JB, Valmor, harness)
