---
phase: 08-global-pdf-dxf-solver
reviewed: 2026-06-09T00:00:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - package.json
  - parser/__tests__/global-solver-cascade.test.mjs
  - parser/__tests__/global-solver-topology.test.mjs
  - parser/__tests__/global-solver.test.mjs
  - parser/__tests__/median-crossval.test.mjs
  - parser/dwg/coordinate-calculator-dwg.js
  - parser/dwg/global-solver.js
  - parser/dwg/median-crossval.js
  - tools/run-solver-timing-gate.mjs
findings:
  critical: 2
  warning: 6
  info: 4
  total: 12
status: issues_found
---

# Phase 8: Code Review Report

**Reviewed:** 2026-06-09
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Phase 8 adds the level-0 global PDF→DXF bipartite solver (`global-solver.js`), the
pre-solve median cross-validation scale guard (`median-crossval.js`), the
4-level cascade wiring (`coordinate-calculator-dwg.js`), and a wall-clock budget
gate (`run-solver-timing-gate.mjs`), plus three test suites.

The cascade wiring is solid: the demote-to-graph-walker path is correctly fed
pristine inputs and the accept-bar plumbing is clean. However the **topology
gate's arc-position computation is a hop-count BFS treated as a weighted
shortest-path**, which is mathematically wrong on any DXF graph containing a
junction/cycle — precisely the routes this gate exists to police. That is the
headline blocker. A second blocker is a **silent NaN hole** in the median
scale-guard ratio that can let a degenerate (all-zero-distance) route bypass the
mismatch check. The remaining findings are robustness gaps (even-length median
bias, sentinel collision, anchor-degree-class never validated) and quality
items.

## Critical Issues

### CR-01: `cableSpanAlongPath` is a hop-count BFS used as a weighted shortest-path — wrong arc positions on any graph with a junction or cycle

**File:** `parser/dwg/global-solver.js:119-141` (used at `:233`)
**Issue:**
`cableSpanAlongPath` accumulates Euclidean edge lengths into `dist`, but it
explores with a plain FIFO queue and marks each node visited at *enqueue* time,
returning `newDist` the first time any edge reaches `toIdx` (line 135). This is
breadth-first by **hop count**, not Dijkstra by **distance**. The first path to
reach the target in fewest hops is returned even when a different path has a
smaller accumulated span. On a pure linear chain the hop-minimal path is also
the distance-minimal path, so the unit tests (`makeLineRegion`) pass — but on
`makeForkRegion` and on every real route with a junction (which is the entire
reason D-10 partitions runs at junctions), the arc position can be computed
along a longer detour.

Because `checkTopologyGate` (line 237) rejects a run when
`arcPos < prevArc - monotonicTol`, a mis-computed arc position can **falsely
fail a correct assignment (spurious demotion)** or **falsely pass a swapped
assignment (missed defect)** — either way the gate's verdict is unsound exactly
where it matters most. The "junction reset" test passes only because each arm in
the fork fixture is itself linear from its junction start.

**Fix:** Use a real shortest-path (Dijkstra with a priority queue), and do not
finalize a node's distance until it is popped as the current minimum:
```javascript
function cableSpanAlongPath(fromIdx, toIdx, adjacencyGraph, regionPosts) {
  if (fromIdx == null || toIdx == null) return null;
  if (fromIdx === toIdx) return 0;
  const dist = new Map([[fromIdx, 0]]);
  // small graphs: linear-scan PQ is fine; swap for a binary heap if needed
  const pq = [{ idx: fromIdx, d: 0 }];
  const settled = new Set();
  while (pq.length) {
    let best = 0;
    for (let i = 1; i < pq.length; i++) if (pq[i].d < pq[best].d) best = i;
    const { idx, d } = pq.splice(best, 1)[0];
    if (idx === toIdx) return d;
    if (settled.has(idx)) continue;
    settled.add(idx);
    for (const n of adjacencyGraph.get(idx) ?? []) {
      if (settled.has(n)) continue;
      const nd = d + Math.hypot(
        regionPosts[n].x - regionPosts[idx].x,
        regionPosts[n].y - regionPosts[idx].y,
      );
      if (nd < (dist.get(n) ?? Infinity)) {
        dist.set(n, nd);
        pq.push({ idx: n, d: nd });
      }
    }
  }
  return null;
}
```

### CR-02: median ratio can be `NaN`, silently bypassing the scale-mismatch guard

**File:** `parser/dwg/median-crossval.js:64-70`
**Issue:**
`medianOf` returns `null` when its input array is empty. The earlier guard at
line 60 only checks `pdfMeters.length` / `dxfSpans.length` are non-zero, not that
the medians are non-null/non-zero. If `medianDXF` is `0` (possible: every DXF
span is filtered to >0 at line 57, so this specific path is guarded) the ratio is
`Infinity`; more importantly, the comparison `ratio < 1/AGREEMENT_FACTOR || ratio > AGREEMENT_FACTOR`
evaluates to **`false` when `ratio` is `NaN`**. Any path that yields `medianPDF`
or `medianDXF` of `null` (e.g. a future caller that passes pre-filtered arrays,
or a regression in the filters above) produces `ratio = NaN`, both comparisons
return `false`, and the function returns `{ ok: true }` with `NaN` tolerances —
which then propagate into `spanTolM`/`candidateWindowM` and poison every
downstream distance comparison (`x <= NaN` is always false). A scale guard that
can return `ok:true` on degenerate input is a correctness hole: the solver runs
on mismatched units instead of demoting.

