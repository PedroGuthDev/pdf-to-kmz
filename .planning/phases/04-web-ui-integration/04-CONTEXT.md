# Phase 4: Web UI & Integration - Context

**Gathered:** 2026-05-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Polish the existing single-page `index.html` workflow so upload, GPS anchoring, KMZ appearance customization, progress feedback, and download meet UI-01–UI-05 and ROADMAP Phase 4 success criteria. Build on the working parser → `calculateCoordinates()` → `buildKml` / `packageKmz` pipeline (Phases 1–3). No new backend, accounts, or map preview.

**In scope:** Drag-and-drop + file picker upload, staged parse/OCR progress, full CUST UI wired to `mergeOptions()`, optional KMZ filename input, developer-tools toggle, copy/UX polish per Field Notebook (`DESIGN.md`, `PRODUCT.md`).

**Out of scope:** Map preview (ENH-01), icon size controls, hex color pickers, server upload, post-editing, multi-PDF batch, new parser/KMZ algorithms.

</domain>

<decisions>
## Implementation Decisions

### Upload zone (UI-01)

- **D-UPL-01:** **Drag-and-drop zone + native file picker** — both paths trigger the same parse flow. Drop zone follows Field Notebook tokens (calm, bordered surface, clear “Browse” affordance).
- **D-UPL-02:** After a valid PDF is selected, **replace the drop zone** with the **filename** and a **“Change file”** control (not a badge below an active drop zone).
- **D-UPL-03:** Selecting a **different PDF resets the full session** — clear GPS inputs, calculated output, KMZ blob/stats, warnings, and download state (fresh start).
- **D-UPL-04:** Invalid files (not PDF, empty, etc.) show errors in **`#status`** (existing error pattern); upload zone stays active for retry.

### Processing progress (UI-05)

- **D-PRG-01:** **Staged status messages** during parse — e.g. “Loading PDF…”, “Page 3/8…”, “Reading post numbers…” — not a single generic spinner. Message text must be specific (PRODUCT.md principle 3).
- **D-PRG-02:** Progress displays in **`#status`** banner (info style), same channel as parse success/errors.
- **D-PRG-03:** While parsing, **block the rest of the UI** — disable coord form, Calculate Route, appearance controls, and Download KMZ until parse completes or fails.
- **D-PRG-04:** **Cancel** = **reload the page** (or equivalent full reset of in-flight work). No AbortController requirement for v1.

### Customization panel (UI-04, CUST-01–03)

- **D-CUS-01:** KMZ appearance controls live **inside Step 2** (`#coordForm`) as an **“Appearance”** block **above** the Calculate Route button — customize before calculating/downloading.
- **D-CUS-02:** Colors via **named Earth preset swatches** (small grid per control or grouped) — **no hex picker** (inherits Phase 3 D-IC-03 / D-ST-01). Wire selections into `mergeOptions()` from `parser/kmz-defaults.js`.
- **D-CUS-03:** Include **`lineDescription`** as a **textarea** in the appearance section (global route line note; empty allowed).
- **D-CUS-04:** **Icon size stays fixed** at scale 1.0 — no size UI in Phase 4 (Phase 3 D-IC-04).
- **D-CUS-05:** Line width and label scale controls use the same calm form vocabulary as coord inputs (labels, hints); exact control type (select vs numeric) is planner/executor discretion within Field Notebook spacing.

### Step layout & coordinate UX (UI-03)

- **D-STP-01:** **Numbered h2 headings only** — no horizontal step rail. Step 1 remains implicit at upload; Step 2/3 labels unchanged unless copy pass adds “Step 1: Upload PDF” later (not required now).
- **D-STP-02:** Keep **single paste field** `lat, lon` for post #1 with Brazil bounds validation (current behavior).
- **D-STP-03:** Optional last-post GPS moves into a **collapsed expander**: **“Improve accuracy (2nd anchor)”** — hidden by default, reduces noise; implements Phase 2 D-ACC-07 UI deferral.
- **D-STP-04:** Keep **visible monospace preview** of first 10 calculated posts in Step 3 (“show the machine’s work” — PRODUCT.md principle 2).

### Download & copy (UI-02)

- **D-DL-01:** **Optional filename text input** near Download KMZ — starts **empty**; if left empty on download, default to **uploaded PDF basename + `.kmz`** (sanitize unsafe characters). If user types a value, use it (ensure `.kmz` suffix).
- **D-DL-02:** Download flow inherits Phase 3 interaction states (`03-UI-SPEC.md`) — loading label “Building KMZ…”, stats panel, warnings prefix `[kmz]`.

