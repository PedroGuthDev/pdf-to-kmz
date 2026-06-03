# Quick Task 260603-acc — Research: Luiz Carolino + João Born route accuracy

**Researched:** 2026-06-03
**Domain:** PDF→KMZ route-coordinate accuracy (distance-associator + multi-sheet page-origin calibration)
**Confidence:** HIGH (all findings reproduced live on the main working tree; commands + output excerpts inline)

## Summary

The Luiz Carolino PDF error is **two independent root causes**, exactly as CONTEXT states,
and this session pins the precise mechanism for each with live evidence:

1. **Posts 4–20 deformation** = the distance-associator FALSELY detects bifurcations and
   mis-associates consecutive steps. Three distinct clusters: (A) a false bifurcation at post 2
   that nulls the real `3→4` step; (B) the 06–07 TRAVESSA junction where the consecutive `6→7`
   step is given a stolen short label (13.8 m vs true 37.7 m); (C) swapped/false-bifurcation
   edges around posts 9–12. **The existing generic `rehomeBranchArmLabels` CANNOT fix any of
   these** because the 06–07 junction is *invisible to the label graph* (posts 6 and 7 are both
   degree-2), and the post-2/post-10 errors are produced by a *different* mechanism
   (`applyBifurcationJunctionLabelRehome`'s same-page bifurcation loop firing falsely).

2. **Posts 21–31 rigid ~179 m offset** = a **single wrong page-4 origin**. Posts 4–11 AND posts
   21–31 are BOTH on PDF page 4 (the route loops out and back across the TRAVESSA). The global
   label-LSQ fits ONE origin per page, so page 4's origin is a compromise between the two
   clusters, leaving 21–31 translated ~179 m (shape correct: residual only ~10 m). The same wrong
   page-4 origin also contributes the ~179 m component to posts 4–11 (their bearing ~303° matches
   21–31), on top of their internal deformation.

**Primary recommendation:** Do NOT try to extend `rehomeBranchArmLabels` for LC's 06–07 (it
needs a degree-≥3 label-graph junction that does not exist). Instead pursue two narrower fixes:
(Task A) make the same-page **false-bifurcation detector less trigger-happy** so it stops nulling
true consecutive steps (posts 2/3/4, 10/11/12) and add a geometric mid-street-label guard for
06–07; (Task B) split the **page-4 origin** so the two on-page clusters get independent
translations (the highest-leverage single change — it alone removes the ~179 m from 21–31 and a
~179 m chunk from 4–11). João Born's PDF path is already healthy (mean 27 m) and is the easiest
gate to bootstrap.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Label→edge association (which posts a distance connects) | `parser/distance-associator.js` (`associateDistancesRich` → `applyBifurcationJunctionLabelRehome` → `rehomeBranchArmLabels`) | — | The PDF entry path runs here; all deformation originates here |
| Page-origin / multi-sheet anchoring | `parser/coordinate-calculator.js` (`refinePageOriginsByLabelLsq`, `lockPageOriginsAtSheetBreaksFromPriorProjection`) + `parser/geo/label-lsq-calibrator.js` | `parser/geo/route-corridor.js` (lateral clamp) | The ~179 m rigid offset is a page-transform translation error |
| Region-degree junction detection | `parser/dwg/cable-topology.js` + `parser/distance-associator.js::applyTopologyBranchArmRehome` | — | **DWG-only**; not reachable from the PDF path (RISK-2) |
| Accuracy gating | `tools/run-route-pdf-accuracy-gate.mjs` + `tools/route-pdf-accuracy-harness.mjs` + `*-pdf-baseline.json` | — | Per-post ceiling gate; mirror for João Born |

---

## Q1 — Does the branch-arm rehome fire on the LC PDF route?

### Evidence

**PDF entry path traced (file:line):**
- `tools/route-pdf-accuracy-harness.mjs:42` → `parsePdf` → `parser/pdf-parser.js:751`
  calls **`associateDistancesRich`** (NOT `associateDistances` directly; `associateDistancesRich`
  internally calls `associateDistances` at `distance-associator.js:867`).
- `parser/pdf-parser.js:764-784`: `applyBifurcationJunctionLabelRehome(...)` is called **only when
  `multiSheetRoute && allCablePaths.length > 0`**, where `multiSheetRoute = pairedViewportBoxes.length >= 3`
  (`pdf-parser.js:764`).
- Inside `applyBifurcationJunctionLabelRehome`, `rehomeBranchArmLabels` is gated by
  `if (cablesByPage?.size)` at `distance-associator.js:1847`. The caller threads
  `cablesForPrefill = buildCablesByPage(allCablePaths)` (`pdf-parser.js:766`), so the guard is
  satisfied whenever `allCablePaths.length > 0`.

