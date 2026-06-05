# Milestone Scope — LC Posts-1–20: Coordinated Post-Positioning + Calibration Rework

**Drafted:** 2026-06-03
**Status:** Proposal (ready to promote to ROADMAP.md as a milestone)
**Origin:** Synthesis of 260603-jk7 (labels) + 260603-n4k (post-positioning). Both proved LC's
posts-1–20 deformation cannot be fixed at any single layer — the layers mutually compensate.

---

## 1. Problem statement (what we proved)

LC PDF route sits at **mean 185.6 m / max 271.7 m** error, concentrated in **posts 1–20**
(posts 21–31 are a separate ~179 m rigid offset — out of scope here). Three layers each carry
errors that **offset each other**, so the current LC baseline encodes the compensation:

| Layer | The LC error it carries | Evidence |
|-------|-------------------------|----------|
| **A. Label assignment** | phantom inferred edge 11→8 eats `34,1`; 9→10/10→11 are a compensating pair (34.1+19.6≈truth sum) | 260603-jk7 |
| **B. Poste-symbol placement** | posts 9/10/11 collapse onto wrong/shared pole symbols (10,11 → post 22's 305,302) | 260603-n4k |
| **C. Multi-sheet label-LSQ calibration** | compensates for B's collapsed poles — correcting B alone pushed posts 4–9 to ~250 m | 260603-n4k fix attempt |

**Common upstream cause (the drawing pathology):** on page-4 path-1 the cable runs
**7→8→11→9→10** (post 11 out of route order), posts **9,10 sit off the main cable** (d≈33–36 pt),
and the **page-4 cable is shared by two route segments** (7–11 and the lone post 22). Every layer
absorbs this differently, in mutually-offsetting ways.

**Why incremental failed (4 reverted attempts):** label veto → migrated wrong labels; window-refine
geometry guard → half-fixed a compensating pair, tripped tight ceilings; cable-adjacency → defeated by
off-cable poles + out-of-order post 11; partition split → fixed B but regressed DWG and LC posts 4–9.

## 2. Objectives

- **Primary:** LC PDF posts-1–20 error from ~119 m (cluster residual) down toward the posts-21–31
  quality band (single-digit-to-low-tens metres), by fixing layers A+B+C **together**.
- **Hard constraint:** **zero regression** on Siriu (`npm run test:gate`), Valmor, and **DWG** gates
  at every checkpoint.
- **Mechanism, not literals:** no post-number literals (per 260602-decouple). Fixes must be geometry/
  topology predicates that generalize.

## 3. The key enabler — a per-post POSITION gate (decouple measurement from compensation)

The blocker to fixing this is that today we can only measure the **cumulative** route error, which the
calibration **compensates**. So a correct fix to layer B looks like a regression. We must be able to
measure each layer **in isolation**.

**Build first (Phase 1):**
1. **Corrected per-post PDF-position truth** — for LC posts 1–20, the expected pole-symbol `(x,y)` on
   each detail sheet (page 3/4/5), captured from the PDF by hand/inspection. Store as
   `parser/__tests__/fixtures/luizcarolino-post-positions-truth.json` (`{ number, pageNum, x, y }`).
2. **A per-post position gate** `tools/run-lc-post-position-gate.mjs` — compares parsed `post.x,post.y`
   (and `anchorX/anchorY`) against the truth, per post, with a pt tolerance. It will START RED
   (documents the B-layer gap: posts 9,10,11,22). This gate lets Phase 2 be developed against ground
   truth instead of the compensated cumulative error.
3. **A route-segment map for page 4** — which posts belong to the 6–11 run vs the 21–31 run on the
   shared cable. Needed to fix partitioning (B) without the generic blast radius that broke DWG.

Existing truth already available: `luizcarolino-ground-truth.json` (lat/lon, 31 posts) →
per-span haversine distances; `luizcarolino-pdf-baseline.json` (per-post err ceilings, to be rebuilt).

## 4. Phase breakdown

> Develop on a branch where the **LC cumulative gate is allowed RED** mid-flight (it is compensating).
> Mid-flight gating is on the **per-post position gate + Siriu + Valmor + DWG**. Only Phase 5 re-greens
> and rebuilds the LC cumulative baseline.

- **Phase 1 — Truth + measurement (no parser change). ✅ DONE 2026-06-03.** Built the 3 artifacts in §3:
  `parser/__tests__/fixtures/luizcarolino-post-positions-truth.json` (posts 1-20, anchor-seeded),
  `parser/__tests__/fixtures/luizcarolino-page4-segments.json` (route-segment map), and
  `tools/run-lc-post-position-gate.mjs`. Exit met: position gate runs and reports the gap — **RED for
  posts 9/10/11** (171/261/216 pt off; other 17 within 50 pt tol, mean 32.7 pt); all 4 existing gates
  still green; parser source untouched. The gate is standalone (NOT in `npm run test:gate`) precisely
  because it is expected-red until Phase 2; wire it into the green suite at Phase 5.
- **Phase 1.5 — Siriu per-post position truth + gate. ✅ DONE 2026-06-05.** Built the mirror of the LC
  measurement asset so layer-B can be re-derived against BOTH routes' truth instead of blind-trading
  Siriu. Artifacts: `parser/__tests__/fixtures/siriu-post-positions-truth.json` (85 posts) and
  `tools/run-siriu-post-position-gate.mjs` (self-seeding via `SIRIU_POST_POS_UPDATE_BASELINE=1`).
  **Critical design difference from the LC truth:** Siriu's truth is a **characterization/regression
  LOCK** — a snapshot of the current *accepted* `post.x,post.y`, NOT the number anchor — because Siriu
  legitimately places **8 posts >30 pt off-anchor at junctions** (post 50 is **501 pt** off-anchor, 42
  ≈227 pt, 7 ≈184 pt). That off-anchor evidence is the smoking gun for why every reverted Phase-2 fix
  (all anchor-based) regressed Siriu *invisibly*: the DWG-walk cumulative gate could not name which posts
  moved. This gate can, per post. Exit met: gate GREEN at baseline (85/85, mean/max 0.00 pt, tol 1 pt);
  failure path verified (exit 1 under impossible tol); `npm run test:gate` still green; **parser
  untouched** (git scope = the 2 new files only), so LC/Valmor/DWG gates are deterministically
  unaffected. Standalone (NOT in `npm run test:gate`) — a development instrument for Phase 2; the pair of
  position gates (LC red, Siriu green) now bracket the layer-B rework.
- **Phase 2 — Post-positioning (layer B). ⛔ ATTEMPTED 2026-06-03 — BLOCKED by total Siriu coupling.
  Prerequisite Phase 1.5 now SHIPPED (2026-06-05) — unblocked to re-attempt against dual position truth.**
  Target: `assignPolesGloballyByLabels` — partition by route segment, off-cable posts first-class,
  out-of-sequence pole handling, no shared symbols. The exact failure was confirmed
  (`N3 page 4 path 1: Viterbi assignment failed → greedy fallback`; the collapse is `repairConsecutive`
  `LabelArcJumps` walking the out-of-route-order cable and relabeling 9/10/11 onto wrong/shared symbols
  ~200 pt from their number anchors). **Four distinct fixes were each implemented + gated + reverted —
  ALL regressed Siriu and/or DWG:**
  | Fix | Position gate | Siriu | DWG |
  |-----|---------------|-------|-----|
  | generic number-gap partition split | fixed 9/10/11 | green | **FAIL** (+LC 4–9 worse) |
  | realign anchor-override (>150 pt) | 9/10 fixed | **12 fail** | **FAIL** |
  | arc-repair anchor-guard (target ≤100 pt from anchor) | 9/10 fixed, mean 5.3 pt | **89 fail** | **FAIL** |
  | additive shared-symbol de-collapse (Siriu-safe "by construction") | 10/11 fixed, mean 10.3 pt | **24 fail** | **FAIL** |

  **DECISIVE FINDING: the post-positioning subsystem cannot be modified in isolation AT ALL — not even
  with an additive pass guarded on a degenerate signature.** Root reasons: (1) Siriu legitimately places
  posts *away* from their number anchors (junctions), so any anchor-based correction breaks it; (2) Siriu
  legitimately has coincident post positions, so even a "two-numbers-one-symbol" de-collapse hits real
  Siriu cases; (3) the repair/realign/partition functions are shared and Siriu-calibrated. The position
  gate worked perfectly — it proved every fix *succeeds* for LC placement (mean 32.7 → 5.3 pt) while
  instantly surfacing the Siriu cost. **Implication: layer B (placement) and Siriu's expectations must be
  re-derived TOGETHER against per-post truth — Phase 2 cannot precede a Siriu per-post position truth +
  gate.** Parser left pristine; all 4 gates green; the position gate remains (red on 9/10/11) as the durable asset.

  **Revised Phase-2 prerequisite (NEW Phase 1.5):** build a **Siriu per-post position truth + gate**
  (mirror of the LC one). Only with BOTH routes' placement measured against truth can the shared
  functions be reworked so a change is validated to help LC without silently breaking Siriu's (currently
  invisible, baseline-encoded) placement expectations. Without that, every placement change is a blind
  trade.
