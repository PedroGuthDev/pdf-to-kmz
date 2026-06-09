# Phase 9: Diagnostic Failure & Confidence Surfacing - Research

**Researched:** 2026-06-09
**Domain:** KML/KMZ presentation layer, in-browser DOM status UI, Portuguese diagnostic copy — a pure SURFACING layer over already-computed signals (Phase 5 residual tiers + Phase 8 D-13 structured channel)
**Confidence:** HIGH (all findings verified by direct code inspection of the files being extended; KML schema verified against OGC spec)

## Summary

Phase 9 is a **presentation-only** phase. Every confidence and failure signal it surfaces is **already computed** upstream: `applyResidualGate()` (Phase 5) emits `{ gateDecision, shapeFidelity, anchorGap, postTiers[] }`, and `calculateCoordinatesWithDwg()` (Phase 8 D-13) attaches `dwgConfidence`, `solverPath`, `solverDemoted`, `demotionReason`, `solverScore`, structured `warnings[]`, and `userWarnings[]` to its result. The work is wiring these into three sinks: (1) **KML output** — per-post tier color + `<ExtendedData>` + a Portuguese balloon line in `parser/kml-builder.js`; (2) **the gate's return shape** — additive per-post sub-scores (D-06) and a new `overall` field (D-08) in `parser/dwg/residual-gate.js`; (3) **the browser UI** — a dedicated status banner, hard-block-vs-flag logic, and an unresolved-post list in `browser/main.js`.

The entire phase must be **additive and read-only over coordinates and tier decisions**. The four accuracy gates (Siriu/LC/João Born/Valmor) and the residual-gate CI baseline must stay green — no coordinate math, no threshold change, no tier recomputation. Two existing test files assert structural properties of the gate output (`parser/__tests__/residual-gate.test.mjs`) and the KML document (`parser/__tests__/kml-builder.test.mjs`, `kml-builder-siriu-dwg.test.mjs`); the changes here are designed to extend those return shapes without breaking the existing assertions, but the KML tests and the `omittedNoGps` repurposing (D-11) WILL require test edits.

**Primary recommendation:** Treat this as four thin wiring slices that mirror D-01..D-13, threaded through one new data field (`dwgConfidence.overall` + per-post sub-scores) that flows: `residual-gate.js` → `coordinate-calculator-dwg.js successResult.dwgConfidence` → carried into `lastCalcResult` in `main.js` → consumed by `buildKml()` (KMZ) and the new status banner (UI). The single biggest correctness risk is the **block-vs-flag boundary (D-12/D-13)**: no-region and unit/envelope failures BLOCK (no KMZ); every case where a DXF region matched FLAGS and still emits.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-post tier → KML color/ExtendedData/balloon | KML builder (`parser/kml-builder.js`) | — | KML emission is owned solely by `buildKml`; it already owns `<Style>` + `<Placemark>` generation |
| Expose per-post sub-scores + `overall` tier | Residual gate (`parser/dwg/residual-gate.js`) | — | The gate already computes these internally (D-06); exposing them is a return-shape change, NOT a new computation |
| Attach `overall` + hard-block signal + `diverged-at-post` warning | Coordinate calculator (`parser/dwg/coordinate-calculator-dwg.js`) | — | This is the single assembly point where `dwgConfidence` and `warnings[]`/`userWarnings` are built (D-13 contract) |
| Status banner, hard-block render, unresolved-post list | Browser UI (`browser/main.js`) | — | DOM is browser-only; reuses `formatDwgWarning`/`showWarnings` plumbing |
| Tier color vs user-icon-color precedence | KMZ defaults/builder (`parser/kmz-defaults.js` + `kml-builder.js`) | UI (`main.js`) optional toggle | Style resolution lives in `resolveStyleColors`; tier styles must coexist with user options (D-03) |
| Partial output / flag (emit resolvable, list unresolvable) | KML builder + UI | Coordinate calculator (decides block vs emit) | `buildKml` decides marker vs omit; calculator/UI decides whole-KMZ block (D-10..D-13) |

**Note:** No tier in this map is "compute coordinates" or "decide tiers." Those belong to Phase 8 (solver/walker) and Phase 5 (gate) respectively and stay byte-stable. Every Phase-9 responsibility is a READ of an existing field plus a WRITE to an output sink.

## Standard Stack

