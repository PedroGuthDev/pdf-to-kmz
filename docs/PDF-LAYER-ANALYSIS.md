# INFOVIAS Example PDFs — OCG Layer Analysis

**Generated:** 2026-05-18 (updated with Garopaba + São José samples)  
**Samples analyzed:**

| Key | File | Client | Pages | OCG layers | Parsed posts |
|-----|------|--------|-------|------------|--------------|
| Valmor | `INFOVIAS_PJC INTERNET_Palhoça_RUA VALMOR FRANCISCO_v1.pdf` | PJC INTERNET | 8 | 36 | 11 |
| João Born | `INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf` | PJC INTERNET | 9 | 38 | 34 |
| Luiz Carolino | `INFOVIAS_AAF INTERNET_São José_RUA LUIZ CAROLINO PEREIRA_v1.pdf` | AAF INTERNET | 9 | 33 | 31 |
| Siriu | `INFOVIAS_PJC INTERNET_Garopaba_Praia do Siriu_v01.pdf` | PJC INTERNET | 12 | 34 | **85** |

**Project goal:** Extract fiber post positions and GPS coordinates with high accuracy. This document maps optional content groups (OCG / “layers”) across all sample PDFs, what each carries, and how it relates to **post positioning** and **coordinate calculation**.

**Machine-readable inventory:** `docs/pdf-layer-summary.json` (counts per page; no text samples).

---

## 1. Executive summary

All four files are **INFOVIAS FTTH** civil drawings (AutoCAD → PDF) with the same overall sheet layout: cover (page 1), **overview + UTM** (page 2), **route detail sheets** (pages 3…), then title-block / CTO / cordoalha detail pages. The parser does not need all 33–38 OCG layers — only a small subset drives accuracy:

| Priority | Layers | Role |
|----------|--------|------|
| **Critical** | `Cabo Projetado`, `Distância_Poste`, `UTM`, `Padrão` | Route geometry, ground distances, metric scale, multi-sheet layout |
| **Critical (posts)** | `Numero_Poste` / `"0"`, `Poste` | Circle centroids (markers) and pole symbols / type labels |
| **Important** | `Articulação`, overview digits on page 2 | Links overview thumbnails to detail sheet numbers |
| **Supporting** | `TEXTO`, `txt_moldura_intelig`, `Texto_3` | Titles, sheet refs, legends — rarely sequential route numbers |
| **Noise** | `TrechoPrimarioAereo`, `TrechoSecundarioAereo`, `SegmentoLogradouro`, `norte`, etc. | Utility network context; must not be read as fiber post IDs |

**Scale across projects:**

| Size | Project | Detail sheets | Notes |
|------|---------|---------------|--------|
| Small | Valmor | 2 (pages 3–4) | 11 overview circles; baseline that calibrates well |
| Medium | Luiz Carolino | 3 (pages 3–5) | AAF export; **page 3 only 3 posts** vs 19 on page 4 |
| Large | João Born | 3 (pages 3–5) | Overview clutter (`Distância_Poste` integers on page 2) |
| **XL** | **Siriu** | **6** (pages 3–8) | **85 posts**; page 2 has **83** named circles; **9** `Cabo Projetado` paths on overview |

All four pass required-layer validation (`Numero_Poste`, `TEXTO`, `Distância_Poste`, `Cabo Projetado` in OCG).

**Critical PDF fact (all samples):** Sequential numbers **inside red circles** (01, 02, 07…) are usually **vector paths**, not `Tj`/`TJ` text. `getTextContent()` does not return them at circle positions. Post **numbers** rely on **OCR** (browser) or **route-order assignment** (Node); post **positions** rely on **circle centroids** and/or **Poste** symbol snapping along `Cabo Projetado`.

**New projects (2026-05-18):**

