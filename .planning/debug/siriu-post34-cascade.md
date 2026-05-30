---
status: diagnosed
trigger: "Post 34+ cascade in Siriu DWG graph-walk: posts 34-49 land 60-332m off GT. 27->34 jump (label 31.8) and suspected 36->38 bifurcation mis-label (35.5m on 37->38 instead of 36->38)."
created: 2026-05-29
updated: 2026-05-29
goal: find_and_fix
harness: debug-run-calc-dwg-from-pdf-siriu.mjs
ground_truth: coordenadas postes siriu.txt
related_sessions:
  - .planning/debug/resolved/siriu-tap-blocks-spine-25.md
  - .planning/debug/siriu-branch-return-labels.md
---

## Current Focus

hypothesis: "CONFIRMED — post-number corruption in assignPolesGloballyByLabels (pdf-parser N3 pass) drops posts 28-33; walker is correct. Both Task 2 (27->34 walker geometry) and Task 3 (35.5m mis-label) hypotheses were eliminated."
test: "PP_DBG trace of post numbers before/after each pdf-parser transform."
expecting: "Done — clean 1..85 before N3, scrambled after N3."
next_action: "Out of scope for graph-walker.js. Upstream fix to assignPolesGloballyByLabels needs its own session with João Born / Valmor regression checks."

## Symptoms

expected: "Walk completes past post 50, errors < 20m (most < 5m)."
actual: "Posts 1-27 good (<13m). Post 34: 264m, 35: 332m, 36: 297m, 37: 261m, 38-45: 150-209m, 46: 60m, 47: 109m, 49: 91m. Walk fails at post 50 (tolerance-exceeded). Posts 28-33 absent from this route segment (different branch)."
errors: "dwg-graph-walk-fail at_post=50 reason=tolerance-exceeded"
reproduction: "node debug-run-calc-dwg-from-pdf-siriu.mjs"
started: "Pre-existing; separate root cause from post-25 tap fix (now resolved)."

## Eliminated

- hypothesis: "27->34 is a cross-branch jump and the walker applies label 31.8 to the wrong hop (geometry bug in walker)."
  evidence: "The walk physically traverses the CORRECT DXF spine. chosen indices 27->34->35->36... = idx 148,104,106,149,150,105,103,119,118,117,121,122,123 which is exactly the contiguous spine that holds GT posts 27,28,29,30,31,32,33,34,35,36. The walker is geometrically right; it is the POST NUMBERS that are off because posts 28-33 are missing from the route."
  timestamp: 2026-05-29

- hypothesis: "36->38 bifurcation-main label 35.5 was mis-assigned to 37->38 instead of 36->38 (Task 3 hint)."
  evidence: "No 35.5 label exists anywhere around route posts 36-38. Actual labels: 35->36=47.9, 36->37=10.5(bifurcation-tap), 37->38=null(bifurcation-cleared), 38->39=null(jumpback-suppressed), 39->40=34.7. The route-numbered 36 corresponds to GT post 36 region but the supposed 35.5 mis-label is not present. The bifurcation tap at route-36->37=10.5 is real but the cascade is driven entirely by the upstream missing-posts gap, not a label mis-assignment."
  timestamp: 2026-05-29

## Evidence

- timestamp: 2026-05-29
  checked: "parsed.posts post numbers from PDF parser (debug-post34-route.mjs)"
  found: "Post sequence is 1..27,34,35,36,37,38,39,40,...  Posts 28,29,30,31,32,33 are ENTIRELY ABSENT from parsed.posts. The route fed to the walker (routePosts, 76 entries) also lacks 28-33. parsed.connections contains a spurious 27->34 gap=false edge."
  implication: "The cascade is NOT a walker bug. The PDF parser failed to extract post markers 28-33. The walker walks the correct spine but mislabels INSERTs (calls GT-post-28's INSERT 'post 34')."

- timestamp: 2026-05-29
  checked: "Nearest DXF INSERT to each GT post 26-40 (debug-post34-topo.mjs, GT lat/lon -> UTM via latLonToUtm)"
  found: "post27=idx149(2.86m) post28=idx150(2.75m) post29=idx105(1.50m) post30=idx103(1.18m) post31=idx119(1.58m) post32=idx118(1.67m) post33=idx117(5.27m) post34=idx121(3.06m) post35=idx122(13.08m) post36=idx123(2.30m). adj(149)={150}; adj(150)={149,105,107}; adj(105)={150,103}; adj(103)={105,119}; adj(119)={103,118}; adj(118)={119,117}; adj(117)={118,121}; adj(121)={117,120,122}; adj(122)={121,123}; adj(123)={122}."
  implication: "GT posts 27-36 form a single contiguous, well-connected DXF spine (149-150-105-103-119-118-117-121-122-123). All present in the DXF. The walk trace chose exactly these INSERTs in order — confirming the geometry is correct and the only defect is the missing post numbers 28-33."

- timestamp: 2026-05-29
  checked: "Distance edges around posts 27-34 (debug-post34-topo.mjs)"
  found: "27->28=45.2, 28->29=39, 29->30=32.2, 30->31=26.1, 31->32=26.2, 32->33=19.3(bifurcation-tap), 33->34=null(jumpback-suppressed), 27->34=31.8(legacy-midpoint). The consecutive 27->28..33->34 distance edges EXIST in parsed.distances even though the POST objects 28-33 do not."
  implication: "OCR/label association recovered the distance labels referencing posts 28-33, but the post-marker extraction missed the actual post symbols/numbers for 28-33. The spurious 27->34=31.8 legacy-midpoint edge bridges the two extracted posts across the gap and becomes a false route connection."

