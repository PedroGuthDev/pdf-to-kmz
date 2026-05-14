---
phase: 01-pdf-parser-engine
reviewed: 2026-05-13T00:00:00Z
depth: standard
files_reviewed: 1
files_reviewed_list:
  - test/skeleton-test.html
findings:
  critical: 2
  warning: 3
  info: 2
  total: 7
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-05-13
**Depth:** standard
**Files Reviewed:** 1 (`test/skeleton-test.html`)
**Status:** issues_found

## Summary

The Walking Skeleton HTML page is well-structured for a diagnostic developer tool. The async flow, try/catch wrapper, `textContent`-based DOM writes, and OCG dual-format iterator are all sound patterns. However, two correctness bugs were found — one of which silently corrupts every layer-boundary detection in the graphics pipeline, causing the `Numero_Poste` constructPath counter and all downstream A1 data to be unreliable. A second bug produces a misleading `arg1_length` value in the on-screen summary. Three warnings address missing file validation, a missing `no-referrer` policy, and a worker URL discrepancy. Two info items cover magic numbers and a regex character-class edge.

---

## Critical Issues

### CR-01: Wrong opcode for `endMarkedContent` — layer tracking never resets

**File:** `test/skeleton-test.html:177`

**Issue:** `FN_END_MC` is set to `74`, but every authoritative source in this repository places `endMarkedContent` at `71`:

- `01-RESEARCH.md` line 490: `| endMarkedContent | 71 | [] | Layer end |`
- `01-PATTERNS.md` line 221: `` `71` = endMarkedContent — args: `[]` ``
- `01-PATTERNS.md` lines 93, 208: all pattern code examples use `fn === 71`
- `01-RESEARCH.md` lines 259, 459: same constant

`fn=74` is not documented anywhere. Because the constant never matches, `currentLayerGfx` is never reset to `null` at layer boundaries. Once a `Numero_Poste` `beginMarkedContentProps` event fires, `currentLayerGfx` stays `'Numero_Poste'` for the remainder of the operator list. This inflates `postConstructCount` and makes `firstPostConstructOps` unreliable — the entire A1 assumption resolution logged by this skeleton is incorrect.

Note: `SKELETON.md` line 38 says `fn=70/74/91` in a summary sentence, which appears to be a typo in that document. All code-level references in RESEARCH.md and PATTERNS.md consistently use `71`.

**Fix:**
```javascript
// Line 177 — change 74 to 71
const FN_END_MC = 71;   // endMarkedContent (verified: 01-RESEARCH.md table, line 490)
```

---

### CR-02: `arg1_length` accesses `[1][0].length` instead of `[1].length` — produces `undefined` or wrong dimension

**File:** `test/skeleton-test.html:224`

**Issue:** The on-screen summary builds a diagnostic object for `firstPostConstructOps`:

```javascript
arg1_length: firstPostConstructOps[1]?.[0]?.length,
```

`firstPostConstructOps` is the raw `args` array from a `constructPath` call. Per the resolved A1 data in `SKELETON.md` lines 140–145, `args[1]` is a `Float32Array` with 31 elements (the coordinate array). A `Float32Array` is not an array-of-arrays; `[1][0]` retrieves the first numeric element (a coordinate value, e.g. `-35.5`), and `.length` of a number is `undefined`. The field therefore logs `undefined` instead of `31`, silently hiding the coordinate count.

**Fix:**
```javascript
// Line 224 — access .length directly on args[1]
arg1_length: firstPostConstructOps[1]?.length,
```

---

## Warnings

### WR-01: No file type or size validation before processing

**File:** `test/skeleton-test.html:74–79`

**Issue:** The `change` handler reads any selected file without checking its MIME type or size. The `accept="application/pdf"` attribute on the `<input>` is a UI hint only — it is trivially bypassed. A non-PDF file (e.g., a large binary) will be passed to `pdfjsLib.getDocument`, which will throw a `UnknownErrorException` or silently fail. More practically, the SKELETON.md security policy (line 114) and `01-PATTERNS.md` Size Guard pattern both mandate a 50 MB guard. The current code omits it.

**Fix:**
```javascript
fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
        showStatus('Error: Please select a PDF file.', 'error');
        return;
    }
    if (file.size > 50 * 1024 * 1024) {
        showStatus('Error: File exceeds 50 MB limit.', 'error');
        return;
    }
    // ... existing processing
});
```

