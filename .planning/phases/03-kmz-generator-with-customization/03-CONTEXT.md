# Phase 3: KMZ Generator with Customization - Context

**Gathered:** 2026-05-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Generate valid, downloadable KMZ files client-side from Phase 2 output (`posts[]` with `lat`/`lon`, `connections[]` route graph). Deliver KML placemarks per post, LineString placemarks per connection edge, JSZip packaging to `.kmz`, and a customization options contract (icons, lines, labels, global line description). Verify output opens in Google Earth.

**In scope:** KML/KMZ builder modules, `hexToKmlColor`, defaults file, two-step API (`buildKml` → `packageKmz`), dev-only download hook in `index.html` with hardcoded defaults.

**Out of scope (Phase 4):** Polished upload UX, drag-and-drop, progress feedback, full style panel UI, map preview (ENH-01).

</domain>

<decisions>
## Implementation Decisions

### Placemark content

- **D-PM-01:** Placemark `<name>` = `Poste NN` with **zero-padded 2-digit** post number (e.g. `Poste 07`). Matches existing console preview in `index.html`.
- **D-PM-02:** Balloon/description = **minimal** — latitude and longitude only. No postType, page, or utility ID in v1 (PROJECT.md pole-type data stays parser-only).
- **D-PM-03:** Posts with `lat == null` or `lon == null` are **omitted** from KML. Generation result includes a **count** of skipped posts (e.g. `stats.omittedNoGps`) plus warnings array entry — never silent drop.
- **D-PM-04:** Point altitude mode = **`clampToGround`** on all post placemarks (field navigation on terrain).

### Route line topology

- **D-LN-01:** **One `<Placemark>` + `<LineString>` per `connections[]` edge** (`from` → `to`). Do not merge into single master polyline or per-page runs — preserves branches and Phase 2 graph fidelity.
- **D-LN-02:** `gap: true` connections use the **same line style** as normal segments (still draw GPS endpoints).
- **D-LN-03:** Branch junction lines use the **same color/thickness** as main route (no secondary branch style in v1).
- **D-LN-04:** `cross_page: true` connections are **always drawn** as straight GPS segments (same style as normal; no omit, no special dash in v1).
- **D-LN-05:** Every route LineString placemark carries the **same user-supplied description** — one global text field applied to all line placemarks (e.g. project/cable note). Empty string allowed. Wired via customization options (`lineDescription`); Phase 4 adds the input; Phase 3 accepts it in the options object.

### Icon customization (CUST-01)

- **D-IC-01:** Icon images = **built-in Google Earth icon URLs** in KML `<Icon><href>` (no PNG files in ZIP unless a future override is added).
- **D-IC-02:** Default post icon = **Google Earth built-in square** icon (framed square: outer border + small filled square inside). Verify exact `href` against Earth’s palette during implementation; user confirmed this visual, not pushpin.
- **D-IC-03:** Icon **color** = **Google Earth preset colors** only (not free-form hex picker in UI). Options object may accept preset keys mapped to known KML color values / icon color styles.
- **D-IC-04:** Icon **size** = **fixed scale 1.0** in v1 — no size customization until Phase 4 (CUST-01 size deferred for UI).

### Line and label customization (CUST-02, CUST-03)

- **D-ST-01:** Phase 3 options object supports **full style fields**: `lineColor`, `lineWidth`, `labelColor`, `labelScale` (Phase 4 wires controls). Colors via **Earth preset palette** (same approach as icons).
- **D-ST-02:** Defaults live in **`parser/kmz-defaults.js`** — single source; options shallow-merge overrides.

### Module API and Phase 3 UI

- **D-API-01:** **Two-step API:** `buildKml(posts, connections, options) → string` then `packageKmz(kmlString, options?) → Promise<Blob>` (JSZip). Optional combined helper is Claude’s discretion if it reduces duplication.
- **D-API-02:** `buildKml` / packaging return value includes **`stats`** object at minimum: `{ placemarkCount, lineCount, omittedNoGps, warnings[] }`.
- **D-API-03:** Phase 3 **`index.html`**: **dev/test hook only** — e.g. “Download KMZ” after Calculate Route, calling generator with **hardcoded defaults** (not full customization panel).
- **D-API-04:** Implement **`hexToKmlColor(hex)`** utility (standard `#RRGGBB` → KML `aabbggrr`) per PITFALLS research; unit-test conversion.

