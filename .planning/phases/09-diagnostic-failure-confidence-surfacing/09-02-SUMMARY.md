---
phase: 09-diagnostic-failure-confidence-surfacing
plan: 02
subsystem: kmz-confidence-encoding
tags: [kml, tier-styles, ExtendedData, traffic-light, confidence, unresolvable-flagging, no-percent]

requires:
  - phase: 09-01
    provides: "applyResidualGate postTiers[] (postNumber/tier/shapeResidualM/anchorGapM) + overall tier"
  - phase: 05
    provides: "HIGH/MED/LOW/UNRESOLVABLE tier vocabulary (labels only, never %)"
provides:
  - "parser/dwg/tier-styles.js pure module: TIER_HEX, TIER_LABEL_PT, tierStyleId(), tierStyleBlock()"
  - "buildKml emits four tier-keyed Style blocks + per-post tier styleUrl when options.postTiers present"
  - "per-post <ExtendedData> (tier/shape_residual_m/anchor_gap_m/source/demotionReason) — meters allowed, no %"
  - "Portuguese balloon tier line (Confiança: ALTA/MÉDIA/BAIXA/NÃO RESOLVIDO)"
  - "D-11 explicit unresolvedNoCoord stat (omittedNoGps kept as count for back-compat)"
  - "kmz-defaults TIER_COLORS convenience export"
affects:
  - "Plan 09-03 (UI status banner / hard-block gating) threads postTiers into buildKml at the download handler and consumes stats.unresolvedNoCoord"

tech-stack:
  added: []
  patterns:
    - "pure no-I/O KML helper mirroring kml-color.js (named exports, throw on invalid input)"
    - "additive options.postTiers consumption — buildKml back-compatible when absent (#postPoint fallback, no ExtendedData)"
    - "every new <Data>/<description> value passes through existing escapeXml (V5 output-encoding)"
    - "tier hex → aabbggrr via hexToKmlColor (never hand-build the byte string)"

key-files:
  created:
    - "parser/dwg/tier-styles.js"
  modified:
    - "parser/kmz-defaults.js"
    - "parser/kml-builder.js"
    - "parser/__tests__/kml-builder.test.mjs"

key-decisions:
  - "ExtendedData uses <Data name=\"…\"><value>…</value></Data> (canonical KML shape); null meter sub-scores omit their <Data> entirely rather than emitting empty"
  - "source defaults to 'pdf' when post.source is absent (D-04); demotionReason emitted only when present on the tier entry"
  - "tierStyleBlock takes labelColorKml/labelScale so tier markers inherit the user's label convention from resolveStyleColors, keeping only the icon hue tier-driven (D-03)"

patterns-established:
  - "Tier surfacing is opt-in via options.postTiers — callers without tiers get byte-identical legacy #postPoint output"
  - "D-11 fail-loud: declared-but-uncoordinated posts recorded in stats.unresolvedNoCoord, never silently dropped"

requirements-completed: [CONF-02, CONF-03, CONF-04]

duration: ~20min
completed: 2026-06-09
---

# Phase 9 Plan 02: KMZ Tier Encoding Summary

**Per-post confidence is now encoded in the KMZ as four traffic-light tier styles, per-post `<ExtendedData>` diagnostics (meters, no %), and a Portuguese balloon tier line — with UNRESOLVABLE posts flagged red instead of silently dropped, while route lines stay uniform.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 2 (both TDD)
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments

- New pure `parser/dwg/tier-styles.js` (mirrors `kml-color.js` discipline): `TIER_HEX` traffic-light palette (HIGH green / MED yellow / LOW amber / UNRESOLVABLE red), `tierStyleId()` camelCase ids, `tierStyleBlock()` `#postPoint`-templated Style string, `TIER_LABEL_PT` Portuguese labels — throws on unknown tier.
- `buildKml` now consumes `options.postTiers`: emits the four tier `<Style>` blocks, references each post's own `#tier…` styleUrl, prepends `Confiança: {ALTA|MÉDIA|BAIXA|NÃO RESOLVIDO} — ` to the balloon, and attaches per-post `<ExtendedData>` with `tier`, `shape_residual_m`, `anchor_gap_m`, `source`, and (when present) `demotionReason`.
- D-11: the old silent `omittedNoGps` drop is replaced by an explicit `stats.unresolvedNoCoord` list (no-coordinate post numbers); `omittedNoGps` is kept as the count for back-compat. An UNRESOLVABLE post that HAS a coordinate renders normally with the red `#tierUnresolvable` style.
- Route line styling (D-02) and the polyline loop are byte-untouched; no `%` anywhere in the emitted KML (CONF-04). `buildKml` without `postTiers` produces the same `#postPoint` output as before.

