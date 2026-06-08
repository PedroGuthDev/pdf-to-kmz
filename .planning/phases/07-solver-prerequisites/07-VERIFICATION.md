---
phase: 07-solver-prerequisites
verified: 2026-06-08T16:22:01Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
re_verification: # none — initial verification
---

# Phase 7: Solver Prerequisites Verification Report

**Phase Goal:** Every input graph, fixture, and gate required to build and validate the global solver is confirmed green before a single line of solver code is written — so no correct solver fix can be blocked by compensated-error gates or phantom-edge-poisoned input graphs.
**Verified:** 2026-06-08T16:22:01Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria SC-1..4)

| # | Truth | Status | Evidence |
| - | ----- | ------ | -------- |
| 1 | Per-post position fixtures exist and pass for all four routes (Siriu, LC, JB, Valmor) — `run-*-post-position-gate.mjs` exits 0 | VERIFIED | Ran all four gates live: Siriu 85/85 max 0.00 pt (exit 0), LC 20/20 mean 0.4 pt (exit 0), JB 34/34 mean 0.4 pt (exit 0), Valmor 11/11 mean 0.4 pt (exit 0) |
| 2 | Junction ground-truth fixture assertion passes for all named routes; no phantom degree>=3 junctions in label graph | VERIFIED | `node --test` over 4 branch-traversal tests = 21 tests pass / 0 fail. D-15.2 inferred-degree>=3 oracle present in all 3 clones. JB junctions={} (D-14 linear), LC junction post 7 with forbiddenArms, all edges source-tagged |
| 3 | Every active gate classified regression-fence vs accuracy-assertion in a written audit, fence gates annotated for Phase 8 | VERIFIED | `07-GATE-AUDIT.md` (143 lines) contains FENCE/ASSERTION classifications, red-line annotations, soft-fence mid-flight policy (D-18), and Pitfall-7 rationale for all 4 position gates + residual + junction gates |
| 4 | Baseline cascade on all four routes completes with Phase 5 residual gate active and no solver code present | VERIFIED | `07-BASELINE-CASCADE.md` (110 lines) records all 4 routes + tier histograms + residual decisions + "no solver". `munkres-js` confirmed ABSENT from package.json. Umbrella run shows `lc-mustfail(21-31): decision=fail` — Phase 5 must-fail fixture intact |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `tools/import-ground-truth-txt.mjs` | txt→JSON importer w/ outlier exclusion | VERIFIED | Regenerated Siriu=85 (8 blanks skipped), JB=34 (post-35 Siriu-coord outlier excluded) |
| `parser/__tests__/fixtures/{siriu,lc,jb,valmor}-ground-truth.json` | GPS truth fixtures | VERIFIED | 85 / 31 / 34 / 11 posts; JB has no post 35 |
| `tools/run-joaoborn-post-position-gate.mjs` + fixture | JB layer-B gate, 34 posts | VERIFIED | Exits 0, 34/34; fixture _meta.tolerancePt=50, human-approved |
| `tools/run-valmor-post-position-gate.mjs` + fixture | Valmor layer-B gate, 11 posts | VERIFIED | Exits 0, 11/11; D-06 parse-viability proven (not exempted), human-approved |
| 3 junction fixtures + 3 DFS-oracle tests | LC/JB/Valmor junction GT | VERIFIED | JB linear (junctions={}), LC post-7 junction w/ forbiddenArms, Valmor linear; Siriu-specific test blocks dropped, D-15.2 block added |
| `tools/lib/accuracy-tiers.mjs` + 4 txt-accuracy gates | Four-tier classifier + gates | VERIFIED | tierOf/histogram/badPosts exported; tiers perfect≤5/good≤10/acceptable≤15/bad>15 (D-03); LC excludes posts 21-31 per _meta.scope |
| `parser/post-positioning.js` LC fix | Additive collapse-restore predicate | VERIFIED | `restoreSharedSymbolCollapsedPosts` (line 164, exported) wired as final pass in `assignPolesGloballyByLabels` (line 2047). LC greened, Siriu byte-identical (0.00 pt) — no Siriu constant edited |
| `07-GATE-AUDIT.md` | fence-vs-accuracy + D-18 | VERIFIED | 143 lines, all gates classified |
| `07-BASELINE-CASCADE.md` | 4-route pre-solver baseline | VERIFIED | 110 lines, all routes + no-solver note |
| `package.json` test:gate | full umbrella, single green command | VERIFIED | Chains 4 position + 4 txt-accuracy + 4 junction + JB-PDF + Valmor-accuracy + Siriu-regression + residual + DXF gates via test:gate:fixtures sub-script |

### Key Link Verification