### Claude's Discretion

- Exact Google Earth square icon `href` URL after visual verification in Earth.
- Preset color key → KML `color` / `IconStyle` mapping table in `kmz-defaults.js`.
- KMZ download filename pattern (e.g. `route.kmz` vs derive from PDF name).
- Whether to export a thin `generateKmz(...)` wrapper around the two-step API.
- `<Style>` sharing vs per-placemark inline styles (performance vs simplicity).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and roadmap

- `.planning/ROADMAP.md` — Phase 3 success criteria (KMZ-01–05, CUST-01–03)
- `.planning/REQUIREMENTS.md` — KMZ-* and CUST-* requirement definitions
- `.planning/PROJECT.md` — client-side-only constraint; core KMZ value proposition

### Stack and pitfalls (pre-researched)

- `.planning/research/STACK.md` — template-string KML, JSZip 3.10.x CDN, `doc.kml` in ZIP
- `.planning/research/PITFALLS.md` — §6 KML `aabbggrr` color format; `hexToKmlColor` requirement
- `.planning/research/SUMMARY.md` — component pipeline: KML Builder → KMZ Packager

### Phase 2 output contract (input to Phase 3)

- `parser/coordinate-calculator.js` — `calculateCoordinates()` returns `{ posts, connections, warnings }`; `connections[]` shape: `{ from, to, meters, bearing, gap, cross_page? }`
- `.planning/phases/02-coordinate-calculator/02-CONTEXT.md` — D-ACC-09 connections contract; Phase 3 consumer note
- `.planning/phases/02-coordinate-calculator/02-REVIEW.md` — connections array ready for KMZ line rendering

### Phase 1 / integration

- `index.html` — existing Calculate Route flow; dev download hook attaches here
- `parser/pdf-parser.js` — re-exports `calculateCoordinates`; pipeline entry for UI

### KML reference (external)

- [KML 2.2 reference — Style, IconStyle, LineStyle, LabelStyle](https://developers.google.com/kml/documentation/kmlreference) — structure for placemarks and shared styles

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `calculateCoordinates()` in `parser/coordinate-calculator.js` — already produces `connections[]` with `gap`, `cross_page`, branch junction edges; KMZ line builder must iterate this array, not `post.number + 1`.
- `index.html` — posts preview, warnings list, calc button; add dev-only KMZ download after successful calculation.
- CDN pattern from `index.html` / `package.json` — JSZip 3.10.1 via cdnjs (per STACK.md); match existing ESM import style.

### Established Patterns

- **ESM modules under `parser/`** — no bundler; new files e.g. `parser/kml-builder.js`, `parser/kmz-packager.js`, `parser/kmz-defaults.js`.
- **Pure functions** — mirror `coordinate-calculator.js` / `geo/*` style; no classes unless justified.
- **Warnings accumulation** — return warnings in stats; surface in UI like parser/calc warnings.

### Integration Points

- Input: `posts` with `number`, `lat`, `lon`, optional `postType` (unused in balloon per D-PM-02); `connections` from same `calculateCoordinates` call.
- Output: `Blob` → `URL.createObjectURL` + temporary `<a download>` (STACK.md native download; Phase 4 polishes UX).
- Phase 4 will wire customization inputs to the same `options` object defined here.

</code_context>

<specifics>
## Specific Ideas

- Default field icon is the **framed square** (outer line + small filled square inside) — user’s primary visual for posts in Earth; use built-in GE square URL after verification.
- Route lines need a **description field the user fills in** — one global note on all line placemarks (not per-segment).
- Icon/line colors: **Google Earth preset palette**, not custom hex pickers in v1 UI.

</specifics>

<deferred>
## Deferred Ideas

- **Per-segment line descriptions** — user chose global single description; per-edge text is future enhancement if needed.
- **Rich placemark balloons** (postType, page, distances) — deferred; minimal lat/lon only in v1.
- **Icon size slider / presets** — fixed scale 1.0 until Phase 4 UI.
- **Branch-specific line color** — same as main route in v1.
- **Dashed cross-page or gap lines** — same style as normal in v1.
- **Map preview before download (ENH-01)** — Phase 4 / v2.
- **Bundled custom PNG icons** — only if built-in square URL fails visual check.

</deferred>

---

*Phase: 03-KMZ Generator with Customization*
*Context gathered: 2026-05-26*
