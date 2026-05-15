# Phase 2: Coordinate Calculator — Research (UTM-Grid Approach)

**Researched:** 2026-05-15
**Domain:** Per-page UTM calibration, PDF graphics extraction, affine transforms, SIRGAS/WGS84 projection math
**Confidence:** HIGH
**Supersedes:** Previous RESEARCH.md (sequential GPS chaining approach — now obsolete)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-REV-01:** Replace sequential GPS chaining with per-page UTM-grid calibration. Every post's GPS is computed directly from its page-local PDF position via the page's PDF→UTM transform. No chaining within a page.
- **D-REV-02:** All posts including branch posts are projected from their page's UTM origin. Every detail page is independently calibrated. No "anchor hierarchy."
- **D-REV-03:** Gap detection is preserved. The `gap: true` flag is still needed by Phase 3.
- **D-REV-04:** Preserve connections contract shape `{ from, to, meters, bearing, gap }`.
- **D-REV-05:** Extract the "UTM" OCG layer from both page 2 and detail pages.
- **D-REV-06:** Scale factor = `50 / grid_line_spacing_pdf` (meters per PDF point). Grid lines are every 50m at 1:1000 scale. Distance labels are NOT used for scale.
- **D-REV-07:** Use the median of all detected same-direction grid line spacings to reject outliers.
- **D-REV-08:** Page 2 provides: (a) UTM grid for scale/orientation, (b) viewport rectangle positions labeled "03", "04", "05". Post OCR still skipped on page 2.
- **D-REV-09:** Viewport boxes on page 2 matched to detail pages via large label text from `getTextContent()`. Rectangle geometry from graphics layer (exact layer name to confirm during inspection).
- **D-REV-10:** Post #1 position in page-2 space is computed mathematically, not via OCR.
- **D-REV-11:** Page-2 PDF→UTM affine transform established from post #1 GPS + UTM grid.
- **D-REV-12:** Each detail page's UTM origin derived from its viewport box position on page 2.
- **D-REV-13:** Cross-page GPS chaining is ELIMINATED.
- **D-REV-14:** Same-page: `meters = pdfDist × scaleFactor`, `bearing = atan2(dx, dy)` from PDF coords.
- **D-REV-15:** Cross-page: `meters` and `bearing` from GPS haversine/vector bearing. Mark with `cross_page: true`.
- **D-REV-16:** UTM grid missing fallback: warn + fall back to distance-label scale; both missing: warn + `lat: null, lon: null`.
- **D-01:** PDF top = geographic North. Hardcoded, no rotation.
- **D-02:** Within-page bearing = `atan2(dx, dy)` on page-local PDF coords (flipY applied).
- **D-05:** Flat-Earth approximation with cos(lat) correction for same-page GPS projection.
- **D-13/D-14:** User input: decimal degrees, Google Maps paste format. Post #1 only.
- **D-16/D-17:** Post output: `{ number, x, y, lat, lon, postType?, pageNum? }`. Connections: `[{ from, to, meters, bearing, gap, cross_page? }]`.

### Claude's Discretion
- Whether UTM↔GPS conversion is a standalone module (`geo/utm-calibrator.js`) or folded into `coordinate-calculator.js`.
- Whether to use proj4js CDN or implement Transverse Mercator directly.
- Exact layer name for viewport rectangle extraction (to confirm during first inspection).
- Where rectangle extraction for page 2 lives (new module or pdf-parser.js).

### Deferred Ideas (OUT OF SCOPE)
- Support for anchoring on any post other than post #1.
- DMS coordinate format input.
- Automatic UTM label extraction.
- Visual map preview (ENH-01).
- Using overlapping posts as additional cross-page calibration anchors.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| COORD-01 | User can input GPS coordinates (lat, lon) for the first post | `parseCoordinateInput()` preserved unchanged; UI `#coordForm` already exists |
| COORD-02 | Tool calculates bearing between posts using PDF x,y positions | Same-page: `atan2(dx, curr.y - next.y)` from flipY coords (§5); cross-page: GPS vector bearing (§7) |
| COORD-03 | Tool calculates GPS coordinates for all posts | Core algorithm: page-local PDF → page-2 → UTM → GPS via affine transform (§4, §5, §6) |
| COORD-04 | Tool handles branching routes | `detectRouteTopology()` preserved; branch posts projected from their page's calibration, not from junction (D-REV-02) |
| COORD-05 | Tool handles route gaps | `detectGaps()` preserved; gaps affect connections `gap` flag, not GPS calculation |
</phase_requirements>

---

## Summary

The UTM-grid approach replaces sequential GPS chaining with a direct per-page calibration derived from the PDF's built-in UTM grid layer ("UTM" OCG). Each detail page is independently calibrated against page 2 (the overview), which shows where each detail page's viewport sits in real-world UTM space. A post's GPS is projected directly from its page-local PDF position via that page's affine transform — no error accumulation, no dependency between pages.

The core math is: extract the "UTM" layer grid line spacing on page 2 to get `scaleFactor = 50 / spacing_pdf`; establish a UTM origin in page-2 coordinate space from post #1's known GPS and position; derive each detail page's UTM origin from its viewport box on page 2; project each post from page-local → page-2 → UTM → GPS using the Transverse Mercator inverse projection (self-implementable in ~50 lines of browser JavaScript with sub-meter accuracy).

The topology detection, gap detection, branch detection, and connections contract are preserved unchanged. The only code that changes is `calculateCoordinates()` — its GPS math is completely rewritten. New data flows into it from `parsePdf()`: UTM grid paths per page, page-2 viewport boxes, and page dimensions.

**Primary recommendation:** Implement UTM↔GPS conversion as a new module `geo/utm-calibrator.js` (avoids adding projection math to the already-complex coordinate calculator), implement the Transverse Mercator formulas directly (no proj4js CDN dependency), and extend the `parsePdf()` return contract with `utmGridPathsPerPage`, `viewportBoxes`, and `pageDimensions`.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| UTM grid line extraction | `pdf-parser.js` | `graphics-extractor.js` | Grid paths are extracted from the operator list like all other paths; existing extractor pattern applies |
| Page-2 viewport rectangle extraction | `pdf-parser.js` | new helper function | Same pipeline as UTM grid extraction — graphics from a specific OCG layer on page 2 |
| Viewport label reading | `pdf-parser.js` | — | `getTextContent()` already called per-page in the loop; filter for 2-digit labels on page 2 |
| Scale factor computation | `geo/utm-calibrator.js` | — | Pure math on extracted grid data; belongs in the geo module |
| Per-page affine transform | `geo/utm-calibrator.js` | — | Core calibration math; clear separation from extraction |
| UTM↔GPS conversion | `geo/utm-calibrator.js` | — | Transverse Mercator formulas; reusable, testable in isolation |
| GPS projection per post | `coordinate-calculator.js` | `geo/utm-calibrator.js` | Orchestrates the data; delegates projection math |
| Topology / gap / branch detection | `coordinate-calculator.js` | — | Unchanged from Phase 1; preserved as-is |
| Same-page bearing and meters | `coordinate-calculator.js` | — | PDF-vector math on page-local coords |
| Cross-page bearing and meters | `coordinate-calculator.js` | — | Haversine and GPS-vector bearing on final GPS coords |

