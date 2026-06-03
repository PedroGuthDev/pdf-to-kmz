# Quick Task 260603-acc: Drive Luiz Carolino + João Born route accuracy toward ~15m - Context

**Gathered:** 2026-06-03
**Status:** Ready for planning
**Discussion mode:** --discuss (findings below are EMPIRICALLY PROVEN this session — do NOT re-derive)

<domain>
## Task Boundary

Reduce per-post error on the **Luiz Carolino** and **João Born** routes toward a
**~15 m** target, while explicitly tracking the three generalization risks inherited
from quick 260602 (decouple) and evaluating, per fix, whether each risk is actually
part of the problem or not.

**Sequencing (LOCKED):** start with **Luiz Carolino**; fix the **mid-street / branch-arm
label deformation first**, then the **rigid anchoring offset**, then move to João Born.

This is the accuracy follow-up to 260602-lbl / 260602-decouple, which made the Siriu
branch-arm rehome generic (zero post-number literals) and validated it on Siriu, Luiz
Carolino, and Valmor. This task asks whether that now-generic machinery — and its
remaining Siriu-tuned constants — actually carries to Luiz Carolino and João Born.
</domain>

<investigation_findings>
## What this session proved empirically (start here; do NOT re-derive)

### Luiz Carolino PDF error decomposes into TWO distinct root causes

Diagnostic (`debug-lc-offset-vs-deform.mjs`, untracked) decomposed each post's error
into a per-segment rigid offset vector + the residual deformation after removing it:

**Segment 1–20 — DEFORMATION (the branch-label problem).**
- Mean offset 167 m, but residual after de-translation = **118.9 m mean / 172.6 m max**.
  The segment's internal shape is genuinely WRONG, not just shifted.
- Posts 1–3 near-perfect (0 / 3 / 8 m). Breaks hard at **post 4**. Offset bearing flips
  from ~305° (posts 4–11) to ~7° (posts 12–20) — two bends, consistent with chain
  mis-association at a junction.
- This is the **mid-street / branch-arm label** pattern (same shape as Siriu): at the
  TRAVESSA cross-street junction near posts 06–07, a post carries one label to the
  mid-street tap/junction AND a separate label to the consecutive next post; the
  associator steals the wrong one and the chain bends.

**Segment 21–31 — RIGID OFFSET (the anchoring problem).**
- Mean offset **178.9 m @ 303°**, residual after de-translation = **9.6 m mean / 40 m max**
  (post 31 is the only real local outlier at 40 m).
- The segment's SHAPE is already correct — it is translated ~179 m as a block. This is a
  **multi-sheet anchoring / page-origin calibration** error, NOT a label problem. Mid-street
  label fixes will NOT help here (only ~10 m of residual slack exists).
- The route "resumes" at post 21 (separate sheet). Harness logs `seam-lock Skipped —
  multi-sheet route (global label-lsq fit page origins)` — the page-origin fit places this
  sheet ~179 m off.

**Implication:** reaching ~15 m requires fixing BOTH. The user's mid-street hypothesis is
correct for 1–20; the 21–31 error needs the anchoring fix. A possible shared ~170–179 m
common offset across both segments is worth checking (both segments carry a similar-magnitude
offset).

### Current baselines (per-post error CEILINGS, not targets)
- Luiz Carolino PDF: matched=31, mean **185.63 m** (`luizcarolino-pdf-baseline.json`).
- Luiz Carolino DWG: matched=31, mean **114.88 m**, max 403.93 m.
- João Born: ground-truth fixture exists (35 posts, `joaoborn-ground-truth.json`) +
  `joaoborn-dwg-region.json`, but **NO accuracy gate or baseline exists yet** — one must be
  built (mirror `run-route-pdf-accuracy-gate.mjs` / `route-pdf-accuracy-harness.mjs`).

## The three 260602 generalization risks being TRACKED (registered here)

From the 260602-decouple validation. The literal post-number coupling is GONE (verified: zero
`=== <postnum>` guards in `distance-associator.js` / `graph-walker.js`); junction detection is
now generic via DWG region degree (`isTopologyJunctionCandidate`). What remains are
Siriu-CALIBRATED constants that this task will directly exercise on other routes:

- **RISK-1 — Scale-dependent thresholds (PDF points / meters).** Tuned to Siriu's PDF
  scale/DPI and branch geometry:
  - `distance-associator.js`: `ARM_NEAR_JUNCTION_PT=150`, `ARM_ON_ARM_CHORD_PT=30`,
    `ARM_BEARING_STRONG_DEG=12`, `ARM_ON_CABLE_STRONG_PT=14`, `TOPOLOGY_REHOME_ON_CHORD_PT=45`.
  - `graph-walker.js`: gap-reentry `chordSpan ∈ [95, 250)`, `BRANCH_TERMINAL_MIN_ENTRY_SPAN_M=120`.
  - Hypothesis to test: if Luiz Carolino's PDF is at a different scale, these may mis-fire or
    fail to fire on its mid-street labels.

