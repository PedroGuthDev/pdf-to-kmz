---
status: awaiting_human_verify
trigger: "npm run test:gate completely failing after code-review auto-fix run. DWG graph-walk falls back to PDF (dwgStatus got pdf-fallback require dwg-graph-walk), all post->INSERT idx mappings null. Suspects: beb8a51 WR-04 (dxf-loader per-vertex-pair edges) and b5a1568 WR-08 (graph-walker deterministic tiebreak)."
created: 2026-05-30T00:00:00Z
updated: 2026-05-30T12:00:00Z
---

## Current Focus

hypothesis: CONFIRMED — 64215b7 (NOT a fix-run commit, the supposed "known-good baseline") prunes consecutive cable edges from the connections array shared by the DWG graph-walk, forcing pdf-fallback. Fix: decouple KMZ-pruned connections from walk topology via walkConnections snapshot.
test: direct commit test (d0013e0 PASS / 64215b7 FAIL) + decoupling fix + npm run test:gate
expecting: gate PASS dwgStatus=dwg-graph-walk walkOk=true coords=85
next_action: commit fix, request human verification

## Symptoms

expected: npm run test:gate shows REGRESSION GATE PASSED with 0 failures; dwgStatus = dwg-graph-walk; post->INSERT idx mappings non-null
actual: gate fails; dwgStatus got "pdf-fallback" require "dwg-graph-walk"; all post->INSERT idx mappings null
errors: dwgStatus: got "pdf-fallback", require "dwg-graph-walk"
reproduction: npm run test:gate
started: after code-review auto-fix run (commits beb8a51 WR-04, b5a1568 WR-08 and others)

## Eliminated

- hypothesis: WR-04 (beb8a51) per-vertex-pair edge emission is the sole/primary cause
  evidence: Reverted WR-04 in isolation (git revert --no-commit), original first->last logic restored, gate STILL shows 106 failures, all posts "no DWG error (missing pairing?)". WR-04 is not the cause (or not the only cause).
  timestamp: 2026-05-30

## Evidence

- timestamp: 2026-05-30
  checked: Ran npm run test:gate on HEAD (c80308a)
  found: 22 unit tests pass. Siriu gate fails 106. Every post shows "no DWG error (missing pairing?)" not "pdf-fallback" wording. Suggests DWG walk produces no pairings at all.
  implication: The break is upstream of edge-structure tuning — DWG walk yields zero post pairings.

- timestamp: 2026-05-30
  checked: git revert --no-commit beb8a51, confirmed dxf-loader.js restored to first->last, re-ran gate
  found: Still 106 failures, identical "missing pairing" pattern.
  implication: WR-04 is NOT the culprit. Need to inspect run-siriu-regression-gate.mjs to see how DWG is invoked and what "missing pairing" means.

- timestamp: 2026-05-30
  checked: Probe captured real DWG warnings via calculateCoordinatesWithDwg
  found: dwgStatus=pdf-fallback because BOTH cascade levels fail. Level 1 graph-walk fails {at_post:10, reason:no-connection}. Level 2 pairPostsAgainstRegion fails {at_post:7, collision}. DXF region: posts=483, cableEdges=451.
  implication: Failure is at the very start of the walk (post 7-10), not deep topology. Need to find what broke the early walk.

- timestamp: 2026-05-30
  checked: Reverted BOTH dxf-loader.js AND graph-walker.js to 235a534 (pre-WR04, pre-WR08), re-ran probe
  found: IDENTICAL failure - cableEdges=451, no-connection@10, collision@7, pdf-fallback. WR-04 + WR-08 reverted = no change.
  implication: Neither WR-04 nor WR-08 is the cause.

- timestamp: 2026-05-30
  checked: Vertex-count histogram of TrechoSecundarioAereo LWPOLYLINEs in siriu.dxf
  found: All 451 polylines have EXACTLY 2 vertices ({"2":451}). Per-vertex-pair (HEAD) and first-to-last (235a534) emit byte-identical edges.
  implication: WR-04 is provably a NO-OP on Siriu data. Definitively eliminated. cableEdges=451 unchanged confirms this.

## Eliminated

- hypothesis: WR-08 (b5a1568) deterministic tiebreak is the cause
  evidence: Reverting graph-walker.js to 235a534 alongside dxf-loader produced identical failure. WR-08 structurally valid (candidate.endpoint field exists). No change in behavior.
  timestamp: 2026-05-30

