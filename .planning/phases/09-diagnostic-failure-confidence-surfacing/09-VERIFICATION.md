---
phase: 09-diagnostic-failure-confidence-surfacing
verified: 2026-06-09T19:02:54Z
status: human_needed
score: 8/8 must-haves verified (SC-1 end-to-end demonstration blocked by pre-existing upstream Siriu walk failure)
overrides_applied: 0
human_verification:
  - test: "Upload the Siriu PDF with the correct Siriu DXF and observe the confidence banner + KMZ"
    expected: "Banner shows 'Confiança geral: ALTA'; KMZ placemark descriptions show HIGH; dwgConfidence.overall === 'high' (SC-1)"
    why_human: "The live Siriu DWG graph walk currently fails (walkOk=false → dwgStatus 'pdf-fallback' → dwgConfidence null) for reasons OUTSIDE phase 09's scope (graph-walker / coordinate-calculator, untouched by this phase). The phase-09 UI/KMZ code correctly renders 'high' WHEN dwgConfidence is present (proven by unit tests + the siriu-dwg golden KML test), but the SC-1 observable outcome cannot be produced end-to-end until the upstream Siriu walk is restored. Needs a human/orchestrator to (a) confirm SC-1 once the walk is fixed, or (b) accept that the surfacing layer is correct and route the Siriu walk regression to upstream triage (Phase 6/7/8)."
  - test: "Upload a PDF whose post-1 GPS is not covered by any DXF region (no-region case)"
    expected: "A Portuguese block message appears ('KMZ bloqueado: nenhuma região DXF cobre o poste 1. Região mais próxima: <name> (<X.X> km).'); the download button stays disabled; NO KMZ is produced (SC-2)"
    why_human: "Hard-block gating and the nearest-region hint are wired in code (verified statically), but the full upload→block→no-download flow with a real no-region PDF is a UI/browser behavior that cannot be exercised by grep or node unit tests."
---

# Phase 9: Diagnostic Failure & Confidence Surfacing Verification Report