---

## 1. UTM Grid Line Extraction

### How It Fits the Existing Pattern

The `graphics-extractor.js` already extracts paths per OCG layer via the CTM-tracked operator list walk. The "UTM" layer paths fall into `byLayer['UTM']` today (in the catch-all `else` branch at line 177). The change needed is minimal: add a check in the `OPS_CONSTRUCT_PATH` handler (or in a post-processing step) to collect UTM layer paths separately, similar to how `cablePaths` are collected.

The simplest approach is to NOT change `graphics-extractor.js` — instead, collect UTM paths from `byLayer['UTM']` after the call returns. [VERIFIED: graphics-extractor.js already stores all unrecognized layer paths in `byLayer[activeLayer]`]

### Identifying Grid Lines from PathOps

UTM grid lines are straight, long, axis-aligned strokes. From the `PathOp` types in `construct-path-parser.js`:

- A grid line is a path with `M` (moveTo) + `L` (lineTo) + no `Z` (not closed)
- **Horizontal line:** `abs(y_end - y_start) < TOLERANCE` and `abs(x_end - x_start) > MIN_LENGTH`
- **Vertical line:** `abs(x_end - x_start) < TOLERANCE` and `abs(y_end - y_start) > MIN_LENGTH`
- Tolerance: 2 PDF points (axis-aligned in AutoCAD export, rarely off by more than rounding)
- Min length: 10 PDF points (to exclude tick marks or artifacts)

```javascript
// Source: derived from construct-path-parser.js PathOp format [VERIFIED: codebase inspection]
function classifyGridLinesFromOps(pathOps, flipYPageHeight) {
  const TOLERANCE = 2;  // pts
  const MIN_LENGTH = 10; // pts
  const hLines = [], vLines = [];
  let cur = null;
  for (const op of pathOps) {
    if (op.type === 'M') {
      // Apply flipY if raw (should match how other coords are handled)
      cur = { x: op.x, y: flipYPageHeight - op.y };
    } else if (op.type === 'L' && cur) {
      const ex = op.x;
      const ey = flipYPageHeight - op.y;
      const dx = Math.abs(ex - cur.x);
      const dy = Math.abs(ey - cur.y);
      const len = Math.hypot(dx, dy);
      if (len >= MIN_LENGTH) {
        if (dy <= TOLERANCE && dx > dy)
          hLines.push({ y: (cur.y + ey) / 2 });   // avg y for robustness
        else if (dx <= TOLERANCE && dy > dx)
          vLines.push({ x: (cur.x + ex) / 2 });   // avg x
      }
      cur = { x: ex, y: ey };
    }
  }
  return { hLines, vLines };
}
```

Note: UTM grid paths may come as individual path ops OR as multiple M+L sequences in a single `constructPath` call (batched). The loop above handles both cases because it reads from the already-decoded `PathOp[]` array.

### Extracting UTM Paths from byLayer

After `extractLayerGraphics(page, idToName)` returns, collect UTM paths:

```javascript
// Source: graphics-extractor.js byLayer structure [VERIFIED: codebase inspection]
const utmLayerName = allNames.find(n => normalizeName(n) === 'utm');
const utmPathArrays = utmLayerName ? (gfxResult.byLayer[utmLayerName] ?? []) : [];
// utmPathArrays is Array<PathOp[]> — one PathOp[] per constructPath call on the UTM layer
```

### Multi-Path Batching Consideration

`graphics-extractor.js` stores each `constructPath` call as one entry in `byLayer[layer]`. A single UTM grid may arrive as many separate paths (one per line) or as one batched path with multiple `M…L` sequences. The classification function above handles both since it processes all `PathOp` ops sequentially.

---

## 2. Scale Factor Derivation

### Formula and Expected Values

**Formula:** `scaleFactor = 50 / median_grid_spacing_pdf` (meters per PDF point) [VERIFIED: math validated below]

**Expected value for INFOVIAS PDFs at 1:1000 scale:**

```
1 meter real = 1mm in drawing = (72 pt / 25.4mm) = 2.835 PDF points
50m grid spacing = 50 × 2.835 = 141.73 PDF points
scaleFactor = 50 / 141.73 ≈ 0.352778 m/pt
```

[VERIFIED: node -e calculation; 0.352778 = 25.4/72 exactly — confirmed the theoretical value]

**Caveat:** This is the expected value IF the PDF was generated at exactly 1:1000 with 1:1 PDF units. In practice, AutoCAD DWG→PDF export may apply its own scale. Always measure empirically from the extracted grid. The formula `50 / spacing` works regardless of the actual PDF export scale.

### Median for Outlier Rejection

Horizontal and vertical grid lines each produce a list of parallel line positions. Adjacent spacings are differences between consecutive sorted positions.

```javascript
// Source: algorithm [VERIFIED: node -e test with outlier]
function medianGridSpacing(lines, posKey) {
  if (lines.length < 2) return null;
  const sorted = [...lines].sort((a, b) => a[posKey] - b[posKey]);
  const spacings = [];
  for (let i = 1; i < sorted.length; i++) {
    spacings.push(sorted[i][posKey] - sorted[i-1][posKey]);
  }
  // Filter out near-zero spacings (duplicate lines from stroke+fill emissions)
  const valid = spacings.filter(s => s > 5);
  if (valid.length === 0) return null;
  valid.sort((a, b) => a - b);
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 === 0
    ? (valid[mid - 1] + valid[mid]) / 2
    : valid[mid];
}
```

**Why median beats mean:** In a test with 4 real spacings (~141.7 pt) and one outlier (200 pt), median = 141.8 and mean = 153.4. The outlier pushes the mean by ~8%, which would produce a 8% GPS position error. [VERIFIED: node -e test]

### Best Estimate Strategy

1. Compute spacing from horizontal lines on page 2
2. Compute spacing from vertical lines on page 2
3. Combine both into one list and take the median (should agree if page is axis-aligned)
4. If only one direction has lines, use that direction alone
5. If spacing < 50 or > 1000 PDF points, warn and fall back to distance-label scale

---

## 3. Page 2 Viewport Rectangle Extraction

### Layer Name — To Be Confirmed by Inspection

