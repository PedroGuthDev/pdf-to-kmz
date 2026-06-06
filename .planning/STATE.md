---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: — Generalized DXF-Driven Accuracy
status: executing
stopped_at: Completed 07-01-PLAN.md
last_updated: "2026-06-06T14:51:18.460Z"
last_activity: 2026-06-06
progress:
  total_phases: 5
  completed_phases: 2
  total_plans: 12
  completed_plans: 6
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-15)

**Core value:** Accurately extract post data from INFOVIAS PDF files and produce a georeferenced KMZ file
**Current focus:** Phase 07 — solver-prerequisites

## Current Status

- **Milestone:** v1.1 — Generalized DXF-Driven Accuracy (**roadmap complete**; v1.0 shipped 2026-06-05)
- **State:** Phase 5 complete. Phase 6 planned (3 plans in 2 waves). Requirements locked (21 reqs: ACC/DXF/SOLVE/CONF). Ready to execute Phase 6.
- **Archive:** `.planning/milestones/v1.0-ROADMAP.md` · `.planning/MILESTONES.md`
- **Next:** `/gsd:execute-phase 6` — DXF Ingestion & Region Lookup

## Current Position

Phase: 07 (solver-prerequisites) — EXECUTING
Plan: 2 of 7
Status: Ready to execute
Last activity: 2026-06-06

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
| 2026-06-05 | Phase 5-9 | Roadmap created for v1.1 — 5 phases (ACC/DXF/SOLVE-prereq/SOLVE/CONF) |
| 2026-06-05 | Phase 5 | Planned — 2 plans (05-01: residual-gate module, 05-02: live wire + CI gate) in 2 waves |

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
| DXF is accuracy authority; PDF-only demoted | v1.1 lock | No DXF = fail loud; PDF-only acceptable-failure only |
| Two-sub-score residual gate (shape + anchor) | v1.1 lock | HIGH confidence requires BOTH sub-scores; LC 21-31 rigid-offset must fail |
| Strangler-fig: global solver = level-0; graph-walker = fallback | v1.1 lock | Generalize without losing Siriu's proven ~6m; zero regression contract |
| Zone-22S hardcoded; out-of-zone = fail loud | v1.1 lock | Known v1.1 limitation; MZONE-01 deferred |
| Confidence = TIER labels only, never numeric % | v1.1 lock | HIGH/MED/LOW/UNRESOLVABLE; numeric % is an explicit anti-feature |
| Single new dependency: munkres-js@2.0.3 | v1.1 lock | Added only at Phase 8; everything else reuses in-house modules |
| P7 prerequisites phase inserted as Phase 7 | v1.1 roadmap | João Born + Valmor fixtures + gate audit separated from solver to prevent compensated-error blocking |

## Accumulated Context

### Pending Todos

- Plan Phase 5 before writing any residual-gate code

### Key Risk Flags (from research)

- **Compensated-error gate trap (Pitfall 7):** The LC Phase 2 block proved four times that fence gates encoding compensated errors block every correct fix. Phase 7 must audit and classify ALL gates before Phase 8 begins. This is non-negotiable.
- **Siriu regression through shared subsystems (Pitfall 2):** Any change to shared placement/calibration code can silently break Siriu. Per-post position gates (not just cumulative ceiling) must be green at every Phase 8 checkpoint.
- **Confident-but-wrong / rigid-offset (Pitfall 1):** Shape-only residual passes the LC 21-31 case. Absolute-anchor sub-score is mandatory from Phase 5 day one.
- **Phase 8 novel/highest-risk:** Hub/branch topology handling in the global solver is the highest-risk element. Research pass recommended at plan-phase time (`/gsd:plan-phase --research-phase 8`).

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 20260519 | Web research: external techniques for GPS coordinate accuracy (HMM/Viterbi, N1 arc-length, Hungarian) | 2026-05-19 | — | [20260519-web-research-accuracy](./quick/20260519-web-research-accuracy/) |
| 260530-day | API DXF com Vercel Blob + biblioteca híbrida nuvem/local | 2026-05-30 | 8c70054 | [260530-day-implemente-uma-api-com-liga-o-ao-blob-pa](./quick/260530-day-implemente-uma-api-com-liga-o-ao-blob-pa/) |
| 260601-dwg | Reliable Siriu DWG-path KMZ rendering (render-boundary normalization; supersedes 260530-bif) | 2026-06-01 | b46c816 | [260601-dwg-fix-siriu-dwg-kmz-render](./quick/260601-dwg-fix-siriu-dwg-kmz-render/) |
| 260601-k1a | Replace hardcoded post-number guards w/ generic predicates (dual-gate: Siriu + Luiz Carolino). Stage 4 seam-lock + Stage 2 (36/37/38, via calibrated re-validation) SHIPPED; Stage 3 (73/74, 80/81) → discuss-again: no second route exercises those graph-walk paths | 2026-06-02 | edc96a2 | [260601-k1a-replace-hardcoded-post-number-guards-gra](./quick/260601-k1a-replace-hardcoded-post-number-guards-gra/) |
| 260602-lbl | Root-cause label mis-association fix. Stage A: proven generic DFS-with-slots traversal (hack-free). Stage B: hybrid cable-bearing+overlap discriminator re-homes same-page stolen arms. All 4 gates green | 2026-06-02 | 96133e1 | [260602-lbl-fix-distance-label-branch-association](./quick/260602-lbl-fix-distance-label-branch-association/) |
| 260602-decouple | Decouple graph-walker from load-bearing phantom label edges. All 4 pairs DECOUPLED. All 5 gates green | 2026-06-02 | ab4313c | [260602-decouple-graph-walker-phantom-edges](./quick/260602-decouple-graph-walker-phantom-edges/) |
| 260603-jk7 | DIAGNOSE+EVALUATE LC wrong label assignments. Document-recommendation decision. All 4 gates green | 2026-06-03 | 0c6f47a | [260603-jk7-debug-lc-wrong-label-assignments-and-eva](./quick/260603-jk7-debug-lc-wrong-label-assignments-and-eva/) |
| 260603-n4k | DIAGNOSIS + Phase 1 (LC position truth+gate) + Phase 1.5 (Siriu position truth+gate). Phase 2 BLOCKED: milestone-scoped. Phase 1.5 SHIPPED: siriu-post-positions-truth.json (85 posts), gate GREEN | 2026-06-05 | — | [260603-n4k-debug-lc-post-symbol-assignment-collapse](./quick/260603-n4k-debug-lc-post-symbol-assignment-collapse/) |

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

## Session Continuity

Last session: 2026-06-06T14:51:18.444Z
Stopped at: Completed 07-01-PLAN.md
Resume: Run `/gsd:execute-phase 5` to execute the truth-free residual gate plans
