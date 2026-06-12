#!/usr/bin/env node
/**
 * João Born txt GPS accuracy gate (D-01/D-03) — HARD FENCE.
 *
 * Runs the full DWG cascade against txt-derived ground truth (34 posts; post 35
 * excluded in 07-01). Zero bad-tier (>15 m) floor enforced since the Phase 8
 * global solver + front-label street-order remap landed (2.8 m mean on both
 * the fixture region and real Palhoca.dxf).
 *
 * Run: node tools/run-joaoborn-txt-accuracy-gate.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import "fake-indexeddb/auto";
import { runTxtAccuracyGate } from "./lib/txt-accuracy-gate-runner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "parser", "__tests__", "fixtures");

runTxtAccuracyGate({
  routeLabel: "João Born",
  pdfPath: path.join(ROOT, "INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf"),
  dwgRegionPath: path.join(FIXTURES, "joaoborn-dwg-region.json"),
  groundTruthPath: path.join(FIXTURES, "joaoborn-ground-truth.json"),
  regionId: "joaoborn",
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