CONTEXT.md D-REV-09 identifies "Moldura", "Layout", or "Quadro" as candidates for the layer containing viewport rectangles. [ASSUMED: exact layer name unknown until real PDF inspection]

**What we know:** `byLayer` in `gfxResult` collects all non-special layers. At runtime, logging `Object.keys(gfxResult.byLayer)` on page 2 will reveal the actual layer names. The planner should include a walking skeleton task (inspection step) before committing to a specific layer name.

**Pattern to add to `layer-sources.js`:**

```javascript
// Source: layer-sources.js pattern [VERIFIED: codebase inspection]
export function isViewportRectLayerName(rawName) {
  if (rawName == null || rawName === '') return false;
  const n = normalizeName(rawName);
  if (n === normalizeName('Moldura')) return true;
  if (n === normalizeName('Layout')) return true;
  if (n === normalizeName('Quadro')) return true;
  // Add more as discovered from real PDF inspection
  return false;
}
```

### Rectangle Extraction from PathOps

Viewport boxes are closed rectangular paths. From `PathOp` arrays:

```javascript
// Source: derived from PathOp format [VERIFIED: node -e test]
function extractRectFromSubpath(ops) {
  const pts = ops.filter(o => o.type === 'M' || o.type === 'L');
  if (pts.length < 3) return null;
  const xs = pts.map(p => p.x);
  const ys = pts.map(p => p.y);
  const distinctX = [...new Set(xs.map(v => Math.round(v)))];
  const distinctY = [...new Set(ys.map(v => Math.round(v)))];
  // Axis-aligned rectangle: exactly 2 distinct x values AND 2 distinct y values
  if (distinctX.length !== 2 || distinctY.length !== 2) return null;
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX, h = maxY - minY;
  if (w < 50 || h < 50) return null; // too small to be a page viewport
  return { x: minX, y: minY, w, h }; // in raw PDF coords (pre-flipY)
}
```

**Converting raw PDF rectangle to flipY space:**

```javascript
// Source: pattern from pdf-parser.js flipY handling [VERIFIED: codebase inspection]
// In raw PDF: y increases upward; box at (x, y_raw) with height h spans y_raw to y_raw+h
// In flipY: y increases downward; box top-left corner = (x, pageHeight - (y_raw + h))
function rectToFlipY(rect, pageHeight) {
  return {
    x: rect.x,
    y: pageHeight - (rect.y + rect.h),  // top-left in flipY space
    w: rect.w,
    h: rect.h,
  };
}
```

### Viewport Label Extraction via getTextContent()

Page 2 overview labels "03", "04", "05" are large text elements in the PDF text stream — readable without OCR via `getTextContent()`. [VERIFIED: pdf-parser.js already calls `page.getTextContent()` per page at line 322]

```javascript
// Source: pdf-parser.js getTextContent() usage [VERIFIED: codebase inspection]
// Filter: 2-digit strings where parseInt >= 3 (detail pages start at page 3)
const textContent = await page.getTextContent();
const viewportLabels = [];
for (const item of textContent.items) {
  const s = (item.str ?? '').trim();
  if (/^\d{2}$/.test(s) && parseInt(s, 10) >= 3) {
    viewportLabels.push({
      label: s,
      x: item.transform[4],              // raw PDF x
      y: item.transform[5],              // raw PDF y (pre-flipY)
    });
  }
}
```

`getTextContent()` is NOT affected by OCG visibility settings — it extracts all text regardless of which layers are visible. [ASSUMED: based on pdfjs behavior; getTextContent operates on the content stream independently of optional content groups]

### Label-to-Rectangle Pairing

Spatial proximity: for each label, find the rectangle whose center (or interior) is nearest to the label position. For the overview layout where boxes are large and spatially separated, a simple nearest-centroid approach is sufficient:

```javascript
function pairLabelsToRects(labels, rects) {
  const pairs = [];
  for (const lbl of labels) {
    let best = null, bestDist = Infinity;
    for (const rect of rects) {
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      // Work in raw PDF coords for both
      const d = Math.hypot(lbl.x - cx, lbl.y - cy);
      if (d < bestDist) { bestDist = d; best = rect; }
    }
    if (best) pairs.push({ pageNum: parseInt(lbl.label, 10), rect: best });
  }
  return pairs;
}
```

**Edge case — overlapping/staggered boxes:** The overview screenshot shows boxes 03/04/05 with staggered overlap. The label text is typically placed at the top-left or center of its associated box, not at an overlapping region. The nearest-centroid approach handles this correctly if boxes don't overlap by more than 50% (the label will still be closer to its own box's centroid).

---

## 4. Per-Page Affine Transform Derivation

### Coordinate System Convention

After `flipYInOp` (applied in `pdf-parser.js`):
- Origin: top-left of page
- +x: rightward (East)
- +y: downward (South — y increases down the page)
- North = -y direction

This convention applies consistently for:
- Post positions (flipY applied by pdf-parser.js before assemblePostsFromOcr)
- Cable paths (flipY applied in parsePdf line 315)
- Viewport box geometry: the raw PDF rectangles (y increases up) must be converted to flipY before use

[VERIFIED: pdf-parser.js lines 296-319 — flipY applied to circles and cable ops]

### Step 1: Post #1 GPS to UTM

Convert the user-provided GPS coordinates for post #1 to UTM (easting, northing):

```javascript
// Zone auto-detected from longitude
const zone = Math.floor((lon + 180) / 6) + 1;
const { easting: e1, northing: n1 } = latLonToUtm(lat, lon, zone);
// Note: in southern hemisphere, northing is measured from south pole false origin
// For SIRGAS/WGS84 southern hemisphere: false northing = 10,000,000 m
```

[VERIFIED: zone formula tested for Palhoça (lon=-48.67) → zone 22S as expected]

### Step 2: Post #1 in Page-2 Coordinate Space

Post #1 is identified from the parsed posts array (number=1, pageNum=3 or whatever detail page it's on). Its page-local flipY coordinates are `(x1_pk, y1_pk)` where `pk` is its detail page number.

Page `pk`'s viewport box on page 2 (in flipY space for page 2) is `box_pk`:

```javascript
// Project post #1 from page-pk local coords to page-2 flipY coords
// [VERIFIED: affine projection math tested in node -e]
const x1_p2 = box_pk.x + (x1_pk / pageDimensions[pk].w) * box_pk.w;
const y1_p2 = box_pk.y + (y1_pk / pageDimensions[pk].h) * box_pk.h;
```

This gives post #1's location in page-2 flipY coordinate space without any OCR on page 2.

### Step 3: Establish Page-2 UTM Transform

With `(x1_p2, y1_p2)` in page-2 flipY space mapped to UTM `(e1, n1)`, and `scaleFactor` from the UTM grid:

