---
status: fixed_session_3
trigger: Siriu DWG graph-walk diverges because PDF assigns a bogus sequential 9→10 distance; cable ends at post 9 and rejoins via 5→10, not 9→10
created: 2026-05-28
updated: 2026-05-28
priority_angle: distance-associator must not invent sequential spans where topology is branch-return (5→6…→9 dead-end, 5→10 rejoin)
related_commit: 38cf615
harness: debug-run-calc-dwg-from-pdf-siriu.mjs
ground_truth: coordenadas postes siriu.txt
---

## Symptoms

### Expected (ground truth + topology)

- Main spine posts **1–5**, parallel branch **6–9**, cable **ends at 9** (no forward hop to 10).
- Branch return labeled **5→10** (~29,5 m).
- Along spine after rejoin: **10→11 = 37,3 m**, **11→12 = 24,2 m**.
- Earlier branch region (user): **3→4 = 20**, **4→5 = 32,6**, **5→6 = 28,5**, **6→7 = 23**.

### Actual (before fix)

- Parser placed **37,3 on 9→10** (label shifted one segment).
- **10→11 = 24,2**, **11→12 = 36,8** (swap).
- **5→10** often missing or wrong (28,5 inferred vs 29,5 GT).
- DWG harness showed **pdf-fallback** coords; real DWG progress only in **Partial DWG coords** block.
- Graph-walker used wrong consecutive label at post 10 (trusted 9→10 instead of 5→10 hint).

### Actual (after commit `38cf615`)

```
label 9↔10: null
label 10↔11: 37.3 (jumpback-shift)
label 11↔12: 36.8 (window-refine)        <-- wrong; GT is 24.2
label 5↔10: 28.5 (inferred-label)        <-- wrong; GT is 29.5
Partial DWG coords: 12 post(s)
```

### Actual (after **session-2 parser fix** — current HEAD pending commit)

```
label 9↔10: null (jumpback-suppressed)
label 10↔11: 37.3 (jumpback-rehome)
label 11↔12: 24.2 (legacy-midpoint)      <-- FIXED ✓
label 5↔10: 28.5 (inferred-label)        <-- still off (secondary issue)
Partial DWG coords: 12 post(s)
```

### Reproduction

```bash
node debug-run-calc-dwg-from-pdf-siriu.mjs
# Optional overrides (debug only):
DWG_LABEL_OVERRIDE=1 node debug-run-calc-dwg-from-pdf-siriu.mjs
PDF_DISTANCE_OVERRIDES='{"10->11":37.3,"11->12":24.2}' node debug-run-calc-dwg-from-pdf-siriu.mjs
```

Requires: `INFOVIAS_PJC INTERNET_Garopaba_Praia do Siriu_v01.pdf`, `siriu.dxf`, `coordenadas postes siriu.txt`.

Set `GW_RETURN_PARTIAL=1` (harness default) to see **Partial DWG coords**, not only PDF fallback table.

---

## Root cause (session 1 — verified by commit 38cf615)

| Layer | Finding |
|-------|---------|
| **Topology** | Post **9** is branch tip; no cable segment 9→10. Return is **5→10** (non-consecutive `Distância_Poste` edge). |
| **Association** | Greedy / inferred-label pairing treats labels near the bifurcation as sequential **N→N+1**, shifting **37,3** onto **9→10** instead of **10→11**. |
| **DWG walker** | `graph-walker.js` has **5→10 hint** logic (`getDistLabel` from visited junction), but a populated wrong **9→10** label wins first and pulls the walk onto the wrong branch. |
| **Pass timing** | `5→10` inferred edge often appears only after **pass-2** `associateDistancesRich` (post-N3 positions). Pass-1 cleanup ran too early; **prefillGapDistancesForPolePlacement** could refill bogus **9→10** after cleanup. |

## Root cause (session 2 — 11→12 = 36.8 mis-assignment)

**Hypothesis (confirmed):** Even after `applyJumpbackDistanceCleanup` cleared `9→10`,
the subsequent call to `prefillGapDistancesForPolePlacement(posts, distances, cablesByPage)`
**refilled** `9→10` via `fillAdjacentMissingDistances` → `inferMissingSegmentMeters`
because the cleared entry was indistinguishable from a "naturally missing" gap.

Consequence chain (verified by inspecting post anchor coords):

1. Pass-1 `associateDistancesRich` clears `9→10` correctly.
2. `prefillGapDistancesForPolePlacement` refills `9→10` with an inferred value derived
   from neighbour spans (e.g. ≈37 m, blending 8→9 and 10→11).
