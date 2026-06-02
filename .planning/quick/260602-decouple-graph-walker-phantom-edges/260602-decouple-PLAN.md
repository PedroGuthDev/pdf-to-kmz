---
phase: quick-260602-decouple
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - parser/__tests__/fixtures/siriu-junction-ground-truth.json
  - parser/__tests__/branch-traversal.test.mjs
  - parser/distance-associator.js
  - parser/dwg/graph-walker.js
autonomous: true
requirements: [DECOUPLE-01, DECOUPLE-02, DECOUPLE-03, DECOUPLE-04]
execution_env: non-worktree  # gate scripts run live parsePdf on the Siriu PDF + siriu.dxf; need node_modules

must_haves:
  truths:
    - "Removing a phantom label edge at the associator no longer collapses the DWG walk (the matching walker compensation is retired in the same commit)."
    - "After pairs 1+2 decouple, the Siriu label graph encodes junctions 36 and 48 with ONLY their true GT arms (no 36->39, no 59->60, no 66->60, no 51->48; 48->49 carries 8.4 not 22.6)."
    - "Posts 5 and 14 (regression canaries) stay clean through every step."
    - "Every shipped pair leaves all four gates green; any pair that regresses is GATED-kept (reverted + walker compensation restored + inline failing-gate note) — never a broken gate."
    - "No post-number literals remain in shipped parser/walker code for any pair that DID decouple (junctions/arms by degree + geometry only)."
  artifacts:
    - path: "parser/__tests__/fixtures/siriu-junction-ground-truth.json"
      provides: "Phantom-arm forbidden list per junction (the correctness oracle)"
      contains: "forbiddenArms"
    - path: "parser/__tests__/branch-traversal.test.mjs"
      provides: "Assertion that each junction carries ONLY its GT arms and NONE of its forbidden phantom arms"
      contains: "forbiddenArms"
    - path: "parser/distance-associator.js"
      provides: "Generic phantom-arm dedup at source (equal-value-at-junction; lower-source-tier null)"
    - path: "parser/dwg/graph-walker.js"
      provides: "Retired compensations for each decoupled pair (or GATED-kept inline note)"
  key_links:
    - from: "parser/distance-associator.js"
      to: "parser/dwg/graph-walker.js"
      via: "phantom removed at source AND its compensation retired in the SAME atomic commit"
      pattern: "bifurcationMainByOriginMeters|isPhantomBifurcationHint|fromNum === 73|fromNum === 80"
    - from: "parser/__tests__/branch-traversal.test.mjs"
      to: "parser/__tests__/fixtures/siriu-junction-ground-truth.json"
      via: "forbiddenArms assertion proves topology improved before baseline refresh"
      pattern: "forbiddenArms"
---

<objective>
Decouple the Siriu DWG graph-walker from four load-bearing phantom/swap label edges. For
each compensation<->phantom pair, remove the phantom at the **associator**
(`parser/distance-associator.js`) AND retire its matching **walker** compensation
(`parser/dwg/graph-walker.js`) in the SAME atomic commit, then re-prove all four accuracy
gates. This is the root-cause follow-up to quick task 260602-lbl, which left these
compensations GATED-and-kept because the associator could not yet stand alone.

Purpose: the associator must emit a topologically correct label graph (true junction arms
only) so the walker can be generic — zero post-number literals, junctions/arms by degree +
geometry. The two literal-coded hacks (`fromNum === 73`, `fromNum === 80`) are themselves the
prior task's bar violation and must be retired wherever a pair decouples.

Output: an extended ground-truth oracle (forbidden-arm assertions), a decoupled associator +
walker for the pairs that pass, GATED-kept inline notes for any pair that regresses, and a
refreshed Siriu walk baseline reflecting the new correct topology.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md

EXECUTION ENVIRONMENT: Run on the MAIN working tree, NOT a worktree. The gate scripts run a
live `parsePdf` over the Siriu PDF + `siriu.dxf` and require `node_modules`. A worktree without
installed deps will fail every gate spuriously.
</execution_context>

