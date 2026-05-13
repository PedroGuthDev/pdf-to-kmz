# Phase 1: PDF Parser Engine - Research

**Researched:** 2026-05-13
**Domain:** pdf.js OCG layer extraction, operator list geometry parsing, browser CDN setup
**Confidence:** HIGH (core API verified via official source; coordinate transform patterns MEDIUM)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Posts identified by red circles on `Numero_Poste` layer + sequential numbers on `TEXTO` layer. Association by spatial proximity.
- **D-02:** 5-digit utility pole IDs are NOT relevant. Only sequential numbering (01, 02, 03...) matters.
- **D-03:** Distances between posts from `Distancia_Poste` layer.
- **D-04:** Cable route geometry from `Cabo Projetado` layer (exact name with space). Extracted as graphic path data, not text.
- **D-05:** Street names and text encoding are irrelevant. Parser only needs numeric data and geometry.
- **D-06:** PDF layers are the primary data filtering mechanism. Parser must support OCG extraction.
- **D-07:** When an element cannot be parsed, skip it and accumulate a warning. Show all warnings at end. Do NOT stop processing.
- **D-08:** If expected layer names not found, list all available layers and ask user to manually map. Do NOT fall back to unfiltered text extraction.
- **D-09:** Process all pages of the PDF. Pages without relevant layer elements are silently ignored.
- **D-10:** Hybrid approach: sequential numbering defines post pairs (01-02, 02-03...) and cable polyline validates/confirms the route.
- **D-11:** Numbering is continuous without reset across branches.
- **D-12:** Branch points detected by geometric splitting of the cable polyline.
- **D-13:** Posts may repeat across pages. Deduplicate by sequential number.
- **D-14:** After parsing, show simple summary: counts of posts found, distances found, cable segments found.
- **D-15:** Continuous flow. Coordinate input form becomes available immediately after parsing.
- **D-16:** Output data structure is rich: post number + PDF position + connection graph + cable polyline geometry segments.
- **D-17:** Parser must extract graphic operators from pdf.js (`page.getOperatorList()`) in addition to text content (`page.getTextContent()`).

### Claude's Discretion

- **D-18:** Coordinate normalization strategy (raw PDF points vs. relative 0-1 per page) is left to the planner's judgment.

### Deferred Ideas (OUT OF SCOPE)

None - discussion stayed within phase scope.

</user_constraints>
<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PDF-01 | Tool can parse INFOVIAS-format PDF files in-browser | pdf.js 5.x ESM CDN load pattern verified; ArrayBuffer input confirmed |
| PDF-02 | Tool extracts post/pole identifiers from PDF text layer | getTextContent + includeMarkedContent + OCG layer filter pattern verified |
| PDF-03 | Tool extracts inter-post distances from PDF text | Same layer-filtered getTextContent on Distancia_Poste layer |
| PDF-04 | Tool extracts post x,y drawing positions from PDF | transform[4,5] from TextItem confirmed; constructPath for graphic circles |
| PDF-05 | Tool handles PDF text encoding issues | Irrelevant per D-05 - only numeric data needed; encoding issues eliminated |

</phase_requirements>

---

## Summary

Phase 1 builds the PDF parser engine that reads INFOVIAS-format PDFs in the browser and extracts structured post data. The core technique is OCG (Optional Content Group) layer filtering: pdf.js exposes all PDF layers through `getOptionalContentConfig()`, and operators in the operator list are tagged with `beginMarkedContentProps` events that carry OCG group IDs. By building an OCG-ID-to-name lookup map first, then tracking which layer is active as we walk the operator list, we can reliably separate geometry by layer name.

