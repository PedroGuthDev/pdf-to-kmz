---
phase: quick-260603-acc
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - parser/coordinate-calculator.js
  - parser/geo/label-lsq-calibrator.js
  - parser/distance-associator.js
  - parser/__tests__/fixtures/luizcarolino-pdf-baseline.json
  - tools/run-route-joaoborn-pdf-accuracy-gate.mjs
  - parser/__tests__/fixtures/joaoborn-pdf-baseline.json
autonomous: true
requirements: [ACC-LC-ANCHOR, ACC-LC-DEFORM, ACC-JB-GATE]
execution_env: non-worktree  # gates run live parsePdf over the LC + JB PDFs; need node_modules
user_setup: []

must_haves:
  truths:
    - "LC page 4's two sheet-separated route runs (4->11 and 21->31, joined via page 5) get independent origins, so the ~179 m rigid block translation on 21->31 disappears and the shared ~179 m component is removed from 4->11."
    - "The LC false same-page bifurcations that null true steps 3->4 and 11->12 no longer fire, and the 06-07 (and 22-23) mid-street tap labels are no longer stolen — the consecutive chain stays intact."
    - "A João Born PDF accuracy gate + baseline exists, mirroring the LC trio, locked at the current mean ~27 m profile."
    - "Siriu (tight) + Valmor + the currently-passing LC ceilings never regress; LC ceilings are tightened as error drops, never loosened to pass."
    - "ZERO post-number literals in shipped parser/walker code; any moved Siriu-tuned constant is recorded with its route-specific value + an adaptivity recommendation."
    - "Every commit leaves the full gate suite green OR is a documented GATED-partial (reverted + inline failing-gate note, gates still green) — never a broken gate."
  artifacts:
    - path: "parser/coordinate-calculator.js"
      provides: "Per-cluster page-origin split for a single page hosting two sheet-separated route runs (p4->p5->p4)"
    - path: "parser/geo/label-lsq-calibrator.js"
      provides: "refinePageOriginsByLabelLsq emitting independent sub-origins for the two on-page clusters"
    - path: "parser/distance-associator.js"
      provides: "Adaptive (scale-derived) bifurcation acceptance + geometric mid-street tap-label guard; no post-number literals"
    - path: "tools/run-route-joaoborn-pdf-accuracy-gate.mjs"
      provides: "João Born PDF accuracy gate mirroring the LC PDF gate"
      contains: "JOAOBORN_UPDATE_BASELINE"
    - path: "parser/__tests__/fixtures/joaoborn-pdf-baseline.json"
      provides: "JB per-post ceiling baseline snapshotted at mean ~27 m"
  key_links:
    - from: "parser/coordinate-calculator.js"
      to: "parser/geo/label-lsq-calibrator.js"
      via: "two-sheet-separated-runs detector feeds per-cluster origins into refinePageOriginsByLabelLsq"
      pattern: "refinePageOriginsByLabelLsq|refineAnchorPageBySplitRegion|lockPageOriginsAtSheetBreaksFromPriorProjection"
    - from: "parser/distance-associator.js"
      to: "tools/run-route-pdf-accuracy-gate.mjs"
      via: "associator emits intact consecutive chain; LC PDF gate proves per-post ceilings tighten"
      pattern: "MAX_MAIN_CHORD_GAP_PT|JUNCTION_CLOSER_RATIO|bifurcationDetourRatio|classifyBranchArmLabel|labelGapToSegment"
    - from: "tools/run-route-joaoborn-pdf-accuracy-gate.mjs"
      to: "tools/route-pdf-accuracy-harness.mjs"
      via: "JB gate reuses the route-agnostic harness unchanged"
      pattern: "route-pdf-accuracy-harness"
---

<objective>
Drive the Luiz Carolino and João Born PDF route per-post error toward the ~15 m RATCHET
target by fixing the two independent root causes proven in RESEARCH, in the LOCKED order
B -> A -> C:

