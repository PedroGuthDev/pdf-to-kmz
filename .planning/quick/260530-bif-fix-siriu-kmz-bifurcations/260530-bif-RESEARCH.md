# Siriu KMZ Bifurcation Drawing — Research

**Date:** 2026-05-30
**Scope:** Cable-route polyline accuracy at bifurcations in the KMZ output for the Siriu network.
**Files investigated:** `parser/kml-builder.js`, `parser/coordinate-calculator.js`, `parser/__tests__/fixtures/siriu-topology.json`, `parser/__tests__/bifurcation-connections.test.mjs`, `parser/__tests__/kml-builder.test.mjs`.

> **IMPORTANT correction to the task brief.** The task describes literal jumpback edges such as `60→70`, `70→73`, `70→80`, `62→85`, `65→68`. **These edges do not exist in the fixture, nor are they produced by the pipeline.** The real Siriu topology in `siriu-topology.json` is *consecutively numbered* (post N connects to post N+1 in PDF order) with bifurcations encoded by `source`-tagged distance rows, not by literal jumps to far post numbers. The actual bifurcations are at posts **5, 11, 14, 23, 32, 36, 41, 48, 57, 64**. All findings below are against the *actual* topology, verified by running the pipeline. The "jumpback" terminology in the brief maps onto the `jumpback-suppressed` / `bifurcation-main` distance sources, not onto literal far-number edges.

---

## Summary of findings (per question)

### Q1 — What is the `source` field on connection objects?

**Connections carry NO `source` field.** Verified by running `calculateCoordinates` on the fixture:

```
connection object fields: from,to,meters,bearing,gap
has source field? false
```

`source` exists **only on distance objects** (`distances[]` and the `distLookup` map). When `coordinate-calculator.js` builds the `connections` array (the loops starting at line 2037 and 2146, plus `finalizeBifurcationConnections`), it copies `from/to/meters/bearing/gap` (and optionally `cross_page`, `implied`) but never propagates `source`. So `buildKml` / `buildRoutePolylines` receive connections with no knowledge of *why* an edge exists (tap vs main vs rejoin).

Confidence: **HIGH** (executed against fixture).

### Q2 — The `branchStarts` bug (`Math.abs(o.to - e.from) > 1`)

`buildKml` (lines 151–164) builds `branchStarts` by scanning every post that has more than one out-edge and, for each *other* out-edge `o`, adding `o.to` to `branchStarts` **iff `|o.to − e.from| > 1`**.

For the actual Siriu bifurcations, the two out-edges from a junction J are:
- a **consecutive tap** `J → J+1` (e.g. `64→65`), and
- a **main jump** `J → hi` where `hi > J+1` (e.g. `64→66`, `5→10`, `14→18`).

Computed `branchStarts` for Siriu: **`{10, 13, 18, 25, 34, 38, 43, 54, 59, 66}`** — i.e. it marks the **main-route jump target**, NOT the spur start. This is **inverted from intent**:

- At `64`: tap is `64→65` (the spur into 65→…), main is `64→66`. `branchStarts` gets **66** (the main), but the thing that should be flagged as "starts a separate polyline" is the *spur* 65. (In Siriu the spur tip 65 then has only `65→66`=cleared, so 65 is a dead-end stub — but the principle is inverted.)
- At `5`: tap `5→6` (spur 6,7,8,9), main `5→10`. `branchStarts` gets **10** (main). Spur start 6 is NOT flagged.

**What `branchStarts` controls in `preferMainRouteEdge`:** only the **last fallback** (line 69): `const nonBranch = sorted.filter((e) => !branchStarts.has(e.to))`. It is consulted *only* when there is no consecutive edge and no jump-with-continuation. For every real Siriu bifurcation a consecutive tap edge exists, so **this fallback never fires** and `branchStarts` has effectively **zero influence** on `preferMainRouteEdge` in practice. Its only real effect is in `buildRoutePolylines`' chaining via that same fallback — which is dead code for Siriu.

So the `branchStarts` set is both **mislabeled** (marks main, not spur) and **inert** for the cases that matter. Confidence: **HIGH**.