3. First `assignPolesGloballyByLabels` uses the **wrongly refilled** `9→10` to place
   post **10** on post **12's** Poste-layer pole symbol (since 9→10≈10→11→11→12 chain
   bunches posts 10–12 onto the same arc segment).
4. Line 750 in `pdf-parser.js` overwrites OCR `anchorX/anchorY` with the wrong N3 position.
5. Post 10 anchor ends up at `(611.12, 65.34)` — **identical to post 12's anchor**.
6. With posts 10 and 12 collapsed to the same point, segments `10→11` and `11→12` are
   indistinguishable spatially → window-refine picks `"36,8"` for `11→12` purely on
   relative cost; the correct label `"24,2"` (geometrically closest to segment 11–12)
   loses tie-breaking because the label is closer to both collapsed segments equally.

**Evidence:**

```
=== Posts page 3 (final, before session-2 fix) ===
Post 10: x=611.12 y=65.34  aX=611.12 aY=65.34   <-- WRONG, should be near OCR (535.82, 212.46)
Post 11: x=571.94 y=100.26 aX=571.94 aY=100.26  <-- correct
Post 12: x=611.12 y=65.34  aX=611.12 aY=65.34   <-- collapsed onto post 10

=== OCR detected ===
Post 10 circle=(535.82, 212.46)   <-- this anchor was lost
Post 11 circle=(571.94, 100.26)
Post 12 circle=(587.78, 61.50)
```

After session-2 fix (current HEAD pending commit):

```
Post 10: x=559.76 y=230.82 aX=535.82 aY=212.46   <-- anchor preserved ✓
Post 11: x=611.12 y=65.34  aX=571.94 aY=100.26   <-- anchor preserved ✓ (x still off — N3 swap)
Post 12: x=591.50 y=130.68 aX=591.50 aY=130.68   <-- distinct from post 10 ✓
```

---

## Fix implemented (session 1 → `38cf615`)

### `parser/distance-associator.js`

- **`applyJumpbackDistanceCleanup`** — exported; runs after rich association and again post–pole-placement.
- **`suppressJumpbackSequentialSpans`** — when labeled jump `lo→hi` (span 4–15, `lo >= hi-6`, branch leave `lo→lo+1` exists), suppress **`(hi-1)→hi`** (e.g. clear **9→10**).
- **`rehomeNextSpanAfterJumpback`** — shift cleared meters to **`hi→(hi+1)`** (`jumpback-shift`, e.g. **37,3 → 10→11**).
- **`refillSequentialGaps`** — greedy refill respecting suppressed pairs.
- **`refineSequentialWindows`** — jumpback-aware; does not overwrite `jumpback-shift`.
- **`inferDistanceEdgesFromLabels`** — skips sequential-adjacent pairs (walker owns N→N+1).

### `parser/pdf-parser.js`

- After pass-2 splice: **prefill → `applyJumpbackDistanceCleanup`** (order matters).
- Merge pass-2 non-sequential edges into shared `distances` array.

### Test

- `parser/__tests__/distance-associator.test.mjs` — `branch return jumpback cleanup` synthetic case.

## Fix implemented (session 2 — pending commit)

### `parser/distance-associator.js`

- `suppressJumpbackSequentialSpans` now tags cleared `(hi-1)→hi` entries with
  `source: "jumpback-suppressed"` (instead of `delete d.source`), and creates a
  placeholder entry if one didn't exist. Persistent marker so downstream stages
  see the suppression intent.
- `applyJumpbackDistanceCleanup` final scrub loop preserves the
  `"jumpback-suppressed"` source.

### `parser/geo/label-lsq-calibrator.js`

- `prefillGapDistancesForPolePlacement`:
  - Collects pairs with `source === "jumpback-suppressed"` into a `Set`.
  - Passes it through to `fillAdjacentMissingDistances` so the inference loop
    won't try to refill these slots.
  - Skips suppressed entries in the final `distances[].meters = v` update loop.
- `fillAdjacentMissingDistances`:
  - New optional 4th arg `suppressedPairs: Set<string>` (`"a->b"` keys, `a<b`).
  - Skips iteration when the sequential pair matches a suppressed key.

### Tests

- New test `tags suppressed 9→10 with source 'jumpback-suppressed'`.
- New test `creates suppressed entry when none existed pre-cleanup`.

---

## Evidence

