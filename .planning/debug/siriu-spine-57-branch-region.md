---
status: phase1-fixed; phase2-blocked-at-post-65-hub-branch-entry
trigger: Posts 57–58–59 spine spike (~240m); cross-sheet cable gaps; complex branch region 60–85
created: 2026-05-29
updated: 2026-05-29
priority_angle: DWG graph-walker vs PDF coordinate-calculator numbers must not be conflated in harness output
related_sessions:
  - .planning/debug/siriu-post45-cascade.md
  - .planning/debug/dwg-graph-walk-no-candidate.md
  - .planning/debug/resolved/siriu-tap-blocks-spine-25.md
harness: debug-run-calc-dwg-from-pdf-siriu.mjs
probes: debug-claimed-at-58.mjs, debug-dwg-vs-pdf-57.mjs, debug-spine-57-probe.mjs, debug-gps-43-trace.mjs
ground_truth: coordenadas postes siriu.txt
branch: fix/siriu-post45-phantom-hint
commits:
  - 23334cd fix(dwg-walk): place spine posts 57–64 across cable gaps
  - d51d1a9 fix(dwg): branch-return at post 45 and swapped bifurcation labels at post 48
  - b4e357f fix(dwg): reject phantom inferred-label hint when direct consecutive neighbor matches
---

# Siriu DWG walker — spine 57–64 and branch region 60–85

## Current state (2026-05-29)

### What is fixed (graph-walker only)

| Region    | Issue                                                                                          | Fix                                                                                                       | Verified (standalone walk) |
| --------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------- |
| **57→58** | No cable edge idx 2↔1 (~43 m chord); PDF tap 19.3 m misroutes via hint/multi-hop to idx 75/443 | `dwg-bifurcation-tap-chord`: place INSERT by (tap+main)/2 span; block hint jumpback + Case B on tap edges | **6.74 m** (idx 1)         |
| **58→59** | `labelM` cleared (bifurcation-cleared); gap edge                                               | Existing tap-continuation: 1→46                                                                           | **1.87 m** (idx 46)        |
| **59→60** | Label 31.7 m vs chord 46→44 ~51.5 m; multi-hop picked wrong stub idx 0                         | `dwg-spine-chord-next-label`: prefer INSERT whose next cable hop fits 60→61                               | **1.83 m** (idx 44)        |
| **60–64** | Spine chain                                                                                    | Direct / existing logic                                                                                   | **< 2.1 m** each           |

**Standalone walk** (`pairPostsByGraphWalk`, minimal `calculateCoordinates` — no UTM grid, no `gpsByPostNumber`):

```
Post  DWG err(m)  idx
 55      3.64  164
 56      0.21  165
 57      5.41  2
 58      6.74  1
 59      1.87  46
 60      1.83  44
 61      1.69  169
 62      2.01  43
 63      1.79  170
 64      0.99  40
 65    170.45  45   ← auxiliary tap; not on main spine (expected wrong until branch logic)
```

**GW_TRACE spine path (correct topology):**

```
56→57  165→2     label 33.0
57→58  2→1       bifurcation-tap-chord (main 57→59 = 60.9)
58→59  1→46      gap, tap continuation
59→60  46→44     spine-chord-next-label
60→61  44→169
61→62  169→43
62→63  43→170
63→64  170→40
```

### What is NOT fixed yet