## Task Commits

1. **Task 1: Pure tier-styles helper module (D-01/D-03/D-05)** — `91b8a29` (feat)
2. **Task 2: buildKml tier styles / styleUrl / ExtendedData / balloon / D-11 (RED→GREEN)** — `8eacca1` (test, RED), `40073ae` (feat, GREEN)

## Files Created/Modified

- `parser/dwg/tier-styles.js` (created) — pure tier→hex/style/label helper.
- `parser/kmz-defaults.js` — added `TIER_COLORS` convenience export (references same PRESET_COLORS hexes; `mergeOptions`/`resolveStyleColors` signatures unchanged).
- `parser/kml-builder.js` — tier style emission, per-post tier styleUrl, balloon tier line, `<ExtendedData>`, D-11 `unresolvedNoCoord` stat.
- `parser/__tests__/kml-builder.test.mjs` — updated the no-GPS test for D-11 semantics; added 6 tier/ExtendedData/no-%/back-compat/UNRESOLVABLE tests.

## Decisions Made

- ExtendedData uses the canonical `<Data name="…"><value>…</value></Data>` shape; null meter sub-scores omit the whole `<Data>` rather than emitting an empty value.
- `tierStyleBlock` accepts `labelColorKml`/`labelScale` so tier markers keep the user's label convention while only the icon hue is tier-driven (D-03 tier-color-wins default, no toggle — deferred per CONTEXT).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

**Worktree base was stale.** The agent worktree branch was created from commit `88ec149`, which predates the Phase 09 planning files and the Plan 01 deliverable (`parser/dwg/residual-gate.js` with the `overall` field and per-post sub-scores). The branch had no unique commits and a clean working tree, so it was fast-forwarded to the current main tip (`73a0b6b`, the merge of the 09-01 executor worktree) inside the startup branch-check step — bringing in the Plan 01 dependency and the 09-02 plan/context files. No work was lost; this was an environment/worktree-setup artifact, not a code change.

## Verification Results

- `node --test parser/__tests__/kml-builder.test.mjs parser/__tests__/kml-builder-siriu-dwg.test.mjs` → exit 0 (27 tests pass, including the siriu-dwg golden line test — route styling untouched, D-02).
- Tier helper smoke (`tierStyleBlock('UNRESOLVABLE','x')`) → ok (id present, no `%`).
- End-to-end tiered build → no `%`, all four tier styles present, `unresolvedNoCoord=[5]`, `omittedNoGps=1` for a no-coord post.
- `node --test parser/__tests__/residual-gate.test.mjs parser/__tests__/coordinate-calculator-dwg-conf.test.mjs` → 21/21 pass (no regression of Plan 01 deliverables).
- `npm run test:gate` NOT run in this worktree — the route accuracy gates require large source PDFs that live only in the primary working tree (same worktree-isolation artifact noted in 09-01's deferred items). These changes are additive over the KML output only and touch no coordinate/connection/threshold logic, so no accuracy regression is expected; the orchestrator should run `npm run test:gate` in the primary tree post-merge.

## Threat Surface

T-09-03 (Tampering, new ExtendedData/balloon values): mitigated — every new `<Data>`/`<description>` value passes through the existing `escapeXml()`. T-09-04 (no-numeric-% anti-feature): mitigated — `assert.doesNotMatch(kml, /%/)` test gate enforces CONF-04. T-09-SC: zero new dependencies. No new security-relevant surface beyond the threat register.

## Next Phase Readiness

- Plan 09-03 (UI status banner / hard-block gating) can now thread `lastCalcResult.dwgConfidence.postTiers` into `buildKml(...)` at the download handler and consume `stats.unresolvedNoCoord` for the "Postes não resolvidos" list.

## Self-Check: PASSED

- FOUND: parser/dwg/tier-styles.js
- FOUND: parser/kmz-defaults.js
- FOUND: parser/kml-builder.js
- FOUND: parser/__tests__/kml-builder.test.mjs
- FOUND: .planning/phases/09-diagnostic-failure-confidence-surfacing/09-02-SUMMARY.md
- FOUND commit: 91b8a29 (Task 1)
- FOUND commit: 8eacca1 (Task 2 RED)
- FOUND commit: 40073ae (Task 2 GREEN)

---
*Phase: 09-diagnostic-failure-confidence-surfacing*
*Completed: 2026-06-09*
