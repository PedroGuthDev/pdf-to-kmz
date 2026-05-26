# Phase 4: Web UI & Integration - Pattern Map

**Mapped:** 2026-05-26  
**Primary file:** `index.html` (inline script + `<style>`)

## File Roles

| File | Role | Phase 4 change |
|------|------|----------------|
| `index.html` | UI shell, event handlers, status/summary | Major — upload zone, appearance, reset, copy |
| `parser/pdf-parser.js` | `parsePdf` | Minor — optional `onProgress` hook |
| `parser/kmz-defaults.js` | `DEFAULT_OPTIONS`, `PRESET_COLORS`, `mergeOptions` | Read-only reference for swatches |
| `parser/kml-builder.js` | `buildKml` | No change — consumes merged options |
| `DESIGN.md` / `PRODUCT.md` | Tokens, UX principles | Read-only |

## Analog: Status & panels (reuse as-is)

From `index.html` — `showStatus`, panel visibility:

```631:640:index.html
      function showStatus(message, type) {
        statusEl.textContent = message;
        statusEl.className = type; // 'error' | 'success' | 'info'
        statusEl.style.display = "block";
      }

      function hideStatus() {
        statusEl.style.display = "none";
        statusEl.className = "";
      }
```

**Phase 4:** Call `showStatus(msg, 'info')` inside `onProgress`; use same function for errors (D-UPL-04, D-PRG-02).

## Analog: KMZ download handler (extend)

```897:933:index.html
      downloadKmzBtn.addEventListener("click", async () => {
        if (!lastCalcResult) return;
        // ...
        const opts = mergeOptions({});
        const { kml, stats } = buildKml(
          lastCalcResult.posts,
          lastCalcResult.connections,
          opts,
        );
        // ...
          a.download = "route.kmz";
```

**Phase 4:** Replace `mergeOptions({})` with `mergeOptions(readAppearanceOptions())` and `a.download = resolveKmzFilename(...)`.

## Analog: Upload handler (replace structure, keep guardrails)

```666:758:index.html
      pdfInput.addEventListener("change", async (e) => {
        clearResults();
        const file = e.target.files[0];
        // size guard, arrayBuffer, parsePdf(buf), error branches, success → coordForm
```

**Phase 4:** Extract `async function handlePdfFile(file)` shared by change + drop; wrap in `setParsingUi(true/false)`; call `parsePdf(buf, { onProgress })`; on success do **not** auto-show debug/ref (D-DBG).

## Analog: clearResults → resetSession

Current `clearResults()` hides panels but is tied to file input change only. **Promote** to `resetSession()` per RESEARCH checklist; call from Change file + Start over.

## Analog: Phase 3 plan 03-04 (download block HTML)

Already present: `#downloadKmzBtn`, `#kmzStats`, disabled hint. Phase 4 adds `#kmzFilenameInput` above button per UI-SPEC.

## New CSS patterns (from 04-UI-SPEC)

```css
#uploadZone {
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  padding: var(--space-lg);
  background: var(--surface);
}
#uploadZone.drag-over {
  background: var(--surface-step);
  border-color: var(--accent);
}
.swatch {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.swatch[aria-checked="true"] {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

Use `aria-checked` on swatch buttons for accessibility (radio-group pattern per color target).

## PRESET_COLORS source of truth

```15:22:parser/kmz-defaults.js
export const PRESET_COLORS = {
  red: '#ff0000',
  green: '#00ff00',
  blue: '#0000ff',
  white: '#ffffff',
  yellow: '#ffff00',
  black: '#000000',
};
```

Generate swatch grids in HTML or JS from `Object.keys(PRESET_COLORS)` imported in module script.

## PATTERN MAPPING COMPLETE