| Item                                            | Status                                                                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **E2E harness** (`calculateCoordinatesWithDwg`) | **FIXED (Phase 1)** — `dwgStatus: dwg-graph-walk`; spine 57–64 all **< 7 m**                                                    |
| **Post 65+**                                    | **BLOCKED (Phase 2)** — see [Phase 2 progress](#phase-2-progress-post-65-branch-entry) below                                    |
| **Valmor / João Born regression**               | Not re-run this session after Phase 1 fix                                                                                       |

---

## Phase 1 — GPS confirmer fix (DONE 2026-05-29)

### Root cause (confirmed, fixed)

`findBifurcationTapChordTarget` GPS branch (added in 23334cd) unconditionally returned the GPS-nearest in-window candidate, overriding the span-based pick at **post 24** (idx 421 vs correct 145). Wrong arm through posts 24–42 dead-ended at idx 368 → `ambiguous` at post 43 → harness `pdf-fallback`.

### Fix (`parser/dwg/graph-walker.js`)

1. Compute span-based shortest-leg pick first (`spanBestIdx`).
2. GPS may **confirm** (same idx as span pick) or **break a genuine span tie** (candidates within 0.5 m of best span, GPS distance clearly small).
3. Never override a shorter span leg with a GPS-nearer longer chord.

### Verification gates (all green)

```
node debug-gps-43-trace.mjs
  NO-GPS:   ok=true  post 24 idx=145
  WITH-GPS: ok=true  post 24 idx=145
  First divergent post: null

node debug-run-calc-dwg-from-pdf-siriu.mjs
  dwgStatus: dwg-graph-walk
  57–64 errors: 5.41, 6.74, 1.87, 1.83, 1.69, 2.01, 1.79, 0.99 m

node --test parser/__tests__/graph-walker.test.mjs           → 4/4
node --test parser/__tests__/coordinate-calculator.test.mjs  → 22/22
node --test parser/__tests__/distance-associator.test.mjs    → 11/11
```

---

## Phase 2 progress — post 65 branch entry

### Probe (`GW_RETURN_IDX=1 node debug-claimed-at-58.mjs`)

Spine 57–64 correct. At **64→65** the walker uses `dwg-bifurcation-tap-chord` from idx **40** (post 64) and picks idx **45** → **170 m** GT error.

```
[gw] 63->64  170->40
[gw] 64->65  40->45   label 7.8  bifurcation-tap-chord chord_span ~31 m
[gw] 65->66  45->39   gap
```

### Why this is blocked (not a one-line chord fix)

| Issue | Detail |
| ----- | ------ |
| **Wrong label origin** | Associator tags **64→65** as `bifurcation-tap` (7.8 m); true topology is **60→65** from hub idx 44. Cannot change `distance-associator.js` per constraints. |
| **No cable edge** | Hub idx 44 (post 60) cable neighbors: `[169, 3]` only — post 65 INSERT is off-cable (chord placement required). |
| **Tap ≠ chord** | PDF 7.8 m is tap to street middle; GT-nearest INSERT for post 65 is idx **0** (2.6 m err) at **32.7 m** chord from hub — not the smallest span in window. |
| **GPS unreliable here** | Branch-page GPS anchor ~60–120 m from candidates; GPS confirmer cannot disambiguate idx 0 vs 169 vs 45. |

### Next step (future session)

Implement **hub branch-entry** at 64→65: detect mis-placed bifurcation-tap (chord span ≫ tap label), jump back to visited hub post **60** (idx 44), place 65 via chord + next-label check for 65→66 (22 m). May also need associator-side label rehome (60→65 tap) — currently out of scope for graph-walker-only constraint.

**Stop here** per session scope — do not implement 66–69 / 70 bifurcation / 62→81 until 65 is cleanly placed.

---

## Critical: PDF numbers ≠ DWG walker numbers

The harness `debug-run-calc-dwg-from-pdf-siriu.mjs` prints two different tables. **Do not mix them.**

| Output section                                               | Meaning                                                | Posts 57–58 example               |
| ------------------------------------------------------------ | ------------------------------------------------------ | --------------------------------- |
| `Post  source  err(m)` with `pdf`                            | **PDF coordinate-calculator** after DWG cascade failed | ~224–237 m — **not** the walker   |
| `Partial DWG coords` (only if partial returned)              | Walker coords before failure                           | Often empty when walk fails early |
| **`debug-claimed-at-58.mjs`** or walk with `GW_RETURN_IDX=1` | **True DWG walker** vs GT                              | 5.41 m / 6.74 m                   |

**Why harness shows PDF for 57+:** With production path (`gpsByPostNumber` from full UTM `calculateCoordinates`), `pairPostsByGraphWalk` fails at post **43** and never assigns DWG coords to later posts. Cascade falls back to PDF for the whole route.

**Without GPS** (minimal PDF calc, same connections): walk **`ok=true`** through post 85; spine 57–64 errors as in table above.

---

## Topology (user-confirmed, for 60–85 work)

### Main spine (sheet 6→7)

- **57–58–59** on spine (cross-sheet “VER PRANCHA 07” near 58–59).
- Spine runs straight **59→64** on DWG INSERTs: 46→44→169→43→170→40 (GT-nearest).

### Branch / auxiliary region (not implemented)

```
59–64  main spine (horizontal)
60     hub
  ├─ down → 65, post between 59 - 60 in the map (7.8 m to street middle + 22 m to 66)
  ├─ parallel 66–67–69
  ├─ return to 60 → up → 69–70 (71 on map)
  │     └─ bifurcation at 70: → 73 (left) or → 80 (right)
  └─ at 62: branch → 81–85
```

PDF labels (associator):

| Edge  | meters | source              |
| ----- | ------ | ------------------- |
| 56→57 | 33     | legacy-midpoint     |
| 57→58 | 19.3   | bifurcation-tap     |
| 57→59 | 60.9   | bifurcation-main    |
| 58→59 | null   | bifurcation-cleared |
| 59→60 | 31.7   | legacy-midpoint     |

### DWG cable graph gap (why chord logic exists)

GT-nearest INSERTs and **Euclidean** spans (no cable edge between consecutive spine INSERTs):

| Step | idx | span             | cable neighbors          |
| ---- | --- | ---------------- | ------------------------ |
| 57   | 2   | —                | only 165 (back)          |
| 58   | 1   | 2→1 = **43.0 m** | only 46                  |
| 59   | 46  | 1→46 = 33.0 m    | 44 not adjacent in graph |
| 60   | 44  | 46→44 = 51.5 m   | 169                      |

---

## Code changes (`parser/dwg/graph-walker.js`, commit 23334cd)

1. **`findBifurcationTapChordTarget`** — chord-place tap post when cable stuck; target span ≈ `(tapLabel + mainLabel) / 2`; exclude short INSERTs matching misleading tap; optional GPS tie-break.
2. **Early chord** before hint jumpback; suppress tap multi-hop and Case B on bifurcation-tap edges.
3. **`findSpineChordByNextLabel`** — when multi-hop wins on consecutive label but next-hop from chord INSERT fits next label better (59→60).
4. **`gpsByPostNumber`** passed from `coordinate-calculator-dwg.js` (already wired).

---

## Prior session (posts 45–55) — see `siriu-post45-cascade.md`

- Post 45 phantom hint: **fixed** (b4e357f).
- Branch return at 36→45 terminal: **fixed** (d51d1a9).
- Post 48 swapped bifurcation labels: **fixed** (d51d1a9).
- Posts 45–56 standalone: generally **< 8 m** when walk completes without GPS.

---

## Next steps (ordered)

1. **Harness blocker:** Debug post **43** `ambiguous` with `gpsByPostNumber` + full UTM — why minimal walk succeeds but production path fails.
2. **Clarify harness output:** Split “DWG walker (standalone)” vs “cascade result (PDF fallback)” in `debug-run-calc-dwg-from-pdf-siriu.mjs` (see `debug-dwg-vs-pdf-57.mjs` sketch).
3. **Post 65 auxiliary:** 7.8 m street + 22 m to 66 — tap / chord / branch-entry from post 60.
4. **Post 70 bifurcation:** 73 vs 80 arms.
5. **Post 62 → 81–85** branch.
6. Re-run **Valmor** and **João Born** harnesses after harness unblocked.

---

## Constraints (unchanged)

- Do **not** modify `parser/dwg/region-pairing.js` or `parser/coordinate-calculator.js`.
- Prefer fixes in `parser/dwg/graph-walker.js`.
- Tests: graph-walker 4/4, coordinate-calculator 22/22, distance-associator 11/11 (last run this session).

---

## INVESTIGATION UPDATE (2026-05-29, continuation)

### Hypothesis CONFIRMED: `gpsByPostNumber` (with real lat/lon) IS the cause

The debug spec was RIGHT. Decisive experiment: `debug-harness-vs-standalone.mjs`.

It builds two `pdfResult`s — one without opts (lat/lon null), one WITH the full UTM
opts (real lat/lon) — then runs `pairPostsByGraphWalk` four ways:

```
standalone-conns + no-gps:        ok=true                          <- works
standalone-conns + std-gps:       ok=false  failedAt=43  ambiguous <- GPS present
harness-conns    + no-gps:        ok=true                          <- works
harness-conns    + harness-gps:   ok=false  failedAt=43  ambiguous <- production path
```

**Connections are EXONERATED:** gap flags 40->46 are IDENTICAL between the two pdfResults
(42->43 gap=true in both); both connection sets succeed without GPS and both fail
identically WITH GPS. The connection-key diffs (`14->16`, `43->45` etc.) do not touch
the 42-43-44 spine region and have no effect on the failure.

**GPS is the sole trigger:** the ONLY variable that flips ok=true → ok=false at post 43
is the presence of a populated `gpsByPostNumber`.

### Why my earlier `debug-gps-vs-nogps-43.mjs` gave a false "both succeed"

That script built `gpsByPostNumber` from `calculateCoordinates(...)` called WITHOUT
opts. With no opts, the calculator logs `opts not provided or incomplete. Posts will
have lat: null, lon: null` and every post's lat/lon is null — so the gps map it built
was effectively EMPTY (every entry skipped by the `p.lat != null` guard). Both its runs
were really no-GPS. The production path builds GPS from a WITH-opts call (real lat/lon),
which is what triggers the bug. Lesson: always build the GPS map from a with-opts
pdfResult when reproducing this.

### Mechanism (where in graph-walker.js GPS flips the result)

Failure is at step **42->43**: `fromIdx=131, gap=true, labelM=null`. The `ambiguous`
return (graph-walker.js:1890-1896) fires only when `labelM == null` AND no `chosenIdx`
was found by any Case A/Case B branch.

Without GPS this step resolves (the no-GPS run reaches 43->44 chosen=74). With a
populated GPS map, one of the GPS-gated code paths changes the decision so that no
candidate survives:
- `findBifurcationTapChordTarget` (gps tie-break, lines 195-211) — only on
  bifurcation-tap edges; 42->43 is not necessarily one.
- `shouldTryBranchReturn` (lines 343-352) — GPS makes the branch-return DECISION:
  `return gpsDist > gpsRadiusM`. When GPS is present this can flip whether branch-return
  is attempted, and a wrongly-taken (or wrongly-rejected) branch-return can leave the
  step with no chosenIdx → `ambiguous`.
- `findBranchReturnArm` next-label/GPS gating.

**NEXT STEP for fix:** add a temporary trace at the 42->43 step that logs, for BOTH
gps and no-gps, the value of: hasHintJumpback, branchEntryStack, shouldTryBranchReturn
result, the gpsDist vs gpsRadius at the relevant junction, and which `chosenIdx` (if any)
each Case sets. The single decision that differs between the two runs at 42->43 is the
fix site. Likely fix: gate the GPS branch-return decision so a null/absent direct match
at a `labelM==null` gap step does not let GPS suppress the fallback that no-GPS uses.

Reproduce precisely with:
```
node debug-harness-vs-standalone.mjs   # writes cmp-result.txt; 4-way table
```

### FINAL ROOT CAUSE (decisive, pinpointed to one code branch)

The divergence is at **post 24** — the `findBifurcationTapChordTarget` GPS branch
(graph-walker.js:195-211) picks the WRONG chord INSERT when GPS is present:

```
NO-GPS:   dwg-bifurcation-tap-chord at_post:24  chord_span_m:39.05  -> idx 145  (CORRECT)
WITH-GPS: dwg-bifurcation-tap-chord at_post:24  chord_span_m:44.10  -> idx 421  (WRONG)
```

Per resolved session `siriu-tap-blocks-spine-25.md` (Evidence), post 24's true INSERT
is **idx 145** (1.97m from GT). The no-GPS walk picks 145 via the span-based fallback.
The GPS walk picks idx 421 via the `gpsByPostNumber?.get(toNum)` block, because post 24's
PDF/GPS anchor in this branch region is imprecise (this page was label-lsq repositioned,
RMSE ~27m per the [label-lsq] log), so the GPS-nearest candidate (421) is not the true
INSERT. From idx 421 the walk takes a wholly different arm for posts 24..42 and finally
dead-ends at idx 368 (degree-0) on the 42->43 gap edge → `ambiguous`. Post 43 is just
where the wrong path runs out of road.

This is a REGRESSION of the resolved `siriu-tap-blocks-spine-25` fix. That fix was
validated WITHOUT GPS. Commit 23334cd later added the GPS tie-break to
`findBifurcationTapChordTarget` (for the 57-64 spine work) and it now overrides the
correct span-based pick at post 24.

The exact offending code (graph-walker.js):
```js
// findBifurcationTapChordTarget, lines ~195-211
if (gpsByPostNumber?.get(toNum)) {        // <-- fires whenever a GPS anchor exists
  let bestIdx = -1; let bestGps = Infinity;
  for (const { idx } of candidates) {
    const g = insertDistanceToGpsPost(regionPosts, idx, gpsByPostNumber, toNum);
    if (g != null && g < bestGps) { bestGps = g; bestIdx = idx; }
  }
  if (bestIdx >= 0) return bestIdx;        // <-- GPS-nearest OVERRIDES span pick
}
// span-based fallback (what no-GPS uses, and what is correct at post 24)
```

The GPS block returns the GPS-nearest candidate unconditionally, with no check that it
is also a reasonable SPAN match. When the GPS anchor is imprecise it picks the wrong
INSERT.

### FIX DIRECTION (single targeted change, graph-walker.js, ~15 lines)

Make the GPS tie-break in `findBifurcationTapChordTarget` a CONFIRMER, not an OVERRIDE:

- Compute the span-based best candidate first (the existing fallback at lines 213-221).
- Only let the GPS-nearest candidate win if EITHER (a) the span-based and GPS-based
  picks agree, OR (b) the GPS-nearest candidate's own span is within the tap chord
  window AND its GPS distance is clearly small (e.g. < gpsRadius like elsewhere,
  ~max(20, 5*tol)). Otherwise keep the span-based pick.

This preserves the 57-64 spine benefit (where GPS agreed with or refined a good span
pick) while preventing an imprecise anchor from overriding a correct span pick at post 24.

Apply the same "confirmer not override" discipline to the GPS gate in
`shouldTryBranchReturn` (lines 343-352) if a later regression surfaces there, but the
post-24 failure is fully explained by the `findBifurcationTapChordTarget` branch alone —
fix that first and re-run the trace.

### Verification gates for the fix
```
node debug-gps-43-trace.mjs
  -> WITH-GPS must show: post 24 idx == 145 (== no-gps), ok=true, no divergence
node debug-run-calc-dwg-from-pdf-siriu.mjs
  -> dwgStatus = dwg-graph-walk (NOT pdf-fallback); spine 57-64 < 10m; post 25 ~1m
node --test parser/__tests__/graph-walker.test.mjs           (4/4)
node --test parser/__tests__/coordinate-calculator.test.mjs  (22/22)
node --test parser/__tests__/distance-associator.test.mjs    (11/11)
```

---

### (earlier note kept for history) divergence framing

`debug-gps-43-trace.mjs` runs the walk with and without a populated GPS map and
diffs the chosen INSERT idx per post. The walks are identical through post 24, then
**diverge at post 25** and never reconverge:

```
post:  nogps / gps
 24:   162 / 162
 25:   163 / 8     <-- FIRST DIVERGENCE
 26:   161 / 9
 27:   160 / 10
 28:   47  / 49
 ...   (entirely different arm 25..42)
 42:   131 / 368
 43:   133 / FAIL (idx 368 has 0 unclaimed neighbors; 42->43 is gap+label=null -> ambiguous)
```

WITH-GPS warnings at the divergence:
```
{kind:dwg-tolerance-relaxed, at_post:25, note:"forced-single-neighbor", picked_distance_m:21.04, label_m:18.7}
{kind:dwg-branch-return,      at_post:26, junction_idx:160, arm_idx:9}
```

NO-GPS does NOT emit the post-26 `dwg-branch-return`. So the GPS map flips a decision
in the **branch-return path** (`shouldTryBranchReturn` / `findBranchReturnArm`, the only
GPS-gated tie-breaks besides `findBifurcationTapChordTarget`). With GPS, post 25/26 is
routed onto the wrong arm (idx 8/9/10 — a parallel branch) instead of the spine
(idx 163/161/160). The walk then traverses an entirely different sub-graph for posts
25-42 and finally hits a dead-end INSERT (368, degree-0 after claiming) at the
42->43 gap edge, where there is no candidate → `ambiguous`. **Post 43 is only where the
wrong path runs out of road; the causal error is the GPS-driven mis-route at post 25.**

This region (post 25 bifurcation/tap) is exactly the subject of the resolved session
`.planning/debug/resolved/siriu-tap-blocks-spine-25.md`. That fix was validated WITHOUT
GPS. The GPS tie-break (added later for the 57-64 spine work, commit 23334cd, the
`findBifurcationTapChordTarget` GPS branch + the `shouldTryBranchReturn` GPS gate at
graph-walker.js:343-352 / 195-211 / 1549-1565) was never validated against the post-25
region and regresses it.

### WHY THE DIVERGENCE HAPPENS (mechanism)

`shouldTryBranchReturn` ends with: `if (gpsDist != null) return gpsDist > gpsRadiusM;`
(graph-walker.js:350-352). When GPS is absent it falls through to `return true`. When
GPS is present, the decision becomes "is the direct stub INSERT far from the target
post's GPS anchor?". At post 25/26 the GPS anchors come from the FULL UTM PDF calc,
which in this branch region is itself imprecise (the [cable-arc-placer] / [label-lsq]
logs show this page's PDF coords were repositioned with RMSE ~27m). An imprecise GPS
anchor makes `gpsDist > gpsRadiusM` evaluate true and triggers a branch-return that
should not happen here, sending the walk down idx 8/9/10.

Equivalently, `findBifurcationTapChordTarget`'s GPS branch (lines 195-211) can pick a
different chord INSERT than the span-based fallback when GPS is present. Either way the
mechanism is: **GPS anchors of low accuracy in the branch region override the
geometry/label-based selection that works correctly without GPS.**

### FIX DIRECTION (for fix phase — single targeted change in graph-walker.js)

The standalone (no-GPS) walk is CORRECT through post 85. The GPS tie-breaks only help
the few cases they were designed for (57-64 spine) and actively harm post 25. Options,
least-risky first:

1. **Make GPS a soft tie-break, not an override.** Only consult GPS when the
   geometry/label-based choice is genuinely ambiguous (e.g. two candidates within
   tolerance of each other), not as a gate that can flip an otherwise-clear decision.
   In `shouldTryBranchReturn`, require the span/next-label evidence to already favor
   branch-return before letting GPS confirm; do not let GPS alone trigger it.
2. **Gate GPS use by anchor quality.** Skip the GPS branch when the target post's PDF
   anchor is known-imprecise (this route's branch pages were label-lsq repositioned).
   Harder to thread cleanly.
3. **Require GPS agreement, not GPS dominance.** In `findBifurcationTapChordTarget`,
   only use the GPS-nearest candidate if it also passes the span window; otherwise keep
   the span-based pick.

Whichever is chosen, the regression guard is: post-25 region (resolved session
siriu-tap-blocks-spine-25) AND posts 57-64 spine must both stay correct, AND the full
harness must reach `dwgStatus != pdf-fallback`. Verify with:
```
node debug-gps-43-trace.mjs                 # expect WITH-GPS ok=true, idx 25=163 (== no-gps)
node debug-run-calc-dwg-from-pdf-siriu.mjs  # expect dwgStatus = dwg-graph-walk, spine 57-64 < 10m
npm test (graph-walker 4/4, coordinate-calculator 22/22, distance-associator 11/11)
```

### Canonical repro scripts (this session)
- `debug-gps-43-trace.mjs` — DECISIVE. With/without GPS, per-post idx diff, first
  divergence detection, warning dump. Shows divergence at post 25.
- `debug-harness-vs-standalone.mjs` — 4-way table proving GPS (not connections) is the trigger.
- `debug-gps-vs-nogps-43.mjs` — SUPERSEDED (builds GPS from no-opts pdfResult → empty map).

### Probe scripts created this session
- `debug-harness-vs-standalone.mjs` — DECISIVE 4-way table (no-opts vs with-opts pdfResult
  × no-gps vs gps). This is the canonical repro. Writes `cmp-result.txt`.
- `debug-gps-vs-nogps-43.mjs` — SUPERSEDED / misleading: builds GPS from a no-opts
  pdfResult so its GPS map is empty. Keep only as a cautionary example; do not trust its
  "both succeed" output.

### Cleanup note
A temporary `GW_BR_TRACE` console.error block was added then removed from
`shouldTryBranchReturn` in graph-walker.js — file verified back to clean state
(lines 343-352 are the original 4 lines, no trace). A `DWG_CASCADE_TRACE` edit to
coordinate-calculator-dwg.js was attempted but the Edit was CANCELLED and never
applied — `grep cascade` shows only the original comment/var usage. `git diff --stat`
shows graph-walker.js and coordinate-calculator-dwg.js are NOT in the changed set,
confirming both are untouched.

## Reproduction commands

```bash
# True DWG walker errors posts 55–65 (standalone, no GPS)
GW_RETURN_IDX=1 node debug-claimed-at-58.mjs

# Walker trace 56–64
GW_TRACE=1 node debug-claimed-at-58.mjs 2>&1 | grep "\[gw\]"

# Full harness (shows pdf-fallback + PDF errors — NOT walker for 57+)
node debug-run-calc-dwg-from-pdf-siriu.mjs 2>&1 | grep -E "dwgStatus|^[ ]+5[7-9]|^ 5[7-9]"

# PDF vs walker comparison
node debug-dwg-vs-pdf-57.mjs

# INSERT / span probe
node debug-spine-57-probe.mjs
```