<context>
@.planning/STATE.md
@.planning/quick/260602-decouple-graph-walker-phantom-edges/260602-decouple-CONTEXT.md
@.planning/quick/260602-lbl-fix-distance-label-branch-association/260602-lbl-SUMMARY.md

# DO NOT re-derive the investigation. The four coupled pairs, their file:line refs, and the
# ground-truth arms are EMPIRICALLY PROVEN in CONTEXT.md (LOCKED). Nulling 36->39 alone was
# already shown to collapse the walk to pdf-fallback. Start from the locked findings.

<interfaces>
<!-- Exact compensation sites in the walker (verified this session). Executor edits these directly. -->

parser/dwg/graph-walker.js:
- L1146-1179  isPhantomBifurcationHint + bifurcationMainByOriginMeters + bifurcationTapEdges
              build loop. The "origin:meters -> mainTarget" map that lets the walker KEEP and
              reject the phantom 36->39=35.5 (mirrors real 36->38=35.5). Also the mechanism that
              tolerates 60 phantoms. (Pair 1.)
- L1641-1703  "Dense bifurcation (e.g. Siriu post 48)" swap handler — swaps the 22.6/8.4
              consecutive labels at walk time using DWG geometry. Consumes the spurious
              48->49=22.6 + 8.4 stub. (Pair 2.)
- L634-638, L1730-1770  Gap re-entry hack: findGapOffCableReentryByNextLabel + the
              `fromNum === 73 && toNum === 74` literal gate (KEPT note already inline). (Pair 4.)
- L1985-2002+ Off-cable insert hack: the `fromNum === 80 && toNum === 81` literal gate
              (KEPT note already inline) recovering cross-page 40.6 -> 62->81. (Pair 3.)

parser/distance-associator.js (phantom source + hook points):
- L1138  inferDistanceEdgesFromLabels — emits [inferred-label] phantoms (36->39, 66->60).
- L877/894  source tagging: legacy-midpoint (877), inferred-label (894). Tier order for dedup:
            authoritative {bifurcation-main, bifurcation-tap, branch-arm-rehomed, override} >
            inferred-label > legacy-midpoint.
- L1306  applyBifurcationJunctionLabelRehome; L1876 rehomeBranchArmLabels (same-page rehome).
- L1423-1424  the calibrated re-validation pass (GATED-kept in 260602-lbl).
- L2073  labelGapToSegment — the cross-page hook point for pair 3 (62->81 bridge).

parser/__tests__/branch-traversal.test.mjs:
- L12  loads siriu-junction-ground-truth.json; L86 asserts traversal reproduces GT arms.
  Extend with a forbiddenArms assertion (Task 1).
</interfaces>
</context>

<sequencing_rules>
LOCKED protocol — applies to every per-pair task (Tasks 2-5):

1. In ONE atomic commit: remove the phantom at the associator AND retire its walker
   compensation. Never split these across commits (regressions must be bisectable to a single
   pair).
2. Run the FULL gate suite after the change:
   - `node tools/run-siriu-regression-gate.mjs`           (tight: err ceilings + idx locks)
   - `node tools/run-route-pdf-accuracy-gate.mjs`         (Luiz Carolino PDF)
   - `node tools/run-route-dwg-accuracy-gate.mjs`         (Luiz Carolino DWG)
   - `node tools/run-valmor-accuracy-gate.mjs`            (Valmor, tight 2.2 m)
   - `node --test parser/__tests__/branch-traversal.test.mjs`
3. Baseline refresh order (mandatory): FIRST confirm the ground-truth fixture's forbiddenArms
   assertion proves the topology improved (the phantom arm is gone), THEN
   `SIRIU_UPDATE_BASELINE=1 node tools/run-siriu-regression-gate.mjs` to lock the new idx
   values. NEVER refresh the baseline before the topology assertion passes.
