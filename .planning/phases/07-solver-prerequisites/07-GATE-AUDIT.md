# Phase 7 Gate Audit — Fence vs Accuracy Classification + Phase 8 Mid-Flight Policy

**Authored:** 2026-06-08 (Plan 07-07, Task 1)
**Authority:** D-16 (audit mandatory), D-18 (Phase 8 mid-flight policy), Pitfall 7 (compensated-error trap).
**Scope:** Every gate wired into `npm run test:gate` at Phase 7 exit (D-17). This document is the
contract the Phase 8 (global PDF↔DXF solver) planner reads to know which gates are **hard
red-lines** (must stay green at every solver checkpoint) and which are **soft fences** (may go
RED mid-flight if a correct solver fix removes a compensated error).

---

## 1. Two kinds of gate

| Kind | Definition | Mid-flight behaviour |
|------|------------|----------------------|
| **Regression FENCE** | Encodes the *current* output of the pipeline — including any compensated cross-layer error. A correct fix in one layer can make a fence go RED because a compensation it silently depended on is gone. | **Soft** during Phase 8 — a RED fence is investigated, not auto-blocked, IF the audit marks it soft. |
| **Accuracy ASSERTION** | Measures one layer *independently* against hand-known or surveyed truth. Immune to cross-layer masking — it cannot be greened by a compensating error elsewhere. | **Hard red-line** — must stay green; a RED here is a real regression. |

The Pitfall-7 rationale (§4) is *why* the per-post **position** gates — not the cumulative
accuracy ceilings — are the Phase 8 acceptance criterion.

---

## 2. Gate inventory — full classification

Every active gate in `npm run test:gate`. Columns: gate path · kind · what it measures · Phase 8
mid-flight policy.

### 2a. Per-post PDF position gates (layer B) — HARD RED-LINES

| Gate | Kind | Measures | Phase 8 policy |
|------|------|----------|----------------|
| `tools/run-siriu-post-position-gate.mjs` | Accuracy ASSERTION (characterization lock, tol **1.0 pt**) | Each of 85 Siriu posts' parsed `post.x/post.y` vs the locked snapshot. Currently max **0.00 pt** (byte-identical). | **HARD red-line.** Strangler-fig: solver output must stay byte-identical on Siriu. This is the only instrument that catches a Siriu layer-B regression hiding behind a cumulative ceiling (Pitfall 2). MUST stay green at every solver checkpoint. |
| `tools/run-lc-post-position-gate.mjs` | Accuracy ASSERTION (hand anchors, tol **50 pt**, posts 1–20) | Each LC post's parsed x/y vs hand-known correct pole anchor. Currently 20/20, mean **0.4 pt**. | **HARD red-line.** Greened in 07-06 via the additive `restoreSharedSymbolCollapsedPosts` predicate. MUST stay green. |
| `tools/run-joaoborn-post-position-gate.mjs` | Accuracy ASSERTION (hand anchors, tol **50 pt**, 34 posts) | Each JB post's parsed x/y vs hand-known anchor. Currently 34/34, mean **0.4 pt**. | **HARD red-line.** MUST stay green. |
| `tools/run-valmor-post-position-gate.mjs` | Accuracy ASSERTION (hand anchors, tol **50 pt**, 11 posts) | Each Valmor post's parsed x/y vs hand-known anchor. Currently 11/11, mean **0.4 pt**. | **HARD red-line.** MUST stay green. |

### 2b. Junction ground-truth oracles (topology / phantom-edge) — HARD RED-LINES

| Gate | Kind | Measures | Phase 8 policy |
|------|------|----------|----------------|
| `parser/__tests__/branch-traversal.test.mjs` (Siriu) | Accuracy ASSERTION (DFS oracle vs GT) | Siriu junctions 5,14,36,48,60,62,70; every post visited once; degree−1 arms; GT arm meters; `forbiddenArms` (36→39, 48→51) absent; D-15.2 no inferred degree≥3. | **HARD red-line.** Phantom edges poison the solver input graph (Pitfall 10). MUST stay green. |
| `parser/__tests__/branch-traversal-lc.test.mjs` | Accuracy ASSERTION (DFS oracle vs GT) | LC junction topology + `forbiddenArms` phantoms (3→1, 11→8, 9→11) absent; D-15.2. | **HARD red-line.** MUST stay green. |
| `parser/__tests__/branch-traversal-joaoborn.test.mjs` | Accuracy ASSERTION (DFS oracle vs GT) | JB **linear** — zero junctions (D-14); no inferred degree≥3 phantom arises. | **HARD red-line.** MUST stay green. |
| `parser/__tests__/branch-traversal-valmor.test.mjs` | Accuracy ASSERTION (DFS oracle vs GT) | Valmor linear/near-linear; zero phantom junctions; D-15.2. | **HARD red-line.** MUST stay green. |

### 2c. Siriu DWG regression + ingest — HARD RED-LINES

