---
status: resolved
trigger: DWG graph-walker on Siriu places posts 1-5 within 5m of GT but spikes to 34-146m on posts 6-11 then partially recovers to 25m on post 12. dwg-pair-collision warning at_post:7. Walker takes spine arm (5→10) instead of branch arm (5→6) at the bifurcation.
created: 2026-05-28
updated: 2026-05-28
priority_angle: graph-walker's hintDelta-first sort in Case A direct-neighbor pick uses hintDelta as primary discriminator even when BOTH candidates fail the hintTol check; phantom inferred 4→6 hint then routes walker onto the wrong branch arm at the post-5 bifurcation. Second compound bug: labelM==null single-neighbor shortcut at 9→10 bypasses the hint-jumpback helper, so walker continues past the dead end instead of returning to spine.
goal: find_and_fix
harness: debug-run-calc-dwg-from-pdf-siriu.mjs
ground_truth: coordenadas postes siriu.txt
related_sessions:
  - .planning/debug/dwg-graph-walk-no-candidate.md
  - .planning/debug/siriu-branch-return-labels.md
---

## Symptoms

### Reproduction

```bash
node debug-run-calc-dwg-from-pdf-siriu.mjs 2>&1 | grep -E "err|label|Partial|collision|walk-fail"
```

Set `GW_RETURN_PARTIAL=1` (harness default) to get the partial DWG table.

### Observed (before fix)

```
Post  err(m)  (DWG partial)
  1     4.01   ← OK
  2     3.20   ← OK
  3     2.37   ← OK
  4     2.54   ← OK
  5     3.64   ← OK
  6    34.50   ← SPIKE starts here
  7    69.99
  8    89.21
  9    93.84
 10   107.84
 11   146.79
 12    25.61   ← partial recovery (walker re-enters spine arm)
```

DWG warnings:
- `{"kind":"dwg-pair-collision","at_post":7}` — emitted by level-2 cascade (pairPostsAgainstRegion); a downstream symptom, not from graph-walker itself
- `{"kind":"dwg-graph-walk-fail","at_post":24,"reason":"no-connection"}` — separate; out of scope

### Expected (ground truth from `coordenadas postes siriu.txt`)

```
Post 01: -27.97810, -48.64053
Post 02: -27.97790, -48.64093
Post 03: -27.97758, -48.64130
Post 04: -27.97747, -48.64146
Post 05: -27.97732, -48.64173
Post 06: -27.97730, -48.64202  ← branch goes WEST (more negative lon)
Post 07: -27.97727, -48.64225
Post 08: -27.97720, -48.64278
Post 09: -27.97711, -48.64319  ← branch dead end (furthest west)
Post 10: -27.97705, -48.64178  ← BACK near post 5, NOT past 9
Post 11: -27.97672, -48.64166
Post 12: -27.97652, -48.64159
```

Topology: posts 1-5 main spine; at post 5 cable branches west to dead-end 5→6→7→8→9 and returns to spine 5→10→11→12.

## Investigation — INSERT assignments (probe: `debug-siriu-walker-trace.mjs`)

GW_TRACE shows the walker's chosen INSERT indices (before fix):