- timestamp: 2026-05-28 — User: branch ends at 9; return 5→10; no 9→10 label.
- timestamp: 2026-05-28 — Harness before fix: `9↔10: 37.3`, `10↔11: 24.2`, `11↔12: 36.8`, `5↔10: 28.5`.
- timestamp: 2026-05-28 — Warning: `[distance-assoc] Cleared 9→10: branch ends at 9; rejoin is 5→10`.
- timestamp: 2026-05-28 — Warning: `[distance-assoc] Shifted cleared label 37.3 from 9->10 to 10→11`.
- timestamp: 2026-05-28 — Harness after session 1: `9↔10: null`, `10↔11: 37.3 (jumpback-shift)`.
- timestamp: 2026-05-28 — With overrides, DWG partial reached ~24 posts; without overrides partial ~12–30 depending on refine/prefill order.
- timestamp: 2026-05-28 — Inspection: post 10 final `(anchorX,anchorY) = (611.12, 65.34)` identical to post 12 — anchor lost during first N3 because of refilled 9→10.
- timestamp: 2026-05-28 — Inspection: page-3 distance label `"24,2"` at PDF `(600.8, 102.1)` has gap **0.1 pt** to segment 5↔10 / 5↔12 (because posts 10, 12 collapse), gap **20.6 pt** to true segment 11↔12. With post 10 and 12 collapsed, window-refine cannot distinguish 10→11 from 11→12 segments.
- timestamp: 2026-05-28 — After session-2 fix: `11↔12: 24.2 (legacy-midpoint)` ✓; post-10 anchor preserved at OCR `(535.82, 212.46)`.
- timestamp: 2026-05-28 — Related prior session: `.planning/debug/dwg-graph-walk-no-candidate.md` (adjacency snap / Case B; different failure mode at post 3 on graph-only harness).

---

## Eliminated

- hypothesis: Fix only in `graph-walker.js` with larger tolerance — **partial**; hints help at 10 but wrong PDF labels still poison walk; parser fix required.
- hypothesis: `associateSequentialMonotonic` route projection alone fixes Siriu — **no**; branch geometry breaks monotonic order; reverted to legacy greedy + jumpback cleanup.
- hypothesis: Window refine alone fixes 10–11 / 11–12 — **no**; without suppressing 9→10 it reassigned 29,5 or 24,2 to wrong segments.
- hypothesis: Geometry `dRejoin < dTip` detects all branch returns — **no**; fails after N3 pole positions (anchors stale vs cable).
- hypothesis: 11→12 mis-assignment can be fixed by refining `refineSequentialWindows` alone — **no**; the deeper cause is post 10 and post 12 collapsing to the same anchor coordinates because `prefillGapDistancesForPolePlacement` refills the suppressed 9→10 edge before N3 placement runs. Need to mark suppression persistently so prefill respects it.

---

## Current focus

```yaml
hypothesis: |
  11→12 fix (session 2) confirmed: tagging suppressed edges and making prefill respect
  the tag preserves post 10's anchor and lets sequential pairing place "24,2" correctly.
  Remaining gaps: (a) 5→10 still inferred as 28.5 instead of 29.5 — wrong label chosen
  near the branch junction in geometry; (b) early pairs 3→4, 4→5 still swapped; (c)
  cable-arc-placer / second-pass N3 still thrashes posts 5–11 because the now-correct
  labels create a 17–60 m mismatch with the bunched PDF cable arc on page 3.

test: |
  node debug-run-calc-dwg-from-pdf-siriu.mjs
  # Confirm:
  #   label 11↔12: 24.2 (not 36.8)
  #   Post 10 anchor near OCR circle (535.82, 212.46)

expecting: |
  Partial DWG through post 11+ with <10m error at 10–11; posts 3–7 within ~5m;
  full walk past post 25 without no-candidate (stretch goal).

next_action: |
  1. Inspect why 5→10 = 28.5 instead of 29.5 — labels "28,5" (525.4,306.4) and
     "29,5" (556.4,267.5) both compete; the inferred-label routine should prefer
     "29,5" because it is geometrically closer to chord 5↔10 (gap 8.3 pt) than
     "28,5" (need to verify; "28,5" already maps to 5→6 sequentially so should be
     excluded from inferred-edge dedupe). Likely: tighten dedupe in
     `inferDistanceEdgesFromLabels` to drop labels already pinned to a sequential
     pair.
  2. Investigate why early pairs 3→4=20, 4→5=32.6 remain swapped (parser shows
     3→4=32.6, 4→5=29.5). Label "20" is on a different short segment;
     "32,6" lands on 3→4 because of greedy midpoint distance.
  3. Cable-arc-placer thrashing posts 5–11 now that labels are correct — need to
     guard against repositioning when label-vs-cable disparity is concentrated
     near a known bifurcation. Likely separate session / out of scope for the
     "label assignment" objective.

reasoning_checkpoint: false
tdd_checkpoint: false
```

