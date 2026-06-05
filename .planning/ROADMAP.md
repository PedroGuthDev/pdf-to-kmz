# Roadmap: PDF to KMZ Converter

**Active milestone:** v1.1 — Cross-PDF Compatibility (not yet planned)
**Mode:** mvp

---

## Shipped Milestones

- **v1.0 — Working PDF → KMZ Converter** ✅ SHIPPED 2026-06-05 — full client-side pipeline
  (parse → coordinates → KMZ), proven on multiple routes. Archive:
  [v1.0-ROADMAP.md](./milestones/v1.0-ROADMAP.md) · see [MILESTONES.md](./MILESTONES.md).

---

## v1.1 — Cross-PDF Compatibility (next)

**Theme:** Make the system work reliably across many different PDFs, not just the handful
of calibrated routes. Defines fresh requirements via `/gsd:new-milestone`.

**Carried forward from v1.0** (candidates for v1.1 phases or backlog):

- Multi-PDF generalization / format variation handling (the core theme) — reopens v1.0's
  "single format only" out-of-scope; cf. MULTI-01/MULTI-02.
- LC posts-1–20 coordinated post-positioning + calibration rework
  (`.planning/quick/260603-n4k-debug-lc-post-symbol-assignment-collapse/260603-n4k-MILESTONE-SCOPE.md`;
  Phases 1 + 1.5 position gates already shipped).
- Posts 21–31 rigid ~179 m offset (per-sheet UTM georef) + 20→21 cross-sheet 381 m span.
- Phase 4 formal UI/UX polish (04-01..04-03) + staged-progress feedback.
- 11 open debug sessions + open quick tasks — see STATE.md → Deferred Items.

> Run `/gsd:new-milestone` to question → research → define requirements → build the v1.1 roadmap.

---

_v1.0 roadmap archived 2026-06-05. Phase numbering continues from Phase 5 in v1.1 (never restarts)._