4. GATED fallback (per-pair): if a pair regresses a gate and cannot be made green, revert THAT
   pair ONLY, restore its walker compensation, and add/keep an inline failing-gate note (exact
   condition for future removal). Continue to the next pair. Partial win is acceptable and
   EXPECTED for pairs 3 and 4. A broken gate is never acceptable; a documented-kept
   compensation is.
5. Generic geometry only — ZERO post-number literals in shipped parser/walker code. Junctions
   and arms are discovered by degree + geometry. Post numbers may appear ONLY in test fixtures
   and gate baselines. For pairs 3 and 4 specifically: if the pair decouples, the
   `fromNum === 73`/`fromNum === 80` literal gates MUST be deleted (they are the prior bar
   violation). If a pair stays GATED-kept, the literal gate stays with its inline note.

Inspection helpers (untracked, reusable — do NOT commit):
- `debug-siriu-label-assoc.mjs` — per-post associated arms vs GT
- `debug-siriu-edge-provenance.mjs` — every incident edge + source + raw label positions
</sequencing_rules>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extend ground-truth oracle with forbidden phantom arms</name>
  <files>parser/__tests__/fixtures/siriu-junction-ground-truth.json, parser/__tests__/branch-traversal.test.mjs</files>
  <behavior>
    - Each junction (5,14,36,48,60,62,70) asserts its EXACT set of true GT arms — already covered by L86.
    - NEW: each junction asserts NONE of its forbidden phantom arms is present:
      - 36: forbid arm to 39 (phantom 36->39=35.5 mirroring real 36->38=35.5).
      - 48: forbid arm to 51 (spurious 51->48=42.3); assert 48->49 meters == 8.4 (NOT 22.6).
      - 60: forbid arms to nothing-new but assert inbound is 65 only and that no edge 59->60=31.7 or 66->60=22.0 is incident.
      - 5 and 14: forbid ANY arm beyond their 3 GT arms (canaries — must stay clean throughout).
    - The assertion reads from the GT graph shape the traversal consumes, comparing produced incident edges to the allowed GT set; any extra incident edge fails.
  </behavior>
  <action>
    Add a `forbiddenArms` array to each junction object in siriu-junction-ground-truth.json
    listing the phantom target posts that MUST NOT appear as an incident arm of that junction
    (36: [39]; 48: [51]; 60: [] with an inbound-must-be-65 note; 5: []; 14: []). For 48 add an
    explicit `armMetersChecks` entry asserting 48->49 == 8.4. Keep the existing arms/edges
    untouched — this is additive metadata. Then in branch-traversal.test.mjs add a new test
    (alongside the L86 test) that, for each junction, asserts the produced incident-arm set
    contains EVERY GT arm and NONE of the forbiddenArms targets, and that arm meters match
    armMetersChecks where present. This test is the correctness oracle gating every later
    baseline refresh — it must assert topology, independent of moving idx numbers. Do NOT add
    post-number literals to any parser/walker source; literals live only in this fixture/test.
  </action>
  <verify>
    <automated>node --test parser/__tests__/branch-traversal.test.mjs</automated>
  </verify>
  <done>branch-traversal.test.mjs passes; the new forbidden-arm test exists and reads forbiddenArms from the fixture; fixture carries forbiddenArms for all 7 junctions + 48->49==8.4 check.</done>
</task>

