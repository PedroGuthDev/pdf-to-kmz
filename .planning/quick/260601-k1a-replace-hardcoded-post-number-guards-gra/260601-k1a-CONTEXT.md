# Quick Task 260601-k1a: Replace hardcoded post-number guards with generic structural predicates — Context

**Gathered:** 2026-06-01
**Status:** Unblocked — DXF uploaded (`Palhoca.dxf`). All three hacks in scope.

### Second-fixture asset state (2026-06-01, post-upload)
- DXF uploaded: **`Palhoca.dxf`** — 134 MB, **60,471 INSERT** entities (whole-area
  drawing, NOT a pre-trimmed route like `siriu.dxf`). The ~32-post Luiz Carolino
  route is embedded somewhere inside it.
- **RISK — route correspondence (verify FIRST):** PDF is "São José – Rua Luiz
  Carolino Pereira"; DXF is named "Palhoca" (adjacent municipality). Before this
  can serve as a validation gate, confirm the DXF contains the SAME route as the
  ground-truth: georeference INSERTs and check they cluster near the ground-truth
  coords (lat≈-27.567, lon≈-48.69, 32 posts). If it does not match, it is not a
  valid second fixture — STOP and discuss.
- **First deliverable is the fixture+harness build**, heavier than Siriu's because
  of the 134 MB / 60k-INSERT region-extraction step (see `region-library.js`).

### Route-correspondence VERIFIED (2026-06-01)
Probe (`debug-palhoca-route-match.mjs`, throwaway) confirmed the route IS present:
- `Palhoca.dxf` → **35,176 `Poste` INSERTs** (whole municipality), UTM
  x[724198..738301] y[6910435..6950617].
- Ground truth → **31 posts**, UTM x[727824..728151] y[6948054..6948546].
- **31/31 GT posts match a `Poste` INSERT within 5 m (mean 1.0 m).** Valid 2nd gate.
- DOMINANT CHALLENGE: isolate the ~31-post route from 35k posts. Siriu's DXF was
  pre-trimmed; Palhoca is not. The route bbox (≈x[727824..728151] y[6948054..6948546],
  ~330 m × 490 m) is a strong seed for region extraction — the GT bbox can bound
  the fixture-build crop without leaking post-number labels into the predicate logic.

<domain>
## Task Boundary

Replace three hardcoded, route-specific hacks with generic structural/geometric
predicates, validated against a SECOND labeled route (Luiz Carolino) so that
"generic" is actually falsifiable rather than Siriu-fitted.

The three hacks (the "coordinate-accuracy-during-pairing" layer, distinct from
the already-generic topology layer):

1. **graph-walker.js** — post-number guards on already-generic algorithms:
   - L1794: `fromNum === 73 && toNum === 74` gating `findGapOffCableReentryByNextLabel`
     (behind `conn.gap && routeNextLabel != null && (labelM == null || labelM >= 100)`)
   - L2038: `fromNum === 80 && toNum === 81` gating `findOffCableInsertByNextLabel`
     (behind `nextLabel finite && offChordSpan > 80 && |offChordSpan - labelM| > tol`)
   The underlying algorithms are generic; only the post-number equality is the hack.

2. **distance-associator.js** L1614–1637 — fully hardcoded `36→37→38` sheet-break
   bifurcation with literal label values `10.5` / `35.5`. A GENERIC sheet-break
   bifurcation detector already exists immediately below (L1639+) and explicitly
   SKIPS 36/37/38 (L1651). Goal: make the generic detector absorb this case,
   then delete the special-case + its skip.

3. **coordinate-calculator.js** L1432 — `post15` + hardcoded `page 4` seam-lock
   anchor (`lockPageOriginAtGps(pageTransforms, 4, post15.x, …)`). Goal: detect
   the sheet-break boundary post + its page generically instead of literals.

OUT OF SCOPE: the topology layer (already generic per prior work) and the
OCR plausibility bounds in post-assembler.js (`MAX_PLAUSIBLE_POST = ocrResults.length`
is already data-derived, not hardcoded).

</domain>

<decisions>
## Implementation Decisions

### Validation strategy (overfitting defense) — LOCKED
- A **second labeled route (Luiz Carolino)** is the falsification test. A generic
  predicate is only accepted if it keeps BOTH gates green:
  - Siriu regression gate (0 errors, existing harness), AND
  - a new Luiz Carolino gate built to the same contract.
- This is the user's chosen defense against single-dataset overfitting. Without
  it, any predicate tuned to keep Siriu green is hardcoding with extra steps.
