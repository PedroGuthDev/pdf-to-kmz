---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: Generalized DXF-Driven Accuracy
status: planning
last_updated: "2026-06-05T17:03:50.199Z"
last_activity: 2026-06-05
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-15)

**Core value:** Accurately extract post data from INFOVIAS PDF files and produce a georeferenced KMZ file
**Current focus:** v1.1 — Generalized DXF-Driven Accuracy (planning)

## Current Status

- **Milestone:** v1.1 — Generalized DXF-Driven Accuracy (**planning**; v1.0 shipped 2026-06-05)
- **State:** Design locked (DXF-first; global PDF↔DXF graph solve; truth-free residual gate; diagnostic fail). Research pass running → requirements → roadmap. Candidate phases P5–P8.
- **Archive:** `.planning/milestones/v1.0-ROADMAP.md` · `.planning/MILESTONES.md`
- **Next:** define v1.1 requirements after research synthesis, then spawn roadmapper

## Deferred Items

Items acknowledged and deferred at milestone v1.0 close on 2026-06-05. Carried forward as v1.1 candidates or backlog. (23 total)

| Category | Item | Status |
|----------|------|--------|
| debug | cli-vs-browser-posts | root_cause_found |
| debug | dwg-graph-walk-no-candidate | root_cause_found |
| debug | dwg-walk-route-order | investigating |
| debug | joao-born-coords-off | unknown |
| debug | joao-born-under-7m | investigating |
| debug | siriu-branch-return-labels | fixed_session_3 |
| debug | siriu-n3-number-corruption | investigating |
| debug | siriu-post34-cascade | diagnosed |
| debug | siriu-post45-cascade | superseded |
| debug | siriu-spine-57-branch-region | phase1-fixed/phase2-blocked |
| debug | test-gate-regression-autofix | awaiting_human_verify |
| quick_task | fix-posts-3-4-9-accuracy | missing |
| quick_task | coord-misplacement-research | in_progress |
| quick_task | 260601-k1a | complete (see Quick Tasks Completed) |
| quick_task | 260602-decouple | complete (see Quick Tasks Completed) |
| quick_task | 260602-lbl | complete (see Quick Tasks Completed) |
| quick_task | 260603-acc | diagnosis-only |
| quick_task | 260603-jk7 | complete (see Quick Tasks Completed) |
| quick_task | 260603-n4k | Phase 1+1.5 done; Phase 2+ → milestone scope |
| verification | Phase 01: 01-VERIFICATION.md | human_needed |
| verification | Phase 03: 03-VERIFICATION.md | human_needed |
| uat | Phase 01: 01-HUMAN-UAT.md | passed (0 pending) |
| context | Phase 02: 02-DWG-CONTEXT.md | 3 open questions |

## Phase History

| Date | Phase | Action |
|------|-------|--------|
| 2026-05-12 | Phase 1 | Context gathered — 18 decisions captured |
| 2026-05-12 | Phase 1 | Planned — 3 plans (01-A, 01-B, 01-C) in 2 waves |
| 2026-05-13 | Phase 1 | Re-planned — 1 plan (01-01) Walking Skeleton |
| 2026-05-13 | Phase 1 | Plan 01-01 complete — A1/A2 resolved, layer map confirmed |
| 2026-05-13 | Phase 1 | Plan 01-02 complete — 8 parser/ modules built (text-proximity approach) |
| 2026-05-14 | Phase 1 | Plan 01-03 complete — index.html browser UI built |
| 2026-05-14 | Phase 1 | CONTEXT rewritten — post numbers are vector paths; OCR required (D-01 to D-10) |
| 2026-05-14 | Phase 1 | Plan 01-04 created — OCR rewrite (Tesseract.js) to fix broken post-number extraction |
| 2026-05-14 | Phase 1 | Plan 01-04 complete — OCR pipeline live; 845 lines dead code removed |
| 2026-05-15 | Phase 1 | UAT passed — all 7 console checks confirmed. Phase 1 closed. |

## Last Session

- **Stopped at:** context exhaustion at 75% (2026-05-29)
- **Next:** New iteration beyond 02-07 — posts 9-11 need approach that beats 12.34m Procrustes floor (split-region label-RMSE metric insufficient)

## Session Continuity

Last session: 2026-05-29T13:02:20.987Z
Stopped at: Discussion of posts 9-11 improvement; context written
Resume file: None
Accuracy: João Born 22/34 < 5m, max 18.97m (posts 9-11 at 15-19m); Valmor 9/11 < 5m, max 9.14m.

## Active Decisions

| Decision | Phase | Impact |
|----------|-------|--------|
| Client-side only | Init | All processing in browser, no server |
| Infer bearings from PDF positions | Init | Use x,y drawing coords for direction |
| OCG layer filtering | Phase 1 | Use PDF layers to reliably identify data elements |
| OCR via Tesseract.js (per-page crop) | Phase 1 | Post numbers are vector paths — OCR is the only viable extraction method |
| Bad-CTM page filter (x<10 AND y<10) | Phase 1 | Skips flipY pages that would produce garbage coordinates |
| Sequence inference for OCR misses | Phase 1 | Fills gaps using lower/upper neighbours to preserve sequential numbering |
| Poste symbol = canonical PDF (x,y) | Phase 2 | Label+cable-aware match in parsePdf; not cable vertices (D-ACC-10) |

## Accumulated Context

### Pending Todos