- **Luiz Carolino (AAF):** Same INFOVIAS template as Palhoça; adds layer `Ancoragem_suporte`; omits several Palhoça utility layers (`caixaSubterranea`, `TrechoSecundarioSubterraneo`, `chaveSeccionadora`, `arruamento`). Overview page 2 has **31** named circles for **31** route posts — high overview/detail circle ratio.
- **Siriu (Garopaba):** Largest sample — **12 pages**, six calibrated detail sheets, **26** cable segment groups total. Overview page 2 is extreme (**83** named circles, **9** fiber polylines on one sheet). Stress-tests multi-sheet viewport pairing and per-page UTM scale (pages 3–8).

---

## 2. Document architecture (pages)

### Valmor (8 pages)

| Page | Role | Named circles | Layer `"0"` circles | Poste symbols | Cable paths |
|------|------|---------------|---------------------|---------------|-------------|
| 1 | Cover / legend | 0 | 0 | 0 | 0 |
| 2 | **Overview** + UTM grid | 11 | 6 | 394 | 1 |
| 3 | Route detail | 6 | 6 | 268 | 2 |
| 4 | Route detail | 5 | 6 | 146 | 1 |
| 5 | Title block (degenerate) | 0 | 54 | 0 | 0 |
| 6–7 | Details (CTO, cordoalha) | 0 | 12–19 | 0 | 0 |
| 8 | Detail / legend | 16 | 56 | 0 | 0 |

**Parser output today:** 11 posts on pages **3–4**; page 2 skipped for OCR (“not viewport-calibrated route detail”).

### João Born (9 pages)

| Page | Role | Named circles | Layer `"0"` circles | Poste symbols | Cable paths |
|------|------|---------------|---------------------|---------------|-------------|
| 1 | Cover / legend | 0 | 0 | 0 | 0 |
| 2 | **Overview** (dense) | **34** | 6 | 144 | 1 |
| 3 | Route detail | 14 | 6 | 123 | 1 |
| 4 | Route detail | 11 | 6 | 69 | 1 |
| 5 | Route detail | 9 | 6 | 81 | 1 |
| 6 | Title block (degenerate) | 0 | 54 | 0 | 0 |
| 7–8 | Details | 0 | 12–19 | 0 | 0 |
| 9 | Detail / legend | 16 | 56 | 0 | 0 |

**Parser output today:** 34 posts on pages **3–5**; pages 2, 6–9 skipped for OCR on overview/legend.

### Luiz Carolino — São José (9 pages, AAF)

| Page | Role | Named circles | Layer `"0"` | Poste symbols | Cable paths |
|------|------|---------------|-------------|---------------|-------------|
| 1 | Cover | 0 | 0 | 0 | 0 |
| 2 | **Overview** | **31** | 6 | 265 | **3** |
| 3 | Route detail (short) | 3 | 6 | 45 | 1 |
| 4 | Route detail (main) | 19 | 6 | 126 | 3 |
| 5 | Route detail | 9 | 6 | 101 | 1 |
| 6 | Title block (degenerate) | 0 | 54 | 0 | 0 |
| 7–9 | Details / legend | 0 | 12–56 | 0 | 0 |

**Parser output today:** 31 posts on pages **3–5** (3 + 19 + 9). Page 3 is unusually sparse — only **3** posts on a full detail sheet (verify viewport box / OCR for that sheet). Multiple `Cabo Projetado` batches on pages 2 and 4 (branches or overview fibers).

### Siriu — Garopaba (12 pages)

| Page | Role | Named circles | Layer `"0"` | Poste symbols | Cable paths |
|------|------|---------------|-------------|---------------|-------------|
| 1 | Cover | 0 | 0 | 0 | 0 |
| 2 | **Overview** (very dense) | **83** | 6 | 0 | **9** |
| 3 | Route detail | 12 | 6 | 68 | 2 |
| 4 | Route detail | 12 | 6 | 93 | 2 |
| 5 | Route detail | 12 | 6 | 61 | 2 |
| 6 | Route detail | 22 | 6 | 80 | 3 |
| 7 | Route detail | 20 | 6 | 67 | 6 |
| 8 | Route detail | 7 | 6 | 74 | 2 |
| 9 | Title block (degenerate) | 0 | 54 | 0 | 0 |
| 10–12 | Details / legend | 0 | 12–56 | 0 | 0 |

