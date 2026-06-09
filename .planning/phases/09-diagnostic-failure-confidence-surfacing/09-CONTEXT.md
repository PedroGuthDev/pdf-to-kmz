# Phase 09: Diagnostic Failure & Confidence Surfacing - Context

**Gathered:** 2026-06-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the **already-computed** confidence and failure signals **visible** to the
user — a pure presentation/surfacing layer over Phase 5's per-post tiers and
Phase 8's D-13 structured channel. **No new coordinate math, no new tier
computation.**

**In scope (CONF-01..04 + ROADMAP SC-1..4):**
1. **KMZ tier encoding (CONF-02):** per-post placemark color by tier +
   `<ExtendedData>` diagnostics + a Portuguese tier line in the balloon
   `<description>`. Today `buildKml()` uses ONE shared `#postPoint` style and a
   `Lat/Lon`-only description — both are net-new work.
2. **Route-level confidence in UI (CONF-04 + SC-1):** a `dwgConfidence.overall`
   tier (net-new field) rendered in a dedicated UI status banner.
3. **Portuguese failure surfacing (CONF-01):** clear reasons for no-region /
   unit-mismatch / "diverged at post N, residual X m", consistent with and
   extending the existing `formatDwgWarning` taxonomy.
4. **Partial output + flagging (CONF-03):** emit resolvable posts (colored by
   tier); flag UNRESOLVABLE posts instead of silently omitting them; block KMZ
   only on hard failures.
5. **No-numeric-% guarantee (CONF-04):** tier LABELS only anywhere user-facing;
   raw residual METERS are allowed as diagnostics (they are not a % quality seal).

**Out of scope:** computing/altering tiers or coordinates (Phase 5 owns the gate;
Phase 8 owns the solver/walker coords — both stay byte-stable); multi-zone CRS
(MZONE-01); interactive map preview before download (ENH-01); cable-spec data in
KMZ (ENH-02).

</domain>

<decisions>
## Implementation Decisions

### Tier → KMZ color (CONF-02)
- **D-01:** **Traffic-light palette.** HIGH = green, MED = yellow, LOW = orange,
  UNRESOLVABLE = red. Implemented as 4 tier-keyed `<Style>` blocks; each placemark
  references the style for its tier (replaces the single shared `#postPoint`).
- **D-02:** **Route lines stay one uniform color.** Tier is a per-POST property;
  a line spans two posts of possibly different tiers, so per-segment recoloring is
  ambiguous and misleading. Keep the single `routeLine` style.
- **D-03:** **Tier color takes precedence over the user-customizable icon color**
  for tier surfacing. (Tension noted: the app exposes a customizable post-icon
  color; when tiers are surfaced, the tier hue wins. Planner may expose a toggle,
  but default = tier color governs the marker.)

### KMZ ExtendedData + balloon (CONF-02, CONF-04)
- **D-04:** **ExtendedData = tier + diagnostics.** Each placemark carries
  `<Data name="tier">`, `shape_residual_m`, `anchor_gap_m`, `source` (dwg/pdf),
  and `demotionReason` when present. Lets the user inspect WHY a post is MED/LOW
  inside Google Earth. **Meters are permitted** — they are diagnostics, not a
  forbidden numeric-% seal (CONF-04 forbids only percentages/quality-seal numbers).
- **D-05:** **Balloon `<description>` gains a Portuguese tier line** —
  e.g. `Confiança: ALTA — Lat: …, Lon: …`. Tier visible on click, not only via
  marker color / raw XML.
- **D-06 (enabling work):** `residual-gate.js applyResidualGate()` currently
  returns only `{ postNumber, tier }` per post. To populate per-post
  `shape_residual_m` / `anchor_gap_m` (D-04), the gate must **expose the per-post
  sub-scores it already computes internally** alongside the tier label. This is a
  surfacing change to the gate's return shape — NOT a change to how tiers are
  decided.

### Route-level confidence + UI surfacing (CONF-01, CONF-04, SC-1)
- **D-07:** **Dedicated status banner.** Overall tier and any hard-failure reason
  render in a prominent block at the top of the UI, separate from the existing
  scrollable `#warningsList`. Satisfies SC-1's "diagnostic panel shows
  `dwgConfidence.overall`".
- **D-08:** **`dwgConfidence.overall` = gate-gated worst-case** (net-new field).
  Overall is `"high"` ONLY if `gateDecision` trusts AND no post is LOW/UNRESOLVABLE;
  otherwise it degrades to the worst material tier. Matches fail-loud and SC-1
  (Siriu + correct DXF → `"high"`).
- **D-09:** **Failure reasons stay in the existing Portuguese taxonomy.** Extend
  `formatDwgWarning` (structured `{ kind, … }` objects → Portuguese strings) with
  any new Phase-9 kinds (e.g. a `diverged-at-post` reason carrying `at_post` +
  `residual_m`). Do not invent a parallel string taxonomy. CONF-01's three named
  cases map as: no-region → `dwg-region-miss` (+ nearest hint/distance);
  unit mismatch → `dwg-zone-mismatch` / DXF-02 fail-loud; "diverged at post N" →
  new structured kind.

