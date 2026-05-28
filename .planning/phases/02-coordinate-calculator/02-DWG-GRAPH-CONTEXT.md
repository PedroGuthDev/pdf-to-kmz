# Phase 2 Sub-Iteration: DWG-Graph-First Pairing — Context

**Gathered:** 2026-05-28
**Status:** Ready for planning
**Scope:** Replace the PDF-driven walk inside the DWG path with a DWG-graph-driven walk. The PDF becomes a *number/distance decoder* — never a topology source — when a regional DXF is loaded.

<domain>
## Phase Boundary

The DWG path produced by plans 02-08..02-13 pairs PDF posts to DXF INSERTs by walking the PDF's logical order (`connections[]`) and predicting each next post's UTM position from `dwg[i-1] + PDF bearing + PDF distance`. On long/branching routes (Siriu, ~85 posts) the PDF bearing/distance noise contaminates the prediction; recent tolerance relaxations triggered an `dwg-pair-collision` at poste 7 and aborted the whole pair-up.

This sub-iteration inverts the algorithm:

1. **Topology comes from the DXF cable graph** (`region.posts` as nodes, `region.cableEdges` as edges via `buildAdjacencyGraph` in `region-pairing.js`).
2. **The walk starts at poste 1** anchored by user GPS → nearest unclaimed INSERT (unchanged anchor logic, `DEFAULT_TOLERANCE_M=15`).
3. **Each hop N → N+1 is decided by the cable graph**, not by PDF prediction:
   - If `connection(N, N+1).gap == false`: walk to a cable-adjacent unclaimed neighbor; disambiguate junctions (deg > 2) by matching edge span vs `Distância_Poste` label.
   - If `connection(N, N+1).gap == true`: re-anchor by finding any unclaimed post that is cable-adjacent to a previously-visited junction node; tie-break by span(N+1, N+2) vs `Distância_Poste(N+1, N+2)`.
4. **PDF bearings are never used** in graph-walk mode. PDF distances are used only as span-matching weights.
5. The KMZ step downstream consumes `{ posts, connections }` unchanged — only the GPS source flips from "PDF-predicted INSERT" to "graph-walked INSERT".

This sub-iteration does NOT touch the PDF-only fallback path (Viterbi+N1+label-LSQ in `coordinate-calculator.js`). Valmor G-1 and current João Born baseline remain non-regression invariants.

</domain>

<decisions>
## Implementation Decisions

### Numbering convention (user-locked, 2026-05-28)

- **D-DWGG-NUM-01: Post numbers are strictly sequential, unique, no gaps in the number sequence.** 1..N covers every post in the project; no "11A" / "11B" suffixes; no skipped numbers.
- **D-DWGG-NUM-02: Two physical sequencing patterns coexist and must both be supported:**
  - **Case A (vai-volta):** spine 1-2-3, branch 4-5-6, spine resumes 7-8-9. Each hop N→N+1 is cable-adjacent. PDF marks `gap:false` on every edge.
  - **Case B (spine-then-jump):** spine 1-10, then poste 11 "volta lá atrás" to start a parallel-street branch. Hop 10→11 is NOT cable-adjacent. PDF marks `gap:true` on that edge.
- **D-DWGG-NUM-03: There is no global topological rule** like "numbers always follow the longest unbranched cable." The algorithm cannot use heuristics like "main spine first" — it must read each hop's `gap` flag from PDF connections to choose between adjacent-walk and jumpback modes.

### A1 — Junction disambiguation rule (deg > 2 with multiple unclaimed neighbors)

- **D-DWGG-JCT-01: Span match against `Distância_Poste` label is the sole disambiguator.** For each unclaimed cable-neighbor `c` of the current poste N, compute `span_m = hypot(c.x - N.x, c.y - N.y)` (DXF coords are UTM metres, so the result is metres directly). Compare to the PDF distance label for edge (N, N+1). Smallest `|span_m - label_m|` wins.
- **D-DWGG-JCT-02: PDF bearing is NOT used in this rule.** Bearing is the noisiest PDF signal for Siriu and the root cause of the current pairing collisions. Span match alone is preferred even when there are 3+ candidates.
- **D-DWGG-JCT-03: If no candidate's span matches within tolerance** (Claude's discretion at planning time — start `~15%` of label, floor `2 m`, ceiling `10 m`), the walk fails at N+1 and the run falls through to the next fallback (see D-DWGG-PIV-02).

### A2 — Jumpback handling (gap edges, Case B)