**Instrumented run** (`debug-lc-rehome-trace.mjs lc`):
```
=== PDF: INFOVIAS_AAF INTERNET_São José_RUA LUIZ CAROLINO PEREIRA_v1.pdf
posts: 31 distances: 36 cableSegments: 8
viewportBoxes: 3 => multiSheetRoute(>=3): true
distinct post pages: [ 3, 4, 5 ]

=== rehome/bifurcation/seam warnings (2) ===
   [distance-assoc] Bifurcation at post 2: label 18.8 m on 2→4 (cleared 3→4)
   [distance-assoc] Bifurcation at post 10: label 18.7 m on 10→12 (cleared 11→12)
```

**Label-graph degree** (`debug-lc-degree.mjs lc`):
```
label-graph junctions (deg>=3): 2,8,9,10,11,29
post   6  deg 2  [5,7]
post   7  deg 2  [6,8]
```

### Answer

- `multiSheetRoute = true` for LC (`viewportBoxes = 3`), and `cablesByPage.size > 0`
  (`cableSegments = 8`). So `applyBifurcationJunctionLabelRehome` runs, and the
  `rehomeBranchArmLabels` guard at L1847 **IS satisfied — the function executes.**
- **But `rehomeBranchArmLabels` produces NO rehome** (zero `branch-arm-rehomed` /
  `Topology rehome` warnings). It iterates labels but bails because its junction filter requires a
  **label-graph degree-≥3 post within ~9 numbers** (`distance-associator.js:2266` and `:2286`).
  The only label-graph "junctions" LC has (2, 8, 9, 10, 11, 29) are **spurious** — created by the
  mis-association itself (duplicate inferred edges `3→1`, `11→8`, `9→11`) — not the true 06–07
  junction, which is degree-2/degree-2 and therefore invisible.
- The two warnings that DO fire are from a **different mechanism**: the same-page bifurcation loop
  inside `applyBifurcationJunctionLabelRehome` (`distance-associator.js:1530-1608`), which FALSELY
  classified post 3 (and post 11) as a bifurcation tap.

**So: the rehome fires but is a no-op for LC's real problem. The damage is done by the
bifurcation loop, not by `rehomeBranchArmLabels`.** `[VERIFIED: live trace]`

### Recommendation
Stop treating `rehomeBranchArmLabels` as the lever for LC. The fix targets are (1) the
false-bifurcation loop and (2) a mid-street guard for the label-graph-invisible 06–07 junction.

---

## Q2 — What goes wrong at the 06–07 junction and at post 4?

### Evidence

**Associator edges vs ground-truth consecutive steps** (`debug-lc-truth-vs-edges.mjs`):
```
step    truthM   edgeM   src                   delta
 1-> 2    17.9    18.8  legacy-midpoint          0.9
 2-> 3    31.8    31.8  legacy-midpoint          0.0
 3-> 4    18.8    null  bifurcation-cleared      -  <==   (TRUE 3->4 step destroyed)
 4-> 5    35.2    34.4  legacy-midpoint         -0.8
 5-> 6    27.7    27.6  legacy-midpoint         -0.1
 6-> 7    37.7    13.8  legacy-midpoint        -23.9  <==  (06-07 mid-street label stolen)
 7-> 8    28.2    28.1  legacy-midpoint         -0.1
 8-> 9    34.2    34.1  legacy-midpoint         -0.1
 9->10    19.5    34.1  window-refine           14.6  <==  (9->10 / 10->11 swapped)
10->11    33.5    19.6  window-refine          -13.9  <==
11->12    18.4    null  bifurcation-cleared      -  <==   (TRUE 11->12 step destroyed)
...
20->21   381.6    29.8  jumpback-refill       -351.8  <==  (sheet break / 21-31 offset, Q3)
22->23    39.4    25.5  legacy-midpoint        -13.9  <==  (another mid-street tap, posts 22-23)

=== non-consecutive edges (|from-to|>1) ===
  3->1  31.8  inferred-label      (duplicate of 2->3=31.8 → makes post 2 spurious deg-3)
  2->4  18.8  bifurcation-main    (the true 3->4 length, mis-homed onto 2->4)
  11->8  34.1 inferred-label
  9->11  42.1 inferred-label
  10->12 18.7 bifurcation-main    (the true 11->12 length, mis-homed onto 10->12)
```

**Post→page map** (`debug-lc-degree.mjs lc`):
```
1:p3 2:p3 3:p3  4:p4 5:p4 6:p4 7:p4 8:p4 9:p4 10:p4 11:p4  12:p5 ... 20:p5  21:p4 ... 31:p4
```

### Answer

The deformation is **three clusters**, not one junction:

- **Post 4 break (cluster A):** the bifurcation loop (`distance-associator.js:1530-1608`)
  classified post 3 as a tap of a "junction 2 → main 4" bifurcation, placed the **true `3→4`
  length (18.8 m) onto `2→4`** and **nulled `3→4`** (warning `Bifurcation at post 2 … cleared 3→4`).
  With `3→4` gone, the chain from post 4 onward inherits the wrong anchor → the "breaks hard at
  post 4" symptom. This is a **FALSE bifurcation** — there is no real tap at post 3.