<task type="auto">
  <name>Task 2: Pair 1 — remove 36/60 phantom arms + retire isPhantomBifurcationHint</name>
  <files>parser/distance-associator.js, parser/dwg/graph-walker.js</files>
  <action>
    AT THE ASSOCIATOR: add a generic equal-value-at-junction dedup so the [inferred-label] /
    [legacy-midpoint] phantoms are nulled at source: when a junction post already carries a
    higher-source-tier edge with the same meters (authoritative > inferred-label >
    legacy-midpoint, tags at L877/L894), drop the lower-tier duplicate edge. This must
    eliminate 36->39=35.5 (mirrors authoritative 36->38=35.5), 59->60=31.7 (steals real
    60->65=31.7), and 66->60=22.0 (phantom long-span). Drive selection by source tier + value
    equality at a shared junction endpoint — NO post-number literals. AT THE WALKER (same
    commit): delete isPhantomBifurcationHint and bifurcationMainByOriginMeters (L1146-1179) and
    every call site that consults them — they exist only to keep+reject these now-removed
    phantoms; keep bifurcationTapEdges (still needed by pair 2). Then run the FULL gate suite
    per <sequencing_rules>. If green AND the Task-1 forbidden-arm test confirms 36/60 are clean,
    refresh the Siriu baseline (SIRIU_UPDATE_BASELINE=1). If it regresses and cannot be made
    green, apply the GATED fallback (revert this pair, restore the walker compensation with an
    inline failing-gate note).
  </action>
  <verify>
    <automated>node tools/run-siriu-regression-gate.mjs && node --test parser/__tests__/branch-traversal.test.mjs && node tools/run-route-pdf-accuracy-gate.mjs && node tools/run-route-dwg-accuracy-gate.mjs && node tools/run-valmor-accuracy-gate.mjs</automated>
  </verify>
  <done>All four gates + traversal test green. Forbidden-arm oracle confirms junction 36 has no arm to 39 and junction 60's only inbound is 65 (no 59->60, no 66->60). isPhantomBifurcationHint removed from walker. Baseline refreshed. (Or: GATED-kept with inline failing-gate note + compensation restored.) Posts 5/14 still clean.</done>
</task>

<task type="auto">
  <name>Task 3: Pair 2 — fix post-48 labels at source + retire dense-bifurcation swap</name>
  <files>parser/distance-associator.js, parser/dwg/graph-walker.js</files>
  <action>
    AT THE ASSOCIATOR: make the associator emit the correct post-48 topology directly — 48->49
    must carry 8.4 (the tap), NOT the legacy-midpoint 22.6, and the spurious 51->48=42.3
    [inferred-label] must be nulled. Reuse the existing bifurcation rehome / source-tier
    machinery (applyBifurcationJunctionLabelRehome L1306, rehomeBranchArmLabels L1876, dedup
    from Task 2) so the stub (8.4) lands on the correct arm by geometry + degree, not by post
    literal. AT THE WALKER (same commit): delete the "Dense bifurcation (e.g. Siriu post 48)"
    swap handler (L1641-1703) — it exists only to swap the 22.6/8.4 labels the associator now
    emits correctly. Run the FULL gate suite per <sequencing_rules>. If green AND the Task-1
    oracle confirms 48->49==8.4 with no 51->48 arm, refresh the Siriu baseline. Otherwise apply
    the GATED fallback for this pair only.
  </action>
  <verify>
    <automated>node tools/run-siriu-regression-gate.mjs && node --test parser/__tests__/branch-traversal.test.mjs && node tools/run-route-pdf-accuracy-gate.mjs && node tools/run-route-dwg-accuracy-gate.mjs && node tools/run-valmor-accuracy-gate.mjs</automated>
  </verify>
  <done>All four gates + traversal test green. Oracle confirms 48->49 meters == 8.4 and no 51->48 incident arm. Dense-bifurcation swap handler removed from walker. Baseline refreshed. (Or: GATED-kept with inline failing-gate note + handler restored.) Posts 5/14 still clean.</done>
</task>

