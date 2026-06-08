#!/usr/bin/env node
/**
 * Siriu txt GPS accuracy gate (D-01/D-03).
 *
 * Runs the full DWG cascade, classifies per-post haversine error vs txt-derived
 * ground truth into four tiers, and FAILS LOUD on any bad-tier post (>15 m).
 *
 * Run: node tools/run-siriu-txt-accuracy-gate.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import "fake-indexeddb/auto";
import { runTxtAccuracyGate } from "./lib/txt-accuracy-gate-runner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "parser", "__tests__", "fixtures");

runTxtAccuracyGate({
  routeLabel: "Siriu",
  pdfPath: path.join(ROOT, "INFOVIAS_PJC INTERNET_Garopaba_Praia do Siriu_v01.pdf"),
  dwgRegionPath: path.join(FIXTURES, "siriu-dwg-region.json"),
  groundTruthPath: path.join(FIXTURES, "siriu-ground-truth.json"),
  regionId: "siriu",
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