### Partial output + flagging (CONF-03)
- **D-10:** **Gate-fail with coords present → emit a FLAGGED KMZ.** When the DXF
  resolved and coordinates exist but the overall gate fails (e.g. LC ~179 m
  offset), still produce the KMZ with every post colored by its own tier; the
  banner shows the route is degraded/LOW so the user decides. Fail loud, do not
  withhold usable data.
- **D-11:** **UNRESOLVABLE flagging — red marker if any coord, else list.** An
  UNRESOLVABLE post with ANY fallback coordinate (e.g. PDF) gets a RED marker; a
  post with no coordinate at all is listed by number in the status banner
  (`Postes não resolvidos: …`). Replaces today's silent `omittedNoGps` drop in
  `buildKml` — every declared post is accounted for, on the map or in text.
- **D-12:** **Hard failures BLOCK the KMZ.** True **no-region** (no DXF covers
  post-1 GPS) and **unit-mismatch / out-of-envelope** failures emit NO KMZ; the
  banner shows the Portuguese reason plus the nearest-region hint + distance.
  PDF-only is **not** auto-emitted on these hard failures (SC-2: no KMZ with
  silently-wrong coords).
- **D-13:** **Failure boundary — block vs flag.** Hard-block is reserved for
  no-region and unit/envelope failures (D-12). Any case where a **DXF region
  matched** — including degradation to PDF-fallback after a found region — emits a
  flagged KMZ (D-10) with the strongest applicable "precisão limitada" warning,
  never a hard block. (This boundary is the key disambiguation for the planner.)

### Claude's Discretion
- Exact KML `aabbggrr` hex values for the four tier colors (D-01) and whether to
  reuse Google's standard pushpin palette vs custom icons.
- Exact `<ExtendedData>` `name` keys/casing and whether to also emit a
  machine-readable route summary placemark/folder.
- Exact Portuguese wording of new banner strings and the `diverged-at-post`
  message (D-09), kept consistent with existing `formatDwgWarning` phrasing.
- Whether the tier-color-vs-user-icon-color precedence (D-03) is exposed as a UI
  toggle or hard-coded.
- Whether the banner is a new DOM element or a restyled region of the existing
  results area (UI-phase / planner call).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` §CONF-01..04 — failure-reason surfacing, KMZ tier
  via color+ExtendedData, partial-emit-and-flag, tier-labels-only (no numeric %).
- `.planning/ROADMAP.md` §"Phase 9: Diagnostic Failure & Confidence Surfacing" —
  goal + SC-1..4 (Siriu HIGH; no-region Portuguese hint + no silent KMZ; partial
  emission with tier colors; zero numeric % anywhere).

### Upstream phase contracts (the signals this phase surfaces)
- `.planning/phases/05-truth-free-residual-gate/05-CONTEXT.md` — the residual gate
  as pure judge; HIGH/MED/LOW/UNRESOLVABLE tier bands; **tiers are labels only,
  never numeric %** (CONF-04 origin).
- `.planning/phases/08-global-pdf-dxf-solver/08-CONTEXT.md` §D-13 — the structured
  channel Phase 9 reads: `solverPath`, `solverDemoted`, `demotionReason`,
  `solverScore`, `warnings[]`/`userWarnings`. (D-12 of Phase 8 explicitly defers
  partial-emission + KMZ/UI tier surfacing to this phase.)

### v1.1 research (design + pitfalls)
- `.planning/research/ARCHITECTURE.md` §"P8: Confidence" — **NOTE the old
  numbering**: ARCHITECTURE's "P8 confidence" component = this Phase 9. Confidence
  surfacing synthesizes residual-gate tiers + solver scores.
- `.planning/research/PITFALLS.md` §Pitfall 1 (confident-but-wrong) — the reason
  the overall tier is gate-gated worst-case (D-08) and hard failures block (D-12).

### Code to extend (NOT rewrite)
- `parser/kml-builder.js` — `buildKml()` (single `#postPoint` style, `Lat/Lon`
  description, silent `omittedNoGps` drop). Add tier styles (D-01), per-post tier
  color, `<ExtendedData>` (D-04), balloon tier line (D-05), unresolvable flagging
  (D-11). `buildRoutePolylines()` line styling stays uniform (D-02).
- `parser/dwg/residual-gate.js` — `applyResidualGate()` returns
  `{ gateDecision, shapeFidelity, anchorGap, postTiers }`; extend to expose
  per-post sub-scores (D-06) and add the `overall` tier (D-08).
