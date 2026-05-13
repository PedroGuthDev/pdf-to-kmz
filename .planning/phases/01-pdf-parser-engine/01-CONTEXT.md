# Phase 1: PDF Parser Engine - Context

**Gathered:** 2026-05-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the core PDF parsing engine that extracts post data (sequential numbers, positions, distances) and cable polyline geometry from INFOVIAS-format PDFs in the browser. The parser uses PDF layer (OCG) filtering to reliably identify data elements.

**Key insight from discussion:** The PDF uses named layers (Optional Content Groups). This fundamentally changes the parsing approach from "pattern-match all text" to "filter by layer, then extract." This is more reliable and eliminates most text-grouping pitfalls from prior research.

</domain>

<decisions>
## Implementation Decisions

### Data Scope (D-01 through D-06)
- **D-01:** Posts are identified by **red circles** on the `Numero_Poste` layer paired with sequential numbers (01, 02, 03...) on the `TEXTO` layer. Association by spatial proximity.
- **D-02:** The 5-digit utility pole IDs (21169, 21170...) are **NOT relevant** — only the sequential numbering matters.
- **D-03:** Distances between posts come from the `Distância_Poste` layer.
- **D-04:** Cable route geometry (polyline) comes from the `Cabo Projetado` layer (exact name with space). This polyline must be extracted as graphic path data, not text.
- **D-05:** Street names and text encoding (ç, ã, é) are **irrelevant** — parser only needs numeric data and geometry. Encoding issues are eliminated.
- **D-06:** PDF layers are the primary data filtering mechanism. The parser must support OCG (Optional Content Group) extraction.

### PDF Layer Map
| Layer Name | Content | Data Type |
|---|---|---|
| `Numero_Poste` | Red circles marking posts | Graphic (circle shapes) |
| `TEXTO` | Post sequential numbers (01, 02...) | Text |
| `Distância_Poste` | Distances between posts | Text |
| `Cabo Projetado` | Cable route polyline | Graphic (polyline/path) |

### Failure Handling (D-07 through D-09)
- **D-07:** When an element can't be parsed (e.g., circle without nearby number), **skip it and accumulate a warning**. Show all warnings at the end. Do NOT stop processing.
- **D-08:** If expected layer names are not found, **list all available layers** in the PDF and ask the user to manually map which layer corresponds to which data type. Do NOT fall back to unfiltered text extraction.
- **D-09:** Process **all pages** of the PDF — do not hardcode page ranges. Projects vary from 1 page to many pages. Pages without relevant layer elements are silently ignored.

### Distance-to-Post Association (D-10 through D-13)
- **D-10:** Use **hybrid approach**: sequential numbering defines post pairs (01↔02, 02↔03...) and the cable polyline validates/confirms the route between them.
- **D-11:** Numbering is **continuous without reset** across branches. Example: main route postes 6-11, branch continues from 12 onward.
- **D-12:** Branch points are detected by **geometric splitting of the cable polyline**. Where the polyline forks into two paths = bifurcation.
- **D-13:** Posts may **repeat across pages** (same post at page boundaries). Deduplicate by sequential number.

### Output and Validation (D-14 through D-17)
- **D-14:** After parsing, show a **simple summary**: counts of posts found, distances found, cable segments found.
- **D-15:** **Continuous flow** — no confirmation gate. The coordinate input form becomes available immediately after parsing completes.
- **D-16:** Output data structure is **rich**: post number + PDF position + connection graph (supports branches) + cable polyline geometry segments between each post pair. This enables curved lines in the KMZ matching the actual cable path.
- **D-17:** The parser must extract **graphic operators** from pdf.js (`page.getOperatorList()`) in addition to text content (`page.getTextContent()`), since two layers contain graphic elements (circles and polylines).

### Agent's Discretion
- **D-18:** Coordinate normalization strategy (raw PDF points vs. relative 0-1 per page) is left to the planner's judgment.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Definition
- `.planning/PROJECT.md` — Project scope, constraints (client-side only), and key decisions
- `.planning/REQUIREMENTS.md` — PDF-01 through PDF-05 requirements for this phase

### Research Findings
- `.planning/research/ARCHITECTURE.md` — Component architecture and data flow (NOTE: partially superseded by layer-based approach from this discussion)
- `.planning/research/PITFALLS.md` — Critical pitfalls (#1 text grouping, #2 Y-axis inversion, #3 distance association, #4 multi-page continuity). Many are mitigated by layer filtering, but Y-axis inversion and multi-page handling still apply.
- `.planning/research/STACK.md` — pdf.js API details (`getTextContent()`, `getOperatorList()`, transform matrix)
- `.planning/research/SUMMARY.md` — Stack decisions and risk assessment

### Existing Code
- `extract_pdf.js` — Node.js prototype using pdf2json. Shows basic text extraction pattern but uses wrong library for browser. Reference for understanding PDF structure only.
- `package.json` — Current dependencies (pdf-parse, pdf2json, pdfjs-dist). Only pdfjs-dist is relevant for browser use.

### Sample Data
- `INFOVIAS_PJC INTERNET_Palhoça_RUA VALMOR FRANCISCO_v1.pdf` — Real sample PDF for testing. Contains the layer structure described in decisions.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `extract_pdf.js`: Prototype Node.js script. Shows `safeDecode()` function and basic text iteration pattern. Not directly reusable (wrong library, Node.js-only) but demonstrates the data structure.

### Established Patterns
- pdf.js API: `page.getTextContent()` returns `items[]` with `str` and `transform[4,5]` (x,y). This is confirmed in STACK.md research.
- pdf.js API: `page.getOperatorList()` returns drawing operators — needed for extracting circles (Numero_Poste) and polylines (Cabo Projetado).

### Integration Points
- Parser output feeds directly into Phase 2 (Coordinate Calculator) — rich data structure with topology graph and polyline geometry
- Parser runs in-browser using pdf.js loaded via CDN — no build step

</code_context>

<specifics>
## Specific Ideas

- The cable polyline from `Cabo Projetado` should be preserved with enough fidelity to reproduce the actual cable path in the KMZ (curved lines following streets, not just straight post-to-post lines)
- Layer name matching should be exact (including the space in "Cabo Projetado") but the manual mapping fallback handles variations

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 1-PDF Parser Engine*
*Context gathered: 2026-05-12*