**Phase Goal:** Every failure surfaces a clear Portuguese-language reason in the UI; every KMZ post carries a TIER confidence label (HIGH/MED/LOW/UNRESOLVABLE) in its placemark color and ExtendedData; partial successes emit the resolvable posts rather than failing entirely; no numeric percentage confidence seals appear anywhere.
**Verified:** 2026-06-09T19:02:54Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1   | applyResidualGate exposes per-post shapeResidualM/anchorGapM + top-level `overall` tier (CONF-01 data) | ✓ VERIFIED | residual-gate.js:231-254; per-post entry keys = `anchorGapM,postNumber,shapeResidualM,tier`; `overall` computed as pure read over {gateDecision, postTiers} (lines 245-252). Runtime: trust+all-HIGH → `overall="high"`; trust+one-MED → `overall="med"` (not high). 40/40 unit tests pass. |
| 2   | Every result exit carries explicit `hardBlock`; no-region/zone miss → true, matched/success → false | ✓ VERIFIED | coordinate-calculator-dwg.js:317 (true), 344 (true), 463 (false), 503 (false). Literal flags, no dwgStatus string-sniffing. |
| 3   | formatDwgWarning renders a Portuguese `diverged-at-post` reason with meters, no % (CONF-01) | ✓ VERIFIED | coordinate-calculator-dwg.js:104-106. Runtime: `formatDwgWarning({kind:"diverged-at-post",at_post:7,residual_m:179.04})` → `"DXF: rota divergiu no poste 7 (resíduo 179.0 m)."` (has "poste 7", "179.0", no "%"). |
| 4   | buildKml emits four tier Style blocks; each post references its own tier styleUrl; ExtendedData + Portuguese balloon line (CONF-02) | ✓ VERIFIED | kml-builder.js:339-409. Runtime tiered build emits `<Style id="tierHigh">`+`tierUnresolvable`, `<styleUrl>#tierHigh</styleUrl>`, `Confiança: ALTA`, `<Data name="tier">`. |
| 5   | UNRESOLVABLE-with-coord renders a red marker; no-coord post recorded in stats, never silently dropped (CONF-03) | ✓ VERIFIED | kml-builder.js:352-360 (unresolvedNoCoord push, no drop), 369-370 (tierUnresolvable styleUrl). Runtime: UNRESOLVABLE post with lat/lon → `#tierUnresolvable` placemark; no-coord post → `stats.unresolvedNoCoord=[3]`, `omittedNoGps=1`. |
| 6   | Route line styling stays a single uniform routeLine (D-02) | ✓ VERIFIED | kml-builder.js:333 single routeLine style; polyline loop untouched; kml-builder-siriu-dwg golden test exit 0. |
| 7   | Confidence banner (separate from #warningsList) renders dwgConfidence.overall as Portuguese tier label; hardBlock gates download (SC-2); unresolved list shown (CONF-03) | ✓ VERIFIED | index.html:738-756 (#confidenceBanner before #warnings at idx 18655<22791); browser/main.js:673-742 showConfidenceBanner (OVERALL_LABEL_PT, textContent only, no innerHTML), 956-964 hard-block early-return before buildKml/packageKmz, 1018 unresolved-list render. |
| 8   | No percent sign appears in any new warning string, KML output, banner, hint, or unresolved list (CONF-04) | ✓ VERIFIED | tier-styles.js `%` only in JSDoc comments (lines 8,30), not emitted. kml-builder.js: zero `%`. Runtime tiered KML: no `%`. showConfidenceBanner body: no `%`. index.html banner block + CSS: no `%` (CSS uses decimal rgba alpha). |

**Score:** 8/8 must-haves verified in code. SC-1's *observable end-to-end* outcome is blocked by a pre-existing upstream walk failure (see Human Verification + Gaps Summary).

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `parser/dwg/residual-gate.js` | per-post sub-scores + overall tier | ✓ VERIFIED | additive return field `overall` + postTiers shapeResidualM/anchorGapM; thresholds unchanged |
| `parser/dwg/coordinate-calculator-dwg.js` | hardBlock at all exits + diverged-at-post warning | ✓ VERIFIED | 4 hardBlock exits; diverged-at-post case + push at line 526 |
| `parser/dwg/tier-styles.js` | TIER_HEX, tierStyleId, tierStyleBlock, TIER_LABEL_PT | ✓ VERIFIED | pure module, throws on unknown tier, traffic-light hexes, Portuguese labels |
| `parser/kml-builder.js` | tier styles, per-post styleUrl, ExtendedData, balloon line, unresolvedNoCoord | ✓ VERIFIED | all present and wired; back-compat #postPoint fallback when no postTiers |
| `parser/kmz-defaults.js` | TIER_COLORS convenience export | ✓ VERIFIED | additive; mergeOptions/resolveStyleColors unchanged |
| `index.html` | confidence banner DOM + tier CSS | ✓ VERIFIED | 4 ids present; banner precedes #warnings; tier-high/med/low/unresolvable classes |
| `browser/main.js` | showConfidenceBanner, hard-block gating, postTiers threading, unresolved list | ✓ VERIFIED | all wired; lastCalcResult carries dwgConfidence/hardBlock/dwgNoRegion |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| coordinate-calculator-dwg.js successResult.dwgConfidence | residual-gate.js applyResidualGate | applyResidualGate(shape, anchor) | ✓ WIRED | line 517 |
| kml-builder.js buildKml | options.postTiers | tier lookup by post number | ✓ WIRED | tierByPost Map (line 269), per-post lookup line 362 |
| kml-builder.js | tier-styles.js | import tierStyleId/tierStyleBlock/TIER_LABEL_PT | ✓ WIRED | line 2 |
| browser/main.js downloadKmzBtn handler | lastCalcResult.hardBlock | early-return before buildKml/packageKmz | ✓ WIRED | lines 956-964 (returns before line 975 buildKml) |
| browser/main.js download handler | buildKml | { ...opts, postTiers } | ✓ WIRED | line 978 |
| browser/main.js showConfidenceBanner | result.dwgConfidence.overall | tier label render | ✓ WIRED | lines 695-699 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| confidence banner (overall) | dwgConfidence.overall | applyResidualGate via successResult | ✓ on success path | ⚠️ HOLLOW for Siriu live route — dwgConfidence is null when walkOk=false (upstream, not phase-09) |
| KMZ tier styleUrl/ExtendedData | options.postTiers | dwgConfidence.postTiers threaded at download | ✓ when dwgConfidence present | Flowing in unit/golden tests; same upstream dependency on walk success for live Siriu |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| overall tier logic | node applyResidualGate (trust+all-HIGH / trust+one-MED) | high / med | ✓ PASS |
| diverged-at-post string | node formatDwgWarning(...) | "DXF: rota divergiu no poste 7 (resíduo 179.0 m)." | ✓ PASS |
| tiered KML emit | node buildKml(posts, [], {postTiers}) | 4 tier styles, styleUrls, balloon, ExtendedData, unresolvedNoCoord=[3], no % | ✓ PASS |
| showConfidenceBanner body % / innerHTML | node static scan | no %, no innerHTML | ✓ PASS |
| index.html banner placement / CSS % | node static scan | banner before #warnings, css no % | ✓ PASS |
| Siriu live pipeline (SC-1 source) | node route-dwg-accuracy-harness siriu | dwgStatus=pdf-fallback, dwgConfidence=null, walkOk=false | ✗ FAIL (upstream walk; not a phase-09 file) |

### Probe Execution

| Probe | Command | Result | Status |
| ----- | ------- | ------ | ------ |
| residual-gate unit | node --test parser/__tests__/residual-gate.test.mjs | (in combined run) | ✓ PASS |
| dwg-conf unit | node --test parser/__tests__/coordinate-calculator-dwg-conf.test.mjs | (in combined run) | ✓ PASS |
| kml-builder unit | node --test parser/__tests__/kml-builder.test.mjs | (in combined run) | ✓ PASS |
| combined (3 suites) | node --test residual-gate + dwg-conf + kml-builder | tests 40, pass 40, fail 0 | ✓ PASS |
| kml-builder-siriu-dwg golden | node --test parser/__tests__/kml-builder-siriu-dwg.test.mjs | exit 0 | ✓ PASS |
| coordinate-calculator-dwg-no-region | node --test ...dwg-no-region.test.mjs | exit 0 | ✓ PASS |
| run-residual-gate.mjs (route baseline) | node tools/run-residual-gate.mjs | exit 1 — siriu "no decision (crash/undefined)" + "present in baseline but not produced" | ✗ FAILED (pre-existing upstream Siriu walk; valmor/joaoborn/lc all produce decisions) |
| run-siriu-regression-gate.mjs | node tools/run-siriu-regression-gate.mjs | exit 1 — "graph walk failed (walkOk=false)", 106 failures | ✗ FAILED (pre-existing upstream; no phase-09 file in walk path) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| CONF-01 | 09-01, 09-03 | Failures surface a clear Portuguese reason (no-region / unit / diverged-at-post) | ✓ SATISFIED | diverged-at-post formatter + hardBlock block-reason strings in showConfidenceBanner |
| CONF-02 | 09-02 | KMZ encodes per-post tier via placemark color + ExtendedData | ✓ SATISFIED | four tier styles, per-post styleUrl, ExtendedData (tier/shape_residual_m/anchor_gap_m/source) |
| CONF-03 | 09-02, 09-03 | Partial success emits resolvable posts, flags low-confidence, never silently-wrong | ✓ SATISFIED | unresolvedNoCoord list, UNRESOLVABLE-with-coord rendered red, hardBlock blocks only no-region/unit |
| CONF-04 | all | Tier labels only, never a numeric % | ✓ SATISFIED | zero `%` in KML output, banner body, hint, unresolved list, CSS |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| (none) | — | No TODO/FIXME/XXX/HACK/PLACEHOLDER/TBD in any modified production file | ℹ️ Info | Clean |

### Human Verification Required

#### 1. SC-1 — Siriu HIGH end-to-end

**Test:** Upload the Siriu PDF with the correct Siriu DXF; observe the confidence banner and the generated KMZ.
**Expected:** Banner shows "Confiança geral: ALTA"; KMZ placemark descriptions show HIGH; `dwgConfidence.overall === "high"`.
**Why human:** The live Siriu DWG graph walk currently returns `walkOk=false` → `dwgStatus="pdf-fallback"` → `dwgConfidence=null`. This failure is in the graph-walker / coordinate-calculator pipeline, which phase 09 did NOT modify (phase-09 commits touch only residual-gate.js, coordinate-calculator-dwg.js additive fields, tier-styles.js, kmz-defaults.js, kml-builder.js, index.html, browser/main.js). The phase-09 surfacing layer is proven correct (overall→"high" unit test; siriu-dwg golden KML test passes), but SC-1's observable outcome cannot be produced until the upstream Siriu walk is restored. Decision needed: fix/triage the Siriu walk regression (Phase 6/7/8 scope) and re-confirm SC-1, OR accept the surfacing layer as complete and track the walk regression separately.

#### 2. SC-2 — no-region block, no KMZ

**Test:** Upload a PDF whose post-1 GPS is not covered by any DXF region.
**Expected:** Portuguese block message with nearest-region hint+distance; download button disabled; NO KMZ produced.
**Why human:** Hard-block gating + nearest hint are verified statically and the no-region unit test passes, but the full browser upload→block→no-download flow with a real no-region PDF is UI behavior not exercisable by grep/node.

### Gaps Summary

All four requirements (CONF-01..04) and SC-2's gating logic are fully implemented and verified in the codebase — unit tests (40/40), the siriu-dwg golden KML test, and the no-region calculator test all pass, and live behavioral spot-checks confirm the overall-tier logic, the Portuguese diverged-at-post string, the four-tier KMZ encoding, the unresolvable-post flagging, and the complete absence of any `%` seal.

The single open item is **not a phase-09 implementation defect**: the SC-1 named anchor (Siriu + correct DXF → overall "high") cannot currently be demonstrated end-to-end because the live Siriu DWG graph walk fails (`walkOk=false`, 106 failures in run-siriu-regression-gate, and run-residual-gate exits 1 with "siriu: no decision"). This is an upstream coordinate-pipeline regression in files phase 09 never touched (graph-walker.js / coordinate-calculator.js). The phase-09 code renders the correct HIGH tier the moment a non-null dwgConfidence is supplied — verified by unit test and the Siriu golden KML fixture. Note also: the SUMMARYs attributed the gate failure to "missing PDF fixtures in an isolated worktree," but in this primary tree the Siriu PDF and fixtures are present and the real cause is the walk failure — the conclusion (out of phase-09 scope, additive surfacing only) is unchanged, but the stated reason in the SUMMARYs is inaccurate for this tree.

Because SC-2 (no-region browser flow) and SC-1 (Siriu HIGH end-to-end) both require human/runtime confirmation, overall status is **human_needed** rather than passed. No phase-09 code change is required to close these items; they are runtime/UAT confirmations plus an upstream-walk triage decision.

---

_Verified: 2026-06-09T19:02:54Z_
_Verifier: Claude (gsd-verifier)_