The two extraction pipelines run independently. The **text pipeline** uses `page.getTextContent({ includeMarkedContent: true })` - when includeMarkedContent is true, the items array includes TextMarkedContent sentinel objects of type `beginMarkedContentProps` that carry an `id` referencing the OCG group ID. Text items between these sentinels belong to that layer. This gives us sequential post numbers from `TEXTO` and distance values from `Distancia_Poste`. The **graphics pipeline** uses `page.getOperatorList()` - OCG layer changes appear as OPS.beginMarkedContentProps (=70) operators in fnArray with args `[tag, {id: groupId}]`. Geometry operators (OPS.constructPath = 91) that follow belong to the currently active layer. This gives us circle positions from `Numero_Poste` and polyline geometry from `Cabo Projetado`.

A critical finding: **OCG filtering is NOT automatic in getTextContent or getOperatorList**. The `optionalContentConfigPromise` parameter in `render()` only affects visual rendering. For extraction, the caller must manually track which layer is active by watching `beginMarkedContentProps` events and consulting the OCG name map.

**Primary recommendation:** Build the OCG name map first using `getOptionalContentConfig()`, then run both pipelines per-page tracking active layer via `beginMarkedContentProps` events. The Walking Skeleton should prove this pattern works on the real sample PDF before implementing full data extraction logic.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| PDF file loading (ArrayBuffer) | Browser / Client | -- | File input to FileReader to ArrayBuffer; all client-side |
| OCG layer enumeration | Browser / Client | -- | getOptionalContentConfig runs in browser worker thread |
| Text extraction by layer | Browser / Client | -- | getTextContent + manual OCG tracking |
| Graphics extraction by layer | Browser / Client | -- | getOperatorList + manual OCG tracking |
| Post number parsing | Browser / Client | -- | Regex on filtered text items |
| Distance value parsing | Browser / Client | -- | Regex on filtered text items |
| Circle centroid detection | Browser / Client | -- | Geometric analysis of constructPath ellipse operators |
| Polyline geometry extraction | Browser / Client | -- | constructPath ops/coords array parsing |
| Spatial proximity matching | Browser / Client | -- | Distance formula on extracted positions |
| Multi-page deduplication | Browser / Client | -- | Post number as dedup key across pages |
| Result display / warnings | Browser / Client | -- | DOM manipulation, no server needed |

This is a pure browser/client phase. There is no server, CDN edge, or database tier involved.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pdfjs-dist | 5.7.284 | PDF parsing, OCG API, text + operator extraction | Only mature browser-native PDF parser; already in package.json |

### Supporting

None needed for Phase 1.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| pdfjs-dist | pdf-lib | pdf-lib is authoring-focused, poor extraction API |
| pdfjs-dist | pdf2json | Node.js only, unusable in browser |
| pdfjs-dist | pdf-parse | Node.js only, no OCG support |

**Version verification:** `npm view pdfjs-dist version` returns 5.7.284 [VERIFIED: npm registry, 2026-05-13]. cdnjs latest: 5.4.149 [VERIFIED: cdnjs.com, 2026-05-13]. Use jsDelivr or unpkg to get 5.7.284 to match package.json exactly.

---

## Architecture Patterns

### System Architecture Diagram

```
User selects PDF file
        |
        v
  FileReader.readAsArrayBuffer()
        |
        v
  pdfjsLib.getDocument({ data: arrayBuffer }).promise
        |
        v
  pdfDoc.getOptionalContentConfig()
        |
        v
  Build OCG ID-to-Name map
  { "R12 0": "Numero_Poste", "R14 0": "TEXTO", ... }
        |
        +--> All 4 layer names found? ----> proceed
        +--> Any layer name missing?  ----> list all layers, request manual mapping (D-08)
        |
        v
  For each page (1..numPages):
        |
    [Text Pipeline]                     [Graphics Pipeline]
        |                                       |
  page.getTextContent(             page.getOperatorList()
  { includeMarkedContent:true })   { fnArray, argsArray }
        |                                       |
  Walk items[]:                     Walk fnArray:
  type=beginMarkedContentProps      fn=70: activeLayer=idToName[args[1].id]
    -> activeLayer=idToName[id]     fn=71: activeLayer=null
  type=endMarkedContent             fn=91+activeLayer: collect path
    -> activeLayer=null
  TextItem + activeLayer=TEXTO
    -> collect post number text
  TextItem + activeLayer=Distancia_Poste
    -> collect distance text
        |                                       |
        +---------------------------------------+
        |
        v
  Cross-page assembly:
  - Deduplicate posts by sequential number (D-13)
  - Spatial proximity: match Numero_Poste circle centroid to nearest TEXTO item
  - Associate distances: pair (n, n+1) posts to nearest Distancia_Poste text
  - Build cable segments from Cabo Projetado paths, detect branches (D-12)
        |
        v
  Output: { posts, distances, cableSegments, warnings, layerMap }
        |
        v
  Display summary (D-14) + unlock Phase 2 form (D-15)
```

