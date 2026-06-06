# Phase 07: Solver Prerequisites - Context

**Gathered:** 2026-06-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Confirm every input graph, fixture, and gate required to build and validate the
Phase 8 global PDF↔DXF solver is green (or explicitly classified) **before any
solver code is written** — so no correct solver fix can be blocked by
compensated-error gates or phantom-edge-poisoned input graphs.

**In scope (SOLVE-05 + ROADMAP SC-1..4):**

1. **Canonical GPS ground truth** — the four repo-root `.txt` coordinate files
   become the single source of truth; sync to JSON fixtures; accuracy gates for
   all four named routes (Siriu, Luiz Carolino, João Born, Valmor).
2. **Per-post PDF position fixtures + gates** — `tools/run-*-post-position-gate.mjs`
   exits 0 for all four routes (layer-B isolation locks).
3. **LC placement fix** — fix layer-B so the LC position gate greens; scope
   includes all position-failing posts and all txt-GPS **bad-tier** posts (>15 m).
4. **Junction ground-truth** — `{route}-junction-ground-truth.json` + tests for
   all four routes; phantom-free label graphs fed to the solver.
5. **Gate audit** — `07-GATE-AUDIT.md` classifying every active gate as
   regression fence vs accuracy assertion; fence gates annotated for Phase 8
   mid-flight policy.
6. **CI wiring** — all Phase 7 gates in `npm run test:gate` at phase exit.
7. **Baseline cascade** — full DWG pairing cascade on all four routes completes
   with Phase 5 residual gate active and **no solver code present**.

**Out of scope:** global solver implementation (Phase 8), KMZ/UI diagnostic
surfacing (Phase 9), active cascade demotion on fail, multi-zone CRS (MZONE-01).

</domain>

<decisions>
## Implementation Decisions

### Canonical GPS ground truth (txt files)
- **D-01:** The four repo-root `.txt` files are the **single canonical GPS
  ground-truth source** for all four named routes:
  - `coordenadas postes siriu.txt` (85 posts — skip empty lines; file has ~93
    lines / 8 blanks)
  - `coordenadas postes rua luiz carolino pereira..txt`
  - `coordenadas postes rua joao born.txt`
  - `coordenadas postes rua valmor.txt`
- **D-02:** Add `tools/import-ground-truth-txt.mjs` to parse these files and
  write/update `parser/__tests__/fixtures/*-ground-truth.json`. Re-run after
  any manual txt edit. Gates may read JSON fixtures (imported from txt), not
  txt directly at runtime.
- **D-03:** Accuracy is measured against txt-derived truth using **four tiers**
  (user-defined, applies to all routes):
  - **Perfect:** error ≤ 5 m
  - **Good:** error ≤ 10 m
  - **Acceptable:** error ≤ 15 m
  - **Bad:** error > 15 m
  Phase 7 exit requires no route to have any post in the **bad** tier when
  measured against txt truth via the full cascade (exact aggregate pass rule
  for CI is planner discretion — at minimum, zero bad-tier posts).

### Per-post PDF position fixtures (layer B)
- **D-04:** **Full stack** — txt GPS accuracy gates AND per-post PDF position
  gates are both Phase 7 deliverables (not either/or).
- **D-05:** **João Born:** LC-style **hand-known PDF pole anchors** (not a
  Siriu characterization snapshot). Fixture covers **all posts in the route**.
  Gate: `tools/run-joaoborn-post-position-gate.mjs` (new).
- **D-06:** **Valmor:** Has a PDF sheet —
  `INFOVIAS_PJC INTERNET_Palhoça_RUA VALMOR FRANCISCO_v1.pdf`. Build full PDF
  position fixture + gate (same pattern as JB/LC/Siriu). Do **not** treat Valmor
  as DWG-only exempt.
- **D-07:** **Siriu:** Keep existing characterization lock
  (`siriu-post-positions-truth.json` + `run-siriu-post-position-gate.mjs`).
- **D-08:** **Luiz Carolino:** Keep hand-known anchor truth for posts 1–20;
  extend/fix scope per D-09 below.

### LC placement fix (Phase 7 prerequisite)
- **D-09:** LC position gate **must GREEN** before Phase 8 — fixing layer-B
  placement is **in scope for Phase 7**, not deferred to the solver.
- **D-10:** Fix scope = **all posts** that (a) fail the LC position gate OR
  (b) exceed **15 m** error vs txt GPS ground truth (bad tier). Not limited
  to posts 9/10/11 alone.
