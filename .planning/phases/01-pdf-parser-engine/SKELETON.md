# Walking Skeleton: PDF Parser Engine

**Phase:** 01 - PDF Parser Engine
**Created:** 2026-05-13
**Resolved:** 2026-05-13
**Purpose:** Record architectural decisions made in the Walking Skeleton that all subsequent phases build on without renegotiating.

---

## What the Skeleton Proves

The Walking Skeleton proves that pdf.js 5.x OCG layer extraction works on the real INFOVIAS sample PDF before any full parsing logic is written. It resolves two open assumptions from RESEARCH.md:

- **A1:** What shape type represents circles on the `Numero_Poste` layer — **RESOLVED: 4 cubic Bézier arcs**
- **A2:** Whether the distance OCG name has an accent character — **RESOLVED: "Distância_Poste" (â, U+00E2)**

---

## Architectural Decisions

### Framework and Runtime

| Decision | Value | Rationale |
|----------|-------|-----------|
| Runtime | Browser (client-side only) | PROJECT.md constraint — no server |
| Module system | ESM (script type=module) | pdf.js 5.x dropped UMD; CDN ESM is only option |
| Bundler | None | Personal tool; CDN import avoids all build tooling |
| pdf.js version | 5.7.284 | Matches package.json; pinned to specific version for reproducibility |
| CDN | jsDelivr (cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284) | cdnjs is at 5.4.149 (too old); jsDelivr has 5.7.284 |

### PDF Extraction Approach

| Decision | Value | Rationale |
|----------|-------|-----------|
| Layer filtering | Manual OCG tracking via beginMarkedContentProps events in operator list | optionalContentConfigPromise only affects rendering, not extraction |
| OCG enumeration | for...of config (Symbol.iterator) — yields {id, name} objects | config.getGroups() does not exist in pdf.js 5.x |
| Text pipeline | page.getOperatorList() layer tracking + page.getTextContent() CTM correlation | getTextContent beginMarkedContentProps.id is always null in this PDF (OCMD issue — see below) |
| Graphics pipeline | page.getOperatorList() watching fn=70/74/91 | Only way to get geometric paths; fn=91 (constructPath) carries full path in one call |
| Coordinate origin | flipY applied immediately after extraction (pageHeight - rawY) | PDF origin is bottom-left; screen is top-left; Pattern 7 |
| Internal coordinate units | Raw PDF points (no further normalization) | Phase 2 converts to lat/lng; premature normalization adds complexity (D-18 discretion) |

### Critical Finding: Text Layer Filtering (OCMD Issue)

**Discovered during skeleton run 2026-05-13.**

`page.getTextContent({ includeMarkedContent: true })` returns `beginMarkedContentProps` items with `id: null` for ALL items in this PDF. The PDF uses Optional Content Membership Dictionary (OCMD) references in its BDC operators rather than direct OCG group references. pdf.js 5.x does not resolve OCMD references to individual group IDs in the text content pipeline.

**Impact:** Text layer filtering via `item.id` lookup in getTextContent is impossible.

**Operator list layer tracking DOES work** (confirmed by AC5 = 11 constructPath correctly found in Numero_Poste). The operator list's `beginMarkedContentProps` args carry the resolved OCG group ID in `args[1].id`.

**Required approach for Plans 02-03:**
1. Walk `page.getOperatorList()` tracking layers via `beginMarkedContentProps` (fn=70) events — this correctly resolves OCG IDs
2. For text in a given layer, record the Current Transformation Matrix (CTM) at the time of each text show operator (OPS.showText, OPS.showSpacedText) that fires while the target layer is active
3. Walk `page.getTextContent()` items — each has a `transform` array; match `transform[4]` (tx) and `transform[5]` (ty) to the CTM positions recorded in step 2
4. Text content items whose position matches a TEXTO-layer text operator are TEXTO items

This CTM correlation approach is the standard method when OCG IDs are unavailable in getTextContent.

### Layer Name Normalization

Layer names must be compared using diacritic-normalized strings. The pattern:
```js
s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
```
Required because `"Distância_Poste"` uses â (U+00E2) which does not match ASCII `a` in case-insensitive regex.

### Project Directory Layout