reasoning_checkpoint:
  hypothesis: "Commit 64215b7 (fix(kmz)) added finalizeBifurcationConnections to coordinate-calculator.js, which DROPS edges from the shared connections array (e.g. consecutive 9->10) to improve KMZ cable-path rendering. The DWG graph-walk consumes that same connections array (via coordinate-calculator-dwg.js -> pdfResult.connections) and fails with no-connection at post 10 -> both cascade levels fail -> pdf-fallback -> 106 gate failures."
  confirming_evidence:
    - "git bisect in worktree: d0013e0 PASSES gate, 64215b7 FAILS with 106 (dwgStatus pdf-fallback)"
    - "Pre-fix d0013e0: 96 connections, edge 9->10 present. Post-fix HEAD: 89 connections, edge 9->10 MISSING"
    - "Probe warnings: dwg-graph-walk-fail at_post:10 reason:no-connection; level2 collision at_post:7"
    - "finalizeBifurcationConnections explicitly builds dropKeys and splices connections array (the (hi-1)->hi penult edge = 9->10 for a branch return rejoining at 10)"
  falsification_test: "Restore edge 9->10 (and other dropped consecutive edges) to the connections seen by the graph-walk; if gate dwgStatus returns to dwg-graph-walk and failure count drops to baseline (~21 or fewer), hypothesis confirmed."
  fix_rationale: "The connections array is shared by two consumers: KMZ rendering (buildRoutePolylines, which WANTS the pruned/branch-split edges) and the DWG graph-walk (which NEEDS the full consecutive topology). The fix must stop the KMZ-oriented pruning from corrupting the graph-walk's view. Address root cause by decoupling: graph-walk should navigate on un-pruned connections, OR finalizeBifurcationConnections must not remove edges the walk needs."
  blind_spots: "Need to confirm whether 64215b7's KMZ behavior depends on the SAME array object identity, and whether other consumers (post-positioning) read connections. Also must not regress the KMZ bifurcation test that 64215b7 added."

## Resolution

root_cause: "Commit 64215b7 'fix(kmz): split cable paths correctly at bifurcations' introduced finalizeBifurcationConnections() in parser/coordinate-calculator.js, which prunes/drops edges from the connections array returned by calculateCoordinates to fix KMZ polyline rendering at branch returns. It ALSO added an isBlockedCableEdge early-skip in the consecutive-edge backfill loop (the loop whose own comment promises 'every consecutive post number has a connection entry... required by DWG graph-walk pairing'). That connections array is consumed by the DWG graph-walk (coordinate-calculator-dwg.js -> pdfResult.connections, and the harness's own runWalk -> result.connections). Dropping/skipping consecutive edges like 9->10 (jumpback-suppressed penult of a branch return) leaves the graph-walk with no-connection at the rejoin post, collapsing both DWG cascade levels into pdf-fallback. Result: all post mappings null, 106 regression-gate failures. CRITICAL: 64215b7 is NOT one of the 17 fix-run commits — it is the commit the task mislabeled as the 'known-good baseline'. git proved it directly: d0013e0 (parent) PASSES the gate; 64215b7 FAILS with identical 106 failures. WR-04/WR-08/WR-09 (the task's suspects) are red herrings: WR-04 is a provable no-op on Siriu (all 451 cable polylines have exactly 2 vertices, so per-vertex-pair == first-to-last). Reverting any/all fix-run commits does nothing because the break predates them all."
fix: "Decouple the two consumers of the connections array instead of weakening the KMZ pruning. In calculateCoordinates: (1) removed the isBlockedCableEdge early-skip so the backfill loop again emits EVERY consecutive edge; (2) snapshot connections into walkConnections immediately BEFORE finalizeBifurcationConnections prunes the KMZ-facing copy; (3) return walkConnections alongside connections. In coordinate-calculator-dwg.js: the graph-walk cascade now prefers pdfResult.walkConnections. In tools/siriu-regression-harness.mjs: runWalk now prefers result.walkConnections. KMZ rendering still uses the pruned connections, so the bifurcation-connections and kml-builder tests added by 64215b7 are unaffected."
verification: "npm run test:gate: PASS — dwgStatus=dwg-graph-walk, walkOk=true, coords=85, 64 err ceilings, 39 idx locks (identical to d0013e0 baseline). All 26 unit tests pass (graph-walker, distance-associator, coordinate-calculator, bifurcation-connections, kml-builder). No fix-run commit reverted; phantom-hint logic untouched."
files_changed:
  - parser/coordinate-calculator.js
  - parser/dwg/coordinate-calculator-dwg.js
  - tools/siriu-regression-harness.mjs
