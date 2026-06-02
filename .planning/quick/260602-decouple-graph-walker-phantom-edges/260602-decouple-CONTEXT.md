# Quick Task 260602-decouple: Decouple graph-walker from load-bearing phantom label edges - Context

**Gathered:** 2026-06-02
**Status:** Ready for planning

<domain>
## Task Boundary

Remove the load-bearing spurious/phantom label-graph edges at the **associator**
(`parser/distance-associator.js`) AND retire the matching **graph-walker**
compensations (`parser/dwg/graph-walker.js`) **in lockstep**, so the Siriu label
graph encodes ONLY its true junction arms while the DWG graph walk stays green.

This is the root-cause follow-up to quick task **260602-lbl**, which left these
compensations GATED-and-kept because the associator could not yet stand alone.
</domain>

<investigation_findings>
## What this session proved empirically (do NOT re-derive — start here)

The "spurious arms" are **load-bearing by design**: the associator deliberately
emits a locally-wrong label graph and the graph-walker corrects it at walk time.
Removing edges at the source WITHOUT retiring the walker compensation collapses
the walk.

**Hard evidence (this session):**
- Nulling the single phantom `36→39=35.5` at the associator (a clean,
  generic equal-value-at-junction dedup) collapsed the entire DWG walk to
  `dwgStatus=pdf-fallback, walkOk=false, coords=0` — Siriu gate went from PASS to
  **99–106 failures**. Reverted; baseline green again (no net diff).

**The four coupled compensation ↔ phantom pairs (all in scope):**

1. **Phantom arm `36→39=35.5` [inferred-label]** ↔ `graph-walker.js:1146-1179`
   `isPhantomBifurcationHint` + `bifurcationMainByOriginMeters`. The walker is
   purpose-built to KEEP this phantom in `distances` and reject it at walk time
   (comment cites `36->39=35.5` mirroring real `36->38=35.5` verbatim).
   - Also covers `60` phantoms: `59→60=31.7` [legacy-midpoint] (consecutive steal
     of the real `60→65=31.7`) and `66→60=22.0` [inferred-label] (phantom long-span;
     22.0 truly belongs to `65→66`, which is currently `bifurcation-cleared`/null).

2. **Post-48 lost `8.4` tap** ↔ `graph-walker.js:1647-1699` "Dense bifurcation
   (e.g. Siriu post 48)" swap handler. Associator leaves `22.6` on `48→49`
   (legacy-midpoint, GT is `8.4`) and the `8.4` stub on `49→50`; the walker swaps
   them at walk time using DWG geometry. Also a spurious `51→48=42.3` [inferred-label].

3. **`73/74` gap-reentry hack** (GATED-kept in 260602-lbl) ↔ phantom for
   `38.7 → 70→74`. Root cause: true junction 70 is label-graph degree<2 (its arm is
   mis-associated), so the degree-≥3 detector can't pick it. **Prerequisite:** detect
   junction 70 from DWG **region** geometry (region degree), not label-graph degree.