(none)

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 20260519 | Web research: external techniques for GPS coordinate accuracy (HMM/Viterbi, N1 arc-length, Hungarian) | 2026-05-19 | — | [20260519-web-research-accuracy](./quick/20260519-web-research-accuracy/) |
| 260530-day | API DXF com Vercel Blob + biblioteca híbrida nuvem/local | 2026-05-30 | 8c70054 | [260530-day-implemente-uma-api-com-liga-o-ao-blob-pa](./quick/260530-day-implemente-uma-api-com-liga-o-ao-blob-pa/) |
| 260601-dwg | Reliable Siriu DWG-path KMZ rendering (render-boundary normalization; supersedes 260530-bif) | 2026-06-01 | b46c816 | [260601-dwg-fix-siriu-dwg-kmz-render](./quick/260601-dwg-fix-siriu-dwg-kmz-render/) |
| 260601-k1a | Replace hardcoded post-number guards w/ generic predicates (dual-gate: Siriu + Luiz Carolino). Stage 4 seam-lock + Stage 2 (36/37/38, via calibrated re-validation) SHIPPED; Stage 3 (73/74, 80/81) → discuss-again: no second route exercises those graph-walk paths | 2026-06-02 | edc96a2 | [260601-k1a-replace-hardcoded-post-number-guards-gra](./quick/260601-k1a-replace-hardcoded-post-number-guards-gra/) |
| 260602-lbl | Root-cause label mis-association fix. Stage A: proven generic DFS-with-slots traversal (hack-free). Stage B: hybrid cable-bearing+overlap discriminator re-homes same-page stolen arms — 27.7→36→46 and 31→60→69 fixed at source. Added Valmor gate (2.2m). GATED: 73/74 + 80/81 walk hacks and edc96a2 re-val pass all KEPT-and-documented (removal regressed Siriu). Deferred at source: 38.7→70→74 (junction 70 degree<3, needs DWG-geometry junction detection) + cross-page 40.6→62→81 (needs cross-page bridge). All 4 gates green | 2026-06-02 | 96133e1 | [260602-lbl-fix-distance-label-branch-association](./quick/260602-lbl-fix-distance-label-branch-association/) |
| 260602-decouple | Decouple graph-walker from load-bearing phantom label edges. **All 4 pairs DECOUPLED** at walker layer: topology rehome (70→74 clear+refill; 62→81 cross-page add) + generic `rehomedTopologyArmTo` / `rehomedCrossPageArmTo` predicates; 73/74 and 80/81 literals removed. Cross-page keeps 80→81 consecutive hint (clear+refill regressed walk). All 5 gates green | 2026-06-02 | ab4313c | [260602-decouple-graph-walker-phantom-edges](./quick/260602-decouple-graph-walker-phantom-edges/) |
| 260603-jk7 | DIAGNOSE+EVALUATE LC wrong label assignments. Root cause: 5/7 wrong edges are **ambiguous-source** (3→4, 11→12 cleared by cross-page bifurcation `:1548`; 6→7, 22→23 labels absent from PDF; 20→21 sheet hop), only 2/7 (9→10, 10→11) are a true **heuristic-bug** in `refineSequentialWindows` (`:936`/write `:1107`). Decision: **document-recommendation** — contained fix corrects only 2/7 edges while dominant posts-1–20 deformation (mean ~185m) stays, and refineSequentialWindows previously regressed Siriu. No parser change; deferred fix shape (suppress window-refine swap when displaced segment endpoint has labelGraphDegree≥3, geometry-only) recorded in DECISION.md. All 4 gates green | 2026-06-03 | 0c6f47a | [260603-jk7-debug-lc-wrong-label-assignments-and-eva](./quick/260603-jk7-debug-lc-wrong-label-assignments-and-eva/) |

| 260603-n4k | DIAGNOSIS + Phase 1 (LC position truth+gate) + Phase 1.5 (Siriu position truth+gate). Root-caused the LC post-symbol-assignment collapse: posts 9/10/11 get pole `x,y` ~200pt from their correct anchors; **10 & 11 collapse onto post 22's symbol (305,302)** in `assignPolesGloballyByLabels` (post-positioning.js:1554) — same out-of-route-order/off-cable drawing pathology as the labels. **Phase 2 (the actual fix) BLOCKED**: 4 anchor-based fixes each regressed Siriu/DWG → the LC fix is milestone-scoped (`260603-n4k-MILESTONE-SCOPE.md`), the 3 layers (label/placement/calibration) mutually compensate. **2026-06-05 Phase 1.5 SHIPPED** the unblocker: `tools/run-siriu-post-position-gate.mjs` + `siriu-post-positions-truth.json` (85 posts) — a characterization LOCK on Siriu's *accepted* x,y (snapshot, NOT anchor, since 8 posts sit >30pt off-anchor at junctions, post 50 by 501pt). Pairs with the LC gate so layer-B can be re-derived against BOTH routes' truth instead of blind-trading Siriu. Gate GREEN (85/85, 0.00pt); parser untouched; all 4 gates green | 2026-06-05 | — | [260603-n4k-debug-lc-post-symbol-assignment-collapse](./quick/260603-n4k-debug-lc-post-symbol-assignment-collapse/) |

---
Last activity: 2026-06-05 - Quick task 260603-n4k Phase 1.5: shipped the Siriu per-post position truth + gate (tools/run-siriu-post-position-gate.mjs + siriu-post-positions-truth.json, 85 posts, GREEN lock) — the documented unblocker for the milestone-scoped LC layer-B rework. It's a characterization snapshot of Siriu's accepted x,y (NOT anchors: 8 posts sit >30pt off-anchor at junctions, post 50 by 501pt), pairing with the LC position gate so placement changes can be validated against BOTH routes instead of blind-trading Siriu. Parser pristine; test:gate + all 4 gates green.

---
*Last updated: 2026-05-19 after web research on accuracy improvements*

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-06-05 — Milestone v1.1 started
