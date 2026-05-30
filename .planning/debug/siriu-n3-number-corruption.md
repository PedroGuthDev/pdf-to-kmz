---
status: investigating
trigger: "Fix N3 pole-assignment pass (assignPolesGloballyByLabels) corrupting post numbers on multi-sheet Siriu route — posts 28-33 dropped, 6-post number shift causes 250-330m errors on posts 34-49."
created: 2026-05-29
updated: 2026-05-29
goal: find_and_fix
harness: debug-run-calc-dwg-from-pdf-siriu.mjs
related_sessions:
  - .planning/debug/siriu-post34-cascade.md
---

## Current Focus

reasoning_checkpoint:
  hypothesis: "correctRouteNumberingByDistanceLabels mirrors page-5 post numbers with formula minN+maxN-number over a NON-CONTIGUOUS set [25,26,27,28,29,30,31,32,33,43,44,45]; with minN=25,maxN=45 this maps 28->42,29->41,30->40,31->39,32->38,33->37 colliding with real posts 37-42, which dedup later collapses, dropping 28-33."
  confirming_evidence:
    - "PP_DBG: PRE-N3#1 is clean 1..85; correctRouteNumbering MIRROR page=5 range=25-45 nums=[25..33,43,44,45]; POST-N3#1 shows 28-33 region became 42,41,40,39,38,37 with duplicate 37,38,39,40,41,42."
    - "Mirror formula minN+maxN-number is only valid for a single contiguous numeric range; page 5 holds two disjoint segments (25-33 and 43-45)."
    - "Page 4 (13-24 contiguous) and page 8 (67,68,81-85 non-contiguous) also mirror; page 4 reversal is benign-ish but page 8 also corrupts."
  falsification_test: "If mirror is restricted to contiguous runs and Siriu posts 28-33 STILL disappear, hypothesis is wrong."
  fix_rationale: "Mirror each maximal contiguous numeric run independently (and decide per-run via residual), so disjoint segments on one PDF page never cross-map into each other's numbers. Preserves João Born single-range flips; protects Siriu multi-segment pages."
  blind_spots: "Page 4 flip (13-24) may itself be wrong direction; need to verify posts 13-24 errors don't worsen. Per-run residual decision could flip a run João Born relied on as whole-page."

test: "Implement per-contiguous-run mirror; re-run Siriu harness + Valmor + João Born + unit tests."
expecting: "28-33 restored, 34-49 errors drop, no Valmor/João Born regression."
next_action: "Rewrite correctRouteNumberingByDistanceLabels to mirror per contiguous run."

## Symptoms

expected: "Posts 28-33 present in route; posts 34-49 errors < 50m."
actual: "Posts 28-33 absent; posts 34-49 land 250-330m off due to 6-post number offset."
errors: "dwg-graph-walk: numbering offset"
reproduction: "node debug-run-calc-dwg-from-pdf-siriu.mjs"
started: "Pre-existing."

## Eliminated

## Evidence

## Resolution

root_cause:
fix:
verification:
files_changed: []