### Recommended Project Structure

```
index.html                      # Entry point - loads pdf.js from CDN, wires UI
parser/
  ocg-map.js                    # buildOcgMap(pdfDoc) -> { idToName, nameToId, allNames }
  text-extractor.js             # extractLayerText(page, idToName) -> { TEXTO:[], ... }
  graphics-extractor.js         # extractLayerGraphics(page, idToName) -> { Numero_Poste:[], ... }
  construct-path-parser.js      # parseConstructPath(args) -> [{type,x,y,...}]
  post-assembler.js             # assemblePostData(textItems, circles) -> posts[], warnings[]
  distance-associator.js        # associateDistances(posts, distTexts) -> distances[]
  cable-builder.js              # buildCableSegments(posts, paths) -> cableSegments[]
  pdf-parser.js                 # orchestrates all modules, page loop, dedup, final output
test/
  skeleton-test.html            # Walking Skeleton validation page
```

### Pattern 1: Load pdf.js from CDN (ESM, no bundler)
**What:** pdf.js 5.x dropped UMD; must use ESM import from CDN
**When to use:** Every browser entry point that uses pdf.js
**Example:**
```html
<!-- Source: https://mozilla.github.io/pdf.js/getting_started/ -->
<script type="module">
import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.worker.min.mjs';
</script>
```

### Pattern 2: Build OCG ID-to-Name Map
**What:** Enumerate all PDF layers before extraction so layer IDs can be resolved to names
**When to use:** Once per document, before any per-page extraction
**Example:**
```javascript
// Source: pdf.js src/display/optional_content_config.js (Symbol.iterator)
async function buildOcgMap(pdfDoc) {
  const config = await pdfDoc.getOptionalContentConfig();
  const idToName = {}, nameToId = {}, allNames = [];
  for (const [id, group] of config) {
    idToName[id] = group.name;
    nameToId[group.name] = id;
    allNames.push(group.name);
  }
  return { idToName, nameToId, allNames };
}
```

### Pattern 3: Layer-Filtered Text Extraction
**What:** Extract text items grouped by their OCG layer name
**When to use:** TEXTO layer (post numbers) and Distancia_Poste layer (distances)
**Example:**
```javascript
// Source: pdf.js getTextContent includeMarkedContent behavior
async function extractLayerText(page, idToName) {
  const content = await page.getTextContent({ includeMarkedContent: true });
  const byLayer = {};
  let activeLayer = null;
  for (const item of content.items) {
    if (item.type === 'beginMarkedContentProps') {
      if (item.id && idToName[item.id]) activeLayer = idToName[item.id];
    } else if (item.type === 'endMarkedContent') {
      activeLayer = null;
    } else if (item.str !== undefined && activeLayer) {
      if (!byLayer[activeLayer]) byLayer[activeLayer] = [];
      byLayer[activeLayer].push({ str: item.str, x: item.transform[4], y: item.transform[5] });
    }
  }
  return byLayer;
}
```