- **RISK-2 — Cross-page bridge numbering/pagination assumptions (least portable).**
  `distance-associator.js`: `MIN_CROSS_PAGE_ARM_GAP=15`, `CROSS_PAGE_JUNCTION_LOOKBACK=18`
  reason in POST-NUMBER space; `priorPage = entryPage − 1` assumes the junction is on the
  immediately preceding sheet; `farNum > j.number` assumes arms run to higher-numbered posts.
  Luiz Carolino's "resume at 21" multi-sheet structure may violate these.

- **RISK-3 — Same-page topology rehome is destructive** (clears stolen + refills), guarded by
  bearing/chord/occlusion. Cross-page rehome is non-destructive (adds arm, keeps stolen edge as
  walk hint → degrades gracefully). When applying to a new route, RISK-3 is the one that can
  silently corrupt if a guard threshold (RISK-1) is wrong for that route's scale.

**Evaluation protocol:** for each fix, record whether the change required touching one of these
constants. If a constant had to move, that risk WAS part of the problem → note the route-specific
value and whether it should become adaptive (derived from scale/geometry) rather than literal.
</investigation_findings>

<decisions>
## Implementation Decisions (LOCKED — do not revisit)

### Scope & sequencing
- **REVISED after research (2026-06-03, user-confirmed) — order is now B → A → C:**
  - **Task B FIRST — LC page-4 origin split (the anchoring offset).** Pure calibration, NO
    association risk, highest leverage: posts 4–11 AND 21–31 are both on PDF page 4 (route loops
    out and back across the TRAVESSA); the single per-page origin is a compromise that injects
    ~179 m into BOTH clusters. Splitting it fixes 21–31 fully and de-confounds 4–11 so Task A's
    residual deformation can be measured cleanly.
  - **Task A SECOND — LC branch-label deformation (posts 1–20).** NOT a `rehomeBranchArmLabels`
    job: research proved 06–07 is label-graph-invisible (both degree-2) so that rehome cannot
    act. Real fix = (1) tame the FALSE same-page bifurcation detector that nulls true steps
    `3→4` and `11→12`, and (2) add a geometric mid-street guard for 06–07 / 22–23. Preventive,
    not a new destructive clear.
  - **Task C THIRD — João Born gate.** JB PDF path is already healthy (mean ~27 m); the old
    "142 m" was the DWG walk. Just stand up a gate/baseline (mirror the LC trio) + ratchet only
    if Task B's origin generalization also helps JB posts 26–34.
- Original "mid-street labels first" was based on the pre-research hypothesis; superseded above.

### REVISED AGAIN after Task 1 execution (2026-06-03, user-confirmed) — order is now A → (re-measure) → B → C
- **Task 1 (page-4 origin split) was DISPROVEN and GATED-partial (commit `fe22316`).** RESEARCH Q3's
  premise was wrong: page 4's origin is NOT a compromise between its two runs — BOTH page-4 runs
  (4–11, 21–31) share the SAME ~175 m @ 303° offset; page 5 (12–20) has a DIFFERENT ~230 m @ 7°
  offset; only post 1 (page 3) is absolutely anchored. The offsets are **cumulative multi-page
  label-chain drift**, not a same-page two-run conflict. A same-page split made 21–31 worse and was
  reverted (gates stayed green; inline failing-gate note left in `coordinate-calculator.js`).
- **NEW finding (probe `debug-lc-utmgrid-probe.mjs`):** pages 3/4/5 (all route pages) DO carry
  per-page UTM grid references (13/12/13 grid paths) — absolute anchors — but the multi-sheet
  calibration path OVERRIDES them with the global label-LSQ fit (`seam-lock Skipped — multi-sheet`).
- **Two live hypotheses for the offset (unresolved):** H1 = calibrator discards per-page UTM grid
  anchors for multi-sheet routes → drift. H2 = the offset is DOWNSTREAM of the deformation
  (corrupted label distances `3→4`-null, `6→7`=13.8-vs-37.7 pull the label-LSQ page-origin fit off).
  Siriu passes on the same machinery, favoring H2 (LC-specific corrupted labels).
- **DECISION: do Task 2 (deformation) NEXT** (valid regardless of H1/H2), THEN re-measure the offset:
  if it shrank → H2 (symptom), if it persists → H1, apply the per-page UTM-grid-anchor fix (the
  pages-4/5 references found above) as the held-in-reserve Task B. Do NOT re-plan an anchoring fix
  on an unverified premise again.