- **06–07 (cluster B):** `6→7` got `13.8 m` but the truth is `37.7 m`. This is the
  classic mid-street / branch-arm pattern: a short tap/junction label near 06–07 was grabbed for
  the consecutive `6→7` step. The bearing flip at the page-4→page-5 boundary (post 12) compounds it.
- **Posts 9–12 (cluster C):** `9→10` and `10→11` are *swapped* (`window-refine`), and post 10 is
  hit by the same false-bifurcation loop (`Bifurcation at post 10 … cleared 11→12`), nulling `11→12`.
- A 4th, milder tap shows at **22→23** (delta −13.9), inside the otherwise-clean 21–31 block.

**Is 06–07 detectable by LABEL-GRAPH degree? NO.** Posts 6 and 7 are both degree-2
(`[5,7]` and `[6,8]`). The only label-graph junctions are spurious (2,8,9,10,11,29). Therefore
**`rehomeBranchArmLabels` (which requires a real degree-≥3 label-graph junction near the label,
`distance-associator.js:2266`/`:2286`) is structurally unable to act here.**

**Would DWG REGION degree help?** `applyTopologyBranchArmRehome` uses
`isTopologyJunctionCandidate` (`distance-associator.js:2554`), which fires when *either* label OR
**region** degree ≥3. But that path is **DWG-only** (`parser/dwg/coordinate-calculator-dwg.js:341`)
and requires `topologyNeighborsByPost` from `buildCableTopologyMaps` over region cable edges. The
LC region fixture exists (`luizcarolino-dwg-region.json`, 103 posts / 117 cableEdges) BUT its posts
carry **no post numbers** (raw UTM + `block` only — verified) and are resolved to route numbers at
runtime by GPS proximity, which the PDF path does not have. **Extending region-degree topology
rehome to the PDF path is the RISK-2 trip** (cross-page + DWG-only assumptions) and is the heavier,
riskier route.

### Recommendation
- Cheapest, safest, highest-yield first move is to **tighten the false-bifurcation loop** so it
  stops nulling true consecutive steps at posts 2/3/4 and 10/11/12. The loop's gate is
  `bifurcationDetourRatio < 1.08` (`distance-associator.js:1532`) plus the
  `dJunc < dTap * JUNCTION_CLOSER_RATIO` (0.9) test (`:1550`) and `MAX_MAIN_CHORD_GAP_PT = 90`
  (`:1320`). One of these is too permissive for LC's scale → it accepts a non-bifurcation as a
  bifurcation. Diagnose which guard the post-2/post-10 cases pass that they should fail.
- For **06–07** specifically, prefer a **geometric mid-street guard** that does NOT require a
  label-graph junction: detect that a label sits on a *tap stub* off the `6→7` chord (cable
  overlap + the consecutive chord is much longer than the label) and refuse to consume it for the
  consecutive step, letting the real `6→7 = 37.7` label be associated. This avoids RISK-2 entirely.
- Treat the region-degree-on-PDF extension as a **fallback only** if the geometric guard cannot
  separate cluster B without regressing Siriu — and flag it as RISK-2 when proposed.

---

## Q3 — Root cause of the 21–31 rigid ~179 m offset

### Evidence

**Offset decomposition** (`debug-lc-offset-vs-deform.mjs`):
```
=== segment 1-20 ===
mean offset 167.2 m @ 344°; residual after de-translation: mean 118.9 m, max 172.6 m
  posts 4-11 (page 4): err 187-272, bearing ~300-328°, residual 108-130 m
  posts 12-20 (page 5): err ~230, bearing ~7°, residual ~100-108 m

=== segment 21-31 ===
mean offset 178.9 m @ 303°; residual after de-translation: mean 9.6 m, max 40.0 m
  posts 21-31 (page 4): err ~165-176 (post31=218), bearing ~303°, residual ~5-11 m
```

**Calibration warnings** (live `calculateCoordinates` run):
```
[label-lsq] Global label fit: RMSE 68.25 m → 35.08 m (30 segments, 2 page(s) adjusted; θ: p4=0.00°, p5=0.00°).
[seam-lock] Skipped — multi-sheet route (global label-lsq fit page origins).
[boundary-locked] 3 page origin(s) re-aligned after label chain at sheet breaks.
[split-region] anchor page has 3 posts (<6) — skipped.
[distortion-zone] anchor page has 3 posts (<6) — skipped.
```

**Page assignment (decisive):** posts **4–11 and 21–31 are BOTH on page 4**; posts 12–20 on page 5;
posts 1–3 on page 3 (the anchor page). The route physically loops out (4–11) and returns (21–31)
on the same PDF sheet (the TRAVESSA crossing).