### Pattern 4: Layer-Filtered Graphics Extraction
**What:** Extract constructPath operations grouped by OCG layer name
**When to use:** Numero_Poste layer (circles) and Cabo Projetado layer (polylines)
**Example:**
```javascript
// Source: pdf.js src/shared/util.js OPS constants; github issue #18410
async function extractLayerGraphics(page, idToName) {
  const opList = await page.getOperatorList();
  const { fnArray, argsArray } = opList;
  const byLayer = {};
  let activeLayer = null;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i], args = argsArray[i];
    if (fn === 70) {
      if (args && args.length > 1 && args[1] && args[1].id) {
        const name = idToName[args[1].id];
        if (name) activeLayer = name;
      }
    } else if (fn === 71) {
      activeLayer = null;
    } else if (fn === 91 && activeLayer) {
      if (!byLayer[activeLayer]) byLayer[activeLayer] = [];
      byLayer[activeLayer].push(parseConstructPath(args));
    }
  }
  return byLayer;
}
```

### Pattern 5: parseConstructPath
**What:** Decode the variable-arity opsArray/coordsArray pair from a constructPath call
**When to use:** Every fn=91 result from extractLayerGraphics
**Example:**
```javascript
// Source: pdf.js src/shared/util.js PathType constants; github issue #18410
function parseConstructPath(args) {
  const [ops, coords] = args;
  const result = [];
  let ci = 0;
  for (const op of ops) {
    switch (op) {
      case 13: result.push({ type: 'M', x: coords[ci++], y: coords[ci++] }); break;
      case 14: result.push({ type: 'L', x: coords[ci++], y: coords[ci++] }); break;
      case 15: result.push({ type: 'C', x1: coords[ci++], y1: coords[ci++], x2: coords[ci++], y2: coords[ci++], x3: coords[ci++], y3: coords[ci++] }); break;
      case 16: result.push({ type: 'C2', x1: coords[ci++], y1: coords[ci++], x2: coords[ci++], y2: coords[ci++] }); break;
      case 17: result.push({ type: 'C3', x1: coords[ci++], y1: coords[ci++], x2: coords[ci++], y2: coords[ci++] }); break;
      case 18: result.push({ type: 'Z' }); break;
      case 19: result.push({ type: 'R', x: coords[ci++], y: coords[ci++], w: coords[ci++], h: coords[ci++] }); break;
    }
  }
  return result;
}
```

### Pattern 6: Circle Centroid from Bezier Segments
**What:** Compute the center of a PDF circle (4 cubic Bezier arcs) for spatial matching
**When to use:** Numero_Poste layer paths -- each path represents one post circle [ASSUMED]
**Example:**
```javascript
// Source: [ASSUMED] bounding box of all control points approximates centroid
function circleCentroid(pathOps) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const op of pathOps) {
    const xs = [op.x, op.x1, op.x2, op.x3].filter(v => v !== undefined);
    const ys = [op.y, op.y1, op.y2, op.y3].filter(v => v !== undefined);
    for (const x of xs) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    for (const y of ys) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}
```

### Pattern 7: Y-Axis Inversion
**What:** Convert PDF bottom-left origin to top-left origin for consistent coordinate math
**When to use:** Every extracted coordinate before storing in output data structure
**Example:**
```javascript
// Source: pdf.js coordinate system documented in getViewport() API
// page.view = [x, y, width, height]; page.view[3] = page height in points
function flipY(y, pageHeight) { return pageHeight - y; }
const pageHeight = page.view[3];
post.y = flipY(rawY, pageHeight);
```

### Pattern 8: CTM Stack Tracking (defensive)
**What:** Track current transform matrix through save/restore/transform ops
**When to use:** Only if Walking Skeleton shows unexpected coordinate offsets; skip unless needed
**Example:**
```javascript
// Source: PDF spec graphics state stack; OPS constants from pdf.js util.js
// OPS: save=10, restore=11, transform=12
let ctmStack = [{ a:1,b:0,c:0,d:1,e:0,f:0 }];
if (fn === 10) { ctmStack.push({...ctmStack[ctmStack.length-1]}); }
if (fn === 11) { ctmStack.pop(); }
if (fn === 12) {
  const [a,b,c,d,e,f] = args;
  const cur = ctmStack[ctmStack.length-1];
  ctmStack[ctmStack.length-1] = { ...cur, e: cur.e + e, f: cur.f + f };
}
```

