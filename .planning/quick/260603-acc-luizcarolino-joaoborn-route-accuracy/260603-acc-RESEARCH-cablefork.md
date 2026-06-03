# 260603-acc — Cable-Fork Signal Research (PROVE OR KILL)

**Researched:** 2026-06-03
**Domain:** PDF-path junction detection — can the PDF's own cable geometry distinguish a genuine bifurcation from a false one?
**Method:** Live `parsePdf` on the main working tree (LC / Siriu / João Born), three throwaway probes, empirical separation table. Probes deleted (uncommitted) per task constraints.

---

## VERDICT

**THE SIGNAL DOES NOT SEPARATE AT ALL. The hypothesis is KILLED.** `[VERIFIED: live]`

A cable-fork signal derived from the PDF's own cable geometry (`parsed.cablePaths` / `cablesByPage`) **cannot distinguish genuine from false bifurcations**, because the cable geometry **does not co-locate with the numbered route posts at all**. Two independent, structural facts kill it:

1. **Posts are drawn ~30 pt OFF the cable centerline** (bimodal: a post is either ~6–9 pt on-cable or ~30 pt off it; the ~30 pt case dominates). At a junction post the local cable geometry simply has no vertices to measure a fork from.
2. **Drawn cable branch-points do NOT land at route junctions.** Across all three routes, the count of genuine GT junctions that have *any* drawn cable fork within 20 pt is **ZERO (TP=0)**. Siriu has 20 drawn branch-points — none near its 7 genuine junctions. João Born has **zero** branch-points in its entire cable geometry, yet has a genuine junction at post 13. The forks that do exist are rendering artifacts / off-route equipment taps at unrelated locations.

This is the **PDF analog failing exactly where the DWG analog succeeds**: the DWG region-degree signal works because DWG regions are topologically connected at the junction. The PDF "Cabo Projetado" vector paths are *cartographic strokes*, not a connected graph — they are fragmented, offset from posts, and forked at draw-convenience points, not at electrical junctions. The GATED-PARTIAL note at `parser/distance-associator.js:1789-1802` correctly anticipated that "a route-independent JUNCTION signal (DWG region degree / cable-arm bifurcation geometry)" is the prerequisite — **this research proves the *PDF* cable geometry cannot supply that signal.** The unlock must come from DWG region geometry, not from the PDF cable paths.

---

## THE SEPARATION TABLE (decisive deliverable)

Ground truth used (authoritative): genuine Siriu junctions are **5, 14, 36, 48, 60, 62, 70** (`parser/__tests__/fixtures/siriu-junction-ground-truth.json:3`, `_authoritative`). JB genuine sheet-break bifurcation = post 13. LC genuine mid-street taps = 6, 7, 22, 23; LC false-bifurcation victims = 2, 3, 4, 10, 11, 12.

> NOTE on the task brief's Siriu list (11, 23, 32, 36, 48, 57, 65): those are NOT label-degree junctions. **11/23/32/57 are the consecutive triples the *sheet-break detector* fires on** (`junction/tap/main` = N/N+1/N+2), confirmed live below — a different object from the authoritative degree-≥3 junctions. I tested against the authoritative fixture, which is the correct ground truth. `[VERIFIED: live]`

### Signal value per post (best-shot "snap-to-cable then count fork rays" + "nearest drawn branch-point")

| post | route | snapD (pt) | forkDirs (snap) | nearest drawn BP (pt) | ground truth | separated? |
|------|-------|-----------|-----------------|-----------------------|--------------|-----------|
| 5 | siriu | 8.7 | 0 | 324 | GENUINE junction | **NO (miss)** |
| 14 | siriu | 32.8 | 0 | 115 | GENUINE junction | **NO (miss)** |
| 36 | siriu | 41.4 | 2 | 41 | GENUINE junction | partial-only-this-one |
| 48 | siriu | 29.5 | 0 | 247 | GENUINE junction | **NO (miss)** |
| 60 | siriu | 29.4 | 1 | 31 | GENUINE junction | **NO (miss)** |
| 62 | siriu | 33.0 | 0 | 171 | GENUINE junction | **NO (miss)** |
| 70 | siriu | 31.5 | 0 | 103 | GENUINE junction | **NO (miss)** |
| 71 | siriu | 7.9 | — | **7.9** | (not a junction) | **FALSE fork hit** |
| 13 | jb | 31.7 | 0 | none | GENUINE bifurcation | **NO (miss)** |
| 3 | jb | 30.9 | 0 | none | FALSE | ok-but-vacuous |
| 4–6,14,15 | jb | ~30/6 | 0 | none | FALSE | ok-but-vacuous |
| 2 | lc | 56.9 | 1 | none | FALSE | inverted |
| 3 | lc | 7.8 | 1 | none | FALSE | inverted |
| 4 | lc | 52.5 | 0 | 254 | FALSE | ok |
| 6 | lc | 34.1 | 0 | 113 | GENUINE tap | **NO (miss)** |
| 7 | lc | 31.0 | 0 | 108 | GENUINE tap | **NO (miss)** |
| 10 | lc | 7.8 | 1 | 84 | FALSE | inverted |
| 11 | lc | 7.8 | 1 | 84 | FALSE | inverted |
| 12 | lc | 32.6 | 0 | none | FALSE | ok |
| 22 | lc | 7.8 | 1 | 84 | GENUINE tap | weak/ambiguous |
| 23 | lc | 32.7 | 0 | 204 | GENUINE tap | **NO (miss)** |

