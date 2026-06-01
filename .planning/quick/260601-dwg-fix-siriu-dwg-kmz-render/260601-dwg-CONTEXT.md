# Quick Task 260601-dwg: Reliable Siriu bifurcation rendering (DWG path) - Context

**Gathered:** 2026-06-01
**Status:** Ready for planning
**Supersedes:** 260530-bif (fixed the PLAIN calculator / fixture path; production uses the DWG path and stayed broken)

<domain>
## Task Boundary

Make KMZ cable-route polylines reliable at Siriu bifurcations. The user's exported
KMZ (`INFOVIAS_PJC INTERNET_Garopaba_Praia do Siriu_v01(5).kmz`, built today) still
shows: many spurious 2-point `Poste X → Poste Y` lines, and split/parallel routes
(`Route 14–17` = 14-16-17 alongside `Route 14–16` = 14-15-16 instead of one
14-15-16-17 tap).

Scope: rendering correctness only (kml-builder). NOT changing GPS/UTM math, the DWG
graph walk, or the upstream connection geometry.
</domain>

<findings>
## Root-cause findings (verified by reproduction, not inference)

1. **Production uses the DWG path.** `browser/main.js` calls
   `calculateCoordinatesWithDwg` → feeds `result.connections` to `buildKml`.
   `successResult = { ...pdfResult }` returns `pdfResult.connections` (the FINALIZED,
   source-tagged set) — `walkConnections` is internal to the pairing cascade only.

2. **The prior fix (260530-bif) targeted the wrong path.** It validated against
   `siriu-topology.json` via the PLAIN `calculateCoordinates` with null coords. With
   null coords the finalized connections happen to be clean (junction 14 → 14-15-16-17
   correct), so its tests passed. Production runs the DWG path WITH real GPS geometry,
   which produces a different, messier connection set.

3. **Exact reproduction achieved.** Running the real PDF through
   `calculateCoordinatesWithDwg` + `siriu.dxf` reproduces ALL 25 lines of the user's
   KMZ line-for-line (`probe-dwgpath.mjs`). dwgStatus = `dwg-graph-walk`.

4. **Defect set (DWG finalized connections, real geometry):**
   | Class | Spurious edges | Why wrong |
   |---|---|---|
   | Transitive chords (non-sourced) | `14→16`, `20→22`, `10→12`, `29→31`, `56→58`, `38→42` | Skip over an existing consecutive chain (`14→15→16`), splitting the tap into two tangled polylines |
   | Gap bridges | `51→54`, `62→66`, `71→74` (gap=true) | Bridge posts already on the trunk (`51-52-53`, `54-55-56`) — pure 2-point noise |
   | Single-post taps | `23→24`, `32→33`, `36→37`, `41→42`, `57→58`, `64→65`, `11→12` | Real but unwanted |
   | Spur split by array order | `5→6` + `6→7→8→9` | `6→7` chained before `5→6`, so the spur detaches from its junction → `05-06` 2-pt + orphan `06-09` |

5. **Clean discriminator:** every spurious edge is NON-`source`-tagged. The legitimate
   main jumps (`5→10`, `11→13`, `14→18`, `23→25`, `32→34`, `36→38`, `41→43`, `48→54`,
   `57→59`, `64→66`) all carry `source: "inferred-label"`. Source-tagged edges are
   authoritative and must never be dropped.
</findings>

<decisions>
## Implementation Decisions (locked)

### Fix locus
- Normalize connections at the RENDER boundary (kml-builder), before chaining. Do NOT
  touch `finalizeBifurcationConnections` / geometry / the DWG walk. Zero risk to the
  siriu-walk-regression gate and the other networks (João Born, Valmor).

### Transitive chords
- Drop a non-gap, non-source-tagged edge `J→K` (K > J+1) when an alternative non-gap
  path `J ⇝ K` already exists. Kills the split-causers (14→16, 20→22, 10→12, 29→31,
  56→58, 38→42 where the chain exists).

### Gap bridges
- Always drop a gap edge when BOTH endpoints are already members of non-gap edges
  (i.e. already on the trunk). Removes 51→54, 62→66, 71→74. (User: "always drop when
  endpoints on trunk.")

### Single-post taps
- Suppress 2-point non-gap polylines whose first post is a junction (tap off the
  trunk). Removes 64-65, 23-24, 32-33, 36-37, 41-42, 57-58, 11-12. The post itself
  still renders as a Point placemark; only the stub LINE is dropped.

### Spur attachment (chaining)
- Seed polyline chains from HEADS (posts that are not the `to` of any unused non-gap
  edge) first, so multi-post spurs stay attached to their junction
  (`5-6-7-8-9`, one line) instead of detaching by array order.

### Source-tag safety
- Never drop or re-route a `source: "bifurcation-main" | "inferred-label"` edge. These
  define the true trunk.

### Test guard
- Add a real DWG-path golden test. Captured fixture `parser/__tests__/fixtures/
  siriu-dwg-kmz.json` (85 posts w/ real GPS + 89 finalized DWG connections,
  dwgStatus=dwg-graph-walk) feeds `buildKml`; assert the cleaned polylines. Guards the
  ACTUAL production rendering path so this cannot silently regress again.
</decisions>

<specifics>
## Expected clean output (target, junctions of interest)

- Trunk seg: `1-2-3-4-5-10-11-13-14-18` (sourced jumps 5→10, 11→13, 14→18)
- Spur off 5: `5-6-7-8-9` (ONE line, attached)
- Spur off 14: `14-15-16-17` (ONE line, no split, no 14→16)
- Junction 64: trunk →66 (sourced), tap `64→65` suppressed (single-post)
- No `Poste X → Poste Y` 2-point noise lines; no gap-bridge stubs.

Existing `kml-builder.test.mjs` and `bifurcation-connections.test.mjs` must stay green
(or be updated intentionally with justification). João Born / Valmor outputs unchanged.
</specifics>

<canonical_refs>
## Canonical References

- Reproduction harness: `probe-dwgpath.mjs` (delete before commit or keep under tools/)
- Fixture capture: `capture-dwg-fixture.mjs`
- Golden fixture: `parser/__tests__/fixtures/siriu-dwg-kmz.json`
- Prior task: `.planning/quick/260530-bif-fix-siriu-kmz-bifurcations/`
</canonical_refs>