### Anti-Patterns to Avoid
- **Calling getGroups() on OptionalContentConfig:** Does not exist in pdf.js 5.x. Use Symbol.iterator. [VERIFIED: pdf.js source]
- **Relying on render() for extraction filtering:** optionalContentConfigPromise only affects visual rendering. [VERIFIED: pdf.js source]
- **Regex on raw getTextContent without layer filtering:** Text items from different layers are interleaved. [VERIFIED: prior research PITFALLS.md]
- **Loading pdf.js as CommonJS/require in browser:** 5.x is ESM-only. [VERIFIED: npm registry]
- **Hardcoding page numbers:** Always iterate 1..numPages. (D-09)
- **Using cdnjs for pdfjs-dist:** cdnjs is at 5.4.149; use jsDelivr or unpkg for 5.7.284. [VERIFIED: cdnjs.com]

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PDF binary parsing | Custom PDF byte reader | pdfjs-dist | PDF spec is 756 pages; cross-ref tables, object streams, filters |
| OCG enumeration | Grep operator stream for OC markers | getOptionalContentConfig() | Handles inheritance, default states, nested groups |
| Font/encoding decoding | Character map lookup tables | pdfjs-dist text pipeline | ToUnicode CMaps, Type1/CID font differences |
| ZIP/KMZ creation | Custom ZIP writer | JSZip (Phase 3) | ZIP64, compression levels, CRC32 are non-trivial |
| Coordinate math | Ad-hoc transform code | pdf.js getViewport() + flipY | Multiple transform matrices compound incorrectly |

**Key insight:** pdf.js handles the hardest parts (decompression, font decoding, CMap lookup). The only custom logic needed is the OCG tracking wrapper and the constructPath decoder.

---

## Common Pitfalls

### Pitfall 1: getGroups() Does Not Exist
**What goes wrong:** Code throws TypeError: config.getGroups is not a function
**Why it happens:** Many tutorials reference getGroups() which was removed or never existed in 5.x
**How to avoid:** Use  with Symbol.iterator [VERIFIED: pdf.js source]
**Warning signs:** Any tutorial showing config.getGroups() is wrong for 5.x

### Pitfall 2: OCG Filtering Illusion
**What goes wrong:** Code passes optionalContentConfigPromise and assumes extraction is filtered
**Why it happens:** The option exists and sounds like it would filter; documentation is sparse
**How to avoid:** Always manually track activeLayer from beginMarkedContentProps events [VERIFIED: pdf.js source]
**Warning signs:** All text items come back regardless of layer settings

### Pitfall 3: Y-Axis Inversion
**What goes wrong:** Post positions appear mirrored vertically; proximity matching fails
**Why it happens:** PDF origin is bottom-left; screen origin is top-left; transform[5] is raw PDF Y
**How to avoid:** Apply  immediately after extraction [CITED: pdf.js getViewport docs]
**Warning signs:** Distances between nearby posts are huge; posts at top of page have large Y values

