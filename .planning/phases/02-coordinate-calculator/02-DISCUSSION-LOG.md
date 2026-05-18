# Phase 2: Coordinate Calculator - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-18
**Phase:** 02-coordinate-calculator
**Areas discussed:** Source of post (x,y), Per-page Y calibration, Multi-anchor input, Distance labels, Implementation location

**Context for this revision:** Phase 02 plans are all complete but coordinate accuracy is 12–68 m per post (max 68 m at post 06). User requires most posts within 5 m. Per-segment bearing/scale diagnostics showed the dominant error source is parser-reported post `(x, y)`, not the transform math. This discussion captures the accuracy-fix decisions (D-ACC-01 through D-ACC-09 in CONTEXT.md).

---

## Source of post (x, y)

| Option | Description | Selected |
|--------|-------------|----------|
| Cable polyline vertices | Use Cabo_Projetado polyline vertices as canonical post positions; OCR only used to identify which post number is which. | ✓ |
| Harder snap to Poste symbol | Keep OCR pipeline, tighten snap-to-Poste-symbol logic. | |
| Hybrid: polyline + Poste snap | Polyline as primary, Poste as cross-check, warn on disagreement. | |
| Keep current, fix other things first | Don't touch (x,y) source. | |

**User's choice:** Cable polyline vertices.
**Notes:** Diagnostic data presented before the question: page 3 per-segment bearing offsets up to 30°, scale variance 0.12–0.50 m/pt within the same page — proving the post positions, not the transform, are the dominant error source. Label circles in `Numero_Poste` are drafted for readability, not at the pole; cable polyline physically passes through every pole, so its vertices are the true positions.

---

## Vertex-to-post matching method

| Option | Description | Selected |
|--------|-------------|----------|
| Proximity to existing OCR position | OCR identifies number + rough position; snap each post to nearest cable vertex within threshold (e.g. 30 pt), independent per-post. | ✓ |
| Walk the polyline in order | Walk from endpoint nearest post 01, assign 02, 03, … to consecutive vertices. | |
| Constrained sequence match (Hungarian) | Optimal assignment minimising total squared distance. | |

**User's choice:** Proximity to OCR position, with a safety follow-up question about branch scenarios.
**Notes:** User asked specifically: "at a bifurcation lets say page 4-5 goes one direction and then page 6 starts back at the end of page 3, is that already guarded?" — Confirmed yes: per-post proximity snap is inherently branch-safe (each post identified independently by OCR; no chain-walking). Added explicit one-to-one greedy guard (D-ACC-03) so two posts cannot snap to the same vertex at a junction. Existing `cable-builder.js:detectBranches` and `coordinate-calculator.js:detectRouteTopology` cover the topology side.

---

## Per-page Y calibration

| Option | Description | Selected |
|--------|-------------|----------|
| Drop hybrid → per-page UTM grid isotropic | Single per-page scale (X = Y) from each detail page's own UTM grid spacing. Mathematically right once positions are accurate. | ✓ |
| Keep hybrid (X = UTM, Y = viewport ratio) | Today's setup; locks in a workaround for parser noise. | |
| Full per-page affine from UTM grid orientation | Use rotation of UTM grid lines too. | |
| Decide later — retest after vertex snap | Land polyline-vertex first, pick Y after empirical results. | |

**User's choice:** Drop hybrid — use per-page UTM grid isotropic (recommended once D-ACC-01 lands).
**Notes:** The hybrid model (X from UTM, Y from viewport ratio) was empirically the best fit for OCR-circle position noise (~23 m avg vs ~33 m isotropic). Once vertex-snap removes the position noise, the simpler isotropic model should be correct. `.continue-here.md` flagged isotropic as a blocking anti-pattern when applied to OCR positions; D-ACC-06 explicitly notes the ban applied to the old parser positions and is lifted with D-ACC-01 in place.

---

## Multi-anchor input

| Option | Description | Selected |
|--------|-------------|----------|
| Keep single anchor + validation warning | Stay with post 01 only; warn on implausible outputs. | |
| Optional 2nd anchor (post 01 + last post) | User can paste GPS for both ends; solve global 2D affine. Falls back to single-anchor if 2nd absent. | ✓ |
| Per-page anchors (advanced) | One anchor per detail page — guaranteed <1m but heavy UX. | |
| Defer entirely | Ship vertex-snap + isotropic first, evaluate after. | |

**User's choice:** Optional 2nd anchor (post 01 + last post).
**Notes:** Defensive choice — gives a safety net if vertex-snap + isotropic don't hit <5 m on the worst posts. Per-page anchors remain deferred. UX: same Google Maps paste format as post 01; field is optional/secondary.

---

## Distance labels (Distância_Poste)

| Option | Description | Selected |
|--------|-------------|----------|
| Sanity-check / warning only | Compare haversine(curr,next) to label_meters; warn if delta > 5 m OR > 10%. Don't change the math. | ✓ |
| Use as scale calibration input | Median (label / pdf_segment_length) per page = page scale. | |
| Per-segment override | Use label meters directly for labeled segments. | |
| Ignore them for now | Pass through to Phase 3 only. | |

**User's choice:** Sanity-check / warning only.
**Notes:** Avoids overfitting to rounded labels like "40m". Labels still pass through to the `connections` array for Phase 3 to use or display.

---

## Where the vertex-snap step lives

| Option | Description | Selected |
|--------|-------------|----------|
| Inside `calculateCoordinates()` in Phase 02 | `snapPostsToPolyline()` pre-step at top of `coordinate-calculator.js`. Phase 1 contract unchanged. | ✓ |
| In `parser/post-assembler.js` as a new Phase 1 step | Posts come out of `parsePdf()` already corrected; changes Phase 1 contract. | |
| New module `parser/geo/polyline-snap.js` | Standalone, callable from either pipeline. | |

**User's choice:** Inside `calculateCoordinates()` in Phase 02.
**Notes:** Keeps the accuracy fix scoped to Phase 02 (this phase). Phase 1 is closed and its output contract stays stable.

---

## Claude's Discretion

- Snap threshold value (starting suggestion: 30 PDF pt). Tune empirically against `debug-run-calc.mjs`.
- Exact assignment algorithm — greedy-by-globally-shortest-edge is sufficient at expected vertex counts (≤ ~50 posts per page); Hungarian only if greedy proves unstable.
- Closed-form vs least-squares affine solver when 2 anchors are given — closed-form (translation + uniform scale + rotation) is fine first; full affine with per-axis scale only if isotropic doesn't hit <5 m.
- UI placement / styling of the optional 2nd anchor input — defer to Phase 04 conventions if any exist by then.

## Deferred Ideas

- Per-page GPS anchors (one per detail page) — guaranteed <1 m precision but heavy UX. Reconsider only if D-ACC-01 + D-ACC-06 + D-ACC-07 don't reach <5 m on most posts.
- DMS coordinate format input.
- Automatic UTM label extraction (future INFOVIAS variant).
- Visual map preview before KMZ generation (ENH-01).
- Using overlapping cross-page posts as extra calibration anchors.
- Full affine solver with per-axis scale (only if isotropic + 2 anchors falls short).