---

## Remaining gaps

| Item | GT | Current (HEAD) | Notes |
|------|-----|---------|-------|
| 9→10 | (none) | null (jumpback-suppressed) | ✓ fixed (session 1+2) |
| 10→11 | 37.3 | 37.3 (jumpback-shift) | ✓ fixed |
| 11→12 | 24.2 | 24.2 (legacy-midpoint) | ✓ fixed (session 2) |
| 5→10 | 29.5 | 29.5 (inferred-label) | ✓ fixed (session 3) |
| 3→4 | 20 | 20 (legacy-midpoint, pass-1 preserved) | ✓ fixed (session 3) |
| 4→5 | 32.6 | 32.6 (legacy-midpoint, pass-1 preserved) | ✓ fixed (session 3) |
| Partial walk depth | 85 paired | 12 (posts 1-5 within 4m) | DWG-side issue — separate from labels; tracked in `dwg-graph-walk-no-candidate.md` |

---

## Key files

| File | Role |
|------|------|
| `parser/distance-associator.js` | `associateDistancesRich`, `applyJumpbackDistanceCleanup`, suppression source tag |
| `parser/geo/label-lsq-calibrator.js` | `prefillGapDistancesForPolePlacement`, `fillAdjacentMissingDistances` — now suppression-aware |
| `parser/pdf-parser.js` | pass-2 cleanup hook |
| `parser/dwg/graph-walker.js` | 5→10 hint, branch return at walk |
| `debug-run-calc-dwg-from-pdf-siriu.mjs` | E2E harness vs GT |
| `coordenadas postes siriu.txt` | Ground truth |
| `.planning/debug/dwg-graph-walk-no-candidate.md` | Separate: adjacency snap / post-3 no-candidate |

---

## Resolution

