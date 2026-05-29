---
status: partial-fix
trigger: DWG graph-walk errors spike at post 45 (67m) and fail at post 48→49 (no-candidate)
created: 2026-05-29
updated: 2026-05-29
priority_angle: walker runs out of unclaimed neighbors at idx=131 (post 48); root cause upstream at 44→45 transition
---

## RESOLUTION (partial — 2026-05-29)

### Root cause of the post-45 spike (FIXED)

A **phantom inferred-label `43->45 = 28.9`** (source `inferred-label`, mirroring the
real consecutive `43->44 = 28.9`) drove the 44->45 step off the correct neighbor.

At 44->45: post 44 = idx 74, whose only unclaimed cable neighbor is **idx 76**
(span 32.3m, an exact match for the label `44->45 = 32.3`). idx 76 IS the true
post 45 (GT nearest, d=6.6m). But the broad hint-jumpback loop in graph-walker.js
(the loop that collects ANY visited post carrying a label to `toNum`) fired even
though `labelM` was non-null, picked up post 43's phantom `43->45=28.9` label, and
multi-hopped from the degree-4 junction idx 133 (post 43) to **idx 79** (the wrong
INSERT, 67m off). The chosen path 74->133(claimed)->79 routed the walk into an
already-claimed cable region, cascading 67m→173m→215m→no-candidate.

The existing `isPhantomBifurcationHint` guard only rejected `bifurcation-main`
phantoms, not `inferred-label` ones.

### Fix applied (parser/dwg/graph-walker.js)

Added `hasDirectConsecutiveMatch`: when the consecutive label `labelM` is matched
by a DIRECT unclaimed cable neighbor of `fromIdx` within tolerance, the consecutive
edge physically exists, so the broad non-consecutive hint loop is suppressed
(`if (chosenIdx === undefined && !hasDirectConsecutiveMatch)`). The narrower
`labelM == null`-gated hint collectors (junction / prev-post) are unchanged, and the
softer `hintDelta` tiebreak inside direct-neighbor selection still applies — so
genuine branch returns (which have `labelM == null`) are unaffected.

### Verified results

- Post 45: **67m → 6.66m** (idx 79 → idx 76, the true INSERT). FIXED.
- Walk now extends 4 posts further: previously failed at 48->49, now reaches post 52
  before failing at 52->53.
- Posts 1–45 all <14m (most <9m).
- Tests green: graph-walker 4/4, coordinate-calculator 22/22, distance-associator 11/11.
- post-positioning: 14 pass / 3 fail — the 3 fails are PRE-EXISTING (Viterbi symbol
  fixtures, unrelated to graph-walker; verified identical on the a6749cb baseline).

### Commit

`fix(dwg): reject phantom inferred-label hint when direct consecutive neighbor matches (Siriu post 45)`

## REMAINING FAILURE (open — distinct, harder problem)

After post 45 the walk still drifts: posts 46–52 land 265–365m off.

**Topology (confirmed via probes):**
- The parallel branch is posts 36–45. Post 45 (idx 76) is a TRUE TERMINAL of that
  branch; its only forward cable neighbor (idx 111 → 112 → 113 …) is a service stub
  that corresponds to NO ground-truth post.
- The spine resumes from the branch-entry junction **post 36 (idx 123)** along its
  unused arm: `123 -> 153` (span 34.7m). Posts 46–52 live in the idx 153/155/157/156/
  158/159/161 cluster (the east spine), reachable ONLY through junction idx 123.
- There is **no hint label** linking any visited spine post to post 46
  (`36->46`, `42->46`, `43->46` all null; only `45->46=27.7` and `46->47=25.5` exist,
  both `legacy-midpoint`). The label `45->46=27.7` does NOT match any real edge from
  idx 76 (true 45->46 straight-line span is 238.9m; 36->46 is 34.7m).

**Why current logic cannot solve it:**
- Case A succeeds (wrongly) at 45->46 because idx 76's forward neighbor idx 111
  (span 33.3, delta 5.6 vs label 27.7) is within tolerance and is NOT a dead-end
  (degree 2), so `directUsable` is true and `directIsDeadEnd` is false. Case B
  (junction jumpback) therefore never runs.
- Even if Case B ran, `lastVisitedJunction` would return idx 133 (post 43, the most
  recent deg-4 junction), NOT idx 123 (post 36). The path to the spine arm 153 runs
  through the now-claimed junction idx 123, which jumpback does not re-enter.

**Required (new) mechanism — needs design/user input:**
Detect that post 45 is a branch terminal and that the spine resumes at the
branch-ENTRY junction (post 36 / idx 123) via its single unused arm (idx 153).
Options:
  (A) Track the branch-entry junction when the walk first taps off the spine
      (post 36 had deg-4 arms; the walk took 152/124 into the branch and left
      153 unused). On reaching a branch terminal whose forward continuation fails
      the next-label lookahead, jump back to that entry junction's unused arm.
  (B) A lookahead-quality gate that lets Case B's junction jumpback override a
      "usable" Case-A direct neighbor when the jumpback arm fits BOTH `labelM` and
      the next label much better than the direct continuation.
Both carry regression risk to the frozen Valmor / João Born routes and warrant a
user checkpoint before implementing.

---

## Session context (original)

This picks up directly from the session that fixed posts 1–44 (commits f4007cb, db42194, a6749cb).

### What was fixed in prior session

| Commit | Fix |
|--------|-----|
| f4007cb | bifurcation-tap hint search traverses tap-placed node (post 25 fixed: 68m→1.1m) |
| db42194 | N3 mirror confidence gate — OCR post numbers no longer clobbered on multi-sheet routes (posts 28–33 restored from missing to 1–5m) |
| a6749cb | 36-bifurcation cascade: 33→34 overshoot, 37→38 main-line, 38→39 phantom hint (posts 34–44 now <14m) |

### Walk trace BEFORE fix (GW_TRACE=1)

```
43->44  fromIdx=133 -> chosen=74   gap=false  label=28.90
44->45  fromIdx=74  -> chosen=79   gap=false  label=32.30   ← WRONG (should be idx 76)
45->46  fromIdx=79  -> chosen=77   gap=false  label=27.70
46->47  fromIdx=77  -> chosen=83   gap=false  label=25.50
47->48  fromIdx=83  -> chosen=131  gap=false  label=19.30
48->49  FAIL  fromIdx=131  unclaimedNeighbors=0
```

### Walk trace AFTER fix

```
44->45  fromIdx=74  -> chosen=76   gap=false  label=32.30   ← FIXED (true post 45)
45->46  fromIdx=76  -> chosen=111  gap=false  label=27.70   ← still wrong (branch stub)
...
52->53  FAIL  fromIdx=90  unclaimedNeighbors=0
```

## Constraints

- Do NOT modify parser/dwg/region-pairing.js or parser/coordinate-calculator.js (frozen)
- Fixes go in parser/dwg/graph-walker.js (preferred)
- All tests must stay green: graph-walker (4/4), coordinate-calculator (22/22), distance-associator (11/11)
- Valmor 11/11 <5m and João Born ≥22/34 <5m must not regress

## Key files

- parser/dwg/graph-walker.js — the walker (primary fix target)
- debug-run-calc-dwg-from-pdf-siriu.mjs — E2E harness
- coordenadas postes siriu.txt — ground truth (85 posts, format: "Poste N; lat, lon")
- .planning/debug/siriu-post34-cascade.md — prior session (posts 34-44)
- .planning/debug/siriu-branch-return-labels.md — earlier sessions (label assignment)
