#!/usr/bin/env node
/**
 * Solver coverage diagnostic — why does level-0 demote with reason "coverage"?
 *
 * Runs the full DWG cascade with opts.solverDebugSink and prints, per post:
 * hop depth, prune window, candidate count, prediction error vs the TRUE DXF
 * node (nearest region node to ground truth), and whether the true node was
 * inside the window. Also dumps the printed-distance chain so breaks in the
 * dead-reckoning BFS (missing spans) are visible.
 *
 * Run: node tools/debug-solver-coverage.mjs <lc|jb|siriu|valmor>
 */
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import "fake-indexeddb/auto";
import { parsePdf } from "../parser/pdf-parser.js";
import { calculateCoordinatesWithDwg } from "../parser/dwg/coordinate-calculator-dwg.js";
import { latLonToUtm } from "../parser/geo/utm-calibrator.js";
import {
  buildRegionBundle,
  createFixtureLibrary,
} from "./route-dwg-accuracy-harness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "parser", "__tests__", "fixtures");

const ROUTES = {
  lc: {
    pdfPath: path.join(
      ROOT,
      "INFOVIAS_AAF INTERNET_São José_RUA LUIZ CAROLINO PEREIRA_v1.pdf",
    ),
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
    pdfPath: path.join(
      ROOT,
      "INFOVIAS_PJC INTERNET_Palhoça_RUA VALMOR FRANCISCO_v1.pdf",
    ),
    dwgRegionPath: path.join(FIXTURES, "valmor-dwg-region.json"),
    groundTruthPath: path.join(FIXTURES, "valmor-ground-truth.json"),
    regionId: "valmor",
  },
};