### Answer

The multi-sheet calibration fits **one UTM page-origin per PDF page**
(`refinePageOriginsByLabelLsq`, `coordinate-calculator.js:1376`; warning shows only `p4` and `p5`
adjusted). Because posts 4–11 and 21–31 share page 4's single origin, the least-squares fit lands
that origin as a **compromise between two geographically separate clusters**, leaving 21–31
translated ~179 m @ 303° as a rigid block. The per-page UTM *scale/rotation* is correct
(`θ: p4=0.00°`), which is why the 21–31 **shape** is right (residual ~10 m) — only the
**translation** is wrong.

`seam-lock` is skipped by design for `viewportBoxes.length >= 3` (`coordinate-calculator.js:1420`,
the `multiSheetDetail` branch) — the comment at `:1417` notes post-1→15 seam-lock drifts ~55 m on
João Born, so it was disabled for 3+ detail sheets in favor of the global label-LSQ. That global
fit then can't separate two clusters on one page.

**Shared-offset confirmation:** posts 4–11 carry bearing ~303–328° (same direction as 21–31's
303°), so the **same wrong page-4 origin injects ~179 m into BOTH the 4–11 and 21–31 clusters.**
Fixing the page-4 origin therefore removes the rigid component from both segments at once
(4–11 still needs the Q2 association fix for its internal deformation; 21–31 needs nothing else).

### Answer — most promising fix locus

**Split the page-4 origin into per-cluster sub-origins.** Page 4 contains two disjoint route runs
(4→11 and 21→31) joined only across page 5. The fix locus is the global page-origin fitter —
`refinePageOriginsByLabelLsq` (`parser/geo/label-lsq-calibrator.js:1842`, called from
`coordinate-calculator.js:1376`) and/or `lockPageOriginsAtSheetBreaksFromPriorProjection`
(`coordinate-calculator.js:73`). The cleanest generic approach: when a single page hosts **two
route segments separated by a sheet excursion** (page sequence p4→p5→p4), treat them as two
independently-anchored sub-pages, each origin locked from its own entering sheet break
(post 11→12 boundary for the first run; post 20→21 boundary for the second). Note
`[split-region]` ALREADY exists for exactly this family of problem but is skipped here
(`anchor page has 3 posts (<6)`) — the threshold/scope of `refineAnchorPageBySplitRegion`
(`coordinate-calculator.js` imports it at `:43`) is the most promising existing hook to adapt.

### Recommendation
Prioritize the page-4 split-origin fix — it is the single highest-leverage change (removes ~179 m
from 11 posts in 21–31 and the rigid part of 8 posts in 4–11). Do **not** attempt to close 21–31
with label/mid-street fixes (only ~10 m residual slack exists). Investigate why
`refineAnchorPageBySplitRegion` is gated out (the `<6 posts` threshold) and whether the page-4
*second run* (21–31, 11 posts) qualifies on its own.

---

## Q4 — Which tracked risks are actually implicated

| Risk | Implicated by LC? | Evidence | Note |
|------|-------------------|----------|------|
| **RISK-1** (scale-dependent thresholds) | **YES — for Task A** | The false bifurcation at posts 2/10 means a same-page-bifurcation guard threshold is too loose at LC's PDF scale. Candidates: `MAX_MAIN_CHORD_GAP_PT=90` (`distance-associator.js:1320`), `JUNCTION_CLOSER_RATIO=0.9` (`:1319`), `bifurcationDetourRatio < 1.08` (`:1532`). Also `ARM_NEAR_JUNCTION_PT=150`, `ARM_BEARING_STRONG_DEG=12`, `ARM_ON_CABLE_STRONG_PT=14` (`:2198-2202`) govern the (non-firing) rehome — only relevant if a mid-street guard reuses them. | These are PDF-point thresholds tuned to Siriu. LC pages are 1191×842 (same viewport as Siriu) so scale may be similar; the failure is more likely a *false-positive geometry* than a raw scale mismatch — confirm before moving a constant. |
| **RISK-2** (cross-page + DWG-only) | **YES — only if Task A takes the region-degree route** | 06–07 is invisible to the label graph (Q2). The only existing detector that sees it is `applyTopologyBranchArmRehome` (`distance-associator.js:2642`), which is DWG-only (`coordinate-calculator-dwg.js:341`) and reasons in post-number space (`MIN_CROSS_PAGE_ARM_GAP=15`, `CROSS_PAGE_JUNCTION_LOOKBACK=18`, `priorPage=entryPage−1`). Routing the PDF path through it trips RISK-2. | **Avoidable** — prefer the geometric mid-street guard (Q2) which needs no region/post-number reasoning. |
| **RISK-3** (destructive same-page rehome) | **NO for the recommended path; YES if a same-page clear is added** | The recommended Task A *adds a guard that prevents a destructive clear* (the false-bifurcation null of `3→4`/`11→12`) rather than introducing a new destructive rehome. If instead a same-page topology rehome is added for 06–07, it would `clearEdge`+refill (RISK-3) and could corrupt under a wrong RISK-1 threshold. | The Task B page-origin fix is pure calibration — touches no association, so RISK-3 N/A there. |

