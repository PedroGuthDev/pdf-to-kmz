---
phase: 01-pdf-parser-engine
reviewed: 2026-05-14T00:00:00Z
depth: deep
files_reviewed: 3
files_reviewed_list:
  - parser/graphics-extractor.js
  - parser/pdf-parser.js
  - parser/text-extractor.js
findings:
  critical: 5
  warning: 4
  info: 3
  total: 12
status: issues_found
---

# Phase 01: Code Review Report (Deep — Parser Files)

**Reviewed:** 2026-05-14
**Depth:** deep
**Files Reviewed:** 3 (`parser/graphics-extractor.js`, `parser/pdf-parser.js`, `parser/text-extractor.js`)
**Status:** issues_found

## Summary

This review focuses on the reported regression: 11 posts in the PDF produce only 1 detected post and 0 distances. All three parser files and their helper modules (`post-assembler.js`, `distance-associator.js`, `construct-path-parser.js`) were read and traced cross-file.

Five critical bugs were found. The most likely root cause of the "1 of 11" regression is CR-01: `OPS_END_MARKED` unconditionally resets `activeLayer = null` in `graphics-extractor.js`, but the PDF likely contains non-OCG `BMC` (fn=69) operators for styling/grouping that are interleaved with the `BDC` (fn=70) OCG markers. Every `EMC` (fn=71) fires on both types, so the first nested `EMC` after `Numero_Poste`'s `BDC` resets `activeLayer` before subsequent `constructPath` calls are seen — yielding only the first circle before the layer is cleared. CR-02 confirms the double-population of `allDistItems`, which is a data-integrity bug producing duplicate distance labels. CR-03 through CR-05 address coordinate-space issues and a broken fallback condition.

---

## Critical Issues

### CR-01: `OPS_END_MARKED` fires on ALL `EMC` operators — non-OCG nested marked content resets `activeLayer` prematurely, losing all but the first circle

**File:** `parser/graphics-extractor.js:107-109` and `parser/text-extractor.js:105-107`

**Issue:** Both extractors set `activeLayer = null` on every `OPS_END_MARKED` (fn=71, `EMC`) event:

```js
// graphics-extractor.js:107-109
case OPS_END_MARKED:
  activeLayer = null;
  break;
```

PDFs routinely nest `BMC` (fn=69, beginMarkedContent — no OCG ID) operators inside `BDC` (fn=70, beginMarkedContentProps — carries OCG ID) operators for layout, artifact marking, and font-encoding grouping. When a non-OCG `BMC` is opened inside the active `Numero_Poste` `BDC`, it is followed by its own `EMC`. That `EMC` fires at fn=71, hits `OPS_END_MARKED`, and sets `activeLayer = null` even though the outer `Numero_Poste` `BDC` has not yet been closed.