**Fix:** Validate the medians and ratio explicitly before the band check:
```javascript
const medianPDF = medianOf(pdfMeters);
const medianDXF = medianOf(dxfSpans);
if (medianPDF == null || medianDXF == null || !(medianDXF > 0)) {
  return { ok: false, reason: "insufficient-data" };
}
const ratio = medianPDF / medianDXF;
if (!Number.isFinite(ratio) || ratio < 1 / AGREEMENT_FACTOR || ratio > AGREEMENT_FACTOR) {
  return { ok: false, reason: "scale-mismatch", medianPDF, medianDXF, ratio };
}
```

## Warnings

### WR-01: `medianOf` uses the upper-middle element — biased for even-length inputs

**File:** `parser/dwg/median-crossval.js:23-27`
**Issue:**
`sorted[Math.floor(sorted.length / 2)]` returns the upper of the two middle
elements for even-length arrays (e.g. for `[10, 20]` it returns `20`, not `15`).
This is the *upper median*, not the true median. The same pattern recurs in
`residual-gate.js:81`. For the scale guard this skews `medianPDF`/`medianDXF`
upward and shifts every derived tolerance, and the bias is data-dependent. The
test fixtures all use odd counts or symmetric data, so the bias is invisible in
CI.

**Fix:** Average the two central elements on even length:
```javascript
function medianOf(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
```

### WR-02: anchor `degreeClass` is never validated — only `degreeClass(pdf) !== degreeClass(dxf)` for non-anchor posts, anchor row uses `-Infinity` unconditionally

**File:** `parser/dwg/global-solver.js:671-675`
**Issue:**
The anchor cell is forced to `-Infinity` (line 674) so munkres is *required* to
assign post 1 to `anchorBest`, regardless of span-fit or position residual. If
the nearest INSERT to the GPS anchor (`anchorBest`, chosen purely by Euclidean
proximity at lines 588-596) is the *wrong* node — e.g. a neighboring spur head
within `DEFAULT_TOLERANCE_M` — the solver hard-pins post 1 there and the entire
dead-reckoning propagation (`propagatePredictedPositions`) is seeded from the
wrong origin. There is no cross-check that `anchorBest`'s DXF degree class
matches post 1's connection degree before pinning. The topology gate later
*can* catch a degree mismatch at post 1, but only if post 1 happens to be a
junction; a degree-1/degree-2 mis-pin sails through.

**Fix:** Before forcing `-Infinity`, verify the anchor candidate's degree class
is consistent with post 1's `connAdj` degree, or fall back to ranking anchor
candidates by combined (proximity + degree-class match) rather than proximity
alone; demote with a distinct reason when no degree-consistent anchor exists.

### WR-03: sentinel-cost collision threshold `>= sentinel * 0.999` can misclassify a legitimately high real cost as "uncovered"

**File:** `parser/dwg/global-solver.js:639-685`
**Issue:**
`maxRealCost` starts at `1` and tracks the max real cost; `sentinel = 10 * maxRealCost`.
The coverage check (line 685) treats any assigned cell with
`cost >= sentinel * 0.999` as an uncovered/sentinel assignment and demotes with
`reason: "coverage"`. But a real (non-sentinel) cost is capped at `maxRealCost`,
and `sentinel * 0.999 = 9.99 * maxRealCost`, so a real cost can never reach it —
*unless* `maxRealCost` is driven by one pathological post while another post's
only candidate also has a near-sentinel real cost. The fragility is the magic
`0.999` fudge and the `SENTINEL_MULT = 10` coupling: there is no invariant
asserted that real costs and sentinels are separable, so a future weight change
(`W_POS`/`W_SPAN`) can silently make them collide. Additionally, when `maxRealCost`
stays at its initial `1` (all real costs are 0, e.g. perfect identity fit),
`sentinel = 10` and the separation holds only by luck of the seed value.

**Fix:** Track assignment validity structurally instead of by magnitude: record
which `(ri,ci)` pairs were real (the `realCosts[ri][ci] != null` matrix already
exists) and after munkres returns, demote if any assigned `(y,x)` has
`realCosts[y][x] == null`. This removes the `0.999`/`SENTINEL_MULT` coupling
entirely.

### WR-04: `propagatePredictedPositions` dead-reckons every non-anchor hop colinearly with its parent edge — large angular error accumulates, biasing candidate prune

**File:** `parser/dwg/global-solver.js:389-404`
**Issue:**
For every post after the first hop, the predicted direction is copied from the
parent→current edge direction (lines 390-398), i.e. the route is assumed to
continue in a straight line. Real routes turn at every post. The predicted
position therefore drifts cumulatively, and `pruneCandidates` searches a window
(`candidateWindowM = 2 * medianPDF`) centered on that drifting prediction. On a
route that turns consistently, the true DXF node can fall outside the window and
be pruned, producing a spurious `coverage` demotion. This is masked in tests by
straight-line fixtures. Not a crash, but a correctness-affecting heuristic with
no guard rail (e.g. no re-anchoring to known-good candidates mid-propagation).