**Siriu-tuned constants that may need to move (named, with current value + adaptivity verdict):**

| Constant | File:line | Current | Verdict |
|----------|-----------|---------|---------|
| `MAX_MAIN_CHORD_GAP_PT` | `distance-associator.js:1320` | 90 (pt) | Likely too permissive for LC false-bifurcation; **make adaptive** — derive from local consecutive-chord length / per-page scale, not a flat PT literal. |
| `JUNCTION_CLOSER_RATIO` | `distance-associator.js:1319` | 0.9 | Candidate to tighten; prefer **adaptive** (ratio of label-to-junction vs label-to-tap normalized by chord). |
| `bifurcationDetourRatio` threshold | `distance-associator.js:1532` | `< 1.08` | The detour gate; raising it would reject the false LC bifurcations. **Make adaptive** to chord scale. |
| `ARM_NEAR_JUNCTION_PT` etc. | `distance-associator.js:2198-2202` | 150/12/14 (pt/deg/pt) | Only relevant if a mid-street guard reuses the classifier; if so, derive PT thresholds from per-page scale. |
| `split-region` min-posts gate | `coordinate-calculator.js` (`refineAnchorPageBySplitRegion`) | `<6` posts skipped | For Task B: the page-4 second run is 11 posts — should qualify; verify the gate counts per-run, not per-page. |

**Guardrail check:** none of the recommended changes introduce post-number literals — all are
geometric/scale-derived. Keep that bar.

---

## Q5 — João Born gate bootstrap

### Evidence

- **Source PDF exists in repo:** `INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf` (verified).
- **Ground truth exists:** `parser/__tests__/fixtures/joaoborn-ground-truth.json` (35 posts).
  Per the 260602-lbl HANDOFF, GT post 35 is a typo (lat −27.97); the PDF parses 34 posts so the
  harness matches 34 and never touches post 35.
- **Live PDF harness run** (reusing `tools/route-pdf-accuracy-harness.mjs` against the JB GT):
```
=== JB PDF harness ===
matched 34 mean 27.01 max 45.84
  worst: post 9 41.7, posts 26-34 ~40-46 (systematic), localized bump posts 9-11
```
- **JB parse health** (`debug-lc-rehome-trace.mjs jb`): `posts 34, viewportBoxes 3
  (multiSheetRoute=true), pages [3,4,5]`. One real sheet-break bifurcation at post 13
  (`10.9→13→14, 38.9→13→15`) handled correctly; a false bifurcation cluster at posts 3–6 and
  13–15 similar to LC but much milder.

### Answer

João Born's **PDF path is already healthy (mean 27 m, max 46 m)** — far better than the DWG-region
walk's "mean 142 m" quoted in the old HANDOFF (that figure was the DWG path, not the PDF path). The
residual is a **systematic ~40 m offset on posts 26–34** (the same multi-sheet page-origin family
as LC Q3, milder) plus a localized bump at posts 9–11. No catastrophic deformation.

**Minimal path to a JB gate (mirror the LC trio):**
1. Create `tools/run-route-joaoborn-pdf-accuracy-gate.mjs` — copy of
   `tools/run-route-pdf-accuracy-gate.mjs` with `PDF_PATH` → the JB PDF, `GT_PATH` →
   `joaoborn-ground-truth.json`, `BASELINE_PATH` → a new `joaoborn-pdf-baseline.json`, and the env
   var renamed (e.g. `JOAOBORN_UPDATE_BASELINE`). No harness changes — `route-pdf-accuracy-harness.mjs`
   is already route-agnostic.
2. Generate the baseline (the gate auto-writes on first run when the baseline is absent — same
   `slackM` ceiling logic). Initial ceilings will lock at the current mean-27 m profile.
3. Optionally tighten JB ceilings if the Task B page-origin fix also improves posts 26–34.

### Recommendation
Keep JB lightweight: build the gate, snapshot the current ~27 m baseline, and only ratchet if the
shared page-origin fix (Task B) happens to help posts 26–34. Do not block on a JB association fix —
the PDF path does not need one.

---

## Q6 — PDF cable-fork signal (prove or kill)

**Researched:** 2026-06-03 (same session, after Task 2 GATED-partial)
**Full report:** `260603-acc-RESEARCH-cablefork.md`

### Verdict

**KILLED `[VERIFIED: live]`** — a junction signal derived from PDF `cablePaths` / drawn cable
branch-points **cannot separate genuine from false bifurcations**:

