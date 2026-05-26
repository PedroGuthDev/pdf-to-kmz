---
phase: 4
slug: web-ui-integration
status: approved
shadcn_initialized: false
preset: none
design_source: PRODUCT.md + DESIGN.md (Impeccable Field Notebook, refreshed 2026-05-26)
created: 2026-05-26
approved: 2026-05-26
---

# Phase 4 — UI Design Contract

> Visual and interaction contract for polishing the single-page `index.html` workflow: upload, staged parse feedback, GPS anchoring, KMZ appearance customization, filename control, and download. Extends **Phase 3** `03-UI-SPEC.md` without contradicting it. Aligns with **The Field Notebook** (`DESIGN.md`) and product register **product** (`PRODUCT.md`).

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (vanilla HTML/CSS, no component library) |
| Preset | not applicable |
| Component library | none |
| Icon library | none (text labels; Earth preset swatches are color chips, not icons) |
| Font | System UI stack per `DESIGN.md`; mono for previews, stats, debug |
| Canonical tokens | `index.html` `:root` CSS variables — must match `DESIGN.md` frontmatter |

**Do not introduce** Tailwind, shadcn, hex color pickers, map preview, modals, or new global palettes. Reuse classes: `btn-primary`, `btn-secondary`, `panel`, `hint`, `lede`, `field-row`.

---

## Phase 4 UI Scope

| In scope | Out of scope |
|----------|----------------|
| Drag-and-drop + file picker upload (UI-01) | Map preview (ENH-01) |
| Staged parse progress in `#status` (UI-05) | Icon size UI (fixed scale 1.0) |
| Appearance block in Step 2 wired to `mergeOptions()` (UI-04, CUST-01–03) | Hex color pickers |
| Optional KMZ filename input (UI-02 extension) | AbortController cancel (reload only) |
| User-facing page copy; developer tools toggle | Multi-PDF batch, post editing |
| Session reset on new PDF; UI block during parse | Horizontal step rail |
| Second-anchor expander (D-ACC-07 UI) | Server upload, accounts |

**Placement:** Single column, max-width 42rem. Numbered `h2` step headings only (no step rail).

---

## Visual Hierarchy

**Screen:** One vertical workflow; each step remains visible after completion.

| Priority | Element | When visible |
|----------|---------|--------------|
| 1 (focal) | **Upload zone** or **selected filename + Change file** | Always at top until parse succeeds |
| 2 | `#status` (progress / parse result) | During and after parse |
| 3 | **Step 2** `#coordForm` (GPS + Appearance + Calculate Route) | After successful parse |
| 4 | Parse summary + warnings panels | After parse |
| 5 | **Step 3** output preview + **Download KMZ** | After Calculate Route succeeds |
| 6 | Optional filename field | With Step 3 download block |
| 7 | Developer tools (debug + reference compare) | Hidden until toggled |

**North star:** Upload → anchor GPS → customize appearance → calculate → download KMZ in one scroll. Accent draws the eye only to primary actions (Browse/Change file is secondary until file selected; then Calculate Route and Download KMZ are primary).

---

## Spacing Scale

Declared values (from `DESIGN.md` / `index.html`):

| Token | Value | Usage |
|-------|-------|-------|
| xs | 8px | Label margin, button rows, swatch gaps |
| sm | 12px | Status banner margin, compact stacks |
| md | 16px | Panel padding, section gaps, appearance block internal |
| lg | 24px | Step panel padding |
| xl | 32px | Page padding, section breaks |

**Exceptions:** `10px` input/button padding (existing hit area). Do not add non-4px layout gaps.

---

## Typography

| Role | Size | Weight | Line Height | Usage |
|------|------|--------|-------------|-------|
| Body | 16px (1rem) | 400 | 1.55 | Lede, status, appearance hints |
| Label | 14px (0.875rem) | 600 | 1.4 | Form labels, swatch group labels, KMZ stats |
| Heading (section) | 18px (1.125rem) | 600 | 1.35 | `h2` step titles |
| Display (title) | 28px (1.75rem) | 600 | 1.25 | Page `h1` only |

**Mono** (`--font-mono`): `outputPreview`, `compareOutput`, debug — **13px** (0.8125rem), weight 400, line-height 1.5.

---

## Color

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#f7f5f1` (`--canvas`) | Page background |
| Secondary (30%) | `#ffffff`, `#f0ede6`, `#e8f0ec` | Surfaces, summary, step panel |
| Accent (10%) | `#2d6b5a` (`--accent`) | Primary buttons, focus rings, selected swatch ring |
| Semantic | success / warning / error / info tokens | `#status`, warnings panel, coord validation |