- **D-DWGG-JMP-01: When `connection(N, N+1).gap == true`, locate N+1 by junction re-entry, not by PDF prediction.**
  1. Compute the set `J = { i ∈ visited | adjacency.get(i).size > 2 }` — every visited node that is a junction in the cable graph.
  2. Compute the set `C = { p ∈ region.posts | p ∉ claimed AND ∃ j ∈ J : edge(j, p) in cableEdges }` — every unclaimed post that is cable-adjacent to at least one visited junction.
  3. **If `|C| == 1`:** that single candidate is N+1.
  4. **If `|C| > 1`:** tie-break by span(N+1, N+2) match — for each candidate `c`, simulate one hop forward using `Distância_Poste(N+1, N+2)` from PDF; the candidate whose cable-adjacent unclaimed neighbor produces the smallest `|span_m - label_m|` wins.
  5. **If `|C| == 0`:** jumpback fails; fall through to next fallback.
- **D-DWGG-JMP-02: PDF position, bearing, and distance(N, N+1) are NOT used in jumpback.** The distance label for a gap edge is meaningless (it crosses a logical jump, not a physical cable).
- **D-DWGG-JMP-03: The visited-junction set `J` is recomputed live as the walk progresses.** This means later jumpbacks have more candidate junctions and the algorithm degrades gracefully if early jumpbacks are tight.

### A3 — Code pivot strategy

- **D-DWGG-PIV-01: New module `parser/dwg/graph-walker.js` exports `pairPostsByGraphWalk(...)`.** Same input shape as `pairPostsAgainstRegion` for drop-in orchestration; returns the same `{ ok, coords }` / `{ ok: false, failedAt, nearestDistance }` shape so `coordinate-calculator-dwg.js` doesn't need a return-shape adapter.
- **D-DWGG-PIV-02: `coordinate-calculator-dwg.js` runs a three-level fallback cascade:**
  1. Try `pairPostsByGraphWalk` (DWG-graph-first, this sub-iteration).
  2. If that returns `{ ok: false }`, try `pairPostsAgainstRegion` (existing PDF-driven walk, unchanged).
  3. If that also fails, fall through to `calculateCoordinates` (PDF-only Viterbi+N1+label-LSQ pipeline, unchanged).
  Emit one warning per failed level so the UI can show the chosen path.
- **D-DWGG-PIV-03: `pairPostsAgainstRegion` is NOT modified.** Existing tests in `parser/__tests__/region-pairing.test.mjs` remain green. New tests live in `parser/__tests__/graph-walker.test.mjs`.
- **D-DWGG-PIV-04: No flag in user-facing UI.** The cascade is internal; the UI only surfaces the final path used (graph-walk | pdf-walk | pdf-only) in the same status line that today shows `DWG: paired` / `DWG: fallback`.

### A4 — Validation gate (done criteria)

- **D-DWGG-DONE-01: G-3 (Siriu) is the primary close-out gate.** All 85 posts in `siriu.dxf` must pair via graph-walk (no fallback to pdf-walk or pdf-only). Max error vs `coordenadas postes siriu.txt` ≤ ~2 m (DXF drafting precision ceiling).
- **D-DWGG-DONE-02: G-1 (Valmor 11/11 < 5 m) and current João Born baseline MUST NOT regress** on the PDF-only fallback path. Since this sub-iteration adds a new module and does not modify `coordinate-calculator.js`, regression is structurally improbable — but `node debug-run-calc.mjs` must run green at sub-iteration close.
- **D-DWGG-DONE-03: Luiz Carolino is NOT a gate for this sub-iteration.** No `luiz-carolino.dxf` exists yet. Adding it is deferred to a follow-up plan after Siriu closes.
- **D-DWGG-DONE-04: New debug harness `debug-run-calc-dwg-graph.mjs` is the canonical reproducer** for G-3. Should run end-to-end (DXF load → graph-walk → GPS error table) and print a single PASS/FAIL line.

### Claude's Discretion