- **Phase 3 — Calibration (layer C).** Update the multi-sheet label-LSQ calibration to consume the now-
  correct poles and stop compensating (the term that absorbed the collapse must be removed/retuned).
  Exit: LC cumulative error DROPS vs 185.6 m with poles correct; Siriu/Valmor/DWG green.
- **Phase 4 — Re-land label fixes (layer A).** With poles correct and calibration honest, re-land the
  Siriu-safe **window-refine drawn-geometry guard** (the proven +DWG, +9→10 fix from jk7) and the
  cable-adjacency inferred-edge veto (now that `anchorX/anchorY` cable snapping is reliable). Exit:
  6/7 wrong edges resolved; all sibling gates green.
- **Phase 5 — Rebuild + lock.** `LUIZCAROLINO_UPDATE_BASELINE=1` once, to the genuinely-improved state.
  Confirm all 4 gates green. Remove temporary mid-flight red-gate allowances. Lock.

(Out of scope, separate follow-on: posts 21–31 rigid ~179 m offset = per-sheet UTM georef; and 20→21
cross-sheet 381 m span.)

## 5. Gate strategy (summary)

| Checkpoint | LC position gate | Siriu position gate | Siriu | Valmor | DWG | LC cumulative |
|------------|------------------|---------------------|-------|--------|-----|---------------|
| Phase 1 exit | runs (red = the gap) | — | green | green | green | green (unchanged) |
| Phase 1.5 exit ✅ | red (9/10/11) | **green (lock, 85/85)** | green | green | green | green (unchanged) |
| Phase 2 exit | **green (1–20)** | **green (no Siriu drift)** | green | green | **green** | may be red |
| Phase 3 exit | green | green | green | green | green | improving |
| Phase 4 exit | green | green | green | green | green | improving |
| Phase 5 exit | green | green | green | green | green | **green (rebuilt)** |

