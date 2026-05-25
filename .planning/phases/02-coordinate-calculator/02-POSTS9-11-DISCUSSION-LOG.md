# Phase 2 Iteration: Posts 9-11 Under 10m — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in 02-POSTS9-11-CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-25
**Phase:** 2-Coordinate Calculator (iteration: posts 9-11 under 10m)
**Areas discussed:** Target scope, Page-3 refit silent failure, Post-9 strategy

---

## Target scope — hard vs best-effort

| Option | Description | Selected |
|--------|-------------|----------|
| Hard requirement — all three < 10m | Post 9 must reach under 10m. Requires local correction beyond global similarity transform. | ✓ |
| Best-effort — posts 10-11 must, post 9 try | Posts 10-11 priority; post 9 at 12-13m acceptable. | |
| Practical — ≤ 10% of inter-post spacing | Meaningful improvement is sufficient; exact threshold less important. | |

**User's choice:** Hard requirement — all three < 10m

| Option | Description | Selected |
|--------|-------------|----------|
| Field crew navigation | Technicians use KMZ to locate posts in field — 10m is max acceptable locating error. | ✓ |
| GIS import / cadastral match | 10m corresponds to a grid tolerance or parcel accuracy requirement. | |
| Google Earth visual inspection | Posts should appear within one building width (~10m) of true location. | |
| Other PDF has tighter distortion | Newer PDFs have less drawing distortion; 10m realistic for those. | |

**User's choice:** Field crew navigation

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — I can take a GPS reading on-site | User can provide mid-page GPS anchor from field measurement. | |
| No — algorithm must work without field data | PDF + post 1 GPS only; no additional anchors. | ✓ |
| Maybe — only if algorithm approach fails | Prefer software-only, fall back to second anchor if needed. | |

**User's choice:** No — algorithm must work without field data

**Notes:** All three posts (9, 10, 11) under 10m is a hard requirement driven by field crew navigation needs. The algorithm must achieve this from PDF alone with only post 1 GPS as external input.

---

## Page-3 refit silent failure

| Option | Description | Selected |
|--------|-------------|----------|
| Diagnose + fix it — primary first step | Add instrumentation to identify which silent guard is failing, then fix. | ✓ |
| I know why — it's the 14→15 label missing | Cross-page distance label for 14→15 seam is absent or not passed correctly. | |
| Skip it — go straight to local correction | Even if refit worked, post 9 stays ~12m; focus on local correction. | |

**User's choice:** Diagnose + fix it — primary first step

| Option | Description | Selected |
|--------|-------------|----------|
| Label-chain backward from post 14 | Walk backward from post 14 GPS using per-segment labels. Lower complexity. | |
| Split-region calibration for page 3 | Separate similarity transforms for two sub-regions. Addresses root cause. | ✓ |
| Extend the 2-point refit to 3 points | Use post 1 + post 14 + estimated mid-page post for 3-point fit. | |

**User's choice:** Split-region calibration for page 3

**Notes:** The refit fix is prerequisite to split-region. After the refit is working, posts 10-11 should reach ~8m (Procrustes floors) and post 9 drops to ~12m. Split-region then breaks post 9 through the Procrustes floor.

---

## Post-9 strategy (beyond 12.34m floor)

| Option | Description | Selected |
|--------|-------------|----------|
| Residual-driven — find the post where fitting error spikes | After global refit, compute per-post error; find where error jumps > 2× neighbor. Adaptive across PDFs. | ✓ |
| Fixed boundary — always split at midpoint of anchor page | Split at post 7 of 14. Simple but might not align with actual distortion boundary. | |
| Label-residual — where Distância_Poste label vs UTM chord diverges | Split where label-to-chord residual spikes. Uses PDF's own measurements. | |

**User's choice:** Residual-driven — find the post where fitting error spikes

| Option | Description | Selected |
|--------|-------------|----------|
| Label-chain forward from post 1 to estimate mid-page anchor | Walk forward from post 1 GPS using labels along corrected bearing to estimate split-point GPS. | ✓ |
| Label-chain backward from post 14 to estimate mid-page anchor | Walk backward from post 14's downstream-estimated GPS using labels. More accurate since post 14 is validated. | |

**User's choice:** Label-chain forward from post 1 to estimate mid-page anchor

| Option | Description | Selected |
|--------|-------------|----------|
| Only when global refit fails to reduce max error below threshold (e.g., 10m) | Split-region fires only when global refit leaves max error above 10m on anchor page. | ✓ |
| Only when label-distance residual spike detected | Fires only when any pair has residual > 2× median. | |
| Always try split-region, revert if RMSE worsens | Always run split-region; revert if per-region RMSE is worse than global refit. | |

**User's choice:** Only when global refit fails to reduce max error below threshold

| Option | Description | Selected |
|--------|-------------|----------|
| Label-distance RMSE on anchor page after global refit | Compute |UTM_chord - label_meters| for all consecutive pairs on anchor page. Fire if RMSE > ~5m. | |
| Forward-chain vs projection disagreement at midpoint | Walk forward from post 1 and compare to projection at midpoint; if disagreement > threshold, fire. | ✓ |
| You decide — use whatever proxy works on Valmor + João Born | Claude picks proxy that fires on João Born and not Valmor. | |

**User's choice:** Forward-chain vs projection disagreement at midpoint

**Notes:** The activation condition must be robust enough not to fire on well-calibrated PDFs like Valmor. The forward-chain vs projection midpoint disagreement is a self-contained check that doesn't require external GPS reference.

---

## Claude's Discretion

- Exact threshold for midpoint disagreement (starting value: 8m — tune empirically)
- Break-post K detection: ensure minimum 3 posts per region; shift K ±1 if needed
- Use `labelDistanceRmse` (already exported) for the RMSE safety guard

## Deferred Ideas

- **Label-chain backward from post 14** — evaluated and rejected in favor of split-region. Simpler but less accurate due to bearing accumulation. Defer unless split-region cannot be made to work.
- **3-point refit** — post 1 + post 7 (estimated) + post 14 for `refineAnchorPageByDownstreamChord`. Evaluated but rejected in favor of split-region which addresses the distortion more directly.
- **Per-post GPS anchors** — user-provided GPS for multiple posts. Deferred to Phase 4 UI or future iteration.
