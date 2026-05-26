# Phase 3: KMZ Generator with Customization - Pattern Map

**Mapped:** 2026-05-26  
**Files analyzed:** 10 (8 new/modified + 2 test files)  
**Analogs found:** 9 / 10

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `parser/kml-color.js` | utility | transform | `parser/geo/utm-calibrator.js` | exact |
| `parser/kmz-defaults.js` | config | transform | `parser/layer-sources.js` + RESEARCH merge pattern | role-match |
| `parser/kml-builder.js` | service | transform | `parser/coordinate-calculator.js` | exact |
| `parser/kmz-packager.js` | service | file-I/O | `parser/pdf-parser.js` (`getPdfjsLib`) | exact |
| `parser/pdf-parser.js` (modify) | route/barrel | re-export | existing re-export block (lines 65–73) | exact |
| `index.html` (modify) | component | request-response | calc handler + `showWarnings` / `showStatus` | exact |
| `package.json` (modify) | config | — | existing `dependencies` block | exact |
| `parser/__tests__/kml-color.test.mjs` | test | batch | `parser/__tests__/route-sequence.test.mjs` | exact |
| `parser/__tests__/kml-builder.test.mjs` | test | batch | `parser/__tests__/coordinate-calculator.test.mjs` | role-match |
| `generateKmz` wrapper (optional in `pdf-parser.js`) | service | transform | thin async over two-step API | partial (new) |

---

## Pattern Assignments

### `parser/kml-color.js` (utility, transform)

**Analog:** `parser/geo/utm-calibrator.js`

**File header / export convention** (lines 1–6):

```1:6:parser/geo/utm-calibrator.js
// parser/geo/utm-calibrator.js
// UTM calibration math for per-page coordinate projection.
// Implements Snyder Transverse Mercator (forward + inverse) with WGS-84 / SIRGAS-2000 constants.
// All functions are browser-compatible (Math.* only, no Node.js APIs).
//
// Named ESM exports only — no default export, no CommonJS require.
```

**Pure function pattern** (lines 25–48):

```25:48:parser/geo/utm-calibrator.js
export function latLonToUtm(lat_deg, lon_deg) {
  const zone = Math.floor((lon_deg + 180) / 6) + 1;
  const lon0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;
  const phi = lat_deg * Math.PI / 180;
  // ...
  return { easting, northing, zone };
}
```

**Apply to `kml-color.js`:**
- Top-of-file comment describing KML `aabbggrr` + browser/Node compatibility.
- `export function hexToKmlColor(hex, alpha = 0xff)` with input validation (`throw new Error(...)` on bad hex) — mirror strict math helpers in geo modules.
- Optional `export function presetToKmlColor(key)` delegating to `hexToKmlColor` after lookup (no classes, no default export).

---

### `parser/kmz-defaults.js` (config, transform)

**Analog:** `parser/layer-sources.js` (constants + small pure exports) + RESEARCH Pattern 4

**Module style** (lines 1–5, 14–22):

```1:5:parser/layer-sources.js
// parser/layer-sources.js
// Maps real-world optional-content names (AutoCAD / civil exports) onto parser roles.
// Keep in sync with debug-pdf.mjs heuristic filters if you change rules here.

import { normalizeName } from './ocg-map.js';
```

```14:22:parser/layer-sources.js
export function isPostLabelSourceLayerName(rawName) {
  const n = normalizeName(rawName);
  if (n === normalizeName('TEXTO')) return true;
  if (n === normalizeName('Numero_Poste')) return true;
  // ...
  return false;
}
```

**Apply to `kmz-defaults.js`:**
- `export const DEFAULT_OPTIONS = { iconHref, iconColor, lineColor, lineWidth, labelColor, labelScale, lineDescription }` — document chosen square `href` in comment (D-IC-02).
- `export const PRESET_COLORS = { red: '#ff0000', ... }` or preset → KML cache built via `hexToKmlColor` from `kml-color.js`.
- `export function mergeOptions(user = {}) { return { ...DEFAULT_OPTIONS, ...user }; }` — shallow merge only (D-ST-02).
- `export function resolveStyleColors(merged)` — map preset keys to KML `aabbggrr` strings for IconStyle/LineStyle/LabelStyle (keeps builder free of color logic).

---

### `parser/kml-builder.js` (service, transform)

**Analog:** `parser/coordinate-calculator.js`

**Return contract + warnings array** (lines 786–799, 1613–1619):

```786:799:parser/coordinate-calculator.js
 * @returns {{ posts: Array, connections: Array, warnings: string[] }}
 */
export function calculateCoordinates(
  posts,
  distances,
  startLat,
  startLon,
  cableSegments = [],
  opts = null,
) {
  if (!posts || posts.length === 0)
    return { posts: [], connections: [], warnings: [] };

  const warnings = [];
```

