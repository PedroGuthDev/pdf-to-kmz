# Phase 7 Baseline Cascade — Pre-Solver Measurement Record (SC-4)

**Captured:** 2026-06-08 (Plan 07-07, Task 3)
**Environment:** Node v22.x; full DWG pairing cascade via `tools/route-dwg-accuracy-harness.mjs`
(`parsePdf → calculateCoordinates → DWG graph-walk → residual gate`), measured against the
four canonical `.txt` GPS ground-truth files (D-01). Run under the extended `npm run test:gate`.

> **NO SOLVER CODE IS PRESENT.** There is **no `munkres-js` dependency** (verified: absent from
> `package.json` dependencies *and* devDependencies) and **no Hungarian / level-0 solver source**
> in `parser/` or `tools/`. The global PDF↔DXF solver is Phase 8 only. This document is the stable
> **pre-solver** baseline that Phase 8 will be measured against (ROADMAP SC-4). The Phase 5
> truth-free residual gate (`tools/run-residual-gate.mjs`) is **active** for every route below.

---

## 1. Per-route cascade results

Tier thresholds (D-03): **perfect ≤5 m · good ≤10 m · acceptable ≤15 m · bad >15 m.**
"Residual decision" is the Phase 5 truth-free gate verdict (pass / fail / fallback).

### Siriu (85 posts) — characterization-locked reference route

| Metric | Value |
|--------|-------|
| Posts measured | 85 / 85 |
| Tier histogram | **perfect 65 · good 17 · acceptable 3 · bad 0** |
| txt-accuracy gate | **PASS** (zero bad-tier) |
| DWG walk | `dwgStatus=dwg-graph-walk, walkOk=true, coords=85` |
| Position gate (1.0 pt) | PASS — max **0.00 pt** (byte-identical lock) |
| Residual decision | `decision=fail` · shapeMedian=0.0038 · anchorP95=**188.0 m** |

Siriu is the strangler-fig reference: zero bad-tier via the cascade; the residual gate's
`decision=fail` reflects the absolute DWG-anchor gap (hundreds of metres), which is expected
pre-solver (anchor authority is the Phase 8 solver's job).

### Luiz Carolino (31 posts) — known pre-solver baseline (21–31 deferred)

| Metric | Value |
|--------|-------|
| Posts measured | 31 / 31 |
| Tier histogram | **perfect 14 · good 0 · acceptable 0 · bad 17** |
| Position gate (posts 1–20) | PASS — 20/20, mean 0.4 pt (07-06 layer-B fix) |
| txt-accuracy gate | **SOFT-FENCE PASS** — 13 bad-tier reported; posts 21–31 scoped out of exit rule |
| Worst bad-tier posts | post 17 = **403.9 m**, post 16 = 377.9 m, post 20 = 357.5 m |
| Residual decision | `decision=fail` · shapeMedian=0.2276 · anchorP95=**332.5 m** |
| `lc-mustfail(21-31)` | `decision=fail` · anchorP95=301.0 m (`anchorCausesFail=true`, `shapeAloneFails=false`) |

**Known pre-solver baseline (07-06 *layerb-only* decision):** LC posts 13–20 (spur) and 21–31
(~179 m rigid absolute-position offset) remain bad-tier. The layer-B collapse (posts 9/10/11) was
fixed in 07-06; the remaining LC error is an **absolute-position / solver** problem, explicitly a
Phase 8 target. The Phase 5 residual gate keeps `lc-mustfail(21-31)` locked as a must-fail fixture
(`anchorCausesFail=true`) — the solver is expected to flip this fail→pass.

### João Born (34 posts) — linear route, cumulative baseline

| Metric | Value |
|--------|-------|
| Posts measured | 34 / 34 |
| Tier histogram | **perfect 3 · good 0 · acceptable 2 · bad 29** |
| Position gate | PASS — 34/34, mean 0.4 pt |
| txt-accuracy gate | **SOFT-FENCE PASS** — 29 bad-tier reported, deferred to Phase 8 |
| PDF accuracy gate | PASS — matched=34, mean **27.01 m**, max **45.84 m** |
| Worst bad-tier posts | post 13 = **612.0 m**, post 9 = 603.3 m, post 6 = 595.9 m |
| Residual decision | `decision=fail` · shapeMedian=0.0525 · anchorP95=**586.7 m** |

João Born's cumulative accuracy (mean 27 m) is the pre-solver baseline. The large bad-tier count
reflects the absolute DWG-anchor gap with no solver to reconcile PDF↔DXF — exactly the Phase 8
job. Junction GT is locked **linear** (D-14, zero junctions).

### Valmor (11 posts) — DWG-clean route, near-perfect baseline

| Metric | Value |
|--------|-------|
| Posts measured | 11 / 11 |
| Tier histogram | **perfect 11 · good 0 · acceptable 0 · bad 0** |
| Position gate | PASS — 11/11, mean 0.4 pt |
| txt-accuracy gate | **PASS** (zero bad-tier) |
| DWG accuracy gate | PASS — matched=11/11, mean **2.22 m**, max **4.38 m** |
| Residual decision | `decision=fallback` · shapeMedian=0.0018 · anchorP95=**16.6 m** |

Valmor is the cleanest route: all 11 posts perfect-tier via the cascade, residual gate returns
`fallback` (clean), mean 2.22 m. This is the high-water mark the solver must not regress.

---

## 2. Cascade summary table (all four routes)

| Route | Posts | perfect | good | acceptable | bad | txt gate | residual decision | anchorP95 |
|-------|-------|---------|------|------------|-----|----------|-------------------|-----------|
| **Siriu** | 85 | 65 | 17 | 3 | 0 | PASS | fail | 188.0 m |
| **Luiz Carolino** | 31 | 14 | 0 | 0 | 17 | SOFT-FENCE PASS | fail | 332.5 m |
| **João Born** | 34 | 3 | 0 | 2 | 29 | SOFT-FENCE PASS | fail | 586.7 m |
| **Valmor** | 11 | 11 | 0 | 0 | 0 | PASS | fallback | 16.6 m |

**Aggregate:** 161 posts measured across 4 routes. Siriu + Valmor are zero-bad-tier today; LC + JB
carry the documented pre-solver bad-tier load (LC 21–31 rigid offset + spur; JB absolute-anchor
gap). The Phase 5 residual gate is active and behaves as designed on every route (no route crashed
the gate; 5 decisions locked).

## 3. What Phase 8 changes (expected)

- The global PDF↔DXF solver (Hungarian level-0, `munkres-js@2.0.3`, added **only** in Phase 8)
  reconciles the absolute-position anchor gap that drives LC 21–31 and the JB bad-tier load.
- Expected to **flip soft fences**: `lc-mustfail(21-31)` fail→pass, JB/LC txt zero-bad-tier
  re-widened, JB PDF cumulative ceiling improved (see 07-GATE-AUDIT.md §3a re-baselining protocol).
- Must **not** regress hard red-lines: the four position gates, Siriu regression, junction oracles
  (07-GATE-AUDIT.md §3) must stay green at every solver checkpoint.

This baseline is the green-gate evidence (SC-4) authorizing Phase 8 to begin.
