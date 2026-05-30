---
name: siriu-walk-progress
description: DWG graph-walker Siriu route fix progress — current state, commits, and next failure point
metadata:
  type: project
---

Walk target: all 85 Siriu posts under 5m GPS error via DWG graph-walk.

**Why:** Siriu PDF bearings are too noisy; replacing with cable-graph navigation eliminates dwg-pair-collision errors.

**How to apply:** When working on graph-walker or Siriu debugging, start from this state.

## Commits landed (2026-05-29)

| Commit | Fix | Result |
|--------|-----|--------|
| f4007cb | tap-placed node bypass — hint search can traverse tap INSERT as intermediate | post 25: 68m→1.1m |
| db42194 | N3 mirror confidence gate in post-positioning.js — OCR numbers preserved on multi-sheet routes | posts 28–33 restored from missing to 1–5m |
| a6749cb | 36-bifurcation cascade — 33→34 overshoot, 37→38 main-line overshoot, 38→39 phantom hint | posts 34–44: <14m |

## Current harness state

```
node debug-run-calc-dwg-from-pdf-siriu.mjs
```

- Posts 1–44: ✓ 1–13m
- Post 45: ✗ 67m — walk diverges at step 44→45 (fromIdx=74 → chosen=79, label=32.30)
- Posts 46–48: 173–215m
- Post 48→49: FAIL (unclaimedNeighbors=0 at idx=131)

## Next open debug session

`.planning/debug/siriu-post45-cascade.md` — fix 44→45 divergence and continue to walk completion.

## Non-regression baselines

- Valmor: 9/11 < 5m (was 11/11 before some tuning — check)
- João Born: ≥22/34 < 5m
- Tests: graph-walker 4/4, coordinate-calculator 22/22, distance-associator 11/11, region-pairing 9/9
