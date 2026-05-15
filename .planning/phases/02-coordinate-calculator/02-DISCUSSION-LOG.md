# Phase 2: Coordinate Calculator - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-15
**Phase:** 2-Coordinate Calculator
**Trigger:** Flaw discovered post-implementation — not all posts have cable distances; cross-page PDF coordinates are not comparable.
**Areas discussed:** Algorithm pivot, Scale factor source, No-distances fallback, Connections fields, Multi-page coordinate system, Cross-page strategy, UTM grid approach, Page 2 overview calibration, Cross-page post identification

---

## Algorithm Pivot

| Option | Description | Selected |
|--------|-------------|----------|
| All posts from post #1 | Every post projected directly from post #1 using PDF offset × scale. No error accumulation. | ✓ |
| Branch posts from junction | Main-route from post #1, branches from junction post. | |
| Let Claude decide | Claude picks. | |

**User's choice:** All from post #1 (Recommended)
**Notes:** User then identified that cross-page PDF coords are incomparable, which evolved this decision into the per-page UTM calibration approach (each page has its own anchor derived from the overview).

---

## Gap Detection

| Option | Description | Selected |
|--------|-------------|----------|
| Keep gap detection | Gap flag still needed for Phase 3 (where NOT to draw lines). | ✓ |
| Drop gap detection | Let Phase 3 infer from missing cables. | |

**User's choice:** Keep gap detection

---

## Connections Contract Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Preserve { from, to, meters, bearing, gap } | Phase 3 contract unchanged. | ✓ |
| Clean break | Change shape if algorithm makes better sense. | |

**User's choice:** Preserve contract shape

---

## Scale Factor Source

| Option | Description | Selected |
|--------|-------------|----------|
| Average of all available distances | sum(meters)/sum(pdfDist) over labelled pairs. | ✓ (initial) |
| Median per-pair ratios | More outlier-resistant. | |
| First valid pair only | Simplest, most fragile. | |

**Notes:** Superseded when UTM grid approach was chosen — scale now derived from 50m grid line spacing.

---

## No-Distances Fallback

**User's free-text response:** "all projects have distance labels"
**Notes:** Domain invariant — all real INFOVIAS PDFs have distance labels. Moot anyway given UTM-grid scale derivation.

---

## Connections Meters and Bearing

| Option | Description | Selected |
|--------|-------------|----------|
| PDF distance × scale factor | Same-page: hypot(next-curr) × scale. | ✓ |
| Use label if available, fallback | Two sources of truth. | |
| Haversine from GPS positions | Consistent but extra step. | |

**User's choice:** PDF distance × scale (same-page); GPS haversine (cross-page after calibration).
**Bearing:** PDF vector atan2(dx,dy) for same-page; GPS-vector bearing for cross-page.

---

## Multi-Page Coordinate System

**User's free-text response:** "all pages come from the autocad viewport, the viewport is always the same size in width and height, but how can we find posts on cross-pages?"

**Confirmed:** Detail pages have page-local coordinate systems. Cross-page x,y comparisons are meaningless. The original D-03 assumption ("unified drawing space") was incorrect.

---

## UTM Grid Discovery

**User's insight:** "we have a utm layer with this pattern: O Projeto Óptico foi geo referenciado em toda a rota utilizando tecnologia GPS considerando o DATUM SIRGAS Quadriculas a cada 50m na escala 1:1000"

**Layer name confirmed:** "UTM". Grid lines are visual only (no text labels in PDF).

| Option | Description | Selected |
|--------|-------------|----------|
| Full UTM-grid approach | Extract "UTM" layer, scale from 50m spacing, anchor each page from overview. | ✓ |
| Same-page direct + cross-page chain | Skip UTM extraction. | |
| Hardcoded 1:1000 scale | Hardcode scale. | |

**User's choice:** Full UTM-grid approach

---

## Page 2 Overview for Page Calibration

**User shared screenshot** (`Downloads/Screenshot_5.png`) showing:
- Page viewport boxes labeled 03, 04, 05 (overlapping staggered layout)
- Continuous UTM grid spanning all pages in the overview
- Red post markers following the route across all pages

| Option | Description | Selected |
|--------|-------------|----------|
| Use page 2 overview for calibration | Extract viewport boxes + UTM grid from page 2. All pages calibrated with no GPS chaining. | ✓ |
| Skip overview, use per-page chain | Per-page UTM + cable bearing per boundary. | |

**User's choice:** Use page 2 overview for page calibration

---

## Finding Post #1 on Page 2

**User's question:** "how will page 02 know what is the first post? since the ocr does not detect because of the quality of image, as a overview does not have much px"

**Decision:** Post #1 is never looked for on page 2 via OCR. It is identified on detail page 3 by Phase 1 parsing and mathematically projected from page-3 coordinates to page-2 overview coordinates using the viewport box geometry. The viewport labels ("03", "04", "05") are large PDF text elements readable via `getTextContent()` — no OCR needed on page 2.

---

## Deferred Ideas

- Support for anchoring on arbitrary posts (not just post #1)
- DMS coordinate format input
- Automatic UTM label extraction if future INFOVIAS versions add text labels to the UTM grid
- Using overlapping posts as additional cross-page calibration anchors
