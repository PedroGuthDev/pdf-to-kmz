# Phase 2: Coordinate Calculator - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-15
**Phase:** 02-coordinate-calculator
**Areas discussed:** Bearing from PDF coordinates, Route topology and traversal, Route gaps, First-post GPS input

---

## Bearing from PDF coordinates

### Q1: How should the user align PDF orientation to real-world north?

| Option | Description | Selected |
|--------|-------------|----------|
| Rotation angle | User provides a "north offset" angle | |
| Two-post anchor | User provides GPS for two posts, rotation derived automatically | |
| Assume PDF top = North | No user input needed | |

**User's choice:** User revealed that a "norte" layer exists in the PDF with a compass rose pointing geographic north. Follow-up question about whether the arrow is always straight up.

### Q2: Is the north arrow always pointing straight up?

| Option | Description | Selected |
|--------|-------------|----------|
| Always straight up | PDF-up = North in every file | ✓ |
| Varies per PDF | Arrow can be rotated per project | |
| Not sure | Uncertain | |

**User's choice:** Always straight up

### Q3: Are coordinate systems consistent across pages?

| Option | Description | Selected |
|--------|-------------|----------|
| Same coordinate system | All route pages share same viewport/scale | |
| Different viewports per page | Each page zooms differently | |
| Not sure | Need to inspect coordinates | |

**User's choice:** All zoomed pages (3-4+) share the same viewport. User provided a visual showing staggered page arrangement following the street.

### Q3b: What about page 2 vs pages 3-4?

| Option | Description | Selected |
|--------|-------------|----------|
| All route pages share same scale | Coordinates comparable across all | |
| Page 2 is different scale (overview) | Only pages 3-4 share coordinates | ✓ |
| Not sure | Need to check | |

**User's choice:** Page 2 must be ignored — numbers too small for reliable OCR and scale is different.

### Q3c: Are staggered pages a problem for bearing calculation?

**User's question (initiated by user):** Pages are positioned according to the street — is that going to be a problem?
**Answer:** No — since all detail pages share the same coordinate system, the staggered viewports are just "windows" into a unified drawing space. Bearings work correctly across pages.

### Q4: GPS projection formula

| Option | Description | Selected |
|--------|-------------|----------|
| Haversine projection | Standard spherical Earth, ~0.3% error | |
| Flat-Earth approximation | cos(lat) correction, negligible error at street scale | ✓ |
| You decide | Agent picks | |

**User's choice:** Flat-Earth with cos(lat)

---

## Route topology and traversal

### Q1: How does branching appear in real PDFs?

| Option | Description | Selected |
|--------|-------------|----------|
| Fork in post numbering | Branch continues from a junction post in different direction | |
| Separate numbering sequences | Main route 1-15, branch 16-22, starting from a junction | ✓ |
| Same numbering, cable geometry shows fork | Cable path splits, numbers are all sequential | |

**User's choice:** Separate numbering sequences

### Q2: How do we know which main-route post is the junction?

| Option | Description | Selected |
|--------|-------------|----------|
| Spatial proximity | First branch post is near a main-route post in PDF space | ✓ |
| Cable path geometry | Use cable segments to find shared endpoints | |
| Distance gap detection | Number gap + proximity confirms junction | |
| Combination | Number gap + spatial proximity together | |

**User's choice:** Spatial proximity

### Q3: How should GPS coordinates propagate on branches?

| Option | Description | Selected |
|--------|-------------|----------|
| Branch inherits junction GPS | Post 16 gets post 7's GPS, then chain continues | |
| Branch offset from junction | Post 16 offset from post 7 using actual PDF distance | |
| You decide | Agent picks | |

**User's clarification:** The project never numbers the same physical post with 2 numbers. Post 16 is a NEW post next to post 7, with a cable running from 7 to 16. So GPS = post 7 GPS + bearing(7→16) + distance(7→16).

### Q4: How should we detect where a new branch sequence starts?

| Option | Description | Selected |
|--------|-------------|----------|
| Number gap heuristic | Consecutive posts spatially far apart = branch start | ✓ |
| Distance label existence | Distance label between junction and first branch post | |
| You decide | Agent picks | |

**User's choice:** Number gap heuristic

---

## Route gaps

### Q1: What is a "route gap"?

| Option | Description | Selected |
|--------|-------------|----------|
| Missing post numbers | Sequence jumps (1-10, then 13-22) | |
| Physically disconnected segments | Cable stops, separate section starts elsewhere | |
| Same as branching | Gaps are just branches | |
| Other | Different from all options | ✓ |

**User's choice:** Cable stops at post 10, new cable starts at post 11 forward. No connection between the two polylines. Posts are still sequentially numbered.

### Q2: How should GPS coordinates be calculated across a gap?

| Option | Description | Selected |
|--------|-------------|----------|
| Use PDF positions only | Compute from positions + scale factor from labeled distances | ✓ |
| Skip the gap, no line in KMZ | Calculate normally, just don't draw connecting line | |

**User's choice:** Use PDF positions only

### Q3: Should the calculator flag gaps for downstream?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, mark gaps | Add `gap: true` flag for Phase 3 | ✓ |
| No, Phase 3 detects gaps itself | Phase 3 checks cable geometry | |
| You decide | Agent picks | |

**User's choice:** Yes, mark gaps

---

## First-post GPS input

### Q1: What coordinate format?

| Option | Description | Selected |
|--------|-------------|----------|
| Decimal degrees only | Simple `-27.6453, -48.6712` format | |
| Decimal degrees + DMS | Also accept degrees/minutes/seconds | |
| Decimal degrees + Google Maps paste | Smart parsing of Google Maps copy-paste format | ✓ |

**User's choice:** Decimal degrees with Google Maps paste support

### Q2: Which post does the user provide coordinates for?

| Option | Description | Selected |
|--------|-------------|----------|
| Always post #1 | First post in the sequence | ✓ |
| Any post the user chooses | User selects which post | |
| Always the lowest-numbered post | First post the parser found | |

**User's choice:** Always post #1

### Q3: Input validation?

| Option | Description | Selected |
|--------|-------------|----------|
| Basic range check | Valid lat/lon ranges only | |
| Brazil bounds check | Must fall within Brazil bounding box | ✓ |
| No validation | Trust the input | |

**User's choice:** Brazil bounds check

### Q4: Phase 2 output contract?

| Option | Description | Selected |
|--------|-------------|----------|
| Enrich existing posts | Add lat/lon + connections array to post objects | ✓ |
| Separate geo output | New geoData object alongside original parser output | |
| You decide | Agent picks | |

**User's choice:** Enrich existing posts

---

## Agent's Discretion

No areas deferred to agent discretion — all decisions were made by the user.

## Deferred Ideas

- Support for anchoring on any post (not just #1)
- DMS coordinate format input
- Automatic north-arrow rotation extraction from "norte" layer
- Visual map preview before KMZ generation (ENH-01)