**Accent reserved for:** `btn-primary` actions (Calculate Route, Download KMZ), focus outlines, and **selected** Earth preset swatch (2px ring, not fill wash). Upload zone border uses `--border` / `--border-strong`; drag-over may use `--accent-soft` background tint only.

**Earth preset swatches** (from `parser/kmz-defaults.js` `PRESET_COLORS`): red, green, blue, white, yellow, black — display as small squares with border `#c4bdb0`; selected state: `outline: 2px solid var(--accent)`.

**Anti-patterns:** No pure `#000`/`#fff` in UI chrome, no gradients, glass, side-stripe callouts, marketing dropzone illustration.

---

## Components

### Upload zone (new, UI-01)

- **Container:** `#uploadSection` — bordered region on `--surface`, `border: 1px solid var(--border-strong)`, `border-radius: var(--radius-md)`, padding `var(--space-lg)`.
- **Idle copy:** Label **Upload route PDF**; body hint: "Drag a file here or choose Browse."; **Browse** = `btn-secondary` triggering hidden `#pdfInput` (`accept=".pdf"`).
- **Drag-over:** Background `--accent-soft` (or `--surface-step`); border `--accent`; no scale animation (`prefers-reduced-motion`).
- **Selected state (D-UPL-02):** Replace zone with filename (Label weight) + **Change file** (`btn-secondary`). No persistent drop target under filename.
- **Invalid file (D-UPL-04):** `#status.error` with specific message; zone stays available.

### Staged progress (UI-05)

- **Channel:** `#status` with class `info` during parse (D-PRG-02).
- **Copy pattern (D-PRG-01):** "Loading PDF…", "Reading page {n} of {m}…", "Reading post numbers…" — never generic "Processing…".
- **UI block (D-PRG-03):** While parsing, disable `#coordForm` controls, Calculate Route, appearance inputs, Download KMZ. Use `disabled` + `aria-busy` on upload section where applicable.
- **Cancel (D-PRG-04):** Optional text link **Start over** → `location.reload()`.

### Appearance block (UI-04, inside `#coordForm`)

- **Placement (D-CUS-01):** Subsection **Appearance** above Calculate Route button, below GPS fields.
- **Heading:** `h3` or strong Label: **KMZ appearance**
- **Controls (D-CUS-02, D-CUS-05):**
  - **Post icon color** — swatch grid → `iconColor`
  - **Route line color** — swatch grid → `lineColor`
  - **Line width** — `<select>` or number input, values 1–8, default 3
  - **Label color** — swatch grid → `labelColor`
  - **Label scale** — `<select>` 0.8 / 1 / 1.2 / 1.5 → `labelScale`
  - **Route note** — `textarea` `lineDescription`, optional, placeholder "Shown in Google Earth line description"
- **No icon size control (D-CUS-04).**
- **Wire:** On Calculate Route and Download KMZ, pass `mergeOptions({ iconColor, lineColor, lineWidth, labelColor, labelScale, lineDescription })`.

### Second-anchor expander (D-STP-03)