| Post | Picked INSERT | block | block lat,lon | GT err (m) | Notes |
|-----:|--------------:|-------|----|-------:|-------|
| 1 | #240 | pod_con_dtt | (-27.97812, -48.64057) | 4.01 | OK |
| 2 | #237 | pod_con_dtt | (-27.97790, -48.64096) | 3.20 | OK |
| 3 | #231 | pod_con_dtt | (-27.97758, -48.64133) | 2.37 | OK |
| 4 | #215 | pod_con_dtt | (-27.97746, -48.64148) | 2.54 | OK |
| 5 | #209 | pod_con_circ | (-27.97731, -48.64177) | 3.64 | OK |
| **6** | **#207** | pod_con_dtt | (-27.97705, -48.64181) | **34.50** | **WRONG — #207 belongs to post 10** |
| 7 | #212 | pod_con_dtt | (-27.97691, -48.64166) | 69.99 | downstream of #207, still on spine arm |
| 8 | #203 | pod_con_dtt | (-27.97682, -48.64198) | 89.21 | drifting west on spine arm |
| 9 | #199 | pod_madeira | (-27.97671, -48.64236) | 93.84 | |
| 10 | #196 | pod_madeira | (-27.97668, -48.64280) | 107.84 | |
| 11 | #195 | pod_madeira | (-27.97679, -48.64315) | 146.79 | degree-1 dead-end stub |
| 12 | #210 | pod_con_dtt | (-27.97673, -48.64170) | 25.61 | walker jumped back near spine |

### True INSERTs (nearest DXF INSERT to each GT location)

| Post | True INSERT | d to GT (m) | Comment |
|-----:|-----------:|-----:|---------|
| 5 | #209 | 3.6 | ✓ walker picks this |
| **6** | **#202** | 3.25 | branch arm — walker missed this |
| 7 | #200 | 4.10 | branch arm |
| 8 | #197 | 1.19 | branch arm |
| 9 | #194 | 1.56 | branch dead-end |
| **10** | **#207** | 2.95 | spine — walker wrongly assigned this to post 6 |
| 11 | #210/#472 | 4.60 | spine |
| 12 | #213/#474 | 5.15 | spine |

### Adjacency in rich graph (snap 8m ∪ 14m)

```
adj(#209) = {#202, #207, #215}     ← post 5 sits at the bifurcation
adj(#202) = {#200, #209}            ← post 6 — leads west to post 7 (#200)
adj(#207) = {#209, #212}            ← post 10 — leads north to post 11 (#212)
adj(#194) = {#193, #197}            ← post 9 dead-end; #193 is a degree-2 stub past the dead end
```

So at the 5→6 step, the walker has two viable cable neighbors: #202 and #207. Both are direct neighbors of #209 (post 5). It picks the wrong one (#207). At the 9→10 step, the walker has #193 as its only unclaimed neighbor and (before fix) follows it instead of jumping back to the spine.

## Root cause (verified by probes)

Two compounding bugs in `parser/dwg/graph-walker.js` Case A:

### Bug 1 — `viable.sort` hint-comparator dominates when neither candidate matches the hint

At the 5→6 step:

