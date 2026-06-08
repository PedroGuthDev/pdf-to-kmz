---
phase: 07-solver-prerequisites
plan: 07
subsystem: gate-audit + CI wiring + baseline measurement
status: complete
completed: "2026-06-08"
tags: [gate-audit, test-gate-umbrella, baseline-cascade, phase-7-exit, d-16, d-17, d-18, sc-4]
requires: ["07-01", "07-02", "07-03", "07-04", "07-05", "07-06"]
provides: ["gate-audit-classification", "single-green-test-gate", "pre-solver-baseline-cascade", "phase-8-authorization"]
affects:
  - .planning/phases/07-solver-prerequisites/07-GATE-AUDIT.md
  - package.json
  - .planning/phases/07-solver-prerequisites/07-BASELINE-CASCADE.md
tech-stack:
  added: []
  patterns: ["fence-vs-accuracy gate classification (Pitfall 7)", "single-umbrella test:gate with test:gate:fixtures sub-script (D-17)", "pre-solver baseline-of-record (SC-4)"]
key-files:
  created:
    - .planning/phases/07-solver-prerequisites/07-GATE-AUDIT.md
    - .planning/phases/07-solver-prerequisites/07-BASELINE-CASCADE.md
  modified:
    - package.json
decisions:
  - "test:gate kept as single entry point; standalone gate scripts factored into a test:gate:fixtures sub-script invoked by test:gate (keeps the umbrella readable while honoring D-17 single-command)."
  - "Siriu regression gate classified hard red-line per D-18 explicit listing (it is a fence by mechanism, but D-18 designates it hard — the walker must stay byte-stable on Siriu as the strangler-fig fallback)."
  - "DXF ingest timing gate classified hard-ish perf budget (not an accuracy claim) — kept green, not a correctness signal."
requirements: [SOLVE-05]
commits:
  - e84c223  # docs(07-07-T1): author 07-GATE-AUDIT.md
  - d7c8de5  # feat(07-07-T2): wire all Phase 7 gates into test:gate
  - eca0d59  # docs(07-07-T3): record 4-route pre-solver baseline cascade
metrics:
  tasks: 3
  files-changed: 1
  files-created: 2
  duration: "~25 min"
---

# Phase 7 Plan 7: Gate Audit + test:gate Wiring + Baseline Cascade Summary

Phase 7 exit (the green gate authorizing Phase 8): authored `07-GATE-AUDIT.md`
classifying every active gate fence-vs-accuracy with the D-18 Phase 8 mid-flight
policy, wired ALL Phase 7 gates into one green `npm run test:gate` (17 gates,
exits 0), and recorded the 4-route pre-solver baseline cascade with the Phase 5
residual gate active and no `munkres-js`/solver code present (SC-4).

## Task 1 (07-07-T1) — 07-GATE-AUDIT.md

Authored `.planning/phases/07-solver-prerequisites/07-GATE-AUDIT.md` (143 lines).
Every active gate gets a table row: path · kind (regression FENCE vs accuracy
ASSERTION) · what it measures · Phase 8 mid-flight policy.

**Hard red-lines (D-18, must stay green at every Phase 8 checkpoint):**
- The four per-post position gates (`run-{siriu,lc,joaoborn,valmor}-post-position-gate.mjs`).
- The Siriu regression gate (`run-siriu-regression-gate.mjs`) — D-18 explicitly designates it hard.
- The four junction GT oracles (`branch-traversal{,-lc,-joaoborn,-valmor}.test.mjs`).
- Foundational unit suites (graph-walker, distance-associator, coordinate-calculator).

**Soft mid-flight fences (D-18, may go RED if a correct solver fix removes a compensated error):**
- `run-residual-gate.mjs` absolute-position anchor sub-score (LC 21–31 must-fail — solver expected to flip it).
- `run-route-joaoborn-pdf-accuracy-gate.mjs` cumulative ceiling; `run-valmor-accuracy-gate.mjs` ceiling.
- LC + JB txt-accuracy zero-bad-tier rules (soft fences — exit 0 today because 21–31 / bad-tier posts are scoped out per the 07-06 layerb-only decision).
- Siriu/Valmor txt-accuracy zero-bad-tier *exit rules* (cumulative ceilings; tier histograms remain informative).

Includes the **Pitfall-7 rationale** (why the per-post position gates, not the cumulative
ceilings, are the mid-flight acceptance criterion — they measure each layer independently and
are immune to cross-layer masking; cited the 260603-n4k 4-revert proof where the cumulative
Siriu gate missed two regressions the 1.0-pt position gate caught) and a Phase 8 re-baselining
protocol.

## Task 2 (07-07-T2) — single green test:gate (D-17)

Extended `package.json` `scripts.test:gate` to the full Phase 7 target set, exits **0**:

- **Leading `node --test` arg list** — folded in the three new junction tests
  (`branch-traversal-lc/joaoborn/valmor.test.mjs`) alongside the existing
  graph-walker / distance-associator / coordinate-calculator / branch-traversal(Siriu).
