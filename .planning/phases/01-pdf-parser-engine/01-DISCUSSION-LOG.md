# Phase 1: PDF Parser Engine — Discussion Log (2026-05-14 rewrite session)

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

## Summary

This session ran a live inspector (`inspect-route-markers.mjs --all`) and a full `getTextContent` dump on the real PDF. Root cause identified: sequential numbers inside circles are vector paths, not text. The entire prior text-inside-circle strategy was scrapped. New approach: OCR via Tesseract.js.

---

## Area 1: Sequential Numbering Strategy

**Options:** Cable-path ordering / Page-spatial ordering / No numbering

**User response (free-text):** "none of these options work in bifurcations — we need to make the graphics into text"

**Resolution:** Tesseract.js OCR on rendered page crops. OCR failure → infer from logical sequence.

---

## Area 2: OCR Approach

- Tesseract.js acceptable: **Yes**
- Render strategy: **Full page render at 2×, then crop per circle**

---

## Area 3: Page 8 Circles Bug

All 20 circles at (2, 840) — CTM bug.

**User answer:** Nothing relevant, DWG leftover — exclude entirely.

**Resolution:** Filter pages where all circles cluster at near-origin.

---

## Area 4: Distances

Distances extracting correctly. "34,3", "37,8" etc. from `Distância_Poste`. No changes needed.

---

## Area 5: Output + Failures

- Output: post number + x,y + distances + cable geometry — **all three**
- OCR failure: **infer from logical sequence**
- postType: **include** (validation anchor)

---

## Key Diagnostic Evidence

**Inspector (page 2):** 11 circles, `route digits = 0` on all pages, `gettext whole ≤54pt = 0`.

**getTextContent dump (page 2):** Near circles: `"RST - 75 - PCN07"`, `"10-150 (U)"`, `"21169"`, `"PCN07-3#2 CA-13.8kV-RST"`. These are existing electrical pole data. NO fiber sequential numbers anywhere.

**The accidental "07" match** came from `"PCN07-3#2..."` string — PCN network ID, not post number.

**Layer corrections:** `Numero_Poste` doesn't exist (circles from `"0"`). `TEXTO` doesn't exist (aliases have 0 route digits).

---

## Deferred Ideas

- `Numeração_Cabo` layer — cable numbering for bifurcations (future phase)
- `Travessia` layer — crossing annotations (future phase)
