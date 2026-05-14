---
phase: 01-pdf-parser-engine
plan: "02"
subsystem: pdf-parsing
tags: [pdfjs-dist, ocg, ctm-correlation, esm, browser]

requires:
  - phase: 01-01-walking-skeleton
    provides: A1/A2 resolved, layer map confirmed, CTM correlation approach proven

provides:
  - parsePdf(arrayBuffer) — full output contract: posts, distances, cableSegments, warnings, layerMap
  - parser/ocg-map.js — buildOcgMap (Symbol.iterator), validateLayers (diacritic-normalized), normalizeName
  - parser/text-extractor.js — CTM correlation text layer extractor (no item.id reliance)
  - parser/graphics-extractor.js — CTM-tracked circle position + cable path extractor
  - parser/construct-path-parser.js — parseConstructPath switch-case decoder + circleCentroid
  - parser/post-assembler.js — spatial proximity TEXTO→circle matching (50pt threshold)
  - parser/distance-associator.js — sequential pair distance association (Brazilian comma handling)
  - parser/cable-builder.js — cable segment builder with branch detection
  - parser/pdf-parser.js — top-level orchestrator with all three error paths

affects:
  - 01-03-browser-ui
  - phase-2-coordinate-calculator

tech-stack:
  added:
    - pdfjs-dist@5.7.284 (CDN ESM from jsDelivr)
  patterns:
    - CTM correlation for layer-filtered text extraction (operator list + getTextContent position match)
    - CTM stack tracking (fn=10/11/12) for circle centroid extraction (fn=91 constructPath)
    - OCG layer enumeration via Symbol.iterator (not config.getGroups())
    - Diacritic normalization via NFD decompose + Unicode combining char strip
    - Proximity threshold spatial matching (50 PDF points)
    - Brazilian locale comma→dot decimal normalization
    - flipY (pageHeight - rawY) applied in orchestrator only; extractors return raw coords
    - Warning accumulation (D-07): skip element + push warning, never throw from inner modules

key-files:
  created:
    - parser/ocg-map.js
    - parser/text-extractor.js
    - parser/graphics-extractor.js
    - parser/construct-path-parser.js
    - parser/post-assembler.js
    - parser/distance-associator.js
    - parser/cable-builder.js
    - parser/pdf-parser.js
  modified: []

key-decisions:
  - "CTM correlation is the only working text layer extraction approach — getTextContent item.id is always null due to OCMD (confirmed by skeleton)"
  - "Circle centroid = CTM (e,f) at fn=91 call — NOT bounding box midpoint — per SKELETON.md A1"
  - "Proximity threshold set to 50 PDF points (circle radius ~35.5pt; 50pt gives sufficient match margin)"
  - "flipY applied in pdf-parser.js orchestrator only; inner extractors return raw PDF coords"
  - "normalizeName used on both sides of layer name comparison to handle Distância_Poste accent"
  - "gfxResult API is {circles, cablePaths, byLayer} — NOT flat byLayer dict (old PATTERNS.md pattern superseded)"

patterns-established:
  - "Pattern CTM-correlation: walk operator list to record (layer, e, f) at text show ops; match getTextContent items by position"
  - "Pattern CTM-stack: maintain {a,b,c,d,e,f} stack through fn=10(save)/11(restore)/12(transform) for accurate page coordinates"
  - "Pattern OCG-iterator: for (const [id, group] of config) — yields {id, group.name} in pdf.js 5.x"
  - "Pattern diacritic-normalize: s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()"

requirements-completed: [PDF-01, PDF-02, PDF-03, PDF-04]

duration: 45min
completed: 2026-05-13
---

# Phase 1 Plan 02: PDF Parser Engine — Full Pipeline Summary

**Eight ESM browser modules delivering parsePdf(arrayBuffer) using CTM correlation text extraction, CTM-tracked circle centroids, diacritic-normalized layer matching, and sequential proximity distance association**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-05-13T00:00:00Z
- **Completed:** 2026-05-13
- **Tasks:** 3
- **Files created:** 8

## Accomplishments

- Full PDF extraction pipeline: text (CTM correlation), graphics (CTM-tracked fn=91), cable paths (PathOp decoder)
- parsePdf() returns exact SKELETON.md contract: `{posts, distances, cableSegments, warnings, layerMap}`
- All three error paths implemented: `missing_layers`, `parse_failed`, per-element warnings (D-07/D-08)
- Diacritic normalization resolves Distância_Poste (â U+00E2) layer matching without hardcoding
- Brazilian locale comma decimal separator handled in distance-associator (e.g., "40,2" → 40.2)
- Branch detection in cable-builder records informational warnings for forked cable routes (D-12)

## Task Commits

Each task was committed atomically:

1. **Task 1: Build utility modules (ocg-map.js, construct-path-parser.js)** - `cfa5900` (feat)
2. **Task 2: Build extraction service modules (text-extractor.js, graphics-extractor.js)** - `a5a2fad` (feat)
3. **Task 3: Build assembly modules and pdf-parser.js orchestrator** - `e552413` (feat)

