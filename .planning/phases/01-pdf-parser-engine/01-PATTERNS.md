# Phase 1: PDF Parser Engine - Pattern Map

**Mapped:** 2026-05-13
**Files analyzed:** 10 (9 new files + 1 entry point)
**Analogs found:** 1 / 10 (partial prototype only; all other files have no analog)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `index.html` | config / entry point | request-response | `extract_pdf.js` (partial) | weak — different runtime |
| `test/skeleton-test.html` | test | request-response | `extract_pdf.js` (partial) | weak — different library |
| `parser/ocg-map.js` | utility | transform | none | no analog |
| `parser/text-extractor.js` | service | transform | `extract_pdf.js` lines 23-34 | partial — same iteration intent |
| `parser/graphics-extractor.js` | service | transform | none | no analog |
| `parser/construct-path-parser.js` | utility | transform | none | no analog |
| `parser/post-assembler.js` | service | transform | none | no analog |
| `parser/distance-associator.js` | service | transform | none | no analog |
| `parser/cable-builder.js` | service | transform | none | no analog |
| `parser/pdf-parser.js` | service (orchestrator) | request-response | `extract_pdf.js` lines 18-37 | partial — event loop structure only |

---

## Pattern Assignments

### `index.html` (config / entry point, request-response)

**Analog:** none (CDN ESM pattern is new to this project)

**pdf.js CDN load pattern** (RESEARCH.md Pattern 1 — verified: mozilla.github.io/pdf.js):
```html
<script type="module">
import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.worker.min.mjs';
</script>
```

**File input to ArrayBuffer pattern** (standard FileReader API):
```javascript
document.getElementById('fileInput').addEventListener('change', async (e) => {
  const buf = await e.target.files[0].arrayBuffer();
  // pass buf to parsePdf()
});
```

**Size guard pattern** (RESEARCH.md security V5 input validation):
```javascript
if (e.target.files[0].size > 50 * 1024 * 1024) {
  showError('File exceeds 50 MB limit');
  return;
}
```

---

### `test/skeleton-test.html` (test, request-response)

**Analog:** none (no test files exist in the codebase)

**Complete Walking Skeleton pattern** (RESEARCH.md Walking Skeleton section — copy verbatim):
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

**Acceptance criteria (all 5 must pass on the real sample PDF):**
1. `pdfjsLib.version` logs correctly (AC1)
2. `allNames` contains all 4 expected layer names (AC2)
3. `hasBeginMarked` is `true` (AC3)
4. `textoItems` contains two-digit post number strings (AC4)
5. `numPosteCount` is > 0 (AC5)

---

### `parser/ocg-map.js` (utility, transform)

**Analog:** none (OCG API is new to this project)

