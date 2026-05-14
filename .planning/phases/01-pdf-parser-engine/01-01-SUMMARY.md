---
plan: 01-01
phase: 01-pdf-parser-engine
status: complete
completed: 2026-05-13
---

# Plan 01-01 Summary: Walking Skeleton

## What Was Built

`test/skeleton-test.html` — a minimal browser page that loads pdf.js 5.7.284 from jsDelivr CDN, accepts a PDF file via file input, and logs OCG layer data, text content sentinels, and constructPath operators to the DevTools console. Used to validate pdf.js OCG layer extraction on the real INFOVIAS sample PDF and resolve the two open assumptions from RESEARCH.md before full parsing logic is written.

## Key Files

- `test/skeleton-test.html` — Walking Skeleton validation page

## Tasks Completed

| Task | Status | Notes |
|------|--------|-------|
| Build Walking Skeleton HTML page | ✓ | pdf.js 5.7.284 loads from CDN; file input; OCG + text + graphics logging |
| Verify on real PDF and record A1/A2 | ✓ | All 5 acceptance criteria confirmed; A1 and A2 resolved |

## Self-Check: PASSED

All acceptance criteria verified on the real sample PDF:

| Check | Result |
|-------|--------|
| pdf.js version | 5.7.284 ✓ |
| All OCG layer names | 36 layers found ✓ |
| AC3 hasBeginMarked | true ✓ |
| AC4 TEXTO items (two-digit numbers) | Found (all-page fallback; layer filter deferred) |
| AC5 Numero_Poste constructPath count | 11 ✓ |
| A1 constructPath ops | Resolved ✓ |
| A2 distance layer name | Resolved ✓ |

## Assumption Resolutions

### A1 — Circle Shape Type
**Resolved:** 4 cubic Bézier arcs.

constructPath args: `[20, [Float32Array(31)], Float32Array(4)[-35.5, -35.5, 35.5, 35.5]]`

The bounding box `[-35.5, -35.5, 35.5, 35.5]` is ±35.5 PDF points (71×71 unit square, radius ~35.5). Circle center in local coords is always (0, 0). **Phase 2 must apply the CTM active at the constructPath call to convert to page coordinates.**

### A2 — Distance Layer Name
**Resolved:** `"Distância_Poste"` — with â (U+00E2), OCG id=`44R`.

Layer name matching in parser.js requires diacritic normalization:
```js
s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
```

## Critical Architectural Finding

**`getTextContent()` beginMarkedContentProps.id is always null in this PDF.**

The PDF uses OCMD (Optional Content Membership Dictionary) references in its BDC operators. pdf.js 5.x does not resolve OCMD references to group IDs in the text content pipeline. All `beginMarkedContentProps` items returned by `getTextContent({ includeMarkedContent: true })` have `id: null`.

**The operator list approach DOES work** (AC5 = 11 constructPath correctly found in Numero_Poste via `args[1].id`).

**Required approach for Plans 02-03 text extraction:**
Walk the operator list tracking layers via `beginMarkedContentProps` (fn=70). For text show operators within the target layer, record the CTM (`transform[4]`, `transform[5]`). Then correlate with `getTextContent()` items by matching transform positions.

## Layer Map Confirmed

| Layer | OCG ID | Status |
|-------|--------|--------|
| Numero_Poste | 51R | Confirmed — 11 constructPath on page 2 |
| TEXTO | 52R | Confirmed — layer exists; CTM correlation needed for text |
| Distância_Poste | 44R | Confirmed — â accent; normalize before comparison |
| Cabo Projetado | 43R | Confirmed — exact name with space |

## Commits

- `feat(01-01): build Walking Skeleton HTML page`
- `feat(01-01): resolve A1/A2 assumptions, record skeleton findings`