### Confusion matrix (genuine ⇒ should fork; false ⇒ should not)

Using the strongest test (drawn cable branch-point within 20 pt = "fork"):

| Route | TP | FN | FP | TN | Genuine-detect rate |
|-------|----|----|----|----|---------------------|
| Siriu | **0** | 7 | 0 | 0 | **0/7** |
| João Born | **0** | 1 | 0 | 6 | **0/1** |
| Luiz Carolino | **0** | 4 | 0 | 6 | **0/4** |
| **TOTAL** | **0** | **12** | 0 | 12 | **0/12** |

**There is no threshold that recovers the genuine junctions, because the signal is 0 for all of them.** A threshold of "fork ≥ 1" produces 12 false negatives and additionally mislabels non-junctions (Siriu post 71; LC false posts 10/11). The signal is not merely weak — for LC it is **inverted** (false-bifurcation posts 2/3/10/11 show MORE fork than the genuine taps 6/7/23), so it would actively make Task A worse.

**Critical test result:** the task asked whether cable-fork separates the Siriu genuine junctions from the LC false ones where label features could not. **It does not.** Both classes sit at fork≈0; the few non-zero hits are at non-junction posts. `[VERIFIED: live]`

---

## Computation method (so the kill is reproducible / auditable)

Three probe definitions were tried, each strictly stronger than the last; all failed.

**Data source.** `parsePdf(...)` returns `cablePaths: allCablePaths` — an array of `{ ops, pageNum }` (`parser/pdf-parser.js:839`, `:437-441`). Each `ops` is a `PathOp[]` (`M/L/C/C2/Z`). Posts come back as `{ number, x, y, pageNum }`. I flattened every cable path into a dense polyline (Bézier `C`/`C2` sampled at 8/6 steps — same sampling math as `nearestPointOnPathOps`, `parser/cable-builder.js:48-135`) and bucketed polylines by page (mirrors `buildCablesByPage`, `parser/cable-builder.js:254-263`).

**Signal v1 — fork rays around the post.** For each post, collect cable vertices in the ring `[0.30R, R]` (R=26 pt) around the post, compute each vertex's bearing-from-post, greedily cluster bearings into rays merging within 32°, count distinct rays = `forkDirs`. A through-line ⇒ 2 opposite rays; a fork ⇒ ≥3. **Result:** genuine Siriu junctions returned forkDirs 0/0/0/0/0/0/0 (post 36 the lone exception via a stray vertex). Most posts returned 0 because `nearestCableHitOnPage`-equivalent distance was ~30 pt > R — **the cable never reaches the post**.

**Signal v2 — snap-then-fork (best shot).** Snap each post to its nearest cable vertex on-page, then count fork rays in a ring `[5, 24]` pt around the SNAP point (removes the post-offset confound). Reused the same ray-clustering. **Result:** genuine Siriu junctions = forkDirs `5:0, 14:0, 36:2, 48:0, 60:1, 62:0, 70:0`. JB post 13 = 0. LC genuine taps `6:0,7:0,23:0` but LC false posts `2:1,3:1,10:1,11:1` — **inverted**. (See table above.) `snapD` is bimodal: ~7 pt (on-cable) or ~30 pt (off-cable); the off-cable case has no fork to find because the local centerline is a single stroke.