```
pdf-to-kmz/
├── index.html          (Plan 02 — main app UI)
├── parser.js           (Plan 02 — full PDF parser module)
├── test/
│   └── skeleton-test.html   (Plan 01 — this skeleton)
└── .planning/
    └── phases/01-pdf-parser-engine/
```

### Output Data Contract

The `parsePDF(arrayBuffer)` function (Plan 02) returns one of:

**Success:**
```js
{
  posts:        [{ number: Number, x: Number, y: Number }],
  distances:    [{ from: Number, to: Number, meters: Number|null }],
  cableSegments:[{ id: Number, ops: PathOp[], startPoint: {x,y}|null, endPoint: {x,y}|null }],
  warnings:     String[],
  layerMap:     { allNames: String[] }
}
```

**Layer mismatch (D-08):**
```js
{ error: 'missing_layers', missing: String[], allNames: String[] }
```

**Parse failure:**
```js
{ error: 'parse_failed', message: String, warnings: String[] }
```

This contract is the interface Phase 2 (Coordinate Calculator) will consume.

### Error and Warning Policy

| Scenario | Behavior | Decision |
|----------|----------|----------|
| Element cannot be parsed | Push warning, skip element, continue | D-07 |
| Expected layer name not found | Return error: 'missing_layers' with all layer names | D-08 |
| Malformed PDF (getDocument throws) | Return error: 'parse_failed' with message | Security V5 |
| File > 50 MB | Reject before loading, show user-friendly error | Security V5 |
| Post appears on multiple pages | Deduplicate by sequential number, keep first | D-13 |

---

## Layer Name Map (Confirmed by Skeleton)

All four data layers confirmed present in the real sample PDF.

| Layer Name | OCG ID | Content | Confirmed | Notes |
|------------|--------|---------|-----------|-------|
| Numero_Poste | 51R | Red circles (post positions) | YES | AC5 = 11 constructPath on page 2 |
| TEXTO | 52R | Sequential numbers (01, 02…) | YES | Layer exists; text items require CTM correlation |
| Distância_Poste | 44R | Inter-post distances | YES | â accent (U+00E2); strip diacritics before name comparison |
| Cabo Projetado | 43R | Cable route polyline | YES | Exact name with space confirmed in OCG list |

The PDF has 36 OCG layers total (IDs 1R–62R with gaps). The 4 data layers are at IDs 51R, 52R, 44R, 43R.

---

## Resolved Assumptions

### A1 — Circle Shape Type on Numero_Poste Layer

**Resolved:** 4 cubic Bézier arcs (not rectangle, not single arc).

`constructPath` args structure (from skeleton run on real PDF):
```
args[0] = 20           — path encoding header
args[1] = [Float32Array(31)]  — 31 interleaved coordinates for 4 Bézier arcs
args[2] = Float32Array(4)[-35.5, -35.5, 35.5, 35.5]  — bounding box
```

The bounding box `[-35.5, -35.5, 35.5, 35.5]` in local coordinates means:
- Circle radius ≈ 35.5 PDF points
- Bounding box is 71×71 PDF points, centered at origin (0, 0) in local coords

**For Phase 2 centroid extraction:** The circle center in local coordinates is always (0, 0). Apply the Current Transformation Matrix (CTM) active at the time of the constructPath call to convert local (0, 0) to page coordinates. This gives the post's (x, y) position in PDF page space.

### A2 — Distance Layer Name Accent

**Resolved:** `"Distância_Poste"` — with â (U+00E2 LATIN SMALL LETTER A WITH CIRCUMFLEX).

The layer name comparison in parser.js must normalize Unicode before matching:
```js
const normalize = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const isDistLayer = name => normalize(name).toLowerCase().startsWith('distancia');
```

---

## Decisions Deferred to Later Phases

| Decision | Phase | Note |
|----------|-------|------|
| GPS coordinate calculation from PDF positions + user input | Phase 2 | Requires Phase 1 output contract |
| Branch routing logic (which cable segment maps to which post pair) | Phase 2 | Needs full post set |
| KMZ generation and packaging | Phase 3 | Depends on Phase 2 coordinates |
| Final UI polish (drag-and-drop, progress, customization) | Phase 4 | Phase 1 delivers minimal file input only |

---

*Walking Skeleton created: 2026-05-13*
*Assumptions resolved: 2026-05-13 (real sample PDF run)*
