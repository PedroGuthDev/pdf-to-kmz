# Pitfalls Research

**Domain:** Georeferenced asset pairing — global graph matching, truth-free confidence metrics, DXF coordinate-system handling, GPS region lookup (browser, fiber-infrastructure INFOVIAS PDF→KMZ converter)
**Researched:** 2026-06-05
**Confidence:** HIGH — all pitfalls are grounded in directly observed failure modes from this codebase (260603-n4k, 260603-jk7, 260603-acc, 260602-decouple, 260601-k1a, 260601-dwg) plus domain-verified references.

---

## Critical Pitfalls

### Pitfall 1: "Confident But Wrong" — Internally-Consistent Self-Scoring

**What goes wrong:**
The truth-free residual gate (printed-distance haversine delta) scores a solution as "confident" because the assigned coordinates reproduce all the printed distances accurately — but the entire solution is globally shifted, rotated, or has wrong post-to-cable pairings that happen to be mutually consistent. The metric certifies internal consistency, not correctness. A solution where all 85 Siriu posts are shifted 200 m north-east but their haversine inter-distances match the printed labels will score identically to the correct solution.

This is the exact failure mode already observed on LC posts 21–31: a ~179 m rigid offset with only ~9.6 m internal residual — the shape was correct, the absolute position was catastrophically wrong. A truth-free metric designed without an anchor sub-score would have rated that cluster "high confidence".

**Why it happens:**
Label-distance residuals measure shape fidelity, not absolute georeferencing. A rigid translation or rotation of the entire route preserves all inter-post distances, so the internal consistency score is invariant to global position error. A global solver that minimizes such residuals can converge to a locally-minimum-residual solution that is globally displaced.

