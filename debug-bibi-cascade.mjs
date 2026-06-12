import { readFileSync } from "node:fs";
import "fake-indexeddb/auto";
import { parsePdf } from "./parser/pdf-parser.js";
import { calculateCoordinatesWithDwg } from "./parser/dwg/coordinate-calculator-dwg.js";
import { parseDxfText } from "./parser/dwg/dxf-loader.js";
import { formatDwgWarning } from "./parser/dwg/coordinate-calculator-dwg.js";
import {
  buildRegionBundle,
  createFixtureLibrary,
} from "./tools/route-dwg-accuracy-harness.mjs";

const START = { lat: -27.664804936522657, lon: -48.71465894265491 };
const PDF = "INFOVIAS_PJC INTERNET_Palhoça_RUA BIBI FERREIRA (Final)_v1.pdf";

function objectToMap(o) {
  if (o == null) return null;
  if (o instanceof Map) return o;
  const m = new Map();
  for (const [k, v] of Object.entries(o)) m.set(Number.isFinite(+k) ? +k : k, v);
  return m;
}

const pdfBuf = readFileSync(PDF);
const parsed = await parsePdf(
  pdfBuf.buffer.slice(pdfBuf.byteOffset, pdfBuf.byteOffset + pdfBuf.byteLength),
);
if (parsed.error) throw new Error(`parsePdf: ${parsed.error}`);

console.log(`PDF posts: ${(parsed.posts ?? []).length}`);
console.log(
  "post numbers:",
  (parsed.posts ?? []).map((p) => p.number).sort((a, b) => a - b).join(","),
);
console.log("\nParsed distances (label list):");
for (const d of parsed.distances ?? []) {
  console.log(
    `  ${d.from}→${d.to}: ${d.meters ?? d.distance ?? "?"} m` +
      (d.page != null ? ` (page ${d.page})` : ""),
  );
}

const dxf = parseDxfText(readFileSync("Palhoca.dxf", "utf8"));
const bundle = buildRegionBundle("palhoca", dxf.posts ?? [], dxf.cableEdges ?? []);
bundle.primaryCableEdges = dxf.primaryCableEdges ?? [];
const library = createFixtureLibrary(bundle);

const solverDebugSink = {};
const result = await calculateCoordinatesWithDwg(
  parsed.posts,
  parsed.distances,
  START.lat,
  START.lon,
  parsed.cableSegments,
  {
    pageDimensions: objectToMap(parsed.pageDimensions),
    viewportBoxes: parsed.viewportBoxes ?? [],
    utmGridPathsPerPage: objectToMap(parsed.utmGridPathsPerPage),
    distanceLabelItems: parsed.distanceLabelItems ?? [],
    cablePaths: parsed.cablePaths ?? [],
    solverDebugSink,
  },
  library,
);

console.log(`\ndwgStatus: ${result.dwgStatus}`);
console.log(`solver demotion reason: ${solverDebugSink.level0Reason}`);
console.log(`solver score:`, solverDebugSink.level0Score);
console.log("\nWarnings:");
for (const w of result.warnings ?? []) {
  console.log("  " + (typeof w === "string" ? w : `${formatDwgWarning(w)}  ${JSON.stringify(w)}`));
}

console.log("\nFinal posts (source, tier):");
for (const p of result.posts ?? []) {
  console.log(
    `  Poste ${p.number}: ${p.lat?.toFixed(7)}, ${p.lon?.toFixed(7)} [${p.source ?? "pdf"}]` +
      (p.confidenceTier ? ` tier=${p.confidenceTier}` : "") +
      (p.anchorGapM != null ? ` anchorGap=${p.anchorGapM.toFixed(1)}m` : ""),
  );
}
