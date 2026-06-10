---
phase: 07-solver-prerequisites
fixed_at: 2026-06-08T00:00:00Z
review_path: .planning/phases/07-solver-prerequisites/07-REVIEW.md
iteration: 1
findings_in_scope: 8
fixed: 8
skipped: 0
status: all_fixed
---

# Phase 7: Code Review Fix Report

**Fixed at:** 2026-06-08
**Source review:** `.planning/phases/07-solver-prerequisites/07-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 8 (1 Critical + 7 Warning)
- Fixed: 8
- Skipped: 0

## Fixed Issues

### CR-01: `repairConsecutiveLabelArcJumps` can assign two posts to the same pole symbol

**Files modified:** `parser/post-positioning.js`
**Commit:** `8c4f0fe`
**Applied fix:** Moved `const prevSi = assignment[i + 1].si;` before the nearest-symbol loop so it is available for the guard. Added `if (si !== prevSi && usedSymbol.has(si)) continue;` inside the loop to skip already-claimed symbols. Added a post-loop guard `if (bestSi !== prevSi && usedSymbol.has(bestSi)) continue;` to only commit the move when `bestSi` is genuinely free or equals the post's own prior `si`. This mirrors the `siSeen` conflict guard used for the Viterbi result.

> **REVERTED (2026-06-10, phase 05 UAT gap fix):** The guard regressed the Siriu
> per-post position lock — 16 posts moved (max 379 pt) — and broke the Siriu DWG
> cascade (pdf-fallback at posts 3/24), which in turn made `run-residual-gate.mjs`
> exit 1 (05-UAT tests 4/6). Bisected to `8c4f0fe` via the Siriu position gate.
> The "steal" the guard prevented is load-bearing: the label-implied arc target may
> legitimately land on a symbol another post holds, and the dedicated
> `restoreSharedSymbolCollapsedPosts` pass (07-06-T2, `c98dc28`) is the designed
> resolution for the resulting shared-symbol pair. The duplicate-assignment risk
> CR-01 identified is real but already mitigated downstream; the guard traded a
> hypothetical corruption for a measured 16-post regression. A code comment at the
> loop now documents why the steal must stay.

---

### WR-01: `post-positioning.test.mjs` not wired into any npm script

**Files modified:** `package.json`
**Commit:** `3500046`
**Applied fix:** Prepended `node parser/__tests__/post-positioning.test.mjs &&` to the `test:gate:fixtures` script. The test uses a custom `assert`/`process.exit` harness (not `node:test`) so it cannot be added to the `--test` runner chain, but runs correctly with plain `node` and fails non-zero on assertion failures.

---

### WR-03: `parseTxtLines` silently drops integer-degree coordinates

**Files modified:** `tools/import-ground-truth-txt.mjs`
**Commit:** `3a77c73`
**Applied fix:** Changed regex from `(-?\d+\.\d+)` to `(-?\d+(?:\.\d+)?)` for both lat and lon, allowing integer-degree coordinates. Added a post-parse count check in `importRoute`: counts non-blank `Poste`-prefixed lines in the source text and emits a `console.warn` when `parsed.length < posteLineCount`, making dropped lines visible.

---

### WR-04: Outlier median uses component-wise lat/lon median (documentation fix)

**Files modified:** `tools/import-ground-truth-txt.mjs`
**Commit:** `34331ac`
**Applied fix:** Added a 4-line comment above the `medianLat`/`medianLon` computation in `excludeOutliers` documenting that the center is a component-wise median (not a geometric medoid), explaining the implication for curved/L-shaped routes, and recommending that `--outlier-km` stays coarse (default 2.0 km). No algorithmic change.

---

### WR-05: Gate runners trust env-var overrides without validation (NaN gate bypass)

**Files modified:** `tools/run-joaoborn-post-position-gate.mjs`, `tools/run-valmor-post-position-gate.mjs`
**Commit:** `687129a`
**Applied fix:** In both `compare()` functions: extracted `Number(process.env.*_TOL_PT)` into a `_jbRaw`/`_valRaw` variable, then guarded with `Number.isFinite(raw) && raw > 0` before accepting the override — falling back to `truthDoc._meta?.tolerancePt ?? DEFAULT_TOL_PT` for invalid values. Added a `console.warn` when the env-var is present but invalid, so mis-typed overrides are visible rather than silently bypassing the gate via NaN comparisons.

---

### WR-06: `runRouteDwgAccuracyHarness` mutates shared `process.env` across concurrent gate runs

**Files modified:** `tools/route-dwg-accuracy-harness.mjs`, `parser/dwg/graph-walker.js`
**Commit:** `e84798c`
**Applied fix:**
- `graph-walker.js`: Added `returnIdx = false` to the `pairPostsByGraphWalk` parameter destructuring. At function entry, computed `const _returnIdx = returnIdx || envFlag('GW_RETURN_IDX');` and replaced all 10 internal `envFlag("GW_RETURN_IDX")` call sites with `_returnIdx`. The env-var path is preserved for backward compatibility.
- `route-dwg-accuracy-harness.mjs`: Removed the `process.env.GW_RETURN_IDX` save/restore dance from `runWalk`. Simplified to a direct `return pairPostsByGraphWalk({..., returnIdx: true})`.

---

### WR-07: `assignPolesGloballyByLabels` mutates input post `.number` during mirroring

**Files modified:** `parser/post-positioning.js`
**Commit:** `71ff20c`
**Applied fix:** Added `if (p._originalNumber == null) p._originalNumber = p.number;` immediately before the `p.number = minN + maxN - p.number;` mutation in the mirroring loop. This snapshots the original post number before mutation so it is auditable and reversible by callers. The `_originalNumber` field is only written on first mirror (idempotency guard via `== null`).

---

### WR-02: Junction-fixture meters all `0.0` (documentation fix)

**Files modified:** `parser/__tests__/fixtures/luizcarolino-junction-ground-truth.json`, `parser/__tests__/fixtures/joaoborn-junction-ground-truth.json`, `parser/__tests__/fixtures/valmor-junction-ground-truth.json`
**Commit:** `b239178`
**Applied fix:** Added `"_metersNote": "arm meters not yet surveyed — assertions are vacuous 0===0 (WR-02: real meter values need field measurement to make distance assertions non-trivial)"` to each fixture. No meter values fabricated. The gap between what the fixture asserts and what it actually validates is now explicitly documented in the fixture itself.

---

_Fixed: 2026-06-08_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
