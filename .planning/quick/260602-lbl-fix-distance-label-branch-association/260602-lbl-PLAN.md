---
quick_id: 260602-lbl
type: execute
description: Fix distance-label branch/cross-page mis-association (root-cause fix for graph-walker post-number hacks)
autonomous: true
files_modified:
  - parser/__tests__/fixtures/siriu-junction-ground-truth.json
  - parser/__tests__/branch-traversal.test.mjs
  - parser/branch-traversal.mjs
  - parser/distance-associator.js
  - parser/dwg/graph-walker.js
  - tools/run-valmor-accuracy-gate.mjs

gates:
  - "node tools/run-siriu-regression-gate.mjs"
  - "node tools/run-route-pdf-accuracy-gate.mjs"
  - "node tools/run-route-dwg-accuracy-gate.mjs"

must_haves:
  truths:
    - "A label-graph DFS-with-slots traversal reproduces correct Siriu coords from ground-truth topology with ZERO post-number hacks"
    - "distance-associator assigns 62->81=40.6, 70->74=38.7, 36->46=27.7, 60->69=31 to the correct junction arms"
    - "Siriu label-graph encodes ONLY junctions 5,14,36,48,60,62,70 (degree >=3)"
    - "Both graph-walker post-number hacks (73/74, 80/81) are removed and all gates stay green"
    - "All gates (Siriu ~3.6m, Luiz Carolino PDF + DWG, Valmor 2.2m) stay green throughout"
  artifacts:
    - path: "parser/__tests__/fixtures/siriu-junction-ground-truth.json"
      provides: "Ground-truth junction graph (arms per junction) as a test fixture"
    - path: "parser/branch-traversal.mjs"
      provides: "DFS-with-slots branch traversal model"
    - path: "parser/__tests__/branch-traversal.test.mjs"
      provides: "Stage A proof: model reproduces Siriu coords hack-free"
  key_links:
    - from: "parser/distance-associator.js"
      to: "cablesByPage"
      via: "threaded into applyBifurcationJunctionLabelRehome for hybrid cable-bearing confirm"
      pattern: "cablesByPage"
---

<objective>
Fix the upstream root cause behind three graph-walker symptoms: `parser/distance-associator.js`
mis-associates branch-arm and cross-page distance labels, so the label graph encodes the WRONG
junction topology. The graph-walker's post-number hacks (`73/74`, `80/81`) and the 36/37/38
calibrated re-validation pass are all hand-patches recovering that broken topology.

Approach is the LOCKED de-risked path: **Stage A first** (prove a generic branch-traversal model
against ground-truth topology in isolation, with zero hacks), **then Stage B** (fix the associator
to PRODUCE that topology), then GATED cleanup (remove walk hacks, re-home 27.7, simplify the
re-validation pass) — each cleanup step reverted if any gate regresses.

Purpose: Eliminate post-number hacks by making the label graph encode TRUE junctions.
Output: Ground-truth fixture, traversal model + test, associator fix, gated hack removal.
</objective>

<context>
@.planning/quick/260602-lbl-fix-distance-label-branch-association/260602-lbl-CONTEXT.md
@.planning/quick/260602-lbl-fix-distance-label-branch-association/260602-lbl-HANDOFF.md
@.planning/STATE.md

# Source files the fix lives in
@parser/distance-associator.js
@parser/dwg/graph-walker.js

<interfaces>
<!-- Key contracts. Use directly — no codebase exploration needed. -->

GROUND TRUTH — Siriu junctions (label-degree >=3), authoritative:
  post 5:  arms {4,6,10}        32.6(from 4), 28.5(->6), 29.5(->10)
  post 14: arms {13,15,18}      40.4(from 13), 33.7(->15), 27.9(->18)
  post 36: arms {35,37,38,46}   47.9(from 35), 10.5(->37), 35.5(->38), 27.7(->46)  [degree 4 = 2 slots]
  post 48: arms {47,49,54}      19.3(from 47), 8.4(->49), 44.7(->54)
  post 60: arms {61,65,69}      31.7(from 65), 31(->69), 27.4(->61)
  post 62: arms {61,63,81}      34.8(from 61), 33.8(->63), 40.6(->81)  [40.6 is on ANOTHER PAGE]
  post 70: arms {69,71,74}      23.6(from 69), 31.8(->71), 38.7(->74)