<task type="auto">
  <name>Task 4: Pair 3 — cross-page 62->81 bridge + retire the 80/81 off-cable hack</name>
  <files>parser/distance-associator.js, parser/dwg/graph-walker.js</files>
  <action>
    HARDEST-2 (cross-page; partial win acceptable). AT THE ASSOCIATOR: extend the cross-page
    branch-entry logic around labelGapToSegment (L2073) so a branch-entry label drawn on the
    next page (40.6 beside post 81) is bridged back to its true junction on the PRIOR page
    (junction 62), producing the directed arm 62->81=40.6. The fixture already marks this arm
    crossPage:true. Discover the junction by degree + geometry across the page boundary — NO
    post-number literals. AT THE WALKER (same commit): delete the `fromNum === 80 && toNum === 81`
    literal-gated off-cable insert hack (the L1985-2002 KEPT block) — it is itself a prior-bar
    violation. Run the FULL gate suite per <sequencing_rules>. If green AND the Task-1 oracle
    confirms junction 62 carries arm to 81 (40.6), refresh the Siriu baseline. If it regresses
    (EXPECTED-possible for cross-page), apply the GATED fallback: revert this pair, restore the
    80/81 hack, and UPDATE its inline note to record the exact new failing condition for a
    future attempt. Continue regardless — a documented GATED-keep here is a sanctioned outcome.
  </action>
  <verify>
    <automated>node tools/run-siriu-regression-gate.mjs && node --test parser/__tests__/branch-traversal.test.mjs && node tools/run-route-pdf-accuracy-gate.mjs && node tools/run-route-dwg-accuracy-gate.mjs && node tools/run-valmor-accuracy-gate.mjs</automated>
  </verify>
  <done>Either: junction 62 carries 62->81=40.6 (oracle green), 80/81 literal hack deleted, all gates green, baseline refreshed. OR: GATED-kept — pair reverted, 80/81 hack + updated inline failing-gate note restored, all gates still green. Posts 5/14 still clean.</done>
</task>

<task type="auto">
  <name>Task 5: Pair 4 — junction-70 from region geometry + retire the 73/74 gap-reentry hack</name>
  <files>parser/distance-associator.js, parser/dwg/graph-walker.js</files>
  <action>
    HARDEST-1 (degree-&lt;3 junction; partial win acceptable). AT THE ASSOCIATOR: detect true
    junction 70 from DWG **region** geometry (region degree &gt;= 3) rather than from label-graph
    degree (which is &lt;3 because its arm is mis-associated), then rehome 38.7 onto arm 70->74 via
    the existing rehome machinery. The forward-arm / on-arm-chord / occlusion guards from
    260602-lbl must still reject the wrong 69->74 placement. Discover the junction by region
    degree + geometry — NO post-number literals. AT THE WALKER (same commit): delete
    findGapOffCableReentryByNextLabel (L634-638) and the `fromNum === 73 && toNum === 74`
    literal-gated block (L1730-1770) — both prior-bar violations. Run the FULL gate suite per
    <sequencing_rules>. If green AND the Task-1 oracle confirms junction 70 carries arm to 74
    (38.7), refresh the Siriu baseline. If it regresses (EXPECTED-possible), apply the GATED
    fallback: revert this pair, restore the 73/74 hack, and UPDATE its inline failing-gate note
    with the exact new condition. A documented GATED-keep here is sanctioned.
  </action>
  <verify>
    <automated>node tools/run-siriu-regression-gate.mjs && node --test parser/__tests__/branch-traversal.test.mjs && node tools/run-route-pdf-accuracy-gate.mjs && node tools/run-route-dwg-accuracy-gate.mjs && node tools/run-valmor-accuracy-gate.mjs</automated>
  </verify>
  <done>Either: junction 70 carries 70->74=38.7 (oracle green), 73/74 literal hack + findGapOffCableReentryByNextLabel deleted, all gates green, baseline refreshed. OR: GATED-kept — pair reverted, 73/74 hack + updated inline failing-gate note restored, all gates still green. Posts 5/14 still clean.</done>
</task>

