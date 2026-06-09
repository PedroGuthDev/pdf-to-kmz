# Phase 09: Diagnostic Failure & Confidence Surfacing - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-09
**Phase:** 09-diagnostic-failure-confidence-surfacing
**Areas discussed:** Tier→color mapping, KMZ ExtendedData schema, Failure messages + UI surfacing, Partial-output rule + flagging

---

## Tier → color mapping

| Option | Description | Selected |
|--------|-------------|----------|
| Traffic light | HIGH=green, MED=yellow, LOW=orange, UNRESOLVABLE=red; 4 tier-keyed `<Style>` blocks | ✓ |
| Green→red, no orange | HIGH=green, MED=yellow, LOW=red, UNRESOLVABLE=grey/black | |
| You decide | Claude picks a KML-safe palette | |

**User's choice:** Traffic light
**Notes:** UNRESOLVABLE = red (alarming), not grey. Maps to risk legibility.

| Option | Description | Selected |
|--------|-------------|----------|
| Lines stay uniform | Tier is per-post; line spans two posts → ambiguous to color | ✓ |
| Recolor by worst endpoint | Each segment takes lower-confidence endpoint tier | |
| You decide | Claude chooses | |

**User's choice:** Lines stay uniform
**Notes:** Tier color also takes precedence over the user-customizable icon color (D-03 tension captured).

---

## KMZ ExtendedData schema

| Option | Description | Selected |
|--------|-------------|----------|
| Tier + diagnostics | tier + shape_residual_m + anchor_gap_m + source (+ demotionReason) | ✓ |
| Tier label only | Just `<Data name="tier">`; zero numbers | |
| You decide | Claude chooses field set | |

**User's choice:** Tier + diagnostics
**Notes:** Meters are diagnostics, not a forbidden numeric-% seal (CONF-04). Requires residual-gate to expose per-post sub-scores (D-06).

| Option | Description | Selected |
|--------|-------------|----------|
| Add Portuguese tier line | Balloon shows "Confiança: ALTA — Lat:…, Lon:…" | ✓ |
| Keep Lat/Lon only | Tier conveyed by color + ExtendedData only | |
| You decide | Claude chooses | |

**User's choice:** Add Portuguese tier line

---

## Failure messages + UI surfacing

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated status banner | Prominent top block: overall tier + hard failure, separate from #warningsList | ✓ |
| Reuse warnings panel | Append to existing #warningsList | |
| You decide | Claude chooses placement | |

**User's choice:** Dedicated status banner

| Option | Description | Selected |
|--------|-------------|----------|
| Gate-gated worst-case | "high" only if gate trusts AND no LOW/UNRESOLVABLE post; else degrade | ✓ |
| Median of post tiers | Overall = median tier | |
| You decide | Claude chooses aggregation | |

**User's choice:** Gate-gated worst-case
**Notes:** `dwgConfidence.overall` is a net-new field (today: gateDecision + postTiers).

---

## Partial-output rule + flagging

| Option | Description | Selected |
|--------|-------------|----------|
| Emit flagged KMZ | On overall gate-fail with coords present, emit KMZ; posts colored by tier; banner shows degraded | ✓ |
| Block KMZ on gate-fail | No download when overall gate fails | |
| You decide | Claude chooses | |

**User's choice:** Emit flagged KMZ

| Option | Description | Selected |
|--------|-------------|----------|
| Red marker if any coord, else list | UNRESOLVABLE post with fallback coord → red marker; none → listed in banner | ✓ |
| List-only in UI | Never place unresolvable posts on map; list numbers | |
| You decide | Claude chooses | |

**User's choice:** Red marker if any coord, else list
**Notes:** Replaces today's silent `omittedNoGps` drop in buildKml.

| Option | Description | Selected |
|--------|-------------|----------|
| Block + Portuguese reason | No-region / unit-mismatch → no KMZ; show reason + nearest-region hint+distance | ✓ |
| Emit PDF-only + warning | Keep current PDF-fallback behavior with "precisão limitada" | |
| You decide | Claude chooses | |

**User's choice:** Block + Portuguese reason
**Notes:** Block reserved for no-region + unit-mismatch only; a matched region that degrades to PDF-fallback still emits flagged (D-13 boundary).

---

## Claude's Discretion

- Exact KML `aabbggrr` hex values for the four tier colors and icon choice.
- Exact `<ExtendedData>` key names/casing; optional route-summary placemark/folder.
- Exact Portuguese wording of new banner strings and the `diverged-at-post` message.
- Whether tier-color-vs-user-icon precedence (D-03) is a UI toggle or hard-coded.
- Whether the banner is a new DOM element or restyled existing results area.

## Deferred Ideas

- Interactive map preview with tier colors before download → ENH-01.
- Cable-specification data in KMZ placemarks → ENH-02.
- UI toggle for tier-color vs custom-icon-color precedence → optional polish.
- Multi-zone CRS surfacing → MZONE-01.