```1613:1619:parser/coordinate-calculator.js
      warnings.push(
        `[coordinate-calculator] label sanity-check: segment ${c.from}->${c.to} label=${labelM.toFixed(1)}m vs haversine=${hav.toFixed(1)}m (delta=${(hav - labelM).toFixed(1)}m, tol=${tolerance.toFixed(1)}m).`,
      );
    }
  }

  return { posts: sorted, connections, warnings };
}
```

**Post lookup Map** (lines 805–806):

```805:806:parser/coordinate-calculator.js
  const postMap = new Map(sorted.map((p) => [p.number, p]));
```

**Connection edge shape (consumer contract)** (lines 1536–1543, 1582–1589):

```1536:1543:parser/coordinate-calculator.js
          connections.push({
            from: junc.number,
            to: curr.number,
            meters,
            bearing,
            gap: false,
            ...(isCrossPage ? { cross_page: true } : {}),
          });
```

**Apply to `kml-builder.js`:**
- `export function buildKml(posts, connections, options)` → `{ kml, stats }` where `stats` includes `{ placemarkCount, lineCount, omittedNoGps, skippedLines?, warnings }` (D-API-02).
- `const postByNum = new Map(posts.map(p => [p.number, p]))`; iterate **`connections[]` only** (D-LN-01) — do not chain `post[i] → post[i+1]`.
- GPS gate: skip posts with `lat == null || lon == null`; increment `omittedNoGps`, `warnings.push('[kml-builder] ...')` (D-PM-03).
- Skip line edges when either endpoint lacks GPS; count `skippedLines` + warning `from→to`.
- Placemark names: `Poste ${String(n).padStart(2, '0')}` (D-PM-01) — same as UI preview in `index.html` lines 680–684.
- Description: `Lat: …, Lon: …` only (D-PM-02); use `escapeXml()` helper for all text nodes.
- KML coordinates: **`lon,lat,0`** per KML spec; `altitudeMode` `clampToGround` on Point and LineString (D-PM-04).
- Line placemarks: shared `styleUrl #routeLine`; same `lineDescription` on every line (D-LN-05).
- Template-string XML assembly (RESEARCH Pattern 1): shared `<Style id="postPoint">` and `<Style id="routeLine">` at Document level.

---

### `parser/kmz-packager.js` (service, file-I/O)

**Analog:** `parser/pdf-parser.js` — lazy dual-environment import

**Lazy import cache** (lines 15–35):

```15:35:parser/pdf-parser.js
/** Browser CDN vs Node legacy build (debug-run-calc.mjs). */
let _pdfjsLibPromise = null;
async function getPdfjsLib() {
  if (!_pdfjsLibPromise) {
    _pdfjsLibPromise = (async () => {
      if (typeof process !== 'undefined' && process.versions?.node) {
        const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
        lib.GlobalWorkerOptions.workerSrc = new URL(
          '../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
          import.meta.url
        ).href;
        return lib;
      }
      const lib = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.mjs');
      lib.GlobalWorkerOptions.workerSrc =
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.worker.min.mjs';
      return lib;
    })();
  }
  return _pdfjsLibPromise;
}
```

**Apply to `kmz-packager.js`:**
- `let _jsZipPromise = null; async function getJSZip() { ... }` with Node `import('jszip')` and browser `import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm')`.
- `export async function packageKmz(kmlString) { const JSZip = await getJSZip(); const zip = new JSZip(); zip.file('doc.kml', kmlString); return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }); }` — **only** `doc.kml` at ZIP root (KMZ-04).
- No pdf.js dependency; packager stays side-effect free aside from zip.

---

### `parser/pdf-parser.js` (modify — re-exports)

**Analog:** existing Phase 2 re-export block

**Re-export pattern** (lines 56–73):

```56:73:parser/pdf-parser.js
import {
  calculateCoordinates,
  parseCoordinateInput,
  validateBrazilBounds,
  detectRouteTopology,
  detectGaps,
  CALC_PIPELINE_ID,
} from './coordinate-calculator.js';

// Re-export coordinate calculator functions for single-entry-point imports (Phase 2).
export {
  calculateCoordinates,
  parseCoordinateInput,
  validateBrazilBounds,
  detectRouteTopology,
  detectGaps,
  CALC_PIPELINE_ID,
};
```

