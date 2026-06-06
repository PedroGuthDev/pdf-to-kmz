# Phase 7: Solver Prerequisites - Research

**Researched:** 2026-06-06
**Domain:** Test-fixture engineering, regression-gate architecture, ground-truth synchronization (Node test harnesses, no production-code surface beyond the LC layer-B fix)
**Confidence:** HIGH — every claim is grounded in the repo's own gate scripts, fixtures, and quick-task evidence (all read directly this session).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** The four repo-root `.txt` files are the single canonical GPS ground-truth source (Siriu 85 posts / ~93 lines with 8 blanks; LC; João Born; Valmor 11 posts).
- **D-02:** Add `tools/import-ground-truth-txt.mjs` to parse `Poste NN; lat, lon;` → write/update `parser/__tests__/fixtures/*-ground-truth.json`. Gates read JSON (imported from txt), not txt at runtime.
- **D-03:** Four accuracy tiers vs txt truth (all routes): Perfect ≤5 m, Good ≤10 m, Acceptable ≤15 m, **Bad >15 m**. Phase 7 exit requires **zero bad-tier posts** via the full cascade. Exact CI aggregate rule = planner discretion (floor: zero bad-tier).
- **D-04:** Full stack — txt GPS accuracy gates **AND** per-post PDF position gates are both deliverables (not either/or).
- **D-05:** João Born — LC-style hand-known PDF pole anchors (not a characterization snapshot); fixture covers **all posts**. New gate `tools/run-joaoborn-post-position-gate.mjs`.
- **D-06:** Valmor — has PDF sheet `INFOVIAS_PJC INTERNET_Palhoça_RUA VALMOR FRANCISCO_v1.pdf`. Build full PDF position fixture + gate (same pattern). NOT DWG-only-exempt.
- **D-07:** Siriu — keep existing characterization lock (`siriu-post-positions-truth.json` + `run-siriu-post-position-gate.mjs`).
- **D-08:** LC — keep hand-known anchor truth for posts 1–20; extend/fix per D-09/D-10.
- **D-09:** LC position gate **must GREEN** before Phase 8 — fixing layer-B placement is in scope for Phase 7.
- **D-10:** LC fix scope = **all posts** that (a) fail the LC position gate OR (b) exceed 15 m vs txt GPS (bad tier). Not limited to 9/10/11.
- **D-11:** Mid-flight during Phase 7 LC fix: **ALL gates stay green at every checkpoint** — no intentional RED mid-flight. Incremental fixes must not regress Siriu/JB/Valmor/junction/any gate.
- **D-12:** Build `{siriu,luizcarolino,joaoborn,valmor}-junction-ground-truth.json` + test assertions for all four routes.
- **D-13:** Junction lists are **manually curated** — user declares authoritative junction posts + arm topology per route during execution.
- **D-14:** **João Born — locked: no bifurcations.** Junction fixture is linear/no-junction (overrides prior post-13 bifurcation research note).
- **D-15:** Phantom-edge checks use both: (1) per-route `forbiddenArms` from 260602-decouple pairs; (2) global rule — no degree≥3 junction may arise from inferred-label edges alone.
- **D-16:** Gate audit doc `.planning/phases/07-solver-prerequisites/07-GATE-AUDIT.md` — every active gate classified regression fence vs accuracy assertion; fence gates annotated with Phase 8 mid-flight policy.
- **D-17:** At Phase 7 exit, wire ALL gates into `npm run test:gate` (four post-position gates, txt-accuracy gates, junction tests, existing Siriu/DWG/residual/DXF gates). Single command = full green bar.
- **D-18:** Phase 8 mid-flight policy (annotated in audit): **Hard red-lines** = per-post position gates, Siriu regression gate, junction GT assertions. **Soft mid-flight** (may go RED if audit-marked) = cumulative accuracy baselines / residual sub-score fences.

### Claude's Discretion

- Exact CI pass rule for tier aggregates (all posts ≤10 m vs allow acceptable tier with zero bad-tier).
- LC/Valmor/Siriu junction post lists — planner drafts from research + user spot-check; user must approve before locking fixtures (JB list is fixed: none).
- Import-script field mapping when txt post count ≠ route post count (Siriu 85).
- Order of Phase 7 plan waves (fixtures before LC fix vs parallel).
- Hand-known PDF anchor capture workflow for JB and Valmor position truths.