**DWG protection:** Phase 2's partitioning change must be scoped (route-segment-aware, not the generic
number-gap split that regressed DWG) OR DWG must get its own per-post truth so the change is validated
to help, not hurt, both routes. This is the single biggest regression risk and gates Phase 2.

## 6. Risks & mitigations

- **Calibration coupling (proven):** correcting poles worsens the current fit → Phases 2–4 must ship as
  a set; never gate mid-flight on the LC cumulative baseline.
- **DWG blast radius (proven):** post-positioning is shared → scope changes by route segment and gate DWG
  every checkpoint; add DWG per-post truth if needed.
- **Siriu N3 fragility:** `assignPolesGloballyByLabels` is the Siriu calibrator → keep `npm run test:gate`
  green at every commit; prefer additive predicates over changing existing thresholds.
- **Truth cost:** hand-capturing per-post PDF positions is manual but bounded (20 posts × 1 sheet each).

## 7. Reproduction / assets already in place
- Probes (untracked): `debug-lc-post-fields.mjs`, `debug-lc-cable-hits.mjs`, `debug-lc-geom-vs-label.mjs`,
  `debug-lc-truth-vs-edges.mjs`, `debug-lc-label-assignments.mjs`.
- Diagnoses: `260603-jk7-{ROOTCAUSE,SOLUTIONS,DECISION}.md`, `260603-n4k-ROOTCAUSE.md`.
- Stages: `parser/distance-associator.js` (A), `parser/post-positioning.js:1554`
  `assignPolesGloballyByLabels` (B), `parser/geo/label-lsq-calibrator.js` +
  `parser/post-positioning-n3.js` (C).