**Plan metadata:** (docs commit — see final commit below)

## Files Created

- `parser/ocg-map.js` — buildOcgMap (Symbol.iterator), validateLayers (normalized), normalizeName (NFD strip)
- `parser/construct-path-parser.js` — parseConstructPath (op codes 13-19, per-op ci advance), circleCentroid (bounding box; not used by orchestrator)
- `parser/text-extractor.js` — CTM correlation: operator list layer+CTM tracking → getTextContent position match
- `parser/graphics-extractor.js` — CTM-tracked fn=91 handler: circles from CTM (e,f), cablePaths from parseConstructPath
- `parser/post-assembler.js` — TEXTO→circle proximity matching (50pt), /^\d{1,3}$/ filter, deduplicatePosts
- `parser/distance-associator.js` — sequential post pair midpoint proximity, comma→dot decimal, meters:null on miss
- `parser/cable-builder.js` — buildCableSegments with startPoint/endPoint extraction, detectBranches (5pt threshold)
- `parser/pdf-parser.js` — pdfjs-dist@5.7.284 CDN, workerSrc set, all-pages loop, flipY, normalizeName key lookup

## Decisions Made

- **CTM correlation for text extraction:** The SKELETON.md critical finding confirmed getTextContent item.id is always null in this PDF. Operator list layer tracking (fn=70) + CTM position recording + getTextContent position match is the only viable approach.
- **Circle centroid = CTM (e,f):** SKELETON.md A1 resolved that circles have local center (0,0); CTM translation at fn=91 IS the page position. circleCentroid() (bounding box) is exported but not used by the orchestrator.
- **flipY in orchestrator only:** All extractors return raw PDF coordinates. pdf-parser.js applies `pageHeight - rawY` to all y values before storing in cross-page collectors. This keeps inner modules simpler.
- **Proximity threshold = 50 PDF points:** Circle radius ≈ 35.5pt per SKELETON.md A1; 50pt chosen to safely accommodate label offset without false matches.
- **gfxResult API:** graphics-extractor returns `{circles, cablePaths, byLayer}` (not a flat byLayer dict). pdf-parser.js uses `gfxResult.circles` and `gfxResult.cablePaths` per the updated API.

## Deviations from Plan

None — plan executed exactly as written. The critical notes in the plan prompt (CTM correlation, new gfxResult API, no circleCentroid call, Symbol.iterator, diacritic normalization, 50pt threshold, comma decimal) were all followed precisely.

## Issues Encountered

None. All acceptance criteria verified via static analysis:
- All 7 op code cases (13-19) present in parseConstructPath
- normalizeName('Distância_Poste') → 'distancia_poste' confirmed via NFD decomposition
- validateLayers(['Numero_Poste', 'TEXTO', 'Distância_Poste', 'Cabo Projetado']).valid === true (normalized match)
- No item.id reliance in text-extractor.js (only appears in comment as anti-pattern)
- No circleCentroid() call in pdf-parser.js
- No gfxByLayer['Numero_Poste'] (old API) in pdf-parser.js

## Known Stubs

None. All data paths are wired: text → CTM correlation → byLayer → flipY → assemblePostData → posts. No placeholders or hardcoded empty values in the data pipeline.

## Threat Flags

No new security-relevant surface introduced beyond what the plan's threat model covers:
- T-02-01 mitigated: entire parsePdf body wrapped in try/catch → `{error: 'parse_failed'}`
- T-02-03 accepted: pdf.js disables PDF JS by default; no action needed in parser modules

## User Setup Required

None — no external service configuration required. All modules are browser-only ESM loaded via CDN.

## Next Phase Readiness

- parsePdf(arrayBuffer) is ready for Plan 01-03 (browser UI) consumption
- Phase 2 (Coordinate Calculator) can import parser/pdf-parser.js and call parsePdf() directly
- Verification on real sample PDF (INFOVIAS_PJC INTERNET_Palhoça_RUA VALMOR FRANCISCO_v1.pdf) deferred to Plan 01-03 integration test as specified in the plan's verification section

---
*Phase: 01-pdf-parser-engine*
*Completed: 2026-05-13*

## Self-Check

**Files verified present:**
- `parser/ocg-map.js` — created in Task 1 commit cfa5900
- `parser/construct-path-parser.js` — created in Task 1 commit cfa5900
- `parser/text-extractor.js` — created in Task 2 commit a5a2fad
- `parser/graphics-extractor.js` — created in Task 2 commit a5a2fad
- `parser/post-assembler.js` — created in Task 3 commit e552413
- `parser/distance-associator.js` — created in Task 3 commit e552413
- `parser/cable-builder.js` — created in Task 3 commit e552413
- `parser/pdf-parser.js` — created in Task 3 commit e552413

**Commits verified:**
- cfa5900: feat(01-02): build utility modules ocg-map.js and construct-path-parser.js
- a5a2fad: feat(01-02): build extraction modules text-extractor.js and graphics-extractor.js
- e552413: feat(01-02): build assembly modules and parsePdf orchestrator

## Self-Check: PASSED