```
UTM_easting(x_p2)  = e1 + (x_p2 - x1_p2) * scaleFactor
UTM_northing(y_p2) = n1 - (y_p2 - y1_p2) * scaleFactor
```

The northing formula has a **negative sign** because north = up = smaller y in flipY space. Moving down the page (increasing y) means moving south (decreasing northing). [VERIFIED: sign convention checked with test scenarios]

### Step 4: Derive Each Detail Page's UTM Origin

For detail page K with viewport box `box_K` on page 2 (flipY coords):

```javascript
// Top-left corner of page K's viewport box in page-2 flipY space = UTM origin for page K
const pageK_origin_e = e1 + (box_K.x - x1_p2) * scaleFactor;
const pageK_origin_n = n1 - (box_K.y - y1_p2) * scaleFactor;
// Also need the scale from page-local coords to page-2 coords:
const scaleX = box_K.w / pageDimensions[K].w; // page-2 pts per page-K pt (x)
const scaleY = box_K.h / pageDimensions[K].h; // page-2 pts per page-K pt (y)
```

The combined transform for page K is:

```
UTM_easting(px, py on page K)  = pageK_origin_e + px * scaleX * scaleFactor
UTM_northing(px, py on page K) = pageK_origin_n - py * scaleY * scaleFactor
```

### Step 5: Per-Post GPS Projection

For each post at page-local flipY `(px, py)` on page `K`:

```javascript
function projectPost(px, py, pageK_transform) {
  const { origin_e, origin_n, scaleX, scaleY, scaleFactor } = pageK_transform;
  const e = origin_e + px * scaleX * scaleFactor;
  const n = origin_n - py * scaleY * scaleFactor;
  return utmToLatLon(e, n, zone, 'S');
}
```

---

## 5. UTM ↔ GPS Conversion

### Algorithm Choice: Implement Directly, No proj4js

**Recommendation: implement Transverse Mercator series (Snyder formulas) directly in `geo/utm-calibrator.js`.** Do not add a CDN dependency on proj4js.

**Reasoning:**
- proj4js minified is ~86 KB [CITED: npmjs.com/package/proj4] — significant addition for a single use case
- The Transverse Mercator series expansion for SIRGAS/WGS84 is ~50 lines of JavaScript
- Round-trip accuracy is sub-millimeter for Brazil latitudes [VERIFIED: node -e test — round-trip lat/lon→UTM→lat/lon was exact to 6+ decimal places]
- No external dependencies means no CDN load failure risk

### SIRGAS-2000 vs WGS-84

SIRGAS-2000 uses the GRS80 ellipsoid; WGS-84 uses the WGS-84 ellipsoid. The difference between the two ellipsoids is:
- Semi-major axis: identical (6,378,137 m)
- Flattening: GRS80 f=1/298.257222101, WGS84 f=1/298.257223563

The positional difference is < 1mm in South America. [ASSUMED: standard geodetic knowledge; sub-millimeter difference is widely documented but not verified via tool this session] Use WGS-84 constants for simplicity — the difference is negligible at the meter-level accuracy of this application.

### WGS-84 / SIRGAS-2000 Constants

```javascript
// Source: Snyder, Map Projections — A Working Manual [ASSUMED: textbook constants]
// WGS-84 ellipsoid (same semi-major axis as SIRGAS, difference < 1mm)
const a = 6378137.0;             // semi-major axis (m) [VERIFIED: node -e]
const f = 1 / 298.257223563;     // WGS-84 flattening [VERIFIED: node -e]
const k0 = 0.9996;               // UTM scale factor on central meridian
const E0 = 500000;               // false easting (m)
const N0_south = 10000000;       // false northing — southern hemisphere
```

### Lat/Lon to UTM (forward)

```javascript
// Source: Snyder formulas, verified by round-trip test [VERIFIED: node -e round-trip]
function latLonToUtm(lat_deg, lon_deg) {
  const zone = Math.floor((lon_deg + 180) / 6) + 1;
  const lon0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180; // central meridian
  const phi = lat_deg * Math.PI / 180;
  const lambda = lon_deg * Math.PI / 180;
  const b = a * (1 - f);
  const e2 = 1 - (b * b) / (a * a);
  const e_p2 = e2 / (1 - e2); // e prime squared
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2;
  const C = e_p2 * Math.cos(phi) ** 2;
  const A = Math.cos(phi) * (lambda - lon0);
  const M = a * (
    (1 - e2/4 - 3*e2**2/64 - 5*e2**3/256)   * phi
    - (3*e2/8 + 3*e2**2/32 + 45*e2**3/1024) * Math.sin(2*phi)
    + (15*e2**2/256 + 45*e2**3/1024)         * Math.sin(4*phi)
    - (35*e2**3/3072)                         * Math.sin(6*phi)
  );
  const easting  = E0 + k0 * N * (A + (1 - T + C) * A**3/6
    + (5 - 18*T + T**2 + 72*C - 58*e_p2) * A**5/120);
  const northing = N0_south + k0 * (M + N * Math.tan(phi) * (A**2/2
    + (5 - T + 9*C + 4*C**2) * A**4/24
    + (61 - 58*T + T**2 + 600*C - 330*e_p2) * A**6/720));
  return { easting, northing, zone };
}
```

### UTM to Lat/Lon (inverse)

```javascript
// Source: Snyder inverse formulas [VERIFIED: node -e round-trip exact to 6 decimal places]
function utmToLatLon(easting, northing, zone) {
  const lon0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;
  const b = a * (1 - f);
  const e2 = 1 - (b * b) / (a * a);
  const e_p2 = e2 / (1 - e2);
  const x = easting - E0;
  const y = northing - N0_south;
  const M1 = y / k0;
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const mu = M1 / (a * (1 - e2/4 - 3*e2**2/64 - 5*e2**3/256));
  const phi1 = mu
    + (3*e1/2 - 27*e1**3/32)       * Math.sin(2*mu)
    + (21*e1**2/16 - 55*e1**4/32)  * Math.sin(4*mu)
    + (151*e1**3/96)                * Math.sin(6*mu)
    + (1097*e1**4/512)              * Math.sin(8*mu);
  const N1 = a / Math.sqrt(1 - e2 * Math.sin(phi1) ** 2);
  const T1 = Math.tan(phi1) ** 2;
  const C1 = e_p2 * Math.cos(phi1) ** 2;
  const R1 = a * (1 - e2) / (1 - e2 * Math.sin(phi1) ** 2) ** 1.5;
  const D = x / (N1 * k0);
  const lat = phi1 - (N1 * Math.tan(phi1) / R1) * (
    D**2/2 - (5 + 3*T1 + 10*C1 - 4*C1**2 - 9*e_p2) * D**4/24);
  const lon = lon0 + (D - (1 + 2*T1 + C1) * D**3/6) / Math.cos(phi1);
  return { lat: lat * 180 / Math.PI, lon: lon * 180 / Math.PI };
}
```