| From | To | Via | Status |
| ---- | -- | --- | ------ |
| import-ground-truth-txt.mjs | *-ground-truth.json | writeFileSync flat array | VERIFIED |
| package.json test:gate | run-siriu/lc/jb/valmor-post-position-gate | &&-chained node invocations | VERIFIED |
| post-positioning.js predicate | run-lc-post-position-gate | corrected x/y within tolerance | VERIFIED (LC 20/20 green) |
| LC fix | run-siriu-post-position-gate | Siriu byte-identical placement | VERIFIED (85/85 max 0.00 pt) |
| branch-traversal-*.test.mjs | *-junction-ground-truth.json | fixture path + forbiddenArms assertions | VERIFIED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Four position gates exit 0 | `node tools/run-{siriu,lc,joaoborn,valmor}-post-position-gate.mjs` | 85/85, 20/20, 34/34, 11/11 all exit 0 | PASS |
| Junction oracles pass | `node --test parser/__tests__/branch-traversal*.test.mjs` | 21 pass / 0 fail | PASS |
| Full umbrella green | `npm run test:gate` | EXIT 0 (all 17 gates) | PASS |
| No solver code present | `node -e munkres-js dep check` | ABSENT | PASS |
| Phase 5 must-fail intact | umbrella residual gate output | `lc-mustfail(21-31): decision=fail` | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| SOLVE-05 | 07-01..07-07 | Per-post position fixtures green (Siriu/LC/JB/Valmor); junction GT green; every gate audited fence-vs-accuracy | SATISFIED | All four position gates exit 0; 4 junction oracles pass; 07-GATE-AUDIT.md classifies every gate; single green test:gate umbrella |

No orphaned requirements: REQUIREMENTS.md maps only SOLVE-05 to Phase 7, and every plan declares `requirements: [SOLVE-05]`.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | No TBD/FIXME/XXX debt markers in modified production code or gate scripts | ℹ Info | None |

The LC + JB txt-accuracy gates report bad-tier posts as explicitly-labeled **soft fences** ("deferred to Phase 8", exit 0). This is the intentional, documented 07-06 `layerb-only` user decision (posts 21-31 ~179 m rigid offset is a Phase 8 solver target, kept as the Phase 5 must-fail fixture), classified as a soft mid-flight fence in 07-GATE-AUDIT.md per D-18. Not a stub or hidden failure.

The `run-dxf-ingest-timing-gate.mjs` may print "FAILED: Nms > 5000ms" on a slow run but exits 0 (perf budget warning, non-blocking) — confirmed exit 0 in isolation and within the umbrella.

### Deferred Items (out-of-scope, not Phase 7 gaps)

Three pre-existing unit-test failures in `parser/__tests__/post-positioning.test.mjs` (Valmor p4 greedy/Viterbi symbol-distance assertions) exist on the pristine `main` baseline (c5c0755) **before** any Phase 7 change. They are NOT wired into `npm run test:gate` (the wired Valmor gates pass green), are logged in `deferred-items.md`, and do not affect any Phase 7 success criterion.

### Human Verification Required

None. All four blocking human-verify checkpoints (07-02-T2 JB anchors, 07-03-T2 Valmor anchors, 07-04-T3 LC/Valmor junctions, 07-06-T1 LC scope decision) were resolved during execution with user approvals recorded in the respective SUMMARYs (e.g. JB post-4 anchor confirmed in Portuguese; LC junction post 7 USER-APPROVED; layerb-only scope user-resolved). All claimed-green gates were re-run live by the verifier and independently confirmed green.

### Gaps Summary

No gaps. Every ROADMAP success criterion (SC-1..4) was independently verified by running the actual gates against the real route PDFs, DXFs, and txt GPS files present in the checkout — not by trusting SUMMARY claims:

- **SC-1:** all four per-post position gates exit 0 (Siriu byte-identical at 0.00 pt proves the LC layer-B fix caused zero Pitfall-2 regression).
- **SC-2:** 21 junction-oracle assertions pass; phantom-edge forbiddenArms asserted absent; D-15.2 inferred-degree>=3 rule encoded in every clone.
- **SC-3:** 07-GATE-AUDIT.md classifies every active gate fence-vs-accuracy with the D-18 Phase 8 mid-flight policy and Pitfall-7 rationale.
- **SC-4:** the full 4-route cascade runs green with the Phase 5 residual gate active and the LC 21-31 must-fail fixture intact; `munkres-js` and all solver code confirmed absent.

The phase goal — every input graph, fixture, and gate confirmed green before solver code is written, with compensated-error gates classified (soft fences) and phantom edges asserted absent — is achieved.

---

_Verified: 2026-06-08T16:22:01Z_
_Verifier: Claude (gsd-verifier)_
