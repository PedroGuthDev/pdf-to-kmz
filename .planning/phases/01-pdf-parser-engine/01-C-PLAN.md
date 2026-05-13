---
phase: 1
plan_id: 01-C
title: "Data Association & Topology Graph"
wave: 2
depends_on:
  - 01-A
  - 01-B
files_modified:
  - src/data-associator.js
  - src/parser-engine.js
  - index.html
autonomous: true
requirements:
  - PDF-01
  - PDF-02
  - PDF-03
  - PDF-04
must_haves:
  truths:
    - "Post = circle (Numero_Poste) + nearest sequential number (TEXTO) by spatial proximity (D-01)"
    - "Hybrid distance association: sequential numbering defines pairs, polyline validates route (D-10)"
    - "Continuous numbering without reset across branches (D-11)"
    - "Branch points detected by geometric splitting of cable polyline (D-12)"
    - "Deduplicate posts across pages by sequential number (D-13)"
    - "Output: rich structure with post number + PDF position + connection graph + polyline segments (D-16)"
    - "Simple summary shown after parsing: counts of posts, distances, cable segments (D-14)"
    - "Continuous flow — no confirmation gate after parsing (D-15)"
    - "Skip unparseable elements with accumulated warnings (D-07)"
---

# Plan 01-C: Data Association & Topology Graph

<objective>
Associate extracted data elements (post numbers with circle positions, distances with post pairs, polyline segments with routes), build the connection topology graph supporting branches, deduplicate across pages, and produce the rich output data structure. Display a parsing summary and accumulated warnings.
</objective>

## Tasks

<task id="C1">
<title>Implement post-circle spatial association</title>
<read_first>
- src/text-extractor.js (parsePostNumbers output)
- src/graphic-extractor.js (extractCircles output)
- .planning/phases/01-pdf-parser-engine/01-CONTEXT.md (D-01: association by spatial proximity)
</read_first>
<action>
Create `src/data-associator.js` as ES module:
- Export function `associatePostsWithCircles(postNumbers, circles)` that:
  1. For each circle center, finds the nearest post number by Euclidean distance
  2. Threshold: maximum association distance of 50 PDF points (configurable constant `MAX_ASSOCIATION_DISTANCE`)
  3. If no post number within threshold → add warning "Circle at (x,y) has no nearby post number" and skip (D-07)
  4. If post number already associated with another circle → add warning "Post N has multiple circles" and use the closest
  5. Returns array of `{ postNumber: int, x: float, y: float, circleRadius: float }` where x,y is the circle center position
- Export function `associateDistancesWithPairs(distances, posts)` that:
  1. Uses sequential numbering to define pairs: post N ↔ post N+1 (D-10)
  2. For each distance value, finds the pair whose midpoint is nearest to the distance label position
  3. Validates: each sequential pair should have exactly one distance
  4. Returns array of `{ fromPost: int, toPost: int, distance: float, labelPosition: {x, y} }`
  5. Warns if a pair has no distance or multiple distances (D-07)
</action>
<acceptance_criteria>
- src/data-associator.js exports `associatePostsWithCircles` and `associateDistancesWithPairs`
- Posts are associated with circles by nearest Euclidean distance within MAX_ASSOCIATION_DISTANCE
- Sequential pairs (01↔02, 02↔03) are used for distance association (D-10)
- Unassociated circles and missing distances generate warnings, not errors
- Each post in the output has a position derived from its circle center
</acceptance_criteria>
</task>

<task id="C2">
<title>Implement polyline-to-route association and branch detection</title>
<read_first>
- src/graphic-extractor.js (extractPolylines output)
- src/data-associator.js (associated posts from C1)
- .planning/phases/01-pdf-parser-engine/01-CONTEXT.md (D-10: polyline validates route, D-12: branch detection by polyline fork)
</read_first>
<action>
Add to `src/data-associator.js`:
- Export function `associatePolylinesWithRoute(polylineSegments, posts)` that:
  1. For each polyline segment, finds the two nearest posts (start and end of segment)
  2. Associates polyline geometry with the post pair it connects
  3. Returns array of `{ fromPost: int, toPost: int, polylinePoints: [{x,y}...] }`
- Export function `detectBranches(polylineSegments)` that:
  1. Finds points where a polyline forks into two paths (D-12)
  2. A fork = a point that is the endpoint of one segment and the startpoint of two or more segments
  3. Returns array of `{ forkPoint: {x,y}, branchSegmentIndices: [int...] }`