- **New `test:gate:fixtures` sub-script** (invoked by `test:gate` — keeps the single entry point
  while the line stays readable): the four position gates, the four txt-accuracy gates,
  `run-route-joaoborn-pdf-accuracy-gate.mjs`, `run-valmor-accuracy-gate.mjs`, plus the existing
  Siriu regression / residual / DXF timing gates.

Verified `npm run test:gate` runs all **17** gates and exits 0:

| Gate group | Result |
|------------|--------|
| 7 node:test suites (incl. 3 new junction tests) | PASS — 0 fail |
| `run-siriu-post-position-gate` (1.0 pt) | PASS — 85/85, max 0.00 pt |
| `run-lc-post-position-gate` | PASS — 20/20, mean 0.4 pt |
| `run-joaoborn-post-position-gate` | PASS — 34/34 |
| `run-valmor-post-position-gate` | PASS — 11/11 |
| `run-siriu-txt-accuracy-gate` | PASS — bad=0 |
| `run-lc-txt-accuracy-gate` | SOFT-FENCE PASS (exit 0) |
| `run-joaoborn-txt-accuracy-gate` | SOFT-FENCE PASS (exit 0) |
| `run-valmor-txt-accuracy-gate` | PASS — bad=0 |
| `run-route-joaoborn-pdf-accuracy-gate` | PASS — mean 27.01 m |
| `run-valmor-accuracy-gate` | PASS — mean 2.22 m |
| `run-siriu-regression-gate` | PASS — walkOk |
| `run-residual-gate` | PASS — lc-mustfail still fail |
| `run-dxf-ingest-timing-gate` | PASS — 2268 ms |
| **`npm run test:gate` umbrella** | **EXIT 0** |

## Task 3 (07-07-T3) — pre-solver baseline cascade (SC-4)

Authored `.planning/phases/07-solver-prerequisites/07-BASELINE-CASCADE.md` (110 lines) recording
the full DWG pairing cascade on all four routes with the Phase 5 residual gate active and
**no solver code present** (verified: `munkres-js` absent from package.json deps + devDeps; no
Hungarian/solver source in parser/ or tools/).

| Route | Posts | perfect/good/acceptable/bad | residual decision | anchorP95 |
|-------|-------|------------------------------|-------------------|-----------|
| Siriu | 85 | 65/17/3/0 | fail | 188.0 m |
| Luiz Carolino | 31 | 14/0/0/17 | fail | 332.5 m |
| João Born | 34 | 3/0/2/29 | fail | 586.7 m |
| Valmor | 11 | 11/0/0/0 | fallback | 16.6 m |

Documented the known LC pre-solver baseline (posts 21–31 ~179 m rigid offset + 13–20 spur stay
bad-tier per the 07-06 layerb-only decision; `lc-mustfail(21-31)` locked `decision=fail`) and
what Phase 8 is expected to change (flip the soft fences; never regress the hard red-lines).

## Deviations from Plan

### None to the plan's approach.

All three tasks executed as written. Two environment notes (recurring worktree pattern, same as
07-06, all gitignored — nothing committed):

- **[Env] Worktree spawned from a stale base** (HEAD `88ec149`, 20 commits behind `main`, 0
  ahead — the phase-07 PLAN/RESEARCH/CONTEXT did not exist in the worktree tree). Resolved with a
  clean `git merge --ff-only main` (merge-base == HEAD, no divergence, nothing to lose; HEAD on
  `worktree-agent-*`, not a protected ref). This brought the actual phase-07 state into the
  worktree so the plan could be executed against it.

- **[Env] Gitignored runtime assets absent in worktree.** `node_modules`, the four route PDFs,
  and `Palhoca.dxf` are gitignored and not present in a fresh worktree. Junction-linked
  `node_modules` from the main checkout (PowerShell `New-Item -ItemType Junction`) and copied the
  PDFs + `Palhoca.dxf` so the gates could run. The tracked `*-dwg-region.json` fixtures and the
  `.txt` GPS files were already present. None of these are committed (all gitignored; `git status`
  clean throughout).

## Known Stubs

None. All three artifacts are substantive and verified (audit classifies every gate, umbrella
exits 0 with all 17 gates, baseline records all four routes). The deferred LC 21–31 / JB bad-tier
posts are documented as the intended pre-solver baseline (Phase 8 solver targets), not stubs.

## Threat Flags

None. This plan adds only planning documents and a package.json script change (CI wiring of
existing gates). No new network endpoints, auth paths, file-access patterns, or trust-boundary
schema changes were introduced.

## Self-Check: PASSED

- Files exist:
  - `.planning/phases/07-solver-prerequisites/07-GATE-AUDIT.md` — FOUND (created, 143 lines)
  - `.planning/phases/07-solver-prerequisites/07-BASELINE-CASCADE.md` — FOUND (created, 110 lines)
  - `package.json` — FOUND (modified: test:gate + test:gate:fixtures)
- Commits exist: e84c223, d7c8de5, eca0d59 — all FOUND in `git log`.
- `npm run test:gate` exits 0 with all 17 Phase 7 gates (verified this session).
