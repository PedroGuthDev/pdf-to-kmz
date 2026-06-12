#!/usr/bin/env node
/**
 * Luiz Carolino txt GPS accuracy gate (D-01/D-03) — HARD FENCE.
 *
 * Runs the full DWG cascade and prints the full tier histogram (all posts
 * measured and reported). Zero bad-tier (>15 m) floor enforced on all 31
 * posts: the Phase 8 global solver resolved the posts 21–31 ~179 m rigid
 * offset that the old soft fence scoped out (1.0 m mean / 2.0 m max now).
 *
 * Run: node tools/run-lc-txt-accuracy-gate.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import "fake-indexeddb/auto";
import { runTxtAccuracyGate } from "./lib/txt-accuracy-gate-runner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "parser", "__tests__", "fixtures");

runTxtAccuracyGate({
  routeLabel: "Luiz Carolino",
  pdfPath: path.join(
    ROOT,
    "INFOVIAS_AAF INTERNET_São José_RUA LUIZ CAROLINO PEREIRA_v1.pdf",
  ),
  dwgRegionPath: path.join(FIXTURES, "luizcarolino-dwg-region.json"),
  groundTruthPath: path.join(FIXTURES, "luizcarolino-ground-truth.json"),
  regionId: "luizcarolino",
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