The result is that `constructPath` calls for circles 2–11 arrive after `activeLayer` has been cleared by an inner `EMC` and are silently dropped. Only the first circle (between the outer BDC and the first inner BMC's EMC) is captured.

This is consistent with the reported symptom: exactly 1 of 11 posts detected.

**Fix:** Track a layer stack instead of a single `activeLayer` variable. Push on `OPS_BEGIN_MARKED` (when OCG ID is present), pop on `OPS_END_MARKED`. Only push a layer name; non-OCG BMC can push `null` as a no-op layer. Peek the top of the stack to determine the current active layer:

```js
// graphics-extractor.js — replace activeLayer variable with a stack
const layerStack = [];   // replaces: let activeLayer = null;

// In OPS_BEGIN_MARKED:
case OPS_BEGIN_MARKED: {
  if (args && args[1] && args[1].id != null) {
    const rawName = idToName[args[1].id];
    layerStack.push(rawName !== undefined ? rawName : null);
  } else {
    // BMC (no OCG ID) — push null so EMC pops correctly
    layerStack.push(null);
  }
  break;
}

// In OPS_END_MARKED:
case OPS_END_MARKED:
  layerStack.pop();
  break;

// Everywhere activeLayer is read:
const activeLayer = layerStack.length > 0 ? layerStack[layerStack.length - 1] : null;
```

Apply the same fix to `text-extractor.js` (same pattern at lines 98-107).

---

### CR-02: `allDistItems` is populated twice — every distance label appears at least twice, corrupting distance association

**File:** `parser/pdf-parser.js:107-112` and `parser/pdf-parser.js:150-154`

**Issue:** `allDistItems` is declared once (line 77) and written to in two separate places:

1. Lines 107-112: layer-filtered push from `textByLayer` (Distância_Poste layer items, flipY applied).
2. Lines 150-154: all-page `getTextContent` scan — every string matching `/^\d+(\.\d+)?$/` is pushed, which includes all distance labels.

There is no guard like "only do step 2 if step 1 yielded nothing." The all-page scan always executes. If `extractLayerText` successfully found N distance items, `allDistItems` ends up with 2N entries. Each label appears at an identical `(x, y)` position twice.

In `associateDistances`, the nearest-distance search iterates all items and picks the closest to each post-pair midpoint. With duplicates at identical positions, the search still finds the correct label (the duplicate is at the same position), so distances may appear correct numerically. But if any label is missing from the layer-filtered set (CTM correlation failure for even one item), its duplicate from the all-page scan fills in at the same coordinate, masking the failure silently. More dangerously, if two distance labels are very close spatially, having doubled entries for both increases the chance the wrong one wins nearest-neighbor selection.

Beyond correctness risk, the `distItems` count logged at line 163 will be double the true count, misleading debugging.

**Fix:** Replace the all-page `allDistItems` push with a separate array, and only merge it into `allDistItems` if the layer-filtered result was empty:

```js
// Lines 137-155 — separate the two distance sources
const allDistItemsFallback = [];
for (const { page, pageHeight } of pageCache) {
  const textContent = await page.getTextContent();
  for (const item of textContent.items) {
    if (item.str == null) continue;
    const str = item.str.trim();
    if (!str) continue;
    const tx = item.transform[4];
    const ty = item.transform[5];
    const yFlipped = pageHeight - ty;
    if (/^\d{1,3}$/.test(str)) {
      allIntItems.push({ str, x: tx, y: yFlipped });
    }
    const norm = str.replace(',', '.');
    if (/^\d+(\.\d+)?$/.test(norm)) {
      allDistItemsFallback.push({ str, x: tx, y: yFlipped });
    }
  }
}

// Merge distance items: prefer layer-filtered; fall back to all-page scan.
if (allDistItems.length === 0) {
  warnings.push('Layer-specific distance extraction yielded no results; using all-page text fallback for distances.');
  allDistItems.push(...allDistItemsFallback);
}
```

---

### CR-03: Post-candidate proximity match fails when circles and text are in different page-local coordinate spaces (multi-page PDFs)

**File:** `parser/pdf-parser.js:100-117` and `parser/pdf-parser.js:138-155`

**Issue:** For multi-page PDFs, `allCircles` and `allIntItems` accumulate coordinates from all pages. flipY is applied per-page using each page's own `pageHeight`. After flipY, coordinate (x=100, y=200) on page 1 (height=842) means raw y=642, while coordinate (x=100, y=200) on page 2 (height=842) also means raw y=642 — they are numerically identical in the final arrays.

This creates false proximity matches: a circle from page 1 at (100, 200) will be within `PROXIMITY_THRESHOLD` of a text item from page 2 at (100, 200) even though they are on different physical pages. In a PDF where posts span multiple pages and some pages reuse coordinate ranges, this causes wrong pairings.

More critically, if post numbers 1-5 are on page 1 and circles for posts 6-11 are on page 2, the greedy nearest-first matching in `assemblePostData` may pair each number 1-5 to the wrong circle (the one from page 2 that happens to be geometrically closest in the merged coordinate pool), producing incorrect positions.

**Fix:** Attach a `pageNum` field to both circles and text items during collection, and add it as a tiebreaker (same-page matches are preferred, then cross-page matches as a fallback):

```js
// During circle collection (lines 116-118):
for (const circle of gfxResult.circles) {
  allCircles.push({ x: circle.x, y: pageHeight - circle.y, pageNum });
}

// During int item collection (lines 144-149):
allIntItems.push({ str, x: tx, y: yFlipped, pageNum });

// In post-assembler.js assemblePostData: prefer same-page match
// Score: same page → d; different page → d + large_penalty
```

---

### CR-04: `allTextoItems` empty-check is the wrong guard for the all-page fallback — `allIntItems` can be empty while `allTextoItems` is also empty

**File:** `parser/pdf-parser.js:132-136` and `parser/pdf-parser.js:161`

**Issue:** The comment at line 126 says "always collect allIntItems — no CTM correlation needed." But the warning at line 133 only fires when `allTextoItems.length === 0`:

```js
if (allTextoItems.length === 0) {
  warnings.push('Layer-specific text extraction yielded no results; using all-page text fallback.');
}
const allIntItems = [];
// ... fill allIntItems from getTextContent ...
```

The warning is cosmetic — `allIntItems` is ALWAYS filled regardless of whether `allTextoItems` is populated. The actual post-candidate selection at line 161 is:

```js
const postCandidates = allIntItems.length > 0 ? allIntItems : allTextoItems;
```

If `allIntItems` is empty (e.g., the PDF has no single/two/three digit strings from getTextContent — possible if all integers are encoded as glyphs with non-ASCII codepoints), `postCandidates` falls back to `allTextoItems`. But `allTextoItems` comes from CTM correlation which is the approach that was supposedly replaced. If both are empty, `assemblePostData` receives an empty candidate list and finds 0 posts. The rawPosts fallback at line 174 checks `rawPosts.length === 0 && postCandidates.length > 0` — but if `postCandidates.length === 0`, this branch is skipped and posts = `deduplicatePosts([])` = `[]`. The result is silently 0 posts with no warning explaining WHY.

**Fix:** Add an explicit warning when both candidate sources are empty:

```js
if (allIntItems.length === 0 && allTextoItems.length === 0) {
  warnings.push('CRITICAL: No post number candidates found from any source. Check that the TEXTO and Numero_Poste layers exist and contain readable text.');
}
const postCandidates = allIntItems.length > 0 ? allIntItems : allTextoItems;
```

Also remove the confusing early warning at line 133 which fires regardless of whether allIntItems (the true primary source) was populated.

---

### CR-05: `OPS_NEXT_LINE (T*)` in `text-extractor.js` updates `tlm.f` but uses `leading` which defaults to 0 — T* before any TD will produce wrong line advance

**File:** `parser/text-extractor.js:143-147`

**Issue:** The `T*` handler advances the text line matrix by `(0, -leading)`:

```js
case OPS_NEXT_LINE: {
  tlm = { ...tlm, f: tlm.f - leading };
  tm  = { ...tlm };
  break;
}
```

`leading` is initialized to `0` (line 73) and only set by `OPS_LEADING_MOVE_TEXT` (TD). In a BT block that uses `TL` (set leading, OPS constant ≈ 38 — not handled) followed by `T*`, `leading` would remain 0. All `T*` calls produce `tlm.f - 0 = tlm.f` — zero advance. Any text on the second line of a text block using `T*` would be recorded at the same y-position as the first line.

`TL` (set text leading) is operator fn=38 in pdf.js. It is not tracked. The `OPS_NEXT_LINE (T*)` is effectively broken for any PDF that sets leading via `TL` rather than `TD`.

If the TEXTO or Distância_Poste layers use `TL`/`T*` sequences for multi-line text, the computed py values for those showText calls will be wrong, causing them to miss the getTextContent correlation (tolerance is only 1.0 pt).

**Fix:** Add a handler for `TL` (OPS constant 38):

```js
const OPS_SET_LEADING = 38; // TL — set text leading

// In the switch statement:
case OPS_SET_LEADING:
  leading = args[0];
  break;
```

Note: Unlike `TD` which sets `leading = -args[1]`, `TL tl` sets `leading = tl` directly (positive value = descent per line in user space units).

---

## Warnings

### WR-01: `OPS_BEGIN_MARKED` in `text-extractor.js` does not handle BMC (fn=69) — non-OCG marks silently corrupt the layer-stack assumption

**File:** `parser/text-extractor.js:98-103`

**Issue:** Both `beginMarkedContentProps (BDC, fn=70)` and `beginMarkedContent (BMC, fn=69)` produce `EMC (fn=71)` closers. The text extractor only reacts to fn=70 (`OPS_BEGIN_MARKED`). When a BMC fires (fn=69), no layer is pushed, but when its EMC fires at fn=71, `activeLayer` is set to `null` by the `OPS_END_MARKED` handler — same as CR-01. In text-extractor.js, this means a BMC inside a TEXTO BDC silently drops the TEXTO assignment mid-layer, causing some showText calls to be recorded with `layer = null` and lost from the position array, which in turn means those text items won't match in the getTextContent correlation step.

This is the text-extractor analog of CR-01. Fix: apply the same layer-stack approach described in CR-01 to `text-extractor.js`.

---

### WR-02: `readMatrix6` in `graphics-extractor.js` returns `null` on malformed args but caller discards `null` silently — CTM stays unchanged when it should be flagged

**File:** `parser/graphics-extractor.js:81-96`

**Issue:** When `readMatrix6(args)` returns `null` (malformed args — neither a number nor an array), the `OPS_TRANSFORM` handler does `if (!m) break` and silently keeps the old CTM. This means a malformed `cm` operator leaves the CTM unchanged while the PDF stream advances past it. Subsequent operators run with a stale CTM that doesn't match the actual PDF state. For circles, the resulting `ctm.e, ctm.f` values would be wrong, placing those circles at incorrect positions. This won't cause a visible error — circles are still pushed to `allCircles`, but with wrong coordinates that won't match any text item within 50 pts.

**Fix:** Log a warning when `readMatrix6` returns null in the transform handler:

```js
case OPS_TRANSFORM: {
  const m = readMatrix6(args);
  if (!m) {
    console.warn('[gfxExtractor] OPS_TRANSFORM: unreadable matrix args at i=', i, args);
    break;
  }
  // ... existing multiply ...
}
```

---

### WR-03: `PROXIMITY_THRESHOLD = 50` PDF points is undocumented as a tunable constant — may be too small or too large depending on actual PDF scale

**File:** `parser/post-assembler.js:10`

**Issue:** The comment says "50 pt gives enough margin to match the number label positioned near the circle." The SKELETON.md confirms circle radius ≈ 35.5 pt and bounding box 71×71 pt. Post number labels are typically placed outside the circle, meaning the label's text origin could be 35.5 + font_size/2 away from the circle center. At 12pt font, that's ~41–42 pt. At 14pt font, ~42–43 pt. 50 pt provides only ~7–8 pt of margin.

If the PDF uses a larger font for post numbers, or if the labels are placed further from the circle edge, all matches fail (`nearestDist > 50`). With 11 circles and only 1 match found, it is worth verifying whether the remaining 10 post numbers have their nearest circle at 51–100 pt (just over threshold) or at >500 pt (coordinate system mismatch).

The debug log at pdf-parser.js line 162 (`distItems: allDistItems.length`) is present, but there's no log of the per-post nearest circle distance. Adding that log would confirm whether this threshold is the bottleneck.

**Fix (investigation):** Add a diagnostic log in `assemblePostData` before the threshold check:

```js
if (nearestIdx !== -1) {
  console.debug(`[postAssembler] "${trimmed}" nearest circle: ${nearestDist.toFixed(1)} pt`);
}
```

If distances cluster around 60–150 pt, raise `PROXIMITY_THRESHOLD` to 150. If they cluster around 500–1000 pt, the coordinate system mismatch (CR-01 or CR-03) is the root cause.

---

### WR-04: `normalizeName` regex `[̀-ͯ]` covers only U+0300–U+036F — inherited from skeleton review, not fixed in production code

**File:** `parser/ocg-map.js:13`

**Issue:** The combining-mark strip regex is:
```js
s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
```

This range (U+0300–U+036F) covers the core Combining Diacritical Marks block and is sufficient for all known layer names in this PDF. However, the Combining Diacritical Marks Supplement (U+1DC0–U+1DFF) and Extended block (U+20D0–U+20FF) are not covered. Future PDFs with uncommon accent characters in layer names would silently fail to normalize, causing layer validation to fail with `missing_layers` even though the layer exists.

**Fix:**
```js
export const normalizeName = s =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
```

`\p{M}` with the `u` flag matches all Unicode Mark categories (Mn, Mc, Me), covering all combining characters regardless of block.

---

## Info

### IN-01: Multiple `console.debug` and `console.log` calls left in production parser code

**File:** `parser/pdf-parser.js:88,162-167,185-186`, `parser/text-extractor.js:173-174,179`, `parser/graphics-extractor.js:22-23`

**Issue:** Debug logging was added during the fix iterations and not removed. This creates noise for end users in the browser console and leaks internal coordinate values. Examples:
- `pdf-parser.js:88`: `'[parsePdf] page 1 view:'`
- `pdf-parser.js:162-167`: `'[parsePdf] circles: ... intItems: ... distItems: ...'`
- `text-extractor.js:173-174`: `'[textExtractor] positions by layer: ...'`
- `graphics-extractor.js:22-23`: `'[gfxExtractor] packed matrix args detected ...'`

These are valuable during debugging but should be behind a flag or removed before shipping.

**Fix:** Wrap behind a module-level flag:
```js
const DEBUG = false; // set true locally for diagnostics
if (DEBUG) console.debug(...);
```
Or remove after the regression is resolved.

---

### IN-02: `pageCache` array holds live `PDFPageProxy` objects for all pages simultaneously — potential memory pressure on large PDFs

**File:** `parser/pdf-parser.js:82-89`

**Issue:** `pageCache` stores `{ page, pageHeight }` for every page and is iterated again at line 138 to run `getTextContent` for the all-page integer scan. Holding all page proxies in memory simultaneously is unnecessary — the all-page scan could run within the existing page loop, eliminating `pageCache` entirely.

This is noted as out-of-scope for v1 performance review, but flagged here because it adds code complexity for no correctness benefit, and the fix (inline the scan into the existing page loop) also removes a code duplication.

**Fix:** Move the `getTextContent` all-page scan inside the existing `for (let pageNum = 1; ...)` loop and remove `pageCache`.

---

### IN-03: `associateDistances` does not guard against post pairs where both posts have `x=0, y=0` — midpoint of (0,0)→(0,0) is (0,0), which may match a distance label spuriously

**File:** `parser/distance-associator.js:32-35`

**Issue:** If circle extraction fails (all circles at (0,0) due to CTM identity) and the text fallback is used (post positions from text label coordinates), some posts may have `x=0, y=0` if their text origin is at page origin. The midpoint of two (0,0) posts is (0,0). If any distance label happens to be near (0,0) on the page, it is matched. The resulting `meters` value is a real number, not `null`, so no warning is emitted and the downstream Phase 2 code receives a plausible-looking but incorrect distance.

This is a data-integrity issue that could produce silently wrong KMZ output.

**Fix:** After computing midpoint, check that at least one of the two posts has non-zero coordinates:
```js
if ((from.x === 0 && from.y === 0) || (to.x === 0 && to.y === 0)) {
  warnings.push(`Post ${from.number} or ${to.number} has zero coordinates — distance association skipped.`);
  distances.push({ from: from.number, to: to.number, meters: null });
  continue;
}
```

---

_Reviewed: 2026-05-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

---

## Supplemental deep review — post ↔ circle ↔ cable semantics (2026-05-14 follow-up)

**Scope:** `parser/pdf-parser.js`, `parser/post-assembler.js`, `parser/distance-associator.js`, `parser/graphics-extractor.js`, `parser/layer-sources.js`, `parser/cable-builder.js`, `parser/construct-path-parser.js`.

**Stale items in the sections above:** Several earlier findings are **fixed in the current tree**: `graphics-extractor.js` and `text-extractor.js` use a **layer stack** (addresses old CR-01 / WR-01); `pdf-parser.js` attaches **`pageNum`** to circles and candidates and uses a **cross-page penalty** in `assemblePostData` (addresses old CR-03); distance fallback is **merged only when the layer list is empty** (addresses old CR-02); `PROXIMITY_THRESHOLD` is **200** pt in `post-assembler.js` (old WR-03 text referred to 50 pt). Treat the numbered issues below as the active review for “still wrong values after multiple fixes.”

### S-CR-01 (Critical): Target behavior is not what the code optimizes for

**User intent:** Sequential labels like `01`, `02`, … inside **circle geometry**, then the **closest post** to that circle, **considering the cable**.

**What the pipeline actually does:**

1. **Circles:** Centroids come from Numero_Poste (or layer `0`) path subpaths or CTM `(e,f)` fallback (`graphics-extractor.js`, `construct-path-parser.js`). There is **no point-in-circle test** and no use of circle **radius** when pairing text — only distance to the **centroid** within `PROXIMITY_THRESHOLD` (`post-assembler.js`, `integerTextsNearCircles` in `pdf-parser.js`).
2. **Posts:** Final coordinates are **always the circle centroid** after a match (`post-assembler.js` pushes `x: c.x, y: c.y`), not the digit anchor and not “closest point on cable.”
3. **Cable:** `buildCableSegments` decodes **Cabo Projetado** polylines only for segment listing / branch warnings. **`associateDistances` never reads `cableSegments` or `allCablePaths`** — it uses the **straight segment** between post `(x,y)` and picks the nearest distance label to that segment (`distance-associator.js`). Parallel spans or labels offset from the chord can systematically pick the **wrong** meter value.

**Impact:** Even with perfect circle extraction and layer stacks, the **association model** can disagree with a human who judges “inside the red circle” and “along the drawn conductor.” That explains persistent wrong values **without** implying a single low-level bug.

---

### S-CR-02 (Critical): `assemblePostData` is globally greedy on distance only — not on “correct digit for this circle”

**File:** `parser/post-assembler.js` (`assemblePostData`).

**Behavior:** Among all unused `(text, circle)` pairs with Euclidean distance ≤ 200 pt (same page preferred via huge penalty), the algorithm repeatedly picks the **single smallest distance** and commits it.

**Why this fails:** If two labels are each near two circles (symmetric or chain-like layout), **minimum-edge greedy** does not solve a **bipartite matching** problem optimally and does not use the **numeric identity** of the label vs any prior knowledge of route order. Swapped assignments can have very similar total edge length but wrong post numbers at each circle.

**Mitigation directions (design, not implemented):** Hungarian / min-cost matching with costs; or **primary** association by digit **inside** circle bbox; or constrain by **sequential order along cable polyline**.

---

### S-WN-01 (Warning): Leading zeros collapse; duplicate numeric keys merge unpredictably

**Files:** `parser/post-assembler.js`, `parser/pdf-parser.js` (`deduplicatePostsPreferLowerPage`).

**Behavior:** Labels `01` and `1` both become `number: 1` via `parseInt`. Deduplication keeps **one** post per integer (`deduplicatePostsPreferLowerPage`).

**Impact:** PDFs that use zero-padded labels alongside other `1`-digit noise, or two different physical posts that normalize to the same integer, lose information or the wrong row wins by **page number** heuristic.

---

### S-WN-02 (Warning): “First isolated digit” masking can attach the wrong digit to a circle

**Files:** `parser/pdf-parser.js` — `maskedDigitsNearCentroids`, `computePageCircleAnchorStats` (masked branch), `posteLabelsNearCircles` / `loosePostDigitsFromLabelItems`.

**Behavior:** After `maskConductorLikeSpecs`, **`re.exec(masked)` runs once** per text item (first match only). Composite strings can yield a digit that is **not** the post index the author meant for that geometry.

**Impact:** Wrong candidate enters `postCandidates`, then greedy proximity can lock it to a circle.

---

### S-WN-03 (Warning): Inconsistent anchors — Poste-layer proximity uses left edge, other paths use width/2

**File:** `parser/pdf-parser.js` — `posteLabelsNearCircles` uses `it.x` vs circle for `minD`, but emitted candidates use the same `it.x` while `postCandidateAnchorXY` / `textAnchor` use **mid-width** elsewhere.

**Impact:** A wide Poste string can be judged “near” a circle with the left edge while the visual digit sits farther, or vice versa — threshold 200 pt hides some of this but not all scales/fonts.

---

### S-WN-04 (Warning): Distance pairing assumes sorted post **numbers** are consecutive along the route

**File:** `parser/distance-associator.js`.

**Behavior:** Pairs are `(sortedPosts[i], sortedPosts[i+1])` by **numeric id**, not by graph order along the cable.

**Impact:** Missing post, branch, or non-monotonic sheet layout yields **N→N+1** pairs that are not the true consecutive spans; the nearest label to the chord is then **meaningless** for the real span.

---

### S-IN-01 (Info): Layer `"0"` circle filter depends on page-space bbox span

**File:** `parser/graphics-extractor.js` — `layer0Span = { min: 16, max: 360 }` passed into `circleCentroidsFromSubpaths`.

**Impact:** Exports at very different scales can drop real markers or retain non-post geometry. If circles are missing, downstream “near circle” logic has nothing to latch onto.

---

### Suggested verification order (for debugging “wrong values”)

1. Log **`postAssemblyCircles.length`**, **`postCandidates.length`**, and **`rawPosts.length`** after `assemblePostData` (already partly logged) and, for a failing PDF, dump **per-pair** `(label, circleIdx, distance)` for the greedy loop to see swaps vs threshold.
2. Overlay **cable polylines** with post centroids and distance label anchors — if labels sit on the **curve** but far from the **chord**, implement **distance-to-polyline** (or accumulate along cable) before blaming OCG/text.
3. If the product requirement is literally **digit inside circle**, add **radius-aware** containment (from path bbox or known template) rather than centroid-only thresholds.

---

_Supplement reviewed: 2026-05-14_
_Depth: deep (semantic + cross-module)_
