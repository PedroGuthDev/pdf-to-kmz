---
status: root_cause_found
trigger: graph-walk fails at post 3 with no-candidate when running debug-run-calc-dwg-graph.mjs against siriu.dxf + GT
created: 2026-05-28
updated: 2026-05-28
priority_angle: ADJACENCY_SNAP_M=3 leaves cable junctions disconnected; graph-walker Case B jumpback cannot recover when visited path has no degree>2 nodes
---

## Symptoms

Running `node debug-run-calc-dwg-graph.mjs` produces:

```
[g3-harness] Region 'siriu' loaded: 483 INSERTs, 451 cable edges
  Walk aborted at poste 3 (nearest=?)
[g3-harness] Warnings (1):
  {"kind":"dwg-graph-walk-fail","at_post":3,"reason":"no-candidate"}
FAIL (0/85 paired, max error 0.00m, failedAt=3)
```

## Root Cause (verified)

**The cable adjacency graph is fragmented at junctions** because `ADJACENCY_SNAP_M = 3m` is smaller than the distance from many cable junction vertices to the nearest INSERT.

### Concrete chain for posts 1→2→3 (siriu)

- GT post 1 (UTM 732072.55, 6902980.52) → nearest INSERT #240 (d=3.97m), block=pod_con_dtt
- GT post 2 (UTM 732034.36, 6903003.63) → nearest INSERT #237 (d=3.16m), block=pod_con_dtt
- GT post 3 (UTM 731997.81, 6903040.48) → nearest INSERT #231 (d=2.32m), block=pod_con_dtt
- `adj(237).has(231) = false` → `buildSyntheticPdfInput` sets `gap(2→3) = true`

The actual DXF cable run for 2→3 passes through a **4-edge junction at (732013.85, 6903021.52)**:
- edge[156] connects junction ↔ near-#231 (2m)
- edge[158] connects junction ↔ (732013.32, 6903016.57)
- edge[159] connects junction ↔ (732016.60, 6903047.32)
- edge[160] connects junction ↔ near-#237 (2m)