- timestamp: 2026-05-29
  checked: "Walk trace chosen-idx vs GT-INSERT map alignment (GW_TRACE=1)"
  found: "Route step 35->36 chose idx149 (GT post 27's INSERT); 36->37 chose 150 (GT 28); 37->38 chose 105 (GT 29); ... 42->43 chose 121 (GT 34); 43->44 chose 122 (GT 35); 44->45 chose 123 (GT 36). The walk is offset by exactly the count of missing posts."
  implication: "Per-post errors of 150-330m are the physical distance between, e.g., GT post 34's true location and GT post 28's location (where the walker placed the INSERT it labelled 34). Confirms numbering offset, not misplacement."

## Resolution

root_cause: |
  POST-NUMBER CORRUPTION in parser/pdf-parser.js → assignPolesGloballyByLabels
  (the N3 global pole-assignment pass, multiSheetRoute path).

  Traced post-number arrays through the parser (PP_DBG instrumentation,
  since removed):
    BEFORE N3 (P0): 1..27,28,29,30,31,32,33,34,35,36,...,85  (CLEAN, all
                    85 posts present and sequential — OCR is CORRECT;
                    ocrResults has all 85 incl. 28-33 on page 5/6).
    AFTER  N3 (P1): ...11,12,24,23,22,21,20,19,18,17,16,15,14,13,
                    45,44,43,42,41,40,39,38,37,34,35,36,37,38,39,40,41,42,
                    27,26,25,46,...,66,85,84,69,70,71,72,73,74,75,76,77,78,
                    79,80,71,70,69,68,67  (CORRUPTED: post .number values
                    reassigned and reordered; duplicates 37,37 / 40,40 /
                    41,41 / 42,42 / 69,70,71 appear; posts 28-33 are
                    overwritten with 45,44,43,42,41,40).

  So OCR is NOT the problem (it read posts 28-33 correctly). The N3 global
  label-matching pass MIS-ASSIGNS post .number values, scrambling whole
  ranges (13-24 reversed, 28-33 renumbered into a duplicate 37-42 run).
  Downstream deduplicatePostsPreferLowerPage then collapses the duplicates,
  keeping one of each colliding number and DROPPING the surplus — the net
  effect is the final parsed.posts sequence ...26,27,34,35,36,37,37,38,38,
  ... with posts 28-33 gone and several duplicate numbers.

  Consequences for the walker:
    1. A spurious connection 27->34 (gap=false, label 31.8 legacy-midpoint)
       bridges the two surviving posts across the 6-number gap.
    2. The graph-walker walks the physically-CORRECT DXF spine
       (149-150-105-103-119-118-117-121-122-123-...) but, handed the
       corrupted route numbers 27,34,35,36,..., it labels GT-post-28's
       INSERT as "post 34", GT-post-29 as "post 35", etc.
    3. Every post from 34 onward is mislabelled by the gap size, producing
       150-330m "errors" that are actually the spacing between the true
       post and the post ~6 positions earlier on the spine.

  This is NOT a graph-walker geometry defect and NOT the distance-label
  mis-assignment in Task 3's hint (no 35.5m-on-37->38 label exists; actual
  labels around route posts 36-38 are 35->36=47.9, 36->37=10.5 tap,
  37->38=null cleared). The walker is already placing the right INSERTs and
  cannot invent the six lost posts. The fix belongs upstream in
  assignPolesGloballyByLabels, which is OUT OF SCOPE per task constraints
  (graph-walker.js only).
fix: |
  No graph-walker fix is possible or correct for this defect — the walker
  already traverses the right INSERTs in the right physical order. The
  defect is upstream post-number corruption in assignPolesGloballyByLabels.
  No code changed in this session beyond Task 1's already-verified
  tapPlacedMainLabel commit (parser/dwg/graph-walker.js, f4007cb).
verification: |
  - PP_DBG trace proves N3 (assignPolesGloballyByLabels) corrupts post
    numbers (clean before, scrambled after); instrumentation removed,
    pdf-parser.js restored to its pre-session state.
  - Walk trace (GW_TRACE) + GT->INSERT nearest map prove the walker
    traverses the correct spine; errors are a numbering offset.
  - Tests green after revert: graph-walker 4/4, region-pairing,
    coordinate-calculator, distance-associator — 25 tests, 0 fail.
files_changed: []

remaining_issue: |
  Upstream defect, NEEDS ITS OWN SESSION (do not touch from walker scope):
  parser/pdf-parser.js → assignPolesGloballyByLabels mis-assigns post
  .number values on the multi-sheet Siriu route, scrambling ranges
  (13-24 reversed; 28-33 overwritten into a duplicate 37-42 run) which the
  later dedup then collapses, dropping posts 28-33. OCR is correct (P0
  shows clean 1..85). Fixing assignPolesGloballyByLabels' number assignment
  must be regression-checked against João Born and Valmor (the routes this
  N3 pass was tuned for — see joao-born-coords-off and
  siriu-branch-return-labels sessions). Once N3 preserves the OCR numbers
  (or correctly maps poles to existing numbers without collisions), the
  spurious 27->34=31.8 bridge disappears and the existing consecutive
  27->28..33->34 edges let the walker number the spine correctly.

probes_created:
  - debug-post34-topo.mjs   (distances/connections + GT->INSERT nearest map)
  - debug-post34-route.mjs  (parsed.posts numbers, route post list, page map)