> Note: `coordinate-calculator.js` has its *own*, correct `branchStarts` (line 1502) derived from `detectRouteTopology()` — that is a different set used for GPS chaining and is unrelated to the `buildKml`-local set. The bug is specifically the `buildKml`-local recomputation.

### Q3 — `preferMainRouteEdge` jump-detection when the jump target has no consecutive continuation

`preferMainRouteEdge` (lines 53–71) logic:
1. `consecutive` = edge to `from+1`.
2. `jumps` = edges to anything else.
3. **If** there is a consecutive AND ≥1 jump: pick the **first jump whose target `hi` has its own `hi→hi+1` edge unused** (a "continuation"). Return that jump.
4. Else return `consecutive`.
5. Else `branchStarts` fallback.

**This is exactly where junctions 14, 36, 64 break.** Verified by simulation:

```
post  5  tos 6,10  => MAIN 10  (jump 10 has continuation 10->11)   CORRECT
post 11  tos 12,13 => MAIN 13  (jump 13 has continuation 13->14)   CORRECT
post 14  tos 15,18 => MAIN 15  (fell back to consecutive)          WRONG (should be 18)
post 23  tos 24,25 => MAIN 25  (jump 25 has continuation 25->26)   CORRECT
post 32  tos 33,34 => MAIN 34  (jump 34 has continuation 34->35)   CORRECT
post 36  tos 37,38 => MAIN 37  (fell back to consecutive)          WRONG (should be 38)
post 41  tos 42,43 => MAIN 43  (jump 43 has continuation 43->44)   CORRECT
post 48  tos 49,54 => MAIN 54  (jump 54 has continuation 54->55)   CORRECT
post 57  tos 58,59 => MAIN 59  (jump 59 has continuation 59->60)   CORRECT
post 64  tos 65,66 => MAIN 65  (fell back to consecutive)          WRONG (should be 66)
```

At 14/36/64 the jump target (18/38/66) is itself a bifurcation/dead-leg whose *next* edge is `jumpback-suppressed` (no `18→19`, `38→39`, `66→67`). The continuation test `hi→hi+1` therefore fails, the function falls back to the **consecutive tap**, and the **main route is drawn as the tap leg** — the bifurcation is drawn inaccurately. This is the **core bug** the user is reporting.

Confidence: **HIGH**.

### Q4 — Post 70 (and the 14/36/64 analogues): which edge becomes main, which starts a new polyline

There is **no literal `70→73`/`70→80` double-jump** in the data (see top-of-doc correction). The structurally equivalent real case is a junction with one tap + one non-continuing jump (14, 36, 64).

For post **64** (`64→65` tap, `64→66` main):
- `preferMainRouteEdge` picks **65** as main (wrong) → polyline extends `…63,64,65`.
- Edge `64→66` is left unused → it starts its **own** polyline `64,66`.
- Result polylines (actual run): `…,63,64,65` is absorbed into the big page-6 line, and `64,66` is a standalone 2-point line. The intended spur through 66→67→68→69→70→… is **severed** because `66→67` is suppressed and `66` was treated as a branch-start stub.

For post **14** (`14→15` tap, `14→18` main): picks **15** (wrong) → main route turns into the 15→16→17 tap spur; `14→18` becomes a standalone `14,18` 2-point line. Same severing.

So the answer: the **consecutive tap wrongly becomes main**, and the **true main jump is demoted to an isolated 2-post polyline**. Confidence: **HIGH**.

### Q5 — What polylines are actually produced for the jumpback region

Actual `buildRoutePolylines` output (using the `buildKml`-computed `branchStarts`), full route:

```
1,2,3,4,5,10,11,13,14,15,16,17        <- merges past junction 14 into the 15-17 tap (WRONG: 14 main is 18)
11,12                                  <- 11 tap stub
14,18                                  <- 14 main demoted to 2-pt stub (WRONG)
19,20,21,22,23,25,26,27,28,29,30,31,32,34,35,36,37   <- merges past junction 36 into 37 tap (WRONG)
23,24
32,33
36,38                                  <- 36 main demoted to 2-pt stub (WRONG)
39,40,41,43,44,45,46,47,48,54,55,56,57,59,60,61,62,63,64,65   <- merges past junction 64 into 65 tap (WRONG)
41,42
48,49,50,51,52,53
5,6,7,8,9                              <- 5 branch spur CORRECT
57,58
64,66                                  <- 64 main demoted to 2-pt stub (WRONG)
67,68,69,70,71,72,73                   <- orphaned: spur after 66 (66->67 suppressed so it never joins)
74,75,76,77,78,79,80,81,82,83,84,85    <- orphaned: spur after 73 (73->74 suppressed)
```

**Correct** behavior at junctions 14/36/64 would be:
- `14` main continues to `18` then the 18→… leg; the `15,16,17` tap is a separate spur off 14.
- `64` main continues to `66→67→68→69→70→71→72→73`; the `65` leg is the tap spur off 64.

So the code **merges the tap into the main trunk and isolates the true main as a 2-point stub**, then leaves the post-66 / post-73 spurs orphaned (drawn but disconnected from their junction). The well-behaved junctions (5, 11, 23, 32, 41, 48, 57) work *by accident* because their jump target happens to have a consecutive continuation. Confidence: **HIGH**.

### Q6 — Does `coordinate-calculator.js` add a `source` to connections; can `buildKml` use it?

`coordinate-calculator.js` **knows** the source for every edge (it reads `distLookup` with `source` in `finalizeBifurcationConnections`, and uses `bifurcation-main`, `bifurcation-tap`, `jumpback-suppressed`, `bifurcation-cleared`, `inferred-label` to decide which edges to keep/drop). But it **discards** that classification when emitting connections — the pushed objects never include `source`.

The `bifurcation-main` rows precisely identify the main edge at the hard junctions:
```
36->38 [bifurcation-main]     (vs tap 36->37 [bifurcation-tap])
64->66 [bifurcation-main]     (vs tap 64->65 [bifurcation-tap])
41->43 [bifurcation-main]
11->13, 23->25, 32->34, 57->59 [bifurcation-main]
```
and `14->18 [inferred-label]` is the main for junction 14.

**Yes — propagating `source` onto connections is the clean fix.** If each connection carried `source`, `preferMainRouteEdge` could deterministically pick the `bifurcation-main` (or non-`bifurcation-tap`) edge as main regardless of whether the jump target has a consecutive continuation, and `branchStarts` could flag the `bifurcation-tap` target as the spur. This removes the fragile `hi→hi+1` heuristic entirely. Confidence: **HIGH**.

### Q7 — Minimal fix

**Two-part fix. Part A (recommended, robust) propagates `source`; Part B is a heuristic-only fallback if touching the connection schema is undesirable.**

#### Part A — propagate `source`, classify by it (preferred)

