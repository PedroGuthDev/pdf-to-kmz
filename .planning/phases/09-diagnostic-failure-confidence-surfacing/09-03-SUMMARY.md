---
phase: 09-diagnostic-failure-confidence-surfacing
plan: 03
subsystem: ui

tags: [confidence-banner, hard-block, kmz, tier-surfacing, browser-ui, dom, conf-04]

# Dependency graph
requires:
  - phase: 09-01
    provides: result.dwgConfidence.overall, result.hardBlock, result.dwgNoRegion, postTiers
  - phase: 09-02
    provides: buildKml stats.unresolvedNoCoord, tier-aware buildKml(..., { postTiers })
provides:
  - "Dedicated confidence status banner (D-07) rendering dwgConfidence.overall as ALTA/MÉDIA/BAIXA/NÃO RESOLVIDO (SC-1)"
  - "Hard-block gating in the download handler — no KMZ on no-region / unit-envelope failures (SC-2 / D-12)"
  - "postTiers threaded into buildKml so the KMZ is tier-colored (D-10)"
  - "Unresolved-post list (Postes não resolvidos: …) from stats.unresolvedNoCoord (CONF-03 / D-11)"
  - "lastCalcResult carries dwgConfidence/hardBlock/dwgNoRegion (Pitfall 6)"
affects: [10-, kmz-export, ui-polish]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Banner text set via el.textContent only (never innerHTML) — DOM output-encoding mirrors showWarnings (T-09-05)"
    - "Block-vs-flag boundary: hardBlock early-returns before buildKml/packageKmz; matched-region degradation still emits flagged KMZ"
    - "Tier labels are words, meters use Number(x).toFixed(1) + ' km' — zero percent sign anywhere (CONF-04)"

key-files:
  created: []
  modified:
    - index.html
    - browser/main.js

key-decisions:
  - "Confidence banner inserted after #calcNotices inside the coord step, before the developer #warnings accordion (D-07 separate prominent block)"
  - "Tier tint via CSS rgba decimal alpha + left-border — no percent characters in styling"
  - "Banner shown at calc time with overall tier; unresolved list finalized at download time after buildKml stats are known"

patterns-established:
  - "showConfidenceBanner(result, unresolvedNoCoord): reset → overall tier → hard-block reason → unresolved list → conditional show"
  - "Hard-block gate at top of download handler is the single chokepoint preventing silently-wrong KMZ (T-09-08)"

requirements-completed: [CONF-01, CONF-03, CONF-04, SC-1, SC-2]

# Metrics
duration: 4min
completed: 2026-06-09
---

# Phase 09 Plan 03: Confidence & Failure UI Surfacing Summary

**A dedicated traffic-light confidence banner that renders the Portuguese overall tier (SC-1), hard-blocks the KMZ on no-region/unit failures with a nearest-region hint (SC-2/D-12), threads postTiers into a tier-colored KMZ (D-10), and lists unresolved posts (CONF-03) — with zero percent sign anywhere (CONF-04).**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-06-09T18:47:22Z
- **Completed:** 2026-06-09T18:51:34Z
- **Tasks:** 2
- **Files modified:** 2 (index.html, browser/main.js)

## Accomplishments
- Dedicated `#confidenceBanner` DOM block (overall / block-reason / unresolved children) with traffic-light tier-color CSS classes (tier-high/med/low/unresolvable), placed in the coord step and separate from the developer `#warnings` accordion (D-07).
- `showConfidenceBanner(result, unresolvedNoCoord)` renders the Portuguese overall tier label (ALTA/MÉDIA/BAIXA/NÃO RESOLVIDO) and adds a `tier-<overall>` class — SC-1.
- Download handler early-returns (no buildKml, no packageKmz) when `lastCalcResult.hardBlock` is true, showing the Portuguese block reason + nearest-region hint+distance and keeping the button disabled — SC-2 / D-12.
- buildKml now receives `{ ...opts, postTiers: lastCalcResult.dwgConfidence?.postTiers ?? [] }` so the KMZ is colored per-post by tier — D-10.
- Unresolved (no-coordinate) posts surface as "Postes não resolvidos: N, M, …" from `stats.unresolvedNoCoord`; the `kmzStatsOmitted` line reworded to flag semantics — CONF-03 / D-11.
- `lastCalcResult` now carries `dwgConfidence`, `hardBlock`, `dwgNoRegion` so the download handler can gate and color (Pitfall 6).
- No `%` in any new HTML, CSS, banner string, block reason, or unresolved list (CONF-04). Banner uses `textContent` only (T-09-05/T-09-06 mitigation).

## Task Commits

Each task was committed atomically:

1. **Task 1: Confidence banner DOM container + tier-color CSS** - `eeb3f52` (feat)
2. **Task 2: showConfidenceBanner + hard-block gating + postTiers wiring** - `82c1989` (feat)

