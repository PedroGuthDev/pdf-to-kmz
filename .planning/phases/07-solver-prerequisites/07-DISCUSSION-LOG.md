# Phase 07: Solver Prerequisites - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-06
**Phase:** 07-solver-prerequisites
**Areas discussed:** New position fixtures (João Born + Valmor), LC position gate exit bar, Junction ground-truth scope, Gate audit + CI suite

---

## Clarification — txt GPS truth vs PDF position truth

**User clarification:** The four `coordenadas postes *.txt` files in the repo root are real-world accurate GPS coordinates for all four routes. The goal is an algorithm that generalizes to other projects without ground truth; Phase 7 uses these four routes as locked reference fixtures.

**Siriu txt line count:** User corrected — not 94 posts; file has blank lines. Verified: 93 lines, 85 `Poste` entries, 8 empty lines.

---

## Area 1 — New position fixtures (João Born + Valmor)

| Option | Description | Selected |
|--------|-------------|----------|
| João Born: Siriu-style snapshot lock | Snapshot current parsed x,y; starts GREEN | |
| João Born: LC-style hand-known anchors | Hand-set expected pole positions from PDF | ✓ |
| Txt = canonical GPS; keep PDF position gates | Full stack per ROADMAP | ✓ |
| Valmor: exempt from PDF position gate | DWG-only exemption | |
| Valmor: full PDF position gate | User noted PDF exists in folder | ✓ |
| Accuracy: strict 5 m / 10 m | Binary thresholds | |
| Accuracy tiers | perfect ≤5 m, good ≤10 m, acceptable ≤15 m, bad >15 m | ✓ |
| Import script txt → JSON | One-time + re-run on txt edits | ✓ |

**User's choice:** Full stack; JB hand anchors; Valmor has PDF (`INFOVIAS_PJC INTERNET_Palhoça_RUA VALMOR FRANCISCO_v1.pdf`); tiered accuracy; import script for txt → JSON fixtures.

**Notes:** User initially asked what Phase 7 was discussing — clarified two truth layers (GPS txt vs PDF x,y position). User wants txt as canonical GPS for all four projects.

---

## Area 2 — LC position gate exit bar

| Option | Description | Selected |
|--------|-------------|----------|
| Fix LC in Phase 7 — gate must GREEN | Layer-B fix prerequisite | ✓ |
| Accept RED — solver fixes in Phase 8 | Defer placement fix | |
| Re-snapshot LC truth | Siriu-style lock | |
| Fix 9/10/11 only | Minimal scope | |
| Fix all failing position + bad GPS tier | Broader scope | ✓ |
| Siriu lock only mid-flight | LC RED allowed | |
| All gates green every checkpoint | No mid-flight RED | ✓ |

**User's choice:** Fix LC placement in Phase 7; scope = all position-failing posts + all txt GPS bad-tier (>15 m) posts; all gates must stay green at every checkpoint during fix work.

---

## Area 3 — Junction ground-truth scope

| Option | Description | Selected |
|--------|-------------|----------|
| All 4 routes get junction fixtures | Full SC-2 coverage | ✓ |
| Manual curation | User declares junctions per route | ✓ |
| forbiddenArms + no inferred junctions | Both phantom mechanisms | ✓ |

**User's choice:** All four routes; manual curation; both phantom check mechanisms.

**Locked declaration:** João Born has **no bifurcations** (user override of research suggesting post 13).

---

## Area 4 — Gate audit + CI suite

| Option | Description | Selected |
|--------|-------------|----------|
| 07-GATE-AUDIT.md in phase directory | Phase-local audit doc | ✓ |
| Everything in npm run test:gate | Single CI command | ✓ |
| Position hard; cumulative fences soft in P8 | Mid-flight policy | ✓ |

**User's choice:** Audit in `.planning/phases/07-solver-prerequisites/07-GATE-AUDIT.md`; all gates wired into `test:gate` at Phase 7 exit; Phase 8 hard red-lines = position gates + Siriu regression + junction fixtures.

---

## Claude's Discretion

- CI aggregate pass rule for accuracy tiers.
- Junction post lists for Siriu/LC/Valmor (draft + user approve); JB fixed as no bifurcations.
- Phase 7 plan wave ordering.
- Hand-anchor capture workflow for JB/Valmor PDF position truths.

## Deferred Ideas

- Global solver → Phase 8.
- New projects without ground truth → Phase 8 + truth-free residual (Phase 7 locks four reference routes only).