- Span tolerance for D-DWGG-JCT-03 (start `max(2, 0.15 * label_m)`, ceiling `10 m` — tune on Siriu).
- Lookahead depth for D-DWGG-JMP-01 tie-break (start `1 hop`; only extend to 2-3 if Siriu produces ambiguous junctions).
- Whether to memoize `adjacency` and `junctionSet` across walks (yes if Siriu's 85-post walk shows measurable overhead; otherwise inline).
- Warning shape for failed cascade levels (suggest `{ kind: "dwg-graph-walk-fail", at_post, reason: 'no-candidate'|'ambiguous'|'tolerance-exceeded' }`).
- Where in `coordinate-calculator-dwg.js` to wire the cascade (suggest new helper `runDwgPairingCascade(...)` that returns the first successful level's result + a `dwg_path` string).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Prior context (governs the rest of Phase 02; this iteration sits on top)

- `.planning/phases/02-coordinate-calculator/02-CONTEXT.md` — N1+Viterbi PDF-only iteration; non-regression invariants (D-DONE-03).
- `.planning/phases/02-coordinate-calculator/02-DWG-CONTEXT.md` — Original DWG iteration context. This sub-iteration **supersedes D-DWG-PAIR-02** (PDF-topology walk) for the graph-walk level of the cascade. D-DWG-PAIR-01 (strict pairing), D-DWG-PAIR-03 (tolerance), D-DWG-PAIR-04 (branch handling — now via graph), D-DWG-PAIR-05 (gap handling — now via jumpback) are restated/refined here.
- `.planning/phases/02-coordinate-calculator/02-POSTS9-11-CONTEXT.md` — Concurrent PDF-only sub-iteration; out of scope here but lives in the same fallback path.
- `.planning/phases/02-coordinate-calculator/.continue-here.md` — Blocking anti-patterns. Note: "pure isotropic UTM replace" is **irrelevant** for graph-walk (UTM/viewport calibration is bypassed when DWG coords are authoritative).

### Existing DWG modules (graph-walk is built ALONGSIDE these)

- `parser/dwg/region-pairing.js` — Existing `pairPostsAgainstRegion` (PDF-driven walk). Reuses `buildPostIndex`, `buildAdjacencyGraph`, `PostIndex` exports for graph-walker. **Do NOT modify this file.**
  - `buildAdjacencyGraph(posts, cableEdges)` — already builds the Map<idx, Set<idx>> adjacency the graph-walker needs.
  - `ADJACENCY_SNAP_M = 3` — cable-edge-to-post snap tolerance; reuse as-is.
  - `DEFAULT_TOLERANCE_M = 15` — anchor (poste 1 GPS → INSERT) tolerance; reuse as-is.
- `parser/dwg/coordinate-calculator-dwg.js` — Orchestrator. Site of D-DWGG-PIV-02 cascade wiring.
- `parser/dwg/dxf-loader.js` — `loadDxfRegion` produces `region.posts[]` (each with `x, y, block`) and `region.cableEdges[]` (each with `a, b`). UTM-zone metadata in `region.crs.zone`.
- `parser/dwg/region-library.js` — IndexedDB cache; unchanged.
- `parser/geo/utm-calibrator.js` — `latLonToUtm`, `utmToLatLon` reused for anchor conversion and GPS output.

### Phase 01 contract (input to graph-walker)

- `parser/pdf-parser.js` — `parsePdf()` returns `{ posts, distances, connections, ... }`. Graph-walker consumes `posts[]` (for `number`), `distances[]` (for `Distância_Poste` label match in D-DWGG-JCT-01 / D-DWGG-JMP-01), `connections[]` (for `gap` flag and branch topology).
- `parser/coordinate-calculator.js` — Fallback level 3 in the cascade; unchanged.

### Tests

- `parser/__tests__/region-pairing.test.mjs` — Existing tests for pdf-walk. MUST remain green.
- `parser/__tests__/graph-walker.test.mjs` — **NEW.** Fixtures: a synthetic 7-post region (1-3 spine, 4-5 branch, 6-7 spine) exercising Case A; a synthetic 7-post region (1-5 spine, 6-7 jumpback) exercising Case B; a deg-3 junction with two viable spans where only span-match resolves ambiguity.
- `parser/__tests__/coordinate-calculator.test.mjs` — Existing 20/20; MUST remain green.

### Debug & validation harness

- `debug-run-calc.mjs` — PDF-only G-1/G-2 reference. Run unchanged after this sub-iteration.
- `debug-run-calc-dwg.mjs` (from 02-12) — DWG path harness. Re-purpose or branch into:
- `debug-run-calc-dwg-graph.mjs` (NEW per D-DWGG-DONE-04) — Loads `siriu.dxf`, runs `pairPostsByGraphWalk` only (no cascade fallback), prints PASS/FAIL on 85/85 + max-error ≤ 2 m.

### Ground truth data

- `siriu.dxf` — Reference regional DXF (already in repo root).
- `coordenadas postes siriu.txt` — Ground-truth GPS for 85 Siriu posts.
- `INFOVIAS_PJC INTERNET_..._SIRIU_v1.pdf` (or similar) — The PDF whose posts pair against `siriu.dxf`. Researcher should confirm the exact filename before planning.

### Project reference

- `.planning/PROJECT.md` — Client-side only.
- `.planning/REQUIREMENTS.md` — COORD-01..COORD-05. No new requirements.
- `.planning/ROADMAP.md` — Phase 02 scope unchanged; this is a mechanism iteration inside the existing DWG path (plans 02-08..02-13).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `buildAdjacencyGraph(posts, cableEdges)` in `region-pairing.js` — Already returns `Map<postIdx, Set<postIdx>>`. Graph-walker imports it directly; no duplication.
- `buildPostIndex` / `restorePostIndexFromDump` — Spatial index for anchor lookup; reused.
- `PostIndex` (RBush subclass) — Same.
- `latLonToUtm` / `utmToLatLon` from `parser/geo/utm-calibrator.js` — Anchor conversion + GPS output.
- The `claimed: Set<number>` pattern + `dwgByPostNumber: Map<number, post>` pattern from existing pairing — Same data structures; the graph-walker only changes how it picks `best` at each step.

### Established Patterns

- ESM, named exports only.
- Browser + Node parity. `dxf-parser` and `rbush` already chosen (Wave-1 install per 02-08).
- Mutable `warnings[]` accumulator threaded through.
- DXF coords ARE UTM metres (D-DWG-LOC-01 / R-DWG-01 verified) — span = euclidean distance.

### Integration Points

- `coordinate-calculator-dwg.js::calculateCoordinatesWithDwg` is the single touch-point — adds the 3-level cascade. No external API change; `pdf-parser.js`'s call site stays as-is.
- Phase 03 (KMZ) is downstream of `connections[]` (unchanged) and `posts[].lat/.lon` (now possibly graph-walk sourced) — no Phase 03 changes.

</code_context>

<specifics>
## Specific Ideas

- **Why span match works where bearing doesn't (Siriu evidence):** `Distância_Poste` labels are extracted from the PDF's `Distância_Poste` OCG layer with ~0.1 m precision; bearing in the PDF is inferred from page-rotated x,y positions and accumulates drafting + page-rotation + viewport errors. The DXF, by contrast, has true UTM coords for both endpoints — span(c.x, c.y, N.x, N.y) is exact in metres. Comparing two precise numbers beats comparing an exact metric with a derived angle.

- **Why "junction re-entry" works for jumpback:** In Case B (spine-then-jump), the branch physically attaches to the main spine at some junction node `j`. After walking the spine, `j` is in `visited` and its branch-side neighbor is unclaimed — so the candidate set `C` in D-DWGG-JMP-01 is small (often size 1). If the PDF correctly marks `gap:true` on the 10→11 connection, this is unambiguous.

- **Why we don't need `connections` for branch entry in Case A:** In the vai-volta pattern, at junction 3 the walk decides "branch first vs spine first" purely by the next number's distance label. If `Distância_Poste(3, 4) = 35 m` matches span(3, branch_neighbor) better than span(3, spine_neighbor), the walk enters the branch. The PDF `connections` ordering (which already lists 3→4 before 3→7) is a secondary hint, not the rule.

- **Risk: dense urban regions where multiple junctions have similar span pairs.** If two unclaimed cable-neighbors of N both have spans within tolerance of the same label, the tie is genuinely ambiguous. Mitigations in order: (a) tighten tolerance (D-DWGG-JCT-03), (b) lookahead one hop (D-DWGG-JMP-01 tie-break), (c) accept the closest-bearing-to-cable-direction-of-last-edge as final tiebreaker. (c) is a last-resort lever, not a default.

- **Why not require a 2nd GPS anchor for jumpback?** Discussed and rejected: regional DWG + sequential post numbering already provides enough constraint that 2nd anchor is overkill. Keep it deferred (Phase 04 UI enhancement) unless Siriu requires it.

</specifics>

<deferred>
## Deferred Ideas

- **Luiz Carolino DXF + G-4 validation.** Requires user to export `luiz-carolino.dxf` from AutoCAD. Defer to a follow-up plan once Siriu G-3 closes.
- **Multi-region DWG support.** Long routes spanning two regional DXFs. Already deferred in 02-DWG-CONTEXT; remains deferred.
- **Interactive disambiguation UI** when graph-walk hits a genuine junction tie. Belongs in Phase 04.
- **Second-anchor GPS input** for routes where jumpback is too ambiguous. Phase 04 UI enhancement.
- **Memoization of cable-edge span lookups** if `pairPostsByGraphWalk` shows measurable overhead on regions much larger than Siriu.
- **Auto-tune span tolerance** by sampling a few labelled spans against DXF edges and learning a per-region scaling factor. Premature optimization; tune by hand on Siriu first.
- **Cross-validation: when graph-walk and pdf-walk both succeed, compare their results** and warn on divergence > N metres. Useful for production telemetry but not for closing this iteration.

</deferred>

---

*Phase: 2-Coordinate Calculator (DWG-graph-first sub-iteration)*
*Context gathered: 2026-05-28*
*Supersedes D-DWG-PAIR-02 from 02-DWG-CONTEXT.md for the graph-walk cascade level only. 02-DWG-CONTEXT's pdf-walk algorithm remains active as level-2 fallback.*