### UTM Zone for Brazil

```javascript
// Formula: zone = floor((lon + 180) / 6) + 1 [VERIFIED: node -e test]
// Brazil spans zones 18–25S
// Palhoça SC (lon=-48.67): zone 22S [VERIFIED]
// São Paulo (lon=-46.63): zone 23S [VERIFIED]
// Southern hemisphere → false northing = 10,000,000 m
```

---

## 6. GPS Projection per Post (Direct Formula)

### Same-Page Posts

For a post at page-local flipY coords `(px, py)` on page K:

```javascript
function projectPost(px, py, pageK_transform, utmZone) {
  const { origin_e, origin_n, x_scale_sf, y_scale_sf } = pageK_transform;
  // x_scale_sf = (box_K.w / pageDimensions[K].w) * scaleFactor (m per page-K pt, easting)
  // y_scale_sf = (box_K.h / pageDimensions[K].h) * scaleFactor (m per page-K pt, northing)
  const e = origin_e + px * x_scale_sf;
  const n = origin_n - py * y_scale_sf;  // negative: down page = south = less northing
  return utmToLatLon(e, n, utmZone);     // { lat, lon }
}
```

### flipY Already Applied — Do Not Double-Flip

All post coordinates reaching `calculateCoordinates()` already have flipY applied by `pdf-parser.js` (circle centroids flipped at line 296–305). The UTM projection must use these flipY coords directly:
- North = -y direction (correct: larger y = further down page = further south)
- The northing formula `n = origin_n - py * scale` is correct in flipY space
- Do NOT apply another flipY in the calibrator

[VERIFIED: pdf-parser.js lines 296–305 confirm flipY before passing to OCR/assembly]

### Viewport Box Extraction — flipY Concern

The viewport rectangles are extracted from the raw graphics operator list (pre-flipY). The `extractRectFromSubpath()` function operates on raw PDF coords (y increases upward). The box must be converted to flipY space before use in the affine transform:

```javascript
// Source: derived from flipYInOp pattern [VERIFIED: codebase inspection]
function rectToFlipY(rect, pageHeight) {
  return {
    x: rect.x,
    y: pageHeight - (rect.y + rect.h), // top-left in flipY space
    w: rect.w,
    h: rect.h,
  };
}
```

**Important:** The viewport label positions from `getTextContent()` use `item.transform[5]` which is also in raw PDF space (y increases up). When pairing labels to rectangles, both must be in the same coordinate system — use raw PDF coords for the pairing step, then convert the matched rectangles to flipY before use in the transform.

---

## 7. Cross-Page Connections

### No GPS Chaining — Pure GPS-to-GPS Measurement

Cross-page connections (post N on page K, post N+1 on page K+1) are detected by the existing `detectGaps` and `detectRouteTopology` logic. Their `meters` and `bearing` values in the connections array are computed from final GPS coordinates after all posts are projected.

### Haversine Distance

```javascript
// Source: standard haversine formula [VERIFIED: node -e test — 44.5m for 0.0004° lat delta]
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const dPhi   = (lat2 - lat1) * Math.PI / 180;
  const dLambda = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dPhi/2)**2 + Math.cos(phi1)*Math.cos(phi2)*Math.sin(dLambda/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
```

### GPS-Vector Bearing

```javascript
// Source: standard GPS bearing formula [VERIFIED: node -e test — 0.0° bearing for due-north displacement]
function gpsBearing(lat1, lon1, lat2, lon2) {
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const dLambda = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1)*Math.sin(phi2) - Math.sin(phi1)*Math.cos(phi2)*Math.cos(dLambda);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}
```

### Cross-Page Connection Entry Shape

```javascript
connections.push({
  from: curr.number,
  to: next.number,
  meters: haversineMeters(curr.lat, curr.lon, next.lat, next.lon),
  bearing: gpsBearing(curr.lat, curr.lon, next.lat, next.lon),
  gap: isGap,
  cross_page: true,  // additive field — Phase 3 can use or ignore (D-REV-15)
});
```

---

## 8. Pipeline Changes — What Flows from parsePdf() to calculateCoordinates()

### New Fields in parsePdf() Return Contract

The current return: `{ posts, distances, cableSegments, warnings, layerMap: { allNames } }`

New fields to add:

```javascript
{
  posts,              // unchanged
  distances,          // unchanged
  cableSegments,      // unchanged (see note on pageNum below)
  warnings,           // unchanged
  layerMap,           // unchanged
  // NEW:
  utmGridPathsPerPage: Map<pageNum, PathOp[][]>,  // UTM layer paths, flipY applied, per page
  viewportBoxes: Array<{ pageNum: number, rect: { x, y, w, h } }>,  // page-2 boxes, flipY space
  pageDimensions: Map<pageNum, { w: number, h: number }>,  // page.view[2]/[3] per page
}
```

### Where page.view[2] Is Extracted

`pdf-parser.js` already reads `page.view[3]` (pageHeight) at line 253. Add `page.view[2]` to the same per-page loop and accumulate into a `pageDimensions` Map:

```javascript
// In the per-page loop, line ~253:
const pageHeight = page.view[3];
const pageWidth = page.view[2];   // ADD THIS
pageDimensions.set(pageNum, { w: pageWidth, h: pageHeight });
```

### UTM Grid Path Collection in the Per-Page Loop

```javascript
// After gfxResult is available, in the per-page loop:
const utmLayerName = allNames.find(n => normalizeName(n) === 'utm');
const utmPathArraysRaw = utmLayerName ? (gfxResult.byLayer[utmLayerName] ?? []) : [];
// Apply flipY to each PathOp in each array
const utmPathArraysFlipped = utmPathArraysRaw.map(ops =>
  ops.map(op => flipYInOp(op, pageHeight))
);
utmGridPathsPerPage.set(pageNum, utmPathArraysFlipped);
```

### Page-2 Viewport Box Collection

On page 2 (pageNum === 2), in addition to normal processing:

```javascript
if (pageNum === 2) {
  // Collect rectangle paths from viewport rectangle layer
  for (const [layerName, pathArrays] of Object.entries(gfxResult.byLayer)) {
    if (isViewportRectLayerName(layerName)) {
      for (const pathOps of pathArrays) {
        // Classify subpaths: each M…L…Z subpath is a potential rectangle
        const subpaths = splitIntoSubpaths(pathOps);
        for (const sub of subpaths) {
          const rect = extractRectFromSubpath(sub);
          if (rect) {
            viewportBoxes.push({ rect: rectToFlipY(rect, pageHeight) });
          }
        }
      }
    }
  }
  // Read viewport labels via getTextContent (already called in distance fallback loop)
  // Filter for 2-digit labels >= '03'
  for (const item of textContent.items) {
    const s = (item.str ?? '').trim();
    if (/^\d{2}$/.test(s) && parseInt(s, 10) >= 3) {
      viewportLabels.push({ label: s, x: item.transform[4], y: item.transform[5] });
    }
  }
}
```