**Parser output today:** 85 posts on pages **3–8** (12+12+12+22+20+7). **Six** viewport-calibrated sheets — highest multi-page offset complexity in the corpus. Page 2 must not be treated as 83 posts; OCR skipped there by design.

**Shared pattern:** Route work lives on **detail sheets** (typically pages 3+). Page **2** is the **index map** with `Padrão` viewport rectangles and `UTM` grid. Pages with **54 layer-`"0"` circles** and no cable are **title/degenerate CTM** pages — filter, do not treat as posts.

---

## 3. Complete OCG layer catalog

Layers are listed alphabetically. **Role** indicates parser relevance.

### 3.1 Core layers (all four PDFs)

These ~30 layers appear in every sample and drive (or clutter) parsing:

| Layer | Content type | Typical content | Post positioning | Coordinates |
|-------|----------------|-----------------|------------------|-------------|
| **`0`** | Graphics + some text | AutoCAD default; **post marker circles** (when not on `Numero_Poste`), sheet numbers `03`/`04`/`05`, project title | **Circle centroids** (fallback if named layer empty); page index digits on detail sheets | Low direct; anchors overview labels |
| **`Articulação`** | Text | Sheet jump labels `03`, `04`, `05` on overview | Overview navigation | Pairs with `Padrão` rects → which detail page is which viewport |
| **`Block`** | Graphics | Reusable blocks | Ignore | Ignore |
| **`Cabo Projetado`** | Polylines | **Fiber route** (red line) | **Arc-length ordering**; snap `Poste` symbols to cable; refine off-cable poles | Defines along-route direction |
| **`ChaveFusivel`** | Text + graphics | Fuse IDs, e.g. `40K\n80520\nPLA05` | Noise (contains digit runs) | Ignore |
| **`Cordoalha Dielétrica`** | Text + graphics | Messenger wire legend (page 1) | Ignore | Ignore |
| **`Distância_Poste`** | Text | **Inter-post distances** `32,4` `37,8` (comma decimals) | Associates span labels to post pairs | **Ground-truth meters** along route; do not confuse with page numbers on overview |
| **`Espinar`** | Graphics | Spike/anchor symbology | Ignore | Ignore |
| **`Lateral`** | Graphics | Side detail frames | Ignore | Ignore |
| **`Layer1`** | Graphics | Detail drawings (page 6–9) | False circles on legend pages | Ignore |
| **`Numeração_Cabo`** | Text | Cable spec `CFOA SM ASU 80S 12` | Ignore | Ignore |
| **`Numero_Poste`** | Graphics (+ rare text) | **Double-circle post markers**; centroids = PDF x,y | **Primary circle source** when present; OCR target region | **Primary metric anchors** per page |
| **`PROJ_TXT_tpa`** | Text/graphics | Project text primitives | Ignore | Ignore |
| **`Padrão`** | Rectangles | **Viewport thumbnail boxes** on page 2 | Defines crop regions for OCR per sheet | **Multi-page offset**: links overview tiles → detail pages |
| **`Passivo_Existente`** / **`Passivo_Projetado`** | Graphics | Existing/proposed passive plant | Clutter near route | Ignore |
| **`Poste`** | Graphics + text | **Pole symbols** (square+X) + types `10-150 (U)`, `11-300 (U)` | **`postType`**; snap post xy to nearest pole symbol along cable | Secondary position anchor |
| **`Reserva_Projetada`** | Text | Slack `15,00 MTS`, `EMENDA CTO` | Ignore | Ignore |
| **`SeccionamentoSecundarioAereo`** | Graphics | Secondary aerial sections | Noise paths | Ignore |
| **`SegmentoLogradouro`** | Text | Street names | Ignore | Ignore |
| **`TEXTO`** | Text + graphics | Generic annotations (large path count on overview) | Alias in `layer-sources.js`; **no reliable route digits** in samples | Ignore |
| **`TEXTO_80`** | Graphics | North arrow / frame text | Ignore | Ignore |
| **`Texto_3`** | Text | Title block, `MAIO/2025`, detail titles | Ignore | Ignore |
| **`TrafoDistAereo`** | Text + graphics | Transformer IDs, ratings | Noise | Ignore |
| **`Travessia`** | Text | Crossing height `ALTURA: 5,20m` | Ignore | Ignore |
| **`TrechoPrimarioAereo`** | Graphics | Primary aerial spans (heavy linework) | **False circles** if read from layer `"0"` span filter | Ignore |
| **`TrechoSecundarioAereo`** | Graphics | Secondary aerial | Same | Ignore |
| **`TrechoSecundarioSubterraneo`** | Graphics | Underground secondary | Same | Ignore |
| **`UTM`** | Grid lines | **50 m UTM grid** on route pages | — | **`metersPerPoint`** calibration per page |
| **`aterramento`** | Graphics | Grounding symbols | Clutter | Ignore |
| **`caixaSubterranea`** | Graphics | Underground boxes | Clutter | Ignore |
| **`chaveSeccionadora`** | Text + graphics | Sectionalizer IDs | Noise | Ignore |
| **`flyTapSecundario`** | Graphics | Tap symbols | Clutter | Ignore |
| **`norte`** | Graphics | North arrow geometry | Huge path count | Ignore |
| **`txt_moldura_intelig`** | Text | Smart frame: fiber count, norms, `VER PRANCHA 04` | Cross-sheet pointers | Ignore |

