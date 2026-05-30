---
status: awaiting_human_verify
trigger: "DWG graph-walker bifurcation-tap-stub at step 23->24 claims idx=145 which blocks the hint path 143->145->post_25; post 25 placed 68m off GT, cascade through 27-50"
created: 2026-05-29
updated: 2026-05-29
goal: find_and_fix
harness: debug-run-calc-dwg-from-pdf-siriu.mjs
ground_truth: coordenadas postes siriu.txt
related_sessions:
  - .planning/debug/siriu-dwg-walker-branch.md
  - .planning/debug/dwg-graph-walk-no-candidate.md
  - .planning/debug/siriu-branch-return-labels.md
---

## Current Focus

status: fixing

reasoning_checkpoint:
  hypothesis: "At step N->N+1 where fromIdx was placed by a bifurcation-tap-stub and labelM(N->N+1) is null, the bifurcation-main label (junction->N+1) actually measures the span FROM the tap post (fromIdx) to N+1, because an aux tap post sits at the junction. The walker must search the main label FROM fromIdx, where N+1's INSERT is a direct unclaimed neighbor, instead of from the junction (whose path is blocked by the now-claimed tap idx)."
  confirming_evidence:
    - "span(145,146)=55.09 vs bifurcation-main label 55.2 -> delta 0.11 (direct neighbor of standing node, near-perfect)"
    - "span(143,146)=93.86 (junction->post25 cable) does NOT match 55.2 -> the main label is NOT the junction->target cable distance"
    - "post25 true INSERT idx146 is a direct unclaimed neighbor of fromIdx=145 (adj(145)={143,144,146})"
    - "current hint search from junction 143 lands on 144 (delta 10.77<tol19.3) because path through claimed 145 is blocked"
  falsification_test: "If searching main label FROM fromIdx picks an endpoint != 146, or breaks posts 1-24 / Valmor / Joao Born, the hypothesis/fix is wrong."
  fix_rationale: "Track indices placed by the bifurcation-tap-stub handler. On the NEXT step, if fromIdx is tap-placed and labelM is null, run findMultiHopByLabel(from=fromIdx, label=bifurcation_main) FIRST, before the junction-origin hint search. This addresses the root cause (label semantics at aux taps) not a symptom."
  blind_spots: "Other tap sites (posts 12,37,42,45) may have different geometry where main label does NOT match fromIdx->target. Must verify the from-fromIdx search only wins when it produces a near-exact match, and falls back to existing behavior otherwise. Joao Born / Valmor regression must be checked."

next_action: "Implement: track tapPlacedIdx + its bifurcation-main label; on next step when fromIdx is tap-placed and labelM==null, try findMultiHopByLabel(from=fromIdx,label=main) before the junction-origin hint loop."

## Symptoms

expected: "All 85 Siriu posts paired, errors < 5m vs GPS GT. Posts 24->25 transition correct."
actual: "Posts 1-24 good (1-13m). Post 25: 68m. 26-27: 56-111m. 34-49: 84-379m. Post 50: walk fails tolerance-exceeded."
errors: "dwg-bifurcation-tap-stub at_post=24 label_m=26.1 main_label_m=55.2; dwg-tolerance-relaxed at 46->47 delta=22.4m; dwg-graph-walk-fail at_post=50 no-candidate"
reproduction: "node debug-run-calc-dwg-from-pdf-siriu.mjs"
started: "After bifurcation-tap-stub handler introduced (recent commits f4663bc, 24c60a9, 01473a5)"

## Eliminated

- hypothesis: "Tap claiming idx=145 blocks the hint path 143->145->post_25, walker falls to single-neighbor shortcut taking 144."
  evidence: "Partially right on the block, wrong on mechanism. At 24->25 fromIdx=145, labelM=null, unclaimed neighbors={144,146} (not single-neighbor). The hint helper DOES fire: findMultiHopByLabel(from=143=post23, label=55.2). Because 145 is claimed, the path 143->145->146 is unreachable; the only within-tol endpoint from 143 is 144 (span 143's reachable side, delta 10.77 < tol 19.3). So the walker picks 144 via the HINT helper, not the single-neighbor shortcut."
  timestamp: 2026-05-29

## Evidence

- timestamp: 2026-05-29
  checked: "Nearest DXF INSERT to each GT post 22-27 (debug-tap25-probe.mjs)"
  found: "post22=idx142(2.71m) post23=idx143(2.41m) post24=idx145(1.97m) post25=idx146(1.13m) post26=idx147(8.04m) post27=idx149(2.86m). adj(143)={142,145}; adj(145)={143,144,146}; adj(144)={141,145}."
  implication: "Tap placing post24 at idx145 is CORRECT. post25 true INSERT idx146 is a DIRECT neighbor of idx145 (where we stand at step 24->25)."

- timestamp: 2026-05-29
  checked: "Distance labels touching posts 22-27 (debug-tap25-labels.mjs)"
  found: "23->24=26.1(bifurcation-tap); 24->25=null(bifurcation-cleared); 23->25=55.2(bifurcation-main); 25->26=32.3; 26->27=26.9."
  implication: "The consecutive 24->25 is cleared. The bifurcation-main label 23->25=55.2 is the only hint for reaching post 25."

