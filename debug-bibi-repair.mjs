import { readFileSync } from "node:fs";
import "fake-indexeddb/auto";
import { parsePdf } from "./parser/pdf-parser.js";
import { calculateCoordinates } from "./parser/coordinate-calculator.js";
import { parseDxfText } from "./parser/dwg/dxf-loader.js";
import { buildRegionBundle, createFixtureLibrary } from "./tools/route-dwg-accuracy-harness.mjs";
import { calculateCoordinatesWithDwg } from "./parser/dwg/coordinate-calculator-dwg.js";
import { latLonToUtm, utmFromPdfPoint } from "./parser/geo/utm-calibrator.js";
import { buildCablesByPage } from "./parser/cable-builder.js";

const START = { lat: -27.664804936522657, lon: -48.71465894265491 };
const PDF = "INFOVIAS_PJC INTERNET_Palhoça_RUA BIBI FERREIRA (Final)_v1.pdf";

const pdfBuf = readFileSync(PDF);
const parsed = await parsePdf(
  pdfBuf.buffer.slice(pdfBuf.byteOffset, pdfBuf.byteOffset + pdfBuf.byteLength),
);

function objectToMap(o) {
  if (o == null) return null;
  if (o instanceof Map) return o;
  const m = new Map();
  for (const [k, v] of Object.entries(o)) m.set(Number.isFinite(+k) ? +k : k, v);
  return m;
}
const opts = {
  pageDimensions: objectToMap(parsed.pageDimensions),
  viewportBoxes: parsed.viewportBoxes ?? [],
  utmGridPathsPerPage: objectToMap(parsed.utmGridPathsPerPage),
  distanceLabelItems: parsed.distanceLabelItems ?? [],
  cablePaths: parsed.cablePaths ?? [],
};

const pdfResult = calculateCoordinates(
  parsed.posts, parsed.distances, START.lat, START.lon, parsed.cableSegments, opts,
);
console.error("pageTransforms:", pdfResult.pageTransforms?.size);

const dxf = parseDxfText(readFileSync("Palhoca.dxf", "utf8"));
const bundle = buildRegionBundle("palhoca", dxf.posts ?? [], dxf.cableEdges ?? []);
bundle.primaryCableEdges = dxf.primaryCableEdges ?? [];
const library = createFixtureLibrary(bundle);

const sink = {};
const result = await calculateCoordinatesWithDwg(
  parsed.posts, parsed.distances, START.lat, START.lon, parsed.cableSegments,
  { ...opts, solverDebugSink: sink },
  library,
);

// reproduce repair internals
const coords = (result.posts ?? []).filter(p => p.source === "dwg")
  .map(p => ({ postNumber: p.number, lat: p.lat, lon: p.lon }));
const utmByPost = new Map();
for (const c of coords) {
  const u = latLonToUtm(c.lat, c.lon);
  utmByPost.set(c.postNumber, { x: u.easting, y: u.northing });
}
console.error("\nedges (printed vs solved span):");
const printedMap = new Map();
for (const d of parsed.distances) {
  if (Math.abs(d.from - d.to) === 1 && d.meters > 0)
    printedMap.set(Math.min(d.from, d.to), d.meters);
}
for (const [lo, p] of [...printedMap].sort((a, b) => a[0] - b[0])) {
  const a = utmByPost.get(lo), b = utmByPost.get(lo + 1);
  if (!a || !b) { console.error(`  ${lo}->${lo+1}: missing utm`); continue; }
  const span = Math.hypot(a.x - b.x, a.y - b.y);
  const miss = Math.abs(span - p);
  console.error(
    `  ${lo}->${lo+1}: printed=${p} span=${span.toFixed(1)} miss=${miss.toFixed(1)} rel=${(miss/p*100).toFixed(0)}% bad=${miss/p > 0.25 && miss > 3}`,
  );
}

// cable polylines page 3
const tf = pdfResult.pageTransforms?.get(3);
console.error("\ntransform page3:", tf && { oe: tf.origin_e, on: tf.origin_n, sf: tf.x_scale_sf, theta: tf.theta, affine: !!tf.affine });
const cbp = buildCablesByPage(parsed.cablePaths ?? []);
console.error("cable pages:", [...cbp.keys()], "paths page3:", cbp.get(3)?.length);

console.error("\nrepair warnings:", (result.warnings ?? []).filter(w => w?.kind === "dwg-virtual-pole-repair"));
console.error("\nfinal posts 1-6:");
for (const p of (result.posts ?? []).slice(0, 6))
  console.error(`  ${p.number}: ${p.lat?.toFixed(7)}, ${p.lon?.toFixed(7)} block=${p.dwg_block}`);