**Signal v3 — actual drawn branch-points (strongest topological form).** Compute genuine cable T/Y forks: for every cable polyline endpoint, count how many *other* polylines have a vertex within 8 pt of it; if ≥1, it is a drawn branch-point. Then measure the distance from each post to the nearest branch-point. This is the literal PDF analog of `detectBranches` (`parser/cable-builder.js:744-764`, shared-endpoint within threshold) and of DWG region adjacency. **Result (the confusion matrix above): TP = 0 across all 12 genuine junctions on all 3 routes.** Siriu's 20 drawn branch-points are 31–324 pt from the genuine junctions; JB has **zero** branch-points entirely; LC's 6 are 84–254 pt from the genuine taps.

**Why it structurally fails (root cause, [VERIFIED: live]):**
- The "Cabo Projetado" vector strokes are **cartographic, not topological**. They are drawn as offset guide-lines parallel to the pole row (~30 pt offset), fragmented per page (LC: 8 paths over 4 route pages; Siriu: 26 paths; JB: 4 paths), and their endpoints meet at draw-convenience/page-edge points — not at the electrical junction poles.
- This is precisely why the existing DWG path uses **region degree** (`parser/dwg/cable-topology.js:245`), not PDF cable strokes: DWG regions are a connected planar graph; PDF cable strokes are not. The signal that works in DWG has **no faithful PDF counterpart in the cable layer**.

---

## Detector firings observed live (corroborates which posts each detector touches)

From `parsed.warnings` on the live runs `[VERIFIED: live]`:

**Siriu** — branch-A block (`~L1539`) fires at posts 23, 36, 37, 41, 64, 65; sheet-break block (`~L1773`) fires at the consecutive triples **J=11, 23, 32, 57** (these are the task-brief "Siriu junctions" — they are detector triples, not degree-≥3 junctions). The genuine degree-≥3 junctions 5/14/48/60/62/70 are handled by the *rehome* path, not these two blocks.

**João Born** — sheet-break block fires once, correctly, at post 13 (`10.9→13→14, 38.9→13→15`).

**Luiz Carolino** — only `Bifurcation at post 2 (cleared 3→4)` and `Bifurcation at post 10 (cleared 11→12)` — the two FALSE positives. (These come from the branch-A `tapMain?.meters` block; per the GATED note, fixing branch-A merely unmasks the sheet-break block, which re-nulls the same steps.)

This confirms the executor's GATED finding: the LC false positives at 2/10 and the Siriu genuine triples at 11/23/32/57 are produced by the SAME two consecutive-triple detectors, and **no per-post cable-fork signal exists to gate them**, because the fork signal is 0 for both classes.

---

## Step 3 — Injection sketch — NOT APPLICABLE

Step 3 was conditional on Step 2 separating cleanly. **It does not, so no injection is proposed.** Wiring a fork gate into the branch-A (`distance-associator.js:1539`) or sheet-break (`:1803`) blocks would, with TP=0, reject *every* genuine Siriu/JB bifurcation (regressing the tight Siriu canary and JB), while for LC it would (inverted signal) preferentially keep the false ones. This is strictly worse than the current GATED-kept state. Do not pursue a PDF-cable-fork gate.

---

## Step 4 — Offset cross-check (H2) — unchanged, untestable via this signal

The cable-fork fix does not exist, so it cannot be used to test whether unblocking `3→4`/`6→7`/`11→12` corrects the label-LSQ page-origin fit. H2 (offset is downstream of the deformation) remains the live hypothesis from the original RESEARCH Q3, and the correct way to test it is unchanged: land a deformation fix by *some other* mechanism, then re-measure the offset. This research neither supports nor refutes H2 — it only removes one candidate mechanism (PDF cable-fork) for the deformation fix.

---

## What this means for the planner (decisive guidance)