<task type="auto">
  <name>Task 6: Refresh walk baseline + final all-gates re-prove</name>
  <files>parser/__tests__/fixtures/siriu-junction-ground-truth.json</files>
  <action>
    Final consolidation. Confirm the Siriu walk baseline reflects the cumulative decoupled
    topology from all pairs that shipped (re-run SIRIU_UPDATE_BASELINE=1 once if any later pair
    moved idx values after an earlier refresh). Then run the FULL gate suite a final time from a
    clean state to prove no cross-pair interaction broke anything. Verify zero post-number
    literals remain in shipped parser/walker code for any pair that DECOUPLED (grep the two
    source files for the retired literal gates — they must be absent for decoupled pairs and, if
    present, must be a GATED-kept block with an inline failing-gate note). Do NOT commit any
    untracked debug-*.mjs inspection scripts.
  </action>
  <verify>
    <automated>node tools/run-siriu-regression-gate.mjs && node tools/run-route-pdf-accuracy-gate.mjs && node tools/run-route-dwg-accuracy-gate.mjs && node tools/run-valmor-accuracy-gate.mjs && node --test parser/__tests__/branch-traversal.test.mjs</automated>
  </verify>
  <done>All four gates + traversal test green from clean state. Baseline current. For every decoupled pair, its literal-gated walker hack / compensation is GONE; every GATED-kept pair retains an inline failing-gate note. No debug scripts committed.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| associator label graph -> walker | The walker trusts the associator's edge set; a wrong/over-eager dedup silently corrupts the walk (collapse to pdf-fallback). |
| ground-truth fixture -> gates | The oracle defines "correct"; an over-loose forbiddenArms list could pass a still-phantom topology. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-decouple-01 | Tampering | associator dedup over-removes a real arm | mitigate | Dedup gated by source-tier + exact value-at-shared-junction equality; full Siriu gate (idx locks) + forbidden-arm oracle catch over-removal; per-pair atomic commit makes any regression bisectable. |
| T-decouple-02 | Denial-of-service (walk collapse) | retiring a walker compensation before the associator stands alone | mitigate | Phantom removal + compensation retirement in the SAME commit; FULL gate suite per pair; GATED fallback restores the compensation if green cannot be reached. |
| T-decouple-03 | Repudiation | baseline refreshed before topology actually improved | mitigate | Mandatory order: forbidden-arm oracle must pass BEFORE SIRIU_UPDATE_BASELINE; topology asserted independent of idx numbers. |
| T-decouple-04 | Tampering | post-number literals leak into shipped code | mitigate | Decoupled pairs MUST delete their literal gates; Task 6 greps both source files; literals allowed only in fixture/baseline. |
| T-decouple-SC | Tampering | npm/pip/cargo installs | accept | No new packages installed in this task; nothing to verify. |
</threat_model>

<verification>
- Each per-pair commit (Tasks 2-5) leaves all four gates + traversal test green, OR is a
  documented GATED-keep (compensation restored + inline failing-gate note) with all gates still
  green.
- The forbidden-arm oracle (Task 1) passes before any baseline refresh and proves the phantom
  arm is gone for the pair just decoupled.
- Posts 5 and 14 remain clean (no extra incident arms) through every step.
- Final clean-state run (Task 6) confirms no cross-pair interaction regressed any gate and no
  post-number literals remain for decoupled pairs.
</verification>

<success_criteria>
- Pairs 1 and 2 decouple cleanly (expected): junctions 36, 48, 60 encode ONLY their GT arms at
  the associator; isPhantomBifurcationHint and the dense-bifurcation swap handler are removed.
- Pairs 3 and 4 either decouple (62->81 bridge / junction-70-from-region) with their literal
  hacks deleted, OR are GATED-kept with updated inline failing-gate notes — partial win
  accepted, no broken gate.
- All four accuracy gates (Siriu tight, Luiz Carolino PDF + DWG, Valmor 2.2 m) + the
  branch-traversal test are green at the end.
- Zero post-number literals in shipped parser/walker code for any decoupled pair.
- Siriu walk baseline refreshed to the new correct topology.
</success_criteria>

<output>
Create `.planning/quick/260602-decouple-graph-walker-phantom-edges/260602-decouple-SUMMARY.md`
when done. Record, per pair: DECOUPLED vs GATED-KEPT, the gate results, and for any GATED-kept
pair the exact failing condition captured inline. Do NOT commit docs artifacts or untracked
debug-*.mjs scripts — the orchestrator handles the docs commit.
</output>
