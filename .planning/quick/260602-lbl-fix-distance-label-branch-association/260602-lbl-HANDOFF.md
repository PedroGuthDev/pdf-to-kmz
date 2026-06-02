# Quick Task 260602-lbl: Fix distance-label branch/cross-page mis-association

**Created:** 2026-06-02
**Status:** Ready to start fresh (handoff from the k1a guard-generalization thread)
**Predecessor:** `.planning/quick/260601-k1a-replace-hardcoded-post-number-guards-gra/`

---

## TL;DR — the real root cause

The graph-walker's post-number hacks (`fromNum===73&&toNum===74`, `fromNum===80&&toNum===81`)
and the 36/37/39 spurious bifurcation are **all symptoms of one upstream bug: the
distance-associator mis-associates branch-arm and cross-page labels.** The walk is
correctly trying to recover a *broken topology*. Fix the association so the label graph
encodes the true junctions, and the branch-traversal works generically — the hacks (and
the Task-4 revert) become unnecessary.

**Do NOT keep generalizing the walk hacks. Fix the association instead.**

---

## The three symptoms ↔ three mis-associated labels (verified 2026-06-02)

| Walk hack / symptom | TRUE label (ground truth) | Currently attached to |
|---|---|---|
| `80/81` off-cable insert (`graph-walker.js` ~L1978) | `62→81 = 40.6` | `80→81` — the 40.6 label is on a **different page** than post 62, so it's grabbed by same-page posts 80/81 |
| `73/74` gap-reentry (`graph-walker.js` ~L1734) | `70→74 = 38.7` | `74→75` (jumpback-shift) — 70's branch arm stolen by the consecutive pair |
| `36` spurious bifurcation (fixed by Task-4 revert, commit edc96a2) | `36→46 = 27.7` | `45→46` / `14→18` — 36's 4th arm mis-pointed to 39 |

When association is fixed, **Task-4's re-validation revert should be revisited**: 27.7 should be
*placed on 36→46*, not nulled. The calibrated re-validation pass in
`parser/distance-associator.js` (commit edc96a2) may become redundant or need adjustment.

---

## GROUND TRUTH — Siriu true topology (from the user, authoritative)

**The ONLY branch posts (label-degree ≥3) in Siriu are: `5, 14, 36, 48, 60, 62, 70`.**