- labelM (5→6) = **28.5m**, tol = max(2, min(10, 0.15·28.5)) = **4.275m**
- Hint label exists: **4→6 = 28.5m** (`inferred-label`, hintOriginIdx = #215 = post 4)
- hintTol = 4.275m

For the two viable candidates (both have `delta ≤ tol`):

| Candidate | span(#209→n) | delta vs 28.5 | span(#215→n) | hintDelta vs 28.5 |
|-----------|-----:|-----:|-----:|-----:|
| **#202** (true post 6) | 28.50 | **0.003** | 59.48 | **30.98** |
| **#207** (true post 10) | 29.48 | 0.982 | 56.07 | **27.57** |

Both candidates have `hintDelta >> hintTol=4.275` — neither is hint-consistent.
The original `viable.sort` comparator:

```js
viable.sort((a, b) => {
  if (a.hintDelta != null && b.hintDelta != null && a.hintDelta !== b.hintDelta) {
    const aOk = hintTol != null ? a.hintDelta <= hintTol : false;
    const bOk = hintTol != null ? b.hintDelta <= hintTol : false;
    if (aOk !== bOk) return aOk ? -1 : 1;
    return a.hintDelta - b.hintDelta;   // ← BUG: sorts by hintDelta even when
  }                                      //   neither candidate matches the hint
  ...
});
```

When `aOk === bOk === false`, the `if` branch still returns `a.hintDelta - b.hintDelta`. So **#207 wins** because its hintDelta (27.57) is slightly smaller than #202's (30.98), even though #207's sequential `delta` is 326× worse than #202's (0.982 vs 0.003).

The hint is essentially noise (both candidates are 6–7× over hintTol) yet dominates the sort. This routes the walker to #207 (which belongs to post 10); post 10's later placement collides at post 7 (cascade-level symptom).

### Bug 2 — `labelM==null` single-neighbor shortcut bypasses the hint-jumpback helper

At the 9→10 step:

- `labelM` (9→10) = `null` (jumpback-suppressed by the parser; session 1/2 of `siriu-branch-return-labels.md`)
- Walker's `unclaimedCableNeighbors(#194)` = `[#193]` (only one — #197 already claimed)
- A hint label exists: **5→10 = 29.5m** from visited post 5 (#209), reachable via the rich graph

The walker code (before fix) ran the "branch return helper" (the multi-hop `findMultiHopByLabel` from the hint origin) **only inside `else if (labelM != null)`**. With `labelM == null` the walker took the early `neighbors.length === 1 && labelM == null` shortcut, picked #193 (a degree-2 stub past the dead end), and never tried the hint-jumpback. Post 10 ended up ~200m off, posts 11-12 cascaded similarly.

### Why the spurious hint exists at all

`4→6 = 28.5` is a phantom edge produced by `inferDistanceEdgesFromLabels` — it re-uses the same physical "28,5" label glyph that sequential pairing pinned to 5→6. The label-association session-3 changes (`MAX_NUMBER_SPAN = 6`, tighter dedupe) didn't fully suppress this kind of phantom. Even if it had, the walker still needs to be robust to noisy hints: a future inferred label could trigger the same misroute. The walker's tie-break must treat the hint as a *tiebreaker among hint-consistent candidates*, not as a primary discriminator when neither candidate is consistent.

## Evidence

- timestamp: 2026-05-28 — Probe `debug-siriu-walker-trace.mjs`: walker assigns post 6 → INSERT #207, post 10 → INSERT #196. True INSERT for post 6 is #202 (3.25m); true INSERT for post 10 is #207 (2.95m). Confirms walker takes spine arm at the bifurcation.
- timestamp: 2026-05-28 — Probe `debug-siriu-walker-spans.mjs`: span(#209→#202) = 28.50m, span(#209→#207) = 29.48m. Both within tol of 5→6 label (28.5±4.275m).
- timestamp: 2026-05-28 — Probe `debug-siriu-walker-pickselect.mjs`: replay of walker's `viable.sort` shows it picks #207 because hintDelta(#207)=27.57 < hintDelta(#202)=30.98, even though both hintDeltas are 6–7× over hintTol=4.275 (neither candidate is hint-consistent; the hint provides no real discrimination).
- timestamp: 2026-05-28 — Probe `debug-siriu-walker-hint.mjs`: hint at 5→6 step comes from inferred label `4→6 = 28.5 (inferred-label)`, hintOriginIdx = #215 (post 4). The label is a phantom — it re-uses the 5→6 "28,5" label glyph.
- timestamp: 2026-05-28 — Adjacency probe: adj(#209) = {#202, #207, #215}. #215 is claimed (post 4), leaving exactly 2 unclaimed neighbors at the bifurcation: #202 (branch arm) and #207 (spine arm).
- timestamp: 2026-05-28 — Probe `debug-siriu-walker-post9.mjs`: at 9→10 step, fromIdx=#194 has unclaimed neighbors `[#193]`. lastVisitedJunction = #197 (post 8), its unclaimed neighbors = `[#198]` — neither route reaches post 10's true INSERT #207 by direct walk. Only the hint-driven jumpback from #209 (post 5) using 5→10=29.5 finds #207.

## Eliminated

- (Eliminated) hypothesis: Walker confused by 5→10 = 29.5 hint pulling post 6 placement.
  No — at the 5→6 step the hint search only looks for `(visited, toNum)` labels; toNum=6,
  not 10. The 5→10 hint never enters Case A at the 5→6 step. The actual misleading hint
  was the phantom inferred `4→6 = 28.5`.
- (Eliminated) hypothesis: Walker has no labels at the bifurcation.
  No — `delta=0.003` for #202 means the sequential label match is essentially perfect.
  The pick failure is a sort-order bug, not a label availability problem.

## Fix design

Both fixes are generic — no Siriu-specific constants, post numbers, label values, or coordinates. They preserve existing hint preference when it is genuinely informative.

### Fix 1 — `viable.sort`: hint discriminates only when at least one candidate matches

In `parser/dwg/graph-walker.js`, change the comparator's hint branch from:

```js
if (a.hintDelta != null && b.hintDelta != null && a.hintDelta !== b.hintDelta) {
  const aOk = hintTol != null ? a.hintDelta <= hintTol : false;
  const bOk = hintTol != null ? b.hintDelta <= hintTol : false;
  if (aOk !== bOk) return aOk ? -1 : 1;
  return a.hintDelta - b.hintDelta;    // <-- always sorts by hintDelta
}
```

to:

```js
if (a.hintDelta != null && b.hintDelta != null && a.hintDelta !== b.hintDelta) {
  const aOk = hintTol != null ? a.hintDelta <= hintTol : false;
  const bOk = hintTol != null ? b.hintDelta <= hintTol : false;
  if (aOk !== bOk) return aOk ? -1 : 1;
  // Only use hintDelta as a discriminator when AT LEAST ONE candidate satisfies
  // the hint tolerance. Otherwise the hint is uninformative; fall through to
  // the other tiebreakers (degree, nextDelta, delta).
  if (aOk || bOk) return a.hintDelta - b.hintDelta;
}
```

At the 5→6 step the comparator then falls through to nextDelta / delta tiebreakers and picks #202 (nextDelta = 0.02 via #200 → matches 6→7=23m label perfectly; raw delta 0.003 vs 0.982).

### Fix 2 — Hoist the branch-return hint-jumpback helper out of `else if (labelM != null)`

Move the helper (which calls `findMultiHopByLabel` from a visited post that has a non-consecutive label to TARGET) to run FIRST in Case A, regardless of whether `labelM` is null. This way the walker considers hint-driven jumpback before:
- the `neighbors.length === 1 && labelM == null` single-neighbor shortcut, and
- the direct-neighbor span match.

`forceJumpback` (only set when `labelM != null && conn.gap && labelM >= 100`) still suppresses the hint to defer to Case B for true cross-page large-gap jumps.

At the 9→10 step the helper now runs: hintOriginNum=5, hintLabel=29.5m, hintOriginIdx=#209. `findMultiHopByLabel(#209, 29.5, ...)` returns endpoint #207 (span ≈ 29.48m, perfect match). Walker picks #207 instead of stepping to #193.

## Resolution

```yaml
root_cause: |
  Two compounding bugs in parser/dwg/graph-walker.js Case A.

  (1) viable.sort hint-comparator bug at the post-5 bifurcation:
      Walker had two viable cable neighbors of #209 (post 5) — #202 (true post 6,
      west branch arm) and #207 (true post 10, spine). Both passed the
      sequential delta<=tol check on the 5→6 = 28.5m label. A non-consecutive
      hint label (phantom 4→6 = 28.5m, inferred by re-using the same physical
      28,5 glyph) was active. Neither candidate satisfied hintTol (4.275m;
      #202 hintDelta=30.98, #207 hintDelta=27.57), yet the comparator still
      sorted by hintDelta when both candidates failed hintTol. Walker picked
      #207 (smaller hintDelta) over #202 (delta 0.003 vs 0.982). Posts 6-11
      then placed on spine-arm INSERTs with errors 34→147m.

  (2) labelM==null single-neighbor shortcut at the 9→10 step:
      At the dead-end post 9 (INSERT #194), the consecutive label 9→10 was
      null (jumpback-suppressed by the parser). A non-consecutive hint label
      5→10 = 29.5m from visited post 5 should have driven a hint-based jumpback
      to find #207 (post 10's true INSERT, reachable from #209 = post 5 via
      the rich adjacency graph). But the branch-return helper was nested inside
      'else if (labelM != null)', so the walker fell into the
      'neighbors.length === 1 && labelM == null' shortcut, silently took #193
      (a degree-2 stub INSERT past the dead-end), and placed post 10 ~200m off.

fix: |
  parser/dwg/graph-walker.js — two surgical changes:

  (1) viable.sort comparator: stop letting hintDelta dominate when neither
      candidate is hint-consistent. Replace
          return a.hintDelta - b.hintDelta;
      with
          if (aOk || bOk) return a.hintDelta - b.hintDelta;
      so when aOk === bOk === false the hint provides no discrimination and we
      fall through to deg / nextDelta / delta tiebreakers.

  (2) Hoist the branch-return hint-jumpback helper OUT of the
      'else if (labelM != null)' branch so it runs for labelM==null too.
      The hoisted block runs FIRST in Case A: if a non-consecutive hint label
      from any visited post to TARGET exists (and forceJumpback is not set),
      try findMultiHopByLabel from the hint origin. If a hop is found,
      chosenIdx is set and the rest of Case A (including the
      'neighbors.length === 1 && labelM == null' shortcut) is skipped.

  Both changes are fully generic: no Siriu-specific constants, post numbers,
  label values, or coordinates. Other branch-return topologies (any
  'consecutive edge suppressed, non-consecutive return label present' pattern)
  benefit identically.

verification: |
  node --test parser/__tests__/graph-walker.test.mjs        → 4/4 pass
  node --test parser/__tests__/region-pairing.test.mjs      → 8/8 pass
  node --test parser/__tests__/distance-associator.test.mjs → 9/9 pass
  node --test parser/__tests__/label-lsq-calibrator.test.mjs → 1/1 pass

  node debug-run-calc-dwg-from-pdf-siriu.mjs:
    Post  err(m)  (DWG partial)
      1     4.01    ← #240
      2     3.20    ← #237
      3     2.37    ← #231
      4     2.54    ← #215
      5     3.64    ← #209
      6     3.29    ← #202   ← branch arm correctly picked
      7     4.14    ← #200
      8     1.17    ← #197
      9     1.60    ← #194   (true dead-end)
     10     2.99    ← #207   ← hint-driven jumpback to spine
     11     4.64    ← #210
     12     5.19    ← #213   (#213 is 5.15m from GT — DXF best)

  All 12 posts within ~5m DWG error (target met). Walker continues correctly
  through the branch-return topology. No new graph-walker warnings.

  The existing 'dwg-pair-collision at_post:7' warning still appears: it is
  emitted by the level-2 cascade (pairPostsAgainstRegion in frozen
  region-pairing.js) when the graph-walker partial doesn't reach the end of
  the route. It is downstream-cascading, not from graph-walker itself.

  Partial walk depth ceiling at 12 (next step fails with
  'dwg-graph-walk-fail at_post:24 reason:no-connection') is the separately-tracked
  upstream PDF connections issue and out of scope for this session.

files_changed:
  - parser/dwg/graph-walker.js

probes_created:
  - debug-siriu-walker-trace.mjs       (post→INSERT assignment trace)
  - debug-siriu-walker-spans.mjs       (#209 neighbor spans and tolerance check)
  - debug-siriu-walker-hint.mjs        (hint-label availability at 5→6)
  - debug-siriu-walker-pickselect.mjs  (replay of viable.sort comparator)
  - debug-siriu-walker-post9.mjs       (post 9 dead-end + Case B junction analysis)
```
