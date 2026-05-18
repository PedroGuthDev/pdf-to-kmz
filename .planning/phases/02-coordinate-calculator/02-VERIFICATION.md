# Phase 2: Coordinate Calculator — Verification

**Verified:** 2026-05-18  
**Sample:** `INFOVIAS_PJC INTERNET_Palhoça_RUA VALMOR FRANCISCO_v1.pdf`  
**Method:** Reference GPS vs `calculateCoordinates()` output (`node debug-run-calc.mjs` or browser compare)

## Success criteria

| Criterion | Target | Result |
|-----------|--------|--------|
| All posts have GPS | 11/11 non-null | **11/11** |
| Per-post error | < 5 m (most posts) | **11/11 < 5 m** |
| Max error | < 5 m (stretch goal) | **4.19 m** (post 9) |

**Verdict:** PASS — accuracy target met for Palhoça sample.

## Per-post errors (reference vs calculated)

| Post | Ref lat | Calc lat | Ref lon | Calc lon | Error (m) | Status |
|------|---------|----------|---------|----------|-----------|--------|
| 1 | -27.65946040 | -27.65946041 | -48.69924028 | -48.69924072 | 0.04 | ✓ |
| 2 | -27.65942121 | -27.65942131 | -48.69960201 | -48.69960335 | 0.13 | ✓ |
| 3 | -27.65938202 | -27.65938241 | -48.70002127 | -48.70000113 | 1.98 | ✓ |
| 4 | -27.65934674 | -27.65934730 | -48.70034539 | -48.70032637 | 1.87 | ✓ |
| 5 | -27.65930559 | -27.65930406 | -48.70076244 | -48.70075141 | 1.10 | ✓ |
| 6 | -27.65927032 | -27.65927213 | -48.70108214 | -48.70104920 | 3.25 | ✓ |
| 7 | -27.65923180 | -27.65922949 | -48.70147948 | -48.70145287 | 2.63 | ✓ |
| 8 | -27.65918966 | -27.65918596 | -48.70188546 | -48.70184375 | 4.13 | ✓ |
| 9 | -27.65914949 | -27.65914364 | -48.70230140 | -48.70225934 | 4.19 | ✓ |
| 10 | -27.65910638 | -27.65910592 | -48.70266092 | -48.70264077 | 1.99 | ✓ |
| 11 | -27.65906621 | -27.65906803 | -48.70299943 | -48.70298640 | 1.30 | ✓ |

**Max error:** 4.19 m | **Posts with null GPS:** 0/11

Legend: ✓ < 5 m

## Baseline comparison

| Metric | Before (2026-05-18 baseline) | After Poste-symbol positioning |
|--------|------------------------------|--------------------------------|
| Max error | ~49.5 m (post 8); up to ~68 m cited in context | **4.19 m** |
| Posts < 5 m | 1/11 (post 01 only) | **11/11** |
| Dominant issue | Wrong PDF `(x,y)` (label circles / cable vertices) | Resolved via Poste layer + cable-aware match |

## Positioning approach (what shipped)

**Canonical PDF `(x,y)`:** centroid of **Poste** pole graphics (square+X, double circle), not Numero_Poste label circles or Cabo Projetado vertices.

**Post number:** OCR / route order on Numero_Poste circles (unchanged).

**Matching (`assignPostPositionsFromPosteSymbols` in `parser/post-positioning.js`):**

1. Tight dedupe of raw Poste centroids (12 pt).
2. **Pass 1:** label within 100 pt + label near cable (≤95 pt) + same-polyline arc within 150 pt; one-to-one greedy by score.
3. **Pass 2:** relaxed arc (×1.75) for branch/junction sheets.
4. **Pass 3:** nearest unused symbol within 85 pt of label if cable arc match fails.

**Phase 02:** `snapPostsToPolyline()` no longer overrides positions in `calculateCoordinates()` — cable used for gaps/topology only.

## Supersedes / deferred

- **D-ACC-01 (cable vertex = post position):** superseded for PDF positioning; cable offset inversion not required for Palhoça UAT.
- **Todo:** [derive post positions from Cabo offset](.planning/todos/completed/20260518-derive-post-positions-from-cabo-offset.md) — closed; Poste-symbol path met <5 m goal.

## Code references

- `parser/post-positioning.js` — `assignPostPositionsFromPosteSymbols`, `dedupePosteRawCentroids`
- `parser/pdf-parser.js` — wires Poste raw + `allCablePaths` after OCR assembly
- `parser/cable-builder.js` — `nearestCableHitOnPage` (path index for arc compare)
- `parser/coordinate-calculator.js` — no polyline vertex snap on input posts