This phase adds **zero new dependencies**. It uses only in-house modules and the KML 2.2 schema the project already emits. Confirmed against `package.json` (read 2026-06-09): the only v1.1-era addition was `munkres@2.0.3` at Phase 8; v1.1 requirements explicitly forbid new deps beyond `munkres` (REQUIREMENTS.md "Out of Scope").

### Core (existing, reused)
| Module | Purpose | Why Standard |
|--------|---------|--------------|
| `parser/kml-builder.js` `buildKml()` | Emits `<Document>` with `<Style>`, `<Placemark>`, `<LineString>` | Sole KML emission path; already tracks `omittedNoGps`/`warnings[]` stats [VERIFIED: code read] |
| `parser/dwg/residual-gate.js` `applyResidualGate()` | Returns `{ gateDecision, shapeFidelity, anchorGap, postTiers[] }` | Already computes per-post sub-scores internally (`incidentRel`, `anchorByPost` maps) — D-06 just exposes them [VERIFIED: code read, lines 186-219] |
| `parser/dwg/coordinate-calculator-dwg.js` | `formatDwgWarning()` Portuguese taxonomy + `buildCalcUserWarnings()` + `successResult.dwgConfidence` | D-09 extends the existing `{ kind, … }` → Portuguese switch; D-08 attaches `overall` at line 497 [VERIFIED: code read] |
| `browser/main.js` | `showWarnings()`/`showParseNotices()`/`showCalcNotices()` + `#warningsList`/`#warnings` | Existing notice plumbing; banner is net-new DOM (D-07) [VERIFIED: code read] |
| `parser/kmz-defaults.js` | `mergeOptions` / `resolveStyleColors` / `PRESET_COLORS` | Tier styles must coexist with user icon/line/label options (D-03) [VERIFIED: code read] |
| `parser/kml-color.js` `hexToKmlColor()` | `#RRGGBB` → KML `aabbggrr` byte order | Use this for the four tier hex values — do NOT hand-build `aabbggrr` [VERIFIED: code read] |
| `parser/kmz-packager.js` `packageKmz()` | Zips KML → KMZ blob | Unchanged; takes whatever `buildKml` emits [VERIFIED: code read] |