**OCG map builder pattern** (RESEARCH.md Pattern 2 — verified: pdf.js src/display/optional_content_config.js):
```javascript
// parser/ocg-map.js
export async function buildOcgMap(pdfDoc) {
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

**Layer validation pattern** (D-08 — surface missing layer names, never fall back to unfiltered extraction):
```javascript
const REQUIRED_LAYERS = ['Numero_Poste', 'TEXTO', 'Distancia_Poste', 'Cabo Projetado'];
export function validateLayers(allNames) {
  const missing = REQUIRED_LAYERS.filter(name => !allNames.includes(name));
  return { valid: missing.length === 0, missing, allNames };
}
```

**Anti-pattern:** Do NOT call `config.getGroups()` — does not exist in pdf.js 5.x. Use `for...of config` (Symbol.iterator).

---

### `parser/text-extractor.js` (service, transform)

**Analog:** `extract_pdf.js` lines 23-34 — partial (same per-item iteration intent, different library)

**Prototype pattern from `extract_pdf.js` lines 23-34** (reference only — pdf2json, not pdf.js):
```javascript
// REFERENCE ONLY — pdf2json pattern, do NOT copy directly
pages.forEach((page, pageIdx) => {
  const texts = page.Texts || [];
  texts.forEach(textItem => {
    const text = textItem.R.map(r => safeDecode(r.T)).join('');
    const x = textItem.x;
    const y = textItem.y;
  });
});
```

**Correct pdf.js layer-filtered text pattern** (RESEARCH.md Pattern 3):
```javascript
// parser/text-extractor.js
export async function extractLayerText(page, idToName) {
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

Y-axis inversion must be applied to every `y` value after this call (see Shared Patterns).

---

### `parser/graphics-extractor.js` (service, transform)

**Analog:** none (getOperatorList OCG tracking is new to this project)

**Layer-filtered graphics extraction pattern** (RESEARCH.md Pattern 4 — verified: pdf.js OPS constants + github issue #18410):
```javascript
// parser/graphics-extractor.js
import { parseConstructPath } from './construct-path-parser.js';

export async function extractLayerGraphics(page, idToName) {
  const opList = await page.getOperatorList();
  const { fnArray, argsArray } = opList;
  const byLayer = {};
  let activeLayer = null;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i], args = argsArray[i];
    if (fn === 70) {                              // beginMarkedContentProps
      if (args && args.length > 1 && args[1] && args[1].id) {
        const name = idToName[args[1].id];
        if (name) activeLayer = name;
      }
    } else if (fn === 71) {                       // endMarkedContent
      activeLayer = null;
    } else if (fn === 91 && activeLayer) {        // constructPath
      if (!byLayer[activeLayer]) byLayer[activeLayer] = [];
      byLayer[activeLayer].push(parseConstructPath(args));
    }
  }
  return byLayer;
}
```

**OPS constants** (verified from pdf.js src/shared/util.js):
- `70` = beginMarkedContentProps — args: `[tag, {id: groupId}]`
- `71` = endMarkedContent — args: `[]`
- `91` = constructPath — args: `[opsArray, coordsArray]`

**Anti-pattern:** `fn === 69` is `beginMarkedContent` (no OCG ID attached). Only `fn === 70` carries the layer ID.

---

### `parser/construct-path-parser.js` (utility, transform)

**Analog:** none (PDF path decoding is new to this project)

**parseConstructPath pattern** (RESEARCH.md Pattern 5 — verified: pdf.js util.js PathType constants + github issue #18410):
```javascript
// parser/construct-path-parser.js
export function parseConstructPath(args) {
  const [ops, coords] = args;
  const result = [];
  let ci = 0;
  for (const op of ops) {
    switch (op) {
      case 13: result.push({ type: 'M', x: coords[ci++], y: coords[ci++] }); break;
      case 14: result.push({ type: 'L', x: coords[ci++], y: coords[ci++] }); break;
      case 15: result.push({ type: 'C',
        x1: coords[ci++], y1: coords[ci++],
        x2: coords[ci++], y2: coords[ci++],
        x3: coords[ci++], y3: coords[ci++] }); break;
      case 16: result.push({ type: 'C2',
        x1: coords[ci++], y1: coords[ci++],
        x2: coords[ci++], y2: coords[ci++] }); break;
      case 17: result.push({ type: 'C3',
        x1: coords[ci++], y1: coords[ci++],
        x2: coords[ci++], y2: coords[ci++] }); break;
      case 18: result.push({ type: 'Z' }); break;
      case 19: result.push({ type: 'R',
        x: coords[ci++], y: coords[ci++],
        w: coords[ci++], h: coords[ci++] }); break;
    }
  }
  return result;
}
```

**Critical constraint (Pitfall 4):** Each op type consumes a fixed but different number of coords. Never use fixed-stride iteration — always advance `ci` per-op.

**Circle centroid helper** (RESEARCH.md Pattern 6 — ASSUMED A1: bounding box midpoint):
```javascript
export function circleCentroid(pathOps) {
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

**Note — Assumption A1:** Walking Skeleton must log raw `Numero_Poste` constructPath args to verify circles are 4 Bezier arcs. If they are rectangles (op 19), use `{ x: r.x + r.w/2, y: r.y + r.h/2 }` instead.

---

### `parser/post-assembler.js` (service, transform)

**Analog:** none

**Spatial proximity matching pattern** (D-01 — pair Numero_Poste circle centroid with nearest TEXTO item):
```javascript
// parser/post-assembler.js
const PROXIMITY_THRESHOLD = 20; // PDF points — tune after Walking Skeleton

function distance2D(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

export function assemblePostData(textItems, circles, warnings = []) {
  const posts = [];
  const usedCircles = new Set();
  for (const text of textItems) {
    if (!/^\d{1,3}$/.test(text.str.trim())) continue; // skip non-numeric
    let nearest = null, nearestDist = Infinity;
    for (let i = 0; i < circles.length; i++) {
      if (usedCircles.has(i)) continue;
      const d = distance2D(text, circles[i]);
      if (d < nearestDist) { nearestDist = d; nearest = i; }
    }
    if (nearest === null || nearestDist > PROXIMITY_THRESHOLD) {
      warnings.push(`Post number "${text.str}" at (${text.x}, ${text.y}) has no nearby circle`);
      continue;
    }
    usedCircles.add(nearest);
    posts.push({ number: parseInt(text.str.trim(), 10), x: circles[nearest].x, y: circles[nearest].y });
  }
  return { posts, warnings };
}
```

**Deduplication pattern** (D-13 — keep first occurrence by sequential number):
```javascript
export function deduplicatePosts(allPosts) {
  const seen = new Set();
  return allPosts.filter(p => {
    if (seen.has(p.number)) return false;
    seen.add(p.number);
    return true;
  });
}
```

---

### `parser/distance-associator.js` (service, transform)

**Analog:** none

**Distance association pattern** (D-10 — sequential pairs, nearest Distancia_Poste text to midpoint):
```javascript
// parser/distance-associator.js
export function associateDistances(posts, distTexts, warnings = []) {
  const distances = [];
  const sortedPosts = [...posts].sort((a, b) => a.number - b.number);
  for (let i = 0; i < sortedPosts.length - 1; i++) {
    const from = sortedPosts[i], to = sortedPosts[i + 1];
    const midX = (from.x + to.x) / 2, midY = (from.y + to.y) / 2;
    let nearest = null, nearestDist = Infinity;
    for (const dt of distTexts) {
      if (!/^\d+(\.\d+)?$/.test(dt.str.trim())) continue;
      const d = Math.sqrt((dt.x - midX) ** 2 + (dt.y - midY) ** 2);
      if (d < nearestDist) { nearestDist = d; nearest = dt; }
    }
    if (!nearest) {
      warnings.push(`No distance found between posts ${from.number} and ${to.number}`);
      distances.push({ from: from.number, to: to.number, meters: null });
    } else {
      distances.push({ from: from.number, to: to.number, meters: parseFloat(nearest.str) });
    }
  }
  return { distances, warnings };
}
```

**Critical note — Assumption A2 (Pitfall 8):** Walking Skeleton must log `allNames` to confirm whether the layer is `Distancia_Poste` or `Distância_Poste` (with accent). D-08 manual mapping fallback handles any mismatch at runtime.

---

### `parser/cable-builder.js` (service, transform)

**Analog:** none

**Cable segment assembly pattern** (D-16 — preserve full polyline geometry for Phase 2 curved rendering):
```javascript
// parser/cable-builder.js
export function buildCableSegments(posts, cablePaths, warnings = []) {
  const cableSegments = cablePaths.map((path, idx) => ({
    id: idx,
    ops: path,
    startPoint: endpointFromPath(path, 'start'),
    endPoint:   endpointFromPath(path, 'end')
  }));
  return { cableSegments, warnings };
}

function endpointFromPath(ops, which) {
  const pts = ops.filter(op => op.type === 'M' || op.type === 'L');
  if (!pts.length) return null;
  const op = which === 'start' ? pts[0] : pts[pts.length - 1];
  return { x: op.x, y: op.y };
}
```

**Branch detection pattern** (D-12 — two segments sharing a junction within threshold):
```javascript
export function detectBranches(cableSegments, threshold = 5) {
  const branches = [];
  for (let i = 0; i < cableSegments.length; i++) {
    for (let j = i + 1; j < cableSegments.length; j++) {
      if (pointsClose(cableSegments[i].endPoint,   cableSegments[j].startPoint, threshold) ||
          pointsClose(cableSegments[i].startPoint, cableSegments[j].startPoint, threshold)) {
        branches.push({ segmentA: i, segmentB: j });
      }
    }
  }
  return branches;
}

function pointsClose(a, b, threshold) {
  if (!a || !b) return false;
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2) < threshold;
}
```

---

### `parser/pdf-parser.js` (service / orchestrator, request-response)

**Analog:** `extract_pdf.js` lines 18-37 — partial (event-driven entry + page loop concept maps to async/await)

**Prototype event pattern from `extract_pdf.js` lines 18-37** (reference only — pdf2json, not pdf.js):
```javascript
// REFERENCE ONLY — mental model only; wrong library
pdfParser.on('pdfParser_dataError', errData => console.error(errData.parserError));
pdfParser.on('pdfParser_dataReady', pdfData => {
  const pages = pdfData.Pages;
  pages.forEach((page, pageIdx) => { /* per-page extraction */ });
});
```

**Correct pdf.js orchestrator pattern** (D-09 all pages, D-13 dedup, D-07 warnings, D-16 rich output):
```javascript
// parser/pdf-parser.js
import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.mjs';
import { buildOcgMap, validateLayers }       from './ocg-map.js';
import { extractLayerText }                   from './text-extractor.js';
import { extractLayerGraphics }               from './graphics-extractor.js';
import { circleCentroid }                     from './construct-path-parser.js';
import { assemblePostData, deduplicatePosts } from './post-assembler.js';
import { associateDistances }                 from './distance-associator.js';
import { buildCableSegments }                 from './cable-builder.js';

export async function parsePdf(arrayBuffer) {
  const warnings = [];
  try {
    const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const { idToName, allNames } = await buildOcgMap(pdfDoc);
    const { valid, missing } = validateLayers(allNames);
    if (!valid) return { error: 'missing_layers', missing, allNames };  // D-08

    const allText = { TEXTO: [], Distancia_Poste: [] };
    const allCircles = [], allCablePaths = [];

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {   // D-09: all pages
      const page = await pdfDoc.getPage(pageNum);
      const pageHeight = page.view[3];
      const textByLayer = await extractLayerText(page, idToName);
      const gfxByLayer  = await extractLayerGraphics(page, idToName);

      for (const item of (textByLayer['TEXTO'] || []))
        allText.TEXTO.push({ ...item, y: pageHeight - item.y });            // flipY
      for (const item of (textByLayer['Distancia_Poste'] || []))
        allText.Distancia_Poste.push({ ...item, y: pageHeight - item.y }); // flipY
      for (const path of (gfxByLayer['Numero_Poste'] || []))
        allCircles.push(path.map(op => flipYInOp(op, pageHeight)));
      for (const path of (gfxByLayer['Cabo Projetado'] || []))             // D-04: exact name with space
        allCablePaths.push(path.map(op => flipYInOp(op, pageHeight)));
    }

    const circles = allCircles.map(circleCentroid);
    const { posts: rawPosts, warnings: aw } = assemblePostData(allText.TEXTO, circles, []);
    warnings.push(...aw);
    const posts = deduplicatePosts(rawPosts);                              // D-13
    const { distances, warnings: dw } = associateDistances(posts, allText.Distancia_Poste, []);
    warnings.push(...dw);
    const { cableSegments, warnings: cw } = buildCableSegments(posts, allCablePaths, []);
    warnings.push(...cw);

    return { posts, distances, cableSegments, warnings, layerMap: { allNames } }; // D-16
  } catch (err) {
    return { error: 'parse_failed', message: err.message, warnings };
  }
}

function flipYInOp(op, pageHeight) {
  const f = { ...op };
  if (f.y  !== undefined) f.y  = pageHeight - f.y;
  if (f.y1 !== undefined) f.y1 = pageHeight - f.y1;
  if (f.y2 !== undefined) f.y2 = pageHeight - f.y2;
  if (f.y3 !== undefined) f.y3 = pageHeight - f.y3;
  return f;
}
```

---

## Shared Patterns

### Y-Axis Inversion
**Source:** RESEARCH.md Pattern 7 (verified: pdf.js getViewport() API docs)
**Apply to:** All extracted coordinates in `text-extractor.js`, `graphics-extractor.js`, `pdf-parser.js`
```javascript
// page.view = [x, y, width, height]; page.view[3] = page height in PDF points
const pageHeight = page.view[3];
const correctedY = pageHeight - rawY;   // apply immediately after extraction, before storing
```

### Warning Accumulation (D-07)
**Source:** CONTEXT.md D-07
**Apply to:** `post-assembler.js`, `distance-associator.js`, `cable-builder.js`, `pdf-parser.js`
```javascript
// Function signature convention: fn(inputs, warnings = []) -> { result, warnings }
// Never throw for per-element failures — push and continue
warnings.push(`Skipping element: ${reason}`);
// continue processing
```

### ESM Export Style
**Source:** RESEARCH.md Architecture (no bundler, CDN ESM)
**Apply to:** All `parser/*.js` files
```javascript
// Named ESM exports only — no CommonJS require()
export function myFunction() { ... }
export async function myAsyncFunction() { ... }
```

### Error Wrapping (top-level only)
**Source:** RESEARCH.md security V5 + `extract_pdf.js` line 18 (error event handler)
**Apply to:** `pdf-parser.js` only — inner modules surface errors as warnings, not throws
```javascript
try {
  const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
} catch (err) {
  return { error: 'parse_failed', message: err.message, warnings };
}
```

### Numeric Regex Patterns
**Source:** CONTEXT.md D-01/D-03; RESEARCH.md Assumption A5
**Apply to:** `post-assembler.js` (post numbers), `distance-associator.js` (distance values)
```javascript
/^\d{1,3}$/          // post sequential numbers (1-3 digits; confirm from Walking Skeleton AC4)
/^\d+(\.\d+)?$/      // distance values in meters (integer or decimal)
```

---

## No Analog Found

Files with no match in the codebase — planner must use RESEARCH.md patterns directly:

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `parser/ocg-map.js` | utility | transform | OCG API (getOptionalContentConfig + Symbol.iterator) entirely new |
| `parser/graphics-extractor.js` | service | transform | getOperatorList extraction does not exist in codebase |
| `parser/construct-path-parser.js` | utility | transform | PDF constructPath op/coord decoding is new |
| `parser/post-assembler.js` | service | transform | Spatial proximity matching is new |
| `parser/distance-associator.js` | service | transform | Sequential pair distance association is new |
| `parser/cable-builder.js` | service | transform | Polyline stitching and branch detection is new |

---

## Prototype Reuse Notes

`extract_pdf.js` provides two conceptual reference points (neither is directly copyable — wrong library and runtime):

1. **`safeDecode()` (lines 10-16):** URI decode with try/catch fallback. Not needed in Phase 1 per D-05 (encoding issues eliminated; only numeric data extracted).

2. **Per-page loop + per-item coordinate extraction (lines 23-34):** The mental model of iterating pages then items and extracting `{x, y, text}` maps directly to the pdf.js async equivalent. The key difference is `beginMarkedContentProps` sentinel detection which pdf2json does not require (no OCG awareness).

---

## Metadata

**Analog search scope:** Entire repository (`C:\Users\Usuario\Documents\GitHub\pdf-to-kmz`)
**Files scanned:** 2 source files (`extract_pdf.js`, `package.json`)
**Analog coverage:** 1 partial analog applies weakly to 3 files; 6 files have no analog
**Pattern extraction date:** 2026-05-13
**Key constraint:** Greenfield browser-only project (no bundler, CDN ESM). All patterns sourced from RESEARCH.md verified references, not from the codebase itself.