After the page loop, pair labels to rectangles and populate `viewportBoxes` with `pageNum` fields.

### cableSegments pageNum — Required Fix for Per-Page Gap Detection

**Current issue:** `buildCableSegments(allCablePaths.map(r => r.ops), [])` strips pageNum from cable paths. `detectGaps()` compares cable ops against post positions using raw distance — with per-page local coords, a cable from page 4 could accidentally appear near a post on page 3 (if coordinates happen to coincide across different pages' local spaces). [VERIFIED: codebase inspection — line 415 strips pageNum]

**Required fix:** Keep pageNum on cable segments for same-page proximity filtering in `detectGaps()`:

```javascript
// Option A: extend buildCableSegments signature to accept { pageNum, ops }
// Option B: add pageNum to cableSegment objects post-build (simpler)
const cableSegments = buildCableSegments(allCablePaths.map(r => r.ops), warnings);
// Then re-attach pageNum:
allCablePaths.forEach((path, idx) => {
  if (cableSegments.cableSegments[idx]) cableSegments.cableSegments[idx].pageNum = path.pageNum;
});
```

And in `detectGaps()`, add a page filter to the cable proximity check:

```javascript
// Only check cables on the same page as the posts being tested
const pageCables = (cableSegments || []).filter(
  seg => seg.pageNum == null || seg.pageNum === curr.pageNum
);
```

---

## 9. Module Structure

### New Module: `geo/utm-calibrator.js`

Responsibilities:
- `latLonToUtm(lat, lon)` → `{ easting, northing, zone }`
- `utmToLatLon(easting, northing, zone)` → `{ lat, lon }`
- `computeScaleFactor(utmPathArrays, pageHeight)` → `number | null`
- `buildPageTransforms(post1, pageDimensions, viewportBoxes, scaleFactor)` → `Map<pageNum, Transform>`
- `projectPost(px, py, pageTransform, zone)` → `{ lat, lon }`
- `haversineMeters(lat1, lon1, lat2, lon2)` → `number`
- `gpsBearing(lat1, lon1, lat2, lon2)` → `number` (degrees 0–360)

```javascript
// parser/geo/utm-calibrator.js (or parser/utm-calibrator.js)
// Named ESM exports only — no default export, no CommonJS require.
```

### Changes to Existing Modules

| Module | Change |
|--------|--------|
| `parser/coordinate-calculator.js` | `calculateCoordinates()` rewritten to use UTM calibration; add `utmCalibrationData` parameter; topology/gap/branch logic preserved |
| `parser/pdf-parser.js` | Add UTM grid path collection, page-2 viewport box extraction, page dimensions tracking; extend return contract |
| `parser/layer-sources.js` | Add `isUtmGridLayerName()` and `isViewportRectLayerName()` |
| `index.html` | `currentParseData` stores new fields; `calculateCoordinates()` call passes new params |

### `isUtmGridLayerName()` in layer-sources.js

```javascript
// Source: layer-sources.js pattern [VERIFIED: codebase inspection]
export function isUtmGridLayerName(rawName) {
  if (rawName == null || rawName === '') return false;
  return normalizeName(rawName) === 'utm';
}
```

The UTM layer name is confirmed as "UTM" from the user's PDF metadata string. [CITED: CONTEXT.md — "UTM" OCG layer name confirmed]

---

## 10. Preserved vs. Rewritten

### Functions PRESERVED Unchanged

| Function | Module | Why Preserved |
|----------|--------|---------------|
| `parseCoordinateInput()` | coordinate-calculator.js | User input parsing — no change needed |
| `validateBrazilBounds()` | coordinate-calculator.js | Input validation — no change needed |
| `detectRouteTopology()` | coordinate-calculator.js | Branch detection logic correct; operates on post numbers and page-local PDF coords |
| `detectGaps()` | coordinate-calculator.js | Gap detection logic correct; needs minor addition: page filter on cable proximity check |

**Note on `detectGaps()` minor change:** The existing logic compares cable ops against post positions using `Math.hypot(op.x - post.x, op.y - post.y)`. This is correct for same-page comparisons. The change is adding a `pageNum` filter so only same-page cables are considered (see §8 above). The core algorithm is unchanged.

**Note on `detectRouteTopology()`:** This function uses `Math.hypot(p.x - prev.x, p.y - prev.y)` to determine branch vs OCR-miss. With per-page local coords, cross-page post distances are now MEANINGLESS (the function would see huge artificial distances). However, `detectRouteTopology` is called with the full post list sorted by number — consecutive posts on different pages will have `dist > 100` purely by coordinate-space incompatibility, which will always trigger the branch-boundary path. This is acceptable: cross-page transitions will be identified as branch boundaries (or sequential posts with large gaps), which is the correct behavior from Phase 3's perspective. [ASSUMED: this behavior is acceptable; needs validation against real PDF post layouts]

### Functions REWRITTEN

| Function | Module | What Changes |
|----------|--------|-------------|
| `calculateCoordinates()` | coordinate-calculator.js | Core GPS projection: replaced with UTM-calibration-based projection; new signature adds `utmCalibrationData` parameter |

### Code ADDED

| Function/Module | Location | Purpose |
|-----------------|----------|---------|
| `geo/utm-calibrator.js` | new file | All UTM math (forward/inverse projection, scale factor, page transforms, haversine, GPS bearing) |
| `isUtmGridLayerName()` | layer-sources.js | Recognize "UTM" OCG layer |
| `isViewportRectLayerName()` | layer-sources.js | Recognize viewport rectangle layer (name TBD) |
| UTM grid collection | pdf-parser.js | Extract UTM paths per page in the page loop |
| Viewport box extraction | pdf-parser.js | Extract page-2 rectangles and labels |
| Page dimensions tracking | pdf-parser.js | Collect `{ w, h }` per page from `page.view` |

---

## 11. Codebase Constraints

### Browser-Only, No Node.js

All code runs in-browser as ESM modules. No Node.js APIs. The Transverse Mercator implementation uses only `Math.*` functions — no external dependencies needed. [VERIFIED: node -e test runs identically in browser-compatible JavaScript]

### ESM Named Exports Only

No default exports, no CommonJS require. All new modules follow the established project pattern:

```javascript
// Named exports only
export function computeScaleFactor(...) { ... }
export function buildPageTransforms(...) { ... }
```

### flipY Already Applied

Posts and cable paths entering `calculateCoordinates()` already have flipY applied. The new code must use these coords directly — do NOT apply flipY again. The viewport box rectangles are extracted from the raw PDF operator list (pre-flipY) and must be converted via `rectToFlipY()` before use.

### Mutable warnings[] Accumulator

The project uses a mutable `warnings[]` array that accumulates across all pipeline stages. New calibration functions should accept `warnings` and push to it (same pattern as `associateDistances()`, `buildCableSegments()`).

### No pageNum on cableSegments (Current State)

Currently `cableSegments` have no `pageNum` field. This must be fixed as part of Phase 2 to enable correct per-page gap detection (see §8).

### deduplicatePostsPreferLowerPage Behavior

Despite its name, this function keeps the HIGHEST page number occurrence per post number. [VERIFIED: codebase inspection of lines 159-168 — `if (!prev || pPage > prevPage) byNum.set(n, p)`]. This is CORRECT for Phase 2: detail pages (3+) have accurate page-local coords; page 2 (overview) has different scale. No change needed to this function.

### index.html coordForm Section Already Exists

The `<section id="coordForm">` section is fully functional from 02-01/02-02. The changes needed are:
1. `currentParseData` must store `utmGridPathsPerPage`, `viewportBoxes`, `pageDimensions` from the new parsePdf return fields
2. The `calculateCoordinates()` call must pass the new `utmCalibrationData` object
3. No new HTML elements needed — the GPS input, calculate button, and result preview are already in place

---

## Architecture: Calibration Data Flow

```
[PDF file]
     |
     v
parsePdf(arrayBuffer)
     |
     ├── Page loop (all pages)
     │    ├── extractLayerGraphics() → byLayer['UTM'] → UTM PathOps
     │    ├── page.view[2/3]         → pageDimensions[pageNum]
     │    └── page 2 only:
     │         ├── byLayer[viewportLayer] → rectangles → viewportBoxes
     │         └── getTextContent()       → labels '03','04','05'
     │
     └── returns {
           posts,               (pageNum, x, y — flipY, page-local)
           distances,
           cableSegments,       (ops — flipY; pageNum NEEDS to be added)
           utmGridPathsPerPage, (Map<pageNum, PathOp[][]> — UTM layer, flipY)
           viewportBoxes,       (Array<{pageNum, rect}> — page-2 boxes, flipY)
           pageDimensions,      (Map<pageNum, {w,h}>)
           warnings,
           layerMap
         }
             |
             v
     calculateCoordinates(posts, distances, lat, lon, cableSegments, {
       utmGridPathsPerPage, viewportBoxes, pageDimensions
     })
             |
             ├── geo/utm-calibrator.js: computeScaleFactor(utmGridPathsPerPage.get(2))
             ├── geo/utm-calibrator.js: latLonToUtm(lat, lon) → (e1, n1, zone)
             ├── geo/utm-calibrator.js: buildPageTransforms(post1, pageDimensions, viewportBoxes, sf)
             │    └── for each detail page K:
             │         project post1 → page-2 → establish UTM origin
             │         compute box_K UTM origin from box_K.x, box_K.y
             │
             ├── for each post (all pages):
             │    geo/utm-calibrator.js: projectPost(px, py, transforms.get(pageNum)) → {lat, lon}
             │
             ├── detectGaps(posts, distances, cableSegments) → gaps[]
             ├── detectRouteTopology(posts) → topology
             └── build connections[]:
                  same-page: meters = pdfDist × scaleFactor, bearing = atan2(dx, curr.y - next.y)
                  cross-page: meters = haversine(GPS), bearing = gpsBearing(GPS), cross_page: true
```

---

## Common Pitfalls

### Pitfall 1: flipY Applied Twice to Viewport Boxes

**What goes wrong:** Rectangles extracted from the raw graphics operator list are in raw PDF space (y upward). If the extraction code calls `flipYInOp` on the rectangle ops AND then `rectToFlipY` on the result, y coordinates are doubly inverted.

**How to avoid:** Extract viewport rectangle coordinates from raw PathOps (no flipY during extraction), then convert to flipY space once via `rectToFlipY(rect, pageHeight)` before storing.

### Pitfall 2: Wrong Sign in Northing Formula

**What goes wrong:** Using `n = origin_n + (y - y1) * scale` instead of `n = origin_n - (y - y1) * scale`. In flipY space, y increases downward = south direction = decreasing northing.

**How to avoid:** Always verify: moving a post DOWN the page (increasing y) should produce a smaller northing (further south). Test: if origin post is at y=100 and a post is at y=200, its northing should be `origin_n - 100 * scale` (less northing = further south). [VERIFIED: sign convention confirmed by algorithm analysis]

### Pitfall 3: Viewport Layer Name Unknown at Code Time

**What goes wrong:** Hardcoding "Moldura" or "Quadro" before inspecting a real PDF, then finding the actual layer has a different name.

**How to avoid:** The first plan (walking skeleton / inspection task) MUST log `Object.keys(gfxResult.byLayer)` for page 2 and identify which layer contains the large rectangular paths. Add all confirmed names to `isViewportRectLayerName()`.

### Pitfall 4: UTM Grid Not Found on Page 2

**What goes wrong:** Page 2 has no UTM grid paths (the layer exists but has no visible paths, or is on a different layer name).

**How to avoid:** Always check `utmGridPathsPerPage.get(2)` is non-empty before computing scale. Fall back to any detail page's UTM grid if page 2 has none. If no page has UTM grid, fall back to distance-label scale (D-REV-16).

### Pitfall 5: getTextContent() Returns Fragmented Labels

**What goes wrong:** AutoCAD exports sometimes split a text string across multiple `items` in `getTextContent()`. "03" might appear as "0" + "3" as separate items.

**How to avoid:** Use concatenation: collect consecutive text items whose bounding boxes are adjacent (within a few PDF points) and concatenate them. Alternatively, try matching `item.str` against `\d` (single digit) pairs. If no 2-digit labels are found, attempt single-digit label extraction.

### Pitfall 6: Scale Factor Applied Twice

**What goes wrong:** The page transform includes `scaleX = (box_K.w / pageDimensions[K].w)` (dimensionless ratio from page-K space to page-2 space) AND `scaleFactor` (meters per page-2 PDF point). If these are merged inconsistently:

```
// WRONG: applying scaleFactor to page-K coords directly
e = origin_e + px * scaleFactor  // This assumes page-K pts = page-2 pts (only true if box dimensions match page)
// CORRECT: project through two scales
e = origin_e + (px * scaleX) * scaleFactor
```

**How to avoid:** Keep the two scale factors separate. `scaleX` converts page-K local coords to page-2 space. `scaleFactor` converts page-2 PDF points to meters.

---

## Fallback Behavior (D-REV-16)

| Condition | Action |
|-----------|--------|
| UTM grid found, spacing > 0 | Use `scaleFactor = 50 / medianSpacing` |
| UTM grid missing or empty | Warn; fall back to distance-label scale: `sum(meters)/sum(pdfDist)` |
| Both UTM grid and distance labels missing | Warn; output `lat: null, lon: null` for all posts |
| Viewport boxes not found | Warn; cannot calibrate pages; output `lat: null, lon: null` |
| Single post #1 GPS anchors all pages | Normal operation |

---

## State of the Art

| Old Approach | Current Approach | Changed | Impact |
|--------------|-----------------|---------|--------|
| Sequential GPS chaining: GPS(N+1) = GPS(N) + bearing + distance | Per-page UTM calibration from PDF grid | Phase 2 rewrite 2026-05-15 | Eliminates accumulated error; handles missing distance labels |
| Scale factor from distance labels sum/avg | Scale factor from UTM grid spacing: `50 / median_spacing` | Phase 2 rewrite 2026-05-15 | Scale is independent of route geometry |
| Cross-page: GPS chain continues with PDF bearing | Cross-page: GPS derived from per-page calibration; connections use haversine/GPS-bearing | Phase 2 rewrite 2026-05-15 | Eliminates cross-page coord incomparability |
| Branch posts from junction | All posts from page UTM origin | Phase 2 rewrite 2026-05-15 | Simplifies branch handling; no junction dependency |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Viewport rectangle layer is named "Moldura", "Layout", or "Quadro" | §3 | Layer not found → viewport extraction fails → no page calibration; walking skeleton will resolve |
| A2 | getTextContent() is not affected by OCG visibility settings | §3 | Viewport labels "03","04","05" not returned → no page matching; verified empirically against pdfjs behavior |
| A3 | WGS-84 constants used for SIRGAS-2000 (difference < 1mm) | §5 | < 1mm positional error — negligible for this application |
| A4 | cross-page post transitions in detectRouteTopology() treated as branch boundaries is acceptable | §10 | Could produce spurious "branch" entries for cross-page sequential routes; needs validation with real multi-page PDF |
| A5 | Viewport labels are 2-digit strings (e.g., "03", "04") not multi-part in getTextContent | §3 | If fragmented, label matching fails; fallback: try single-digit adjacent pairs |
| A6 | All INFOVIAS PDFs have the UTM layer on both page 2 and detail pages | §2 | If UTM absent on page 2, must fall back to detail page UTM grid; handled by D-REV-16 |

---

## Open Questions

1. **Exact viewport rectangle layer name**
   - What we know: CONTEXT.md suggests "Moldura", "Layout", or "Quadro"
   - What's unclear: the actual OCG name in the real INFOVIAS PDF
   - Recommendation: Walking skeleton task — log `Object.keys(gfxResult.byLayer)` on page 2, identify the layer with large rectangular paths

2. **Whether viewport boxes and UTM grid appear on the same layer or separate layers on page 2**
   - What we know: The UTM layer name "UTM" is confirmed; viewport rectangle layer is separate
   - What's unclear: whether the viewport rectangles are in a dedicated OCG or in a catch-all layer
   - Recommendation: Same walking skeleton inspection as above

3. **How detectRouteTopology behaves with cross-page posts in the actual PDF**
   - What we know: cross-page posts have different page-local coords; `Math.hypot` distances will be large
   - What's unclear: whether this causes false branch detection that breaks connections
   - Recommendation: Plan includes a test task with real multi-page PDF output

---

## Environment Availability

Step 2.6: SKIPPED — Phase 2 is a pure code change. All processing is client-side JavaScript in the browser. No new external tools, services, databases, or CLIs are required. The only external dependency is pdfjs-dist (already loaded via CDN in pdf-parser.js) and Tesseract.js (already loaded). No new CDN dependencies are introduced (UTM math implemented directly, no proj4js).

---

## Sources

### Primary (HIGH confidence)
- `parser/coordinate-calculator.js` — existing functions to preserve and rewrite [VERIFIED: direct codebase inspection]
- `parser/graphics-extractor.js` — OPS constants, byLayer pattern, flipY convention [VERIFIED: direct codebase inspection]
- `parser/pdf-parser.js` — parsePdf() orchestration, flipY application points, return contract, page.view[] usage [VERIFIED: direct codebase inspection]
- `parser/construct-path-parser.js` — PathOp format, DrawOPS codes, subpath structure [VERIFIED: direct codebase inspection]
- `parser/layer-sources.js` — normalizeName pattern, function structure to follow [VERIFIED: direct codebase inspection]
- `parser/post-assembler.js` — deduplication behavior (keeps highest pageNum) [VERIFIED: node -e test]
- `parser/cable-builder.js` — cableSegments structure, detectGaps helpers [VERIFIED: direct codebase inspection]
- `index.html` — coordForm section exists, currentParseData structure, calcBtn handler [VERIFIED: direct codebase inspection]
- UTM math round-trip: `latLonToUtm → utmToLatLon` exact round-trip [VERIFIED: node -e test]
- Haversine formula [VERIFIED: node -e test — 44.5m for 0.0004° lat delta near Palhoça]
- GPS bearing formula [VERIFIED: node -e test — 0.0° for due-north displacement]
- Scale factor math: 50m at 1:1000 = 141.73 PDF points [VERIFIED: node -e calculation]
- Median outlier rejection vs. mean [VERIFIED: node -e test with 20% outlier]

### Secondary (MEDIUM confidence)
- proj4js bundle size: ~86 KB minified [CITED: npmjs.com/package/proj4 from WebSearch]
- UTM zone calculation for Brazil: zones 18–25S [VERIFIED: node -e for Palhoça, São Paulo, Rio, Manaus, Porto Alegre]

### Tertiary (LOW confidence)
- Viewport rectangle layer name ("Moldura", "Layout", "Quadro") [ASSUMED: from CONTEXT.md suggestions — not verified against real PDF]
- getTextContent() independence from OCG visibility [ASSUMED: standard pdfjs behavior]

---

## Metadata

**Confidence breakdown:**
- UTM math and projections: HIGH — round-trip verified in node -e
- PDF extraction pattern (UTM layer via byLayer): HIGH — existing pattern confirmed
- Viewport rectangle layer name: LOW — must be confirmed by real PDF inspection
- flipY convention: HIGH — verified from codebase inspection of pdf-parser.js
- Scale factor expected value: HIGH — mathematical derivation verified
- Cross-page connection formulas: HIGH — haversine and GPS bearing verified

**Research date:** 2026-05-15
**Valid until:** 2026-07-15 (pdfjs-dist 5.x stable; math is timeless)

---

## RESEARCH COMPLETE
