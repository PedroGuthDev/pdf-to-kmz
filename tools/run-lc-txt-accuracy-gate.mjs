#!/usr/bin/env node
/**
 * Luiz Carolino txt GPS accuracy gate (D-01/D-03) — SOFT FENCE (Phase 8).
 *
 * Runs the full DWG cascade and prints the full tier histogram (all posts
 * measured and reported). Posts 21–31 (~179 m rigid offset) are excluded from
 * the exit rule via _meta.scope. All remaining bad-tier posts are listed to
 * stderr but this gate exits 0 regardless — deferred to Phase 8 — soft fence.
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

// Mirrors luizcarolino-post-positions-truth.json _meta.scope — absolute-position
// block deferred to Phase 8 solver; still measured, not counted toward exit(1).
const EXCLUDED_POSTS = new Set(Array.from({ length: 11 }, (_, i) => i + 21));

runTxtAccuracyGate({
  routeLabel: "Luiz Carolino",
  pdfPath: path.join(
    ROOT,
    "INFOVIAS_AAF INTERNET_São José_RUA LUIZ CAROLINO PEREIRA_v1.pdf",
  ),
  dwgRegionPath: path.join(FIXTURES, "luizcarolino-dwg-region.json"),
  groundTruthPath: path.join(FIXTURES, "luizcarolino-ground-truth.json"),
  regionId: "luizcarolino",
  excludedPosts: EXCLUDED_POSTS,
  excludedNote: "deferred to Phase 8 — soft fence",
  softFence: true,
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