Two failure modes:
  1. Cross-page branch entry (62->81=40.6): label on branch page, associator grabs same-page pair 80->81.
  2. Same-page arm stolen by consecutive pair (70->74=38.7, 36->46=27.7, 60->69=31): arm points to
     NON-consecutive post; sequential/midpoint heuristics grab it for the consecutive pair.

From parser/distance-associator.js:
  export function associateDistancesRich(...)                       // L767
  export function applyBifurcationJunctionLabelRehome(posts, distItems, distances, warnings)  // L1221
    - calibrated re-validation pass for bifurcation-main edges at top (L1335+, from commit edc96a2)
  function labelGapToSegment(lx, ly, from, to, crossPage, _allPosts)  // L1747 — POST-CHORD gap only
  export function supplementDistancesBesideAuxiliaryPosts(posts, distItems, distMap, cablesByPage, opts)  // L1771 — already has cablesByPage

From parser/dwg/graph-walker.js:
  73/74 gap-reentry hack: `fromNum === 73 && toNum === 74` (~L1734)
  80/81 off-cable insert hack: `fromNum === 80 && toNum === 81` (~L1978)

Discriminator (LOCKED, hybrid): PRIMARY = cable-arm bearing geometry (arm label points along the
arm's cable-direction bearing toward the far NON-consecutive post); CONFIRM/tiebreak = label-on-
cable-segment overlap. Requires threading `cablesByPage` into the rehome/association path.

Inspection one-liner (label-graph degree per post):
  node -e "const t=require('./parser/__tests__/fixtures/siriu-topology.json');const deg=new Map();for(const d of t.distances){if(d.meters==null)continue;for(const[a,b]of[[d.from,d.to],[d.to,d.from]]){if(!deg.has(a))deg.set(a,new Set());deg.get(a).add(b)}}for(const[n,s]of[...deg].sort((x,y)=>x[0]-y[0]))console.log('post',n,'deg',s.size,[...s].sort((a,b)=>a-b))"
</interfaces>
</context>

<tasks>

<!-- ============ STAGE A — prove the model in isolation (no associator changes) ============ -->

<task type="auto">
  <name>Task A1: Encode ground-truth junction graph as a test fixture</name>
  <files>parser/__tests__/fixtures/siriu-junction-ground-truth.json</files>
  <action>
Create a fixture encoding the authoritative Siriu junction graph from the HANDOFF (do NOT compute
it at runtime — it is ground truth used only by tests). Include: the seven junctions and their arm
lists exactly as in the interfaces block (5:{4,6,10}, 14:{13,15,18}, 36:{35,37,38,46} marked
degree-4/2-slots, 48:{47,49,54}, 60:{61,65,69}, 62:{61,63,81}, 70:{69,71,74}); each arm's label
meters; a flag on 62->81 indicating cross-page; the full ordered edge list (post-to-post arms +
the consecutive main-line edges) needed to drive a traversal. Structure it so Task A2's traversal
can consume it directly: nodes with degree, junction slot-counts (degree-1 arms = 1 slot;
degree-4 junction = 2 slots), and edge meters. Reference HANDOFF lines 38-58 as the source of truth.
This is ground-truth DATA per locked decision 1 (Stage A) — NOT runtime logic.
  </action>
  <verify>
    <automated>node -e "const g=require('./parser/__tests__/fixtures/siriu-junction-ground-truth.json'); const j=Object.keys(g.junctions||{}); if(j.length!==7) throw new Error('expected 7 junctions, got '+j.length); if(!g.junctions['36'] || (g.junctions['36'].arms||[]).length!==4) throw new Error('post36 must have 4 arms'); console.log('OK 7 junctions, 36 degree-4')"</automated>
  </verify>
  <done>Fixture exists with exactly 7 junctions, post 36 has 4 arms, 62->81 flagged cross-page, edge meters present.</done>
</task>

<task type="auto" tdd="true">
  <name>Task A2: Build DFS-with-slots branch traversal and prove it reproduces Siriu coords hack-free</name>
  <files>parser/branch-traversal.mjs, parser/__tests__/branch-traversal.test.mjs</files>
  <behavior>
    - Given the ground-truth fixture (Task A1), the traversal visits every post exactly once.
    - degree-1 node = tip; degree->=3 node = junction with (degree-1) arms; degree-4 junction = 2 slots.
    - At a tip, pop to the nearest junction WITH A FREE SLOT; mark that slot consumed.
    - The walk emits post sequence + cumulative arm meters that reproduce correct Siriu coordinates.
    - ZERO post-number literals anywhere in the model (no 73/74/80/81/36 special cases).
  </behavior>
  <action>
Create `parser/branch-traversal.mjs` exporting a pure function (e.g. `walkBranchGraph(graph)`) that
implements the LOCKED user model (decision 1, Stage A): degree-1 = tip; degree->=3 = junction with
degree-1 arms; at a tip, pop to the nearest junction with a free slot; degree-4 junction = 2 slots;
mark slots consumed as they are used. The function takes the label-graph (nodes/edges/meters from
the Task A1 fixture shape) and returns the visit order + per-edge arm meters used to place coords.
Then write `parser/__tests__/branch-traversal.test.mjs` (node:test) that loads the Task A1 fixture,
runs the traversal, and asserts it reproduces the correct Siriu junction arms and coordinate-driving
edge meters with ZERO post-number hacks. This validates the whole model BEFORE touching the
associator (locked decision 1). Do NOT modify distance-associator.js or graph-walker.js in this task.
Grep gate: the model file must contain no bare post-number literals for 73/74/80/81/36.
  </action>
  <verify>
    <automated>node --test parser/__tests__/branch-traversal.test.mjs</automated>
    <automated>grep -vE '^\s*(//|\*)' parser/branch-traversal.mjs | grep -Ec '(===\s*73|===\s*74|===\s*80|===\s*81|===\s*36)' | grep -q '^0$' && echo "OK no post-number hacks"</automated>
  </verify>
  <done>Traversal test passes reproducing ground-truth arms/coords; model file has zero post-number literals; associator/graph-walker untouched.</done>
</task>

<!-- ============ STAGE B — fix the associator to PRODUCE that topology ============ -->

<task type="auto">
  <name>Task B1: Wire Valmor as an extra tight gate (clean 11-post DWG, mean 2.2m)</name>
  <files>tools/run-valmor-accuracy-gate.mjs</files>
  <action>
Add a Valmor gate mirroring the existing route gates, using committed fixtures
`parser/__tests__/fixtures/valmor-ground-truth.json` and `parser/__tests__/fixtures/valmor-dwg-region.json`
(per locked decision / constraints: Valmor = clean 11-post DWG, mean 2.2m — extra tight gate).
Model it on `tools/run-route-dwg-accuracy-gate.mjs` (drives the DWG walk / walkOk path) and assert
mean error stays at or below the current baseline (~2.2m) and all 11 posts are placed. This gate
runs alongside the others as a regression guard for the Stage-B associator changes. This task does
NOT change runtime behavior — it only adds a gate; capture the current baseline as the threshold.
  </action>
  <verify>
    <automated>node tools/run-valmor-accuracy-gate.mjs</automated>
  </verify>
  <done>Valmor gate runs green against current code, asserts mean <= ~2.2m and 11 posts placed.</done>
</task>

<task type="auto">
  <name>Task B2: Thread cablesByPage into rehome path + add hybrid cable-bearing discriminator</name>
  <files>parser/distance-associator.js</files>
  <action>
Implement the LOCKED hybrid discriminator (decision 2). Thread `cablesByPage` (already available and
passed into `supplementDistancesBesideAuxiliaryPosts`, L1771) into `applyBifurcationJunctionLabelRehome`
(L1221) and into the rehome/association path. Add a discriminator that distinguishes a branch-arm
label (points to a NON-consecutive post) from a consecutive-pair label:
  - PRIMARY: cable-arm bearing geometry — compute the arm's cable-direction bearing from the junction
    (using `cablesByPage` polylines, not just the post-to-post chord that `labelGapToSegment` measures
    at L1747) and test whether the label sits near the junction and points along that bearing toward
    the far post.
  - CONFIRMATION/TIEBREAKER: label-on-cable-segment overlap — the label physically lies on the cable
    segment it measures.
Do NOT remove the calibrated re-validation pass yet (that is gated Task B5). Do NOT change post
positions. Keep all existing same-page bifurcation handling intact. After this task, the hybrid
signal is available to the association fix in B3. ALL gates must stay green.
  </action>
  <verify>
    <automated>node tools/run-siriu-regression-gate.mjs</automated>
    <automated>node tools/run-route-pdf-accuracy-gate.mjs</automated>
    <automated>node tools/run-route-dwg-accuracy-gate.mjs</automated>
    <automated>node tools/run-valmor-accuracy-gate.mjs</automated>
  </verify>
  <done>cablesByPage threaded into rehome path; hybrid bearing+overlap discriminator implemented; all four gates green.</done>
</task>

<task type="auto">
  <name>Task B3: Fix both failure modes so the label graph encodes TRUE junctions</name>
  <files>parser/distance-associator.js</files>
  <action>
Teach the associator the two failure modes (locked domain) using the B2 discriminator:
  (a) Same-page branch arm stolen by consecutive pair: when a label near a junction points (by cable
      bearing / overlap) to a NON-consecutive post, assign it to the junction->far-post arm and do
      NOT let the consecutive pair steal it. Targets: 70->74=38.7 (not 74->75), 36->46=27.7
      (not 45->46), 60->69=31 (not 68->69), and 48's arm. Per locked decision 2.
  (b) Cross-page branch entry: a label drawn on the destination/branch page far from the junction
      bridges back to the junction on the PRIOR page instead of attaching to a same-page pair.
      Target: 62->81=40.6 (not 80->81). Extend the cross-page logic around `labelGapToSegment`
      (L1747) to bridge to the junction.
Use the Task A1 ground-truth fixture + the Task A2 traversal as the correctness oracle: after the
fix, the produced Siriu label graph must encode ONLY junctions {5,14,36,48,60,62,70} with the
ground-truth arms, and the traversal must reproduce correct coords. NO post-number literals in the
fix — the discriminator must be generic geometry. ALL gates must stay green.
  </action>
  <verify>
    <automated>node tools/run-siriu-regression-gate.mjs</automated>
    <automated>node tools/run-route-pdf-accuracy-gate.mjs</automated>
    <automated>node tools/run-route-dwg-accuracy-gate.mjs</automated>
    <automated>node tools/run-valmor-accuracy-gate.mjs</automated>
    <automated>node --test parser/__tests__/branch-traversal.test.mjs</automated>
  </verify>
  <done>62->81, 70->74, 36->46, 60->69 assigned to correct junction arms; Siriu graph has only the 7 true junctions; all gates + traversal test green; no post-number literals added.</done>
</task>

<!-- ============ GATED CLEANUP — each step reverted if any gate regresses ============ -->

<task type="auto">
  <name>Task B4: Remove both graph-walker post-number hacks (GATED on green tests)</name>
  <files>parser/dwg/graph-walker.js</files>
  <action>
Per locked decision 3 — remove BOTH hacks now that B3 made the topology correct:
  - 73/74 gap-reentry hack (`fromNum === 73 && toNum === 74`, ~L1734) and its now-dead helper
    invocation if it becomes unreferenced.
  - 80/81 off-cable insert hack (`fromNum === 80 && toNum === 81`, ~L1978) and its now-dead branch.
GATED: remove each hack, then run ALL gates. If ANY gate regresses, REVERT that specific hack
removal and document inline (comment) why it was kept and which gate failed. Do not remove a hack
unless gates stay green (locked decision 3 — removal gated on green tests, not unconditional).
After removal, confirm no `fromNum === 73`/`fromNum === 80` literals remain (unless documented-kept).
  </action>
  <verify>
    <automated>node tools/run-siriu-regression-gate.mjs</automated>
    <automated>node tools/run-route-pdf-accuracy-gate.mjs</automated>
    <automated>node tools/run-route-dwg-accuracy-gate.mjs</automated>
    <automated>node tools/run-valmor-accuracy-gate.mjs</automated>
    <automated>grep -Ec '(fromNum === 73|fromNum === 80)' parser/dwg/graph-walker.js | grep -q '^0$' && echo "OK both hacks removed" || echo "REVIEW: a hack was kept — confirm documented"</automated>
  </verify>
  <done>Both hacks removed (or any kept hack documented inline with failing-gate reason); all four gates green.</done>
</task>

<task type="auto">
  <name>Task B5: Re-home 27.7 onto 36->46 and simplify the calibrated re-validation pass (GATED)</name>
  <files>parser/distance-associator.js</files>
  <action>
Per locked decision 4: (1) ensure 27.7 is PLACED on 36->46 (not nulled) — the B3 fix should produce
this, so verify it via the ground-truth fixture; if the calibrated re-validation pass at the top of
`applyBifurcationJunctionLabelRehome` (L1335+, from commit edc96a2) still nulls it, adjust so 27.7
lands on 36->46. (2) Now that upstream association is correct, SIMPLIFY/remove the calibrated
re-validation pass.
GATED (locked decision 4 — touches shipped green 36/37/38 behavior): simplify, then run ALL gates.
The Siriu regression gate (mean ~3.6m) is the catch. If simplification regresses ANY gate, REVERT
the simplification, KEEP the re-validation pass, and document inline why it must stay. Do not
simplify unless gates stay green.
  </action>
  <verify>
    <automated>node tools/run-siriu-regression-gate.mjs</automated>
    <automated>node tools/run-route-pdf-accuracy-gate.mjs</automated>
    <automated>node tools/run-route-dwg-accuracy-gate.mjs</automated>
    <automated>node tools/run-valmor-accuracy-gate.mjs</automated>
    <automated>node --test parser/__tests__/branch-traversal.test.mjs</automated>
  </verify>
  <done>27.7 placed on 36->46; re-validation pass simplified (or kept-and-documented if it regressed); all gates + traversal test green.</done>
</task>

</tasks>

<verification>
- Stage A traversal test reproduces ground-truth Siriu arms/coords hack-free (`node --test parser/__tests__/branch-traversal.test.mjs`).
- Siriu label graph encodes ONLY junctions 5,14,36,48,60,62,70 (degree inspection one-liner).
- 62->81=40.6, 70->74=38.7, 36->46=27.7, 60->69=31 assigned to correct junction arms.
- All gates green: `run-siriu-regression-gate`, `run-route-pdf-accuracy-gate`, `run-route-dwg-accuracy-gate`, `run-valmor-accuracy-gate`.
- Both graph-walker hacks removed (or any kept hack documented with failing-gate reason).
- No new post-number literals introduced in the fix.
</verification>

<success_criteria>
- LOCKED decisions 1-4 honored exactly: Stage A before Stage B; hybrid bearing+overlap discriminator; hack removal GATED on green; 27.7 re-homed onto 36->46 with GATED re-val simplification.
- Branch traversal model proven generic (zero hacks) against ground-truth fixture.
- Associator produces TRUE junction topology; both failure modes fixed.
- All four gates stay green throughout; any reverted cleanup step documented inline.
</success_criteria>

<output>
On completion, update STATE.md (Quick Tasks Completed row) and memory
`project_label_misassociation_rootcause` with the outcome (hacks removed vs kept-and-documented,
re-val pass simplified vs kept).
</output>