### Deferred Ideas (OUT OF SCOPE)

- Global PDF↔DXF solver (Hungarian level-0) → Phase 8.
- KMZ/UI tier surfacing + Portuguese failure messages → Phase 9.
- Algorithm on new projects without ground truth → Phase 8 solver + Phase 5 residual gate.
- Multi-zone CRS auto-detection → MZONE-01 backlog.
- Active cascade demotion on fail → Phase 8.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SOLVE-05 | Solver prerequisites satisfied + gated: per-post position fixtures green for Siriu, LC, **João Born, Valmor**; junction GT green; every gate audited fence-vs-accuracy. | This research inventories existing vs missing gates (§2), gives the LC green path without Siriu regression (§3), per-route junction topology (§4), fixture-clone patterns (§5), wave ordering with all-green discipline (§6), test:gate wiring (§7), and the Pitfall 2/7/10 risk map (§8). |
</phase_requirements>

## Summary

Phase 7 is **fixture- and gate-engineering**, not algorithm work — with one bounded production-code exception (the LC layer-B placement fix, D-09/D-10). The job: make the measurement scaffolding for the Phase 8 solver trustworthy *before* solver code exists, so a correct solver fix can never be blocked by a compensated-error fence (Pitfall 7) or a phantom-poisoned input graph (Pitfall 10), and a Siriu regression can never hide behind a cumulative ceiling (Pitfall 2).

The repo already contains every *pattern* this phase needs — they just need to be cloned to the missing routes. Position gates exist for Siriu (characterization snapshot, tol 1.0 pt) and LC (hand anchors, tol 50 pt, posts 1–20). A junction ground-truth fixture + DFS oracle exists for Siriu. Accuracy harnesses exist for the PDF path (`route-pdf-accuracy-harness.mjs`) and DWG path (`route-dwg-accuracy-harness.mjs`). The four `.txt` GPS files already match the existing `*-ground-truth.json` fixtures byte-for-byte where present (JB and Valmor verified this session), so D-02's import script formalizes an existing convention rather than introducing a new truth source.

**Primary recommendation:** Build in dependency order — (Wave 0) txt import script + sync ground-truth JSON + txt-accuracy gates; (Wave 1, parallel) JB/Valmor PDF position fixtures + gates, and the three missing junction GT fixtures; (Wave 2) the LC layer-B fix under all-green discipline (D-11); (Wave 3) gate audit doc + `test:gate` wiring + baseline cascade. Resolve the **João Born post-35 data anomaly** (txt post 35 carries Siriu coordinates, ~37 km off) before any txt-accuracy gate goes live — it will hard-fail the zero-bad-tier rule otherwise.

## Project Constraints (from .cursor/rules/)

No `.cursor/rules/` directory exists in the working tree (verified). The governing constraints are the v1.1 locked decisions in `STATE.md` (strangler-fig: solver = level-0, walker = fallback, byte-identical on Siriu; truth-free residual gate; DXF as accuracy authority, fail-loud-never-wrong; TIER labels never numeric %; single new dep `munkres-js@2.0.3` added *only* at Phase 8) plus this phase's D-01..D-18. Treat these with the same authority as `.cursor/rules/` directives. **Implication for P7:** no new runtime dependency may be added; everything reuses in-house modules and Node's built-in `node:test`.

## 2. Current Gate Inventory (exists vs missing)

### What exists today (verified by reading the files)