- Genuine junctions with any drawn branch-point within 20 pt: **TP = 0 / 12** (LC, Siriu, JB).
- Posts sit **~30 pt off** the cable centerline (bimodal with ~7 pt on-cable); at junction posts the
  local cable geometry has no fork vertices to measure.
- LC false-bifurcation posts 2/3/10/11 show **more** fork signal than genuine taps 6/7/23 (inverted).

### Implications (decisive for planning)

| Path | Status after Q6 |
|------|-------------------|
| PDF-cable-fork gate on branch-A / sheet-break (`distance-associator.js:1539`, `:1803`) | **Do not pursue** — would reject every genuine Siriu/JB bifurcation (TP=0) and preferentially keep LC false positives |
| Label-only tightening of sheet-break bifurcation | Still **GATED** — feature overlap with Siriu genuine (Task 2 diagnostic); unchanged by Q6 |
| Geometric mid-street guard for 06–07 / 22–23 | **Still viable** — orthogonal to cable-fork |
| **DWG region-degree → PDF post cross-walk** | **Central unlock** — the only route-independent junction signal that works; same prerequisite as the inline GATED note at `distance-associator.js:1799` |

Q6 neither proves nor refutes H2 (offset downstream of deformation). Testing H2 still requires a
deformation fix via geometric guard and/or DWG cross-walk, then re-running `debug-lc-offset-vs-deform.mjs`.

---

## Q7 — LC `Distância_Poste` label → edge assignment inventory

**Researched:** 2026-06-03  
**Full report:** `260603-acc-RESEARCH-label-assignments.md`  
**Reproduce:** `node debug-lc-label-assignments.mjs`

### Verdict

**Documented `[VERIFIED: live parsePdf]`** — every `Distância_Poste` item (84 total, 69 numeric)
is traced through greedy sequential, window-refine, bifurcation, and jumpback phases to a final
post-pair edge or `UNASSIGNED`.

### Deformation-cluster failures (posts 1–20)

| Failure | Final state | Mechanism |
|---------|-------------|-----------|
| Post **2** bifurcation | **2→4** main; **3→4** null | `applyBifurcationJunctionLabelRehome` tapMain |
| Post **10** bifurcation | **10→12** main; **11→12** null | Same |
| **6→7** | **13.8** m (not ~37.7) | legacy-midpoint short label wins |
| **9–11** triple | **9→10**, **10→11**, **9→11** | window-refine + inferred |
| Branch returns | **3→1**, **9→11**, **11→8** | `inferDistanceEdgesFromLabels` |
| **20→21** | **29.8** m | jumpback-refill (not true sheet hop) |

### Implications

- **H2 strengthened:** corrupted edges above feed `refinePageOriginsByLabelLsq` on pages 3–5.
- **Task 2 (deformation)** should fix these assignment rows; `rehomeBranchArmLabels` alone does not
  address **6→7** (degree-2) or bifurcation nulls at **2/10**.
- **Mid-street ratio guard** (`pdfM/meters > 1.35`) and **global tap-leg corroboration** were tried
  and reverted / kept opt-in — see label-assignments report §Implications.
- Full per-label row table stays in the debug script output (not duplicated in RESEARCH to avoid drift).

### Q3 supersession (Task 1 execution)

The page-4 **two-run origin split** recommended in Q3 was **empirically disproven** in Task 1
(commit `fe22316`): both page-4 runs share the same ~175 m @ 303° offset; the problem is
multi-page label-chain drift, not a same-page compromise. Held-in-reserve fix: per-page UTM grid
anchors (`debug-lc-utmgrid-probe.mjs`). See `260603-acc-CONTEXT.md` revised sequencing (A → re-measure → B → C).

---

## Runtime State Inventory

This is a code/algorithm-accuracy task (no rename/migration), but it has external file
dependencies and generated baselines:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — gates run live `parsePdf` over source PDFs each time | None |
| Live service config | None | None |
| OS-registered state | None | None |
| Secrets/env vars | Gate refresh env vars: `LUIZCAROLINO_UPDATE_BASELINE`, (new) `JOAOBORN_UPDATE_BASELINE` — code-only, no secret | None |
| Build artifacts / baselines | `luizcarolino-pdf-baseline.json` (per-post ceilings, tighten on improvement); new `joaoborn-pdf-baseline.json` to create | Regenerate baselines via the gate's `*_UPDATE_BASELINE=1` path only after a proven improvement; never loosen to pass |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node + `node_modules` | All gates/harness (live `parsePdf`) | ✓ | (main tree) | — must run on main tree, not a worktree |
| LC source PDF | LC PDF/DWG gates | ✓ | `INFOVIAS_AAF INTERNET_São José_RUA LUIZ CAROLINO PEREIRA_v1.pdf` | — |
| JB source PDF | JB gate (to build) | ✓ | `INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf` | — |
| LC/JB DWG region fixtures | DWG path (region topology) | ✓ | `luizcarolino-dwg-region.json`, `joaoborn-dwg-region.json` (raw UTM, no post numbers) | — |
| pdfjs standard fonts | parse (cosmetic warnings only) | partial | warns `Unable to load font data` | benign — parse completes |