- **D-11:** **Mid-flight during Phase 7 LC fix work:** **ALL gates must stay
  green at every checkpoint** — no intentional RED mid-flight. Incremental
  fixes must not regress Siriu, JB, Valmor, junction tests, or any other gate.
  (Dual position gates exist precisely because prior LC fixes regressed Siriu
  invisibly.)

### Junction ground-truth (all four routes)
- **D-12:** Build `{siriu,luizcarolino,joaoborn,valmor}-junction-ground-truth.json`
  + test assertions for **all four routes** (ROADMAP SC-2).
- **D-13:** Junction lists are **manually curated** — user declares authoritative
  junction post numbers and arm topology per route during Phase 7 execution.
- **D-14:** **João Born — locked declaration: no bifurcations.** Junction
  fixture must reflect a linear/no-junction topology (overrides prior research
  note suggesting post 13 as a bifurcation).
- **D-15:** Phantom-edge checks use **both** mechanisms:
  1. Per-route `forbiddenArms` populated from 260602-decouple pairs (phantom
     edges that must stay absent).
  2. Global rule: **no degree≥3 junction may arise from inferred-label edges
     alone.**

### Gate audit & CI
- **D-16:** Gate audit document:
  `.planning/phases/07-solver-prerequisites/07-GATE-AUDIT.md` — every active
  gate classified **regression fence** vs **accuracy assertion**; fence gates
  annotated with Phase 8 mid-flight policy.
- **D-17:** At Phase 7 exit, **wire ALL gates into `npm run test:gate`** —
  including the four post-position gates, txt-accuracy gates, junction fixture
  tests, and existing Siriu/DWG/residual/DXF gates. Single command = full green
  bar.
- **D-18:** **Phase 8 mid-flight policy** (annotated in audit):
  - **Hard red-lines (must stay green):** per-post position gates, Siriu
    regression gate, junction ground-truth fixture assertions.
  - **Soft mid-flight (may go RED during solver dev if audit-marked):**
    cumulative accuracy baselines / regression fences (e.g. LC/JB PDF
    baselines, residual absolute sub-score fences).

### Claude's Discretion
- Exact CI pass rule for tier aggregates (e.g. require all posts ≤10 m vs allow
  acceptable tier with zero bad-tier).
- LC/Valmor/Siriu junction post lists — planner drafts from research + user
  spot-check; user must approve before locking fixtures (JB list is fixed: none).
