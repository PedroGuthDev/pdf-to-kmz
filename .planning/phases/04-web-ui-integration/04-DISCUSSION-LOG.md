# Phase 4: Web UI & Integration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-26
**Phase:** 04-Web UI & Integration
**Areas discussed:** Upload zone, Processing progress, Customization panel, Step layout & coordinate UX, Debug & compare sections

---

## Upload zone

| Option | Description | Selected |
|--------|-------------|----------|
| Drag-and-drop + file picker | Both methods, UI-01 table stakes | ✓ |
| File picker only (polished) | Larger target, filename after select | |
| Drop zone primary | Browse as secondary link | |
| You decide | Claude discretion | |

| Option | Description | Selected |
|--------|-------------|----------|
| Replace zone with filename + Change file | After select | ✓ |
| Filename badge below zone | Keep drop zone visible | |
| Minimal (status only) | Current pattern | |

| Option | Description | Selected |
|--------|-------------|----------|
| Reset all on re-upload | Clear coords, calc, KMZ, warnings | ✓ |
| Re-parse, keep GPS | Reuse anchors | |
| Confirm before reset | Modal/confirm | |

| Option | Description | Selected |
|--------|-------------|----------|
| #status banner errors | Inline status + active upload zone | ✓ |
| Error inside drop zone | Plus status | |
| #status only | No zone styling | |

**User's choice:** Both upload methods; replace zone with filename; full session reset on new PDF; errors via #status.

---

## Processing progress

| Option | Description | Selected |
|--------|-------------|----------|
| Staged status messages | Page N/M, OCR phases | ✓ |
| Determinate bar + OCR spinner | | |
| Single indeterminate spinner | | |

| Option | Description | Selected |
|--------|-------------|----------|
| #status banner | Info-style progress | ✓ |
| Inside upload zone | | |
| Status + disabled upload | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Block all UI until parse done | Coord, calc, download disabled | ✓ |
| Block calc only | | |
| Disable upload only | | |

| Option | Description | Selected |
|--------|-------------|----------|
| No cancel | | |
| Cancel = reload page | ✓ | |
| AbortController | | |

**User's choice:** Staged messages in #status; block entire UI during parse; cancel via page reload.

---

## Customization panel

| Option | Description | Selected |
|--------|-------------|----------|
| Inside Step 2 (Appearance block) | Before Calculate Route | ✓ |
| In Step 3 before download | | |
| Separate collapsible section | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Named color swatches | Earth presets | ✓ |
| Dropdown per control | | |
| Shared swatch row | | |

| Option | Description | Selected |
|--------|-------------|----------|
| lineDescription textarea | In appearance section | ✓ |
| Optional under Advanced | | |
| Defer | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Skip icon size | Fixed 1.0 | ✓ |
| S/M/L presets | | |
| Slider | | |

**User's choice:** Appearance in Step 2; swatches; global line description textarea; no icon size UI.

---

## Step layout & coordinate UX

| Option | Description | Selected |
|--------|-------------|----------|
| Numbered h2 headings only | No step rail | ✓ |
| Add Step 1 heading everywhere | | |
| Horizontal 1-2-3 indicator | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Keep paste "lat, lon" | Brazil bounds | ✓ |
| Separate lat/lon fields | | |
| Paste + split toggle | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Collapsed "Improve accuracy (2nd anchor)" | Optional last post hidden by default | ✓ |
| Keep optional field visible | | |
| Prominent second anchor | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Keep visible 10-post preview | Show machine's work | ✓ |
| Collapsed preview | | |
| Hide preview | | |

**User's choice:** Headings only; paste coordinates; collapsed second anchor; keep preview.

---

## Debug & compare sections

| Option | Description | Selected |
|--------|-------------|----------|
| Hidden; "Show developer tools" toggle at bottom | Both sections | ✓ |
| Hide debug only; keep compare | | |
| Always visible | | |
| Remove from HTML | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Off by default | ✓ |
| On by default | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Optional filename input; empty → PDF basename.kmz | User free-text clarification | ✓ |
| Fixed route.kmz | | |
| PDF name auto only (no input) | | |

| Option | Description | Selected |
|--------|-------------|----------|
| User-facing lede | upload → anchor → customize → download | ✓ |
| Keep technical lede | | |
| Minimal one-liner | | |

**User's choice:** Developer tools hidden behind bottom link (off by default); editable filename with PDF-name default; user-facing intro copy.

**Notes:** For KMZ filename, user specified: empty text input; if not written, default to PDF name.

---

## Claude's Discretion

- Drop-zone visual details, swatch grid layout, line width/label scale widgets, progress hook placement, filename sanitization.

## Deferred Ideas

- Icon size UI, AbortController cancel, map preview (ENH-01), hex pickers, horizontal step rail, separate lat/lon fields.