- **Trigger:** `<button type="button" class="btn-secondary">` or text button styled as link: **Improve accuracy (2nd anchor)**
- **Panel:** Collapsed by default; reveals last-post GPS field (same paste format as post #1).
- **Motion:** `max-height` / `display` toggle only if reduced-motion safe; prefer `hidden` attribute pattern.

### Filename input (D-DL-01)

- **Placement:** Step 3, above Download KMZ.
- **Label:** **KMZ filename (optional)**
- **Input:** `type="text"`, empty default; placeholder "Uses PDF name if empty"
- **Behavior:** On download, sanitize user value or derive `{pdfBasename}.kmz`; ensure `.kmz` suffix.

### Download block (inherits 03-UI-SPEC)

- Same states, copy, and stats panel as Phase 3. Extend disabled hint if appearance/session invalid.
- **Success status:** "KMZ ready — open in Google Earth." (unchanged)

### Developer tools (D-DBG-01, D-DBG-02)

- `#debugSection` and `#refCompareSection` default `display: none`.
- Page footer link: **Show developer tools** / **Hide developer tools** toggles both.
- No accent on link; `color: var(--accent)` underline on hover optional.

### Session reset (D-UPL-03)

- New PDF selection calls `resetSession()`: clear GPS fields, `lastParseResult`, result section, KMZ object URL, warnings, filename input, appearance to defaults, hide Step 3.

---

## Interaction States

| Event | UI response |
|-------|-------------|
| PDF dropped / picked | If valid: staged `#status.info` messages; on success show summary + `#coordForm` |
| Parse fails | `#status.error`; re-enable upload; keep coord form hidden |
| Parse succeeds | `#status.success` with post count; enable Step 2 |
| Calculate Route | Merge appearance options; show Step 3; enable Download per Phase 3 rules |
| Change file | Full session reset; return to upload selected state |
| Download | Phase 3 loading/success/error; filename from input or PDF basename |
| Invalid GPS | `#coordWarning` visible; Calculate disabled |
| Re-parse same session N/A | Only via Change file or Start over |

**Disabled during parse:** All Step 2/3 interactive elements (D-PRG-03).

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| Page title | **PDF to KMZ** (unchanged) |
| Lede (D-COPY-01) | "Upload an INFOVIAS route PDF, anchor post #1 in GPS, customize how it looks in Google Earth, then download a KMZ file." |
| Upload label | **Upload route PDF** |
| Upload hint | "Drag a file here or choose Browse." |
| Browse CTA | **Browse** |
| Change file | **Change file** |
| Progress: load | **Loading PDF…** |
| Progress: page | **Reading page {n} of {m}…** |
| Progress: OCR | **Reading post numbers…** |
| Parse success | **PDF ready — {n} posts found.** |
| Invalid file | **Could not use that file: {reason}.** (e.g. not a PDF, empty file) |
| Step 2 heading | **Step 2: Anchor GPS and appearance** (or keep "Enter First Post Coordinates" + Appearance subheading — executor picks one consistent pair) |
| Post #1 label | **Post #1 coordinates (lat, lon)** |
| Expander | **Improve accuracy (2nd anchor)** |
| Last post label | **Last post coordinates (optional)** |
| Appearance heading | **KMZ appearance** |
| Calculate CTA | **Calculate Route** |
| Step 3 heading | **Step 3: Output** |
| Preview intro | **Preview of calculated posts (first 10):** |
| Filename label | **KMZ filename (optional)** |
| Download CTA | **Download KMZ** |
| Download loading | **Building KMZ…** |
| Download disabled hint | "Run Calculate Route with valid coordinates first." |
| KMZ success | **KMZ ready — open in Google Earth.** |
| Developer toggle | **Show developer tools** / **Hide developer tools** |
| Start over | **Start over** |

**Destructive actions:** Change file and Start over reset work without modal; no "Are you sure?" (expert tool, D-COPY-01).

**Errors:** Always name failure layer (file format, bounds, parse stage). No "Something went wrong."

---

## Accessibility

- Upload: `role="region"` + `aria-label="PDF upload"`; hidden file input remains focusable via Browse.
- Drag-and-drop: keyboard users use Browse only; do not rely on drag alone.
- Expander: `aria-expanded` on trigger; panel `id` referenced by `aria-controls`.
- Swatches: `role="radiogroup"` per color target; each swatch `role="radio"` + `aria-checked`; keyboard arrows optional (FLAG if deferred: click-only acceptable for v1 if labels present).
- `#status`: `role="status"` when visible during progress.
- `prefers-reduced-motion`: no drag animations; existing global rule preserved.
- Focus: 2px `--accent` outline (`:focus-visible`).
- Labels: every input has associated `label`/`for`.

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| n/a | none | not required |

---

## Implementation Notes (for planner/executor)

- Read `04-CONTEXT.md` decisions D-UPL-* through D-DBG-*; do not implement deferred items.
- Extend `parsePdf()` (or wrapper) with progress callbacks for page index and OCR stage messages.
- Central `resetSession()` on new file; revoke object URLs.
- Appearance defaults from `DEFAULT_OPTIONS` in `parser/kmz-defaults.js`.
- Extend Phase 3 download handler with `mergeOptions()` from appearance DOM.
- CSS additions only: upload zone, swatches, expander, filename row, `ui-blocked` disabled styling — no new token names without updating `DESIGN.md`.
- Reference: `03-UI-SPEC.md` for download states; `DESIGN.md` + `.impeccable/design.json` for component tone.

---

## Checker Sign-Off

- [x] Dimension 1 Copywriting: PASS
- [x] Dimension 2 Visuals: PASS
- [x] Dimension 3 Color: PASS
- [x] Dimension 4 Typography: PASS
- [x] Dimension 5 Spacing: PASS
- [x] Dimension 6 Registry Safety: PASS

**Approval:** approved 2026-05-26