| Gate | Kind | Measures | Phase 8 policy |
|------|------|----------|----------------|
| `tools/run-siriu-regression-gate.mjs` | Regression FENCE (but **hard** by D-18) | Siriu DWG graph-walk: `walkOk`, 85 coords, 64 err ceilings, 39 index locks. Encodes the accepted DWG-walk output. | **HARD red-line.** D-18 lists the Siriu regression gate explicitly as a hard red-line — the walker is the strangler-fig fallback and must remain byte-stable on Siriu while the solver becomes level-0. |
| `tools/run-dxf-ingest-timing-gate.mjs` | Perf FENCE (Phase 6) | `Palhoca.dxf` ingest < 5000 ms (currently ~2.3 s). | **Hard-ish** — a perf budget, not an accuracy claim. Keep green; a RED here means an ingestion-perf regression, never a correctness signal. Treat as hard unless a deliberate ingestion rewrite re-baselines it. |

### 2d. Cumulative accuracy baselines / sub-score fences — SOFT MID-FLIGHT (D-18)

| Gate | Kind | Measures | Phase 8 policy |
|------|------|----------|----------------|
| `tools/run-residual-gate.mjs` | Regression FENCE (decision + absolute sub-score lock) | LC `decision=fail` via the **anchor** sub-score; `lc-mustfail(21-31)` stays `decision=fail` (`anchorCausesFail=true`); Valmor → fallback. Locks the *absolute-position* residual sub-score. | **SOFT red-line.** The residual **absolute sub-score fence** encodes the pre-solver LC 21–31 rigid offset as a must-fail. A correct Phase 8 solver that fixes LC 21–31 will legitimately flip `lc-mustfail` from fail→pass — that is the intended outcome, not a regression. Per Pitfall 7, do NOT block the solver on this fence flipping; re-baseline it deliberately when LC 21–31 is solved. |
| `tools/run-route-joaoborn-pdf-accuracy-gate.mjs` | Regression FENCE (cumulative per-post ceiling) | JB PDF cascade: matched=34, mean **27.01 m**, max **45.84 m**, 34 per-post err ceilings. Encodes current cumulative output incl. compensated error. | **SOFT mid-flight.** A correct solver fix may move individual posts and trip a per-post ceiling. Investigate vs the position gate + txt-accuracy tiers; re-baseline when the solver improves JB. Do NOT auto-block. |
| `tools/run-valmor-accuracy-gate.mjs` | Regression FENCE (DWG-region ceiling, mean ≤2.4 m / max ≤5 m) | Valmor DWG cascade: matched=11/11, mean **2.22 m**, max **4.38 m**. | **SOFT mid-flight.** Cumulative ceiling. Valmor is already tight; a solver change that nudges it past the ceiling is investigated, not auto-blocked. |
| `tools/run-siriu-txt-accuracy-gate.mjs` | Accuracy ASSERTION → exit rule is a tier **fence** | Siriu cascade vs txt GPS: tiers perfect=65, good=17, acceptable=3, **bad=0**. Zero-bad-tier exit rule. | **SOFT mid-flight** on the *exit rule*. The tier histogram is an independent accuracy measurement (informative), but the zero-bad-tier **exit gate** is a cumulative ceiling. Currently green; a solver change that pushes a Siriu post into bad-tier is investigated vs the position gate. (Siriu position gate stays the hard red-line.) |
| `tools/run-lc-txt-accuracy-gate.mjs` | Regression FENCE — **soft fence (D-18)** | LC cascade vs txt GPS. 13 bad-tier posts (13–20 spur). Posts **21–31 scoped out** of the zero-bad-tier exit rule (`EXCLUDED_POSTS`); exits 0 as a **SOFT-FENCE PASS**. | **SOFT mid-flight (explicit).** Per the 07-06 *layerb-only* decision, LC 21–31 rigid offset is a Phase 8 solver target. The LC txt-accuracy **zero-bad-tier rule is a soft fence** — it currently exits 0 only because 21–31 are excluded; when the solver fixes them, re-widen the scope and re-baseline. This is the canonical Pitfall-7 case in this phase. |
| `tools/run-joaoborn-txt-accuracy-gate.mjs` | Regression FENCE — **soft fence (D-18)** | JB cascade vs txt GPS. 29 bad-tier posts; exits 0 as **SOFT-FENCE PASS** (Phase 8 will fix). | **SOFT mid-flight (explicit).** JB cumulative accuracy is the pre-solver baseline; the zero-bad-tier rule is deferred to Phase 8. Re-baseline when the solver improves JB. |
| `tools/run-valmor-txt-accuracy-gate.mjs` | Accuracy ASSERTION → tier exit rule | Valmor cascade vs txt GPS: perfect=11, bad=0. Zero-bad-tier, exits 0 (**hard** in the sense it currently has zero bad-tier and is expected to). | **SOFT mid-flight** on the exit rule (cumulative ceiling), but Valmor is already all-perfect; a regression is investigated vs the Valmor position gate (hard). |