### 3.2 Palhoça-only layers (Valmor / João Born)

| Layer | In Valmor | In João Born | Notes |
|-------|-----------|--------------|--------|
| **`arruamento`** | Yes | No | Street layout on overview |
| **`caixaSubterranea`** | Yes | Yes | Underground boxes |
| **`TrechoSecundarioSubterraneo`** | Yes | Yes | Underground secondary spans |
| **`BancoCapacitor`** | No | Yes | Capacitor bank IDs |
| **`LanceDutos`** | No | Yes | Duct runs |
| **`religador`** | No | Yes | Recloser IDs |

### 3.3 Garopaba + AAF layers (Luiz Carolino / Siriu)

| Layer | Luiz Carolino | Siriu | Notes |
|-------|---------------|-------|--------|
| **`Ancoragem_suporte`** | Yes | Yes | Anchor/support symbology — **new**; ignore for posts/GPS unless symbols overlap route |
| **`chaveSeccionadora`** | No | Yes | Sectionalizer (Siriu matches João Born here) |

**Absent in both new PDFs (present in Palhoça):** `arruamento`, `caixaSubterranea`, `TrechoSecundarioSubterraneo`, `BancoCapacitor`, `LanceDutos`, `religador` (except Siriu has `chaveSeccionadora`).

---

## 4. Required layers vs. what the PDF actually uses

`validateLayers()` requires these OCG names (accent-normalized):

1. `Numero_Poste`
2. `TEXTO`
3. `Distância_Poste`
4. `Cabo Projetado`

All four samples **include all four** in the OCG dictionary.

| Layer | Declared | Used for route extraction in practice |
|-------|----------|--------------------------------------|
| `Numero_Poste` | Yes | Strong on overview + detail in all samples. **Siriu page 2:** 83 circles (overview only). **Luiz Carolino page 2:** 31. Merged with layer `"0"` when named count is zero. |
| `TEXTO` | Yes | Present; **route sequential digits not extracted as text** near circles. |
| `Distância_Poste` | Yes | Primary distance labels on route pages; **trap on page 2** (integer meters vs sheet numbers). |
| `Cabo Projetado` | Yes | 1–3 batches per detail page; **Siriu page 2:** 9 batches (multi-branch overview). |

**Implication:** Validation passing does not guarantee text-based post numbering. Accuracy still depends on **graphics + OCR + Poste snapping**.

---

## 5. Layer-by-layer deep dive (accuracy-focused)

### 5.1 Post positioning

#### `Numero_Poste` and layer `"0"`

