# Milestones

History of shipped versions. Newest first.

## v1.0 — Working PDF → KMZ Converter ✅ SHIPPED 2026-06-05

End-to-end client-side pipeline: INFOVIAS PDF → OCR post numbers + layout → per-post
GPS via UTM-grid calibration (with optional DWG/DXF region-pairing graph-walk) →
customizable KMZ for Google Earth. Proven on multiple real routes (Siriu DWG 85 posts,
Valmor, João Born, Luiz Carolino) with regression gates.

- **Phases:** 1–3 executed (parser, coordinates, KMZ); Phase 4 (formal UI polish) deferred.
- **Closed as-is** to pivot to cross-PDF generalization. Functional core delivered;
  23/23 v1 requirements met (5 with known limits carried forward).
- **Known deferred items at close:** 23 (see STATE.md → Deferred Items).
- **Archive:** [v1.0-ROADMAP.md](./milestones/v1.0-ROADMAP.md) · [v1.0-REQUIREMENTS.md](./milestones/v1.0-REQUIREMENTS.md)
- **Git:** a85fef2 → 27ecf21 · tag `v1.0` · 357 commits · ~24 days.