| Asset | Path | Kind | State |
|-------|------|------|-------|
| Siriu regression gate | `tools/run-siriu-regression-gate.mjs` | DWG walk regression fence | In `test:gate`, green |
| Residual gate | `tools/run-residual-gate.mjs` | Accuracy + decision lock | In `test:gate`, green |
| DXF ingest timing gate | `tools/run-dxf-ingest-timing-gate.mjs` | Perf fence (Phase 6) | In `test:gate` |
| Siriu post-position gate | `tools/run-siriu-post-position-gate.mjs` + `siriu-post-positions-truth.json` (85 posts, tol **1.0 pt**) | Characterization lock (layer B) | Green; **NOT in `test:gate`** |
| LC post-position gate | `tools/run-lc-post-position-gate.mjs` + `luizcarolino-post-positions-truth.json` (posts **1–20**, tol **50 pt**) | Hand-anchor accuracy (layer B) | **RED** for posts 9/10/11; not in `test:gate` |
| JB PDF accuracy gate | `tools/run-route-joaoborn-pdf-accuracy-gate.mjs` + `joaoborn-pdf-baseline.json` | Cumulative per-post ceiling fence | Green; not in `test:gate` |
| Valmor accuracy gate | `tools/run-valmor-accuracy-gate.mjs` + `valmor-accuracy-baseline.json` | DWG-region ceiling fence (mean ≤2.4 m, max ≤5 m) | Green; not in `test:gate` |
| Siriu junction GT | `siriu-junction-ground-truth.json` + `branch-traversal.test.mjs` (7 junctions: 5,14,36,48,60,62,70) | Topology/phantom oracle | Green; **NOT in `test:gate`** |
| PDF accuracy harness | `tools/route-pdf-accuracy-harness.mjs` | Reusable (parsePdf→calculateCoordinates→err) | — |
| DWG accuracy harness | `tools/route-dwg-accuracy-harness.mjs` | Reusable (DWG path, returns `dwgConfidence`) | — |
| Ground-truth JSON | `siriu/luizcarolino/joaoborn/valmor-ground-truth.json` | GPS truth (lat/lon by post) | Present; JB & Valmor byte-match their txt |

### What is missing (Phase 7 must build)

| Missing asset | Decision | Notes |
|---------------|----------|-------|
| `tools/import-ground-truth-txt.mjs` | D-02 | Parse `Poste NN; lat, lon;`, skip blanks, write `*-ground-truth.json`. Must handle case-insensitive `poste`/`Poste` and trailing `;` (Valmor txt has no trailing `;`, lowercase `poste`). |
| Per-route **txt-accuracy gates** (4 routes) | D-01/D-03 | Tier classifier (≤5/≤10/≤15/>15 m), zero-bad-tier exit rule. Run via full cascade. |
| `run-joaoborn-post-position-gate.mjs` + `joaoborn-post-positions-truth.json` | D-05 | Hand-known PDF pole anchors, all posts. |
| `run-valmor-post-position-gate.mjs` + `valmor-post-positions-truth.json` | D-06 | Hand-known PDF pole anchors, all 11 posts. **New: requires Valmor PDF parse path** (Valmor was previously DWG-only). |
| `luizcarolino-junction-ground-truth.json` | D-12/D-13 | User-curated. |
| `joaoborn-junction-ground-truth.json` | D-12/**D-14** | **Linear, zero junctions, empty `junctions: {}`.** |
| `valmor-junction-ground-truth.json` | D-12/D-13 | User-curated (Valmor is an 11-post near-linear DWG route — likely zero or few junctions; user confirms). |
| Junction tests for LC/JB/Valmor | D-12 | Clone `branch-traversal.test.mjs` per route. |
| `07-GATE-AUDIT.md` | D-16 | Classify every gate fence-vs-accuracy + Phase 8 mid-flight policy. |
| `test:gate` extension | D-17 | Add all of the above to the single command. |
| Baseline cascade run record | SC-4 | Full cascade on 4 routes, Phase 5 gate active, no solver code. |

## 3. LC Position Gate — Status & Fix Approach Without Siriu Regression

**Status:** `run-lc-post-position-gate.mjs` is the only RED gate. Its truth (`luizcarolino-post-positions-truth.json`) is **hand-known-correct anchors** (unlike Siriu's snapshot), covers **posts 1–20 only**, tolerance **50 pt**. Posts 9/10/11 currently collapse onto wrong/shared pole symbols (their parsed x,y diverges from the correct anchor). The `_meta.source` documents that 28/31 posts have `|xy − anchor| = 0`; the collapse is localized.

**Why this is the hard part (Pitfall 2 + 7):** the target is `assignPolesGloballyByLabels` in `parser/post-positioning.js:1554` (layer B). This is shared code Siriu depends on. Quick-task 260603-n4k proved **four consecutive layer-B fixes each greened LC while regressing 12–89 Siriu posts** — and the cumulative Siriu gate passed for two of them. The Siriu *position* gate (tol 1.0 pt) is the only instrument that catches this, and it is currently NOT in `test:gate`.

**Fix approach (recommended, evidence-based):**

1. **Make the Siriu position gate (1.0 pt) a hard pre-condition of every LC commit.** Wire it into the test loop *before* starting the LC fix (Wave 0/1), not at the end. It is green at baseline and goes red the instant any Siriu post moves >1 pt.
2. **Additive predicates, never threshold edits (Pitfall 9 / tech-debt table).** Every constant in `post-positioning.js` and `distance-associator.js` is Siriu-calibrated. The fix must add a *predicate* that recognizes the LC collapse condition (shared-symbol assignment) without altering any path Siriu exercises. The 260601-k1a quick task established the "generic predicate, not literal guard" pattern.
3. **Scope per D-10:** all LC posts that fail the position gate OR exceed 15 m vs txt GPS. Posts 1–20 are covered by the position fixture; **posts 21–31 are a separate ~179 m rigid-offset** (the Phase 5 LC must-fail fixture). D-10 says fix everything in the bad tier — but the 21–31 rigid offset is an *absolute-position*/solver problem, not a layer-B placement bug. **Open question for planner (§9):** confirm whether 21–31 is in P7 LC-fix scope or is the explicit job of the Phase 8 solver (the Phase 5 residual gate already locks it as a must-fail). The position-fixture truth deliberately excludes 21–31 (`_meta.scope`).
4. **Extend the LC position truth** to cover the posts named in D-10's scope (currently only 1–20), with hand-known anchors. Keep tol at 50 pt unless the user tightens it.
5. **All-green discipline (D-11):** after each incremental change, run the full suite (Siriu pos + LC pos + JB + Valmor + junction + regression + residual). No commit may leave any gate red. This is stricter than Phase 8's D-18 policy.

