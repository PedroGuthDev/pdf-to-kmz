---
status: superseded-for-57-85 — see siriu-spine-57-branch-region.md
trigger: DWG graph-walk errors spike at post 45 (67m) and fail at post 48→49 (no-candidate)
created: 2026-05-29
updated: 2026-05-29
priority_angle: posts 45–55 fixed; posts 57–64 spine fixed in walker; harness still pdf-fallback at 43
related_sessions:
  - .planning/debug/siriu-spine-57-branch-region.md
---

# Siriu post-45 cascade (historical + pointer)

**Current handoff for posts 57–85:** [.planning/debug/siriu-spine-57-branch-region.md](./siriu-spine-57-branch-region.md)

---

## RESOLUTION — posts 45–55 (2026-05-29)

### Post 45 phantom hint (b4e357f)

`hasDirectConsecutiveMatch` suppresses broad hint-jumpback when a direct cable neighbor matches the consecutive label. Post 45: **67 m → 6.66 m**.

### Branch return + post 48 bifurcation (d51d1a9)

- Option A branch-return at post 36 junction → resume at post 45 terminal.
- Junction-swapped labels at post 48; `swappedTapStep` for 49→50.
- Posts 45–55: **< 8 m** in standalone walk.

### Spine 57–64 (23334cd)

See **siriu-spine-57-branch-region.md**. Walker places 57–64 correctly when walk completes; harness still uses PDF coords for 57+ because cascade fails earlier at post 43 with GPS enabled.

---

## Session context (original post-45 investigation)

This picks up from the session that fixed posts 1–44 (commits f4007cb, db42194, a6749cb).

### Walk trace BEFORE post-45 fix

```
44->45  fromIdx=74  -> chosen=79   ← WRONG (should be idx 76)
```

### Walk trace AFTER post-45 + branch-return

```
44->45  fromIdx=74  -> chosen=76   ← FIXED
```

Branch return and 48-bifurcation fixes documented in commit d51d1a9.

---

## Constraints

- Do NOT modify parser/dwg/region-pairing.js or parser/coordinate-calculator.js (frozen)
- Fixes go in parser/dwg/graph-walker.js (preferred)
- All tests must stay green: graph-walker (4/4), coordinate-calculator (22/22), distance-associator (11/11)
- Valmor 11/11 <5m and João Born ≥22/34 <5m must not regress

## Key files

- parser/dwg/graph-walker.js — primary fix target
- debug-run-calc-dwg-from-pdf-siriu.mjs — E2E harness (PDF fallback ≠ walker errors)
- debug-claimed-at-58.mjs — standalone DWG walker vs GT (posts 55–65)
- coordenadas postes siriu.txt — ground truth
- .planning/debug/siriu-spine-57-branch-region.md — **current state**
- .planning/debug/siriu-post34-cascade.md — posts 34–44
