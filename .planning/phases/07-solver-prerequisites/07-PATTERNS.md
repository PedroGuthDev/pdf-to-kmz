# Phase 07: Solver Prerequisites - Pattern Map

**Mapped:** 2026-06-06
**Files analyzed:** 16 (new + modified)
**Analogs found:** 14 / 16 (2 self-modify; every new file has an exact in-repo analog)

> Phase 7 is fixture/gate engineering. Every pattern already exists in-repo and is
> cloned to the missing routes. There is **one** production-code change
> (`parser/post-positioning.js`, the LC layer-B fix). All other files are new test
> harnesses, JSON fixtures, docs, or a `package.json` script edit.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `tools/import-ground-truth-txt.mjs` (new) | utility/transform | file-I/O (txt→JSON) | `tools/run-siriu-post-position-gate.mjs` `seedTruth()` | role-match |
| `tools/run-siriu-txt-accuracy-gate.mjs` (new) | gate/CLI | batch (cascade→tier) | `tools/run-valmor-accuracy-gate.mjs` | role-match |
| `tools/run-lc-txt-accuracy-gate.mjs` (new) | gate/CLI | batch (cascade→tier) | `tools/run-valmor-accuracy-gate.mjs` | role-match |
| `tools/run-joaoborn-txt-accuracy-gate.mjs` (new) | gate/CLI | batch (cascade→tier) | `tools/run-valmor-accuracy-gate.mjs` | role-match |
| `tools/run-valmor-txt-accuracy-gate.mjs` (new) | gate/CLI | batch (cascade→tier) | `tools/run-valmor-accuracy-gate.mjs` | exact |
| `tools/run-joaoborn-post-position-gate.mjs` (new) | gate/CLI | request-response (parse→compare) | `tools/run-lc-post-position-gate.mjs` | exact |
| `tools/run-valmor-post-position-gate.mjs` (new) | gate/CLI | request-response (parse→compare) | `tools/run-lc-post-position-gate.mjs` | exact |
| `parser/__tests__/fixtures/joaoborn-post-positions-truth.json` (new) | fixture/data | static | `luizcarolino-post-positions-truth.json` | exact |
| `parser/__tests__/fixtures/valmor-post-positions-truth.json` (new) | fixture/data | static | `luizcarolino-post-positions-truth.json` | exact |
| `parser/__tests__/fixtures/luizcarolino-junction-ground-truth.json` (new) | fixture/data | static | `siriu-junction-ground-truth.json` | exact |
| `parser/__tests__/fixtures/joaoborn-junction-ground-truth.json` (new) | fixture/data | static (empty junctions) | `siriu-junction-ground-truth.json` | role-match (linear) |
| `parser/__tests__/fixtures/valmor-junction-ground-truth.json` (new) | fixture/data | static | `siriu-junction-ground-truth.json` | exact |
| `parser/__tests__/branch-traversal-{lc,joaoborn,valmor}.test.mjs` (new) | test | event-driven (DFS oracle) | `parser/__tests__/branch-traversal.test.mjs` | exact |
| `parser/__tests__/fixtures/luizcarolino-post-positions-truth.json` (modify) | fixture/data | static | self (extend scope) | self |
| `parser/post-positioning.js` (modify) | service (layer-B placement) | transform | self (`assignPolesGloballyByLabels`) | self |
| `package.json` `scripts.test:gate` (modify) | config | — | self (existing `test:gate` line) | self |
| `.planning/phases/07-solver-prerequisites/07-GATE-AUDIT.md` (new) | doc | — | (no code analog) | n/a |

## Pattern Assignments

### `tools/import-ground-truth-txt.mjs` (utility/transform, txt→JSON) — D-02

**Analog:** `tools/run-siriu-post-position-gate.mjs` (`seedTruth` write pattern) + RESEARCH §5 regex.

**Imports + path bootstrap** (clone from `run-lc-post-position-gate.mjs` lines 20-32):

```js
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "parser", "__tests__", "fixtures");
```

**Core parse loop** (RESEARCH §5 — handle lowercase `poste`, blanks, no-trailing-`;`; Valmor txt is `poste 01; lat, lon` with zero-padded numbers and no trailing semicolon):

```js
const m = line.match(/poste\s+(\d+)\s*;\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/i);
if (!m) continue;                       // skips blank/garbage lines
out.push({ number: +m[1], lat: +m[2], lon: +m[3] });
```

