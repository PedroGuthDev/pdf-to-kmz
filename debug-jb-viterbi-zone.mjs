// JB 7-13 zone: chosen nodes vs true nodes, chosen spans vs printed vs true,
// and the local cable arc pole spacing — the cost competition in detail.
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import "fake-indexeddb/auto";
import { parsePdf } from "./parser/pdf-parser.js";
import { calculateCoordinatesWithDwg } from "./parser/dwg/coordinate-calculator-dwg.js";
import { latLonToUtm } from "./parser/geo/utm-calibrator.js";
import {
  buildRegionBundle,
  createFixtureLibrary,
} from "./tools/route-dwg-accuracy-harness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "parser", "__tests__", "fixtures");
const groundTruth = JSON.parse(
  readFileSync(path.join(FIXTURES, "joaoborn-ground-truth.json"), "utf8"),
);
const raw = JSON.parse(
  readFileSync(path.join(FIXTURES, "joaoborn-dwg-region.json"), "utf8"),
);
const bundle = buildRegionBundle("joaoborn", raw.posts ?? [], raw.cableEdges ?? []);
if (raw.primaryCableEdges) bundle.primaryCableEdges = raw.primaryCableEdges;
const library = createFixtureLibrary(bundle);

const pdfBuf = readFileSync(
  path.join(__dirname, "INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf"),
);
const parsed = await parsePdf(
  pdfBuf.buffer.slice(pdfBuf.byteOffset, pdfBuf.byteOffset + pdfBuf.byteLength),
);

const sink = {};
await calculateCoordinatesWithDwg(
  parsed.posts ?? [],
  parsed.distances ?? [],
  groundTruth[0].lat,
  groundTruth[0].lon,
  parsed.cableSegments ?? [],
  {
    pageDimensions:
      parsed.pageDimensions instanceof Map
        ? parsed.pageDimensions
        : new Map(Object.entries(parsed.pageDimensions ?? {}).map(([k, v]) => [+k, v])),
    viewportBoxes: parsed.viewportBoxes ?? [],
    utmGridPathsPerPage: parsed.utmGridPathsPerPage,
    distanceLabelItems: parsed.distanceLabelItems ?? [],
    cablePaths: parsed.cablePaths ?? [],
    solverDebugSink: sink,
  },
  library,
);

const nodes = sink.cascadeInputs.regionPosts;
const coordBy = new Map((sink.level0Coords ?? []).map((c) => [c.postNumber, c]));
const utmOf = (lat, lon) => {
  const u = latLonToUtm(lat, lon);
  return { x: u.easting, y: u.northing };
};

const chosen = new Map();
const trueN = new Map();
for (const g of groundTruth) {
  const gu = utmOf(g.lat, g.lon);
  let bd = Infinity, bn = null;
  for (const n of nodes) {
    const d = Math.hypot(n.x - gu.x, n.y - gu.y);
    if (d < bd) { bd = d; bn = n; }
  }
  trueN.set(g.number, bn);
  const c = coordBy.get(g.number);
  if (c) chosen.set(g.number, utmOf(c.lat, c.lon));
}

const printed = { 8: 34, 9: 10.9, 10: 17.8, 11: 14.1, 12: 27.6, 7: 34.8 };
console.log("span | printed | chosenSpan | trueNodeSpan");
for (let n = 7; n <= 12; n++) {
  const ca = chosen.get(n), cb = chosen.get(n + 1);
  const ta = trueN.get(n), tb = trueN.get(n + 1);
  const cs = Math.hypot(cb.x - ca.x, cb.y - ca.y);
  const ts = Math.hypot(tb.x - ta.x, tb.y - ta.y);
  console.log(
    `${n}->${n + 1} | ${String(printed[n]).padStart(5)} | ${cs.toFixed(1).padStart(7)} | ${ts.toFixed(1).padStart(7)}`,
  );
}

// where are the chosen nodes relative to true nodes (offset along street)?
console.log("\npost | chosen-true offset (m) | chosen == trueNode of post k?");
for (let n = 8; n <= 12; n++) {
  const c = chosen.get(n);
  let match = "-";
  for (const [k, t] of trueN) {
    if (Math.hypot(t.x - c.x, t.y - c.y) < 1.5) { match = `trueNode(${k})`; break; }
  }
  const t = trueN.get(n);
  console.log(
    `${n} | ${Math.hypot(c.x - t.x, c.y - t.y).toFixed(1).padStart(6)} | ${match}`,
  );
}

// local pole field: all DXF nodes within 60m of true 9-11, with arc context
const t9 = trueN.get(9);
console.log("\nDXF poles within 50m of true node 9 (x,y rel to true9):");
for (const n of nodes) {
  const d = Math.hypot(n.x - t9.x, n.y - t9.y);
  if (d < 50) {
    console.log(
      `  (${(n.x - t9.x).toFixed(1)}, ${(n.y - t9.y).toFixed(1)}) d=${d.toFixed(1)}`,
    );
  }
}
