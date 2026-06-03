# 260603-acc — LC label assignment inventory (live parsePdf)

**Researched:** 2026-06-03  
**Domain:** Luiz Carolino PDF — which `Distância_Poste` labels map to which post pairs after `associateDistancesRich` + bifurcation  
**Method:** Live `parsePdf` on main tree; greedy-phase trace + final geometry match  
**Reproduce:** `node debug-lc-label-assignments.mjs` (untracked inspection script, do not commit)

---

## Summary

- **84** text items on layer `Distância_Poste`; **69** parse as numeric metres; **15** are junk (spaces, `mm`, empty) on detail sheets p6–p9.
- **31** consecutive edges after full pipeline; **4** non-consecutive inferred edges; **2** bifurcation-main clears that null true consecutive steps.
- Page **2 (overview)** carries duplicate numeric labels, but posts live on **pages 3–5**, so detail-sheet labels win the greedy sequential pass; p2 labels are mostly `not-in-greedy` / matched only after bifurcation by value.
- **Deformation cluster (posts 1–20)** is explained by specific assignment failures below — supports H2 (offset downstream of bad label chain).

---

## Pipeline (order of effect)

| Step | Mechanism | LC impact |
|------|-----------|-----------|
| 1 | `inferDistanceEdgesFromLabels` | `3→1` (31.8), `9→11` (42.1), `11→8` (34.1) |
| 2 | `associateDistances` greedy (legacy-midpoint) | Most `N→N+1` on detail pages |
| 3 | `refineSequentialWindows` (if enabled) | Swaps `9→10` (34.1), `10→11` (19.6) |
| 4 | `applyBifurcationJunctionLabelRehome` | **2→4**, **10→12** main; clears **3→4**, **11→12** |
| 5 | `applyJumpbackDistanceCleanup` | `20→21` = 29.8 m (jumpback-refill) |

---

## Final distance edges (authoritative after parsePdf)

| Edge | m | Source | Note |
|------|---|--------|------|
| 1→2 | 18.8 | legacy-midpoint | |
| 2→3 | 31.8 | legacy-midpoint | |
| **2→4** | **18.8** | **bifurcation-main** | Clears 3→4 |
| 3→4 | *null* | bifurcation-cleared | True step lost |
| 3→1 | 31.8 | inferred-label | Branch return |
| 4→5 | 34.4 | legacy-midpoint | |
| 5→6 | 27.6 | legacy-midpoint | |
| **6→7** | **13.8** | legacy-midpoint | Truth ~37.7 m |
| 7→8 | 28.1 | legacy-midpoint | |
| 8→9 | 34.1 | legacy-midpoint | |
| 9→10 | 34.1 | window-refine | Was 19.6 |
| 9→11 | 42.1 | inferred-label | |
| 10→11 | 19.6 | window-refine | Was 33.3 |
| **10→12** | **18.7** | **bifurcation-main** | Clears 11→12 |
| 11→12 | *null* | bifurcation-cleared | True step lost |
| 11→8 | 34.1 | inferred-label | |
| 12→13 | 42.1 | legacy-midpoint | |
| 13→14 | 32.6 | legacy-midpoint | |
| 14→15 | 31.8 | legacy-midpoint | |
| 15→16 | 32.5 | legacy-midpoint | |
| 16→17 | 34.1 | legacy-midpoint | |
| 17→18 | 22.9 | legacy-midpoint | |
| 18→19 | 33.8 | legacy-midpoint | |
| 19→20 | 18.5 | legacy-midpoint | |
| 20→21 | 29.8 | jumpback-refill | Truth hop ~381.6 m |
| 21→22 | 29.8 | legacy-midpoint | |
| 22→23 | 25.5 | legacy-midpoint | |
| 23→24 | 22.9 | legacy-midpoint | |
| 24→25 | 23.4 | legacy-midpoint | |
| 25→26 | 36.7 | legacy-midpoint | |
| 26→27 | 35.7 | legacy-midpoint | |
| 27→28 | 35.9 | legacy-midpoint | |
| 28→29 | 36.3 | legacy-midpoint | |
| 29→30 | 28.7 | legacy-midpoint | |
| 30→31 | 42.8 | legacy-midpoint | |
| 31→29 | 28.7 | inferred-label | |