**Write pattern** (mirror `seedTruth` in `run-siriu-post-position-gate.mjs` line 96 — pretty JSON + trailing newline; ground-truth files are a flat array, see `valmor-ground-truth.json`):

```js
writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
```

**Route map:** four routes → four `*-ground-truth.json`. Output shape is a **flat array** of `{ number, lat, lon }` (NOT `{ posts: [...] }`) — verified against `valmor-ground-truth.json`. **Must resolve João Born post-35 anomaly** (drop/flag rows outside the route bounding cluster) per RESEARCH §8.

---

### `tools/run-joaoborn-post-position-gate.mjs` + `joaoborn-post-positions-truth.json` (gate, D-05)

**Analog:** `tools/run-lc-post-position-gate.mjs` (EXACT — hand-known anchor sub-pattern).

**Full structure to clone** — swap `PDF_PATH`, `TRUTH_PATH`, env var name. The whole file is ~110 lines; copy it verbatim and change three constants:

```js
const PDF_PATH = path.join(ROOT, "INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const TRUTH_PATH = path.join(FIXTURES, "joaoborn-post-positions-truth.json");
const tolPt = process.env.JOAOBORN_POST_POS_TOL_PT != null
  ? Number(process.env.JOAOBORN_POST_POS_TOL_PT)
  : (truthDoc._meta?.tolerancePt ?? 50);
```

**Parse → compare core** (`run-lc-post-position-gate.mjs` lines 53-87):

```js
const { parsePdf } = await import("../parser/pdf-parser.js");
const buf = readFileSync(PDF_PATH);
const parsed = await parsePdf(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
if (parsed.error) { console.error(`Parse failed: ${parsed.error}`); process.exit(1); }
const byNum = new Map((parsed.posts ?? []).map((p) => [p.number, p]));
for (const t of truthPosts) {
  const p = byNum.get(t.number);
  if (!p) { failures.push(`post ${t.number}: not parsed (missing)`); continue; }
  const err = Math.hypot((p.x ?? NaN) - t.x, (p.y ?? NaN) - t.y);
  if (err > tolPt) failures.push(`post ${t.number}: ${err.toFixed(1)} pt > tol ${tolPt} pt`);
}
if (failures.length) process.exit(1);
```

**Fixture shape** — clone `luizcarolino-post-positions-truth.json` (`_meta` block with `purpose`/`source`/`scope`/`tolerancePt`, then `posts: [{ number, pageNum, x, y }]`). **All posts** per D-05 (hand-known anchors).

**Note:** `fake-indexeddb/auto` import is required (line 23 of LC gate) — position gates parse real PDFs.

---

### `tools/run-valmor-post-position-gate.mjs` + `valmor-post-positions-truth.json` (gate, D-06)

**Analog:** `tools/run-lc-post-position-gate.mjs` (EXACT — same as JB above).

Same clone as João Born; swap to `INFOVIAS_PJC INTERNET_Palhoça_RUA VALMOR FRANCISCO_v1.pdf` and `valmor-post-positions-truth.json` (all 11 posts). **NEW RISK (RESEARCH §8):** Valmor was previously DWG-only — verify `parsePdf` produces usable per-post `x,y` from the Valmor PDF **before** committing the fixture shape; if pole symbols don't parse, surface as a blocker (D-06 forbids treating Valmor as exempt).

---

### `tools/run-{siriu,lc,joaoborn,valmor}-txt-accuracy-gate.mjs` (gate, D-01/D-03)

**Analog:** `tools/run-valmor-accuracy-gate.mjs` (haversine + ceiling/failure structure) consuming `tools/route-dwg-accuracy-harness.mjs`.

**Harness call** (`runRouteDwgAccuracyHarness` returns `errorsByPost: Map<number, meters>` + per-post lat/lon; see harness lines 82-198):

```js
import { runRouteDwgAccuracyHarness } from "./route-dwg-accuracy-harness.mjs";
const { errorsByPost, posts } = await runRouteDwgAccuracyHarness({
  pdfPath, dwgRegionPath, groundTruthPath, regionId,
});
```

**Tier classifier** (NEW per D-03 — perfect ≤5 / good ≤10 / acceptable ≤15 / bad >15; reuse `haversineMeters` already applied inside the harness so errors arrive in metres):

```js
const tier = (m) => (m <= 5 ? "perfect" : m <= 10 ? "good" : m <= 15 ? "acceptable" : "bad");
const bad = [...errorsByPost].filter(([, m]) => m > 15);
// report histogram per route (planner discretion: zero-bad-tier is the floor)
if (bad.length) {
  for (const [n, m] of bad) console.error(`  x post ${n}: ${m.toFixed(1)} m (BAD >15 m)`);
  process.exit(1);
}
```