### Pitfall 4: constructPath Variable Arity
**What goes wrong:** Coordinate array index gets out of sync; wrong coordinates assigned to path commands
**Why it happens:** Each op type consumes a different number of coords; fixed-stride iteration breaks
**How to avoid:** Use the parseConstructPath switch-case pattern (Pattern 5) [VERIFIED: pdf.js github issue #18410]
**Warning signs:** Circle centroids at (0,0) or wildly wrong positions

### Pitfall 5: ESM Worker URL
**What goes wrong:** pdf.js throws "Setting up fake worker" warning or hangs
**Why it happens:** Must set GlobalWorkerOptions.workerSrc before calling getDocument
**How to avoid:** Always set workerSrc immediately after the ESM import (Pattern 1) [CITED: mozilla.github.io/pdf.js]
**Warning signs:** Console shows "Setting up fake worker"

### Pitfall 6: Layer Name Exact Match Including Space
**What goes wrong:** Cabo Projetado layer not found because code strips spaces or lowercases names
**Why it happens:** D-04 specifies exact name with space; matching is case and space sensitive
**How to avoid:** Match layer names exactly as returned by OCG config; D-08 fallback handles variations
**Warning signs:** Cable layer found as empty even though PDF visually shows cable route

### Pitfall 7: Multi-Page Post Deduplication
**What goes wrong:** Posts appear twice in output; distance associations become garbled
**Why it happens:** Same post appears at the edge of page N and beginning of page N+1
**How to avoid:** Use post sequential number as dedup key; keep first occurrence (D-13)
**Warning signs:** Post count higher than expected; sequential numbers have gaps after dedup

### Pitfall 8: Distancia_Poste Layer Name Accent Character
**What goes wrong:** Layer lookup fails because OCG name has accent vs. code expects no accent
**Why it happens:** CONTEXT.md shows Distancia_Poste but PDF may store Distância_Poste (with accent)
**How to avoid:** Log all OCG names in Walking Skeleton; use D-08 manual mapping if name differs [ASSUMED: A2]
**Warning signs:** Distance layer shows 0 items; allNames log shows accented variant

---

## Walking Skeleton

**Goal:** Prove the OCG layer extraction approach works on the real sample PDF before writing full parsing logic.

**Acceptance criteria (all 5 must pass on the real PDF):**
1. pdf.js loads from CDN without errors; pdfjsLib.version logs correctly
2. getOptionalContentConfig() returns config with at least 4 named groups; all 4 expected layer names present in allNames
3. getTextContent with includeMarkedContent:true on page 2 returns at least 1 item with type === beginMarkedContentProps
4. Text items on the TEXTO layer include strings matching two-digit post number pattern
5. getOperatorList() on page 2 returns at least one fn=91 while fn=70 activeLayer is Numero_Poste

**Skeleton implementation (test/skeleton-test.html):**
```javascript
import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.worker.min.mjs';

async function walkingSkeleton(arrayBuffer) {
  const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  console.log('pdf.js version:', pdfjsLib.version);
  const ocgConfig = await pdfDoc.getOptionalContentConfig();
  const idToName = {}, allNames = [];
  for (const [id, group] of ocgConfig) { idToName[id] = group.name; allNames.push(group.name); }
  console.log('All OCG layer names:', allNames);
  const page = await pdfDoc.getPage(2);
  const textContent = await page.getTextContent({ includeMarkedContent: true });
  let hasBeginMarked = false, textoItems = [], activeLayer = null;
  for (const item of textContent.items) {
    if (item.type === 'beginMarkedContentProps') {
      hasBeginMarked = true;
      if (item.id && idToName[item.id]) activeLayer = idToName[item.id];
    } else if (item.type === 'endMarkedContent') { activeLayer = null; }
    else if (item.str && activeLayer === 'TEXTO') { textoItems.push(item.str); }
  }
  console.log('AC3 hasBeginMarked:', hasBeginMarked);
  console.log('AC4 TEXTO items:', textoItems.slice(0, 10));
  const opList = await page.getOperatorList();
  let numPosteCount = 0, curLayer = null;
  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i], args = opList.argsArray[i];
    if (fn === 70 && args && args[1] && args[1].id) { curLayer = idToName[args[1].id] || null; }
    else if (fn === 71) { curLayer = null; }
    else if (fn === 91 && curLayer === 'Numero_Poste') { numPosteCount++; }
  }
  console.log('AC5 Numero_Poste constructPath count:', numPosteCount);
}
document.getElementById('fileInput').addEventListener('change', async (e) => {
  const buf = await e.target.files[0].arrayBuffer();
  await walkingSkeleton(buf);
});
```

---

## Complete OPS Reference (pdf.js 5.x)

Verified from pdf.js/src/shared/util.js [VERIFIED: github.com/mozilla/pdf.js]:

| OPS Constant | Value | Args | Notes |
|-------------|-------|------|-------|
| save | 10 | [] | Push graphics state |
| restore | 11 | [] | Pop graphics state |
| transform | 12 | [a,b,c,d,e,f] | Concatenate CTM |
| moveTo | 13 | [x,y] | Path op -- 2 coords |
| lineTo | 14 | [x,y] | Path op -- 2 coords |
| curveTo | 15 | [x1,y1,x2,y2,x3,y3] | Path op -- 6 coords |
| curveTo2 | 16 | [x1,y1,x2,y2] | Path op -- 4 coords |
| curveTo3 | 17 | [x1,y1,x2,y2] | Path op -- 4 coords |
| closePath | 18 | [] | Path op -- 0 coords |
| rectangle | 19 | [x,y,w,h] | Path op -- 4 coords |
| beginMarkedContent | 69 | [tag] | Layer start (no OCG ID) |
| beginMarkedContentProps | 70 | [tag, {id}] | Layer start WITH OCG ID |
| endMarkedContent | 71 | [] | Layer end |
| constructPath | 91 | [opsArray, coordsArray] | Batched path operations |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| pdf.js UMD/CommonJS bundle | ESM-only (pdf.mjs) | pdf.js 4.x to 5.x | Must use script type=module and CDN ESM URL |
| getGroups() API | for...of config Symbol.iterator | Undocumented / 5.x | Most tutorials show wrong API |
| Per-operator path building | Batched constructPath (fn=91) | pdf.js 3.x+ | Single operator carries entire path |
| Text layer only extraction | Dual pipeline: text + operator list | Phase 1 design | Required because circles/polylines are graphics |

**Deprecated/outdated:**
- pdfjs-dist/build/pdf.js (UMD): Removed in 5.x; replaced by build/pdf.mjs
- config.getGroups(): Never existed in stable API; use Symbol.iterator

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | PDF circles are 4 cubic Bezier segments; bounding box midpoint is accurate centroid | Pattern 6 | Circle centroid wrong; spatial matching fails |
| A2 | Distancia_Poste OCG name has no accent (CONTEXT.md shows accented variant) | Pitfall 8 | Distance layer never found; all distances missing |
| A3 | All 4 expected layer names exist on page 2 of sample PDF | Walking Skeleton | Skeleton passes trivially but full parser fails on other pages |
| A4 | CTM transform ops do not shift constructPath coordinates in sample PDF; Pattern 8 not needed | Pattern 8 | Circle/polyline positions offset; spatial matching fails |
| A5 | Sequential post numbers on TEXTO layer are exactly 2 digits | Walking Skeleton AC4 | Some posts have 1 or 3 digits; regex needs adjustment |

---

## Open Questions

1. **Exact OCG layer name for distances**
   - What we know: CONTEXT.md uses Distancia_Poste; D-05 says encoding irrelevant for street names but layer names are OCG metadata
   - What is unclear: Whether the actual OCG group name has accent character
   - Recommendation: Walking Skeleton logs allNames -- resolve before implementing distance extraction

2. **Circle representation in Numero_Poste layer**
   - What we know: Red circles mark posts; pdf.js renders them correctly
   - What is unclear: Whether circles are 4 Bezier arcs, 1 rectangle, or ellipse operator
   - Recommendation: Walking Skeleton logs raw constructPath args for first Numero_Poste path

3. **Cable polyline continuity across pages**
   - What we know: D-09 says process all pages; D-12 says branch detection by geometric splitting
   - What is unclear: Whether Cabo Projetado polylines are self-contained per page or need cross-page stitching
   - Recommendation: Log cable segment count per page in skeleton phase

4. **Coordinate normalization strategy (D-18, Claude Discretion)**
   - Recommendation: Use raw PDF points for internal data structure. Apply flipY (Pattern 7) but keep units as PDF points. Normalization adds complexity without benefit since coordinates are converted to lat/lng in Phase 2.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Browser (any modern) | pdf.js ESM import | assumed yes | Chrome/Firefox/Edge | -- |
| pdfjs-dist@5.7.284 | All PDF extraction | CDN yes | 5.7.284 | jsDelivr / unpkg |
| Node.js | Dev/testing only | yes | check local | Not needed for browser phase |
| npm | Dependency management | yes | check local | CDN bypasses npm entirely |

**No blocking missing dependencies.** Phase 1 loads pdf.js exclusively from CDN; no npm install required for browser functionality.

---

## Validation Architecture

Phase 1 has no automated test framework (no bundler, no test runner per project constraint). Validation is manual via Walking Skeleton.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None (vanilla HTML, no bundler) |
| Config file | none |
| Quick run command | Open test/skeleton-test.html in browser, load sample PDF, verify console output |
| Full suite command | Same -- all 5 Walking Skeleton acceptance criteria must pass |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Notes |
|--------|----------|-----------|-------|
| PDF-01 | pdf.js loads and parses the sample PDF | manual | Verify AC1 + AC2 in console |
| PDF-02 | Post numbers extracted from TEXTO layer | manual | Verify AC3 + AC4 in console |
| PDF-03 | Distances extracted from Distancia_Poste layer | manual | Log distance layer items in skeleton |
| PDF-04 | Post x,y positions extracted | manual | Log circle centroids in skeleton |
| PDF-05 | N/A -- encoding issues eliminated by D-05 | -- | No test needed |

### Wave 0 Gaps
- [ ] test/skeleton-test.html -- Walking Skeleton HTML page with file input and console logging
- [ ] No framework install needed -- CDN-only

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | -- |
| V3 Session Management | no | -- |
| V4 Access Control | no | -- |
| V5 Input Validation | yes | Validate PDF ArrayBuffer before passing to pdfjsLib.getDocument; catch parse errors |
| V6 Cryptography | no | -- |

### Known Threat Patterns for browser PDF parsing

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed PDF causing getDocument to throw | Denial of Service | Wrap in try/catch; show user-friendly error |
| PDF with embedded JavaScript | Tampering | pdf.js disables PDF JS execution by default; no action needed |
| Very large PDF exhausting browser memory | Denial of Service | Show warning if file.size > 50MB before loading |

---

## Sources

### Primary (HIGH confidence)
- pdf.js GitHub source (src/shared/util.js) -- OPS constant values verified
- pdf.js GitHub source (src/display/optional_content_config.js) -- Symbol.iterator API verified
- npm registry (npmjs.com/package/pdfjs-dist) -- version 5.7.284 confirmed 2026-05-13
- jsDelivr (cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284) -- ESM build files confirmed
- cdnjs.com/libraries/pdf.js -- latest version 5.4.149 confirmed (use jsDelivr for 5.7.284)

### Secondary (MEDIUM confidence)
- pdf.js GitHub issue #18410 -- constructPath args=[opsArray, coordsArray] pattern
- mozilla.github.io/pdf.js/getting_started -- CDN setup and workerSrc requirement
- .planning/research/PITFALLS.md -- Y-axis inversion, multi-page continuity, text grouping pitfalls

### Tertiary (LOW confidence)
- Circle as 4 Bezier arcs assumption -- derived from PDF spec knowledge; not verified against sample PDF [ASSUMED: A1]
- Accent in Distancia_Poste OCG name -- unverified; Walking Skeleton will resolve [ASSUMED: A2]

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- pdfjs-dist 5.7.284 verified via npm registry; CDN URLs verified via jsDelivr
- Architecture: HIGH -- OCG API verified from pdf.js source; constructPath structure verified from issue #18410
- Pitfalls: HIGH for API pitfalls (verified from source); MEDIUM for data-specific pitfalls

**Research date:** 2026-05-13
**Valid until:** 2026-06-13 (pdf.js minor versions release frequently; re-verify CDN URL if > 30 days)