- **Graphics:** Closed paths (double circle) → centroids via `constructPath` + CTM (`graphics-extractor.js`).
- **Named vs. `"0"`:** Parser prefers `namedLayerCircles`; uses `layer0Circles` only if named count is zero (WR-01).
- **Duplicates:** Fill+stroke draws two paths per circle → dedupe &lt; 8 pt.
- **João Born page 2:** 34 named circles on the **overview** — not 34 route posts; OCR is skipped there intentionally. Route posts come from pages 3–5 (14+11+9 = 34).
- **Bad pages:** All centroids near `(2, pageHeight−2)` → skip (degenerate CTM), e.g. pages 5–6 pattern.

#### `Poste`

- **Graphics:** Square-with-X and similar pole symbols → `posteSymbols[]`.
- **Text:** `dd-ddd (U)` pole specs → `postType` via `attachPostTypeLabels`.
- **Must not** be used as sequential route numbers (`10-150` → 10 is not post #10).
- **`post-positioning.js`:** Snaps markers to nearest pole on `Cabo Projetado` within PDF-pt tolerances; fixes off-cable poles using neighbors.

#### `TEXTO`, `txt_moldura_intelig`, `Texto_3`

- Treated as post-label **aliases** in `layer-sources.js` for legacy/vendor exports.
- In all four PDFs: **no whole-digit route numbers** (`01`…`NN`) in operator-list text near circles on route pages.
- `txt_moldura_intelig`: project metadata, “VER PRANCHA NN”.

#### Vector digits inside circles

- Confirmed by `inspect-route-markers.mjs`: `getTextContent` whole-digit items at circle locations ≈ **0**.
- **Actionable:** Keep OCR pipeline (browser); optional future: vector glyph recognition on `Numero_Poste` paths.

#### `Cabo Projetado`

- Single (or few) polylines per route page.
- Used to: build `cableSegments`, order posts along arc length, validate pole snaps, reposition off-cable markers between neighbors.

---

### 5.2 Coordinate calculation

#### `UTM`

- Grid line paths on overview + detail pages (12–38 path batches per route page in samples).
- `utm-calibrator.js` measures spacing → **`metersPerPoint`** (scale).
- **Observed scales (debug):** João Born page 2 ≈ **1.27 m/pt** vs. Valmor ≈ **0.82 m/pt**; detail pages ≈ **0.35 m/pt** both — overview vs. detail zoom differs; per-page calibration is required.

#### `Padrão`

- Viewport rectangles on **page 2 only** (4–6 boxes &lt; 60% page size).
- Paired with two-digit labels (`03`…`05`) to build `viewportBoxes[]` → per-detail-page transforms in `coordinate-calculator.js`.

#### `Articulação` and overview digits

- **Valmor page 2:** `03`, `04`, `05` in `Articulação` (sheet index).
- **João Born page 2:** Same plus **extra** two-digit values from `Distância_Poste` (e.g. `34`) and duplicate `34` labels — caused false `pageNum: 34` pairings before `pairLabelsToRects` filter (`n > numPages` rejected).
- **Rule:** Only accept viewport labels `3 ≤ n ≤ numPages` and prefer **one-to-one** label–rectangle pairing.

#### `Distância_Poste`

- Brazilian format: `34,3` → 34.3 m.
- **Coordinate use:** Segment lengths for chaining GPS along route after anchor; cross-check against UTM-scaled PDF distances.
- **Trap:** Integer labels like `34` on overview are **meters**, not sheet **34**.

#### Layers that distort scale if misused

| Layer | Risk |
|-------|------|
| `TrechoPrimarioAereo` / `TrechoSecundarioAereo` | Long spans → false layer-`"0"` “circles” if span filter is too wide |
| `norte` / `Block` | Huge path counts — performance only |
| Page 8/9 `Layer1` + `Distância_Poste` | Detail dimensions `160 mm` — not route spans |

---

## 6. Side-by-side comparison

| Aspect | Valmor | João Born | Luiz Carolino | Siriu |
|--------|--------|-----------|---------------|-------|
| Client / city | PJC / Palhoça | PJC / Palhoça | **AAF** / São José | PJC / Garopaba |
| Pages | 8 | 9 | 9 | **12** |
| OCG layers | 36 | 38 | 33 | 34 |
| Route posts (parsed) | 11 | 34 | 31 | **85** |
| Detail pages (posts) | 3–4 | 3–5 | 3–5 | **3–8** |
| Posts per detail page | 6, 5 | 14, 11, 9 | **3**, 19, 9 | 12, 12, 12, 22, 20, 7 |
| Overview named circles (p.2) | 11 | 34 | 31 | **83** |
| `Cabo Projetado` on page 2 | 1 | 1 | 3 | **9** |
| Cable segments (parsed) | 4 | 4 | 8 | **26** |
| Distances (parsed) | 10 | 33 | 30 | **84** |
| Extra layers | `arruamento` | `religador`, ducts, capacitor | `Ancoragem_suporte` | `Ancoragem_suporte` |
| Coordinate risk | Low (reference) | Multi-sheet drift | Uneven sheet density (p.3) | **6-sheet** viewport + scale |

---

## 7. Recommendations for accuracy work

### Post positioning

1. **Trust centroids** from `Numero_Poste` / `"0"`, not `TEXTO` digits inside circles.
2. **Always snap** to `Poste` graphics + `Cabo Projetado` after centroid extraction (`post-positioning.js`).
3. **Keep strict filters** on layer-`"0"` circle size (50–120 pt bbox) to avoid aerial-line false positives.
4. **OCR:** Browser-only today; consider vector path analysis as fallback for Node CI.
5. **Overview page 2:** Do not assign post numbers from overview circles; use detail pages only.

### Coordinate calculation

1. **Per-page UTM scale** — never assume Valmor scale applies to João Born overview.
2. **Viewport pairing:** Reject `Distância_Poste` integers as sheet IDs; keep `maxPageNum` guard.
3. **Multi-sheet offsets:** João Born (3 detail sheets), Luiz Carolino (3), **Siriu (6)** need correct `viewportBoxes`; verify `buildPageTransforms` with 3+ boxes. Siriu is the regression case for cumulative offsets.
4. **Siriu page 2:** Nine overview fiber paths — do not merge into a single route; detail sheets 3–8 each have their own `Cabo Projetado`.
5. **Distances:** Use `Distância_Poste` on **detail pages** only for along-route chaining.
6. **Anchor:** First post GPS from external reference file; propagate with calibrated PDF geometry.
7. **`Ancoragem_suporte`:** Present in AAF/Garopaba exports — treat as graphics noise unless future rules need anchor geometry.

### Layer map maintenance

- Extend `layer-sources.js` only when new vendor aliases appear (e.g. `Texto_3`, `txt_moldura_intelig`).
- Do **not** add `TrechoSecundarioAereo` or `SegmentoLogradouro` as post or distance sources.

---

## 8. How to reproduce

```bash
# Full per-layer text/path inventory (verbose)
node analyze-pdf-layers.mjs

# Compact JSON for all PDFs in repo root (page circles + parse counts)
node analyze-pdf-layers.mjs
# → docs/pdf-layer-summary.json

# Route marker / text-near-circle diagnostic
node inspect-route-markers.mjs "INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf" --all

# Per-page Tj/TJ histogram
node debug-pdf.mjs --all
```

---

## 9. Related project files

| File | Purpose |
|------|---------|
| `parser/ocg-map.js` | OCG enumeration + required layer validation |
| `parser/layer-sources.js` | Layer name → semantic role |
| `parser/graphics-extractor.js` | Circles, cable, Poste symbols by layer |
| `parser/text-extractor.js` | Layer-filtered text via CTM + operator list |
| `parser/pdf-parser.js` | Orchestration, viewport pairing, OCR |
| `parser/post-positioning.js` | Pole snap + cable ordering |
| `parser/coordinate-calculator.js` | UTM calibration + GPS |
| `parser/geo/utm-calibrator.js` | Grid scale math |
| `.planning/debug/joao-born-coords-off.md` | João Born coordinate debug log |

---

*This analysis reflects all INFOVIAS `*.pdf` files in the repository root. Re-run `node analyze-pdf-layers.mjs` after adding projects or drawing revisions.*