**No blocking gaps.** All four existing gates run; LC PDF gate confirmed green at baseline
(`matched=31, mean=185.63 m`).

---

## Recommended task slicing

> Sequencing is LOCKED by CONTEXT: LC deformation (1–20) → LC anchoring (21–31) → João Born.
> One important nuance from the evidence: **Task B (page-4 origin split) is the single
> highest-leverage change and benefits BOTH segments.** Within the locked order, Task A must still
> ship first (and lock its ceilings), but the planner should note that Task A alone will NOT reach
> ~15 m on posts 4–11 until Task B removes their shared ~179 m component.

### Task A — LC branch-label deformation (posts 1–20)
**Goal:** stop the false bifurcations that null `3→4` and `11→12`, and stop the 06–07 mid-street
label theft, so the consecutive chain is intact.
- **Files/functions:**
  - `parser/distance-associator.js` — the same-page bifurcation loop
    `applyBifurcationJunctionLabelRehome` (`:1306`), specifically the bifurcation acceptance gates
    at `:1530-1608` and constants `MAX_MAIN_CHORD_GAP_PT=90` (`:1320`),
    `JUNCTION_CLOSER_RATIO=0.9` (`:1319`), `bifurcationDetourRatio < 1.08` (`:1532`).
  - Add a **geometric mid-street guard** (no label-graph junction required) reusing
    `classifyBranchArmLabel` / `labelGapToSegment` to recognize a tap stub off the consecutive
    chord (06–07; also helps 22–23).
- **Risks tripped:** RISK-1 (a scale-dependent bifurcation/chord threshold likely must move →
  prefer adaptive, derived from per-page scale, not a literal). RISK-3 if any new destructive
  clear is added (avoid — make the change *preventive*). RISK-2 ONLY if the planner chooses the
  region-degree-on-PDF route (discouraged).
- **Validation:** `run-route-pdf-accuracy-gate` (tighten LC ceilings for posts 3,4,6,9,10,11,12),
  Siriu/Valmor must not regress, `branch-traversal.test.mjs`.
- **Open decisions for the planner:**
  1. Geometric mid-street guard vs region-degree-on-PDF (RISK-2). Evidence favors geometric.
  2. Which exact bifurcation guard is too loose for posts 2/10 — needs a one-off diagnostic on
     those clusters (extend `debug-lc-truth-vs-edges.mjs`) before changing a constant.

### Task B — LC anchoring offset (posts 21–31, also fixes 4–11 rigid component)
**Goal:** give page 4's two disjoint route runs (4→11 and 21→31) independent origins so the
~179 m block translation disappears.
- **Files/functions:**
  - `parser/coordinate-calculator.js` — `refinePageOriginsByLabelLsq` call site (`:1376`),
    `lockPageOriginsAtSheetBreaksFromPriorProjection` (`:73`), and the existing
    `refineAnchorPageBySplitRegion` hook (imported `:43`, currently skipped: `[split-region] anchor
    page has 3 posts (<6)`).
  - `parser/geo/label-lsq-calibrator.js` — `refinePageOriginsByLabelLsq` (`:1842`).
- **Risks tripped:** RISK-2 (multi-sheet/page-origin assumptions are the least portable; the fix
  must NOT assume `priorPage = entryPage − 1` or single-run-per-page). No RISK-1/RISK-3 (pure
  calibration, no association change).
- **Validation:** `run-route-pdf-accuracy-gate` (tighten LC ceilings for posts 21–31 toward ~10 m;
  posts 4–11 drop by the shared ~179 m once split). Siriu/JB must not regress.
- **Open decisions for the planner:**
  1. Generalize via a "single page hosts two sheet-separated route runs (p4→p5→p4)" detector vs
     adapt the `<6 posts` `split-region` threshold. Prefer the former (more principled, generic).
  2. Where to anchor each sub-origin: from its own entering sheet break (post 11→12 and post 20→21)
     using the already-correct per-page UTM scale.

### Task C — João Born gate + (optional) shared-fix uplift
**Goal:** lock a JB PDF accuracy baseline; ratchet only if Task B helps posts 26–34.
- **Files/functions:**
  - New `tools/run-route-joaoborn-pdf-accuracy-gate.mjs` (copy of
    `tools/run-route-pdf-accuracy-gate.mjs`, repoint PDF/GT/baseline + rename env var).
  - New fixture `parser/__tests__/fixtures/joaoborn-pdf-baseline.json` (auto-generated by the gate).
  - Reuse `tools/route-pdf-accuracy-harness.mjs` unchanged (already route-agnostic).
