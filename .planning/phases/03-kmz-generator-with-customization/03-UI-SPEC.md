---
phase: 3
slug: kmz-generator-with-customization
status: approved
shadcn_initialized: false
preset: none
design_source: PRODUCT.md + DESIGN.md (Impeccable Field Notebook)
created: 2026-05-26
approved: 2026-05-26
---

# Phase 3 — UI Design Contract

> Visual and interaction contract for KMZ generation (dev hook) in the existing single-page workflow. Aligns with **The Field Notebook** (`DESIGN.md`) and product register **product** (`PRODUCT.md`). Full customization panel UI is **Phase 4**; Phase 3 only surfaces download + generation stats.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (vanilla HTML/CSS, no component library) |
| Preset | not applicable |
| Component library | none |
| Icon library | none (text labels only in Phase 3) |
| Font | System UI stack per `DESIGN.md`; mono for stats/previews |
| Canonical tokens | `index.html` `:root` CSS variables — must match `DESIGN.md` frontmatter |

**Do not introduce** Tailwind, shadcn, or new color systems in Phase 3. Extend existing classes (`btn-primary`, `btn-secondary`, `panel`, `hint`, `lede`).

---

## Phase 3 UI Scope

| In scope | Out of scope (Phase 4) |
|----------|-------------------------|
| "Download KMZ" control after successful **Calculate Route** | Icon/line/label pickers (CUST-01–03 UI) |
| Inline **KMZ generation stats** (placemarks, lines, omitted GPS) | Drag-and-drop upload, progress bars |
| KMZ warnings appended to existing `#warningsList` | Map preview (ENH-01) |
| Disabled / loading / error states for download only | Modals, sidebars, style panel |

**Placement:** Extend `#resultSection` (Step 3: Output) — do not add a new top-level navigation pattern.

---

## Visual Hierarchy

**Screen:** Single-column workflow (`index.html`), max-width 42rem.

| Priority | Element | When visible |
|----------|---------|--------------|
| 1 (focal) | **Download KMZ** (`btn-primary`) | After `calculateCoordinates` succeeds and at least one post has GPS |
| 2 | Step 2 coordinate form | After PDF parse succeeds |
| 3 | Parse summary + warnings | After parse (existing) |
| 4 | Output preview `pre` | After calculate (existing) |
| 5 | Debug / reference compare | Unchanged; secondary |

**North star:** User completes upload → anchors → sees preview → downloads KMZ in one vertical scroll. No step hides the previous one.

---

## Spacing Scale

Declared values (multiples of 4; sourced from `DESIGN.md` / `index.html`):

| Token | Value | Usage |
|-------|-------|-------|
| xs | 8px | Icon gaps, button rows, label margin |
| sm | 12px | Status banner margin, compact stacks |
| md | 16px | Panel padding, section internal gap |
| lg | 24px | Step panel padding (`surface-step`) |
| xl | 32px | Page padding, section breaks |

**Exceptions:** `10px` input/button padding (existing — tactile hit area, not layout rhythm). Do not add new non-4px layout gaps.

---

## Typography

Four size roles only (mono uses Label size, different family):

| Role | Size | Weight | Line Height | Usage |
|------|------|--------|-------------|-------|
| Body | 16px (1rem) | 400 | 1.55 | Prose, status text, stats lines |
| Label | 14px (0.875rem) | 600 | 1.4 | Form labels, KMZ stats labels |
| Heading (section) | 18px (1.125rem) | 600 | 1.35 | `h2` step titles |
| Display (title) | 28px (1.75rem) | 600 | 1.25 | Page `h1` only |

**Mono family** (`--font-mono`): `outputPreview`, `compareOutput`, KMZ stats detail line — **14px**, weight 400, line-height 1.5.

---

## Color

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#f7f5f1` (`--canvas`) | Page background |
| Secondary (30%) | `#ffffff`, `#f0ede6`, `#e8f0ec` | Surfaces, summary panels, step panel |
| Accent (10%) | `#2d6b5a` (`--accent`) | **Download KMZ** only among new Phase 3 controls |
| Semantic success | `#1f5c38` on `#e8f3ec` | KMZ ready / download complete status |
| Semantic warning | `#6b4e12` on `#faf3e3` | Omitted posts, non-fatal KMZ warnings |
| Semantic error | `#8b1f2e` on `#fceef0` | KMZ build/pack failure |

**Accent reserved for:** `Calculate Route`, **Download KMZ**, and focus rings (`outline: 2px solid var(--accent)`). Compare buttons stay `btn-secondary`. Never accent-wash panels or headings.