- timestamp: 2026-05-29
  checked: "DXF euclidean spans vs labels (debug-tap25-spans.mjs)"
  found: "span(143,145)=39.05 vs label 23->24=26.1 (off 13m); span(143,146)=93.86 vs label 23->25=55.2 (off 38m!); span(145,146)=55.09 vs label 24->25=null. CRITICAL: 55.09 ~= 55.2."
  implication: "The bifurcation-main label 55.2 geometrically describes the 24->25 segment (span 55.09, delta 0.11), NOT the 23->25 cable distance (93.86m). The parser tagged the junction->spine distance as 23->25 but at an aux tap the tap-post sits ~at the junction, so the label really measures fromIdx(tap post)->target."

- timestamp: 2026-05-29
  checked: "Direct span from standing node 145 vs main label 55.2"
  found: "span(145,146)=55.09 delta=0.11; span(145,144)=26.92 delta=28.28."
  implication: "From the standing tap-post node (145), the bifurcation-main label 55.2 matches direct neighbor 146 (post 25) with delta 0.11 — near-perfect. The fix is to search the bifurcation-main label FROM fromIdx (the tap post), not from the junction (idx143, whose path through 145 is blocked)."

## Resolution

root_cause: |
  At a bifurcation auxiliary tap (e.g. post 24), the parser produces:
    - 23->24 = bifurcation-tap stub (26.1)
    - 24->25 = null (bifurcation-cleared)
    - 23->25 = bifurcation-main (55.2)
  The tap-stub handler correctly places post 24 at idx=145 (1.97m from GT).
  But at step 24->25 (labelM=null), the hint helper searches the main label
  55.2 FROM the junction post 23 (idx=143). Because idx=145 is now claimed,
  the path 143->145->146 (true post 25) is blocked, so findMultiHopByLabel
  returns idx=144 (the only within-tolerance reachable endpoint, delta 10.77 <
  tol 19.3). Post 25 lands 68m off GT, cascading through 26-50.

  The geometric truth: the bifurcation-main label 55.2 actually equals
  span(145,146)=55.09 — i.e. it measures the tap-post(24)->spine(25) distance,
  not the junction(23)->spine(25) cable distance (93.86m). At an auxiliary tap
  the tap post sits essentially AT the junction, so the main label should be
  applied as a span FROM the tap post (fromIdx), where post 25's INSERT is a
  direct unclaimed neighbor.
fix: |
  parser/dwg/graph-walker.js:
    1. Added Map tapPlacedMainLabel (tap-post number -> bifurcation-main label m).
    2. In the bifurcation-tap-stub handler, record tapPlacedMainLabel.set(toNum,
       juncMainLabelM) when the tap places a post.
    3. At the start of Case A's hint block (before the junction-origin hint
       search), when chosenIdx is undefined and labelM==null, look up
       tapPlacedMainLabel.get(fromNum). If present, run
       findMultiHopByLabel(fromIdx, mainLabel, tol=spanToleranceFor(mainLabel),
       maxHops=4) to place the next post from the tap node directly. Uses the
       TIGHT span tolerance (not the loose 0.35x) so it only wins on a real
       geometric match — preventing false positives at other taps.
    4. Guarded the subsequent junction-origin hint search to skip when chosenIdx
       is already set by the tap-main search.
  Fully generic: keyed on the bifurcation-tap-stub mechanism, no Siriu constants.
verification: |
  node --test parser/__tests__/graph-walker.test.mjs          -> 4/4 pass
  node --test parser/__tests__/region-pairing.test.mjs        -> pass
  node --test parser/__tests__/coordinate-calculator.test.mjs -> pass
  node --test parser/__tests__/distance-associator.test.mjs   -> 11/11 pass

  node debug-run-calc-dwg-from-pdf-siriu.mjs (partial DWG):
    Post 24: 2.01m  (was 2.01)
    Post 25: 1.11m  (was 68.10)  <- FIXED
    Post 26: 8.06m  (was 111.65)
    Post 27: 7.96m  (was 56.92)
    Post 12: 5.19m  (unchanged — no regression on the other tap)
  Walk advances correctly 24->25->26->27. Primary objective met.
files_changed:
  - parser/dwg/graph-walker.js

remaining_issue: |
  Post 34+ cascade (264m+) is a SEPARATE root cause, not the tap issue. The
  route connection 27->34 (label 31.8) is a cross-branch/cross-page hop: post
  34's true INSERT idx121 is ~224m from post 27's INSERT idx148/149, far beyond
  any plausible 31.8m cable span. Posts 28-33 sit on a different branch arm. The
  walker applies the within-branch label 31.8 to the wrong cross-branch hop and
  lands on idx104 (40m, loose-tol match) in the wrong region. Same class as the
  branch-return / cross-page-gap problem; needs its own session (route ordering /
  connection topology around the 27/28-33/34 fork). Post 27 also lands at idx148
  (8.57m from true idx149) — a minor 1-INSERT offset that may resolve once the
  upstream 26->27 label/route is corrected.

probes_created:
  - debug-tap25-probe.mjs    (nearest INSERTs + reachability BFS)
  - debug-tap25-labels.mjs   (distance labels around posts 22-27)
  - debug-tap25-spans.mjs    (DXF euclidean spans vs labels)