1. (Task 1 = RESEARCH Task B) Split LC's page-4 origin: page 4 hosts two sheet-separated
   route runs (4->11 and 21->31, joined across page 5) that today share one compromise
   origin, injecting ~179 m into BOTH clusters. Independent origins fix 21->31 fully and
   remove the shared ~179 m from 4->11, de-confounding the deformation Task 2 must measure.
2. (Task 2 = RESEARCH Task A) Tame the false same-page bifurcation detector that nulls true
   steps 3->4 and 11->12, and add a geometric mid-street guard so the 06-07 / 22-23 tap
   labels are not stolen — keeping the consecutive chain intact.
3. (Task 3 = RESEARCH Task C) Stand up a João Born PDF accuracy gate + baseline mirroring the
   LC trio, snapshotted at the current mean ~27 m, tightened only if Task 1's origin
   generalization also helped JB posts 26-34.

Purpose: reach ~15 m on LC without post-number literals, with every tracked generalization
risk (RISK-1/2/3) evaluated per fix, and JB gated for the first time. This is the accuracy
follow-up to 260602-lbl / 260602-decouple.

Output: a per-cluster page-origin split in the calibrator, an adaptive bifurcation guard +
geometric mid-street guard in the associator, a refreshed LC baseline reflecting proven
improvements, and a new JB gate + baseline. Per-task risk notes (RISK-1/2/3 + any moved
Siriu-tuned constant's route value + adaptivity recommendation).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md

EXECUTION ENVIRONMENT: Run on the MAIN working tree, NOT a worktree. The gate scripts run a
live `parsePdf` over the LC + JB PDFs and require `node_modules`. A worktree without installed
deps will fail every gate spuriously. Do NOT commit any untracked `debug-*.mjs` inspection
scripts.
</execution_context>

<context>
@.planning/STATE.md
@.planning/quick/260603-acc-luizcarolino-joaoborn-route-accuracy/260603-acc-CONTEXT.md
@.planning/quick/260603-acc-luizcarolino-joaoborn-route-accuracy/260603-acc-RESEARCH.md

# DO NOT re-derive the investigation. The two-root-cause split (LC 1-20 deformation vs 21-31
# rigid offset), the precise mechanisms, and the file:line targets are EMPIRICALLY PROVEN in
# RESEARCH.md (HIGH confidence, live this session). Start from those findings.

<interfaces>
<!-- Exact target sites (verified this session in RESEARCH). Executor edits these directly. -->

parser/coordinate-calculator.js:
- L43    imports refineAnchorPageBySplitRegion (the existing same-page-split hook — currently
         skipped: "[split-region] anchor page has 3 posts (<6)").
- L73    lockPageOriginsAtSheetBreaksFromPriorProjection (sheet-break origin lock).
- L1376  refinePageOriginsByLabelLsq call site (the global one-origin-per-page fit).
- L1417-1420  the multiSheetDetail branch where seam-lock is skipped for viewportBoxes>=3
              (comment notes seam-lock drifts ~55 m on João Born — kept for awareness).

parser/geo/label-lsq-calibrator.js:
- L1842  refinePageOriginsByLabelLsq — fits ONE UTM origin per PDF page; for LC it lands page 4
         as a compromise between the 4->11 and 21->31 clusters (theta p4=0.00, shape correct,
         translation ~179 m off).

parser/distance-associator.js:
- L1306  applyBifurcationJunctionLabelRehome (the same-page bifurcation loop entry).
- L1319  JUNCTION_CLOSER_RATIO = 0.9
- L1320  MAX_MAIN_CHORD_GAP_PT = 90 (PT literal, Siriu-tuned)
- L1530-1608  bifurcation acceptance gates (the loop that FALSELY nulls 3->4 and 11->12).
- L1532  bifurcationDetourRatio < 1.08 (the detour gate).
- L2197-2202  ARM_NEAR_JUNCTION_PT=150 / ARM_BEARING_STRONG_DEG=12 / ARM_ON_CABLE_STRONG_PT=14
              (govern classifyBranchArmLabel — relevant only if the mid-street guard reuses it).
- classifyBranchArmLabel / labelGapToSegment (L2073) — reuse for the geometric mid-street guard
  (cable-overlap + consecutive-chord-much-longer-than-label signal). NO label-graph junction
  required (06-07 is degree-2/degree-2, invisible to the label graph).

tools/:
- run-route-pdf-accuracy-gate.mjs — the LC PDF gate to mirror for João Born (repoint PDF/GT/
  baseline, rename env var to JOAOBORN_UPDATE_BASELINE).
- route-pdf-accuracy-harness.mjs — route-agnostic; reuse UNCHANGED for JB.

parser/__tests__/fixtures/:
- luizcarolino-pdf-baseline.json — per-post ceilings; tighten on proven improvement only.
- joaoborn-ground-truth.json — 35 posts (post 35 is a known typo; PDF parses 34, harness
  matches 34 and never touches 35).
- INFOVIAS_PJC INTERNET_Palhoca_RUA JOAO BORN_v04.pdf — the JB source PDF (in repo).
</interfaces>
</context>

<sequencing_rules>
LOCKED protocol (the 260602 GATED protocol) — applies to every task:

1. Atomic, bisectable commit per task. Never split a single root-cause fix across commits.
2. Run the FULL gate suite after each change:
   - `node tools/run-route-pdf-accuracy-gate.mjs`        (Luiz Carolino PDF — PRIMARY target)
   - `node tools/run-route-dwg-accuracy-gate.mjs`        (Luiz Carolino DWG)
   - `node tools/run-siriu-regression-gate.mjs`          (tight canary — must NOT move)
   - `node tools/run-valmor-accuracy-gate.mjs`           (Valmor DWG region canary)
   - `node --test parser/__tests__/branch-traversal.test.mjs`
   - (Task 3 only, additionally) `node tools/run-route-joaoborn-pdf-accuracy-gate.mjs`
3. Baseline refresh order (mandatory): FIRST prove error dropped on the affected LC posts, THEN
   tighten the per-post ceilings in `luizcarolino-pdf-baseline.json` via the gate's
   `LUIZCAROLINO_UPDATE_BASELINE=1` path. NEVER loosen a ceiling to pass; NEVER refresh a
   baseline before a proven improvement. ~15 m is a RATCHET target, not a hard gate.
4. GATED-partial fallback: if a piece regresses a gate and cannot be made green, revert THAT
   piece ONLY, restore the prior behavior, and add an inline failing-gate note recording the
   exact condition for a future attempt. The other gates must stay green. A documented
   GATED-partial is an acceptable outcome; a broken gate is never acceptable.
5. Generic geometry/scale only — ZERO post-number literals in shipped parser/walker code. Post
   numbers may appear ONLY in fixtures/baselines. Prefer making any moved Siriu-tuned threshold
   ADAPTIVE (derived from per-page scale / local chord length), not a new flat literal.
6. RISK TRACKING (the user's explicit ask): in each task's <done>, state whether a tracked risk
   (RISK-1 scale thresholds / RISK-2 multi-sheet+page-origin portability / RISK-3 destructive
   rehome) was implicated, and if a Siriu-tuned constant moved, record the route-specific value
   + whether it should become adaptive.

Inspection helpers (untracked, reusable — do NOT commit):
- `debug-lc-truth-vs-edges.mjs` — consecutive truth-step vs associator-edge delta table (LC).
- `debug-lc-offset-vs-deform.mjs` — rigid-offset vs residual decomposition (LC).
- `debug-lc-degree.mjs` — label-graph degree + post->page map (LC & JB).
</sequencing_rules>

<tasks>

<task type="auto">
  <name>Task 1 (RESEARCH Task B): LC page-4 origin split — fix the rigid ~179 m anchoring offset</name>
  <files>parser/coordinate-calculator.js, parser/geo/label-lsq-calibrator.js, parser/__tests__/fixtures/luizcarolino-pdf-baseline.json</files>
  <action>
    Highest-leverage, pure-calibration change — NO association edits. Page 4 hosts two
    disjoint route runs: 4->11 and 21->31, joined only across page 5 (sequence p4->p5->p4).
    Today refinePageOriginsByLabelLsq (label-lsq-calibrator.js:1842, called from
    coordinate-calculator.js:1376) fits ONE origin per page, landing page 4 as a compromise
    that translates 21->31 ~179 m @303 deg (shape correct: residual ~10 m) and injects the
    same ~179 m component into 4->11.

    Resolve this OPEN DECISION in-plan and record the choice: PREFER a principled generic
    detector — "a single page hosts two sheet-separated route runs (page sequence p4->p5->p4)"
    — over adapting the `<6 posts` split-region gate. When that pattern is detected, treat the
    two on-page runs as two independently-anchored sub-pages, each origin locked from its own
    entering sheet break (the 11->12 boundary for the first run; the 20->21 boundary for the
    second) using the already-correct per-page UTM scale/rotation (theta p4=0.00). The existing
    refineAnchorPageBySplitRegion hook (imported at coordinate-calculator.js:43, currently
    skipped because the anchor page has 3 posts <6) is the fallback adaptation path only if the
    generic detector cannot be cleanly wired; if used, verify its gate counts per-RUN, not
    per-page (the page-4 second run is 11 posts and should qualify on its own).

    HARD CONSTRAINT (RISK-2): the detector MUST NOT assume `priorPage = entryPage - 1` or
    single-run-per-page, and must not assume arms run to higher-numbered posts. Discover the two
    runs from the post->page sequence + sheet-break boundaries, generically. ZERO post-number
    literals.

    After the split, prove via debug-lc-offset-vs-deform.mjs that 21->31 collapses toward its
    ~10 m residual and 4->11 drops by the shared ~179 m. Then tighten the LC per-post ceilings
    for posts 21-31 (toward ~10 m) and the rigid-component reduction on posts 4-11 via
    `LUIZCAROLINO_UPDATE_BASELINE=1 node tools/run-route-pdf-accuracy-gate.mjs` — only after the
    drop is proven. If the split regresses Siriu/Valmor/JB or cannot land cleanly, apply the
    GATED-partial fallback (revert, inline failing-gate note, gates green).
  </action>
  <verify>
    <automated>node tools/run-route-pdf-accuracy-gate.mjs && node tools/run-route-dwg-accuracy-gate.mjs && node tools/run-siriu-regression-gate.mjs && node tools/run-valmor-accuracy-gate.mjs && node --test parser/__tests__/branch-traversal.test.mjs</automated>
  </verify>
  <done>
    LC posts 21-31 error drops toward ~10 m residual; posts 4-11 lose the shared ~179 m rigid
    component; LC baseline ceilings tightened accordingly (never loosened). All four existing
    gates + traversal test green. ZERO post-number literals added. RISK NOTE: state that RISK-2
    (multi-sheet/page-origin portability) WAS the implicated risk; record which approach shipped
    (generic two-run detector vs split-region gate adaptation) and confirm no
    `priorPage=entryPage-1` / single-run assumption was introduced. RISK-1/RISK-3 not implicated
    (pure calibration, no constant moved, no association change). (OR: GATED-partial — reverted
    with inline failing-gate note, all gates still green.)
  </done>
</task>

<task type="auto">
  <name>Task 2 (RESEARCH Task A): LC branch-label deformation (posts 1-20) — adaptive bifurcation guard + geometric mid-street guard</name>
  <files>parser/distance-associator.js, parser/__tests__/fixtures/luizcarolino-pdf-baseline.json</files>
  <action>
    MANDATORY FIRST STEP (before changing ANY constant): extend the untracked
    debug-lc-truth-vs-edges.mjs to LOG each bifurcation acceptance guard's value for the post-2
    and post-10 false-positive triples — specifically MAX_MAIN_CHORD_GAP_PT (:1320),
    JUNCTION_CLOSER_RATIO (:1319, the `dJunc < dTap * 0.9` test at ~:1550), and
    bifurcationDetourRatio (:1532, `< 1.08`). This pins WHICH guard is actually too loose for
    LC's scale, so the fix targets the real offender, not a guess. Do NOT commit this script.

    THEN, two preventive changes (NOT a new destructive clear — avoid RISK-3):
    (a) Tame the false same-page bifurcation loop (applyBifurcationJunctionLabelRehome,
        gates :1530-1608) so it stops classifying post 3 / post 11 as bifurcation taps and
        stops nulling the true consecutive steps 3->4 and 11->12. Move ONLY the guard the
        diagnostic identified, and prefer making it ADAPTIVE — derived from local
        consecutive-chord length / per-page scale — rather than a new flat PT literal
        (RISK-1: a scale-dependent threshold likely must move).
    (b) Add a GEOMETRIC mid-street guard (reusing classifyBranchArmLabel / labelGapToSegment,
        :2073) that recognizes a label sitting on a tap stub off the consecutive chord (cable
        overlap + consecutive chord much longer than the label) and REFUSES to consume it for
        the consecutive step — letting the true 6->7=37.7 label be associated. This fixes 06-07
        (degree-2/degree-2, label-graph-invisible) and also helps 22-23. NO label-graph-junction
        requirement, NO region-degree-on-PDF path (that route trips RISK-2 and is DISCOURAGED —
        fall back to it ONLY if the geometric guard cannot separate 06-07 without regressing
        Siriu, and flag it as RISK-2 if proposed). If the mid-street guard reuses
        ARM_NEAR_JUNCTION_PT / ARM_BEARING_STRONG_DEG / ARM_ON_CABLE_STRONG_PT (:2197-2202),
        derive those PT thresholds from per-page scale.

    ZERO post-number literals. After the fix, confirm the associator emits intact consecutive
    edges (3->4, 6->7=37.7, 9->10/10->11 unswapped, 11->12) via debug-lc-truth-vs-edges.mjs,
    then tighten the LC per-post ceilings for posts 3,4,6,9,10,11,12 — only after proven
    improvement. Note that posts 4-11 only reach ~15 m once Task 1's ~179 m removal AND this
    deformation fix both land. If any change regresses a gate, apply the GATED-partial fallback.
  </action>
  <verify>
    <automated>node tools/run-route-pdf-accuracy-gate.mjs && node tools/run-route-dwg-accuracy-gate.mjs && node tools/run-siriu-regression-gate.mjs && node tools/run-valmor-accuracy-gate.mjs && node --test parser/__tests__/branch-traversal.test.mjs</automated>
  </verify>
  <done>
    LC consecutive steps 3->4 and 11->12 are no longer nulled; 6->7 carries ~37.7 (not the
    stolen ~13.8); 9->10 / 10->11 are unswapped; posts 1-20 deformation drops; LC ceilings for
    posts 3,4,6,9,10,11,12 tightened (never loosened). All four existing gates + traversal test
    green — Siriu/Valmor unmoved. ZERO post-number literals; change is PREVENTIVE (no new
    destructive clear). RISK NOTE: state that RISK-1 (scale-dependent threshold) WAS implicated;
    name the exact guard that moved, its prior Siriu value, the LC route-specific value, and the
    adaptivity recommendation (derive from per-page scale / chord). State RISK-3 NOT implicated
    (preventive, no destructive clear added) and RISK-2 NOT implicated (geometric guard, no
    region-degree-on-PDF path) — or, if the geometric guard fell back to region-degree, flag
    RISK-2 explicitly. (OR: GATED-partial — reverted with inline failing-gate note, gates green.)
  </done>
</task>

<task type="auto">
  <name>Task 3 (RESEARCH Task C): João Born PDF accuracy gate + baseline</name>
  <files>tools/run-route-joaoborn-pdf-accuracy-gate.mjs, parser/__tests__/fixtures/joaoborn-pdf-baseline.json</files>
  <action>
    Stand up the JB PDF gate by MIRRORING the LC trio — JB's PDF path is already healthy
    (mean ~27 m, max ~46 m; the old "142 m" was the DWG walk, not the PDF path).

    Create tools/run-route-joaoborn-pdf-accuracy-gate.mjs as a COPY of
    tools/run-route-pdf-accuracy-gate.mjs with ONLY these repoints:
    - PDF_PATH -> `INFOVIAS_PJC INTERNET_Palhoca_RUA JOAO BORN_v04.pdf`
    - GT_PATH  -> parser/__tests__/fixtures/joaoborn-ground-truth.json (35 posts; PDF parses 34,
      harness matches 34 and never touches the known-typo post 35 — no special-casing needed)
    - BASELINE_PATH -> parser/__tests__/fixtures/joaoborn-pdf-baseline.json (new)
    - env var renamed LUIZCAROLINO_UPDATE_BASELINE -> JOAOBORN_UPDATE_BASELINE
    Reuse tools/route-pdf-accuracy-harness.mjs UNCHANGED (it is already route-agnostic).

    Generate the baseline by running the gate once with JOAOBORN_UPDATE_BASELINE=1 — it
    auto-writes the per-post ceilings at the current ~27 m profile (same slackM ceiling logic as
    LC). Snapshot NOW. Then, ONLY IF Task 1's page-origin generalization also improved JB posts
    26-34 (the same multi-sheet page-origin family as LC, milder), re-run JB and tighten posts
    26-34 ceilings — never loosen, never block on a JB association fix (the PDF path does not
    need one). ZERO post-number literals in the gate (post numbers live only in GT/baseline).
  </action>
  <verify>
    <automated>node tools/run-route-joaoborn-pdf-accuracy-gate.mjs && node tools/run-route-pdf-accuracy-gate.mjs && node tools/run-route-dwg-accuracy-gate.mjs && node tools/run-siriu-regression-gate.mjs && node tools/run-valmor-accuracy-gate.mjs && node --test parser/__tests__/branch-traversal.test.mjs</automated>
  </verify>
  <done>
    tools/run-route-joaoborn-pdf-accuracy-gate.mjs exists (copy of the LC gate, repointed +
    env renamed to JOAOBORN_UPDATE_BASELINE), reusing route-pdf-accuracy-harness.mjs unchanged.
    joaoborn-pdf-baseline.json exists, snapshotted at mean ~27 m / max ~46 m, and the JB gate
    passes green. All five existing gates + traversal test remain green. If Task 1 improved JB
    posts 26-34, those ceilings are tightened (recorded); otherwise left at snapshot.
    RISK NOTE: if Task 1's page-origin generalization was applied to JB, state whether RISK-2
    (multi-sheet portability) surfaced when verifying posts 26-34; otherwise none implicated
    (the gate itself touches no association/calibration constants).
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| page-origin calibrator -> projected coordinates | The route trusts the per-page origin fit; an over-eager or mis-anchored split silently shifts a whole cluster (RISK-2). |
| associator label graph -> projected chain | A too-loose bifurcation guard nulls true consecutive steps; a too-tight one drops a real Siriu bifurcation. The associator output is trusted downstream. |
| ground-truth fixture / baseline -> gates | The baseline defines "passing"; a loosened ceiling would mask a regression. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-acc-01 | Tampering | page-4 split mis-anchors a cluster (RISK-2) | mitigate | Detector discovers runs generically from post->page sequence + sheet breaks (no priorPage=entryPage-1 / single-run assumption); full gate suite + offset-vs-deform diagnostic catch a mis-anchor; per-task atomic commit makes regressions bisectable. |
| T-acc-02 | Denial-of-service (chain collapse) | bifurcation guard moved too far, nulling or over-accepting steps | mitigate | Mandatory pre-change diagnostic pins the actual too-loose guard; change is adaptive (scale-derived) + preventive (no new destructive clear, avoiding RISK-3); Siriu tight gate + branch-traversal test catch over-correction. |
| T-acc-03 | Repudiation | LC/JB baseline tightened (or loosened) without a proven improvement | mitigate | Mandatory order: prove error dropped on affected posts BEFORE any *_UPDATE_BASELINE refresh; never loosen a ceiling to pass; ~15 m is a ratchet, not a hard gate. |
| T-acc-04 | Tampering | post-number literals leak into shipped parser/calibrator code | mitigate | All changes are geometric/scale-derived; post numbers allowed only in fixtures/baselines; <done> per task asserts zero literals. |
| T-acc-05 | Elevation of privilege (RISK-2 via region-degree-on-PDF) | mid-street guard falls back to DWG region-degree on the PDF path | mitigate | Geometric mid-street guard preferred; region-degree-on-PDF DISCOURAGED and, if used, must be flagged RISK-2 with a route-specific note. |
| T-acc-SC | Tampering | npm/pip/cargo installs | accept | No new packages installed; the JB gate is a copy of an existing tool reusing existing deps. Nothing to verify. |
</threat_model>

<verification>
- Task 1: LC posts 21-31 collapse toward ~10 m residual and 4-11 lose the shared ~179 m
  (proven via debug-lc-offset-vs-deform.mjs before any baseline refresh); all four existing
  gates + traversal test green; RISK-2 note recorded.
- Task 2: LC consecutive steps 3->4, 6->7 (~37.7), 9->10/10->11, 11->12 are intact (proven via
  debug-lc-truth-vs-edges.mjs); the pre-change guard diagnostic was run BEFORE moving any
  constant; Siriu/Valmor unmoved; RISK-1 note records the moved guard's prior Siriu value, LC
  value, and adaptivity recommendation.
- Task 3: JB gate exists (mirror of LC trio), passes at the ~27 m snapshot baseline, reuses the
  harness unchanged; all five existing gates + traversal test green.
- Every task: zero post-number literals in shipped code; any GATED-partial carries an inline
  failing-gate note and leaves all gates green. No untracked debug-*.mjs scripts committed.
</verification>

<success_criteria>
- LC PDF per-post error drops materially: 21->31 toward ~10 m (Task 1), posts 1-20 deformation
  resolved (Task 2), and posts 4-11 toward ~15 m once both land — with LC baseline ceilings
  TIGHTENED (never loosened) to lock each proven improvement.
- A João Born PDF accuracy gate + baseline exist, mirroring the LC trio, green at mean ~27 m,
  tightened on posts 26-34 only if Task 1 helped them.
- Siriu (tight) + Valmor + the currently-passing LC ceilings never regress.
- ZERO post-number literals in shipped parser/calibrator code; every moved Siriu-tuned constant
  recorded with its route-specific value + adaptivity recommendation.
- Each tracked risk (RISK-1/2/3) is evaluated per task and its implication recorded in <done>.
- Every commit is atomic/bisectable and leaves the full gate suite green, OR is a documented
  GATED-partial — never a broken gate.
</success_criteria>

<output>
Create `.planning/quick/260603-acc-luizcarolino-joaoborn-route-accuracy/260603-acc-SUMMARY.md`
when done. Record, per task: SHIPPED vs GATED-PARTIAL, the gate results (before/after per-post
means), and the RISK-1/2/3 evaluation including any moved Siriu-tuned constant's route-specific
value + adaptivity recommendation. Do NOT commit docs artifacts or untracked debug-*.mjs
scripts — the orchestrator handles the docs commit.
</output>
