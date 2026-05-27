/**
 * Trace DWG pairing for Siriu (posts 1–10) using real PDF parse when available.
 * Run: node debug-dwg-pair-siriu.mjs [path/to/route.pdf]
 */
import "fake-indexeddb/auto";
import { readFileSync, existsSync } from "node:fs";

import { parsePdf } from "./parser/pdf-parser.js";
import { calculateCoordinatesWithDwg } from "./parser/dwg/coordinate-calculator-dwg.js";
import { createRegionLibrary } from "./parser/dwg/region-library.js";
import { haversineMeters } from "./parser/geo/utm-calibrator.js";

function loadGt(path = "./coordenadas postes siriu.txt") {
  const gt = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/Poste\s+(\d+).*?([-\d.]+)\s*,\s*([-\d.]+)/i);
    if (m) gt.push({ number: +m[1], lat: +m[2], lon: +m[3] });
  }
  return gt;
}

const pdfPath = process.argv[2] ?? "./siriu.pdf";
const gt = loadGt();
const ref1 = gt.find((p) => p.number === 1);
if (!ref1) throw new Error("no post 1 in ground truth");

const library = createRegionLibrary(globalThis.indexedDB);
const dxfText = readFileSync("./siriu.dxf", "utf8");
await library.addRegion("siriu", new Blob([dxfText], { type: "text/plain" }));

let posts;
let distances;
let cableSegments = [];
let opts = { dwgRegionId: "siriu" };

if (existsSync(pdfPath)) {
  console.log(`[trace] Parsing ${pdfPath}...`);
  const buf = readFileSync(pdfPath);
  const parsed = await parsePdf(buf);
  if (parsed.error) {
    console.error("[trace] parse error:", parsed);
    process.exit(1);
  }
  posts = parsed.posts;
  distances = parsed.distances;
  cableSegments = parsed.cableSegments ?? [];
  opts = {
    ...opts,
    utmGridPathsPerPage: parsed.utmGridPathsPerPage,
    viewportBoxes: parsed.viewportBoxes,
    pageDimensions: parsed.pageDimensions,
  };
  console.log(`[trace] PDF posts=${posts.length} distances=${distances.length}`);
} else {
  console.log("[trace] No PDF — skipping (pass siriu.pdf path)");
  process.exit(0);
}

const result = await calculateCoordinatesWithDwg(
  posts,
  distances,
  ref1.lat,
  ref1.lon,
  cableSegments,
  opts,
  library,
);

console.log(`[trace] dwgStatus=${result.dwgStatus} region=${result.dwgRegionId ?? "—"}`);
const dwgWarns = (result.warnings ?? []).filter((w) => w?.kind?.startsWith?.("dwg"));
for (const w of dwgWarns) console.log("  ", w);

const byNum = new Map(gt.map((g) => [g.number, g]));
let dwgN = 0;
for (const p of result.posts.filter((x) => x.number <= 10)) {
  const ref = byNum.get(p.number);
  const err =
    ref && p.lat != null
      ? haversineMeters(p.lat, p.lon, ref.lat, ref.lon).toFixed(2)
      : "—";
  const src = p.source ?? "pdf";
  if (src === "dwg") dwgN++;
  console.log(
    `  post ${String(p.number).padStart(2)}  ${src.padEnd(4)}  err=${err}m`,
  );
}
console.log(`[trace] dwg posts 1-10: ${dwgN}/10`);
