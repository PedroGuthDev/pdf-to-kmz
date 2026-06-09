# Phase 09: Diagnostic Failure & Confidence Surfacing - Pattern Map

**Mapped:** 2026-06-09
**Files analyzed:** 5 modified (no net-new files required) + 2 test files to update
**Analogs found:** 5 / 5 (all targets are in-place extensions of existing modules — the analog IS the file being edited)

> **Key framing for the planner:** This phase has NO net-new files. Every "analog"
> is the *same file* being extended in-place; the patterns below are the EXISTING
> in-file conventions each edit must mirror (string-array `parts.push` for KML,
> `switch(o.kind)` for Portuguese warnings, `textContent` DOM lists for the UI,
> additive return-shape fields for the gate). Match the file's own style, do not
> introduce a new paradigm. A small new pure helper module
> (`parser/dwg/tier-styles.js` for tier→hex + `overallTier()`) is allowed at
> planner discretion — its analog is `parser/kml-color.js` (pure, no-I/O, single export).

## File Classification

| Modified File | Role | Data Flow | Closest Analog (in-file pattern) | Match Quality |
|---------------|------|-----------|----------------------------------|---------------|
| `parser/kml-builder.js` | builder / serializer | transform (posts → KML string) | itself — existing `buildKml` placemark loop + `<Style>` header | exact (in-place) |
| `parser/dwg/residual-gate.js` | service (pure judge) | transform (scores → tiers) | itself — existing `applyResidualGate` return object | exact (in-place) |
| `parser/dwg/coordinate-calculator-dwg.js` | service (assembly point) | transform (cascade → result) | itself — `formatDwgWarning` switch + `successResult`/`missResult` builders | exact (in-place) |
| `browser/main.js` | UI / DOM | event-driven / request-response | itself — `showWarnings`/`showUserNoticeList` + download handler | exact (in-place) |
| `parser/kmz-defaults.js` | config | transform (options → KML colors) | itself — `PRESET_COLORS` + `resolveStyleColors` | exact (in-place) |
| `parser/dwg/tier-styles.js` *(optional new)* | utility (pure) | transform (tier → hex/style string) | `parser/kml-color.js` (pure single-purpose export) | role-match |
| `parser/__tests__/kml-builder.test.mjs` | test | — | itself + `residual-gate.test.mjs` | exact (in-place) |

## Pattern Assignments

### `parser/kml-builder.js` (builder, transform) — D-01/02/04/05/11

**Analog:** itself — `buildKml()` at lines 246-392.

**In-file convention — KML is assembled as a flat string array via `parts.push`** (lines 312-319, 331-343). Every new `<Style>`, `<ExtendedData>`, balloon line must be pushed into the same `parts` array, in the same order. Do NOT introduce a templating layer.

**Existing single-style header to REPLACE/EXTEND** (lines 317-318):
```javascript
`<Style id="postPoint"><IconStyle><color>${colors.iconColorKml}</color><scale>1</scale><Icon><href>${escapeXml(merged.iconHref)}</href></Icon></IconStyle><LabelStyle><color>${colors.labelColorKml}</color><scale>${merged.labelScale}</scale></LabelStyle></Style>`,
`<Style id="routeLine"><LineStyle><color>${colors.lineColorKml}</color><width>${merged.lineWidth}</width></LineStyle></Style>`,
```
- D-01: emit 4 tier `<Style id="tierHigh|tierMed|tierLow|tierUnresolvable">` blocks built from this same template; keep `routeLine` uniform (D-02 — do NOT touch line styling).

**Existing placemark loop to EXTEND** (lines 321-343) — this is the per-post emit site:
```javascript
for (const post of posts) {
  if (!hasGps(post)) {
    stats.omittedNoGps += 1;                       // ← D-11: replace silent drop
    warnings.push(`[kml-builder] post ${padPostNumber(post.number)} omitted (no GPS)`);
    continue;
  }
  const name = `Poste ${padPostNumber(post.number)}`;
  const desc = `Lat: ${post.lat}, Lon: ${post.lon}`;   // ← D-05: prepend tier line
  parts.push(
    "<Placemark>",
    `<name>${escapeXml(name)}</name>`,
    `<description>${escapeXml(desc)}</description>`,
    "<styleUrl>#postPoint</styleUrl>",               // ← D-01: tier styleUrl per post
    "<Point>",
    "<altitudeMode>clampToGround</altitudeMode>",
    `<coordinates>${Number(post.lon).toFixed(7)},${Number(post.lat).toFixed(7)},0</coordinates>`,
    "</Point>",
    // ← D-04: emit <ExtendedData> here, sibling of <Point>, before </Placemark>
    "</Placemark>",
  );
  stats.placemarkCount += 1;
}
```