**Failure/exit + env-baseline structure** — copy `run-valmor-accuracy-gate.mjs` lines 136-148 (collect `failures[]`, print, `process.exit(1)`). Valmor is the only route with no PDF distance walk; its txt-accuracy gate may instead reuse the DWG-region nearest-INSERT mapping already in `run-valmor-accuracy-gate.mjs` lines 46-67.

---

### `parser/__tests__/fixtures/{luizcarolino,joaoborn,valmor}-junction-ground-truth.json` (D-12/D-13/D-14)

**Analog:** `parser/__tests__/fixtures/siriu-junction-ground-truth.json` (EXACT schema).

**Schema to mirror** (every junction needs `forbiddenArms` — the test asserts it exists):

```json
{
  "junctions": {
    "9": {
      "post": 9, "degree": 3, "slots": 1,
      "forbiddenArms": [11],
      "armMetersChecks": { },
      "arms": [
        { "to": 8,  "meters": 0.0, "label": "from 8", "inbound": true },
        { "to": 10, "meters": 0.0, "label": "->10" },
        { "to": 21, "meters": 0.0, "label": "->21" }
      ]
    }
  },
  "edges": [
    { "from": 8, "to": 9, "meters": 0.0, "arm": true, "junction": 9, "inbound": true }
  ]
}
```

**Per-route specifics:**
- **João Born (D-14, LOCKED linear):** `"junctions": {}` and `edges` = consecutive chain only (1→2→…→34). Zero junctions. The "visits every post once" + "no inferred degree≥3" assertions still apply.
- **Luiz Carolino (D-13, user-curated):** draft `forbiddenArms` from 260602-decouple phantom pairs `3→1`, `11→8`, `9→11`; real branch around 9–11 / 21–31 spur. User must approve before lock.
- **Valmor (D-13):** 11-post near-linear DWG route → likely `"junctions": {}`; user confirms.

---

### `parser/__tests__/branch-traversal-{lc,joaoborn,valmor}.test.mjs` (D-12)

