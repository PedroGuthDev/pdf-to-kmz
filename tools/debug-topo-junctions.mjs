#!/usr/bin/env node
/**
 * Dump DXF cable-topology neighbor sets for posts around bifurcation-main
 * edges, mirroring coordinate-calculator-dwg's buildCableTopologyMaps call.
 * Decides whether a region-degree veto can separate FALSE bifurcations
 * (LC 2→4/10→12, JB 13→15) from GENUINE ones (Siriu).
 *
 * Run: node tools/debug-topo-junctions.mjs <lc|jb|siriu|valmor>
 */
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import "fake-indexeddb/auto";
import { parsePdf } from "../parser/pdf-parser.js";
import { calculateCoordinatesWithDwg } from "../parser/dwg/coordinate-calculator-dwg.js";
import { buildCableTopologyMaps } from "../parser/dwg/cable-topology.js";
import {
  buildRegionBundle,
  createFixtureLibrary,
} from "./route-dwg-accuracy-harness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "parser", "__tests__", "fixtures");

const ROUTES = {
  lc: {
    pdfPath: path.join(ROOT, "INFOVIAS_AAF INTERNET_São José_RUA LUIZ CAROLINO PEREIRA_v1.pdf"),
    dwgRegionPath: path.join(FIXTURES, "luizcarolino-dwg-region.json"),
    groundTruthPath: path.join(FIXTURES, "luizcarolino-ground-truth.json"),
    regionId: "luizcarolino",
  },
  jb: {
    pdfPath: path.join(ROOT, "INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf"),
    dwgRegionPath: path.join(FIXTURES, "joaoborn-dwg-region.json"),
    groundTruthPath: path.join(FIXTURES, "joaoborn-ground-truth.json"),
    regionId: "joaoborn",
  },
  siriu: {
    pdfPath: path.join(ROOT, "INFOVIAS_PJC INTERNET_Garopaba_Praia do Siriu_v01.pdf"),
    dwgRegionPath: path.join(FIXTURES, "siriu-dwg-region.json"),
    groundTruthPath: path.join(FIXTURES, "siriu-ground-truth.json"),
    regionId: "siriu",
  },
  valmor: {
    pdfPath: path.join(ROOT, "INFOVIAS_PJC INTERNET_Palhoça_R VALMOR ANTONIO DE AGUIAR_v02.pdf"),
    dwgRegionPath: path.join(FIXTURES, "valmor-dwg-region.json"),
    groundTruthPath: path.join(FIXTURES, "valmor-ground-truth.json"),
    regionId: "valmor",
  },
};

function objectToMap(o) {
  if (o == null) return null;
  if (o instanceof Map) return o;
  const m = new Map();
  for (const [k, v] of Object.entries(o)) m.set(Number.isFinite(+k) ? +k : k, v);
  return m;
}

async function main() {
  const route = ROUTES[process.argv[2] ?? "lc"];
  const groundTruth = JSON.parse(readFileSync(route.groundTruthPath, "utf8"));
  const start = groundTruth[0];

  const pdfBuf = readFileSync(route.pdfPath);
  const parsed = await parsePdf(
    pdfBuf.buffer.slice(pdfBuf.byteOffset, pdfBuf.byteOffset + pdfBuf.byteLength),
  );
  if (parsed.error) throw new Error(parsed.error);

  const raw = JSON.parse(readFileSync(route.dwgRegionPath, "utf8"));
  const bundle = buildRegionBundle(route.regionId, raw.posts ?? [], raw.cableEdges ?? []);
  const library = createFixtureLibrary(bundle);

  const sink = {};
  await calculateCoordinatesWithDwg(
    parsed.posts ?? [],
    parsed.distances ?? [],
    start.lat,
    start.lon,
    parsed.cableSegments ?? [],
    {
      pageDimensions: objectToMap(parsed.pageDimensions),
      viewportBoxes: parsed.viewportBoxes ?? [],
      utmGridPathsPerPage: objectToMap(parsed.utmGridPathsPerPage),
      distanceLabelItems: parsed.distanceLabelItems ?? [],
      cablePaths: parsed.cablePaths ?? [],
      solverDebugSink: sink,
    },
    library,
  );

  const { distances, gpsByPostNumber, regionEdges } = sink.cascadeInputs;

  // Mirror prod: posts with lat/lon (pdfResult), region cable edges, zone 22.
  const postsForTopo = [];
  for (const [num, gps] of gpsByPostNumber) {
    if (gps?.lat != null) postsForTopo.push({ number: num, lat: gps.lat, lon: gps.lon });
  }
  const { neighborsByPost, degreeByPost } = buildCableTopologyMaps(
    postsForTopo,
    regionEdges,
    { zone: 22 },
  );

  console.log(`\n=== ${process.argv[2]} topology junction audit ===`);
  console.log(`posts attached: ${neighborsByPost.size}/${postsForTopo.length}`);

  const bifEdges = distances.filter(
    (d) => d.source === "bifurcation-main" && d.meters != null,
  );
  console.log(`\nbifurcation-main edges (junction J → main M):`);
  for (const e of bifEdges) {
    const J = Math.min(e.from, e.to);
    const M = Math.max(e.from, e.to);
    const topoJ = neighborsByPost.get(J);
    const topoTap = neighborsByPost.get(J + 1);
    console.log(
      `  ${J}→${M} (${e.meters} m): topoN(${J})={${[...(topoJ ?? [])].sort((a, b) => a - b)}} deg=${degreeByPost.get(J) ?? 0}; topoN(tap ${J + 1})={${[...(topoTap ?? [])].sort((a, b) => a - b)}}`,
    );
  }

  // All posts with topo degree >= 3 (real junction candidates per DXF)
  const junctions = [...degreeByPost].filter(([, d]) => d >= 3).map(([n]) => n);
  console.log(`\nDXF topo degree>=3 posts: ${junctions.sort((a, b) => a - b).join(", ") || "none"}`);
  const nonConsec = [...neighborsByPost]
    .filter(([n, s]) => [...s].some((nb) => Math.abs(nb - n) > 1))
    .map(([n, s]) => `${n}→{${[...s].sort((a, b) => a - b)}}`);
  console.log(`posts with non-consecutive topo neighbor: ${nonConsec.join("; ") || "none"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