**Anti-pattern to avoid:** re-seeding the Siriu position baseline (`SIRIU_POST_POS_UPDATE_BASELINE=1`) to "make it pass" after an LC change. That re-snapshots the regression away. Re-seed ONLY after a gate-green, intended Siriu improvement.

## 4. Junction Topology Per Route

The Siriu junction GT is the canonical pattern. It encodes: `junctions{}` (post, degree, slots, `forbiddenArms[]`, `arms[]` with meters/inbound/crossPage), a flat `edges[]` list (directed `from→to`, `arm`, `junction`, `inbound`, `crossPage`), and `armMetersChecks`. The DFS oracle (`branch-traversal.test.mjs`) asserts: every post visited once, each junction exposes degree−1 arms, GT arm meters reproduced, **no forbidden phantom arm is incident**, and inbound direction is correct. `walkBranchGraph` from `parser/branch-traversal.mjs` is the consumer.

| Route | Junctions (degree≥3) | Source / status | forbiddenArms (phantoms) |
|-------|----------------------|-----------------|---------------------------|
| **Siriu** | 5, 14, 36(deg4), 48, 60, 62, 70 | **Locked** (`siriu-junction-ground-truth.json`, from 260602-lbl HANDOFF) | 36→39, 48→51 (+ meters check 48→49=8.4) |
| **João Born** | **NONE — linear** | **Locked by D-14.** Fixture `junctions: {}`, `edges` = consecutive chain only. Overrides the old post-13 bifurcation note. | n/a (no junctions ⇒ global rule §D-15.2 still asserted: no inferred degree≥3) |
| **Luiz Carolino** | User-curated (D-13) | **Draft from 260602-decouple phantom pairs**, user must approve before lock. Phantom edges observed: `3→1`, `11→8`, `9→11` (Pitfall 10). LC has a real branch around posts 9–11 / the 21–31 spur. | populate `forbiddenArms` from decouple pairs `3→1`, `11→8`, `9→11` |
| **Valmor** | Likely NONE or 1 (11-post near-linear DWG route) | User-curated (D-13). Coordinates are monotone along one street → probably linear. | confirm with user |

**Critical phantom-edge facts (Pitfall 10, the reason junction GT exists):** the distance-associator's `inferDistanceEdgesFromLabels` emits non-consecutive phantom edges as a byproduct. The 260602-decouple task decoupled the walker from four load-bearing phantom pairs per route. Phase 7's job is to **prove** those phantoms stay absent via the `forbiddenArms` oracle on every route, AND assert D-15's global rule: no degree≥3 junction may arise from `inferred-label`-sourced edges alone (only `bifurcation-main`/`branch-arm-rehomed`/`override`-tagged edges may seed a junction). For JB and Valmor (linear), the assertion is simply "zero junctions, and none appear from inference."