Their correct arm labels (use these to see what's mis-associated and why):

- **post 5**: 32.6 (from 4), 28.5 (→6), 29.5 (→10)            → arms {4,6,10}
- **post 14**: 40.4 (from 13), 33.7 (→15), 27.9 (→18)          → arms {13,15,18}
- **post 36**: 47.9 (from 35), 10.5 (→37), 35.5 (→38), 27.7 (→46)  → arms {35,37,38,46} (degree 4)
- **post 48**: 19.3 (from 47), 8.4 (→49), 44.7 (→54)           → arms {47,49,54}
- **post 60**: 31.7 (from 65), 31 (→69), 27.4 (→61)            → arms {65,69,61}
- **post 62**: 34.8 (from 61), 33.8 (→63), 40.6 (→81)          → arms {61,63,81}
  - **DETAIL: the 40.6 (62→81) label is on ANOTHER PAGE — not the page post 62 appears on.**
- **post 70**: 23.6 (from 69), 31.8 (→71), 38.7 (→74)          → arms {69,71,74}

**Branch tips (label-degree 1)** include: 73, 74(start), 80, 9, etc. (74 is a degree-1
forward-only orphan start in the *current* broken graph; once 70→74 is associated, 74
becomes a normal arm of junction 70).

**Point of attention — post 65** (NOT a junction; its labels point to the middle of the
street, not its insert, but it's alone so findable):
- 19.8 (from 59), 31.7 (→60), and TWO labels to post 66: 7.8 (to mid-street) + 22 (to post 66).
  i.e. the 65→66 edge is drawn as two label segments because the cable bends mid-street.

## Current (BROKEN) junction arms for comparison

```
post 62: should be [61,63,81]   → is [61,63]        (missing 62→81, cross-page 40.6)
post 70: should be [69,71,74]   → is [69,71]        (missing 70→74, stolen 38.7)
post 36: should be [35,37,38,46]→ is [35,37,38,39]  (39 should be 46)
post 48: should be [47,49,54]   → is [47,49,51,54]  (spurious 48→51)
post 60: should be [61,65,69]   → is [59,61,65,66]  (60→69 stolen by 68→69; 59/66 spurious)
post  5: [4,6,10] OK     post 14: [13,15,18] OK
```

---

## The two failure modes to fix in the associator

1. **Cross-page branch entry** (e.g. 62→81 = 40.6): label drawn on the destination/branch
   page, far from the junction. The associator works mostly per-page by proximity, so it
   attaches the label to a nearby same-page pair (80→81) instead of bridging back to the
   junction (62) on the prior page.
2. **Same-page branch arm stolen by the consecutive pair** (70→74=38.7, 36→46=27.7,
   60→69=31, 48→arm): the arm label sits near the junction but points to a *non-consecutive*
   post; the sequential/midpoint heuristics grab it for the consecutive pair (74→75, 45→46,
   68→69).

**Open design question (decide with user):** the discriminator is likely **geometry** — a
branch-arm label sits near the junction and points *along the arm's cable-direction bearing*
toward the far post, not along the consecutive-numbering direction. Confirm whether that's the
signal (label position + cable-arm bearing from junction) or if there's a cleaner PDF cue
(e.g. the label physically lies on the cable segment it measures).

---

## Staged plan

- **Stage A — prove the model on correct topology (low risk).** Encode the ground-truth
  junction graph above as a TEST fixture (ground truth, not runtime logic). Build a
  label-graph DFS-with-slots branch traversal (user's model: degree-1 = tip, degree-≥3 =
  junction with degree−1 arms; at a tip pop to nearest junction with a free *slot*; degree-4
  junctions get 2 slots; mark slots consumed). Verify it reproduces correct Siriu coords with
  ZERO post-number hacks. Validates the whole model before touching the fragile associator.
- **Stage B — fix the associator to PRODUCE that topology (the hard part).** Teach
  `parser/distance-associator.js`: (a) a junction's branch arm can point to a non-consecutive
  post — don't let the consecutive pair steal it; (b) cross-page branch-entry labels bridge
  back to the junction on the prior page. Validate against Stage-A ground truth + all gates.

User's stated preference: **start with the association fix (Stage B)** in a fresh context.
(Stage A is optional de-risking; user may go straight at B.)

---

## Key files & validation gates

- `parser/distance-associator.js` — the associator (where the fix lives). Relevant:
  `associateDistancesRich`, `applyBifurcationJunctionLabelRehome` (L1221+), cross-page logic
  in `labelGapToSegment` (L1711). The Task-4 calibrated re-validation pass is at the top of
  `applyBifurcationJunctionLabelRehome`.
- `parser/dwg/graph-walker.js` — the walk + the two post-number hacks (73/74 ~L1734,
  80/81 ~L1978) + existing branch machinery (`branchEntryStack` L1206, `shouldTryBranchReturn`
  L726, push at L2683 requires degree≥4 & single excursion — too narrow; `findBranchReturnArm`).
- **Gates (all must stay green):**
  - `node tools/run-siriu-regression-gate.mjs` (Siriu DWG, mean ~3.6m — the tight one)
  - `node tools/run-route-pdf-accuracy-gate.mjs` (Luiz Carolino PDF)
  - `node tools/run-route-dwg-accuracy-gate.mjs` (Luiz Carolino DWG)
- **Extra validation routes built this thread (UNCOMMITTED, on disk):**
  - `tools/build-route-fixtures.mjs` — builds GT json + DWG region for joaoborn/valmor from
    Palhoca.dxf (loads DXF once; robust bbox drops GT outliers >3km — João Born GT post 35 is
    a typo at lat -27.97).
  - `parser/__tests__/fixtures/{joaoborn,valmor}-{ground-truth,dwg-region}.json`
  - Valmor = clean 11-post DWG route (mean 2.2m) — excellent tight extra gate. João Born =
    34 posts, mean 142m (noisy). Both drive the DWG walk (walkOk). Wire Valmor in as a gate
    for this fix if useful.

## Inspection one-liners (rebuild as needed)

```bash
# Current label-graph degree per post (junctions = deg>=3, tips = deg 1):
node -e "const t=require('./parser/__tests__/fixtures/siriu-topology.json');const deg=new Map();for(const d of t.distances){if(d.meters==null)continue;for(const[a,b]of[[d.from,d.to],[d.to,d.from]]){if(!deg.has(a))deg.set(a,new Set());deg.get(a).add(b)}}for(const[n,s]of[...deg].sort((x,y)=>x[0]-y[0]))console.log('post',n,'deg',s.size,[...s].sort((a,b)=>a-b))"

# Where a given label value is currently associated:
node -e "const t=require('./parser/__tests__/fixtures/siriu-topology.json');for(const d of t.distances)if(d.meters!=null&&Math.abs(d.meters-40.6)<0.25)console.log(d.from+'->'+d.to,d.source)"
```

Related memory: see `project_k1a_guard_generalization.md`.
