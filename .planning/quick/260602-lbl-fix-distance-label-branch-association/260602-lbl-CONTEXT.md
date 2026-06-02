# Quick Task 260602-lbl: Fix distance-label branch/cross-page mis-association - Context

**Gathered:** 2026-06-02
**Status:** Ready for planning
**Handoff:** `260602-lbl-HANDOFF.md` (full ground truth, gates, inspection one-liners — READ FIRST)

<domain>
## Task Boundary

Fix the upstream root cause behind three graph-walker symptoms: `parser/distance-associator.js`
mis-associates branch-arm and cross-page distance labels, so the label graph encodes the wrong
junction topology. The graph-walker's post-number hacks (`73/74`, `80/81`) and the 36/37/39
spurious bifurcation are all hand-patches recovering that broken topology. Fix the association so
the label graph encodes the TRUE junctions; the branch traversal then works generically and the
hacks become unnecessary.

**Siriu TRUE junctions (label-degree ≥3), authoritative from user:** `5, 14, 36, 48, 60, 62, 70`
(only these). Ground-truth arm labels per junction are in the HANDOFF.

**Two failure modes to fix:**
1. Cross-page branch entry (e.g. `62→81 = 40.6`): label drawn on the destination/branch page,
   far from the junction; associator attaches it to a nearby same-page pair (`80→81`) instead of
   bridging back to the junction (62) on the prior page.
2. Same-page branch arm stolen by the consecutive pair (`70→74=38.7`, `36→46=27.7`, `60→69=31`):
   arm label sits near the junction but points to a NON-consecutive post; sequential/midpoint
   heuristics grab it for the consecutive pair (`74→75`, `45→46`, `68→69`).

</domain>

<decisions>
## Implementation Decisions

### Approach / staging — Stage A FIRST, then Stage B
Do NOT go straight at the associator. De-risk first:
- **Stage A (prove the model in isolation):** Encode the ground-truth junction graph (HANDOFF) as
  a TEST fixture (ground truth, not runtime logic). Build a label-graph DFS-with-slots branch
  traversal (degree-1 = tip, degree-≥3 = junction with degree−1 arms; at a tip pop to nearest
  junction with a free slot; degree-4 junction = 2 slots; mark slots consumed). Verify it
  reproduces correct Siriu coords with ZERO post-number hacks. This validates the whole model
  before touching the fragile associator.
- **Stage B (fix the associator to PRODUCE that topology):** Teach `distance-associator.js` the two
  failure modes above. Validate against Stage-A ground truth + all gates.

(User's earlier stated preference was Stage B direct; in discussion the user chose the de-risked
A→B path. A is no longer optional.)

### Discriminator signal — HYBRID (bearing primary + cable-overlap confirm)
The signal distinguishing a branch-arm label (points to a NON-consecutive post) from a
consecutive-pair label is HYBRID:
- **Primary:** cable-arm bearing geometry — the arm label sits near the junction and points along
  the arm's cable-direction bearing toward the far post, not along the consecutive-numbering
  direction.
- **Confirmation/tiebreaker:** label-on-cable-segment overlap — the label physically lies on the
  cable segment it measures.
- **Plumbing note:** `applyBifurcationJunctionLabelRehome` (L1221) currently uses POST-position
  geometry only (`labelGapToSegment` measures gap to the post-to-post chord, not cable polylines).
  Cable polyline data (`cablesByPage`) is already available but only threaded into the orphan-label
  pass (`assignOrphanLabelsNearAuxPosts`). The hybrid cable-confirm requires threading `cablesByPage`
  into the rehome/association path.

### Walk hacks — REMOVE once gates green
Delete BOTH graph-walker post-number hacks in this task once the association fix proves them
unnecessary and all gates stay green:
- `73/74` gap-reentry (`parser/dwg/graph-walker.js` ~L1734)
- `80/81` off-cable insert (`parser/dwg/graph-walker.js` ~L1978)
This is the whole point of the root-cause fix. Removal is gated on green tests, not unconditional.

### Re-validation pass — RE-HOME 27.7 onto 36→46, then SIMPLIFY the edc96a2 pass
The 36/37/38 fix already shipped via the calibrated re-validation pass at the top of
`applyBifurcationJunctionLabelRehome` (commit edc96a2). Per ground truth, `27.7` should be PLACED on
`36→46` (not nulled). Once association is correct: re-home 27.7 onto 36→46, then revisit/simplify the
calibrated re-validation pass now that the upstream association is right.
- **RISK:** this touches shipped, green 36/37/38 behavior. The Siriu regression gate MUST catch any
  regression — do not simplify the pass unless gates stay green. If simplification regresses, keep
  the pass and document why.

</decisions>

<specifics>
## Specific Ideas

### Validation gates (ALL must stay green)
- `node tools/run-siriu-regression-gate.mjs` (Siriu DWG, mean ~3.6m — the tight one)
- `node tools/run-route-pdf-accuracy-gate.mjs` (Luiz Carolino PDF)
- `node tools/run-route-dwg-accuracy-gate.mjs` (Luiz Carolino DWG)
- Consider wiring **Valmor** (clean 11-post DWG, mean 2.2m) in as an extra tight gate for this fix.
  Fixtures committed: `parser/__tests__/fixtures/valmor-{ground-truth,dwg-region}.json`.

### Key files
- `parser/distance-associator.js` — the fix lives here. Relevant: `associateDistancesRich` (L767),
  `applyBifurcationJunctionLabelRehome` (L1221+, calibrated re-validation pass at its top),
  `labelGapToSegment` (L1747, post-chord gap — cross-page logic), `assignOrphanLabelsNearAuxPosts`
  (L1759+, the pass that already has `cablesByPage`).
- `parser/dwg/graph-walker.js` — the walk + the two hacks (73/74 ~L1734, 80/81 ~L1978) + existing
  branch machinery (`branchEntryStack` L1206, `shouldTryBranchReturn` L726, `findBranchReturnArm`).
- `parser/__tests__/fixtures/siriu-topology.json` — current (broken) label-graph; Stage A fixture
  encodes the corrected ground-truth graph.

### Inspection one-liners (in HANDOFF)
- Current label-graph degree per post (junctions = deg≥3, tips = deg 1).
- Where a given label value is currently associated.

</specifics>

<canonical_refs>
## Canonical References

- `260602-lbl-HANDOFF.md` — authoritative ground truth (junction arm labels, both failure modes,
  staged plan A/B, gates, inspection one-liners). Committed 8b75759.
- Memory `project_label_misassociation_rootcause` — root-cause summary.
- Predecessor: `.planning/quick/260601-k1a-replace-hardcoded-post-number-guards-gra/` (shipped the
  36/37/38 fix via the edc96a2 re-validation pass this task may simplify).

</canonical_refs>
