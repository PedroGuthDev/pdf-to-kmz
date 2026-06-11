// JB posts 8-12: GT GPS vs nearest DXF node vs solver-chosen coord.
// Distinguishes "no DXF node near the pole" from "Viterbi picked wrong node".
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import "fake-indexeddb/auto";
import { parsePdf } from "./parser/pdf-parser.js";
import { calculateCoordinatesWithDwg } from "./parser/dwg/coordinate-calculator-dwg.js";
import { latLonToUtm, haversineMeters } from "./parser/geo/utm-calibrator.js";
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

const regionPosts = sink.cascadeInputs.regionPosts;
const coordBy = new Map((sink.level0Coords ?? []).map((c) => [c.postNumber, c]));

console.log("post | GT→nearestDXFnode (m) | solverErr vs GT (m) | solver→GTnode (m) | pruned cands w/ dist to GT");
for (const g of groundTruth.filter((g) => g.number >= 7 && g.number <= 13)) {
  const gtU = latLonToUtm(g.lat, g.lon);
  let bestD = Infinity, bestNode = null;
  for (const n of regionPosts) {
    const d = Math.hypot(n.x - gtU.easting, n.y - gtU.northing);
    if (d < bestD) { bestD = d; bestNode = n; }
  }
  const c = coordBy.get(g.number);
  let solverErr = null, solverToNode = null;
  if (c) {
    solverErr = haversineMeters(c.lat, c.lon, g.lat, g.lon);
    const cu = latLonToUtm(c.lat, c.lon);
    solverToNode = Math.hypot(cu.easting - bestNode.x, cu.northing - bestNode.y);
  }
  const cands = sink.prunedByPost?.get(g.number) ?? [];
  const candSummary = cands
    .map((cd) => {
      const n = typeof cd === "object" && cd.x != null ? cd : regionPosts[cd] ?? null;
      if (!n) return "?";
      return Math.hypot(n.x - gtU.easting, n.y - gtU.northing).toFixed(0);
    })
    .sort((a, b) => +a - +b)
    .slice(0, 8)
    .join(",");
  console.log(
    `${String(g.number).padStart(4)} | ${bestD.toFixed(1).padStart(8)} | ${solverErr?.toFixed(1).padStart(8)} | ${solverToNode?.toFixed(1).padStart(8)} | [${candSummary}]`,
  );
}