**Apply:**
- Import `buildKml` from `./kml-builder.js`, `packageKmz` from `./kmz-packager.js`, `mergeOptions` / `DEFAULT_OPTIONS` from `./kmz-defaults.js`, `hexToKmlColor` from `./kml-color.js`.
- Add named `export { buildKml, packageKmz, mergeOptions, DEFAULT_OPTIONS, hexToKmlColor }` (and optional `generateKmz` async wrapper).
- Keep **named ESM only** — no default export (file header lines 13–13).

---

### `index.html` (modify — dev download UI)

**Analog:** Calculate Route handler, status/warnings, result section

**ESM import from single entry** (line 359):

```359:360:index.html
    import { parsePdf, parseCoordinateInput, validateBrazilBounds, calculateCoordinates, CALC_PIPELINE_ID } from './parser/pdf-parser.js';
    import { computeScaleFactor, buildPageTransforms } from './parser/geo/utm-calibrator.js';
```

**Extend to:** `buildKml`, `packageKmz`, `mergeOptions` from `./parser/pdf-parser.js`.

**Module state** (line 466):

```466:466:index.html
    let currentParseData = null; // Store posts and distances from Phase 1
```

**Add:** `let lastCalcResult = null;` — set after successful `calculateCoordinates` with `{ posts, connections, warnings }`.

**Status helper** (lines 468–472):

```468:472:index.html
    function showStatus(message, type) {
      statusEl.textContent = message;
      statusEl.className = type; // 'error' | 'success' | 'info'
      statusEl.style.display = 'block';
    }
```

**Calc warnings prefix `[calc]`** (lines 649–655):

```649:655:index.html
      const calcWarnings = result && Array.isArray(result.warnings) ? result.warnings : [];
      for (const w of calcWarnings) {
        const li = document.createElement('li');
        li.textContent = '[calc] ' + w;
        document.getElementById('warningsList').appendChild(li);
      }
```

**Post preview naming** (lines 680–684):

```680:684:index.html
      const preview = calculatedPosts.slice(0, 10).map(p => {
        const latStr = p.lat != null ? p.lat.toFixed(6) : 'N/A';
        const lonStr = p.lon != null ? p.lon.toFixed(6) : 'N/A';
        return `Post ${String(p.number).padStart(2, '0')}: ${latStr}, ${lonStr} ${p.postType ? '('+p.postType+')' : ''}`;
      }).join('\n');
```

**Apply (03-UI-SPEC):**
- HTML inside `#resultSection`, below `#outputPreview`: `#downloadKmzBtn.btn-primary`, `#kmzStats.panel`, `#kmzStatsHint.hint`.
- CSS: reuse `.btn-primary`, `.panel`, `.hint`; add only `#downloadKmzBtn:disabled { opacity: 0.55; cursor: not-allowed; }` and `#kmzStats` display rules.
- On calc success: `lastCalcResult = result`; show download block; enable button if any post has GPS (`placemarkCount > 0` after dry count or from stats).
- On download click: `aria-busy="true"`, label **Building KMZ…**; `const opts = mergeOptions({}); const { kml, stats } = buildKml(...)`; `const blob = await packageKmz(kml)`; Blob download via `URL.createObjectURL` + `<a download="route.kmz">` + `URL.revokeObjectURL`.
- KMZ warnings: prefix `[kmz]` when appending to `#warningsList` (mirror `[calc]`).
- Success: `showStatus('KMZ ready — open in Google Earth.', 'success')` (UI-SPEC copy).
- Store/revoke prior object URL on re-download (UI-SPEC interaction table).

**Result section anchor** (lines 303–307):

```303:307:index.html
  <section id="resultSection" style="display: none; margin-top: 32px;">
    <h2>Step 3: Output</h2>
    <p>Preview of calculated posts (up to first 10):</p>
    <pre id="outputPreview"></pre>
  </section>
```

Insert download block immediately after `outputPreview` closing tag.

---

### `package.json` (modify)

**Analog:** existing `dependencies` + `"type": "module"`

```12:20:package.json
  "type": "module",
  "dependencies": {
    "@napi-rs/canvas": "^1.0.0",
    "canvas": "^3.2.3",
    "pdf-parse": "^2.4.5",
    "pdf2json": "^4.0.3",
    "pdfjs-dist": "^5.7.284",
    "tesseract.js": "^5.1.1"
  }
```

**Apply:** add `"jszip": "3.10.1"` to `dependencies`. Optionally extend `"scripts": { "test": "node --test parser/__tests__/*.test.mjs" }` — follow project convention when wiring tests.

---

### `parser/__tests__/kml-color.test.mjs` (test, batch)

**Analog:** `parser/__tests__/route-sequence.test.mjs` (preferred for new Phase 3 tests)