- Import script field mapping when txt post count ≠ route post count (Siriu 85).
- Order of Phase 7 plan waves (fixtures before LC fix vs parallel).
- Hand-known PDF anchor capture workflow for JB and Valmor position truths.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` §SOLVE-05 — solver prerequisites requirement.
- `.planning/ROADMAP.md` §"Phase 7: Solver Prerequisites" — goal + SC-1..4.

### User-provided GPS ground truth (MANDATORY — canonical source)
- `coordenadas postes siriu.txt` — 85 posts (skip empty lines).
- `coordenadas postes rua luiz carolino pereira..txt` — LC GPS truth.
- `coordenadas postes rua joao born.txt` — João Born GPS truth.
- `coordenadas postes rua valmor.txt` — Valmor GPS truth (11 posts).

### Route PDFs (position fixture + cascade inputs)
- `INFOVIAS_PJC INTERNET_Garopaba_Praia do Siriu_v01.pdf`
- `INFOVIAS_AAF INTERNET_São José_RUA LUIZ CAROLINO PEREIRA_v1.pdf`
- `INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf`
- `INFOVIAS_PJC INTERNET_Palhoça_RUA VALMOR FRANCISCO_v1.pdf`

### v1.1 research — pitfalls & build order
- `.planning/research/PITFALLS.md` — Pitfall 2 (Siriu regression), Pitfall 7
  (compensated-error gate trap — gate audit mandatory), Pitfall 10 (phantom
  edges in solver input).
- `.planning/research/SUMMARY.md` — gate audit + prerequisite ordering.

### Prior quick-task evidence (LC layer-B / dual position gates)
- `.planning/quick/260603-n4k-debug-lc-post-symbol-assignment-collapse/260603-n4k-MILESTONE-SCOPE.md` —
  per-post position gate rationale; four reverted LC fixes that regressed Siriu.
- `.planning/quick/260602-decouple-graph-walker-phantom-edges/260602-decouple-SUMMARY.md` —
  forbidden phantom arm pairs per route.
- `.planning/quick/260603-acc-luizcarolino-joaoborn-route-accuracy/260603-acc-RESEARCH-cablefork.md` —
  junction research (JB bifurcation note **superseded** by D-14 user declaration).

### Existing fixtures & gates to extend (NOT rewrite)
- `parser/__tests__/fixtures/siriu-post-positions-truth.json` +
  `tools/run-siriu-post-position-gate.mjs` — Siriu characterization lock.
- `parser/__tests__/fixtures/luizcarolino-post-positions-truth.json` +
  `tools/run-lc-post-position-gate.mjs` — LC hand anchors (must green).
- `parser/__tests__/fixtures/siriu-junction-ground-truth.json` +
  `parser/__tests__/branch-traversal.test.mjs` — junction GT pattern to clone.
- `tools/run-route-joaoborn-pdf-accuracy-gate.mjs`,
  `tools/run-valmor-accuracy-gate.mjs`, `tools/run-siriu-regression-gate.mjs`,
  `tools/run-residual-gate.mjs` — existing harness patterns.
- `package.json` §scripts.`test:gate` — CI entry point to extend (D-17).

### Phase 5–6 upstream (cascade + residual baseline)
- `.planning/phases/05-truth-free-residual-gate/05-CONTEXT.md` — pure-judge
  residual gate; tier labels never numeric %.
- `.planning/phases/06-dxf-ingestion-region-lookup/06-CONTEXT.md` — DXF
  ingestion must be stable before fixture generation (Phase 7 depends on P6).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`tools/import-ground-truth-txt.mjs`** (new) — parse user `.txt` format
  (`Poste NN; lat, lon;`) into JSON fixtures; skip blanks.
- **Post-position gate pattern** — `run-siriu-post-position-gate.mjs` /
  `run-lc-post-position-gate.mjs`: parse PDF → compare `post.x/post.y` vs truth.
- **Junction GT pattern** — `siriu-junction-ground-truth.json` +
  `branch-traversal.test.mjs`: clone per route with `forbiddenArms`.
- **Accuracy harness** — `tools/route-pdf-accuracy-harness.mjs` + per-route
  gate scripts; extend to txt-synced truth + tier reporting.
- **Layer B target** — `parser/post-positioning.js` (`assignPolesGloballyByLabels`)
  for LC fix scope (D-09..D-11).

### Established Patterns
- **Strangler-fig / additive** — extend gates and fixtures; do not rewrite
  graph-walker or distance-associator thresholds for LC fix (Pitfall 2).
- **Dual measurement** — PDF position gates catch layer-B regressions; txt GPS
  gates catch final accuracy; both required (D-04).
- **All-green checkpoint discipline** — Phase 7 LC fix must keep full suite green
  at every commit (D-11); differs from Phase 8 mid-flight relaxations (D-18).

### Integration Points
- `npm run test:gate` — single CI command after D-17 wiring.
- `07-GATE-AUDIT.md` — referenced by Phase 8 planner for mid-flight policy.
- Junction fixtures feed Phase 8 solver input graph validation (filter phantom
  edges before Hungarian assignment).

</code_context>

<specifics>
## Specific Ideas

- User's `.txt` files represent **real-world GPS surveyed coordinates** — the
  accuracy authority for validating that the generalized algorithm works on the
  four reference routes before trusting it on new projects without ground truth.
- Siriu txt: 93 lines, 85 `Poste` entries, 8 empty lines — import must not
  treat blank lines as posts.
- Valmor PDF exists in repo root despite prior docs calling Valmor "DWG-only."
- João Born: user declares **no bifurcations** — junction fixture is explicitly
  non-branching.
- Accuracy tier vocabulary: perfect ≤5 m, good ≤10 m, acceptable ≤15 m, bad >15 m.

</specifics>

<deferred>
## Deferred Ideas

- **Global PDF↔DXF solver (Hungarian level-0)** → Phase 8.
- **KMZ/UI tier surfacing + Portuguese failure messages** → Phase 9.
- **Algorithm working on new projects without ground truth** → Phase 8 solver +
  Phase 5 truth-free residual gate (Phase 7 only locks the four reference routes).
- **Multi-zone CRS auto-detection** → MZONE-01 backlog.

</deferred>

---

*Phase: 07-solver-prerequisites*
*Context gathered: 2026-06-06*
