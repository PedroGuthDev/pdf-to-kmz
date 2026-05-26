# Phase 3: KMZ Generator with Customization - Research

**Researched:** 2026-05-26  
**Domain:** Client-side KML 2.2 generation, Google Earth styling, JSZip KMZ packaging  
**Confidence:** HIGH (stack/patterns); MEDIUM (default square icon URL — verify visually in Earth once)

## Summary

Phase 3 adds a pure-ESM pipeline under `parser/` that turns Phase 2 output (`posts[]` with `lat`/`lon`, `connections[]` graph edges) into a downloadable KMZ. The locked architecture is **template-string KML** (no KML library), **shared `<Style>` blocks** referenced by `styleUrl`, **one `<LineString>` placemark per `connections[]` entry** (not sequential post chaining), and a **two-step API**: `buildKml` → `packageKmz`. JSZip **3.10.1** zips a single root file `doc.kml` per [Google KMZ guidance](https://developers.google.com/kml/documentation/kmzarchives).

The highest-risk implementation details are **KML color byte order (`aabbggrr`)**, **XML escaping** in names/descriptions, **skipping edges/posts without GPS** with explicit stats/warnings, and **choosing a standard Google Earth square icon URL** then confirming it in Earth (D-IC-02). Customization is implemented as an **options object + `parser/kmz-defaults.js`** shallow-merge; Phase 4 only wires UI controls.

**Primary recommendation:** Implement `parser/kml-color.js` (`hexToKmlColor`), `parser/kmz-defaults.js`, `parser/kml-builder.js`, `parser/kmz-packager.js`; re-export from `parser/pdf-parser.js`; add dev **Download KMZ** in `index.html` after successful Calculate Route; validate with `node --test` for color conversion plus manual open in Google Earth Pro.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Placemark content
- **D-PM-01:** Placemark `<name>` = `Poste NN` with **zero-padded 2-digit** post number (e.g. `Poste 07`). Matches existing console preview in `index.html`.
- **D-PM-02:** Balloon/description = **minimal** — latitude and longitude only. No postType, page, or utility ID in v1.
- **D-PM-03:** Posts with `lat == null` or `lon == null` are **omitted** from KML. Generation result includes **count** of skipped posts (`stats.omittedNoGps`) plus warnings array entry — never silent drop.
- **D-PM-04:** Point altitude mode = **`clampToGround`** on all post placemarks.

#### Route line topology
- **D-LN-01:** **One `<Placemark>` + `<LineString>` per `connections[]` edge** (`from` → `to`). Do not merge into single master polyline or per-page runs.
- **D-LN-02:** `gap: true` connections use the **same line style** as normal segments.
- **D-LN-03:** Branch junction lines use the **same color/thickness** as main route.
- **D-LN-04:** `cross_page: true` connections are **always drawn** as straight GPS segments (same style as normal).
- **D-LN-05:** Every route LineString placemark carries the **same user-supplied description** — global `lineDescription` in options (empty string allowed).

#### Icon customization (CUST-01)
- **D-IC-01:** Icon images = **built-in Google Earth icon URLs** in `<Icon><href>` (no PNG in ZIP in v1).
- **D-IC-02:** Default post icon = **Google Earth built-in square** (framed square). Verify exact `href` in Earth during implementation.
- **D-IC-03:** Icon **color** = **Google Earth preset colors** only (preset keys → KML colors in defaults).
- **D-IC-04:** Icon **size** = **fixed scale 1.0** in v1.

#### Line and label customization (CUST-02, CUST-03)
- **D-ST-01:** Options object supports `lineColor`, `lineWidth`, `labelColor`, `labelScale` (Earth preset palette for colors).
- **D-ST-02:** Defaults live in **`parser/kmz-defaults.js`** — single source; options shallow-merge overrides.

#### Module API and Phase 3 UI
- **D-API-01:** Two-step API: `buildKml(posts, connections, options) → string` then `packageKmz(kmlString, options?) → Promise<Blob>`.
- **D-API-02:** Return **`stats`**: `{ placemarkCount, lineCount, omittedNoGps, warnings[] }` (minimum).
- **D-API-03:** Phase 3 **`index.html`**: dev/test hook only — Download KMZ after Calculate Route with **hardcoded defaults**.
- **D-API-04:** Implement **`hexToKmlColor(hex)`** (`#RRGGBB` → KML `aabbggrr`); unit-test conversion.

### Claude's Discretion
- Exact Google Earth square icon `href` after visual verification in Earth.
- Preset color key → KML `color` / `IconStyle` mapping table in `kmz-defaults.js`.
- KMZ download filename pattern.
- Whether to export thin `generateKmz(...)` wrapper.
- `<Style>` sharing vs per-placemark inline styles.

### Deferred Ideas (OUT OF SCOPE)
- Per-segment line descriptions
- Rich placemark balloons (postType, page, distances)
- Icon size slider / presets (fixed 1.0 until Phase 4 UI)
- Branch-specific line color
- Dashed cross-page or gap lines
- Map preview before download (ENH-01)
- Bundled custom PNG icons (only if built-in square fails visual check)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| KMZ-01 | Valid KML with placemarks per post | `buildKml` emits `<Placemark><Point>` per post with GPS; shared post `Style`; XML prolog + KML 2.2 namespace |
| KMZ-02 | Labeled "Poste (number)" | D-PM-01: `<name>Poste ${String(n).padStart(2,'0')}</name>` |
| KMZ-03 | Lines connecting route | **Not** "consecutive posts only" — iterate `connections[]` from `calculateCoordinates()` (D-LN-01); skip edge if either endpoint lacks GPS |
| KMZ-04 | Packaged downloadable KMZ | JSZip 3.10.1 → `zip.file('doc.kml', kml)` → `generateAsync({ type: 'blob' })` → Blob download in `index.html` |
| KMZ-05 | Opens in Google Earth | `doc.kml` at ZIP root; lon,lat order; `clampToGround`; manual Earth verification checklist |
| CUST-01 | Post icon color/shape/size | Built-in `href` + `IconStyle/color` presets; `scale` fixed 1.0; options contract |
| CUST-02 | Line color and thickness | `LineStyle` with preset `color` + `width` from options/defaults |
| CUST-03 | Label size and color | `LabelStyle` on shared post style: `color` + `scale` from options/defaults |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| (none) KML | KML 2.2 | XML via template literals | Project STACK.md; trivial placemark/line subset |
| jszip | **3.10.1** (npm registry, verified 2026-05-26) | ZIP → KMZ Blob | Official KMZ pattern; [JSZip docs](https://stuk.github.io/jszip/documentation/examples.html) |
| Native Blob / URL APIs | — | Browser download | No FileSaver.js |

**Version verification:**
```bash
npm view jszip version   # → 3.10.1
```

**Not in `package.json` today:** JSZip is planned via CDN in browser (STACK.md). **Planner should add `jszip@3.10.1` as a dependency** (or devDependency) so `kmz-packager.js` and Node tests can `import JSZip from 'jszip'` — mirror `pdf-parser.js` dual environment pattern (CDN in browser, npm in Node).

### Supporting
| Library | Version | When to Use |
|---------|---------|-------------|
| pdfjs-dist | 5.7.284 | Already in project — unrelated to KMZ build |
| node:test + node:assert | Node 22+ | Unit tests (`parser/__tests__/*.test.mjs`) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Template KML | tokml / xml builder | Adds weight; no GeoJSON intermediate in pipeline |
| CDN JSZip UMD | `import JSZip from 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm'` | ESM modules under `parser/` need importable JSZip, not global only |
| `root://icons/palette-*.png` | `http://maps.google.com/mapfiles/kml/shapes/...` | **Deprecated** in modern Earth ([kml4earth icons](http://kml4earth.appspot.com/icons.html)) |

**Browser JSZip load (recommended for `kmz-packager.js`):**
```javascript
// Browser (follow pdf-parser.js lazy import pattern)
const JSZip = (await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm')).default;
```

**Node / tests:**
```bash
npm install jszip@3.10.1
```

## Architecture Patterns

### Recommended Project Structure
```
parser/
├── kml-color.js          # hexToKmlColor, optional presetColorToKml
├── kmz-defaults.js       # DEFAULT_OPTIONS, PRESET_COLORS, mergeOptions()
├── kml-builder.js        # buildKml(posts, connections, options) → { kml, stats }
├── kmz-packager.js       # packageKmz(kmlString) → Promise<Blob>
├── pdf-parser.js         # re-export buildKml, packageKmz (optional generateKmz)
└── __tests__/
    ├── kml-color.test.mjs
    └── kml-builder.test.mjs   # optional structural asserts
index.html                  # dev Download KMZ hook after Calculate Route
```

### Pattern 1: Shared Document styles (recommended)
**What:** One `<Document>` with 2–3 `<Style id="...">` elements; placemarks use `<styleUrl>#postPoint</styleUrl>` etc.  
**When to use:** Default — fewer bytes, consistent CUST-* application.  
**Example:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>pdf-to-kmz route</name>
    <Style id="postPoint">
      <IconStyle>
        <color>ff00ff00</color>
        <scale>1</scale>
        <Icon>
          <href>http://maps.google.com/mapfiles/kml/shapes/placemark_square.png</href>
        </Icon>
      </IconStyle>
      <LabelStyle>
        <color>ffffffff</color>
        <scale>1</scale>
      </LabelStyle>
    </Style>
    <Style id="routeLine">
      <LineStyle>
        <color>ff0000ff</color>
        <width>3</width>
      </LineStyle>
    </Style>
    <Placemark>
      <name>Poste 01</name>
      <description>Lat: -27.659460, Lon: -48.699240</description>
      <styleUrl>#postPoint</styleUrl>
      <Point>
        <altitudeMode>clampToGround</altitudeMode>
        <coordinates>-48.699240275151034,-27.6594603999238,0</coordinates>
      </Point>
    </Placemark>
    <Placemark>
      <name>Poste 01 → Poste 02</name>
      <description>Project note here</description>
      <styleUrl>#routeLine</styleUrl>
      <LineString>
        <altitudeMode>clampToGround</altitudeMode>
        <coordinates>
          -48.699240,-27.659460,0 -48.699602,-27.659421,0
        </coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>
```
// Sources: [KML Reference — ColorStyle, IconStyle, LineStyle, LabelStyle](https://developers.google.com/kml/documentation/kmlreference); [Altitude modes](https://developers.google.com/kml/documentation/altitudemode); [KMZ archives](https://developers.google.com/kml/documentation/kmzarchives)

### Pattern 2: Two-step build + package
**What:** `buildKml` is pure string generation + stats; `packageKmz` only zips.  
**When to use:** Always (D-API-01). Enables testing KML without JSZip and testing zip without regenerating KML.

```javascript
// kmz-packager.js — Source: https://stuk.github.io/jszip/documentation/examples.html
export async function packageKmz(kmlString) {
  const JSZip = await getJSZip(); // browser CDN vs node require
  const zip = new JSZip();
  zip.file('doc.kml', kmlString);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
```

### Pattern 3: Post lookup and edge iteration
**What:** `const byNum = new Map(posts.map(p => [p.number, p]))`; for each `connections[]` item resolve `from`/`to`, skip if missing GPS.  
**When to use:** Always — **do not** rebuild edges from sorted post numbers (misses branches; contradicts Phase 2 contract).

**Phase 2 input contract** (from `calculateCoordinates` return):
```javascript
// connections[]: { from, to, meters, bearing, gap, cross_page? }
// posts[]: { number, lat, lon, x, y, pageNum?, postType?, ... }
```

### Pattern 4: Options merge
```javascript
// kmz-defaults.js
export const DEFAULT_OPTIONS = {
  iconHref: 'http://maps.google.com/mapfiles/kml/shapes/placemark_square.png',
  iconColor: 'green',      // preset key
  lineColor: 'red',
  lineWidth: 3,
  labelColor: 'white',
  labelScale: 1,
  lineDescription: '',
};
export function mergeOptions(user = {}) {
  return { ...DEFAULT_OPTIONS, ...user };
}
```

### Pattern 5: Dev download hook (`index.html`)
**What:** After successful `calculateCoordinates`, store `{ posts, connections, warnings }` in module-level `lastCalcResult`; show `#downloadKmzBtn`; on click run builder with `mergeOptions({})` defaults.  
**Download:**
```javascript
const blob = await packageKmz(kml);
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'route.kmz';
a.click();
URL.revokeObjectURL(url);
```

### Anti-Patterns to Avoid
- **Building lines by `post[i]` → `post[i+1]`:** Violates D-LN-01; drops branch junction edges already in `connections[]`.
- **Using `#RRGGBB` directly in `<color>`:** Colors render wrong (red/blue swap) — use `hexToKmlColor` ([PITFALLS §6](.planning/research/PITFALLS.md)).
- **Multiple `.kml` files in ZIP:** Earth picks first arbitrarily — only `doc.kml` ([KMZ archives](https://developers.google.com/kml/documentation/kmzarchives)).
- **`lat,lon` in `<coordinates>`:** KML order is **longitude,latitude[,altitude]** ([KML tutorial](https://developers.google.com/kml/documentation/kml_tut)).
- **Silent skip of null GPS posts:** Must increment `stats.omittedNoGps` and push warning (D-PM-03).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ZIP/KMZ binary format | Manual DEFLATE | JSZip 3.10.1 | Compression, cross-browser Blob |
| KML XML DOM | Full serializer | Template literals + `escapeXml()` | Small fixed schema; no XSD runtime needed |
| Icon hosting | Embed PNG in KMZ v1 | Google `mapfiles/kml/shapes` URLs | D-IC-01; Earth resolves standard icons offline |
| Color conversion | Ad-hoc string concat | `hexToKmlColor('#RRGGBB')` → `ffbbggrr` | 100% of first-time KML devs invert channels |

## Common Pitfalls

### Pitfall 1: KML color byte order (`aabbggrr`)
**What goes wrong:** Red lines appear blue in Earth.  
**Why:** KML uses alpha, blue, green, red — not CSS `#RRGGBB`.  
**How to avoid:** `hexToKmlColor('#ff0000') === 'ff0000ff'` (opaque red). Unit test known values.  
**Warning signs:** Any `<color>` copied from CSS without conversion.

### Pitfall 2: Unescaped XML in descriptions
**What goes wrong:** Invalid KML; Earth fails to open file.  
**Why:** User `lineDescription` or coords formatting can include `&`, `<`.  
**How to avoid:** Escape `& < > "` in all text nodes and attributes.  
**Warning signs:** KMZ opens empty or parser error on open.

### Pitfall 3: LineString with missing endpoint GPS
**What goes wrong:** Lines to (0,0) or invalid coordinates.  
**Why:** Phase 2 may leave `lat/lon` null on some posts.  
**How to avoid:** Skip edge; `stats.skippedLines` (extend stats) + warning naming `from→to`.  
**Warning signs:** Spurious lines in ocean off Africa.

### Pitfall 4: Wrong icon URL family
**What goes wrong:** Custom-looking icons or 404s; `pal4/iconNN.png` remapped unpredictably.  
**Why:** Legacy `pal*` URLs redirect to standard shapes ([kml4earth note 2](http://kml4earth.appspot.com/icons.html), [Stack Overflow](https://stackoverflow.com/questions/27580620/icon-issue-in-google-earth-kml-file)).  
**How to avoid:** Prefer `http://maps.google.com/mapfiles/kml/shapes/placemark_square.png` for default square; tint with `IconStyle/color`. Alternates: `grn-square.png`, `ylw-square.png` in same directory.  
**Warning signs:** Icon differs between Earth versions — document chosen URL in `kmz-defaults.js` comment.

### Pitfall 5: REQUIREMENTS.md vs CONTEXT on line topology
**What goes wrong:** Planner implements "consecutive posts" and breaks branches.  
**Why:** REQUIREMENTS KMZ-03 wording is sequential; CONTEXT D-LN-01 overrides for Phase 3.  
**How to avoid:** Treat `connections[]` as authoritative edge list.  
**Warning signs:** Branch junction count in UI ≠ line count in KMZ.

### Pitfall 6: JSZip in sandboxed / old embeds
**What goes wrong:** `generateAsync` hangs (rare; v3.10+ `setimmediate` dependency).  
**Why:** [JSZip #864](https://github.com/Stuk/jszip/issues/864) in Tampermonkey-like environments.  
**How to avoid:** Normal browser + `index.html` is fine; if issues, pin 3.9.1 (last resort).  
**Warning signs:** Promise never resolves on zip generation.

## Code Examples

### hexToKmlColor
```javascript
// parser/kml-color.js
// Source: .planning/research/PITFALLS.md §6; KML spec aabbggrr
export function hexToKmlColor(hex, alpha = 0xff) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex).trim());
  if (!m) throw new Error(`Invalid hex color: ${hex}`);
  const rr = m[1].slice(0, 2);
  const gg = m[1].slice(2, 4);
  const bb = m[1].slice(4, 6);
  const aa = alpha.toString(16).padStart(2, '0');
  return `${aa}${bb}${gg}${rr}`.toLowerCase();
}
// #ff0000 → ff0000ff (opaque red)
```

### Preset colors (starter table for `kmz-defaults.js`)
| Preset key | CSS hex | KML `aabbggrr` | Notes |
|------------|---------|----------------|-------|
| red | `#ff0000` | `ff0000ff` | Line default candidate |
| green | `#00ff00` | `ff00ff00` | Icon default candidate |
| blue | `#0000ff` | `ffff0000` | |
| yellow | `#ffff00` | `ff00ffff` | |
| white | `#ffffff` | `ffffffff` | Label on dark map |
| black | `#000000` | `ff000000` | |

Implement `presetToKmlColor(key)` returning cached KML strings via `hexToKmlColor`.

### buildKml stats shape
```javascript
return {
  kml: xmlString,
  stats: {
    placemarkCount,
    lineCount,
    omittedNoGps,
    skippedLines: 0, // recommended extension
    warnings: [],    // merge builder warnings
  },
};
```

### Default square icon (verify in Earth)
```
http://maps.google.com/mapfiles/kml/shapes/placemark_square.png
```
**Confidence MEDIUM** until visual check — matches framed-square intent per [kml4earth](http://kml4earth.appspot.com/icons.html) shapes group and SO redirect notes for `pal4/icon18` → `placemark_square.png`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `root://icons/palette-4.png?x=&y=` | `http://maps.google.com/mapfiles/kml/shapes/*.png` | Earth 4.x+ | Must use HTTP shape URLs |
| Sequential post lines in KMZ | `connections[]` graph edges | Phase 3 CONTEXT 2026-05-26 | Preserves branches/gaps |
| KMZ via server | Client JSZip Blob | Project init | No backend |

**Deprecated/outdated:**
- `tokml` from GeoJSON — not in pipeline.
- `pal2`–`pal5` icon paths — remapped by Earth; use `shapes/` URLs.

## Open Questions

1. **Exact default square `href`**
   - What we know: `placemark_square.png` is the documented framed square; colored variants exist (`grn-square.png`, etc.).
   - What's unclear: Whether user prefers outline-only vs filled center on their Earth version.
   - Recommendation: Ship `placemark_square.png` + green tint; one manual Earth screenshot in plan verification task.

2. **Shared styles vs inline**
   - Recommendation: **Shared styles** (2 styles) unless profiling shows need otherwise.

3. **`generateKmz` wrapper**
   - Recommendation: Thin async wrapper calling `buildKml` + `packageKmz` for `index.html` brevity; export from `pdf-parser.js`.

4. **npm vs CDN-only JSZip**
   - Recommendation: Add `jszip@3.10.1` to `package.json` for Node tests; browser uses jsdelivr `+esm` in `getJSZip()` helper.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | `node --test` | ✓ | v22.22.0 (probed) | — |
| Modern browser | KMZ download, pdf.js | ✓ (assumed) | Chrome/Edge recent | Polyfills already in `index.html` |
| Google Earth Pro | KMZ-05 manual verify | ✓ (user machine) | — | Unzip KMZ; inspect `doc.kml` in editor |
| npm `jszip` | packager + tests | ✗ not installed | — | `npm install jszip@3.10.1` in Wave 0 |
| Network (CDN) | Browser JSZip import | ✓ when online | — | Bundle jszip locally only if offline requirement emerges |

**Missing dependencies with no fallback:**
- None blocking if planner adds `jszip` and uses standard browser APIs.

## Sources

### Primary (HIGH confidence)
- [KML 2.2 Reference](https://developers.google.com/kml/documentation/kmlreference) — ColorStyle `aabbggrr`, IconStyle, LineStyle, LabelStyle, Point, LineString
- [KMZ Archives](https://developers.google.com/kml/documentation/kmzarchives) — `doc.kml` default name, single root KML
- [Altitude modes](https://developers.google.com/kml/documentation/altitudemode) — `clampToGround` on Point/LineString
- [JSZip documentation](https://stuk.github.io/jszip/documentation/examples.html) — `file`, `generateAsync({ type: 'blob' })`
- `parser/coordinate-calculator.js` — `connections[]` build (lines 1499–1619)
- `.planning/phases/03-kmz-generator-with-customization/03-CONTEXT.md` — locked decisions

### Secondary (MEDIUM confidence)
- [kml4earth icons](http://kml4earth.appspot.com/icons.html) — standard shapes URLs, palette deprecation
- [Stack Overflow: pal4 icon redirect](https://stackoverflow.com/questions/27580620/icon-issue-in-google-earth-kml-file) — `placemark_square.png`
- [jsDelivr JSZip +esm](https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm) — browser ESM import pattern

### Tertiary (LOW confidence)
- WebSearch aggregate on `placemark_square.png` — verify in Earth before locking default

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — STACK.md + official KML/JSZip docs + registry version check
- Architecture: **HIGH** — CONTEXT locked; Phase 2 contract verified in source
- Pitfalls: **HIGH** for color/coordinates; **MEDIUM** for icon URL until visual QA

**Research date:** 2026-05-26  
**Valid until:** 2026-06-26 (stable domain)