```1:8:parser/__tests__/route-sequence.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectSequenceFlipPages,
  remapBrowserPostNumber,
  remapBrowserPostsToParserOrder,
} from '../geo/route-sequence.js';
```

**Apply:**
- `describe('kml-color', () => { it('converts #ff0000 to ff0000ff', () => { ... }); ... })`.
- Cover `hexToKmlColor('#ff0000')`, blue swap `('#0000ff' → 'ffff0000')`, invalid hex throws.
- Run: `node --test parser/__tests__/kml-color.test.mjs`.

---

### `parser/__tests__/kml-builder.test.mjs` (test, batch — optional)

**Analog:** `parser/__tests__/coordinate-calculator.test.mjs` (structural / contract asserts)

```38:45:parser/__tests__/coordinate-calculator.test.mjs
console.log('\n[Test Group 1] Structural exports present');
const src = readFileSync(calculatorPath, 'utf8');
assert(src.includes('export function parseCoordinateInput'), 'parseCoordinateInput exported');
assert(src.includes('export function validateBrazilBounds'), 'validateBrazilBounds exported');
```

**Apply (if added):**
- Assert `buildKml` export exists; output contains `xmlns="http://www.opengis.net/kml/2.2"`, `clampToGround`, `Poste 01`, `styleUrl>#postPoint`.
- Fixture: 2 posts with GPS + 1 connection; assert `stats.placemarkCount === 2`, `stats.lineCount === 1`.
- Or use `node:test` + `assert.match(kml, /<name>Poste 01<\/name>/)` for clearer failures.

---

## Shared Patterns

### Named ESM exports only (no default export)

**Source:** `parser/pdf-parser.js`, `parser/geo/utm-calibrator.js`, `parser/geo/route-sequence.js`  
**Apply to:** all new `parser/kml-*.js`, `parser/kmz-*.js`

```13:13:parser/pdf-parser.js
// Named ESM export only — no default export, no CommonJS require.
```

### Warnings with module prefix

**Source:** `parser/coordinate-calculator.js`  
**Apply to:** `kml-builder.js` warnings; UI prefixes `[kmz]` in `index.html`

```1613:1615:parser/coordinate-calculator.js
      warnings.push(
        `[coordinate-calculator] label sanity-check: segment ${c.from}->${c.to} label=${labelM.toFixed(1)}m vs haversine=${hav.toFixed(1)}m (delta=${(hav - labelM).toFixed(1)}m, tol=${tolerance.toFixed(1)}m).`,
      );
```

Use `[kml-builder]` in builder strings; surface in UI as `'[kmz] ' + w`.

### Zero-padded post labels (UI + KML must match)

**Source:** `index.html` calc preview  
**Apply to:** `kml-builder.js` `<name>` and line placemark titles

```680:684:index.html
        return `Post ${String(p.number).padStart(2, '0')}: ${latStr}, ${lonStr} ${p.postType ? '('+p.postType+')' : ''}`;
```

KML uses `Poste` prefix per D-PM-01: `` `Poste ${String(p.number).padStart(2, '0')}` ``.

### Design tokens for new UI (no new palette)

**Source:** `index.html` `:root` (lines 8–43), `.btn-primary` (120–125), `#status.success` (156–160), `#warnings` (187–190)  
**Apply to:** download button, stats panel, warning-colored omitted-GPS line

```8:28:index.html
    :root {
      --canvas: #f7f5f1;
      --surface: #ffffff;
      --accent: #2d6b5a;
      --success: #1f5c38;
      --success-bg: #e8f3ec;
      --warning: #6b4e12;
      --warning-bg: #faf3e3;
      --error: #8b1f2e;
      --error-bg: #fceef0;
```

### Phase 2 input contract (do not re-derive edges)

**Source:** `parser/coordinate-calculator.js` return + JSDoc  
**Apply to:** `kml-builder.js` only

- `posts[]`: `{ number, lat, lon, x, y, pageNum?, postType?, ... }`
- `connections[]`: `{ from, to, meters, bearing, gap, cross_page? }`

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `escapeXml()` in `kml-builder.js` | utility | transform | No XML/string-builder utilities in repo; implement inline (~5 lines) per RESEARCH Pitfall 2 |
| `generateKmz()` wrapper | service | transform | Optional thin compose; no existing two-step string→blob pipeline — follow RESEARCH Pattern 2 only |

---

## Metadata

**Analog search scope:** `parser/`, `parser/geo/`, `parser/__tests__/`, `index.html`, `package.json`  
**Files scanned:** 22 parser modules + 11 test files + `index.html`  
**Pattern extraction date:** 2026-05-26