**Fix:** At minimum widen the prune window proportional to accumulated hop count,
or re-seed direction from the best-matching DXF neighbor at each hop (as is
already done for the anchor at lines 369-388) rather than only at the anchor.

### WR-05: `npm test` script does not run any Phase 8 suite — new solver tests are unreachable from the default test entry point

**File:** `package.json:11-14`
**Issue:**
The `test` script (line 11) runs five legacy `.test.mjs` files and never invokes
`global-solver.test.mjs`, `global-solver-topology.test.mjs`,
`global-solver-cascade.test.mjs`, or `median-crossval.test.mjs`. They are also
absent from `test:unit` (line 12) and `test:gate` (line 13). The only Phase 8
artifact wired into a script is the *timing* gate
(`run-solver-timing-gate.mjs`), which by its own docstring "does NOT require the
solver to ACCEPT" — it asserts wall-clock only. So the correctness suites for
the new solver run **only if invoked manually**. A regression in the solver's
assignment logic would not be caught by `npm test` or `npm run test:gate`.

**Fix:** Add the four new suites to `test:unit` (they use `node --test`):
```json
"test:unit": "node --test parser/__tests__/graph-walker.test.mjs ... parser/__tests__/global-solver.test.mjs parser/__tests__/global-solver-topology.test.mjs parser/__tests__/global-solver-cascade.test.mjs parser/__tests__/median-crossval.test.mjs",
```

### WR-06: `console.log` debug artifact left on the production demotion path

**File:** `parser/dwg/coordinate-calculator-dwg.js:179`
**Issue:**
`console.log("solver demoted; using graph-walker")` fires on every cascade
demotion in the live `runDwgPairingCascade`. This is unconditional stdout noise
in the browser/production path (the module is the production calc entry). A
structured `warnings.push` for the same event already exists on the next line
(line 180), so the `console.log` is redundant as well as noisy. (The cascade
test at `global-solver-cascade.test.mjs:138` asserts on this log line, so the
test is coupled to a debug artifact — update the test to assert on the
`dwg-solver-demoted` warning instead.)

**Fix:** Remove the `console.log`; keep the `warnings.push({ kind: "dwg-solver-demoted", ... })`.
Update the cascade test to assert on the warning object rather than captured
stdout.

## Info

### IN-01: Undocumented duplicate test-injection param `_testAssignments`

**File:** `parser/dwg/global-solver.js:541-544`
**Issue:**
`solveGlobalGraphAlignment` destructures both `testAssignments` and
`_testAssignments` and coalesces them (`testAssignments ?? _testAssignments`).
Only `testAssignments` appears in the JSDoc (line 524). The dual alias is
dead-weight ambiguity — pick one name.
**Fix:** Keep a single documented `_testAssignments` (underscore convention for
test-only seams) and drop the other.

### IN-02: `void coords;` and unused `coords` param in `checkTopologyGate`

**File:** `parser/dwg/global-solver.js:192-203, 259`
**Issue:**
`coords` is accepted, never read, and discarded with `void coords;`. The
parameter inflates the signature and the `void` statement is a smell signalling
the param exists only to satisfy a caller's spread. If it is genuinely unused,
remove it from the destructure and from `evaluateAcceptBar`'s forwarding.
**Fix:** Drop `coords` from `checkTopologyGate`'s params (and the `void`); stop
forwarding it at line 293.

### IN-03: `partitionLinearRuns` rebuilds the connection adjacency that `buildConnAdj`/`buildConnAdjFromConnections` already build elsewhere

**File:** `parser/dwg/global-solver.js:57-67, 78-80, 326-337`
**Issue:**
There are two near-identical adjacency builders: `buildConnAdjFromConnections`
(Set-valued) and `buildConnAdj` (array-valued), plus `checkTopologyGate` builds
its own again. The duplication invites drift (e.g. one filters by `postSet`, one
must be kept in sync). Consolidate into one builder with a `valued: "set"|"array"`
option.
**Fix:** Extract a single adjacency helper; have callers pick the container type.

### IN-04: timing gate uses haversine ground-truth spans as the printed-distance proxy — gate cannot detect span-fit regressions

**File:** `tools/run-solver-timing-gate.mjs:84-96`
**Issue:**
`buildSolverInputs` synthesizes `distances` from haversine between consecutive
ground-truth posts, so the D-02 span-fit term is fed the *exact* geometric
truth. This is fine for a wall-clock budget gate (its stated purpose), but the
file's prominence could mislead a future maintainer into treating it as an
accuracy gate. The docstring already disclaims this; consider an inline comment
at the `distances.push` site reaffirming "proxy only — not the real printed
labels; do not assert accuracy here."
**Fix:** Add a one-line comment at line 91 to prevent misuse.

---

_Reviewed: 2026-06-09_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