---

### WR-02: `workerSrc` points to unminified worker; production pattern uses `.min.mjs`

**File:** `test/skeleton-test.html:63`

**Issue:** The worker URL is:
```
https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.worker.mjs
```

All canonical references in this repository (`01-PATTERNS.md` lines 37 and 66, and the Walking Skeleton pattern at line 67) specify the minified variant:
```
https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.worker.min.mjs
```

Both files exist on jsDelivr, so this does not cause a hard failure. However it creates a discrepancy: if the unminified worker differs in any behavior from the minified build (a rare but possible version-drift scenario), the skeleton's conclusions may not replicate in the main app which will use the minified URL. Consistency also makes CDN cache analysis and integrity verification simpler.

**Fix:**
```javascript
// Line 63
pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.worker.min.mjs';
```

---

### WR-03: No `referrerpolicy` or `crossorigin` on external CDN script — Subresource Integrity absent

**File:** `test/skeleton-test.html:60`

**Issue:** The ESM import loads from an external CDN without a Subresource Integrity (SRI) hash:
```javascript
import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.mjs';
```

`<script type="module">` with a dynamic import from a CDN host sends the page URL as the `Referer` header to jsDelivr. While this is a dev-only tool, SRI hashes on `<script>` and import-map entries prevent supply-chain substitution if the CDN is compromised. ESM `import()` inside a module script cannot use the `integrity` attribute directly, but an import map with integrity is supported in modern browsers. This is lower urgency for a local developer tool, but the version is pinned (`@5.7.284`) which is the prerequisite for adding an SRI hash.

**Fix (import map approach):**
```html
<script type="importmap">
{
  "imports": {
    "pdfjs-dist/build/pdf.mjs": "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.mjs"
  },
  "integrity": {
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.mjs": "sha384-<hash>"
  }
}
</script>
```
If the import map approach is not adopted immediately, add `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline';">` to at least constrain which origins can serve scripts.

---

## Info

### IN-01: Magic numbers `70`, `74`, `91` replaced by named constants — but constant block is missing a comment anchor for `FN_BEGIN_MCP = 70`

**File:** `test/skeleton-test.html:176–178`

**Issue:** The three operator constants are named, which is good. However the comment block at lines 170–172 still repeats the raw numbers in prose (`fn=70`, `fn=74`, `fn=91`). If the constants are ever updated, the comment block will go stale. The constants and the comment should be co-located so they form a single source of truth. Also, since the corrected value is `71` (see CR-01), the comment on line 171 currently reads `fn=74  endMarkedContent` — after fixing CR-01 both the code and the comment need updating.

**Fix:**
```javascript
// OPS constants verified: 01-RESEARCH.md table (line 488-491)
const FN_BEGIN_MCP = 70;  // beginMarkedContentProps  args: [tag, {id: groupId}]
const FN_END_MC    = 71;  // endMarkedContent          args: []
const FN_CONSTRUCT = 91;  // constructPath             args: [ops, coords, bbox]
```
Remove the duplicate inline comment block at lines 168–172 and rely solely on the constant declarations.

---

### IN-02: `stripAccents` regex range `[̀-ͯ]` may miss some combining marks outside the core block

**File:** `test/skeleton-test.html:94`

**Issue:** The combining-diacritic regex is:
```javascript
/[̀-ͯ]/g
```
This covers the Unicode Combining Diacritical Marks block (U+0300–U+036F). For the specific known case (`â` → `a` after NFD), this is correct and sufficient. However, the Unicode Combining Diacritical Marks Supplement block (U+1DC0–U+1DFF) and Extended blocks (U+20D0–U+20FF) are outside this range. If a future OCG layer name contains a character from those blocks, `stripAccents` would silently fail to strip it. The practical risk is low for this PDF's layer names, but the intent is broader "strip all combining marks."

**Fix:**
```javascript
function stripAccents(s) {
    return s.normalize('NFD').replace(/\p{M}/gu, '');
}
```
`\p{M}` with the Unicode flag matches all Mark categories (Mn, Mc, Me), covering all combining diacritics regardless of block.

---

_Reviewed: 2026-05-13_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