- **Risks tripped:** None for the gate itself. If Task B's page-origin generalization is applied,
  re-run JB to confirm no regression and tighten posts 26–34 (RISK-2 surface — verify).
- **Validation:** new JB gate green at the snapshot baseline (mean ~27 m, max ~46 m);
  existing four gates unaffected.
- **Open decisions for the planner:**
  1. Baseline now at mean 27 m (no fix) vs after Task B (potentially lower for 26–34). Recommend
     snapshot-now, then tighten post-Task-B if improved — keeps JB green and bisectable.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The page-4 single-origin compromise is THE cause of 21–31's offset (vs a separate wrong sheet-break lock) | Q3 | If a different calibrator places page 4, Task B targets the wrong locus; mitigated — the `θ: p4=0.00°` + per-cluster bearing match is strong corroboration. |
| A2 | Tightening one bifurcation guard fixes posts 2/10 without regressing Siriu/Valmor | Q2/Q4/Task A | Could regress a real Siriu bifurcation — requires the per-cluster diagnostic before touching a constant (called out as an open decision). |
| A3 | `refineAnchorPageBySplitRegion`'s `<6 posts` gate is the relevant hook for the page-4 split | Q3/Task B | If split-region is scoped differently, a new detector is needed instead; low risk — it is the only existing same-page-split mechanism. |

## Open Questions

1. **How to bring DWG region-degree junction detection to the PDF bifurcation path?** *(Q6 + Task 2 GATED-partial)*
   - PDF cable-fork is dead (Q6). Sheet-break bifurcation overlaps Siriu genuine (`f20f4b2`).
   - Recommendation: spike DWG region neighbors cross-walked onto PDF posts; gate bifurcation only when
     `isTopologyJunctionCandidate` is true for the junction post.
2. **Can the 06–07 mid-street label be separated purely geometrically (no region)?**
   - Q6 confirms cable-fork cannot see it; prototype geometric guard in parallel with (1).
3. **LC posts 2/10 — which guard?** Branch-A `tapLegM=null` fix reverted; needs (1), not label heuristics.


## Sources

### Primary (HIGH confidence — live this session, main tree)
- `debug-lc-rehome-trace.mjs` (created) — multiSheetRoute/cablesByPage/rehome-warning trace + edge dump (LC & JB).
- `debug-lc-truth-vs-edges.mjs` (created) — consecutive truth-step vs associator-edge delta table (LC).
- `debug-lc-degree.mjs` (created) — label-graph degree + post→page map (LC & JB).
- `debug-lc-offset-vs-deform.mjs` (pre-existing, re-run) — rigid-offset vs residual decomposition (LC).
- Live `calculateCoordinates` warning capture (LC calibration: label-lsq RMSE 68→35, seam-lock skip).
- Live `runRoutePdfAccuracyHarness` against João Born GT (mean 27.01 m, max 45.84 m).
- `node tools/run-route-pdf-accuracy-gate.mjs` — PASS, matched=31, mean=185.63 m (baseline confirmed green).
- `260603-acc-RESEARCH-cablefork.md` — PDF cable-fork prove-or-kill (TP=0/12, KILLED).
- `260603-acc-RESEARCH-label-assignments.md` — LC `Distância_Poste` → edge inventory (Q7).
- `debug-lc-label-assignments.mjs` — live reproduce script (untracked).
- Source reads: `parser/pdf-parser.js:751,764-784`; `parser/distance-associator.js:852-898,1306-1608,1820-1856,2197-2202,2214-2343,2554-2570,2642-2652`; `parser/coordinate-calculator.js:1340-1477`; `parser/dwg/coordinate-calculator-dwg.js:315-350`; `parser/dwg/graph-walker.js:669,749`.

### Secondary (CONTEXT-provided, corroborated)
- `260603-acc-CONTEXT.md` (two-root-cause split, RISK-1/2/3 definitions) — all corroborated live.
- `260602-lbl-SUMMARY.md` / `260602-lbl-HANDOFF.md` (rehome rationale, JB GT post-35 typo).
- `260602-decouple-SUMMARY.md` (DWG-only topology rehome provenance).

## Metadata

**Confidence breakdown:**
- Q1 (rehome fires but no-ops): HIGH — direct trace + label-graph degree.
- Q2 (three deformation clusters; 06–07 label-graph-invisible): HIGH — edge-vs-truth table.
- Q3 (single page-4 origin causes 21–31 offset): HIGH — page map + θ=0 + per-cluster bearing match.
- Q4 (risk mapping): MEDIUM-HIGH — RISK-1/RISK-2 implication clear; exact constant TBD by diagnostic.
- Q5 (JB gate scope): HIGH — JB PDF harness ran clean at mean 27 m.

**Research date:** 2026-06-03
**Valid until:** 2026-07-03 (stable internal codebase; re-verify if `distance-associator.js` or `coordinate-calculator.js` change)