**JB caveat:** if the txt/PDF post 35 anomaly (see §8) is treated as a real post, it could create a phantom long-span edge 34→35. The JB junction GT (zero junctions) plus the global no-inferred-junction rule will catch this — another reason to resolve post 35 first.

## 5. Fixture Patterns to Clone

### Position gate (PDF layer B) — two sub-patterns

- **Characterization snapshot (Siriu, D-07):** truth = the parser's own accepted `post.x/post.y` from a pristine parse; starts at zero error; tol tiny (1.0 pt). Use when the route legitimately places posts off-anchor (junctions). Seeded via `SIRIU_POST_POS_UPDATE_BASELINE=1`.
- **Hand-known anchors (LC/JB/Valmor, D-05/D-06/D-08):** truth = manually captured correct pole positions; tol loose (50 pt) to tolerate capture imprecision; gate is RED until placement is correct. This is the pattern to clone for JB and Valmor. Capture workflow (planner to detail): parse the route PDF once, dump per-post `anchorX/anchorY` + `x/y`, hand-verify against the PDF sheet, write `{number,pageNum,x,y}` rows.

```js
// Clone of run-lc-post-position-gate.mjs, swap PDF_PATH + TRUTH_PATH:
const err = Math.hypot((p.x ?? NaN) - t.x, (p.y ?? NaN) - t.y);
if (err > tolPt) failures.push(`post ${t.number}: ${err.toFixed(1)} pt > tol ${tolPt} pt`);
// exit(1) on any failure
```

### Junction GT — clone `siriu-junction-ground-truth.json` + `branch-traversal.test.mjs`

