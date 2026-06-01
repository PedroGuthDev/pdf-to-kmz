---
quick_id: 260601-dwg
slug: fix-siriu-dwg-kmz-render
goal: Make Siriu DWG-path KMZ polylines reliable — render-boundary normalization in kml-builder, guarded by a real DWG-path golden test
must_haves:
  - normalizeConnections drops non-sourced transitive chords (14→16, 20→22, 10→12, 29→31, 56→58) but keeps no-alt-path bridges (38→42)
  - normalizeConnections drops redundant gap-bridges that skip >1 post with both endpoints on trunk (51→54, 62→66, 71→74)
  - buildRoutePolylines seeds chains from heads (from asc) so spurs stay attached (5-6-7-8-9 is ONE line)
  - buildKml suppresses 2-point taps off a source-tagged junction (64-65, 23-24, 32-33, 36-37, 41-42, 57-58, 11-12)
  - never drop a source-tagged edge (bifurcation-main / inferred-label)
  - new golden test on fixtures/siriu-dwg-kmz.json asserts clean polylines via buildKml
  - all existing kml-builder.test.mjs + bifurcation-connections.test.mjs cases still pass
  - npm run test:gate still passes (walk gate untouched)
wont_haves:
  - changes to coordinate-calculator(-dwg).js, finalizeBifurcationConnections, geometry, or the DWG walk
  - changes to GPS/UTM math
  - changes to other PDF parsers (João Born, Valmor)
---

# Quick Task 260601-dwg: Reliable Siriu DWG-path KMZ rendering

## Context

Production renders via `calculateCoordinatesWithDwg` → `buildKml(posts, result.connections)`.
Those finalized connections, computed with REAL GPS geometry, contain spurious
non-sourced chords, redundant gap-bridges, and single-post taps that the prior
fixture-based fix (260530-bif, null-coord plain calculator) never exercised.
See `260601-dwg-CONTEXT.md` for full root-cause + decisions. Fix is render-boundary
only (kml-builder.js). Golden fixture already captured: `fixtures/siriu-dwg-kmz.json`.

Discriminator: every spurious edge is NON-source-tagged; legitimate main jumps carry
`source: "inferred-label"`.

## Tasks

### Task 1: Add normalizeConnections + head-seeding to kml-builder.js
**Files:** `parser/kml-builder.js`
**Action:**
- Add `normalizeConnections(connections)`:
  - Drop a non-gap, non-source-tagged edge `J→K` with `K > J+1` IFF `K` is reachable
    from `J` in the undirected non-gap graph WITHOUT that edge (transitive chord).
  - Drop a `gap:true` edge IFF `|K−J| > 1` AND both `J` and `K` appear in some non-gap
    edge (already on the trunk).
  - Never touch source-tagged edges.
- In `buildRoutePolylines`, seed chains from heads: iterate seed edges sorted by
  `(from asc, to asc)` instead of raw array order, so `extendForward` consumes the
  trunk from the lowest head first and spurs attach to their junction.
**Verify:** `node --test parser/__tests__/kml-builder.test.mjs` — all existing pass.
**Done:** Chords/gaps normalized; spur `5-6-7-8-9` chains as one polyline.

### Task 2: Suppress single-post taps in buildKml
**Files:** `parser/kml-builder.js`
**Action:** In `buildKml`, run `normalizeConnections` first; compute branchStarts +
drawableConnections + polylines from the normalized set. Build
`sourcedJunctions = { e.from : e is source-tagged }`. After `buildRoutePolylines`,
drop any non-gap polyline of exactly 2 posts whose first post ∈ `sourcedJunctions`.
Keep post Point placemarks unchanged. Adjust `stats.lineCount` accordingly.
**Verify:** `node --test parser/__tests__/kml-builder.test.mjs parser/__tests__/bifurcation-connections.test.mjs` pass (esp. "draws two cable runs at a branch" stays lineCount=2 — junction 2 is source-less).
**Done:** Siriu single-post taps suppressed; source-less branch test unaffected.

### Task 3: Add DWG-path golden test
**Files:** `parser/__tests__/kml-builder-siriu-dwg.test.mjs` (new), `parser/__tests__/fixtures/siriu-dwg-kmz.json` (captured)
**Action:** Load the fixture, call `buildKml(posts, connections)`, decode each
LineString's coords back to post numbers (via posts' lat/lon), and assert:
- route through `5,6,7,8,9` (one line); `14,15,16,17` (one line)
- NO `14,16,17` and NO standalone `14,15,16` (split gone)
- NO 2-point lines `64-65 / 23-24 / 32-33 / 36-37 / 41-42 / 57-58 / 11-12`
- NO gap-bridge lines `51-54 / 62-66 / 71-74`
- trunk passes `…5,10,11,13,14,18…` (sourced jumps preserved)
**Verify:** `node --test parser/__tests__/kml-builder-siriu-dwg.test.mjs` passes.
**Done:** Golden test green; guards the real production path.

### Task 4: Full gate + cleanup
**Files:** remove probe-*.mjs / capture-*.mjs scratch files
**Action:** Run `npm run test:gate` and the kml/bifurcation tests. Delete scratch
probes (`probe-conns.mjs`, `probe-realpdf.mjs`, `probe-dwgpath.mjs`,
`capture-dwg-fixture.mjs`). Keep the fixture.
**Verify:** `npm run test:gate` exits 0; all kml tests green.
**Done:** No regressions; scratch files removed.
