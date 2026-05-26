# Phase 4: Web UI & Integration - Research

**Researched:** 2026-05-26  
**Domain:** Single-page vanilla HTML/JS UX — upload, staged progress, form wiring to `mergeOptions()`  
**Confidence:** HIGH (existing `index.html` + locked CONTEXT/UI-SPEC); MEDIUM (exact `parsePdf` progress hook shape)

## Summary

Phase 4 polishes the **existing** `index.html` shell — no new framework, no backend. The implementation surface is almost entirely one file plus a **small, backward-compatible** extension to `parsePdf()` for staged progress messages. Phase 3 already ships `mergeOptions()`, `buildKml`, `packageKmz`, and a dev Download KMZ hook using `mergeOptions({})` — Phase 4 replaces hardcoded `{}` with values read from DOM controls.

The highest-risk details are **full session reset on re-upload** (object URLs, `lastCalcResult`, appearance defaults), **UI blocking during parse** (disabled state + `aria-busy`), and **drag-and-drop** without breaking the hidden file input pattern. Progress copy must be **specific** (page N/M) — requires a parser callback because the page loop already exists in `parser/pdf-parser.js` (lines 317–334).

**Primary recommendation:** Three MVP vertical plans — (1) upload + progress + reset, (2) appearance + GPS expander + `mergeOptions` on calculate, (3) filename + copy + dev-tools toggle + download wiring. Add `parsePdf(arrayBuffer, { onProgress })` in plan 04-01 only.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked — Upload (UI-01)
- D-UPL-01: Drag-and-drop + native file picker, same parse flow
- D-UPL-02: After valid PDF, replace zone with filename + **Change file**
- D-UPL-03: New PDF → full `resetSession()` (GPS, calc, KMZ blob, warnings, download)
- D-UPL-04: Invalid files → `#status.error`; zone stays active

### Locked — Progress (UI-05)
- D-PRG-01: Staged messages — "Loading PDF…", "Page N/M…", "Reading post numbers…"
- D-PRG-02: Progress in `#status` with `info` class
- D-PRG-03: Block coord form, Calculate, appearance, Download during parse
- D-PRG-04: Cancel = `location.reload()` (optional **Start over** link)

### Locked — Customization (UI-04)
- D-CUS-01: Appearance block inside `#coordForm`, above Calculate Route
- D-CUS-02: Earth preset swatches from `PRESET_COLORS` keys — no hex picker
- D-CUS-03: `lineDescription` textarea
- D-CUS-04: No icon size UI (scale 1.0)
- D-CUS-05: Line width / label scale — select or number, Field Notebook styling

### Locked — Steps & GPS (UI-03)
- D-STP-01: Numbered h2 only, no step rail
- D-STP-02: Single paste field for post #1, Brazil bounds
- D-STP-03: Last-post GPS in collapsed **Improve accuracy (2nd anchor)** expander
- D-STP-04: Keep first-10 monospace preview in Step 3

### Locked — Download & copy
- D-DL-01: Optional filename input; default `{pdfBasename}.kmz` sanitized
- D-DL-02: Inherit Phase 3 download states (Building KMZ…, stats, `[kmz]` warnings)
- D-COPY-01: User-facing lede (not technical parser copy)
- D-DBG-01/02: Debug + ref compare hidden; footer **Show developer tools** toggle

### Deferred (OUT OF SCOPE)
- Map preview, hex pickers, icon size, AbortController cancel, horizontal step rail
</user_constraints>

## Current State (index.html)

| Area | Today | Phase 4 target |
|------|--------|----------------|
| Upload | `<input type="file" id="pdfInput">` only | Bordered drop zone + hidden input + Browse |
| Progress | `"Parsing..."` once | Staged `onProgress` messages |
| Appearance | None | Swatches + width/scale + `lineDescription` in `#coordForm` |
| `mergeOptions` | `mergeOptions({})` on download | Read DOM → `mergeOptions(userChoices)` |
| Last post GPS | Always visible field | Collapsed expander |
| Debug/ref | Shown after parse (`showDebug`, ref section display block) | Hidden until footer toggle |
| Filename | Hardcoded `route.kmz` | Optional input + PDF basename default |
| Re-upload | `clearResults()` partial | Full `resetSession()` per D-UPL-03 |

## parsePdf Progress Hook (recommended)

`parsePdf` currently loops `for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++)` and logs to console. Add optional second argument:

```js
export async function parsePdf(arrayBuffer, hooks = {}) {
  const onProgress = typeof hooks.onProgress === 'function' ? hooks.onProgress : null;
  // ...
  onProgress?.({ stage: 'loading', message: 'Loading PDF…' });
  // after getDocument:
  onProgress?.({ stage: 'pages', pageNum, numPages: pdfDoc.numPages, message: `Reading page ${pageNum} of ${numPages}…` });
  // before OCR batch / after page loop:
  onProgress?.({ stage: 'ocr', message: 'Reading post numbers…' });
}
```

**Backward compatible:** existing `parsePdf(buf)` callers unchanged.  
**index.html:** `showStatus(message, 'info')` on each callback; set `document.body` or section `aria-busy="true"` during parse.

## Drag-and-Drop Pattern

Standard pattern (no libraries):

1. `#uploadZone` listens `dragover` → `preventDefault()`, add `.drag-over` class  
2. `dragleave` / `drop` → remove class; `drop` → `preventDefault()`, take `e.dataTransfer.files[0]`  
3. Validate `file.type === 'application/pdf'` or `.pdf` extension  
4. Assign to hidden `#pdfInput` via `DataTransfer` is not portable — call shared `handlePdfFile(file)` directly  
5. **Change file** button resets input value and calls `resetSession()` then shows idle zone

## Appearance UI → mergeOptions

From `parser/kmz-defaults.js`:

| DOM control | Option key | Values |
|-------------|------------|--------|
| Selected swatch `data-preset` | `iconColor`, `lineColor`, `labelColor` | Keys of `PRESET_COLORS` |
| `#lineWidthSelect` | `lineWidth` | 1–8, default 3 |
| `#labelScaleSelect` | `labelScale` | 0.8, 1, 1.2, 1.5 |
| `#lineDescriptionInput` | `lineDescription` | string |

Helper in `index.html`:

```js
function readAppearanceOptions() {
  return {
    iconColor: getSelectedPreset('iconColor'),
    lineColor: getSelectedPreset('lineColor'),
    labelColor: getSelectedPreset('labelColor'),
    lineWidth: Number(lineWidthSelect.value),
    labelScale: Number(labelScaleSelect.value),
    lineDescription: lineDescriptionInput.value.trim(),
  };
}
```

Call on **both** Calculate Route (for consistency preview — optional) and Download KMZ (required for KMZ output).

## Session reset checklist (D-UPL-03)

`resetSession()` must:

- Revoke KMZ object URL (`revokeKmzObjectUrl`)
- Clear `currentParseData`, `lastCalcResult`
- Reset `#gpsInput`, `#gpsInputLast`, collapse expander
- Reset appearance controls to `DEFAULT_OPTIONS` equivalents
- Clear `#kmzFilenameInput`, hide `#resultSection`, `#coordForm`
- Clear `#summary`, `#warnings`, `#status`
- Reset upload UI to idle (not filename state)
- Hide debug/ref sections again (even if dev tools were open — user chose new PDF)

## Filename sanitization (D-DL-01)

```js
function resolveKmzFilename(userInput, pdfFileName) {
  let base = (userInput || '').trim();
  if (!base) {
    base = (pdfFileName || 'route').replace(/\.pdf$/i, '');
  }
  base = base.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+/, '') || 'route';
  if (!/\.kmz$/i.test(base)) base += '.kmz';
  return base;
}
```

Store `lastPdfFileName` on successful pick for default.

## Testing Strategy

| Layer | Approach |
|-------|----------|
| Parser progress hook | Optional unit test: mock `onProgress` called with `stage` keys (if test harness exists); else manual |
| UI | Manual UAT checklist in 04-03 plan (João Born PDF fixture) |
| Regression | Existing `node --test` parser tests must pass unchanged |

No Playwright in repo — do not add E2E framework in Phase 4.

## Plan Structure Recommendation (MVP vertical slices)

| Plan | Wave | Delivers |
|------|------|----------|
| 04-01 | 1 | Upload zone, DnD, progress, UI block, `resetSession`, `parsePdf` hook |
| 04-02 | 2 | Appearance panel, expander, `mergeOptions` on calculate/download |
| 04-03 | 3 | Filename, lede/copy, dev-tools toggle, final UAT |

## Risks

| Risk | Mitigation |
|------|------------|
| Forgetting to re-enable UI after parse error | `finally` block in upload handler |
| Partial reset leaves stale KMZ download | Centralize `resetSession()` |
| Debug sections flash on parse | Remove auto-show in success path; only toggle via footer link |
| `mergeOptions` only on download | Wire both handlers; store `lastAppearanceOptions` on calc if needed |

## RESEARCH COMPLETE