**XML escaping — MUST reuse** the file's `escapeXml()` (lines 7-14) for every new `<Data>` / `<description>` value (V5 output-encoding). Never `.replace()`-chain inline.

**KML color byte-order — MUST reuse** `hexToKmlColor()` from `./kml-color.js` for tier hex → `aabbggrr` (do NOT hand-build `aabbggrr`).

**`stats` object to extend** (lines 251-257) — `omittedNoGps`/`skippedLines`/`warnings` already tracked; D-11 repurposes `omittedNoGps` and should add a distinct counter/list for "no coord at all" vs "UNRESOLVABLE-with-fallback-coord".

**Byte-stable / do-NOT-touch:** `normalizeConnections` (66-126), `preferMainRouteEdge` (140-175), `buildRoutePolylines` (184-238) — these own connections/polyline geometry (Pitfall 4 accuracy gates). The polyline emit loop (352-388) keeps the single `#routeLine` styleUrl (D-02).

---

### `parser/dwg/residual-gate.js` (service, transform) — D-06/D-08

**Analog:** itself — `applyResidualGate()` at lines 170-223.

**In-file convention — ADDITIVE return-shape change only.** The return object (lines 222) is `{ gateDecision, shapeFidelity, anchorGap, postTiers }`. D-06/D-08 ADD fields; never rename/remove/reorder existing fields, never change a `tier` value or threshold constant (Pitfall 1).

**The per-post sub-scores ALREADY computed internally** (lines 186-216) — D-06 only EXPOSES them. Note the two existing maps and the per-post tier branch:
```javascript
const incidentRel = new Map();   // postNumber → max incident relError  (line 186)
const anchorByPost = new Map();  // postNumber → gapM                   (line 194)
// inside the postTiers loop (lines 210-216):
const shapeScore  = hasEdge   ? incidentRel.get(postNumber) : null;   // → shape_residual_m
const anchorScore = hasAnchor ? anchorByPost.get(postNumber) : null;  // → anchor_gap_m
tier = high ? "HIGH" : low ? "LOW" : "MED";
```
D-06: enrich each `postTiers.push({ postNumber, tier })` (line 218) → `{ postNumber, tier, shapeResidualM: shapeScore, anchorGapM: anchorScore }`. `perEdge[].residualM` (line 78) and `anchor.perPost[].gapM` (line 112) are the raw-meter sources for ExtendedData.

**D-08 `overall` — pure read over existing `{ gateDecision, postTiers }`, NO recompute.** Threshold constants `SHAPE_TRUST`/`ANCHOR_TRUST_M` etc. (lines 10-15) are LOCKED — do not touch. The `overall` derivation reads `gateDecision` + `postTiers[].tier` only (gate-gated worst-case).

**Test contract:** `residual-gate.test.mjs` asserts `postTiers[].tier ∈ {HIGH,MED,LOW,UNRESOLVABLE}` and specific `postNumber→tier` pairs — additive fields are safe. CI baseline (`residual-gate-baseline.json`) snapshots `gateDecision` only.

---

### `parser/dwg/coordinate-calculator-dwg.js` (service, transform) — D-08/D-09/D-12/D-13

**Analog:** itself — `formatDwgWarning()` (80-127), `buildCalcUserWarnings()` (45-78), result builders (297-330, 440-512).

**Pattern 1 — Portuguese warning taxonomy is a single `switch (o.kind)`** (lines 84-126). D-09 adds a NEW `case` arm; never a parallel taxonomy. Mirror the existing meter-formatting idiom (`Number(o.x).toFixed(1)`):
```javascript
// existing arm to copy the shape of (lines 91-97):
case "dwg-pair-fail": {
  const dist = o.nearest_dwg_distance_m != null
    ? `${Number(o.nearest_dwg_distance_m).toFixed(1)} m` : "sem candidato";
  return `DWG: pareamento falhou no poste ${o.at_post} (mais próximo ${dist}, tol ${o.tolerance_m} m). Usando só PDF.`;
}
// D-09 new arm (mirror): case "diverged-at-post": return `DXF: rota divergiu no poste ${o.at_post} (resíduo ${Number(o.residual_m).toFixed(1)} m).`;
```

**Pattern 2 — structured warning objects are PUSHED as `{ kind, … }`** (lines 308, 379). The `diverged-at-post` object is produced at the assembly site, then formatted by the switch:
```javascript
warnings.push({ kind: "dwg-region-miss", lat: lat1, lon: lon1 });  // line 308 — template
```