const HOP_WINDOW_GROWTH = 0.25; // mirror global-solver.js WR-04

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
    console.error(`usage: node tools/debug-solver-coverage.mjs <${Object.keys(ROUTES).join("|")}>`);
    process.exit(2);
  }

  const groundTruth = JSON.parse(readFileSync(route.groundTruthPath, "utf8"));
  const start = groundTruth[0];

  const pdfBuf = readFileSync(route.pdfPath);
  const parsed = await parsePdf(
    pdfBuf.buffer.slice(pdfBuf.byteOffset, pdfBuf.byteOffset + pdfBuf.byteLength),
  );
  if (parsed.error) throw new Error(`parsePdf: ${parsed.error}`);

  const raw = JSON.parse(readFileSync(route.dwgRegionPath, "utf8"));
  const bundle = buildRegionBundle(route.regionId, raw.posts ?? [], raw.cableEdges ?? []);
  const library = createFixtureLibrary(bundle);

  const sink = {};
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
      solverDebugSink: sink,
    },
    library,
  );

  console.log(`\n=== ${routeKey} solver diagnostic ===`);
  for (const w of dwgResult.warnings ?? []) {
    const s = typeof w === "string" ? w : JSON.stringify(w);
    if (/[Ss]plit-span|bifurcation|refill|rehome/.test(s)) console.log(`  [warn] ${s}`);
  }
  // repaired distance graph as the cascade saw it
  if (sink.cascadeInputs) {
    console.log("  repaired distances (consecutive + extra):");
    for (const d of sink.cascadeInputs.distances) {
      console.log(`    ${d.from}→${d.to} = ${d.meters} (${d.source ?? "?"}${d.splitSpanMerged ? ", split-merged" : ""})`);
    }
  }
  console.log(`level-0 result: ${sink.level0Reason == null ? "ACCEPTED" : `demoted (${sink.level0Reason})`}`);
  if (sink.level0Score) {
    const s = sink.level0Score;
    console.log(
      `solver residual score: decision=${s.gateDecision ?? "?"} shapeMedian=${s.shapeFidelity?.medianRelError?.toFixed?.(4) ?? "?"} anchorP95=${s.anchorGap?.p95GapM?.toFixed?.(1) ?? "?"}`,
    );
  }
  if (sink.level0Coords?.length) {
    const gtBy = new Map(groundTruth.map((g) => [g.number, g]));
    const { haversineMeters } = await import("../parser/geo/utm-calibrator.js");
    const errs = [];
    for (const c of sink.level0Coords) {
      const gt = gtBy.get(c.postNumber);
      if (gt) errs.push({ n: c.postNumber, e: haversineMeters(c.lat, c.lon, gt.lat, gt.lon) });
    }
    const sortedE = errs.map((x) => x.e).sort((a, b) => a - b);
    const mean = sortedE.reduce((s2, v) => s2 + v, 0) / (sortedE.length || 1);
    const bad = errs.filter((x) => x.e > 15);
    console.log(
      `solver coords vs GT: n=${errs.length} mean=${mean.toFixed(1)}m max=${(sortedE.at(-1) ?? 0).toFixed(1)}m >15m: ${bad.length} ${bad.length ? `(${bad.map((b) => `${b.n}:${b.e.toFixed(0)}`).join(" ")})` : ""}`,
    );
  }
  if (sink.coverageFailure) {
    console.log(`coverage failure: ${JSON.stringify(sink.coverageFailure)}`);
  }
  if (sink.gate) {
    console.log(`gate junctions: {${sink.gate.junctions}}`);
    for (const r of sink.gate.runs) console.log(`  run: ${r.join("→")}`);
  }
  if (!sink.tolerances) {
    console.log("no solver internals captured (failed before pruning — anchor/scale stage)");
    return;
  }

  const { tolerances, anchorPostNum, anchorDist, predicted, hops, prunedByPost, sortedPosts } = sink;
  console.log(`anchor: post ${anchorPostNum} dist=${anchorDist.toFixed(1)}m`);
  console.log(`tolerances: spanTolM=${tolerances.spanTolM.toFixed(1)} candidateWindowM=${tolerances.candidateWindowM.toFixed(1)}`);
  console.log(`columns: ${sink.columnCount}, region posts: ${sink.cascadeInputs.regionPosts.length}`);

  // Printed-distance chain breaks (consecutive pairs without meters)
  const { distances, connections } = sink.cascadeInputs;
  const distSet = new Set();
  for (const d of distances ?? []) {
    if (d.meters > 0 && !Number.isNaN(d.meters)) {
      distSet.add(`${d.from}-${d.to}`);
      distSet.add(`${d.to}-${d.from}`);
    }
  }
  const connPairs = (connections ?? []).map((c) => `${c.from}-${c.to}`);
  const missing = connPairs.filter((k) => !distSet.has(k));
  console.log(`\nconnections without printed meters (BFS chain breaks): ${missing.length ? missing.join(", ") : "none"}`);

  // True DXF node per post = nearest region node to ground truth UTM
  const gtByNum = new Map(groundTruth.map((g) => [g.number, g]));
  const regionPosts = sink.cascadeInputs.regionPosts;

  // PDF absolute error vs GT (the prediction prior quality)
  const gpsMap = sink.cascadeInputs.gpsByPostNumber ?? new Map();
  const pdfUtm = new Map();
  for (const [num, gps] of gpsMap) {
    if (gps?.lat == null) continue;
    const u = latLonToUtm(gps.lat, gps.lon);
    pdfUtm.set(num, { x: u.easting, y: u.northing });
  }

  console.log(`\npost  hop  window(m)  cands  predErr→GTnode(m)  GTnodeInWindow  pdfAbsErr(m)  pdfSpanErr(m)`);
  for (const p of sortedPosts) {
    const pred = predicted.get(p.number);
    const hop = hops.get(p.number) ?? 0;
    const windowM = tolerances.candidateWindowM * (1 + HOP_WINDOW_GROWTH * hop);
    const cands = (prunedByPost.get(p.number) ?? []).length;

    const gt = gtByNum.get(p.number);
    let predErr = null;
    let inWindow = "?";
    if (gt && pred) {
      const gtUtm = latLonToUtm(gt.lat, gt.lon);
      // nearest region node to GT
      let bestD = Infinity;
      let bestNode = null;
      for (const n of regionPosts) {
        const d = Math.hypot(n.x - gtUtm.easting, n.y - gtUtm.northing);
        if (d < bestD) {
          bestD = d;
          bestNode = n;
        }
      }
      if (bestNode) {
        predErr = Math.hypot(bestNode.x - pred.x, bestNode.y - pred.y);
        inWindow =
          Math.abs(bestNode.x - pred.x) <= windowM && Math.abs(bestNode.y - pred.y) <= windowM
            ? "yes"
            : "NO";
      }
    }
    // pdfAbsErr: PDF position vs GT; pdfSpanErr: |PDF span (n-1→n) - GT span|
    let pdfAbsErr = null;
    let pdfSpanErr = null;
    if (gt) {
      const gtU = latLonToUtm(gt.lat, gt.lon);
      const pu = pdfUtm.get(p.number);
      if (pu) pdfAbsErr = Math.hypot(pu.x - gtU.easting, pu.y - gtU.northing);
      const prevGt = gtByNum.get(p.number - 1);
      const prevPu = pdfUtm.get(p.number - 1);
      if (pu && prevPu && prevGt) {
        const prevGtU = latLonToUtm(prevGt.lat, prevGt.lon);
        const pdfSpan = Math.hypot(pu.x - prevPu.x, pu.y - prevPu.y);
        const gtSpan = Math.hypot(gtU.easting - prevGtU.easting, gtU.northing - prevGtU.northing);
        pdfSpanErr = pdfSpan - gtSpan;
      }
    }
    console.log(
      `${String(p.number).padStart(4)}  ${String(hop).padStart(3)}  ${windowM.toFixed(0).padStart(9)}  ${String(cands).padStart(5)}  ${predErr == null ? "      n/a" : predErr.toFixed(1).padStart(9)}          ${inWindow.padEnd(3)}      ${pdfAbsErr == null ? "     n/a" : pdfAbsErr.toFixed(1).padStart(8)}      ${pdfSpanErr == null ? "    n/a" : pdfSpanErr.toFixed(1).padStart(7)}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
