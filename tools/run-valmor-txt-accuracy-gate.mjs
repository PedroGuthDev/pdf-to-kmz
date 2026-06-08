#!/usr/bin/env node
/**
 * Valmor txt GPS accuracy gate (D-01/D-03).
 *
 * Runs the full DWG cascade against txt-derived ground truth (11 posts).
 * Zero-bad-tier floor — exit 1 on any post >15 m.
 *
 * Run: node tools/run-valmor-txt-accuracy-gate.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import "fake-indexeddb/auto";
import { runTxtAccuracyGate } from "./lib/txt-accuracy-gate-runner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "parser", "__tests__", "fixtures");

runTxtAccuracyGate({
  routeLabel: "Valmor",
  pdfPath: path.join(
    ROOT,
    "INFOVIAS_PJC INTERNET_Palhoça_RUA VALMOR FRANCISCO_v1.pdf",
  ),
  dwgRegionPath: path.join(FIXTURES, "valmor-dwg-region.json"),
  groundTruthPath: path.join(FIXTURES, "valmor-ground-truth.json"),
  regionId: "valmor",
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