**Bifurcation warnings (live):**

- `[distance-assoc] Bifurcation at post 2: label 18.8 m on 2→4 (cleared 3→4)`
- `[distance-assoc] Bifurcation at post 10: label 18.7 m on 10→12 (cleared 11→12)`
- Window refine: `9→10` 19.6→34.1; `10→11` 33.3→19.6

---

## Problem assignments (deformation cluster 1–20)

| Issue | Label value(s) | Final edge | Root mechanism |
|-------|----------------|------------|----------------|
| False bifurcation @ post **2** | 18.8 m (p2/p4) | **2→4** main; **3→4** null | `applyBifurcationJunctionLabelRehome` tapMain path |
| False bifurcation @ post **10** | 18.5 / 18.7 m | **10→12** main; **11→12** null | Same |
| Mid-street @ **6–7** | **13.8** m (not ~37.7) | **6→7** legacy-midpoint | Short label wins greedy over long chord |
| Dense triple **9–11** | 34.1, 19.6, 33.3 | **9→10**, **10→11**, **9→11** | window-refine + inferred |
| Branch returns | 31.8, 42.1, 34.1 | **3→1**, **9→11**, **11→8** | inferred-label pass |
| Sheet hop **20→21** | 29.8 m | **20→21** jumpback-refill | Not true inter-sheet span |

---

## Label inventory notes

- **Duplicate sheets:** Same metre values appear on **p2 (overview)** and **p3/p4/p5 (detail)**. Greedy assignment uses post `pageNum`, so detail pages own the sequential chain; overview labels are often `UNASSIGNED` in the trace but can still match bifurcation edges by value (e.g. 18.8→2→4).
- **Orphan 12.7 m** (idx 17 p2, 47 p4): near posts 2–3 but not assigned to any edge in final output.
- **Non-distance items:** p6–p9 `25mm`, `350mm`, `550mm`, etc. — ignore for association.

---

## Implications for 260603-acc

1. **Task A (deformation)** must target the **assignment rows above**, not `rehomeBranchArmLabels` alone (06–07 is degree-2; bifurcation nulls are the tapMain / sheet-break family).
2. **H2 corroborated:** clearing **3→4** and wrong **6→7** directly corrupt the label chain that feeds `refinePageOriginsByLabelLsq`.
3. **Cable-fork (Q6) does not help** label assignment — orthogonal problem.
4. **Tap-leg corroboration** (`findTapLegMeters == null` at LC false posts 2/10) is confirmed in assignment data; shipping it globally regressed post **31** on PDF gate — keep **opt-in** via `bifurcationOpts.requireTapLegCorroboration` + `tools/lc-pdf-dwg-topology-refine.mjs`.
5. **Mid-street ratio guard** in `associateDistances` (`pdfM/meters > 1.35` on-chord) regressed **Siriu** — not shipped.

---

## Full per-label table

Run `node debug-lc-label-assignments.mjs` for all **84** rows (`idx`, page, metres, str, greedy phase, final edge + gap). Output is the deliverable for planners; not duplicated here to avoid stale tables.

---

## Sources

- `debug-lc-label-assignments.mjs` (repo root, untracked)
- Live `parsePdf` → `INFOVIAS_AAF INTERNET_São José_RUA LUIZ CAROLINO PEREIRA_v1.pdf`
- `parser/distance-associator.js` — `associateDistancesRich`, `applyBifurcationJunctionLabelRehome`
- `debug-lc-truth-vs-edges.mjs` — consecutive truth vs edge cross-check