- Export function `buildTopologyGraph(posts, distances, polylineAssociations, branches)` that:
  1. Creates adjacency list: each post → list of connected posts with distance and polyline
  2. Marks branch points in the graph
  3. Numbering is continuous without reset across branches (D-11)
  4. Returns `{ nodes: Map<postNumber, {x, y}>, edges: [{from, to, distance, polyline}], branchPoints: [postNumber...] }`
</action>
<acceptance_criteria>
- `associatePolylinesWithRoute` maps polyline geometry to post pairs
- `detectBranches` identifies fork points where polyline splits into 2+ paths
- `buildTopologyGraph` produces an adjacency list graph structure
- Branch numbering continues sequentially (e.g., main 6-11, branch 12+) without reset (D-11)
- Graph edges include both distance and polyline geometry for each connection
</acceptance_criteria>
</task>

<task id="C3">
<title>Implement multi-page processing with deduplication</title>
<read_first>
- src/pdf-loader.js (getAllPages)
- src/text-extractor.js (per-page extraction)
- src/graphic-extractor.js (per-page extraction)
- src/data-associator.js (association functions from C1, C2)
- .planning/phases/01-pdf-parser-engine/01-CONTEXT.md (D-09: all pages, D-13: deduplicate by sequential number)
- .planning/research/PITFALLS.md (Pitfall #4: multi-page continuity)
</read_first>
<action>
Create `src/parser-engine.js` as ES module — the orchestrator:
- Export async function `parsePdf(pdfDoc, layerMapping)` that:
  1. Gets all pages via `getAllPages(pdfDoc)`
  2. For each page: extracts text by layer, extracts graphics by layer, normalizes coordinates
  3. Merges results across all pages
  4. Deduplicates posts by sequential number (D-13): if same number appears on multiple pages, keep the first occurrence
  5. Runs association: posts↔circles, distances↔pairs, polylines↔route
  6. Detects branches
  7. Builds topology graph
  8. Collects all warnings from all extractors and associators
  9. Returns the rich output structure (D-16):
     ```
     {
       posts: [{ number, x, y, circleRadius }],
       distances: [{ fromPost, toPost, distance }],
       topology: { nodes, edges, branchPoints },
       polylineSegments: [{ fromPost, toPost, points }],
       warnings: [{ type, message, page }],
       summary: { postCount, distanceCount, segmentCount, branchCount, warningCount }
     }
     ```
  10. Pages without relevant layer elements are silently ignored (D-09)
</action>
<acceptance_criteria>
- src/parser-engine.js exports `parsePdf` as the single entry point
- All pages from 1 to numPages are processed (D-09)
- Posts with same sequential number across pages are deduplicated (D-13)
- Output contains posts, distances, topology graph, polyline segments, and warnings
- Summary object has counts: postCount, distanceCount, segmentCount, branchCount, warningCount
- Pages without relevant data are silently skipped without warnings
</acceptance_criteria>
</task>

<task id="C4">
<title>Wire up end-to-end flow and display parsing summary</title>
<read_first>
- index.html (HTML shell from A1)
- src/pdf-loader.js (load + layer discovery)
- src/parser-engine.js (parsePdf from C3)
- .planning/phases/01-pdf-parser-engine/01-CONTEXT.md (D-14: simple summary, D-15: continuous flow)
</read_first>
<action>
Update `src/pdf-loader.js` to wire the complete flow:
1. File input change → loadPdf → discoverLayers → (optional mapping UI) → parsePdf
2. After parsePdf returns, display summary in #parse-summary div:
   - "Posts found: N"
   - "Distances found: N"  
   - "Cable segments: N"
   - "Branch points: N"
   - If warnings > 0: "Warnings: N" with expandable list showing each warning
3. Store the parsed result on window (or module-level) for Phase 2 to consume
4. No confirmation gate — result is immediately available (D-15)
5. Update #status div with progress: "Parsing page N of M..."

Update `index.html`:
- Add minimal CSS for the summary display and warning list
- Style the layer mapping UI dropdowns
</action>
<acceptance_criteria>
- Uploading a PDF triggers the full pipeline: load → layers → parse → summary
- #parse-summary shows post count, distance count, segment count, branch count
- Warnings are shown if any exist, with expandable detail
- #status shows progress during parsing ("Parsing page 1 of 8...")
- No confirmation button between parsing and result display (D-15)
- Parsed result is accessible for downstream consumption (Phase 2 integration point)
</acceptance_criteria>
</task>

## Verification

```
Open index.html → upload INFOVIAS sample PDF → observe page-by-page progress in status → summary appears showing post count > 0, distance count > 0, segment count > 0 → if any warnings, they are listed below summary → parsed data structure is accessible in console via window.parsedResult or equivalent
```
