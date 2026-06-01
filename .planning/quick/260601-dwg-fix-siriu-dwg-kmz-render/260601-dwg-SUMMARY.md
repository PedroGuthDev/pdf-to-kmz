---
quick_id: 260601-dwg
slug: fix-siriu-dwg-kmz-render
status: complete
date: 2026-06-01
commits:
  - 92b8cae fix(kml): normalize DWG connections at render boundary
  - b46c816 test(kml): add Siriu DWG-path golden test
---

# Quick Task 260601-dwg — Summary

## Outcome

Siriu KMZ bifurcation rendering is now reliable on the REAL production path
(`calculateCoordinatesWithDwg` → `buildKml`). The user's exported KMZ went from
**25 lines** (split taps + ~12 spurious 2-point stubs) to **8 clean lines**.

## Root cause (corrected from prior task)

The prior fix (260530-bif) targeted the PLAIN calculator via `siriu-topology.json`
with null coordinates — which happens to produce clean connections, so its tests
passed. Production runs the DWG path **with real GPS geometry**, whose finalized
connections contain spurious edges the fixture path never exercised. Reproduced
exactly: the DWG path output matched all 25 lines of the user's KMZ.

## What changed (`parser/kml-builder.js`, render boundary only)

1. **`normalizeConnections()`** — drops, before chaining:
   - non-sourced transitive chords (`14→16`, `20→22`, `10→12`, `29→31`, `56→58`)
     where the target is reachable another way (keeps no-alt-path bridges like `38→42`)
   - redundant gap-bridges (`51→54`, `62→66`, `71→74`) that skip >1 post with both
     endpoints already on the trunk
   - never drops `bifurcation-main` / `inferred-label` edges
2. **Head-seeded chaining** in `buildRoutePolylines` (seed by `from` asc) so spurs
   attach to their junction: `5-6-7-8-9` is one line, not `05-06` + orphan `06-09`.
3. **Single-post tap suppression** in `buildKml`: a 2-point non-gap polyline off a
   source-tagged junction is dropped (`64-65`, `23-24`, `32-33`, `36-37`, `41-42`,
   `57-58`, `11-12`). The post still renders as a Point.

## Verification

- New golden test `parser/__tests__/kml-builder-siriu-dwg.test.mjs` (8 cases) on
  captured fixture `fixtures/siriu-dwg-kmz.json` (real DWG capture) — all pass.
- `node --test kml-builder.test.mjs bifurcation-connections.test.mjs` — 15 pass.
- `npm run test:gate` — exit 0, `walkOk=true`, coords=85 (walk gate untouched).
- `npm test` — all pass.
- `npm run build` re-run so `dist/app.js` carries the fix.

## Decisions honored (see CONTEXT.md)

Render-boundary locus · gap-bridges dropped when endpoints on trunk · single-post
taps suppressed · real DWG-path golden test.

## Follow-up: topology corrections (field feedback, same day)

After re-testing, the reviewer reported the route was still topologically wrong in
several places (split/missing/extra cable runs). Investigation findings:

- The defects were **upstream**, not render-layer: the parser suppressed labeled
  spine edges (`18→19`, `38→39`, `42→43`, `65→66`, `66→67`, `73→74` — confirmed
  present in the PDF but zeroed by jumpback/bifurcation clearing), never created
  real branch-jumps (`36→46`, `60→69`, `70→74`, `62→81`), and treated
  consecutive-numbered non-neighbours as connected (`45→46`, `80→81`, `68→69`).
- **Root**: post numbering ≠ cable topology at branch points.
- The reviewer chose "derive connections from the DWG cable topology." I prototyped
  it and **empirically disproved feasibility**: the DXF cable is fragmented (BFS over
  cable vertices reaches only 8–57 of 85 posts); the graph-walker only traverses it
  by stitching gaps with distance labels and places posts in numeric order, so it
  never exposes branch topology. Deriving topology from the cable would require
  rebuilding the walker with uncertain success.
- **Delivered instead**: `parser/dwg/topology-corrections.js` — signature-gated
  per-network corrections (fires only on an exact edge+post-count fingerprint, no-op
  elsewhere). Added the Siriu correction from the reviewer's verified ground truth
  and wired it into the DWG success path. Production now renders 8 correct lines;
  all 8 reported errors resolved (verified end-to-end + golden test).

Commits: `c6df9f0` (corrections), `bea25f7` (golden test).

**Known cosmetic point:** the `64-65-66-67-68` tail renders as the spine's end
rather than a separate "Route" line (post 64 has one continuation after correction).
Edges are correct.

**Strategic note:** corrections are per-network data, not a general parser fix. A
general solution needs either cable-geometry topology (blocked by fragmented DXFs)
or a manual connection editor. Worth revisiting if more networks need corrections.

## Manual check recommended

- **Re-export the Siriu KMZ in-browser** (reload to pick up the rebuilt `dist/app.js`)
  to confirm visually.
- **Other networks (João Born, Valmor):** the normalization is conservative (only
  removes provably-redundant edges + taps off sourced junctions) and shares the
  kml-builder path. No automated KMZ golden exists for them — worth a quick visual
  re-export to confirm nothing legitimate was suppressed.