4. **`80/81` off-cable insert hack** (GATED-kept in 260602-lbl) ↔ phantom for
   `40.6 → 62→81`. This is **CROSS-PAGE** (label drawn on post 81's page). The B3
   rehome handles same-page only. **Prerequisite:** bridge cross-page branch-entry
   labels back to the prior-page junction (extend cross-page logic around
   `labelGapToSegment`, distance-associator.js:2073).

**Source-tier intuition that worked for dedup (kept for reference):**
authoritative {bifurcation-main, bifurcation-tap, branch-arm-rehomed, override} >
inferred-label > legacy-midpoint. BUT pure source-tier nulling at the associator is
unsafe alone — the walker must stop depending on the phantom in the SAME step.

**Ground-truth arms (Siriu true junctions 5,14,36,48,60,62,70):**
- 36: {35:47.9, 37:10.5(tap), 38:35.5(main), 46:27.7(rehomed)}  — phantom: 36→39
- 48: {47:19.3, 49:8.4(tap), 54:44.7}                            — wrong: 48→49=22.6; phantom 51→48
- 60: {61:27.4, 65:31.7, 69:31(rehomed)}                         — phantoms: 59→60, 66→60
- 62: {61:34.8, 63:33.8, 81:40.6(cross-page)}                    — missing 62→81
- 70: {69:23.6, 71:31.8, 74:38.7}                                — 38.7 stuck on 70→71; missing 70→74
- (5 and 14 already fully clean — regression canaries, must stay clean)
</investigation_findings>

<decisions>
## Implementation Decisions (LOCKED — do not revisit)

### Sequencing
- **Incremental, gate per pair.** Remove ONE phantom at source + retire its matching
  walker compensation TOGETHER in one atomic commit, run the FULL Siriu gate, only
  then proceed to the next pair. Each commit must leave all gates green (or be a
  documented GATED-keep). This makes any regression trivially bisectable.

### Scope
- **All four compensations** are in scope: (1) 36/60 phantom arms +
  `isPhantomBifurcationHint`, (2) post-48 swap + dense-bifurcation handler,
  (3) `73/74` hack + junction-70-from-region-geometry, (4) `80/81` hack +
  cross-page `62→81` bridge. Order easiest→hardest: pair 1, then 2, then 4
  (cross-page), then 3 (region-degree junction detection).

### Fallback (per-pair)
- **GATED-keep, documented.** If a specific pair cannot decouple without regressing
  a gate, revert THAT pair only, keep its walker compensation with an inline
  failing-gate note (exact condition for future removal), and ship the pairs that
  DID decouple. Partial win is acceptable and expected for pairs 3 and 4. A broken
  gate is never acceptable; a documented-kept compensation is.

### Proof oracle (correctness, not just "different")
- **Extend the ground-truth junction fixture as the oracle.** Use/extend
  `parser/__tests__/fixtures/siriu-junction-ground-truth.json` to assert each
  junction now carries ONLY its true GT arms (no phantom arms). After each pair
  decouples, refresh the walk baseline (`SIRIU_UPDATE_BASELINE=1`) to the NEW
  correct idx values — but ONLY after the ground-truth fixture assertion proves the
  topology improved. Topology correctness is asserted independently of the moving
  idx numbers. Posts 5 and 14 must remain clean throughout (canaries).
</decisions>

<specifics>
## Specific Ideas / Harness

- **Gates (all must stay green or GATED-documented each step):**
  - `node tools/run-siriu-regression-gate.mjs` (the tight one — err ceilings + idx locks)
  - `node tools/run-route-pdf-accuracy-gate.mjs` (Luiz Carolino PDF)
  - `node tools/run-route-dwg-accuracy-gate.mjs` (Luiz Carolino DWG)
  - `node tools/run-valmor-accuracy-gate.mjs` (Valmor, tight 2.2m)
  - `node --test parser/__tests__/branch-traversal.test.mjs`
- **Temp inspection scripts (untracked, reusable):**
  - `debug-siriu-label-assoc.mjs` — per-post associated arms vs GT
  - `debug-siriu-edge-provenance.mjs` — every incident edge + source + raw label positions
- **Baseline refresh:** `SIRIU_UPDATE_BASELINE=1 node tools/run-siriu-regression-gate.mjs`
  (only after the ground-truth fixture proves the new topology is correct).
- Non-worktree execution required: gate scripts need node_modules (full parser
  pipeline runs live `parsePdf` on the Siriu PDF + `siriu.dxf`).
</specifics>

<canonical_refs>
## Canonical References

- `.planning/quick/260602-lbl-fix-distance-label-branch-association/260602-lbl-HANDOFF.md`
  — authoritative ground-truth (junction arms, both failure modes, gates, inspection one-liners).
- `.planning/quick/260602-lbl-fix-distance-label-branch-association/260602-lbl-SUMMARY.md`
  — what shipped, the two deferred blockers (cross-page 62→81, junction-70), GATED protocol.
- `parser/distance-associator.js` — `inferDistanceEdgesFromLabels` (L1138, source of phantoms),
  `applyBifurcationJunctionLabelRehome` (L1306), `rehomeBranchArmLabels` (L1876),
  `labelGapToSegment` (L2073, cross-page hook point), `associateDistancesRich` (L852).
- `parser/dwg/graph-walker.js` — `isPhantomBifurcationHint` (L1173) + `bifurcationMainByOriginMeters`
  (L1152); dense-bifurcation swap (L1647-1699); the `73/74` and `80/81` hacks (search the file).
- `parser/branch-traversal.mjs` + `parser/__tests__/branch-traversal.test.mjs` — proven generic
  DFS-with-slots model (degree-1=tip, degree-≥3=junction, degree-4=2 slots), zero post literals.
- Memory: `project_label_misassociation_rootcause.md`, `project_siriu_walk_progress.md`,
  `project_k1a_guard_generalization.md`.
</canonical_refs>