- **Cable-fork research (2026-06-03) — KILLED:** PDF `cablePaths` / drawn branch-points cannot
  distinguish genuine vs false bifurcations (TP=0/12 on LC/Siriu/JB). Do not plan a PDF-cable-fork
  gate. The bifurcation unlock is **DWG region-degree mapped onto PDF posts** (see
  `260603-acc-RESEARCH-cablefork.md`, RESEARCH Q6). Geometric mid-street guard for 06–07 / 22–23
  remains a separate, viable path.

### Target framing
- **~15 m is a RATCHET target, not a hard gate this task.** Lock each improvement with the
  per-post-ceiling gate (tighten ceilings as error drops). A documented **GATED-partial** is an
  acceptable outcome for any piece that cannot fully close without regressing another gate —
  exactly the 260602 protocol. **A broken gate is never acceptable.**

### Risk tracking (the explicit ask)
- Track RISK-1/2/3 per fix. For every change, state whether it implicates a tracked risk and,
  if a Siriu-tuned constant had to change, capture the route-specific value + a recommendation
  on making it adaptive.

### Guardrails (inherited)
- ZERO post-number literals in shipped parser/walker code (fixtures/baselines only).
- Siriu (tight), Valmor, and the CURRENTLY-PASSING Luiz Carolino ceilings must not regress.
  Tightening Luiz Carolino ceilings as accuracy improves is the goal; loosening them is not.
- Per-pair/per-fix atomic commits so any regression is bisectable.
</decisions>

<specifics>
## Gates / harness / inspection

- **Existing gates (must stay green; LC ceilings tighten as error drops):**
  - `node tools/run-route-pdf-accuracy-gate.mjs`   (Luiz Carolino PDF — the primary target)
  - `node tools/run-route-dwg-accuracy-gate.mjs`   (Luiz Carolino DWG)
  - `node tools/run-siriu-regression-gate.mjs`     (tight regression canary — must not move)
  - `node tools/run-valmor-accuracy-gate.mjs`      (DWG region canary)
  - `node --test parser/__tests__/branch-traversal.test.mjs`
- **To build:** João Born accuracy gate + baseline (mirror the LC PDF gate/harness/baseline trio).
- **Inspection (untracked, reusable — do NOT commit):**
  - `debug-lc-offset-vs-deform.mjs` — decomposes per-post error into rigid per-segment offset
    vs residual deformation (the script that proved the 1–20 vs 21–31 split above).
- **Baseline refresh:** tighten `luizcarolino-pdf-baseline.json` per-post ceilings ONLY after a
  fix is proven to lower error (never loosen to pass).
- Non-worktree execution required: gate scripts run live `parsePdf` over the route PDFs and need
  `node_modules`.

## Key geometry (from the PDF detail screenshot, posts 21–24 / 06–07 area)
- A TRAVESSA (cross-street) junction: posts 21–24 run along one street, 06–07 along the crossing
  street. Short branch labels (e.g. `5.44`, `3.21`) sit beside spine labels (`22.6`, `21.8`,
  `27.4`) — the "mid-street tap label + next-post label" pattern.
</specifics>

<canonical_refs>
## Canonical References

- `.planning/quick/260602-decouple-graph-walker-phantom-edges/260602-decouple-SUMMARY.md`
  — the now-generic rehome machinery + the validated risks (NOTE: its "Next steps" section is
  stale — all four pairs DID decouple; the top table is authoritative).
- `.planning/quick/260602-lbl-fix-distance-label-branch-association/260602-lbl-HANDOFF.md`
  — branch-arm ground-truth, classifyBranchArmLabel + rehomeBranchArmLabels rationale.
- `parser/distance-associator.js` — `applyTopologyBranchArmRehome` (L2642),
  `isTopologyJunctionCandidate` (L2554), `classifyBranchArmLabel`, `rehomeBranchArmLabels`,
  `labelGapToSegment`, tuned constants (L2198-2202, L2567-2570). RISK-1/RISK-2 live here.
- `parser/dwg/graph-walker.js` — generic predicates `rehomedTopologyArmTo` (L699),
  `rehomedCrossPageArmTo` (L715); `findGapOffCableReentryByNextLabel` (L638);
  `BRANCH_TERMINAL_MIN_ENTRY_SPAN_M` (L749). RISK-1 constants here.
- `parser/dwg/cable-topology.js` — `buildCableTopologyMaps` (L245, generic region degree).
- `tools/route-pdf-accuracy-harness.mjs` / `run-route-pdf-accuracy-gate.mjs` — the LC gate to
  mirror for João Born.
- Memory: `project_label_misassociation_rootcause.md`, `project_k1a_guard_generalization.md`,
  `project_siriu_walk_progress.md`.
</canonical_refs>