### Supporting
| Item | Purpose | When to Use |
|------|---------|-------------|
| `PRESET_COLORS` map (`kmz-defaults.js`) | Already has `red`/`green`/`yellow`/`amber` | Reuse `green`/`yellow`/`amber`(orange)/`red` for the traffic-light palette (D-01) rather than inventing hexes [VERIFIED: code read] |
| Google pushpin palette `http://maps.google.com/mapfiles/kml/paddle/{grn,ylw,orange,red}-blank.png` | Pre-colored marker icons | Optional alternative to `<color>` tinting of the existing `placemark_square.png` (D-01 Claude's discretion) [CITED: developers.google.com/kml/documentation] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| 4 static `<Style>` blocks keyed by tier | KML `<StyleMap>` (normal/highlight) | StyleMap adds hover behavior nobody asked for; 4 flat `<Style id="tierHigh">…` is simpler and matches the existing single-`#postPoint` pattern (D-01) |
| `<color>` tint on shared icon href | Distinct pre-colored Google paddle icons | Tinting reuses the user's `iconHref`; paddle icons override it. D-03 says tier wins over user icon color anyway, so either works — tinting is the smaller diff |
| New `dwgConfidence.overall` field | Reuse `gateDecision` (trust/fallback/fail) | `gateDecision` is route-level shape+anchor only; `overall` (D-08) must be gate-gated worst-case across BOTH gateDecision AND per-post tiers, so it is genuinely net-new |

**Installation:** None. `npm install` already satisfies all dependencies (verified `package.json`).

## Package Legitimacy Audit

Not applicable — this phase installs **no external packages**. All work uses in-house modules (`parser/*`, `browser/main.js`) already present in the repo. The only v1.1 dependency, `munkres@2.0.3`, was vetted and added at Phase 8 and is not touched here.

## Architecture Patterns

### System Architecture Diagram

```
                          (already computed upstream — Phase 5 + Phase 8)
  applyResidualGate()  ──►  { gateDecision, shapeFidelity, anchorGap, postTiers[] }
   (residual-gate.js)            │
                                 │  D-06: ALSO expose per-post sub-scores
                                 │  D-08: ALSO compute `overall` (gate-gated worst-case)
                                 ▼
  calculateCoordinatesWithDwg() successResult.dwgConfidence  ◄─── solverPath/solverDemoted/
   (coordinate-calculator-dwg.js)         │                       demotionReason (D-13 channel)
                                          │  D-09: extend formatDwgWarning taxonomy
                                          │  D-12/D-13: set hard-block signal vs flag
                                          ▼
              ┌───────────────────────────┴───────────────────────────┐
              │                                                        │
   main.js: lastCalcResult                                  (hard-block? → NO KMZ)
   (carry dwgConfidence + postTiers)                                   │
              │                                                        │
   ┌──────────┴───────────┐                              ┌─────────────┴──────────────┐
   ▼                      ▼                              ▼                            ▼
 STATUS BANNER       #warningsList                  buildKml(posts, conns,        Portuguese
 (D-07):             (existing scroll list)          {…, postTiers})              reason +
  overall tier        per-warning detail            (kml-builder.js):            nearest hint
  + hard reason                                       D-01: 4 tier <Style>        (D-12)
  + unresolved list                                   D-02: routeLine uniform
  (D-11)                                              D-04: <ExtendedData>
                                                      D-05: balloon tier line
                                                      D-11: red marker / list
                                                            │
                                                            ▼
                                                   packageKmz() → .kmz blob
```

Trace the SC-1 happy path (Siriu + correct DXF): gate returns all-HIGH `postTiers` + `gateDecision:"trust"` → `overall:"high"` → banner shows green "Confiança geral: ALTA", KMZ has all-green markers, no `%` anywhere, no hard block.

### Recommended structure (no new files required; all edits in-place)
```
parser/
├── dwg/residual-gate.js          # D-06 add per-post sub-scores; D-08 add `overall`
├── dwg/coordinate-calculator-dwg.js  # D-08 attach overall; D-09 new warning kind; D-12/13 block signal
├── kml-builder.js                # D-01/02/04/05/11 tier styles, ExtendedData, balloon, flag
├── kmz-defaults.js               # D-03 tier style coexistence (optional: TIER_COLORS export)
browser/
└── main.js                       # D-07 banner; D-11 unresolved list; D-12/13 block render
```
A small new pure module (e.g. `parser/dwg/tier-styles.js` exporting tier→hex + KML `<Style>` strings, and an `overallTier()` helper) is reasonable and keeps `buildKml`/gate diffs small. Planner's discretion.

### Pattern 1: Tier-keyed `<Style>` blocks replace the single `#postPoint`
**What:** Emit four `<Style id="tierHigh|tierMed|tierLow|tierUnresolvable">` blocks once in the document header; each `<Placemark>` references `<styleUrl>#tier{X}</styleUrl>` for its post's tier instead of the shared `#postPoint` (D-01).
**When to use:** Always, when `postTiers` is available; fall back to `#postPoint` when no tier data (PDF-only path with no gate output).
**Example (build the four styles via existing helper — do NOT hand-write `aabbggrr`):**
```javascript
// Source: pattern over existing parser/kml-color.js + kmz-defaults.js (code read 2026-06-09)
import { hexToKmlColor } from "./kml-color.js";
const TIER_HEX = { HIGH: "#00c853", MED: "#ffd600", LOW: "#ff8f00", UNRESOLVABLE: "#d50000" };
function tierStyleBlock(tier, iconHref) {
  const id = "tier" + tier.charAt(0) + tier.slice(1).toLowerCase(); // tierHigh, tierMed…
  return `<Style id="${id}"><IconStyle><color>${hexToKmlColor(TIER_HEX[tier])}</color>`
       + `<scale>1</scale><Icon><href>${iconHref}</href></Icon></IconStyle></Style>`;
}
```

### Pattern 2: `<ExtendedData>` with `<Data name="…">` (D-04)
**What:** Per-placemark machine-readable diagnostics in Google Earth's standard `<ExtendedData>` container. Meters are explicitly ALLOWED (diagnostics, not a %-seal — D-04/CONF-04).
**Example:**
```xml
<!-- Source: KML 2.2 spec, developers.google.com/kml/documentation/extendeddata -->
<ExtendedData>
  <Data name="tier"><value>MED</value></Data>
  <Data name="shape_residual_m"><value>9.6</value></Data>
  <Data name="anchor_gap_m"><value>179.0</value></Data>
  <Data name="source"><value>dwg</value></Data>
  <Data name="demotionReason"><value>topology-gate-rejected</value></Data>
</ExtendedData>
```
All values MUST pass through `escapeXml()` (already in `kml-builder.js`). `<ExtendedData>` is a sibling of `<Point>` inside `<Placemark>`.

### Pattern 3: Portuguese balloon line in `<description>` (D-05)
**What:** Prepend a tier line to the existing `Lat: …, Lon: …` description. Tier label in Portuguese: HIGH=ALTA, MED=MÉDIA, LOW=BAIXA, UNRESOLVABLE=NÃO RESOLVIDO.
**Example:** `Confiança: MÉDIA — Lat: -27.93, Lon: -48.61`. No `%` value. (CDATA optional — current code uses `escapeXml`, keep it consistent.)

### Pattern 4: Structured warning → `formatDwgWarning` (D-09)
**What:** Add new `case` arms to the existing switch, never a parallel taxonomy. New kind: `diverged-at-post` carrying `{ at_post, residual_m }`.
**Example:**
```javascript
// Source: extend existing switch in coordinate-calculator-dwg.js (code read, line 80-127)
case "diverged-at-post":
  return `DXF: rota divergiu no poste ${o.at_post} (resíduo ${Number(o.residual_m).toFixed(1)} m).`;
```
CONF-01's three named cases map to: no-region → existing `dwg-region-miss` (+ `dwgNoRegion.nearest` hint/distance, already computed by `noRegionError`); unit mismatch → existing `dwg-zone-mismatch` / DXF-02 fail-loud; "diverged at post N" → this new kind.

### Pattern 5: `overall` = gate-gated worst-case (D-08)
**What:** `dwgConfidence.overall` is `"high"` ONLY when `gateDecision === "trust"` AND no post is LOW/UNRESOLVABLE; otherwise it degrades to the worst material per-post tier. This is fail-loud: a passing route-level gate cannot mask a single LOW post.
**Example logic:**
```javascript
// derive from existing { gateDecision, postTiers } — pure read, no recompute
function overallTier(gateDecision, postTiers) {
  const worst = ["UNRESOLVABLE","LOW","MED","HIGH"].find(t => postTiers.some(p => p.tier === t));
  if (gateDecision === "trust" && (worst === "HIGH" || worst == null)) return "high";
  return { UNRESOLVABLE: "unresolvable", LOW: "low", MED: "med", HIGH: "med" }[worst] ?? "low";
}
```
Planner refines the exact mapping; the contract is: trust + all-HIGH ⇒ "high"; anything else ⇒ worst material tier (never "high"). SC-1 requires Siriu+correct-DXF ⇒ "high".

### Anti-Patterns to Avoid
- **Recomputing tiers in the UI or KML builder.** Read `postTiers`; never re-threshold. The gate is the sole judge (Phase 5 lock).
- **Per-segment line recoloring.** D-02: a line spans two posts of possibly different tiers; recoloring is ambiguous. Keep the single uniform `routeLine`.
- **Any `%` value, anywhere** (balloon, banner, ExtendedData, warnings). CONF-04. Meters are fine; percentages are forbidden.
- **Silently dropping a declared post** (today's `omittedNoGps` behavior). D-11: every declared post is a colored marker (if any coord) or a listed number in the banner.
- **Emitting a KMZ with silently-wrong coords on a hard failure.** D-12/SC-2: no-region & unit-mismatch BLOCK. Do not auto-emit PDF-only on these.
- **Hard-blocking a matched-region degradation.** D-13: any case where a DXF region matched (even degraded to PDF-fallback) FLAGS and emits — never blocks.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| `#RRGGBB` → KML byte order | Manual `aa+bb+gg+rr` string concat | `hexToKmlColor()` (`kml-color.js`) | Already handles alpha, validation, byte-swap; hand-rolling re-introduces the rr/bb swap bug it exists to prevent |
| XML escaping in new ExtendedData/balloon text | `.replace()` chains | existing `escapeXml()` in `kml-builder.js` | Reuse the one escaper so `&`/`<`/`"` are consistent across the document |
| Portuguese failure strings | New string map/i18n layer | extend `formatDwgWarning()` switch | D-09 — one taxonomy; nearest-region hint + distance already computed by `noRegionError` |
| Nearest-region hint + distance | New distance scan | existing `dwgNoRegion.nearest.{name, distanceKm}` | `noRegionError()` already returns it (code read, line 19-36) |
| Route-level confidence number | New scoring function | derive `overall` from existing `gateDecision` + `postTiers` | Phase 5 already produced both signals; overall is a pure read/min |
| KMZ zip packaging | New zip code | `packageKmz()` (`kmz-packager.js`) | Unchanged; emits whatever KML it's given |

**Key insight:** Every signal this phase displays already exists in `dwgConfidence` and the D-13 channel. The temptation is to "compute confidence" — but Phase 9 must compute NOTHING about coordinates or tiers. If a slice looks like it needs new math, it's mis-scoped.

## Runtime State Inventory

> This is a code/output-format phase, not a rename/migration. No persisted runtime state is renamed or migrated. Documented explicitly per the protocol:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no database keys, collection names, or user_ids change. KMZ files are generated fresh per download; no stored KMZ to migrate. | None |
| Live service config | None — no external service (n8n/Datadog/etc.) configuration is touched. | None |
| OS-registered state | None — no scheduled tasks, pm2 processes, or systemd units. | None |
| Secrets/env vars | None — no secret keys or env var names referenced or renamed. | None |
| Build artifacts | The browser bundle is rebuilt via `npm run build` (esbuild, `scripts/build.mjs`); any `main.js` change requires a rebuild before the served UI reflects it. Not stale state — just the normal build step. | Run `npm run build` after `browser/main.js` edits |

**Nothing found in categories 1-4** — verified by inspecting the four target files and `package.json`; this phase only changes output FORMAT (KML strings, DOM, return-object fields), not persisted state.

## Common Pitfalls

### Pitfall 1: Breaking the residual-gate CI baseline by changing `applyResidualGate` return shape
**What goes wrong:** D-06 adds per-post sub-scores and D-08 adds `overall` to the gate return. If the new fields alter or reorder existing fields, `tools/run-residual-gate.mjs` and `parser/__tests__/residual-gate.test.mjs` could fail.
**Why it happens / why it's actually safe:** The CI baseline (`residual-gate-baseline.json`) snapshots ONLY `gateDecision` per route (`{"siriu":"fail", …}` — verified). The unit test asserts `postTiers[].tier ∈ {HIGH,MED,LOW,UNRESOLVABLE}` and specific `postNumber→tier` pairs (lines 168-209) — it does NOT assert the absence of extra fields. So **additive** fields (`postTiers[].shapeResidualM`, `…anchorGapM`, top-level `overall`) are safe.
**How to avoid:** Add new fields; never rename/remove `gateDecision`, `postTiers`, `shapeFidelity`, `anchorGap`, or change tier values. Keep `postTiers[].tier` unchanged. Run `npm run test:gate` (includes `run-residual-gate.mjs`) as the green-bar check.
**Warning signs:** Any change to a threshold constant or tier-assignment branch — that's tier RECOMPUTATION, out of scope.

### Pitfall 2: Confident-but-wrong overall tier (the project's #1 historical trap)
**What goes wrong:** A route passes the route-level `gateDecision` but contains LOW/UNRESOLVABLE posts; if `overall` reads only `gateDecision`, the banner shows "ALTA" over a partly-wrong route.
**Why it happens:** `gateDecision:"trust"` is shape-median + anchor-p95 aggregate; it can be "trust" while a tail post is LOW.
**How to avoid:** D-08 gate-gated worst-case — `overall` is "high" ONLY if gateDecision trusts AND no post is below HIGH. This is the explicit reason D-08 exists. See `.planning/research/PITFALLS.md` §Pitfall 1.
**Warning signs:** Any `overall` derivation that ignores `postTiers`.

### Pitfall 3: Mis-routing the block-vs-flag boundary (D-12/D-13)
**What goes wrong:** Either (a) blocking a matched-region PDF-fallback (withholding usable data, violates D-10/D-13), or (b) emitting a KMZ on a true no-region/unit-mismatch (silently-wrong coords, violates D-12/SC-2).
**Why it happens:** The two failure families look similar in the warnings array but have opposite policies.
**How to avoid:** Decision rule — **a DXF region MATCHED** ⇒ FLAG + emit (colored by tier, strongest "precisão limitada" warning). **No region covers post-1 GPS** (`dwgNoRegion` present / `code:"NO_REGION"`) OR **unit/envelope mismatch** (`dwg-zone-mismatch`, DXF-02) ⇒ BLOCK, no KMZ, show Portuguese reason + nearest hint. Note: the `pdf-fallback` status appears in BOTH a hard-miss (no region → block) and a matched-then-degraded case — distinguish by presence of `dwgNoRegion`/region match, not by `dwgStatus` string alone.
**Warning signs:** Branching on `dwgStatus === "pdf-fallback"` alone to decide block vs emit — it's ambiguous; check region-match + failure kind.

### Pitfall 4: Siriu/LC/JB/Valmor accuracy regression through shared code
**What goes wrong:** A change to `kml-builder.js` or the gate that subtly alters coordinates or connections breaks a four-route gate.
**Why it happens:** These files are shared; the project has been burned repeatedly (STATE.md "Siriu regression through shared subsystems").
**How to avoid:** Surfacing is read-only over `posts`/`connections`/coords. `buildRoutePolylines` and `normalizeConnections` must stay byte-stable (D-02 keeps line styling uniform, so polyline logic is untouched). Run `npm run test:gate` (all four routes + residual gate) before declaring any slice done.
**Warning signs:** Any edit to `normalizeConnections`, `buildRoutePolylines`, `preferMainRouteEdge`, or coordinate fields.

### Pitfall 5: Repurposing `omittedNoGps` breaks existing kml-builder tests
**What goes wrong:** `parser/__tests__/kml-builder.test.mjs` asserts `stats.omittedNoGps` counts (line 207) and `main.js` renders an "omitted (no GPS)" message. D-11 changes the semantics from "silently drop" to "flag/list."
**Why it happens:** D-11 explicitly replaces the silent `omittedNoGps` drop with explicit UNRESOLVABLE flagging.
**How to avoid:** Update the kml-builder test alongside the change; keep a stat for "posts with no coord at all" so `main.js` can build the `Postes não resolvidos: …` list (D-11). Distinguish "no coord at all" (list in banner) from "UNRESOLVABLE but has a fallback coord" (red marker on map).
**Warning signs:** Test failures in `kml-builder.test.mjs` line ~207; the `kmzStatsOmitted` UI string in `main.js` (line 902-908) needs rewording for the new flag semantics.

### Pitfall 6: Carrying `dwgConfidence` into the download closure
**What goes wrong:** `buildKml()` is called in the `downloadKmzBtn` click handler from `lastCalcResult` (main.js line 875), but `lastCalcResult` today only stores `{ posts, connections, warnings }` (line 849-853) — `dwgConfidence`/`postTiers` are NOT carried, so the KMZ builder can't color by tier.
**Why it happens:** Calc and download are separate event handlers; the calc result is partially copied into `lastCalcResult`.
**How to avoid:** Add `dwgConfidence` (or at least `postTiers` + `overall`) to `lastCalcResult` at line 849, and pass tier data into `buildKml(posts, connections, { …opts, postTiers })`.
**Warning signs:** Tier colors absent from the downloaded KMZ even though the banner shows tiers.

## Code Examples

### Building tier styles once + per-placemark styleUrl (D-01)
```javascript
// Source: pattern over kml-builder.js buildKml() header (code read, lines 312-319)
const tierStyleParts = ["HIGH","MED","LOW","UNRESOLVABLE"]
  .map(t => tierStyleBlock(t, merged.iconHref));
parts.push(...tierStyleParts);            // emit 4 styles after <Document><name>
// per post:
const tier = tierByPost.get(post.number) ?? null;   // from postTiers
const styleId = tier ? `#tier${cap(tier)}` : "#postPoint";
parts.push(`<styleUrl>${styleId}</styleUrl>`);
```

### Placemark with tier color, balloon line, and ExtendedData (D-04/D-05/D-11)
```javascript
// Source: extend kml-builder.js placemark loop (code read, lines 321-343)
const tierPt = tierByPost.get(post.number);                 // {tier, shapeResidualM, anchorGapM, source, demotionReason}
const tierPtLabel = { HIGH:"ALTA", MED:"MÉDIA", LOW:"BAIXA", UNRESOLVABLE:"NÃO RESOLVIDO" }[tierPt?.tier] ?? "—";
const desc = `Confiança: ${tierPtLabel} — Lat: ${post.lat}, Lon: ${post.lon}`;
// …<description>${escapeXml(desc)}</description>…
// before </Placemark>, emit <ExtendedData> with escaped <Data> values (Pattern 2)
```

### Status banner overall + hard-block + unresolved list (D-07/D-11/D-12)
```javascript
// Source: pattern over browser/main.js showWarnings/showStatus (code read, lines 644-661)
function showConfidenceBanner({ overall, hardBlockReason, unresolved }) {
  if (hardBlockReason) { /* red banner: Portuguese reason + nearest hint; NO KMZ */ }
  const PT = { high:"ALTA", med:"MÉDIA", low:"BAIXA", unresolvable:"NÃO RESOLVIDO" };
  // "Confiança geral: " + PT[overall]   — no % anywhere
  if (unresolved?.length) { /* "Postes não resolvidos: " + unresolved.join(", ") */ }
}
```

## State of the Art

| Old Approach (today) | Current Approach (Phase 9) | When Changed | Impact |
|----------------------|----------------------------|--------------|--------|
| Single `#postPoint` style, `Lat/Lon`-only description | 4 tier styles + tier balloon line + ExtendedData | This phase | Per-post risk legible in Google Earth |
| `omittedNoGps` silent drop in `buildKml` | Explicit flag: red marker if any coord, else listed by number | D-11 | Every declared post accounted for (fail-loud) |
| `gateDecision` only (route shape/anchor) | `dwgConfidence.overall` gate-gated worst-case | D-08 | Route-level tier the banner renders; can't mask a LOW post |
| Warnings only in scrollable `#warningsList` | Dedicated prominent status banner above it | D-07 | Overall + hard failure surfaced first |
| Hard failure path uncertain | Explicit block (no-region/unit) vs flag (matched-region) | D-12/D-13 | No KMZ with silently-wrong coords |

**Deprecated/outdated:** None — no library deprecations relevant. KML 2.2 (`http://www.opengis.net/kml/2.2`) is current and what the project already emits; `<ExtendedData>`/`<Data>` and `<Style>`/`<styleUrl>` are stable, long-standing KML constructs.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Tier hex values `#00c853`/`#ffd600`/`#ff8f00`/`#d50000` are reasonable traffic-light hues | Pattern 1 / Standard Stack | LOW — D-01 explicitly leaves exact hex to Claude's discretion; any green/yellow/orange/red works |
| A2 | `overallTier()` mapping (worst material tier when not "high") matches user intent for the MED-vs-low edge | Pattern 5 | MEDIUM — D-08 fixes the "high" condition exactly; the degraded mapping is interpretive. Planner/discuss should confirm the exact label for a route that's `fallback`+all-MED |
| A3 | Distinguishing hard no-region from matched-then-degraded via presence of `dwgNoRegion`/region-match (not `dwgStatus` string) | Pitfall 3 / D-13 | MEDIUM — this is the key disambiguation; if the calculator doesn't expose a clean "region matched" boolean, planner must add one. Verify against `successResult` vs `missResult` shapes |
| A4 | KML balloon CDATA not required (existing code uses `escapeXml`, keep consistent) | Pattern 3 | LOW — both render in Google Earth; escapeXml matches current behavior |
| A5 | `diverged-at-post` warning is produced somewhere in the solver/gate path with `at_post`+`residual_m` available | Pattern 4 / D-09 | MEDIUM — D-09 names it as a NEW kind; the data source (which post diverged) must come from gate per-post anchorGap or solver diagnostics. Planner must confirm the producing site has `at_post`/`residual_m` |

## Open Questions

1. **Where is the `diverged-at-post` data sourced?**
   - What we know: D-09 wants a `diverged-at-post` warning with `{ at_post, residual_m }`. The gate's `anchorGap.perPost[]` has `{ postNumber, gapM }` and `shapeFidelity.perEdge[]` has `residualM`.
   - What's unclear: Whether "diverged at post N" should be the worst-anchor-gap post, the first post crossing a threshold, or a solver-emitted demotion locus.
   - Recommendation: Planner defines it as the first/worst post where `anchorGap.perPost[].gapM` ≥ `ANCHOR_FALLBACK_M`, derived read-only from existing `anchorGap` — no new computation. Confirm wording with discuss-phase.

2. **Does `successResult` expose a clean "region matched" flag for the block-vs-flag decision?**
   - What we know: `missResult` carries `dwgNoRegion` and `dwgStatus:"pdf-fallback"`; `successResult` (matched then maybe degraded) also can carry `dwgStatus:"pdf-fallback"` via the cascade-fail branch (line 440-449).
   - What's unclear: The cascade-fail-after-match branch (line 441) sets `dwgStatus:"pdf-fallback"` but DOES set `dwgRegionId` and has NO `dwgNoRegion`. That's the disambiguator.
   - Recommendation: Block iff `dwgNoRegion` present OR `dwg-zone-mismatch`/DXF-02 fail; else flag. Planner should add an explicit `hardBlock: true/false` field to the result at the calculator to avoid UI-side string sniffing.

3. **Tier-color vs user-icon-color toggle (D-03)?**
   - What we know: Default is tier color wins; D-03 allows an optional toggle; Deferred Ideas marks the toggle as optional polish.
   - Recommendation: Ship tier-wins hard-coded first; defer the toggle (matches CONTEXT Deferred Ideas).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js (test runner `node --test`) | `npm run test:gate` green-bar | ✓ | project standard | — |
| esbuild (`npm run build`) | rebuild `browser/main.js` bundle after edits | ✓ | `^0.25.5` (devDep) | — |
| jszip | `packageKmz()` (unchanged) | ✓ | `^3.10.1` | — |

No new external tools, services, or runtimes are introduced. All four route fixtures + `coordenadas postes siriu.txt` (SC-1) are already in the repo (`parser/__tests__/fixtures/`, repo root).

## Validation Architecture

**SKIPPED** — `.planning/config.json` sets `workflow.nyquist_validation: false`. Per the protocol, the Validation Architecture section is omitted. (The phase still must keep `npm run test:gate` green and update `kml-builder.test.mjs` for D-11; that is captured under Pitfalls 1 & 5, not as a Nyquist sampling plan.)

## Security Domain

`security_enforcement` is **absent** from `.planning/config.json` (treated as enabled by protocol), but this phase has a minimal threat surface: it is a client-side, output-format/DOM-rendering change in a tool that processes user-supplied PDF/DXF files the user already owns. No authentication, no network input, no server, no credentials. The one relevant control is output-encoding integrity.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth in app (client-side only) |
| V3 Session Management | no | No sessions |
| V4 Access Control | no | No access tiers |
| V5 Input Validation / Output Encoding | yes | All new ExtendedData/balloon/banner text MUST pass through existing `escapeXml()` (KML/XML) and `textContent` (DOM, not `innerHTML`) — prevents XML/DOM injection from malformed region names or post data |
| V6 Cryptography | no | No crypto |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unescaped post/region/warning text injected into KML XML | Tampering | Reuse `escapeXml()` for every new `<Data>`/`<description>` value (already the file's pattern) |
| Unescaped text injected into DOM banner | Tampering | Use `el.textContent = …` (as existing `showWarnings` does, line 657) — never `innerHTML` with interpolated data |
| Numeric `%` leaking into user-facing output | (project anti-feature, not classic STRIDE) | CONF-04 lint: assert no `%` in banner/balloon/ExtendedData strings |

## Sources

### Primary (HIGH confidence)
- Direct code read (2026-06-09): `parser/kml-builder.js`, `parser/dwg/residual-gate.js`, `parser/dwg/coordinate-calculator-dwg.js`, `parser/kmz-defaults.js`, `parser/kmz-packager.js`, `parser/kml-color.js`, `browser/main.js` (lines 580-661, 770-929), `package.json`, `.planning/config.json`
- `.planning/phases/09-…/09-CONTEXT.md` — D-01..D-13, Claude's discretion, deferred
- `.planning/phases/08-…/08-CONTEXT.md` §D-12/D-13 — structured channel contract
- `.planning/phases/05-…` (referenced via residual-gate.js header comments) — tiers are labels, never %
- `.planning/REQUIREMENTS.md` §CONF-01..04
- `tools/run-residual-gate.mjs` + `residual-gate-baseline.json` (verified baseline snapshots `gateDecision` only)
- `parser/__tests__/residual-gate.test.mjs`, `kml-builder.test.mjs` (verified assertion shapes)
- KML 2.2 `<ExtendedData>`/`<Style>` — developers.google.com/kml/documentation (OGC KML 2.2 schema)

### Secondary (MEDIUM confidence)
- Google paddle icon hrefs (`mapfiles/kml/paddle/*-blank.png`) — standard Google Earth icon set [CITED]

### Tertiary (LOW confidence)
- None — all claims grounded in code or schema.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every target module read directly; zero new deps confirmed against `package.json`
- Architecture: HIGH — integration points traced through actual call sites (`successResult` → `lastCalcResult` → `buildKml`/banner)
- Pitfalls: HIGH — baseline/test shapes verified by inspection; block-vs-flag boundary traced to specific code branches (lines 297-331 miss path vs 440-449 cascade-fail path)
- Open questions: flagged honestly where the producing site of `diverged-at-post` and a clean `hardBlock` flag need a planner decision

**Research date:** 2026-06-09
**Valid until:** 2026-07-09 (stable — in-house code + stable KML schema; no fast-moving external dependency)