**Anti-patterns (from PRODUCT.md):** No pure `#000`/`#fff`, no gradients, no glass, no side-stripe callouts.

---

## Components (Phase 3)

### Download block (new)

- **Container:** Inside `#resultSection`, below `outputPreview`, top margin `var(--space-md)`.
- **Primary button:** `id="downloadKmzBtn"`, class `btn-primary`, label **Download KMZ**.
- **Stats panel:** `class="panel"` (reuse), shown when generation returns stats:
  - Heading (Label weight): **KMZ contents**
  - Bullets: placemark count, line count, omitted-no-GPS count (if &gt; 0, use warning panel styling for that line only).
- **Helper:** `class="hint"` under button when disabled: explains prerequisite.

### Button states

| State | Appearance | Copy |
|-------|------------|------|
| Disabled | `disabled`, reduced opacity 0.55, `cursor: not-allowed` | Button: **Download KMZ**; hint: "Run Calculate Route with valid coordinates first." |
| Loading | `disabled` + `aria-busy="true"` | Button: **Building KMZ…** |
| Ready | `btn-primary` enabled | **Download KMZ** |
| Error | Status `#status` with class `error` | See copywriting |

Use `transition: background-color 0.15s ease-out` only (no layout animation). Honor `prefers-reduced-motion`.

### Existing components (unchanged vocabulary)

- Parse summary → `#summary.panel`
- Warnings → `#warnings.panel`; KMZ warnings prefixed `[kmz]` in list items (mirror `[calc]` pattern)
- Step 2 → `#coordForm` with `surface-step` background

---

## Interaction States

| Event | UI response |
|-------|-------------|
| Calculate Route succeeds | Show `#resultSection`; enable Download KMZ if `placemarkCount > 0` |
| Calculate Route fails / no GPS | Keep Download disabled; hint visible |
| Download clicked | Loading label; on success trigger file download + success status "KMZ ready — check downloads." |
| `omittedNoGps > 0` | Stats line in warning color; append warning to `#warningsList`: "N posts omitted (no GPS)." |
| `buildKml` / `packageKmz` throws | `#status.error` with specific message; do not clear preview |
| Re-calculate | Update preview and stats; revoke prior object URL if re-downloading |

**Filename:** `route.kmz` default (discretion per CONTEXT D-API); optional later: derive from PDF name in Phase 4.

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| Step 3 heading | **Step 3: Output** (unchanged) |
| Primary CTA (new) | **Download KMZ** |
| Loading CTA | **Building KMZ…** |
| Disabled hint | "Run Calculate Route with valid coordinates first." |
| Success status | "KMZ ready — open in Google Earth." |
| Stats heading | **KMZ contents** |
| Stats line (template) | "{n} post placemarks · {m} route lines" |
| Omitted posts warning | "{n} posts omitted (no GPS coordinates)." |
| Build error (generic fallback) | "Could not build KMZ: {message}" |
| Pack error | "Could not package KMZ file: {message}" |
| Empty placemarks | "No posts with GPS — fix coordinates and recalculate." |

**Destructive actions:** None in Phase 3. No confirmation modals.

---

## Accessibility

- `downloadKmzBtn`: `type="button"`; `aria-disabled` when logically disabled.
- Loading: `aria-busy="true"` on button during async pack.
- Status messages: live region optional (`role="status"` on `#status` when shown) — do not remove existing pattern.
- Focus: 2px accent outline on button (existing `:focus-visible`).
- Color: status text always includes words, not color alone (WCAG 2.1 AA per PRODUCT.md).

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| n/a | none | not required |

---

## Implementation Notes (for planner/executor)

- Wire download to `buildKml` → `packageKmz` with **hardcoded defaults** from `parser/kmz-defaults.js` (CONTEXT D-API-03).
- Surface `stats` and `warnings` from builder; never silent omit (CONTEXT D-PM-03).
- CSS: only add rules for `#downloadKmzBtn`, `#kmzStats`, disabled opacity — no new global palette.
- Reference: `DESIGN.md` for token names; `PRODUCT.md` for step flow and anti-references.

---

## Checker Sign-Off

- [x] Dimension 1 Copywriting: PASS
- [x] Dimension 2 Visuals: PASS
- [x] Dimension 3 Color: PASS
- [x] Dimension 4 Typography: PASS
- [x] Dimension 5 Spacing: PASS
- [x] Dimension 6 Registry Safety: PASS

**Approval:** approved 2026-05-26