1. In `coordinate-calculator.js`, when building each connection, attach the originating distance `source`:
   - In `finalizeBifurcationConnections` `makeConn`, set `source` from `distLookup.get(connKey(fromNum,toNum))?.source` (or the override's source).
   - In the two main connection-build loops (≈ line 2067 and 2132) and the consecutive-fill loop (≈ line 2180), set `source` from `distLookup`/`distMap` lookup. Tap legs get `bifurcation-tap`, main jumps get `bifurcation-main`/`inferred-label`.
   - This is additive — `walkConnections` snapshot and all existing consumers ignore unknown fields.

2. In `kml-builder.js`:
   - **`branchStarts` (buildKml lines 151–164):** replace the `Math.abs(o.to - e.from) > 1` test with: at a multi-out post, the **spur start is the `bifurcation-tap` target** (or, lacking source, the *consecutive* `from+1` target when the other edge is the main). Add the tap target to `branchStarts`, NOT the main jump.
   - **`preferMainRouteEdge`:** prefer, in order: (a) an edge whose `source === 'bifurcation-main'` or `'inferred-label'`; (b) the existing continuation heuristic; (c) consecutive; (d) non-branch fallback. Concretely, insert at the top:
     ```js
     const mainTagged = sorted.find(e =>
       e.source === 'bifurcation-main' || e.source === 'inferred-label');
     if (mainTagged) return mainTagged;
     ```
   This deterministically fixes 14/36/64 (`14→18`, `36→38`, `64→66` are tagged main/inferred) while leaving the already-correct junctions unchanged.

#### Part B — heuristic-only fallback (if connection schema is frozen)

Within `preferMainRouteEdge`, when a consecutive tap and a jump both exist but **no jump has a `hi→hi+1` continuation**, prefer the **jump** rather than falling back to the tap — because a lone non-continuing jump from a bifurcation is the main rejoin, while the consecutive edge is the tap spur. Change lines 58–68 so that after the continuation loop fails, if `jumps.length > 0` choose the jump (smallest `hi`) instead of immediately returning `consecutive`:

```js
if (jumps.length > 0 && consecutive) {
  for (const jump of jumps) {
    const hi = jump.to;
    const mainCont = (outMap.get(hi) ?? []).find(
      (e) => e.to === hi + 1 && !used.has(`${e.from}->${e.to}`));
    if (mainCont) return jump;
  }
  // NEW: non-continuing jump from a bifurcation is still the main rejoin
  return jumps[0];          // jumps already sorted ascending by .to
}
```

Caveat: Part B is purely structural and would also fire for a genuine "tap is the through-route, jump is the spur" topology if one existed; Part A (source-driven) is unambiguous. **Recommend Part A**, optionally keeping Part B as the no-source fallback.

#### Multiple simultaneous jumps from one post
`preferMainRouteEdge` already iterates `jumps` in ascending `.to` order and `buildRoutePolylines` already re-enters unused jump edges as their own polylines, so 1 main + N spurs is handled once the *main* is chosen correctly. With Part A, the `bifurcation-main`-tagged edge is main and the rest start their own polylines — correct by construction.

Confidence: **HIGH** for Part A correctness on the fixture; **MEDIUM** for Part B edge-cases on non-Siriu topologies.

### Q8 — Tests needed

Add to `parser/__tests__/kml-builder.test.mjs` and/or `bifurcation-connections.test.mjs`:

1. **Unit `preferMainRouteEdge`/`buildRoutePolylines` — non-continuing jump main (the core fix).**
   Connections: `{63,64},{64,65},{64,66,source:'bifurcation-main'},{66,67}...{72,73}` with `65` a stub. Assert the main polyline is `…,64,66,67,…,73` and `64,65` is a separate (tap) line — NOT `…,64,65` with `64,66` as a 2-pt stub.

2. **Unit — `bifurcation-main` source overrides continuation heuristic.**
   Junction with tap `J→J+1` having a long continuation AND jump `J→hi` tagged `bifurcation-main`. Assert main follows the tagged edge.

3. **Integration — full Siriu fixture (the real regression).**
   Run `calculateCoordinates` on `siriu-topology.json` (with GPS stub), feed `connections` to `buildRoutePolylines`, and assert:
   - main trunk passes **through** `…,14,18,…`, `…,36,38,…`, `…,64,66,67,68,69,70,71,72,73`;
   - tap spurs `14→15→16→17`, `64→65`, `36→37` are **separate** polylines;
   - no junction main edge appears as an isolated 2-point line (`14,18` / `36,38` / `64,66` must NOT be standalone 2-point lines);
   - the post-66 spur is **contiguous with** its junction (no orphaned `67,68,…` line that starts mid-route).

4. **branchStarts classification test.**
   Assert that for `{64→65 tap, 64→66 main}` the spur flagged is `65` (tap target), not `66`.

5. **Regression guard — well-behaved junctions unchanged.**
   Assert junctions 5/11/23/32/41/48/57 still produce `5,6,7,8,9` etc. exactly as today (the existing `3,4,5,10,11` + `5,6,7,8,9` assertion must still pass).

---

## Root-cause analysis

The KMZ bifurcation drawing relies on a **structural heuristic** (`preferMainRouteEdge`) to decide, at a junction, which out-edge is the through-route (main) and which is the tap/spur. The heuristic assumes *the main route's next post has a consecutive continuation* (`hi→hi+1`). This holds for 7 of the 10 Siriu junctions but **fails at junctions 14, 36, 64**, where the main jump target is itself a bifurcation/dead-leg whose next edge is `jumpback-suppressed`. There the heuristic falls back to the **consecutive tap edge as main**, producing three defects:

1. the **tap spur is merged into the main trunk** (e.g. trunk runs `…64,65` instead of `…64,66,67…`);
2. the **true main edge is demoted to an isolated 2-point polyline** (`14,18`, `36,38`, `64,66`);
3. the **downstream spur is orphaned** (e.g. `67,68,69,70,71,72,73` drawn but disconnected from its junction, because `66→67` is suppressed and `66` was treated as a stub).

The deeper cause: **the `source` classification that `coordinate-calculator.js` already computes (`bifurcation-main`, `bifurcation-tap`, `inferred-label`, `jumpback-suppressed`) is discarded when connections are built**, forcing `kml-builder.js` to *re-derive* main-vs-tap from geometry/numbering with an incomplete heuristic. Compounding this, the `buildKml`-local `branchStarts` set is computed with an **inverted test** (`|o.to − e.from| > 1`) that flags the main jump target as a "branch start" instead of the tap, and is effectively inert anyway because the consecutive-edge path in `preferMainRouteEdge` short-circuits before the `branchStarts` fallback is reached.

---

## Proposed fix (concise)

1. **Propagate `source` onto connections** in `coordinate-calculator.js` (additive field; safe for `walkConnections` snapshot and all existing consumers).
2. **`preferMainRouteEdge`:** prefer an edge tagged `bifurcation-main`/`inferred-label` as main; keep the continuation heuristic as a secondary; add "non-continuing jump beats consecutive tap" as a structural fallback for untagged data.
3. **`branchStarts` in `buildKml`:** flag the **tap** target (consecutive / `bifurcation-tap`) as the spur start, not the main jump target.

---

## Risk assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Breaking the 7 already-correct junctions (5,11,23,32,41,48,57) | LOW | Part A only *adds* a higher-priority main selection; for those junctions the tagged main equals the heuristic main, so output is unchanged. Regression test #5 guards this. |
| Other fixtures (João Born, Valmor) regress | MEDIUM | They use the same `source` tags; run the full `parser/__tests__` suite. Part A is source-driven so behavior is consistent across networks. Add their polyline snapshots if not already covered. |
| `source` propagation collides with `walkConnections` decoupling | LOW | `walkConnections` is snapshotted *before* `finalizeBifurcationConnections` and only reads `from/to/meters/bearing/gap`; an extra `source` field is ignored. Confirmed by reading lines 2198–2208. |
| Part B (heuristic fallback) misfires on a real "tap-is-through, jump-is-spur" topology | MEDIUM | Prefer Part A (source-driven) as primary; only use Part B when `source` is absent. Document the assumption. |
| DWG-walk pairing (consecutive N→N+1 guarantee, lines 2146–2190) affected | LOW | The fix touches only KMZ-facing classification, not the consecutive-fill guarantee. The fill loop still emits every N→N+1; `source` is added, not removed. |

---

## Sources

- `parser/kml-builder.js` lines 41–130 (`preferMainRouteEdge`, `buildRoutePolylines`), 151–164 (`branchStarts`), 213 (call site). [VERIFIED: read]
- `parser/coordinate-calculator.js` lines 826–1036 (`isBifurcationTapLeg`, `buildDistanceLookup`, `findBranchReturns`, `finalizeBifurcationConnections`), 2026–2237 (connection build + snapshot). [VERIFIED: read]
- `parser/__tests__/fixtures/siriu-topology.json` distances lines 760–1409 (source tags). [VERIFIED: read]
- Pipeline execution on the fixture (connections, branchStarts, polylines, per-junction `preferMainRouteEdge` simulation). [VERIFIED: executed]
- Existing tests: 10/10 pass — the failing topology (junctions 14/36/64) is **untested**. [VERIFIED: ran `node --test`]