- `parser/dwg/coordinate-calculator-dwg.js` — `successResult` already carries
  `dwgConfidence`, `solverPath/solverDemoted/demotionReason/solverScore`,
  `warnings[]`, `userWarnings`, and the `{ code:"NO_REGION", nearest }` failure
  shape (~line 35) with `nearest_dwg_distance_m`. Wire `overall`, hard-block
  signalling (D-12/D-13), and the new `diverged-at-post` warning kind.
- `browser/main.js` — `showWarnings()`/`showParseNotices()`/`#warningsList`/
  `#warnings`; `buildCalcUserWarnings()` + `formatDwgWarning()` Portuguese
  taxonomy. Add the status banner (D-07), render `overall` + hard-failure block,
  and the unresolvable-post list (D-11).
- `parser/kmz-defaults.js` / `parser/kmz-packager.js` — `mergeOptions` /
  `resolveStyleColors` (icon/label/line colors) and KMZ zip packaging; tier styles
  must coexist with user style options (D-03).

### Ground truth (surfacing must not regress accuracy)
- `coordenadas postes siriu.txt` (85 posts) — SC-1 fixture: Siriu + correct DXF
  must surface every post HIGH and `dwgConfidence.overall = "high"`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`applyResidualGate()`** (`parser/dwg/residual-gate.js`) — already produces
  `postTiers` (HIGH/MED/LOW/UNRESOLVABLE) and `gateDecision`. Phase 9 consumes
  these; the only gate change is exposing per-post sub-scores + an `overall` field.
- **`successResult.dwgConfidence`** (`coordinate-calculator-dwg.js` ~line 497) —
  the attach point; `overall` lands here (D-08).
- **`formatDwgWarning()` / `buildCalcUserWarnings()`** (`coordinate-calculator-dwg.js`
  ~line 45/80) — a rich Portuguese warning taxonomy already exists
  (`dwg-region-miss`, `dwg-zone-mismatch`, `dwg-pair-fail`, `dwg-graph-walk-fail`,
  …). Extend it (D-09) rather than starting over.
- **`buildKml()` stats** (`parser/kml-builder.js`) — already tracks
  `omittedNoGps` / `skippedLines` / `warnings[]`; repurpose `omittedNoGps` into
  explicit UNRESOLVABLE flagging (D-11) instead of a silent drop.
- **`{ code:"NO_REGION", nearest:{ name, distanceKm } }`** failure shape — already
  computes the nearest-region hint + distance for D-12's blocked-failure message.

### Established Patterns
- **Fail loud, never silently-wrong** — project-wide; drives D-11 (flag, don't
  omit) and D-12 (block hard failures).
- **Tiers are labels, never numeric %** (Phase 5) — drives CONF-04; meters are
  diagnostics, not seals (D-04).
- **Structured warning objects → Portuguese formatter** — the `{ kind, … }` →
  `formatDwgWarning` pattern is the template for new Phase-9 messages (D-09).
- **Pure-judge / additive** — Phase 9 must not mutate coords or tier decisions;
  Siriu/LC/JB/Valmor accuracy gates stay green (surfacing is read-only over coords).

### Integration Points
- `residual-gate.js applyResidualGate()` return shape → `+ overall`, `+ per-post
  sub-scores`.
- `coordinate-calculator-dwg.js successResult` → hard-block signal + `diverged-at-post`
  warning kind + `dwgConfidence.overall`.
- `kml-builder.js buildKml()` → tier styles, per-post color, ExtendedData, balloon
  tier line, unresolvable flagging.
- `browser/main.js` → status banner DOM + overall/hard-failure rendering +
  unresolved-post list.

</code_context>

<specifics>
## Specific Ideas

- **Traffic-light is the locked mental model** for tiers (green→red), chosen for
  immediate risk legibility; UNRESOLVABLE is red (alarming), not grey.
- **Meters are explicitly allowed in ExtendedData** — the user distinguished raw
  diagnostic meters (OK) from a numeric-% "quality seal" (forbidden). Keep the
  surfacing free of any `%` value, including in the banner and balloon.
- **The block-vs-flag boundary (D-12/D-13) is the decision the planner most needs
  to honor exactly:** no-region & unit-mismatch BLOCK; any matched-region outcome
  (even degraded to PDF-fallback) FLAGS and still emits.
- SC-1 Siriu test is the green-bar anchor: correct DXF ⇒ all posts HIGH ⇒
  `dwgConfidence.overall = "high"`, no `%` rendered anywhere.

</specifics>

<deferred>
## Deferred Ideas

- **Interactive map preview with tier colors before download** → ENH-01 backlog.
- **Cable-specification data in KMZ placemarks** → ENH-02 backlog.
- **A UI toggle for tier-color vs user-custom-icon-color precedence (D-03)** →
  optional polish; default behavior (tier wins) ships first.
- **Multi-zone CRS surfacing** → MZONE-01 backlog (out of v1.1).

None — discussion stayed within the Phase-9 surfacing domain.

</deferred>

---

*Phase: 09-diagnostic-failure-confidence-surfacing*
*Context gathered: 2026-06-09*