**Analog:** `parser/__tests__/branch-traversal.test.mjs` (EXACT — copy per route, matches repo's per-route-script convention).

**Clone the whole file**, change only the fixture path (line 12):

```js
const FIXTURE = JSON.parse(readFileSync(
  path.join(__dirname, "fixtures", "luizcarolino-junction-ground-truth.json"), "utf8"));
```

Keep `buildGraph(fixture)` (lines 20-50) and the five `test(...)` blocks verbatim. The **forbidden-arm oracle** (lines 130-191) is the Pitfall-10 defense — it asserts every junction declares `forbiddenArms`, no phantom target is incident, and `armMetersChecks` match. For **JB (zero junctions)** the loops over `FIXTURE.junctions` are empty no-ops; the "visits every post once" test (lines 52-66) still runs against the `edges`-only chain.

---

### `parser/post-positioning.js` — `assignPolesGloballyByLabels` (MODIFY, D-09/D-10/D-11)

**Analog:** self. The ONLY production-code change; primary Pitfall-2 risk (shared Siriu code; 4 prior fixes regressed 12–89 Siriu posts).

**Pattern constraint (RESEARCH §3):** **additive predicate only — never edit Siriu-calibrated constants** in `post-positioning.js` or `distance-associator.js`. Add a predicate that recognizes the LC shared-symbol collapse (posts 9/10/11) without altering any path Siriu exercises. Follow the "generic predicate, not literal guard" pattern from 260601-k1a.

**All-green discipline (D-11):** wire the 1.0-pt Siriu position gate (`run-siriu-post-position-gate.mjs`) into the local loop **before** starting this fix; run the full suite after every commit. Never re-seed the Siriu baseline (`SIRIU_POST_POS_UPDATE_BASELINE=1`) to mask a regression. The line-1554 target is documented in CONTEXT canonical refs.

**Also modify** `luizcarolino-post-positions-truth.json` — extend hand-known anchors from posts 1–20 to cover all D-10-scope posts (keep `tolerancePt: 50`). Open question (RESEARCH Q2): whether posts 21–31 rigid offset is in P7 scope or deferred to Phase 8 solver.

---

### `package.json` `scripts.test:gate` (MODIFY, D-17)

**Analog:** self — the existing `test:gate` line (line 13).

**Current:**

```bash
node --test parser/__tests__/graph-walker.test.mjs parser/__tests__/distance-associator.test.mjs parser/__tests__/coordinate-calculator.test.mjs && node tools/run-siriu-regression-gate.mjs && node tools/run-residual-gate.mjs && node tools/run-dxf-ingest-timing-gate.mjs
```

**Extension strategy (RESEARCH §7):** fold the four `branch-traversal*.test.mjs` files into the leading `node --test …` arg list; append each standalone gate as a `&&`-chained step (each `process.exit(1)`s on failure). Add: `run-siriu-post-position-gate.mjs`, `run-lc-post-position-gate.mjs` (only after it greens — Wave 2), `run-joaoborn-post-position-gate.mjs`, `run-valmor-post-position-gate.mjs`, the existing `run-route-joaoborn-pdf-accuracy-gate.mjs` / `run-valmor-accuracy-gate.mjs`, and the four new txt-accuracy gates. Keep `test:gate` as the single umbrella command (D-17).

## Shared Patterns

### PDF parse boilerplate (ArrayBuffer slice)
**Source:** `tools/run-lc-post-position-gate.mjs` lines 53-57 (also in both harnesses).
**Apply to:** every position gate + the Valmor PDF-parse viability check.

```js
const { parsePdf } = await import("../parser/pdf-parser.js");
const buf = readFileSync(PDF_PATH);
const parsed = await parsePdf(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
if (parsed.error) { console.error(`Parse failed: ${parsed.error}`); process.exit(1); }
```

### Env-gated baseline refresh + `process.exit(1)` on failure
**Source:** `tools/run-valmor-accuracy-gate.mjs` lines 91-148; `run-route-joaoborn-pdf-accuracy-gate.mjs` lines 52-105.
**Apply to:** all accuracy/txt gates (NOT the txt-accuracy zero-bad-tier gate, which fails hard rather than re-baselining the bad tier).

```js
const updateBaseline = process.env.ROUTE_UPDATE_BASELINE === "1" || !existsSync(BASELINE_PATH);
if (updateBaseline) { writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n"); return; }
// ...compare to baseline, collect failures[], exit(1) if any
```

### Geo distance (metres)
**Source:** `parser/geo/utm-calibrator.js` → `haversineMeters`, `latLonToUtm`, `utmToLatLon`.
**Apply to:** all txt-accuracy gates (tier classification operates on `haversineMeters` output).

```js
import { haversineMeters } from "../parser/geo/utm-calibrator.js";
errorsByPost.set(g.number, haversineMeters(ll.lat, ll.lon, g.lat, g.lon));
```

### Fixture JSON write convention
**Source:** `tools/run-siriu-post-position-gate.mjs` line 96.
**Apply to:** import script + any seeded fixture: `JSON.stringify(doc, null, 2) + "\n"`, `"utf8"`.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `.planning/phases/07-solver-prerequisites/07-GATE-AUDIT.md` | doc | — | Prose gate-classification doc (fence vs accuracy + D-18 mid-flight policy). No code analog; structure is planner-authored markdown. |
| Baseline cascade run record (SC-4) | doc/record | — | Output capture of the full 4-route cascade with Phase 5 gate active, no solver code. Recording convention is planner discretion. |

**Partial-analog caveats:**
- **txt-accuracy tier classifier** is genuinely new logic (D-03 four-tier vocabulary); only the harness call + failure/exit scaffolding are cloned. No existing gate classifies into perfect/good/acceptable/bad tiers.
- **JB junction fixture** is a *role-match* not exact: it inverts the Siriu pattern (empty `junctions: {}`), so the per-junction oracle loops become no-ops while the linear-chain + no-inferred-degree≥3 assertions carry the weight.

## Metadata

**Analog search scope:** `tools/*.mjs`, `parser/__tests__/**`, `package.json` (main tree only; `.claude/worktrees/*` copies ignored).
**Files scanned (read in full):** `run-lc-post-position-gate.mjs`, `run-siriu-post-position-gate.mjs`, `run-valmor-accuracy-gate.mjs`, `run-route-joaoborn-pdf-accuracy-gate.mjs`, `route-pdf-accuracy-harness.mjs`, `route-dwg-accuracy-harness.mjs`, `branch-traversal.test.mjs`, `siriu-junction-ground-truth.json`, `luizcarolino-post-positions-truth.json`, `valmor-ground-truth.json`, `coordenadas postes rua valmor.txt`, `package.json`.
**Pattern extraction date:** 2026-06-06
