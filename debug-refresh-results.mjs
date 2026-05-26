/**
 * Regenerate debug_results.txt from current parser + browser-path calculateCoordinates.
 * Run: node debug-refresh-results.mjs
 */
import { writeFileSync, readFileSync } from "fs";
import { parsePdf, calculateCoordinates, CALC_PIPELINE_ID } from "./parser/pdf-parser.js";
import { computeScaleFactor, haversineMeters } from "./parser/geo/utm-calibrator.js";

const PDF = "./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf";
const REF_FILE = "./coordenadas postes rua joao born.txt";

function loadRefs() {
  const refs = [];
  for (const line of readFileSync(REF_FILE, "utf8").split("\n")) {
    const m = line.match(/Poste\s+(\d+).*?(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/i);
    if (m) refs.push({ num: +m[1], lat: +m[2], lon: +m[3] });
  }
  return refs;
}

function dumpParse(parseResult) {
  const lines = [];
  lines.push(
    "══ PARSE DEBUG DUMP ══════════════════════════════════════════════════",
  );
  lines.push(`\nPosts found: ${parseResult.posts.length}`);
  for (const p of parseResult.posts) {
    const ax = p.anchorX != null ? p.anchorX.toFixed(2) : "—";
    const ay = p.anchorY != null ? p.anchorY.toFixed(2) : "—";
    lines.push(
      `  Post ${String(p.number).padStart(2, "0")}: page=${p.pageNum ?? "?"}  x=${p.x != null ? p.x.toFixed(2) : "?"}  y=${p.y != null ? p.y.toFixed(2) : "?"}  anchor=(${ax},${ay})  type=${p.postType ?? "—"}`,
    );
  }
  lines.push(`\nPage dimensions (w × h in PDF points):`);
  for (const [pn, dim] of parseResult.pageDimensions) {
    lines.push(`  Page ${pn}: ${dim.w.toFixed(2)} × ${dim.h.toFixed(2)} pt`);
  }
  lines.push(`\nUTM grid paths per page (isUtmGridLayerName hits):`);
  for (const [pn, paths] of parseResult.utmGridPathsPerPage) {
    lines.push(
      `  Page ${pn}: ${paths.length} path(s)  total ops=${paths.reduce((s, p) => s + p.length, 0)}`,
    );
  }
  const warnings = [];
  let scaleFactor = computeScaleFactor(
    parseResult.utmGridPathsPerPage.get(2) ?? [],
    warnings,
  );
  lines.push(`\nScale factor computation:`);
  lines.push(`  Page 2 UTM paths: ${(parseResult.utmGridPathsPerPage.get(2) ?? []).length}`);
  lines.push(
    `  computeScaleFactor(page2) → ${scaleFactor != null ? scaleFactor.toFixed(6) + " m/pt" : "null"}`,
  );
  if (scaleFactor != null) {
    lines.push(`  → Using scale factor: ${scaleFactor.toFixed(6)} m/pt`);
    lines.push(
      `  → Implied 50m UTM grid spacing: ${(50 / scaleFactor).toFixed(1)} PDF points`,
    );
  }
  lines.push(`\nViewport boxes (paired from page-2 Padrão layer):`);
  lines.push(`  Count: ${parseResult.viewportBoxes.length}`);
  for (const v of parseResult.viewportBoxes) {
    const r = v.rect;
    lines.push(
      `  pageNum=${v.pageNum}  x=${r.x.toFixed(1)}  y=${r.y.toFixed(1)}  w=${r.w.toFixed(1)}  h=${r.h.toFixed(1)}`,
    );
  }
  lines.push(
    "\n══ END DUMP ══════════════════════════════════════════════════════════",
  );
  return lines.join("\n");
}

function compareBlock(refs, parseResult, twoAnchor) {
  const ref1 = refs.find((r) => r.num === 1);
  const calcOpts = {
    utmGridPathsPerPage: parseResult.utmGridPathsPerPage,
    viewportBoxes: parseResult.viewportBoxes,
    pageDimensions: parseResult.pageDimensions,
    distanceLabelItems: parseResult.distanceLabelItems,
    posteRawCentroids: parseResult.posteRawCentroids,
  };
  if (twoAnchor) {
    const ref34 = refs.find((r) => r.num === 34);
    if (ref34) calcOpts.lastPostGps = { lat: ref34.lat, lon: ref34.lon };
  }
  const calcResult = calculateCoordinates(
    JSON.parse(JSON.stringify(parseResult.posts)),
    parseResult.distances,
    ref1.lat,
    ref1.lon,
    parseResult.cableSegments,
    calcOpts,
  );
  const postMap = new Map(calcResult.posts.map((p) => [p.number, p]));
  const pad = (s, n) => String(s).padEnd(n);
  const lines = [];
  lines.push(
    twoAnchor
      ? "\nAnchors: post 1 + post 34 from reference (similarity refinement)"
      : "\nAnchors: post 1 from reference (single-anchor UTM)",
  );
  lines.push(`Pipeline: ${CALC_PIPELINE_ID}`);
  lines.push("");
  lines.push(
    pad("Post", 6) +
      pad("Ref lat", 20) +
      pad("Calc lat", 20) +
      pad("Ref lon", 20) +
      pad("Calc lon", 20) +
      pad("Error (m)", 12) +
      "Status",
  );
  lines.push("─".repeat(102));
  let maxErr = 0;
  let nullCount = 0;
  for (const ref of refs) {
    const calc = postMap.get(ref.num);
    if (!calc || calc.lat == null) {
      nullCount++;
      continue;
    }
    const errM = haversineMeters(ref.lat, ref.lon, calc.lat, calc.lon);
    if (errM > maxErr) maxErr = errM;
    const ok = errM < 5 ? "✓" : errM < 50 ? "~" : "✗";
    lines.push(
      pad(ref.num, 6) +
        pad(ref.lat.toFixed(8), 20) +
        pad(calc.lat.toFixed(8), 20) +
        pad(ref.lon.toFixed(8), 20) +
        pad(calc.lon.toFixed(8), 20) +
        pad(errM.toFixed(2) + "m", 12) +
        ok,
    );
  }
  lines.push("─".repeat(102));
  lines.push(
    `Max error: ${maxErr.toFixed(2)} m  |  Posts with null GPS: ${nullCount}/${refs.length}`,
  );
  lines.push("");
  lines.push("Legend: ✓ < 5m  ~ 5–50m  ✗ > 50m or null");
  const calKeys = (calcResult.warnings ?? []).filter((w) =>
    /seam-lock|seam-locked|boundary-locked|Global label fit|label-lsq|Repositioned/i.test(
      w,
    ),
  );
  if (calKeys.length) {
    lines.push("");
    lines.push("Calibration (compare run):");
    for (const w of calKeys) lines.push("  " + w);
  }
  return { text: lines.join("\n"), maxErr, warnings: calcResult.warnings ?? [] };
}

const buf = readFileSync(PDF);
const parsed = await parsePdf(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);
const refs = loadRefs();

const out = [];
out.push("Parser warnings\n");
for (const w of parsed.warnings ?? []) out.push(`    ${w}`);
out.push("");
out.push(dumpParse(parsed));
const single = compareBlock(refs, parsed, false);
out.push(single.text);
const dual = compareBlock(refs, parsed, true);
out.push("\n");
out.push(dual.text);

writeFileSync("./debug_results.txt", out.join("\n") + "\n");
console.log(
  `Wrote debug_results.txt — browser path max err ${single.maxErr.toFixed(2)} m (single anchor)`,
);