- The user is uploading the Luiz Carolino **DWG**. The Luiz Carolino **PDF** and
  a **ground-truth coordinate `.txt`** (32 posts) are ALREADY in the repo:
  - `INFOVIAS_AAF INTERNET_São José_RUA LUIZ CAROLINO PEREIRA_v1.pdf`
  - `coordenadas postes rua luiz carolino pereira..txt` (format: `Poste NN; lat, lon;`)

### Scope & ordering — LOCKED: "All three, easiest-first"
Ordered by readiness to generalize:
1. **distance-associator 36/37/38** — easiest; a generic twin already exists beside it.
2. **graph-walker 73/74 + 80/81** — generic algos exist; replace post guards with
   structural predicates (gap + missing/long label + next-hop fit; off-cable insert
   + chord-span discriminators).
3. **coordinate-calculator post15/page4** — needs generic seam-boundary-post detection.

Pipeline wrinkle that overrides pure "easiest-first" timing:
- distance-associator (#1) and coord-calc (#3) are **PDF-pipeline** → validatable
  against Luiz Carolino **now** (PDF + ground-truth already present).
- graph-walker (#2) is **DWG-pipeline** → **BLOCKED** until the Luiz Carolino DWG
  is uploaded and converted to DXF.

### Plan scope — LOCKED: "Plan all four now"
One PLAN.md covering all four stages (user accepted the larger blast radius):
1. **Foundation** — Luiz Carolino second fixture + route-agnostic harness:
   - Convert `coordenadas postes rua luiz carolino pereira..txt` (31 posts) → JSON
     ground truth in the `siriu-ground-truth.json` shape.
   - Region-extract the ~31-post route from `Palhoca.dxf` (35k Poste INSERTs). Seed
     the crop with the GT bbox (UTM x[727824..728151] y[6948054..6948546]); do NOT
     leak post numbers into predicate logic — bbox is fixture-build scaffolding only.
   - Parameterize `tools/siriu-regression-harness.mjs` → route-agnostic harness
     (PDF + DXF + ground-truth JSON inputs). Add a Luiz Carolino gate.
   - **Acceptance gate for stage 1:** Luiz Carolino gate runs on CURRENT
     (un-generalized) code and reports a baseline. Establishes the dual-gate before
     any hack is touched.
2. Generalize **distance-associator 36/37/38** → both gates green or discuss-again.
3. Generalize **graph-walker 73/74 + 80/81** → both gates green or discuss-again.
4. Generalize **coord-calc post15** → both gates green or discuss-again.
Each generalization (2–4) is an atomic commit; dual-gate green is its done-condition.

### Fallback when no structural predicate holds the gate — LOCKED
- **Discuss again with the user.** Do NOT auto-quarantine or auto-data-drive a
  guard that resists generalization. Stop, surface the specific regression the
  guard prevents, and decide together. (User explicitly chose this over
  quarantine/config-drive defaults.)

### Claude's Discretion
- Exact shape of the structural predicates (which geometric quantities to test)
  is Claude's to design, subject to the hard constraint that they reference ZERO
  post numbers and ZERO absolute page/coordinate literals.
- Whether to parameterize the existing `siriu-regression-harness.mjs` into a
  route-agnostic harness vs. clone it for Luiz Carolino — Claude's call, favor
  parameterization to avoid drift.
- txt→json ground-truth conversion tooling shape.

</specifics>

<specifics>
## Specific Ideas

- Second-fixture build mirrors the Siriu pattern:
  - `tools/build-siriu-test-fixture.mjs` / `export-siriu-regression-fixtures.mjs`
    → Luiz Carolino equivalents (or parameterized).
  - `tools/siriu-regression-harness.mjs` consumes PDF + DXF + ground-truth JSON
    and compares via `haversineMeters` against `siriu-ground-truth.json`.
  - Luiz Carolino DXF must be produced from the uploaded DWG (same DWG→DXF step
    that yielded `siriu.dxf` from `siriu.dwg`).
- Generalization heuristic per guard: identify the structural precondition that
  is TRUE exactly where the post-number guard fires and FALSE where the generic
  algorithm would regress — verify by removing the post guard, keeping/strengthening
  the structural conditions, and confirming both gates stay green.

</specifics>

<canonical_refs>
## Canonical References

- Siriu regression harness contract: `tools/siriu-regression-harness.mjs`
- Siriu fixtures: `parser/__tests__/fixtures/siriu-{ground-truth,topology,dwg-region}.json`
- Prior topology-generalization work: commits `95a9934`, `95bff6b` (cable-topology
  derivation made generic — this task is the separate "pairing accuracy" layer).
- Memory: `project_siriu_walk_progress.md`

</canonical_refs>