Each new route file mirrors the Siriu schema. The test file is parameterizable: extract `buildGraph(fixture)` + the five `test(...)` blocks into a shared helper, then instantiate per route, OR copy the test file per route (simpler, matches repo's current per-route-script convention). For **JB (zero junctions)**, the "visits every post once" + "no junction" + "no inferred degree≥3" assertions still apply against an `edges`-only chain.

### txt import + accuracy gate

```js
// import-ground-truth-txt.mjs core (D-02)
const m = line.match(/poste\s+(\d+)\s*;\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/i);
if (!m) continue;                       // skips blank/garbage lines
out.push({ number: +m[1], lat: +m[2], lon: +m[3] });
```

The txt-accuracy gate runs the **full cascade** (DWG path via `route-dwg-accuracy-harness.mjs`, which returns per-post lat/lon + `dwgConfidence`), compares each post to txt truth with `haversineMeters`, classifies into tiers, and exits non-zero if any post is bad-tier (>15 m). Reuse `runRouteDwgAccuracyHarness({pdfPath, dwgRegionPath, groundTruthPath, regionId})`.

## 6. Recommended Plan Wave Ordering

Ordering is planner discretion (D-25... D-11/CONTEXT); this is the evidence-backed recommendation honoring the all-green discipline:

- **Wave 0 — Truth foundation (sequential, blocks everything):**
  1. `import-ground-truth-txt.mjs` (D-02) + run it to (re)generate all four `*-ground-truth.json`. **Resolve JB post-35 anomaly here** (§8/§9).
  2. **Wire the existing Siriu position gate (1.0 pt) + Siriu/LC/JB/Valmor junction tests into the local test loop now** so all later waves inherit the regression net (formal `test:gate` wiring is Wave 3 per D-17, but the instruments must be live during the LC fix).

- **Wave 1 — Fixtures (parallel, additive, no shared-code risk):**
  - JB PDF position fixture + `run-joaoborn-post-position-gate.mjs` (D-05).
  - Valmor PDF position fixture + `run-valmor-post-position-gate.mjs` (D-06) — *new Valmor PDF parse path*.
  - LC / JB(empty) / Valmor junction GT fixtures + tests (D-12/D-14).
  - Per-route txt-accuracy gates (D-03).
  - These are purely additive (new files); they cannot regress Siriu, so they precede the LC fix.

- **Wave 2 — LC layer-B fix (sequential, all-green discipline D-11):**
  - The ONLY production-code change. Additive predicate in `assignPolesGloballyByLabels`. After every commit, the full suite (now including Siriu pos gate + all junction tests from Wave 0/1) must be green. See §3.

- **Wave 3 — Audit + wiring + baseline (sequential):**
  - `07-GATE-AUDIT.md` (D-16) classifying every gate fence-vs-accuracy + D-18 Phase 8 policy.
  - Extend `npm run test:gate` to include all gates (D-17).
  - Record the baseline cascade run on all four routes with Phase 5 gate active, no solver code (SC-4).

**All-green checkpoint discipline (D-11):** every wave/commit ends with a full-suite green bar. The only intentionally-RED state allowed is the LC position gate *before* Wave 2 completes — and even that is gated: it must not be added to `test:gate` (D-17) until it greens, otherwise the single command can't be green. Sequence the LC green *before* the D-17 wiring.

## 7. test:gate Extension Strategy

Current `test:gate` (from `package.json`):

```bash
node --test parser/__tests__/graph-walker.test.mjs parser/__tests__/distance-associator.test.mjs parser/__tests__/coordinate-calculator.test.mjs \
  && node tools/run-siriu-regression-gate.mjs \
  && node tools/run-residual-gate.mjs \
  && node tools/run-dxf-ingest-timing-gate.mjs
```

**Target (D-17)** — add (chained with `&&` so any failure exits non-zero):

- `parser/__tests__/branch-traversal.test.mjs` and the three new per-route junction tests → fold into the leading `node --test ...` arg list.
- `tools/run-siriu-post-position-gate.mjs`
- `tools/run-lc-post-position-gate.mjs` (only after it greens — Wave 2)
- `tools/run-joaoborn-post-position-gate.mjs`, `tools/run-valmor-post-position-gate.mjs`
- `tools/run-route-joaoborn-pdf-accuracy-gate.mjs`, `tools/run-valmor-accuracy-gate.mjs`
- the four new txt-accuracy gates.

**Strategy notes:**
- Group all `node:test` files into one `node --test <files…>` invocation (faster, single runner) and the standalone `.mjs` gate scripts as separate `&&`-chained steps (each `process.exit(1)`s on failure — matches existing convention).
- Consider a small `npm run test:gate:fixtures` sub-script if the single line gets unwieldy; keep `test:gate` as the umbrella so "single command = full green bar" (D-17) holds.
- Position gates need `fake-indexeddb/auto` (already imported in the gate scripts) and parse real PDFs from repo root — runtime is a few seconds each; acceptable in CI.

## 8. Risks / Pitfalls

### Pitfall 2 — Siriu regression through shared subsystems (PRIMARY RISK)
The LC layer-B fix (Wave 2) touches `assignPolesGloballyByLabels`, which Siriu depends on. Four prior fixes each regressed 12–89 Siriu posts while greening LC; the cumulative gate missed two of them. **Mitigation:** the 1.0-pt Siriu position gate must be live and green at *every* LC checkpoint (wire it in Wave 0, not Wave 3). Additive predicates only — never edit Siriu-calibrated constants. Strangler-fig contract: walker output must stay byte-identical on Siriu.

### Pitfall 7 — Compensated-error / fence gates blocking correct fixes (THE REASON THIS PHASE EXISTS)
Cumulative ceiling gates (JB PDF baseline, Valmor accuracy baseline, residual decision baseline) encode current output, including compensated errors. A correct LC fix can make a fence go red because a cross-layer compensation it depended on is gone. **Mitigation:** the `07-GATE-AUDIT.md` (D-16) must classify each gate. Per D-18, fence gates (JB/LC PDF baselines, residual sub-score fences) are "soft — may go RED mid-flight during Phase 8"; the per-post **position** gates + Siriu regression + junction GT are hard red-lines. Position gates measure each layer independently and are immune to cross-layer masking — that is why they, not the cumulative gates, are the mid-flight acceptance criterion.

### Pitfall 10 — Phantom edges flowing into the solver input
Phase 8 consumes the route label-graph; phantom non-consecutive edges (`3→1`, `11→8`, `9→11` in LC; `36→39`, `51→48` in Siriu) create spurious degree≥3 junctions that poison topology matching. **Mitigation:** every route's junction GT must assert (a) all `forbiddenArms` phantoms stay absent, and (b) D-15's global rule — no degree≥3 junction arises from `inferred-label` edges alone. JB/Valmor (linear) assert zero junctions. This must be green before Phase 8 begins.

### Data-quality landmine — João Born txt post 35 (resolve in Wave 0)
`coordenadas postes rua joao born.txt` line 35 is `Poste 35; -27.97368…, -48.63599…` — those are **Siriu** coordinates (~37 km from JB posts 1–34, which cluster at -27.64/-48.66). The existing `joaoborn-ground-truth.json` **already contains this bad post 35** (byte-matches the txt). Consequences:
- The txt-accuracy gate's zero-bad-tier rule (D-03) will hard-fail on post 35 (km-scale error).
- The JB junction GT (D-14, linear) may see an inferred long-span phantom 34→35.
- The JB route is almost certainly **34 posts**, not 35.
**Action for planner:** decide whether the import script drops post 35, flags it as a known-bad excluded row, or the user corrects the txt. Until resolved, JB cannot satisfy SC-1/SC-4. This is the single highest-priority open question.

### Secondary risks
- **Valmor PDF position gate is a new path (D-06).** Valmor was DWG-only; building a *PDF* position fixture means the Valmor PDF must parse cleanly through `parsePdf` and produce per-post x,y. Verify the PDF parses before committing to the fixture shape; if the PDF lacks usable pole symbols, escalate to the user (D-06 says do NOT treat it as exempt, so a parse failure is a real blocker to surface).
- **LC truth covers only posts 1–20.** D-10's scope (all bad-tier/failing posts) may require extending the fixture; capturing hand-anchors for 21–31 is non-trivial and entangled with the rigid-offset (see §3 open question).
- **Tier aggregate rule undefined (Claude's discretion).** Recommend: gate fails if any post is bad-tier (>15 m) — the D-03 floor — and additionally report the tier histogram per route for the audit, without making ≤10 m a hard requirement yet (Siriu's own DWG anchor gaps are 100s of metres per the residual gate, so a strict ≤10 m absolute rule would false-fail; tier the *cascade* lat/lon output, not the residual anchor gap).
- **`commit_docs: true`** — this RESEARCH.md should be committed (the orchestrator/planner handles per project convention).

## 9. Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js (`node --test`, ESM, `node:fs`) | All gates/tests | ✓ | v22.22.0 | — |
| `fake-indexeddb` | Position/cascade gates (`/auto` import) | ✓ (devDep ^6.2.5) | installed | — |
| Four route PDFs (Siriu/LC/JB/Valmor) | Position + cascade gates | ✓ | repo root | — |
| Four `.txt` GPS files | txt import (D-02) | ✓ | repo root | — |
| DWG region fixtures (4 routes) | Cascade/txt-accuracy gates | ✓ | `*-dwg-region.json` present | — |
| `munkres-js` | (Phase 8 only) | ✗ | — | N/A — must NOT be added in P7 |

No missing dependency blocks Phase 7. All work uses in-repo assets + Node built-ins.

## Open Questions

1. **João Born post-35 anomaly (HIGHEST PRIORITY).** Drop it in the import script, flag-and-exclude, or have the user fix the txt? JB route is 34 posts; post 35 carries Siriu coordinates. Blocks the txt-accuracy gate and JB SC-1. → Recommend: import script flags + excludes rows whose coordinates fall outside the route's own bounding cluster (or the user trims the txt), and JB ground-truth is regenerated to 34 posts.
2. **LC posts 21–31 scope.** Is the ~179 m rigid offset in P7 LC-fix scope (D-10 "all bad-tier") or explicitly deferred to the Phase 8 solver (it is already the Phase 5 must-fail fixture)? The position-fixture excludes 21–31 by design. → Recommend: P7 fixes layer-B placement (posts 1–20 collapse); the 21–31 rigid offset stays a Phase 8 solver target, with the residual gate continuing to lock it as must-fail. User to confirm.
3. **Tier aggregate CI rule** (Claude's discretion, D-03): zero-bad-tier only, or stricter? → Recommend zero-bad-tier + report histogram (see §8).
4. **Junction post lists for LC and Valmor** (D-13): need user-authoritative declaration before locking. Planner drafts LC from 260602-decouple phantom pairs + the known 9–11 branch; Valmor likely linear. User spot-check required.
5. **Valmor PDF parse viability** (D-06): does `INFOVIAS_PJC INTERNET_Palhoça_RUA VALMOR FRANCISCO_v1.pdf` parse through `parsePdf` with usable per-post pole symbols? Must verify before designing the position fixture.

## Sources

### Primary (HIGH confidence — read directly this session)
- `tools/run-siriu-post-position-gate.mjs`, `run-lc-post-position-gate.mjs`, `run-siriu-regression-gate.mjs`, `run-residual-gate.mjs`, `run-route-joaoborn-pdf-accuracy-gate.mjs`, `run-valmor-accuracy-gate.mjs` — gate patterns, tolerances, baseline mechanics.
- `tools/route-pdf-accuracy-harness.mjs`, `route-dwg-accuracy-harness.mjs` — reusable harness APIs.
- `parser/__tests__/fixtures/siriu-junction-ground-truth.json` + `branch-traversal.test.mjs` — junction GT schema + DFS oracle assertions.
- `parser/__tests__/fixtures/luizcarolino-post-positions-truth.json`, `joaoborn-ground-truth.json`, `valmor-ground-truth.json` — fixture shapes; JB/Valmor txt↔JSON byte-match.
- The four `coordenadas postes *.txt` files — format, post counts, **JB post-35 anomaly**.
- `package.json` (`scripts.test:gate`), `.planning/config.json` (`nyquist_validation:false`, `commit_docs:true`), `.planning/REQUIREMENTS.md` (SOLVE-05), `.planning/ROADMAP.md` (SC-1..4), `.planning/STATE.md` (v1.1 locks, risk flags).
- `.planning/research/PITFALLS.md` — Pitfalls 2, 7, 9, 10; tech-debt + pitfall→phase mapping.
- `parser/post-positioning.js:1554` (`assignPolesGloballyByLabels`) — LC fix target location.

### Secondary (MEDIUM — referenced, not re-read this session)
- `260603-n4k-MILESTONE-SCOPE.md` (four-revert Siriu regression proof), `260602-decouple-SUMMARY.md` (forbidden phantom pairs), `260603-acc-RESEARCH-cablefork.md` (JB bifurcation note, superseded by D-14) — cited via CONTEXT.md canonical refs.

## Metadata

**Confidence breakdown:**
- Gate inventory & patterns: HIGH — read every gate/harness/fixture directly.
- LC fix approach: HIGH on the regression mechanism (proven 4×) and instrument; MEDIUM on exact predicate (depends on user-confirmed scope, Q2).
- Junction topology: HIGH for Siriu (locked) and JB (D-14 linear); MEDIUM for LC/Valmor (user must curate, D-13).
- Pitfalls: HIGH — grounded in this codebase's documented failures.

**Research date:** 2026-06-06
**Valid until:** ~2026-07-06 (stable — internal fixtures/gates, no fast-moving external deps).

## RESEARCH COMPLETE

**Phase:** 7 - Solver Prerequisites
**Confidence:** HIGH

### Key Findings
- All required *patterns* already exist in-repo (Siriu position snapshot, LC hand-anchor gate, Siriu junction GT + DFS oracle, PDF/DWG accuracy harnesses); Phase 7 clones them to JB/Valmor/LC and wires everything into one `test:gate`.
- The LC layer-B fix is the only production-code change and the primary Pitfall-2 risk; the 1.0-pt Siriu position gate must be live at every checkpoint (additive predicates only, never threshold edits).
- **João Born txt post 35 carries Siriu coordinates (~37 km off) and is already baked into `joaoborn-ground-truth.json`** — it will hard-fail the zero-bad-tier rule and must be resolved in Wave 0 before any txt-accuracy gate goes live.
- JB junction GT is locked linear (D-14, zero junctions); LC/Valmor junction lists need user curation (D-13). Phantom-edge oracle (`forbiddenArms` + global no-inferred-degree≥3 rule) is the Pitfall-10 defense.
- `nyquist_validation:false` → no Validation Architecture section required.

### File Created
`.planning/phases/07-solver-prerequisites/07-RESEARCH.md`

### Confidence Assessment
| Area | Level | Reason |
|------|-------|--------|
| Standard Stack / gate inventory | HIGH | Read every gate, harness, fixture directly |
| Architecture (wave ordering, fix path) | HIGH/MEDIUM | Mechanism proven; LC scope pending user (Q2) |
| Pitfalls | HIGH | Grounded in documented repo failures |

### Open Questions
JB post-35 handling (blocker); LC 21–31 scope; tier aggregate rule; LC/Valmor junction lists; Valmor PDF parse viability. See §Open Questions.

### Ready for Planning
Research complete. Planner can now create PLAN.md files.