**How to avoid:**
- The residual gate MUST include an absolute-anchor check, not just internal-consistency: at least one post must have its haversine distance to a known reference point (the first post's GPS, or a UTM grid intersection) within a threshold.
- Report two separate sub-scores: (a) internal-consistency residual (shape) and (b) absolute-anchor residual (position). Only flag HIGH confidence when BOTH pass.
- Include the printed-distance sum vs. total haversine span as a secondary sanity: if the sum of all printed distances diverges significantly from the haversine span of the solution envelope, something is wrong.
- Make the global solver verify that the DXF cable arc-length closely matches the summed printed distances before declaring a match valid.

**Warning signs:**
- A confidence score that is uniformly high across drawings that the user reports as visually wrong in Google Earth.
- The internal residual improves while the user-visible absolute position deteriorates on a drawing with a known anchor.
- Any route where posts form a tight cluster (low internal residual) but are many tens of metres off the known anchor — this is the exact LC 21–31 precursor pattern.

**Phase to address:**
P5 (truth-free residual gate) — the two-sub-score architecture (shape + anchor) must be the gate's design contract from the start, not added later. The LC 179 m rigid-offset case should be a P5 regression fixture.

---

### Pitfall 2: Siriu Regression Through Shared Subsystems

**What goes wrong:**
Any change to `assignPolesGloballyByLabels`, `refinePageOriginsByLabelLsq`, `refineSequentialWindows`, or the arc-length walk modifies shared code paths that Siriu depends on. The global solver (P7) will touch exactly these subsystems. Without per-post position ground truth locked before the solver is introduced, every improvement for a new drawing silently regresses Siriu's 85-post ~6 m accuracy — and the cumulative gate (which encodes compensated error) may not surface it.

This was proved four times in succession during 260603-n4k Phase 2: four independent fixes each corrected the target (LC posts 9/10/11) while destroying between 12 and 89 Siriu posts. The cumulative gate passed for two of those attempts before the per-post position gate caught the regression.

**Why it happens:**
Siriu legitimately places 8 posts >30 pt off their number anchors at junctions (post 50 is 501 pt off-anchor). Any fix premised on "correct = near anchor" breaks real Siriu placements. Siriu also has coincident post positions at junctions; any "de-collapse" heuristic hits legitimate Siriu cases. The functions are shared and all Siriu calibration constants are baked into their default thresholds.

**How to avoid:**
- Lock a per-post position truth fixture for every named route BEFORE touching shared placement or calibration code. The Siriu fixture (`siriu-post-positions-truth.json`, 85 posts) is already in place; the LC fixture exists but is RED at Phase 1.5. João Born and Valmor need their own fixtures before P7 touches those pipelines.
- Run the per-post position gates (not just the cumulative error ceiling gate) at every checkpoint in P7. A regression that moves a single Siriu post by 30 pt is invisible to the cumulative gate but will show in the per-post gate.
- The strangler-fig contract (global solver = level-0, old walker = fallback) means the old walker must produce byte-identical output on Siriu when the new solver is not invoked. Add an explicit "solver bypassed, walker output" assertion to the Siriu gate.
- Prefer ADDITIVE new code paths over modifications to existing thresholds. Every threshold in `distance-associator.js` and `post-positioning.js` was calibrated to Siriu; changing a constant is a regression waiting to happen.

**Warning signs:**
- The `npm run test:gate` Siriu gate passes but the per-post position gate shows any posts drifting (even 1–2 posts at the tolerance boundary).
- A change that "only" touches the fallback path but modifies a shared helper function used by both the new solver and the old walker.
- Any attempt to fix LC or another drawing by changing a constant (not adding a predicate) in a shared function.

**Phase to address:**
P7 (global solver) is the primary risk surface. P5 must lock per-post fixtures for all named routes as a prerequisite gate BEFORE P7 begins. P8 (diagnostic failure) must include a Siriu-no-regression assertion in the confidence surface.

---

### Pitfall 3: Ambiguous/Symmetric Topology Producing Global Solver Local Minima

**What goes wrong:**
The global constrained optimizer aligns the PDF numbered route-graph onto the DXF cable-graph. On topologically symmetric segments (e.g., long straight runs with similar inter-post distances, or parallel trunk-plus-spur patterns), the optimizer finds multiple solutions with identical or near-identical residuals. It picks one, but that solution may assign post N to cable node M and post N+1 to cable node M+2 (skipping a node), or swap a trunk post with a tap post. The residual is indistinguishable because the mirrored assignment produces nearly the same distance deltas.

This was foreshadowed by the "off-cable branch" pathology in LC: posts 9 and 10 sit 33–36 pt off the main cable, and the global assignment's monotonic arc-window assumption was violated, producing a mis-resolve. A global solver faces the same degeneracy but at a larger scale.

**Why it happens:**
Without a strong uniqueness condition (e.g., a labeled first-post anchor, distinct landmark distances), cost-symmetric topology is genuinely ambiguous. The optimizer has no way to break ties except by noise in the residual, which is insufficient. Engineering drawings often have repeated spacings (e.g., uniform 35 m poles on a straight street) that are maximally degenerate.

**How to avoid:**
- Require at least one high-confidence anchor (the GPS-provided first post, or a DXF-labeled block with a known post number) as a hard constraint before the optimizer runs. Anchor-free optimization should produce a FAIL result, not a low-confidence result.
- After solving, verify arc-order monotonicity: every consecutive post pair must have the solver-assigned DXF node at a strictly larger arc-position. Any monotonicity violation is a sign of a local minimum — reject the solution and escalate to fallback.
- Limit the candidate window per post based on printed-distance cumulative sum plus tolerance (the N1/arc-walk approach). This is O(n) pruning that eliminates most false candidates before the optimizer sees them, making degeneracy rare.
- For branch/hub assignments specifically: a hub post (label-graph degree >= 3) must be assigned to a DXF node that is also a cable-graph junction (cable degree >= 3). Enforce this as a hard constraint, not just a cost term. Mismatching graph-degree classes is the dominant source of hub mis-assignment.

**Warning signs:**
- Multiple candidate solutions with residuals within 5% of each other.
- The solution assigns a degree-1 DXF node (cable tip) to a post that the PDF label-graph marks as a junction (degree >= 3).
- Arc-order violations: `arcPos(post[i+1]) < arcPos(post[i])` in the assigned DXF nodes.
- A solved route whose total arc-length is shorter than the sum of printed distances by more than 10%.

**Phase to address:**
P7 (global solver) — the anchor hard-constraint, monotonicity check, and degree-class matching must be designed in from the start. P5's residual gate should receive the arc-monotonicity violation count as a sub-score.

---

### Pitfall 4: DXF Unit/Scale Silent Mis-Detection

**What goes wrong:**
The DXF is parsed assuming millimeter or meter units, and no explicit unit header is found (or is ignored). All extracted coordinates are off by a factor of 1000 (mm vs. m) or some other scaling constant. The coordinate values look numerically plausible in isolation (large numbers are normal for UTM), so no error is raised. The region lookup may succeed because the bounding box is computed from the raw values, but if the DXF is in mm the bbox is 1000x too large — potentially spanning multiple regions — or the GPS pairing produces haversine distances that are wildly wrong.

An exact instance is the INFOVIAS context: the coordinate system is SIRGAS-2000 UTM Zone 22S (EPSG:31982), where valid easting is ~100 000–900 000 m and northing is ~6 000 000–9 000 000 m. A DXF in mm would produce easting in the 10^8–10^11 range, which is outside any valid UTM envelope.

**Why it happens:**
DXF files from different CAD software use different default units. AutoCAD DWG-exported DXFs often include a `$INSUNITS` header (group code 70: 4=mm, 6=m), but the value is frequently omitted, set to 0 (unitless), or overridden by a block-level transform. Naive parsers assume a default and silently produce wrong coordinates.

**How to avoid:**
- After parsing, validate that the centroid of all `Poste` INSERT entities falls within the expected UTM Zone 22S envelope (easting: 100 000–900 000; northing: 5 000 000–9 500 000). If it does not, try dividing by 1000 (mm->m) and re-check. If neither passes, FAIL LOUD with "coordinate validation failed: DXF unit mismatch suspected."
- Parse the `$INSUNITS` header explicitly; if absent or 0, emit a warning and apply the envelope-validation heuristic.
- Include the inferred unit in the diagnostic output so it can be inspected.
- Never silently fall back to a "best guess" unit — emit a warning at MEDIUM confidence minimum.

**Warning signs:**
- Parsed UTM easting or northing values outside the Zone 22S envelope.
- The computed GPS bounding box for the DXF covers more than ~50 km2 (a single INFOVIAS route region is typically < 1 km2).
- The haversine distance between any two consecutive assigned posts exceeds 500 m (no INFOVIAS route has pole spacing this large).

**Phase to address:**
P6 (DXF ingestion + region lookup) — the envelope-validation check must be a required step in the ingestion pipeline, not an optional lint.

---

### Pitfall 5: Wrong UTM Zone / Datum Assignment

**What goes wrong:**
The DXF coordinates are valid UTM numbers but are assigned to the wrong UTM zone (e.g., Zone 23S instead of Zone 22S) or the wrong datum (SAD69 vs. SIRGAS-2000). Zone 22S to 23S misassignment produces a longitude error of approximately 6 degrees (~500 km). SAD69 to SIRGAS-2000 shift is ~65 m in the Santa Catarina region. The DXF ingestion produces GPS coordinates that are consistently wrong in a systematic way — the route shape is correct, the absolute position is not.

This is distinct from Pitfall 4 (unit scale) because the coordinate values are in the valid UTM range; the error only appears when converted to lat/lon.

**Why it happens:**
Brazil has two UTM zones covering the southern states (22S and 23S). Florianopolis and the São José / Palhoça municipalities (where all known INFOVIAS routes are located) are in Zone 22S (EPSG:31982). A DXF from another region could be in Zone 23S without any explicit zone annotation in the DXF header. Datum error (SAD69 vs. SIRGAS-2000) is less common since IBGE mandated SIRGAS-2000 after 2015, but older project files may retain SAD69 coordinates.

**How to avoid:**
- Hard-code Zone 22S as the assumed zone for ingestion. Document this as a known v1.1 limitation. When expanding to other regions, add a zone-detection step keyed to the approximate UTM easting range of each zone.
- After converting to lat/lon, sanity-check that the resulting coordinates fall within Brazil (lat: -35 to +5, lon: -75 to -30). An out-of-Brazil result means wrong zone or datum — FAIL LOUD.
- For the GPS region corpus (P6), store each region's zone alongside its GPS bbox so the lookup can confirm zone consistency.
- Emit a medium-confidence warning if the UTM easting is within 20 km of a zone boundary, since near-boundary regions can straddle zones.

**Warning signs:**
- Converted lat/lon outside Brazil's bounding box.
- The GPS bbox of the inferred region differs from the region lookup's stored bbox by more than 50 km.
- Multiple drawings that should be in nearby regions produce wildly different UTM eastings.

**Phase to address:**
P6 (DXF ingestion + region lookup) — the lat/lon bounding-box sanity check must be a hard gate after every UTM-to-WGS84 conversion.

---

### Pitfall 6: GPS Region Lookup — Overlapping Regions and the Boundary False Match

**What goes wrong:**
A drawing's GPS bounding box overlaps two adjacent regions in the corpus (e.g., a route that straddles a municipal boundary). The lookup returns the wrong region — or returns both regions and the code arbitrarily picks one. The cable-graph for the wrong region is then used for post-pairing, producing garbage assignments with plausible internal residuals (since the cable geometry may be similar in adjacent municipalities).

An equally dangerous failure: a drawing that falls into a gap between defined regions (e.g., a newly commissioned route in an area not yet in the corpus) returns "no region" — and the system silently uses a residual fallback or, worse, silently produces wrong output by picking the nearest region.

**Why it happens:**
GPS bounding boxes are imprecise region discriminators. A route near a municipal boundary may have a centroid in one municipality and several posts in the adjacent one. Without polygon-level region geometry, a bbox-overlap lookup cannot resolve ambiguous cases. The "no region" case is underspecified and becomes a silent failure path if not explicitly handled.

**How to avoid:**
- Use region centroid distance as the primary discriminator when two regions' bboxes both contain the drawing centroid. The region whose centroid is closest to the drawing centroid wins. Document this tie-break explicitly.
- The "no region" case MUST produce a FAIL LOUD result with a diagnostic message (e.g., "no DXF region matched; coordinates: lat=X, lon=Y; nearest region: Z at Wkm distance"). Never silently fall back to PDF-only coordinates without surfacing the failure.
- Store a small overlap tolerance in the corpus (per-region, because some regions genuinely overlap due to shared infrastructure). Warn if the drawing falls into a multi-match with no clear winner.
- Implement a "no region" regression fixture for P6 tests: a known out-of-region GPS anchor that must produce a controlled FAIL, not a wrong-region match.

**Warning signs:**
- Two regions' bboxes overlap by more than 10% of either region's area — flag these as ambiguity zones at corpus-build time.
- A lookup returns a region whose stored cable bbox is more than 5 km from the drawing's GPS anchor — suspect wrong-region match.
- The same drawing produces different region matches on consecutive runs (non-deterministic tie-break).

**Phase to address:**
P6 (DXF ingestion + region lookup) — tie-break logic and the "no region" failure path must be specified before P6 ships. P8 (diagnostic failure) must surface the region-lookup result in the per-run diagnostic output.

---

### Pitfall 7: Baseline Gates Encoding Compensated Errors (The "Two Wrongs Cancel" Trap)

**What goes wrong:**
A gate baseline is set while the pipeline contains mutually-compensating errors. Later, when one error is fixed, the fix "regresses" the gate because the compensation that depended on the first error is no longer in effect. This makes every correct fix look like a bug. The developer reverts the fix to keep the gate green, and the system is permanently locked in a wrong-but-internally-consistent state.

This is the exact mechanism behind LC Phase 2 blocking: the post-positioning collapse (layer B) was compensated by the label-LSQ calibration (layer C), which was compensated by the label assignments (layer A). Fixing layer B alone made the gate worse. All four Phase 2 fix attempts were individually correct but were reverted because the compensated gate registered them as regressions.

**Why it happens:**
Per-post error ceiling gates are set from the current (wrong) output by running `BASELINE_UPDATE=1`. Once set, they encode whatever the pipeline happens to produce, including compensated errors. When the codebase has two wrongs that cancel, any single-wrong fix breaks the cancellation and the gate correctly detects the change — but incorrectly classifies it as a regression rather than progress.

**How to avoid:**
- For any major refactor (such as replacing the greedy walker with a global solver), NEVER keep the existing cumulative gate active as the acceptance criterion during intermediate phases. Mark the gate as "expected red mid-flight" until all layers of the change are complete.
- Use per-post POSITION gates (not just cumulative haversine error) as the mid-flight acceptance criterion. These measure each layer independently and are not subject to cross-layer compensation masking.
- Explicitly document, for each gate, whether it is a regression fence (encoding current wrong behavior) or an absolute accuracy assertion (encoding a known-good truth). The cumulative LC gate is currently a regression fence. Never tighten a regression fence to a level that would prevent correct fixes.
- Before starting P7, audit each active gate and classify it as fence or accuracy. Only accuracy gates should be red-lines; fence gates should be informational during solver development.

**Warning signs:**
- A fix that demonstrably improves one route's per-post position accuracy (shown by the per-post position gate) simultaneously degrades the cumulative error gate for the same or another route.
- Multiple developers independently arriving at the same fix and reverting it because the gate goes red — the gate itself is the bug.
- A gate baseline that was set via `BASELINE_UPDATE=1` on a run known to have wrong intermediate results.

**Phase to address:**
P7 (global solver) must begin with an explicit gate audit and classification. P5's residual gate design must distinguish shape-fidelity sub-scores from absolute-accuracy sub-scores so P7 can use the shape sub-score mid-flight without triggering a false regression on the absolute sub-score.

---

### Pitfall 8: In-Browser Global Solver Performance on Large DXF Graphs

**What goes wrong:**
The DXF cable-graph for a "whole-municipality" drawing (e.g., Palhoca.dxf with 35,176 Poste INSERTs and 60,471 INSERTs total) is loaded into browser memory before region extraction. A naive global solver that operates on the unfiltered graph runs O(N^2) or O(N^3) matching over 35 000+ nodes, freezes the browser tab for 10–30 seconds, and potentially hits the JS heap limit.

Even after region extraction, a Siriu-scale route (85 posts, ~200 DXF cable nodes in the region) with O(k^2) per-step Viterbi where k=20 candidates is only ~34 000 operations — trivial. But a larger route with 200+ posts, 100 cable-graph junctions, and a poorly-pruned candidate set at k=50 can reach 10^6+ operations, which is on the edge of browser acceptability.

**Why it happens:**
The performance floor was established on pre-extracted DXF regions (Siriu's `siriu.dxf` was pre-trimmed). The P6 ingestion pipeline must handle untrimmed whole-municipality DXFs. Without a spatial index for region extraction, every INSERT is compared against every region bbox, which is O(N x R) where N=60 000 and R=number of regions.

**How to avoid:**
- Build a spatial index (grid-cell or R-tree bucket) over DXF INSERT positions at ingestion time, before region extraction. Region extraction then becomes O(k) where k is the number of inserts in the target cell — typically 100–500 for a route-scale region.
- Enforce a candidate-count ceiling per post in the global solver (e.g., k<=30 after distance pruning). Log a warning when the unpruned candidate set exceeds this ceiling.
- Add a per-run wall-clock timer in the solver. If matching exceeds 2 seconds, emit a confidence downgrade ("solver slow: results may be suboptimal") and switch to the walker fallback.
- Test the full pipeline against Palhoca.dxf (the known large file, 134 MB, 60k INSERTs) as part of P6 acceptance, not just against the pre-trimmed Siriu region.

**Warning signs:**
- P6 integration tests taking >3 seconds for DXF ingestion in a Node.js environment (browser is 2–5x slower).
- Heap allocation warnings during region extraction.
- The candidate count per post routinely exceeding 30 before pruning.

**Phase to address:**
P6 (DXF ingestion) must include spatial indexing as a required deliverable, not an optimization. P7 (global solver) must enforce a candidate ceiling and a solver time-budget before the solver is considered complete.

---

### Pitfall 9: Scale/Per-Drawing Threshold Generalization Failure

**What goes wrong:**
Constants calibrated to Siriu (e.g., `MAX_MAIN_CHORD_GAP_PT=90`, `JUNCTION_CLOSER_RATIO=0.9`, `bifurcationDetourRatio<1.08`, `OFF_CABLE_FOR_LABEL_CHAIN_PT=30`) are used as-is in the global solver for new drawings. A drawing with a different PDF scale (points-per-meter), a different inter-post spacing distribution, or a different physical layout violates the constants' implicit assumptions. False bifurcations fire, true junctions are missed, and off-cable posts are incorrectly filtered — exactly the LC failure pattern.

**Why it happens:**
PDF-point thresholds are implicitly scale-dependent. Siriu's PDF scale is ~0.36 m/pt. A drawing at a different zoom level has a different scale, and the same 90 pt gap threshold corresponds to a different physical distance. Without deriving thresholds from the per-drawing scale factor, every drawing that deviates from Siriu's scale will produce systematically biased results.

**How to avoid:**
- Replace all point-unit constants with adaptive equivalents derived from the per-page scale factor (already computed as part of the UTM grid detection). For example: `MAX_MAIN_CHORD_GAP_PT` should become `maxMainChordGapM / scaleFactorPtPerM`.
- For the global solver specifically, derive candidate-window widths and monotonicity tolerances from the median inter-post distance in the printed-distance table, not from a fixed point count.
- Create a per-drawing "scale validation" step in P6: after computing the DXF-to-PDF scale, verify it is within 2x of the Siriu baseline. If not, emit a warning: "Drawing scale diverges significantly from reference; threshold generalization may fail."

**Warning signs:**
- A new drawing consistently triggers `Bifurcation at post X` warnings for posts that have no actual branching in the DXF.
- The per-post confidence scores are uniformly low for a new drawing even though the route shape looks correct in the DXF.
- The ratio of `OFF_CABLE_FOR_LABEL_CHAIN_PT` in meters (derived from scale) exceeds 15 m — no physical pole is that far off a projected cable route.

**Phase to address:**
P7 (global solver) must derive all threshold values from per-drawing scale, not from fixed constants. P5's residual gate should include a scale-factor validation step.

---

### Pitfall 10: Phantom/Inferred Edges Flowing Into the Global Solver

**What goes wrong:**
The distance-associator emits phantom non-consecutive edges (e.g., `3->1`, `11->8`, `9->11` in LC; `36->39`, `51->48` in Siriu) as a side-effect of imperfect label association. If the global solver consumes the raw `distanceEdges` output (including these phantoms) without filtering, it treats them as evidence of true route connections. The route-graph it attempts to match against the DXF cable-graph has spurious junctions (degree >= 3 at posts that are actually degree 2), causing topology matching to fail or produce wrong hub/branch assignments.

This was the root cause of the entire 260602-decouple work: the graph-walker had purpose-built compensations for each phantom because the phantom was load-bearing (removing it collapsed the walk). The global solver will face the same phantom-laden input unless the associator is cleaned up first.

**Why it happens:**
`inferDistanceEdgesFromLabels` emits any label that is geometrically near a non-consecutive chord, creating phantom degree >= 3 junctions as a byproduct. These phantoms were tolerable in the sequential walker (which had hard-coded workarounds) but are structurally poisonous for a topology-matching global solver.

**How to avoid:**
- Before P7 begins, verify that the 260602-decouple work fully cleaned the phantom edges for all routes used as solver inputs (Siriu, LC, Valmor). Run the junction ground-truth fixture assertion (`siriu-junction-ground-truth.json`) to confirm no phantom arms remain.
- The global solver must filter its input graph: exclude any non-consecutive edge whose source is `inferred-label` and whose authoritative counterpart (`bifurcation-main`, `branch-arm-rehomed`, or `override`) does NOT exist. Only source-tagged authoritative edges should seed the topology graph fed to the solver.
- Add a route-graph sanity check before the solver runs: any post with label-graph degree >= 3 that does not correspond to a junction in the DXF cable-graph (by cable-degree matching) is a phantom junction candidate — log and suppress.

**Warning signs:**
- The label-graph has degree >= 3 posts that do not correspond to visible branching in the DXF cable-graph.
- The solver's route-graph has more junctions than the DXF cable-graph for the region.
- After running the solver, the assigned DXF nodes for posts near a phantom junction are non-monotonic in arc-position.

**Phase to address:**
P7 (global solver) — the input graph filtering step must be a named deliverable. The junction ground-truth fixture assertion must be green for all named routes before P7 begins.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Keep cumulative-error gate as P7 acceptance criterion during solver development | Avoids building per-post position infrastructure | Blocks every correct fix that disturbs compensated errors — proved fatal in 260603-n4k Phase 2 | Never for P7 |
| Use fixed Siriu-calibrated point thresholds in the global solver | Zero new code | Every new drawing at a different scale fails silently with low-quality output and no diagnostic | Never for P7 |
| Derive confidence score from shape-only residual (inter-post distances) | Simple to implement | Passes confidently on globally-wrong rigid-offset solutions — proved catastrophic on LC 21–31 | Never as the sole confidence signal |
| Skip per-post position gates, rely only on cumulative error ceilings | Faster test suite | Two-wrong-cancel compensations are invisible until they block every correct fix | Never for multi-route systems |
| Extract DXF cable-graph from whole-municipality file without spatial indexing | No ingestion infrastructure needed | O(N x R) search at 60k inserts freezes browser; blocks scaling beyond pre-trimmed fixtures | Only in a single-region CLI tool with < 1000 inserts |
| Hardcode Zone 22S in UTM-to-WGS84 conversion without validation | Zero multi-zone code | Silently-wrong GPS for any drawing outside Zone 22S; no diagnostic | Acceptable in v1.1 if documented as a known limit and a FAIL LOUD is emitted when the out-of-zone heuristic fires |

---

## Integration Gotchas

Common mistakes when connecting pipeline stages.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| DXF parser to UTM coordinate extraction | Accept `$INSUNITS=0` (unitless) silently and assume meters | Validate UTM envelope after conversion; if outside Zone 22S bounds, try /1000; FAIL LOUD if neither works |
| Global solver to old graph-walker fallback | Call the solver, get a low-confidence result, then call the walker on the SAME modified pipeline state | The walker must always receive a pristine pipeline run, not one modified by a partial solver attempt; maintain separate input pipelines |
| GPS region lookup to DXF cable-graph fetch | Assume the first matched region is always correct | Use centroid distance as tie-break; log and expose the matched region name and distance in the diagnostic output |
| PDF printed-distance labels to solver cost function | Feed raw meter values without accounting for label rounding | Apply a plus/minus 5% rounding tolerance in the distance-match cost; labels are printed to 0.1 m precision |
| Browser IndexedDB / Vercel Blob DXF cache | Cache a region's cable-graph by GPS bbox key without versioning | Include a content hash of the DXF in the cache key; a re-uploaded DXF with the same region bbox but different geometry will silently use stale data |
| `haversineMeters` for inter-post distance in the residual gate | Use WGS84 haversine for comparing against printed UTM-derived distances | Printed distances are UTM (planar); use planar Euclidean on UTM coordinates for distance comparison in the residual gate; only use haversine for absolute GPS output |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Unindexed INSERT scan for region extraction | DXF ingestion takes 10–30 seconds in browser; tab hangs | Build a 2D spatial grid index over all INSERT positions; O(1) bucket lookup per region bbox | > 10 000 INSERTs in the DXF (e.g., whole-municipality Palhoca with 60k INSERTs) |
| O(k^2) Viterbi with uncontrolled candidate count | Solver hangs for routes > 100 posts with large DXF regions | Enforce k<=30 candidates per post after distance pruning before Viterbi | k > 50 candidates and n > 100 posts (~250 000 iterations) |
| Loading full DXF into browser memory before parsing | 134 MB ArrayBuffer allocation crashes mobile browsers | Stream-parse the DXF in chunks; only load INSERT entities, skip MTEXT/LEADER/DIMENSION | DXF > 50 MB on mobile; > 150 MB on desktop |
| Rebuilding the GPS region index on every page load | Visible latency on first run | Build and cache the region spatial index in IndexedDB on first upload; invalidate on DXF update | More than ~50 regions in the corpus |
| Rerunning `parsePdf` to generate solver input on confidence re-queries | Multiple full PDF parses for the same document | Cache the `distanceEdges` and `posts` output after the first parse; re-use for solver reruns | Any re-query or confidence re-score after initial parse |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Global solver complete:** solver has been validated on a drawing other than Siriu — verify against at least LC and one untrimmed DXF before declaring P7 done.
- [ ] **Confidence gate complete:** gate computes BOTH shape-fidelity residual AND absolute-anchor residual — verify by introducing a known-rigid-offset test fixture and confirming the gate correctly flags LOW confidence.
- [ ] **DXF ingestion complete:** ingestion has been tested on Palhoca.dxf (the 134 MB whole-municipality file) — verify that ingestion completes in < 5 seconds and produces the correct LC route extract.
- [ ] **Region lookup complete:** the "no region" failure path has been tested with a GPS anchor outside any defined region — verify it produces a FAIL LOUD diagnostic, not a wrong-region assignment.
- [ ] **Siriu no-regression complete:** the per-post position gate (not just the cumulative gate) is green for Siriu after every P7 change — verify `tools/run-siriu-post-position-gate.mjs` exits 0.
- [ ] **Fallback activation complete:** the old graph-walker is provably invoked (not silently skipped) when the global solver returns LOW confidence — verify with a test fixture where the solver intentionally produces a below-threshold result.
- [ ] **UTM zone validation complete:** every UTM-to-WGS84 conversion is followed by a Brazil bounding-box check — verify with a synthetic out-of-zone coordinate that must produce a FAIL, not a wrong-GPS output.
- [ ] **Phantom edge filtering complete:** junction ground-truth fixture assertion green for Siriu, LC, and Valmor before P7 accepts any solver solution — verify `siriu-junction-ground-truth.json` passes.

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Confident-but-wrong (rigid offset passes internal gate) | HIGH — requires rebuilding the residual gate with absolute-anchor sub-score | Add anchor-residual sub-score to P5 gate; introduce the LC 21–31 rigid-offset fixture as a required FAIL case; re-calibrate all confidence thresholds |
| Siriu regression through shared subsystem change | MEDIUM — revert the change; rebuild with per-post position gate as acceptance criterion | Revert to last green per-post gate state; re-attempt with ADDITIVE path only; verify dual position gates (Siriu + LC) at each step |
| Solver local minimum (symmetric topology) | MEDIUM — add anchor hard-constraint and re-run | Inject GPS anchor as a mandatory solver constraint; verify monotonicity post-solve; escalate to walker fallback if monotonicity fails |
| DXF unit mismatch (mm vs m) | LOW — add envelope validation and a divide-by-1000 retry | Add the UTM envelope check to P6 ingestion; test against any known-mm DXF in the corpus |
| Wrong UTM zone | MEDIUM — requires knowing the correct zone | Add Brazil bounding-box post-conversion check; add zone to the region corpus metadata; document Zone 22S assumption as a v1.1 limitation |
| GPS region overlap false match | LOW — add centroid tie-break | Implement centroid-distance tie-break; add ambiguity zones to corpus metadata; test with a near-boundary GPS anchor fixture |
| Compensated-error gate blocking correct fixes | HIGH — requires rebuilding baseline | Audit all gates (fence vs. accuracy); mark cumulative fences as "expected red mid-flight" for P7 development; rebuild baselines post-solver only after verified improvement |
| Phantom edges in solver input | MEDIUM — add input graph filtering step | Filter to authoritative-source edges only before solver; run junction ground-truth fixture; verify no phantom degree >= 3 junctions remain |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Confident-but-wrong / rigid offset passes gate (Pitfall 1) | P5 — residual gate design must include absolute-anchor sub-score | Introduce the LC 179 m rigid-offset case as a P5 regression fixture; confirm gate FAILS it |
| Siriu regression through shared code (Pitfall 2) | P7 prerequisite — per-post fixture lock for all named routes before P7 begins; strangler-fig enforcement | `run-siriu-post-position-gate.mjs` exits 0 at every P7 commit |
| Solver local minima / symmetric topology (Pitfall 3) | P7 — anchor hard-constraint + monotonicity check built into solver | Test with a uniform-spacing route (no landmark distances); verify monotonicity assertion fires on a synthetic degenerate |
| DXF unit/scale mis-detection (Pitfall 4) | P6 — UTM envelope validation in ingestion pipeline | Test Palhoca.dxf (known-meter) and a synthetic mm DXF; confirm the mm DXF triggers the divide-by-1000 retry |
| Wrong UTM zone / datum (Pitfall 5) | P6 — Brazil bounding-box post-conversion check | Test with a synthetic Zone 23S easting; confirm FAIL LOUD |
| GPS region overlap / no-region (Pitfall 6) | P6 — tie-break logic + "no region" failure path | Test with out-of-region GPS anchor; confirm FAIL with diagnostic |
| Baseline encoding compensated errors (Pitfall 7) | P7 prerequisite gate audit — classify all gates before P7 begins | All gates classified as fence or accuracy; fence gates marked "expected red mid-flight" during P7 |
| Browser performance on large DXF (Pitfall 8) | P6 — spatial indexing as a required deliverable | P6 integration test against Palhoca.dxf must complete in < 5 seconds |
| Scale threshold generalization failure (Pitfall 9) | P7 — adaptive thresholds derived from per-drawing scale | Test P7 solver on a drawing with 2x different PDF scale; confirm no false bifurcations |
| Phantom edges flowing into solver (Pitfall 10) | P7 prerequisite — junction ground-truth fixture green before P7 ships | Junction ground-truth fixture assertion passes for all named routes |

---

## Sources

- `260603-n4k-ROOTCAUSE.md` / `260603-n4k-MILESTONE-SCOPE.md` — four-attempt Siriu regression proof; dual-gate design; compensated-error coupling (Pitfalls 2, 7)
- `260603-jk7-ROOTCAUSE.md` / `260603-jk7-DECISION.md` — phantom inferred edges; ambiguous-source edge classification; window-refine regression risk (Pitfalls 10, 2)
- `260603-acc-RESEARCH.md` — rigid 179 m offset on LC 21–31; confident-but-wrong; scale-dependent thresholds; DWG-only topology junction detection (Pitfalls 1, 9)
- `260602-decouple-CONTEXT.md` — phantom-edge/walker-compensation coupling; load-bearing phantom edges (Pitfall 10)
- `260601-k1a-CONTEXT.md` — hardcoded literal guards as the consequence of missing generic predicates; second-fixture validation as the overfitting defense (Pitfalls 2, 9)
- `260601-dwg-CONTEXT.md` — DWG-path vs. PDF-path divergence; non-source-tagged edge filtering (Pitfalls 10, 3)
- `20260519-RESEARCH.md` — HMM/Viterbi complexity bounds; UTM grid accuracy limits; SIRGAS-2000/SAD69 datum shift (Pitfalls 4, 5, 8)
- `.planning/PROJECT.md` — v1.1 locked decisions (strangler-fig, truth-free residual, DXF as accuracy authority, fail loud never wrong)

---
*Pitfalls research for: Generalized DXF-Driven Accuracy (v1.1) — georeferenced asset pairing, global graph matching, truth-free confidence, DXF coordinate-system handling, GPS region lookup*
*Researched: 2026-06-05*