### Page copy & developer tools

- **D-COPY-01:** Replace technical lede with **user-facing copy**: upload → anchor GPS → customize appearance → download KMZ for Google Earth.
- **D-DBG-01:** **Debug: Calibration Data** and **Reference Compare** sections **hidden by default**; single **“Show developer tools”** link at page bottom toggles both.
- **D-DBG-02:** Developer tools **off by default** (clean first impression; single expert user can opt in).

### Claude's Discretion

- Exact drop-zone HTML/CSS structure and drag-over visual state (must honor DESIGN.md tokens and `prefers-reduced-motion`).
- Swatch layout (one grid per color target vs shared palette row).
- Line width / label scale control widgets.
- Whether “Step 1: Upload PDF” heading is added for symmetry with Step 2/3.
- Staged progress message hooks — which parser/pdf.js callbacks expose page index for “Page N/M”.
- Filename sanitization rules for derived default.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and product

- `.planning/ROADMAP.md` — Phase 4 success criteria (UI-01–UI-05)
- `.planning/REQUIREMENTS.md` — UI-* and CUST-* definitions
- `.planning/PROJECT.md` — client-side-only, single-user, no accounts
- `PRODUCT.md` — step flow, anti-references, accessibility principles
- `DESIGN.md` — Field Notebook color/spacing/type tokens (frontmatter + body)

### Phase 3 outputs (wire UI to these)

- `.planning/phases/03-kmz-generator-with-customization/03-CONTEXT.md` — options contract, Earth presets, `lineDescription`, no hex/size UI
- `.planning/phases/03-kmz-generator-with-customization/03-UI-SPEC.md` — Download KMZ states, copywriting, stats panel (extend, do not contradict)
- `parser/kmz-defaults.js` — `DEFAULT_OPTIONS`, `mergeOptions()`, preset color keys
- `parser/kml-builder.js` / `parser/kmz-packager.js` — `buildKml`, `packageKmz` API

### Phase 2 coordinate UX

- `.planning/phases/02-coordinate-calculator/02-CONTEXT.md` — D-ACC-07 optional second anchor; paste-first GPS UX

### Implementation surface

- `index.html` — current upload, `#status`, `#coordForm`, `#resultSection`, debug/compare sections, download hook
- `.planning/research/FEATURES.md` — table-stakes upload (drag-and-drop + picker)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `index.html` — full workflow shell: `:root` tokens match `DESIGN.md`; `#status`, `.panel`, `.btn-primary`, `#coordForm`, `#downloadKmzBtn`, `#kmzStats` already implemented for Phase 3 dev hook.
- `parser/kmz-defaults.js` — shallow-merge target for appearance UI bindings.
- Phase 3 download wiring — extend with `mergeOptions(userChoices)` instead of hardcoded `{}`.

### Established Patterns

- **Field Notebook** — one accent (`--accent`), no gradients/glass; status uses color + text.
- **Steps over screens** — vertical scroll, sections stay visible after completion (PRODUCT.md).
- **Warnings** — `[calc]`, `[kmz]` prefixes in `#warningsList`; continue pattern for Phase 4 parse messages.

### Integration Points

- Upload → existing `parsePdf()` flow; add progress callbacks / staged `#status` updates.
- Appearance block → read values on Calculate Route and Download KMZ → `mergeOptions()`.
- Re-upload → central `resetSession()` clearing `lastParseResult`, coord inputs, result section, object URLs.
- Developer toggle → `display:none` on `#debugSection` and `#refCompareSection` until link clicked.

</code_context>

<specifics>
## Specific Ideas

- Upload area should feel like a **labeled field notebook slot**, not a marketing dropzone.
- **Trust through visibility** — keep coordinate preview; staged parse messages matter more than a bare spinner.
- **Second anchor** is power-user accuracy — tuck under expander so the default path stays simple.
- **Filename field** empty by default; PDF name is the silent default when user doesn’t care.

</specifics>

<deferred>
## Deferred Ideas

- **Icon size slider / S-M-L presets** — user chose skip; remains Phase 3 fixed scale 1.0.
- **AbortController cancel** during OCR — reload-only cancel for v1.
- **Map preview before download (ENH-01)** — v2 / future phase.
- **Separate lat/lon fields** — user kept paste format.
- **Horizontal step progress rail** — user preferred headings only.
- **Hex color pickers** — out of scope per Phase 3 preset palette decision.

</deferred>

---

*Phase: 04-Web UI & Integration*
*Context gathered: 2026-05-26*