The junction at (732013.85, 6903021.52) is **6.86m from the nearest INSERT (#232)**, which exceeds ADJACENCY_SNAP_M=3. So `buildAdjacencyGraph` drops every edge incident to that junction (`iA < 0` branch at region-pairing.js:68). Adjacency tolerance probe (rebuild graph with tol = 3/4/5/6/8/10m):

| tol(m) | adj(240,237) | adj(237,231) | \|237\| | \|231\| |
|---|---|---|---|---|
| 3 | true | false | 2 | 2 |
| 4–6 | true | false | 2 | 2 |
| 8 | true | false | 3 | 3 |
| 10 | true | false | 3 | 3 |

Even at 10m snap, INSERT #237 and INSERT #231 are NOT directly cable-adjacent because the real cable goes via the orphan junction. They would only become connected via the intermediate INSERT #232 (which would itself need a wider snap to attach to that junction).

### Why Case B (jumpback) fails

When `gap=true`, graph-walker.js (lines 218–280) enters Case B:
1. `junctionSetFromVisited([240, 237], graph)` — returns junctions (`neighbors.size > 2`)
2. Both #240 and #237 have **degree 2** in the adjacency graph → no junctions found
3. `jumpbackCandidates([], …)` returns `[]`
4. Line 223: `candidates.length === 0` → emits `dwg-graph-walk-fail` reason=no-candidate, aborts

### Scope of the problem across siriu

Of 84 consecutive GT pairs, the cable adjacency graph reports:
- **65 pairs**: directly cable-adjacent (1 hop)
- **2 pairs**: 4–5 hop cable paths (intermediate INSERTs in graph)
- **17 pairs**: DISCONNECTED in adjacency graph (no path exists through current 3m-snap graph)

So roughly **20%** of consecutive GT pairs are flagged `gap=true` by `buildSyntheticPdfInput`, and Case B will fail for every one of them where the visited path contains no degree>2 node.

## Evidence

- timestamp: 2026-05-28 — probe `debug-graph-walk-probe.mjs` confirmed picked-INSERT for post 2 = #237 (correct GT-nearest), gap(2→3)=true, only one unclaimed cable neighbor (#235)
- timestamp: 2026-05-28 — probe `debug-graph-walk-probe2.mjs` confirmed visited path [240,237] has zero junctions (both degree 2), jumpback candidate list empty; tolerance sensitivity table built
- timestamp: 2026-05-28 — probe `debug-graph-walk-probe3.mjs` revealed 17 of 84 GT-pairs are disconnected in the current adjacency graph
- timestamp: 2026-05-28 — probe `debug-graph-walk-probe4.mjs` identified the orphan junction at (732013.85, 6903021.52) where edges 156, 158, 159, 160 meet — 6.86m from nearest INSERT #232

## Classification

| Candidate | Verdict |
|---|---|
| (A) Wrong anchor pick | NO — anchor is correctly #240 (GT-nearest, 3.97m) |
| (B) Wrong neighbor pick at junction for post 2 | NO — picked #237 (correct GT-nearest, span match delta=0.00m) |
| (C) ADJACENCY_SNAP_M=3 too tight | **YES** — junction at (732013.85, 6903021.52) is 6.86m from nearest INSERT; cable edges through it are silently dropped, creating disconnected components |
| (D) Graph-walker Case B inadequate for paths with no junction in visited history | **YES (compound)** — even when gap is correctly flagged, the jumpback heuristic requires a degree>2 node in visited history, which is rare early in the walk |

The failure is **C × D compound**: the fragmented graph causes spurious `gap=true` markers, and Case B has no recovery mechanism when both walked nodes are degree-2.

## Fix Options (within constraints)

Cannot modify `parser/dwg/region-pairing.js` (frozen) so we cannot raise ADJACENCY_SNAP_M directly.
Cannot modify `parser/coordinate-calculator.js` (frozen).
Fix must target `parser/dwg/graph-walker.js` or `debug-run-calc-dwg-graph.mjs`.

### Option 1 (recommended) — graph-walker rebuilds a richer adjacency graph internally

In `graph-walker.js`, after receiving `region`, build a second adjacency graph using a larger tolerance (e.g. 8m or 10m) by re-walking `region.cableEdges` directly with the snap tolerance changed. Use this richer graph for navigation. The frozen `region-pairing.js` is not modified; we duplicate (or import a helper) into the walker. Pros: solves the C component, single-file change. Cons: introduces parameter duplication.

### Option 2 — relax Case B to use a "nearest unclaimed by Euclidean span" fallback

When `gap=true` and `junctions=[]`, fall back to: search all unclaimed INSERTs within `spanToleranceFor(labelM)` of (fromDwg.x + dx, fromDwg.y + dy) where dx,dy are derived from the GT label distance. But this requires bearing info we don't have. A weaker fallback: search the R-tree for the unclaimed INSERT whose distance from `fromDwg` is closest to `labelM`, within a span tolerance. This re-introduces a form of "nearest" matching but stays purely graph-driven by selecting only candidates that lie ≤ span+tol from current. Pros: simple, addresses D directly. Cons: feels close to the procrustes/nearest behavior the walker was designed to avoid.

### Option 3 — graph-walker auto-relaxes the cable adjacency on demand

When Case B has no junction and no candidate, **iteratively expand the snap tolerance for the current vicinity only**: re-walk `region.cableEdges` looking for any edge whose endpoints reach `fromIdx` within 3m AND the other end within a growing tolerance (e.g. 5m → 8m → 12m). Add these as virtual cable neighbors. This is local and bounded. Pros: corrects only when needed, preserves baseline. Cons: more code; need to bound the relaxation.

### Option 4 (smallest patch) — harness change in `debug-run-calc-dwg-graph.mjs`

`buildSyntheticPdfInput` decides `gap=!(adjacency.get(curIdx)?.has(nxtIdx))`. Change this to use the **cable-shortest-path length** instead: `gap = (BFS_distance(curIdx, nxtIdx) > 1)`. But this only relabels the problem — graph-walker still has to traverse multi-hop in Case A, which it currently cannot (it picks exactly one neighbor and moves there). So Option 4 alone is insufficient.

### Option 5 (combo, real fix) — Option 1 + Case A multi-hop traversal

Build a richer adjacency graph in graph-walker (Option 1), and extend Case A to allow walking through up to K intermediate degree-2 nodes when no degree-2 unclaimed neighbor matches the span. This handles the "cable passes through an unnumbered INSERT" case naturally.

## Recommended fix

Adopt **Option 5** (combo):

1. In `parser/dwg/graph-walker.js`, add a private helper `buildRichAdjacency(regionPosts, cableEdges, snapTol=8m)` that mirrors `buildAdjacencyGraph` but with a relaxed tolerance. Replace the use of the passed `adjacencyGraph` with this richer one (or merge them — union of edges).
2. Extend Case A: when no direct unclaimed cable neighbor matches `labelM ± tol`, traverse 1–2 hops through unclaimed degree-2 nodes (DFS up to depth K=2, claiming intermediate nodes along the way). Pick the path whose total span best matches `labelM`.
3. Keep Case B as fallback for genuinely cross-page jumps (still possible when PDF has a real `gap` from a viewport break, not a graph-snap artifact).

This stays in the graph-walker scope, respects all frozen-file constraints, and addresses both the structural snap-tolerance gap and the Case B blind spot for early-walk no-junction states.

## Goal: find_root_cause_only

Per the session brief, the goal is to identify the root cause precisely; fix proposal is described above but NOT to be applied here. Hand back to user for plan-phase decisions.