**Pattern 3 — `dwgConfidence` attach point** (line 497) is the single assembly site; D-08 `overall` lands on the SAME object:
```javascript
const shape  = computeResiduals(cascade.coords, distances);   // line 495
const anchor = computeAnchorGap(cascade.coords, gpsByPostNumber);  // line 496
successResult.dwgConfidence = applyResidualGate(shape, anchor);    // line 497 — overall lands here
```

**Pattern 4 — block-vs-flag disambiguation (D-12/D-13, the #1 correctness risk).** Three distinct exit shapes already exist; the disambiguator is `dwgNoRegion` presence + zone-mismatch, NOT the `dwgStatus` string:
| Exit | Lines | Carries | D-12/D-13 policy |
|------|-------|---------|------------------|
| no-region miss | 322-330 | `dwgNoRegion` (from `noRegionError`, lines 19-36) + `dwgStatus:"pdf-fallback"` | **HARD BLOCK** (no KMZ) |
| zone/envelope miss | 297-304 | `dwgStatus:"pdf-fallback"`, NO `dwgNoRegion` | **HARD BLOCK** (unit-mismatch) |
| cascade-fail-after-match | 440-449 | `dwgStatus:"pdf-fallback"` + `dwgRegionId` set, NO `dwgNoRegion` | **FLAG + emit** (region matched) |
| success | 478-512 | `dwgConfidence`, `solverPath/Demoted/demotionReason/solverScore` | **FLAG by tier** (emit) |

`noRegionError` (lines 19-36) already returns `{ code:"NO_REGION", nearest:{ name, distanceKm } }` — reuse for the D-12 banner hint+distance. **Open question for planner (RESEARCH Q2):** add an explicit `hardBlock: true/false` field at the calculator so the UI does not string-sniff `dwgStatus`.

---

### `browser/main.js` (UI/DOM, event-driven) — D-07/D-11/D-12

**Analog:** itself — `showUserNoticeList`/`showWarnings` (630-661) for the banner; calc handler (785-861) and download handler (863-932) for wiring.

**Pattern 1 — DOM lists are built with `textContent`, never `innerHTML`** (lines 636-639, 655-658) — V5 anti-injection. The new banner MUST follow:
```javascript
function showWarnings(warnings) {                    // lines 652-661 — template for the banner
  if (!warnings || warnings.length === 0) return;
  warningsList.innerHTML = "";
  for (const w of warnings) {
    const li = document.createElement("li");
    li.textContent = w;                              // ← textContent, not innerHTML
    warningsList.appendChild(li);
  }
  warningsEl.style.display = "block";
}
```
D-07 banner is a NEW prominent DOM block (separate from `#warningsList`); reuse the show/hide `style.display` idiom. Whether new DOM element or restyled region = planner discretion (CONTEXT).

**Pattern 2 — warnings are formatted via `formatDwgWarning`** at the UI boundary (lines 794-799, 1062). Reuse — do NOT reformat in the banner:
```javascript
li.textContent = "[calc] " + (typeof w === "string" ? w : formatDwgWarning(w));  // line 796-797
```

**Pattern 3 — `lastCalcResult` must carry tier data (Pitfall 6).** Today it stores only 3 fields (lines 849-853); `dwgConfidence`/`postTiers`/`overall` are NOT carried, so the download closure cannot color by tier:
```javascript
lastCalcResult = {                       // lines 849-853 — EXTEND with dwgConfidence + overall
  posts: calculatedPosts,
  connections,
  warnings: calcWarnings,
};
```

**Pattern 4 — `buildKml` is called in the download handler** (lines 875-879); D-01 tier data must be threaded in here, and D-11 stats consumed:
```javascript
const { kml, stats } = buildKml(lastCalcResult.posts, lastCalcResult.connections, opts);  // ← add { …opts, postTiers }
// stats.omittedNoGps handling at lines 902-912 — REWORD for D-11 flag semantics ("Postes não resolvidos: …")
```
The `kmzStatsOmitted` element (lines 902-907) is the existing "omitted" UI string to repurpose into the unresolved-post list (D-11 / Pitfall 5).

**Pattern 5 — KMZ block gating already exists** — `downloadKmzBtn.disabled = placemarkEligible === 0` (line 857) and `toggle(downloadKmzBtn, !blocked)` (line 514). D-12 hard-block reuses this disable/hint mechanism plus the red banner.

**Build step:** `browser/main.js` edits require `npm run build` (esbuild) before the served UI reflects them.

---

### `parser/kmz-defaults.js` (config, transform) — D-03

**Analog:** itself — `PRESET_COLORS` (15-25) + `resolveStyleColors` (45-56).

**In-file convention — colors are named presets mapped through `hexToKmlColor`.** D-01 tier hexes should REUSE existing presets where possible (`green`/`yellow`/`amber`/`red`) rather than inventing hexes:
```javascript
export const PRESET_COLORS = {            // lines 15-25 — reuse green/yellow/amber/red
  red: '#ff0000', green: '#00ff00', yellow: '#ffff00', amber: '#ffaa00', /* … */
};
```
D-03: tier styles must COEXIST with user icon/label/line options (the `resolveStyleColors` output). A `TIER_COLORS` export here is reasonable (planner discretion); tier color wins over user icon color (default, no toggle — toggle deferred).

---

### `parser/dwg/tier-styles.js` *(optional new pure module)* — planner discretion

**Analog:** `parser/kml-color.js` (lines 1-22) — a pure, no-I/O module with a single focused `export function`. If the planner extracts `tierStyleBlock()` / `overallTier()` here, mirror that file's shape: JSDoc header, named exports, zero side effects, throw on invalid input (as `hexToKmlColor` does at lines 12-14).

---

## Shared Patterns

### XML / Output Encoding (V5)
**Source:** `parser/kml-builder.js` `escapeXml()` (lines 7-14)
**Apply to:** every new `<Data>` value, balloon `<description>`, tier line in `kml-builder.js`.
```javascript
function escapeXml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
```

### DOM Output Encoding (V5)
**Source:** `browser/main.js` `showWarnings` (line 657)
**Apply to:** the new status banner + unresolved-post list — use `el.textContent = …`, never `innerHTML` with interpolated post/region data.

### KML Color Byte-Order
**Source:** `parser/kml-color.js` `hexToKmlColor()` (lines 10-21)
**Apply to:** all 4 tier `<Style>` `<color>` values — `#RRGGBB` → `aabbggrr`. Never hand-build the byte string.

### Portuguese Warning Taxonomy
**Source:** `coordinate-calculator-dwg.js` `formatDwgWarning()` switch (lines 80-127)
**Apply to:** every new Phase-9 user-facing failure reason — add a `case`, mirror the `Number(o.x).toFixed(1)` meter idiom, keep `DWG:`/`DXF:` prefix phrasing.

### Additive Return-Shape Discipline
**Source:** `residual-gate.js` return (line 222) + `successResult` assembly (lines 478-512)
**Apply to:** gate `overall`/sub-scores and calculator `hardBlock`/`overall` — ADD fields, never rename/remove/reorder; never mutate coords, tiers, or thresholds (Pitfalls 1, 2, 4).

### No Numeric `%` Anywhere (CONF-04 anti-feature)
**Apply to:** banner, balloon, ExtendedData, warnings. Tier LABELS only (ALTA/MÉDIA/BAIXA/NÃO RESOLVIDO). Raw METERS are allowed as diagnostics; `%`/quality-seal numbers are forbidden.

## Test Patterns

### `parser/__tests__/kml-builder.test.mjs` (WILL need edits — Pitfall 5)
**Analog:** itself — `node:test` + `node:assert/strict`, `describe`/`it`, `buildKml`/`buildRoutePolylines` direct calls (lines 1-60). Asserts `stats.omittedNoGps` counts (~line 207) — D-11 changes those semantics, so the test must be updated alongside the change. New tier-style / ExtendedData / balloon assertions should follow the same `assert.match(kml, /…/)` string-inspection idiom.

### `parser/__tests__/residual-gate.test.mjs` (additive-safe)
**Analog:** itself — asserts `postTiers[].tier` membership and `postNumber→tier` pairs; does NOT assert absence of extra fields, so D-06/D-08 additive fields pass unchanged. Run `npm run test:gate` as the green-bar check.

## No Analog Found

None. Every file is an in-place extension of an existing module with a clear in-file convention to mirror. The only genuinely-new artifact (optional `tier-styles.js`) has a strong role-match analog in `parser/kml-color.js`.

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| — | — | — | (no file lacks an analog) |

## Metadata

**Analog search scope:** `parser/`, `parser/dwg/`, `parser/__tests__/`, `browser/` (all targets named explicitly in CONTEXT §canonical_refs and RESEARCH).
**Files read (full or targeted):** `parser/kml-builder.js`, `parser/kml-color.js`, `parser/kmz-defaults.js`, `parser/dwg/residual-gate.js`, `parser/dwg/coordinate-calculator-dwg.js` (lines 1-140, 290-514), `browser/main.js` (lines 580-699, 770-932; grep-located call sites), `parser/__tests__/kml-builder.test.mjs` (lines 1-60).
**Pattern extraction date:** 2026-06-09