**Deviation log:** `8f4920e` (docs: pre-existing post-positioning failures logged)

## Files Created/Modified
- `index.html` - Added `#confidenceBanner` block (overall/blockReason/unresolved) after `#calcNotices`; added `.confidence-banner` + tier-* / block-reason / unresolved CSS classes mirroring `.panel` spacing.
- `browser/main.js` - Bound the four confidence* elements; added `showConfidenceBanner()`; carried dwgConfidence/hardBlock/dwgNoRegion into lastCalcResult; called the banner at calc time; added the hard-block early-return; threaded postTiers into buildKml; finalized the unresolved list at download time; reworded `kmzStatsOmitted`.

## Decisions Made
- Banner inserted after `#calcNotices` (closing at original line 694) and before the coordForm `</section>`, so it sits with the calc output and precedes the developer `#warnings` accordion — satisfies D-07's "separate prominent block".
- CSS tier tints use `rgba(..., 0.08–0.12)` decimal alpha + a 6px left border accent — purely cosmetic, no string content, no `%`.
- Overall tier + block reason are shown immediately at calc time; the unresolved-post list is finalized at download time because `stats.unresolvedNoCoord` is only known after `buildKml` runs (so the calc-time call passes `[]`).

## Deviations from Plan

None — plan executed exactly as written. All `<action>` steps for both tasks were applied as specified.

(See "Issues Encountered" below for a pre-existing, out-of-scope test discovery that was logged but NOT fixed, per the SCOPE BOUNDARY rule.)

---

**Total deviations:** 0 auto-fixed
**Impact on plan:** Implemented exactly as planned; presentation-only changes over already-computed Plan 01/02 signals.

## Issues Encountered

**Stale worktree base (resolved):** The worktree was spawned from commit `88ec149`, predating the Plan 01/02 merge (`592f5f2`). The startup dependency checks failed because `parser/dwg/residual-gate.js` and `parser/dwg/tier-styles.js` were absent. Resolved per the documented fallback by fast-forwarding the worktree to local `main` (`592f5f2`); dependency checks then passed (Plan 01 OK, Plan 02 OK, UI files present).

**Pre-existing post-positioning test failures (out of scope, NOT fixed):** `npm run test:gate:fixtures` exercises `parser/__tests__/post-positioning.test.mjs`, which reports `21 passed, 3 failed` (circle-keep + two Valmor p4 Viterbi-assignment cases). Confirmed these are pre-existing on `main` and independent of this plan by re-running the test with `browser/main.js` reverted to base — identical `21 passed, 3 failed`. Plan 09-03 touches only `index.html` and `browser/main.js` (presentation layer) and does not import or modify post-positioning logic, so per the SCOPE BOUNDARY rule these were logged to `.planning/phases/09-diagnostic-failure-confidence-surfacing/deferred-items.md` (item 3) and left for separate Phase 07/08 triage. They are unrelated to the confidence-surfacing goal.

## Verification

- index.html DOM check (Task 1 verify) — **exit 0** (all four ids present, tier-high CSS present, banner precedes `#warnings`).
- browser/main.js wiring check (Task 2 verify) — **exit 0** (showConfidenceBanner/OVERALL_LABEL_PT/postTiers/hardBlock/dwgConfidence present; no `%` in banner body; no innerHTML assignment).
- Full `showConfidenceBanner` body (2261 chars) independently scanned — **no `%`**.
- `npm run build` (esbuild) — **exit 0**, rebuilt `dist/app.js` (871.8kb) and `dist/dxf-parse.worker.js` (`dist/` is gitignored, not committed).
- `npm run test:gate` — the accuracy/topology gates that ran were unaffected; the only failing tests (`post-positioning.test.mjs`, 3) are pre-existing on `main` and out of scope (logged above). Presentation-layer changes do not touch coords/connections (Pitfall 4 honored).

## Next Phase Readiness
- The full confidence/failure surfacing chain (Plan 01 data → Plan 02 KMZ → Plan 03 UI) is wired end to end.
- Banner renders overall tier, blocks KMZ on hard failures, colors KMZ by tier, and lists unresolved posts — all without any numeric percentage.
- Recommendation for the orchestrator: run `npm run test:gate` in the primary working tree (with source PDFs present) post-merge to confirm zero accuracy regression, and triage the 3 pre-existing `post-positioning.test.mjs` failures separately (Phase 07/08 scope).

## Self-Check: PASSED

- FOUND: index.html
- FOUND: browser/main.js
- FOUND: .planning/phases/09-diagnostic-failure-confidence-surfacing/09-03-SUMMARY.md
- FOUND commit: eeb3f52 (Task 1)
- FOUND commit: 82c1989 (Task 2)

---
*Phase: 09-diagnostic-failure-confidence-surfacing*
*Completed: 2026-06-09*