### 2e. Foundational unit suites (in the leading `node --test` arg list)

| Suite | Kind | Phase 8 policy |
|-------|------|----------------|
| `parser/__tests__/graph-walker.test.mjs` | Unit ASSERTION (walker behaviour) | **Hard** — walker is the strangler-fig fallback; behaviour must not regress. |
| `parser/__tests__/distance-associator.test.mjs` | Unit ASSERTION (label→edge association) | **Hard** — phantom-edge inference contract feeds junction GT. |
| `parser/__tests__/coordinate-calculator.test.mjs` | Unit ASSERTION (PDF→UTM math) | **Hard** — coordinate math is layer-agnostic and must stay correct. |

---

## 3. Hard red-line summary (the Phase 8 contract)

Per **D-18**, these MUST stay green at every Phase 8 solver checkpoint — a RED here is a real
regression and blocks the commit:

- **The four per-post position gates** — `run-{siriu,lc,joaoborn,valmor}-post-position-gate.mjs`.
- **The Siriu regression gate** — `run-siriu-regression-gate.mjs`.
- **The four junction ground-truth oracles** — `branch-traversal{,-lc,-joaoborn,-valmor}.test.mjs`.
- (Plus the foundational unit suites in §2e.)

These are independent-layer accuracy assertions (or, for the Siriu regression gate, the explicitly
D-18-designated walker red-line). None of them can be greened by a compensating error elsewhere.

## 3a. Soft mid-flight summary (may go RED if audit-marked)

Per **D-18**, these are cumulative accuracy baselines / sub-score fences. They may legitimately go
RED mid-flight when a *correct* solver fix removes a compensated error. A RED here is **investigated
against the hard red-lines, not auto-blocked**; re-baseline deliberately after a verified solver
improvement:

- **`run-residual-gate.mjs`** — the absolute-position **anchor sub-score** fence (locks LC 21–31 as
  must-fail; the solver is *expected* to flip this).
- **`run-route-joaoborn-pdf-accuracy-gate.mjs`** — JB cumulative per-post ceiling baseline.
- **`run-valmor-accuracy-gate.mjs`** — Valmor DWG-region cumulative ceiling.
- **The LC txt-accuracy zero-bad-tier rule** (`run-lc-txt-accuracy-gate.mjs`) — soft fence;
  exits 0 today only because posts 21–31 are scoped out (07-06 *layerb-only* decision).
- **The JB txt-accuracy zero-bad-tier rule** (`run-joaoborn-txt-accuracy-gate.mjs`) — soft fence;
  29 bad-tier posts deferred to Phase 8.
- **The Siriu / Valmor txt-accuracy zero-bad-tier *exit rules*** — cumulative tier ceilings (the tier
  histograms themselves remain informative accuracy assertions).

---

## 4. Pitfall-7 rationale — why position gates, not cumulative ceilings, are the acceptance criterion

A cumulative ceiling gate (JB PDF baseline, Valmor accuracy baseline, residual absolute sub-score,
any zero-bad-tier txt rule) measures the *end-to-end* output. That output is the composition of
several layers — PDF parse (layer B placement), label-LSQ fit, cable-arc placement, DWG cascade,
residual judging. When two layers carry **offsetting errors**, the cumulative number can look fine
while each layer is individually wrong: a compensated error.

Quick-task 260603-n4k proved this concretely: **four consecutive LC layer-B fixes each greened LC
while regressing 12–89 Siriu posts**, and the *cumulative* Siriu gate passed for two of them. The
only instrument that caught the regression was the **1.0-pt Siriu position gate** — because it
measures layer B *independently*, with no downstream layer able to mask the move.

Therefore the Phase 8 mid-flight acceptance criterion is the **per-post position gates** (immune to
cross-layer masking) plus the **junction GT oracles** (immune to phantom-edge masking), *not* the
cumulative ceilings. A correct solver fix is allowed to flip a soft cumulative fence RED (that is
the compensated error being removed); it is **never** allowed to flip a position gate or junction
oracle RED.

---

## 5. Re-baselining protocol (Phase 8)

When a soft fence goes RED during Phase 8 because of an intended solver improvement:

1. Confirm **all hard red-lines (§3) are still green** — if any is RED, it is a real regression: fix
   it, do not re-baseline.
2. Confirm the soft-fence RED corresponds to an *intended* accuracy improvement (e.g. LC 21–31 now
   within tier; `lc-mustfail` flips fail→pass).
3. Re-seed that fence's baseline deliberately (its documented update env / fixture), record the
   change in the Phase 8 SUMMARY, and re-run `npm run test:gate` to confirm a single green bar.
4. **Never** re-seed a hard red-line to "make it pass" — that re-snapshots a regression away
   (the anti-pattern called out in RESEARCH §3: `SIRIU_POST_POS_UPDATE_BASELINE=1` after an
   unintended Siriu move).