```yaml
root_cause: |
  Two-step cause:
    (1) Original mis-assignment: greedy label-pair matching shifted 37,3 onto 9→10
        because Distância_Poste labels near the branch bifurcation are mid-segment of
        a sequential N→N+1 chain that the parser treats as continuous.
    (2) Persistent corruption: even after `applyJumpbackDistanceCleanup` cleared 9→10,
        the subsequent `prefillGapDistancesForPolePlacement` refilled the gap via
        `inferMissingSegmentMeters`, since cleared entries were indistinguishable from
        naturally-missing pairs. The refilled bogus 9→10 caused the first
        `assignPolesGloballyByLabels` pass to snap post 10 onto post 12's pole symbol,
        which (via the pass-1 anchor overwrite at pdf-parser.js:750) destroyed post
        10's OCR anchor permanently — causing post 11→12 to be picked up as 36,8 by
        window-refine because posts 10 and 12 had collapsed to the same anchor.
fix: |
  Session 1 (commit 38cf615):
    - applyJumpbackDistanceCleanup added; clears (hi-1)→hi when branch return lo→hi
      with span 4-15 is detected and lo→lo+1 exists.
    - rehomeNextSpanAfterJumpback shifts the cleared meters to hi→(hi+1).
    - refineSequentialWindows is jumpback-aware via suppressedKeys.
  Session 2 (current HEAD):
    - Suppressed entries now carry `source: "jumpback-suppressed"` (persistent marker).
    - prefillGapDistancesForPolePlacement and fillAdjacentMissingDistances respect
      the marker — refill loop skips suppressed pairs.
    - Final distances[].meters = v update loop also skips suppressed entries.
verification: |
  - node --test parser/__tests__/distance-associator.test.mjs   → 6/6 pass
  - node --test parser/__tests__/label-lsq-calibrator.test.mjs  → 1/1 pass
  - node debug-run-calc-dwg-from-pdf-siriu.mjs:
      label 9↔10: null (jumpback-suppressed)
      label 10↔11: 37.3 (jumpback-rehome)
      label 11↔12: 24.2 (legacy-midpoint)  ← target met
      Post 10 anchor preserved at OCR (535.82, 212.46)
      Post 12 anchor distinct (591.50, 130.68)
files_changed:
  - parser/distance-associator.js
  - parser/geo/label-lsq-calibrator.js
  - parser/__tests__/distance-associator.test.mjs
session_3:
  root_cause: |
    Two interacting issues remained:
      (a) `inferDistanceEdgesFromLabels` was too permissive (TOP_K_POSTS=10,
          MAX_LABEL_GAP_PT=75, label projection could fall outside chord). It
          created phantom non-sequential edges (8→3, 6→3, 4→10, 9→7, etc.) by
          reusing labels already consumed by sequential pairs. Some phantoms
          fooled `applyJumpbackDistanceCleanup` (treating e.g. 8→3 as a branch
          return with span 5), suppressing legitimate sequential pairs.
      (b) The pass-2 splice in `pdf-parser.js` ALWAYS overwrote pass-1
          distances with pass-2 values. On Siriu, pass-1 (OCR/Numero_Poste
          anchors) was correct (`3→4=20, 4→5=32.6, 5→10=29.5 inferred`) but
          pass-2 (post-N3 corrupted anchors) was wrong (`3→4=32.6, 4→5=29.5`).
  fix: |
    parser/distance-associator.js:
      • associateDistances now returns `usedLabelIndices` (Set<number>) and
        accepts `opts.excludedLabelIndices` (Set<number>) so callers can skip
        labels already consumed.
      • inferDistanceEdgesFromLabels now:
          - returns `{ edges, usedLabelIndices }` (was `edges[]`)
          - TOP_K_POSTS 10 → 4 (only the immediate neighbourhood of the label)
          - MAX_LABEL_GAP_PT 75 → 30 (label must sit very close to its chord)
          - MAX_SCORE 140 → 80
          - new: label projection t must be in (0.1, 0.9) — rejects labels
            whose projection clamps to an endpoint
          - tighter ratio band (0.5, 2.0) instead of (0.2, 5.0)
          - new: `MAX_NUMBER_SPAN = 6` — reject inferred edges spanning too
            many sequential posts (phantom long-chord matches)
      • associateDistancesRich: run inferred FIRST (to claim non-sequential
        labels like 5→10 before sequential greedy can misassign them), then
        run legacy sequential with the inferred-consumed labels excluded.
    parser/pdf-parser.js:
      • Pass-2 splice now conservative: only overwrite a pass-1 distance with
        pass-2 when (a) pass-1 was null, OR (b) pass-1's chord-vs-label ratio
        is wildly off (<0.4 or >2.5). Pass-1 anchors that are on the cable
        (Siriu OCR) produce ratios in band and are preserved; pass-1 anchors
        off-cable (João Born Numero_Poste) produce extreme ratios and pass-2
        still wins. Snapshot of pass-1 anchor (x, y, pageNum) captured before
        N3 mutates them, so the splice can compute the original chord length.
  verification: |
    - node --test parser/__tests__/distance-associator.test.mjs  → 9/9 pass
    - node --test parser/__tests__/label-lsq-calibrator.test.mjs → 1/1 pass
    - node debug-run-calc-dwg-from-pdf-siriu.mjs:
        label 9↔10: null (jumpback-suppressed)
        label 10↔11: 37.3 (jumpback-shift)
        label 11↔12: 24.2 (legacy-midpoint)
        label 5↔10: 29.5 (inferred-label)             ← target met
    - Probe (debug-probe-early-pairs.mjs) all-distance entries:
        3→4 = 20 (legacy-midpoint)                    ← target met
        4→5 = 32.6 (legacy-midpoint)                  ← target met
        5→6 = 28.5 (legacy-midpoint)
        6→7 = 23 (legacy-midpoint)
    - Partial DWG coords posts 1–5 within 4m of GT (was 25–70m before).
      Posts 6–12 still diverge — DWG-side topology issue (out of scope for
      this session, tracked separately in dwg-graph-walk-no-candidate.md).
  files_changed:
    - parser/distance-associator.js
    - parser/pdf-parser.js
    - parser/__tests__/distance-associator.test.mjs
```

---

## Notes for `/gsd:debug continue siriu-branch-return-labels`

Resume from **next_action** above. Do not re-litigate 9→10 topology — user confirmed.
The remaining 5→10 = 28.5 / 29.5 mismatch and 3→4 / 4→5 swap are independent
inferred-label issues, not branch-return cleanup issues. The partial-walk depth
ceiling (post 7 no-candidate) is a DWG-side issue tracked in
`.planning/debug/dwg-graph-walk-no-candidate.md`.
Prefer parser-side fixes over harness overrides. Commit convention: atomic commits
on `parser/` when sub-task completes.
