#!/usr/bin/env node
// Probe: per-post confidence tiers + which sub-score (shape vs anchor) drives them.
// Run: node debug-tier-probe.mjs <lc|jb|siriu|valmor> [--dxf Palhoca.dxf]
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import "fake-indexeddb/auto";
import { parsePdf } from "./parser/pdf-parser.js";
import { calculateCoordinatesWithDwg } from "./parser/dwg/coordinate-calculator-dwg.js";
import { parseDxfText } from "./parser/dwg/dxf-loader.js";
import { haversineMeters } from "./parser/geo/utm-calibrator.js";
import {
  buildRegionBundle,
  createFixtureLibrary,
} from "./tools/route-dwg-accuracy-harness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
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
    pdfPath: path.join(ROOT, "INFOVIAS_PJC INTERNET_Palhoça_RUA VALMOR FRANCISCO_v1.pdf"),
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
  const routeKey = process.argv[2];
  const route = ROUTES[routeKey];
  if (!route) {
    console.error(`usage: node debug-tier-probe.mjs <${Object.keys(ROUTES).join("|")}> [--dxf file]`);
    process.exit(2);
  }

  const groundTruth = JSON.parse(readFileSync(route.groundTruthPath, "utf8"));
  const start = groundTruth[0];

  const pdfBuf = readFileSync(route.pdfPath);
  const parsed = await parsePdf(
    pdfBuf.buffer.slice(pdfBuf.byteOffset, pdfBuf.byteOffset + pdfBuf.byteLength),
  );
  if (parsed.error) throw new Error(`parsePdf: ${parsed.error}`);

  const dxfFlag = process.argv.indexOf("--dxf");
  let bundle;
  if (dxfFlag !== -1 && process.argv[dxfFlag + 1]) {
    const dxf = parseDxfText(readFileSync(path.resolve(ROOT, process.argv[dxfFlag + 1]), "utf8"));
    bundle = buildRegionBundle(route.regionId, dxf.posts ?? [], dxf.cableEdges ?? []);
    bundle.primaryCableEdges = dxf.primaryCableEdges ?? [];
  } else {
    const raw = JSON.parse(readFileSync(route.dwgRegionPath, "utf8"));
    bundle = buildRegionBundle(route.regionId, raw.posts ?? [], raw.cableEdges ?? []);
    if (raw.primaryCableEdges) bundle.primaryCableEdges = raw.primaryCableEdges;
  }
  const library = createFixtureLibrary(bundle);

  const dwgResult = await calculateCoordinatesWithDwg(
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
    },
    library,
  );

  const conf = dwgResult.dwgConfidence;
  if (!conf) {
    console.log(`no dwgConfidence (dwgPath=${dwgResult.dwgPath})`);
    return;
  }
  const gtBy = new Map(groundTruth.map((g) => [g.number, g]));
  const coordBy = new Map((dwgResult.posts ?? []).map((c) => [c.number, c]));

  console.log(`=== ${routeKey} dwgStatus=${dwgResult.dwgStatus} gate=${conf.gateDecision} overall=${conf.overall}`);
  console.log(`shape: median=${(conf.shapeFidelity?.medianRelError * 100)?.toFixed(2)}% p95=${(conf.shapeFidelity?.p95RelError * 100)?.toFixed(2)}% edges=${conf.shapeFidelity?.edgeCount}`);
  console.log(`anchor: mean=${conf.anchorGap?.meanGapM?.toFixed(1)}m p95=${conf.anchorGap?.p95GapM?.toFixed(1)}m n=${conf.anchorGap?.perPost?.length}`);
  console.log(`\npost  tier          shapeResid(m)  anchorGap(m)  trueErrVsGT(m)`);
  const counts = {};
  for (const p of conf.postTiers) {
    counts[p.tier] = (counts[p.tier] ?? 0) + 1;
    const c = coordBy.get(p.postNumber);
    const gt = gtBy.get(p.postNumber);
    const trueErr = c && gt && c.lat != null ? haversineMeters(c.lat, c.lon, gt.lat, gt.lon) : null;
    console.log(
      `${String(p.postNumber).padStart(4)}  ${p.tier.padEnd(12)}  ${p.shapeResidualM == null ? "       n/a" : p.shapeResidualM.toFixed(1).padStart(10)}     ${p.anchorGapM == null ? "      n/a" : p.anchorGapM.toFixed(1).padStart(9)}     ${trueErr == null ? "      n/a" : trueErr.toFixed(1).padStart(9)}`,
    );
  }
  console.log(`\ntier counts: ${JSON.stringify(counts)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
