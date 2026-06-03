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
- **Phase 2 — Post-positioning (layer B).** In `assignPolesGloballyByLabels`: (a) partition by route
  **segment** (not just cable pathIndex) using the §3.3 segment map / number-contiguity, (b) make
  off-cable route posts first-class (own nearest symbol via label-anchor proximity; never a shared
  fallback), (c) handle out-of-sequence poles (post 11) so Viterbi doesn't fail→collapse, (d) enforce
  **no two numbers share one symbol** (audit the `usedSymbol` guard on greedy/repair paths). Exit:
  per-post position gate GREEN for posts 1–20; **Siriu/Valmor/DWG green** (guard the partition change so
  DWG's PDF is unaffected — segment-map-scoped, not a generic number-gap split). LC cumulative MAY be red.
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

| Checkpoint | Per-post position gate | Siriu | Valmor | DWG | LC cumulative |
|------------|------------------------|-------|--------|-----|---------------|
| Phase 1 exit | runs (red = the gap) | green | green | green | green (unchanged) |
| Phase 2 exit | **green (1–20)** | green | green | **green** | may be red |
| Phase 3 exit | green | green | green | green | improving |
| Phase 4 exit | green | green | green | green | improving |
| Phase 5 exit | green | green | green | green | **green (rebuilt)** |

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