1. **Do not plan any fix that derives junction/bifurcation truth from PDF `cablePaths` / `cablesByPage` geometry.** Proven dead end (TP=0/12). The cable layer is cartographic, not topological, in these PDFs.
2. **The real prerequisite is confirmed to be DWG region geometry**, exactly as the GATED note (`distance-associator.js:1799`) and the `k1a`/`label-misassociation` memory entries state. The open architectural question is unchanged: **how to bring DWG region-degree junction detection (`parser/dwg/cable-topology.js:245`, `isTopologyJunctionCandidate` `distance-associator.js:2554`) to bear on the PDF path** — which the original RESEARCH flagged as the RISK-2 trip (DWG-only + region posts carry no post numbers, resolved by GPS proximity the PDF path lacks). That cross-walk, not a PDF cable signal, is where effort should go.
3. **The LC false bifurcations at posts 2/10 should be attacked with the geometric/structural features that already differ** (the original RESEARCH Q2/Q4 path: tame the consecutive-triple acceptance gates) — but the executor's GATED note shows label/value features overlap with Siriu genuine. Since cable-fork is now also dead, the only remaining route-independent discriminator is **DWG-region junction degree mapped onto the PDF posts**. The planner should treat "PDF→DWG region junction cross-walk" as the central unlock and scope it explicitly (it is the same unlock pending in the 260602 memory).
4. **LC posts 6–7 / 22–23 mid-street taps:** also invisible to cable-fork (nearest BP 84–204 pt). No PDF-geometry path detects them; same DWG-region dependency.

---

## Assumptions / Confidence Log

| # | Claim | Basis | Confidence |
|---|-------|-------|-----------|
| 1 | Cable-fork signal = 0 at all 12 genuine junctions across 3 routes | Three independent probes, live `parsePdf`, confusion matrix TP=0 | **HIGH [VERIFIED: live]** |
| 2 | Posts sit ~30 pt off the cable centerline (bimodal with ~7 pt on-cable) | `snapD`/`nearCbl` columns, all 3 routes | **HIGH [VERIFIED: live]** |
| 3 | Drawn cable branch-points exist but are 31–324 pt from genuine junctions (JB: zero exist) | branch-point probe, TOL=8/threshold-20 pt | **HIGH [VERIFIED: live]** |
| 4 | Authoritative Siriu junctions are 5,14,36,48,60,62,70 (NOT the brief's 11/23/32/57…) | `siriu-junction-ground-truth.json:3` + live detector-firing trace | **HIGH [VERIFIED]** |
| 5 | The task-brief Siriu list (11,23,32,57) = sheet-break detector triples, not degree-≥3 junctions | live warning capture | **HIGH [VERIFIED: live]** |
| 6 | Result is robust to threshold/radius choice (tried R=26 ring, snap+ring, branch-point @8/20 pt) | three parameterizations, same TP=0 outcome | **HIGH** — signal absent, not mis-tuned |
| 7 | The signal is *inverted* for LC (false posts fork more than genuine) | LC rows 2/3/10/11 forkDirs=1 vs 6/7/23 forkDirs=0 | **MEDIUM-HIGH [INFERRED from live]** — small-N but consistent |

**What I did NOT do (honest gaps):** I did not test exotic fork definitions (e.g. cable-tangent-curvature spikes, or fusing the `posteGfx` symbol layer with cable strokes). Given the *structural* root cause — cable strokes are offset from and unconnected to posts — no reformulation of a *cable-only* fork signal can recover TP, so further parameter search is not warranted. If a future idea uses a *different PDF layer* (e.g. `Travessia` / `Articulação` / `posteGfx` connectivity) that is a genuinely different hypothesis, not a tuning of this one.

## Sources

- Live `parsePdf` on `INFOVIAS_AAF…LUIZ CAROLINO…v1.pdf`, `…Praia do Siriu_v01.pdf`, `…JOAO BORN_v04.pdf` (main tree).
- Throwaway probes (created, run, deleted uncommitted): `debug-cablefork-probe.mjs` (ring fork), `debug-cablefork-snap.mjs` (snap+ring fork), `debug-cablefork-branchpts.mjs` (drawn branch-points + confusion matrix).
- `parser/cable-builder.js:48-135` (`nearestPointOnPathOps` sampling), `:170-178` (`nearestCableHitOnPage`), `:254-263` (`buildCablesByPage`), `:472-514` (`cableExitBearingAtPost`/`cableSegmentBearingDeg`), `:744-764` (`detectBranches` — the shared-endpoint analog I reused).
- `parser/pdf-parser.js:437-441,826-841` (cablePaths returned), `:765-766` (cablesByPage prefill).
- `parser/distance-associator.js:1530-1608` (branch-A block), `:1773-1859` (sheet-break block), `:1789-1802` (GATED-PARTIAL note — confirmed correct), `:2554` (`isTopologyJunctionCandidate`, DWG-only).
- `parser/dwg/cable-topology.js:245` (`buildCableTopologyMaps`, the region-degree signal that DOES work — DWG only).
- `parser/__tests__/fixtures/siriu-junction-ground-truth.json` (authoritative junction list).
