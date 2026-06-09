#!/usr/bin/env node
/**
 * Solver 2s-budget timing gate (Phase 8 / Pitfall 8 / D-05 budget bar).
 *
 * For each named route (Siriu / Luiz Carolino / João Born / Valmor) this gate
 * builds cascade-faithful inputs from the committed JSON fixtures (route
 * ground-truth + DWG region), runs `solveGlobalGraphAlignment` exactly as
 * `runDwgPairingCascade` does at level-0, and asserts the solver's reported
 * `elapsedMs < 2000` (D-05 condition 3). A breach EXITS NON-ZERO — on a large
 * DXF the solver must come in under budget; if it cannot, the cascade demotes,
 * but the budget itself is a hard guard against the in-browser DoS failure mode
 * (Pitfall 8 — Palhoça ~35k INSERTs).
 *
 * The gate does NOT require the solver to ACCEPT — accept/demote is the route
 * gates' job (post-position + txt-accuracy). It only measures wall-clock budget.
 * The solver returns `elapsedMs` on every path (accept, demote, no-anchor,
 * scale-mismatch), so the budget is measurable regardless of the outcome.
 *
 * Run:  node tools/run-solver-timing-gate.mjs
 * Env:  SOLVER_BUDGET_MS=<ms>   override the 2000 ms ceiling (default 2000)
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildAdjacencyGraph,
  buildPostIndex,
} from "../parser/dwg/region-pairing.js";
import { cropRegionToBbox, routeUtmBbox } from "../parser/dwg/region-crop.js";
import { solveGlobalGraphAlignment } from "../parser/dwg/global-solver.js";
import { haversineMeters } from "../parser/geo/utm-calibrator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "parser", "__tests__", "fixtures");

const DEFAULT_BUDGET_MS = 2000;
const BUDGET_MS =
  process.env.SOLVER_BUDGET_MS != null
    ? Number(process.env.SOLVER_BUDGET_MS)
    : DEFAULT_BUDGET_MS;

const ZONE = 22;
/** UTM bbox slack (m) for the crop, matching the cascade's routeUtmBbox usage. */
const BBOX_PAD_M = 200;

const ROUTES = [
  { name: "Siriu", slug: "siriu" },
  { name: "Luiz Carolino", slug: "luizcarolino" },
  { name: "João Born", slug: "joaoborn" },
  { name: "Valmor", slug: "valmor" },
];

function loadJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

/**
 * Build cascade-faithful solver inputs from the route's ground-truth (post
 * number → lat/lon) and DWG region (UTM posts + cable edges). The route
 * graph is the sequential post chain; distances are the haversine spans
 * between consecutive ground-truth posts (real printed-distance proxy for the
 * D-02 span-fit term). The region is cropped to the route bbox exactly as the
 * production cascade crops before level-0 runs.
 */
function buildSolverInputs(slug) {
  const gtPath = path.join(FIXTURES, `${slug}-ground-truth.json`);
  const dwgPath = path.join(FIXTURES, `${slug}-dwg-region.json`);
  if (!existsSync(gtPath)) throw new Error(`missing ground truth: ${gtPath}`);
  if (!existsSync(dwgPath)) throw new Error(`missing dwg region: ${dwgPath}`);

  const gt = loadJson(gtPath);
  const dwg = loadJson(dwgPath);
  const truthPosts = [...gt].sort((a, b) => a.number - b.number);

  // PDF-side route posts (number + GPS anchor); solver anchors post 1 (D-07).
  const posts = truthPosts.map((p) => ({
    number: p.number,
    lat: p.lat,
    lon: p.lon,
  }));

  // Sequential chain: connections + printed-distance proxy (haversine span).
  const connections = [];
  const distances = [];
  for (let i = 1; i < truthPosts.length; i++) {
    const a = truthPosts[i - 1];
    const b = truthPosts[i];
    connections.push({ from: a.number, to: b.number });
    distances.push({
      from: a.number,
      to: b.number,
      meters: haversineMeters(a.lat, a.lon, b.lat, b.lon),
    });
  }

  const gpsByPostNumber = new Map(
    truthPosts.map((p) => [p.number, { lat: p.lat, lon: p.lon }]),
  );

  const start = truthPosts[0];
  const regionData = {
    crs: { zone: ZONE },
    posts: dwg.posts ?? [],
    cableEdges: dwg.cableEdges ?? [],
  };

  // Crop the region to the route bbox — identical to the cascade's pre-solve crop.
  const routeBbox = routeUtmBbox(
    [{ lat: start.lat, lon: start.lon }, ...truthPosts],
    ZONE,
    BBOX_PAD_M,
  );
  const croppedRegion = cropRegionToBbox(regionData, routeBbox);
  const regionPosts = croppedRegion.posts ?? [];
  const regionEdges = croppedRegion.cableEdges ?? [];
  const postIndex = buildPostIndex(regionPosts);
  const adjacencyGraph = buildAdjacencyGraph(regionPosts, regionEdges, {
    postIndex,
  });

  return {
    posts,
    distances,
    connections,
    startLat: start.lat,
    startLon: start.lon,
    regionData,
    regionPosts,
    regionEdges,
    postIndex,
    adjacencyGraph,
    gpsByPostNumber,
    _meta: {
      postCount: posts.length,
      regionPostCount: regionPosts.length,
      regionEdgeCount: regionEdges.length,
    },
  };
}

function main() {
  console.log(`Solver 2s-budget timing gate (ceiling ${BUDGET_MS} ms)…`);

  const failures = [];
  let worstMs = 0;

  for (const route of ROUTES) {
    let inputs;
    try {
      inputs = buildSolverInputs(route.slug);
    } catch (e) {
      failures.push(`${route.name}: fixture load failed — ${e.message}`);
      continue;
    }

    const { _meta, ...solverInputs } = inputs;
    const result = solveGlobalGraphAlignment(solverInputs);
    const elapsedMs = result?.elapsedMs;

    if (!Number.isFinite(elapsedMs)) {
      failures.push(
        `${route.name}: solver returned no elapsedMs (got ${elapsedMs}, reason=${result?.reason ?? "?"})`,
      );
      continue;
    }

    worstMs = Math.max(worstMs, elapsedMs);
    const chosenPath = result.ok
      ? "global-solve"
      : `demote:${result.reason ?? "?"}`;
    console.log(
      `  ${route.name}: elapsedMs=${elapsedMs.toFixed(1)} ms, path=${chosenPath} ` +
        `(posts=${_meta.postCount}, region nodes=${_meta.regionPostCount}, edges=${_meta.regionEdgeCount})`,
    );

    if (elapsedMs >= BUDGET_MS) {
      failures.push(
        `${route.name}: solver elapsedMs ${elapsedMs.toFixed(1)} ms ≥ budget ${BUDGET_MS} ms (Pitfall 8)`,
      );
    }
  }

  if (failures.length) {
    console.error(
      `\nSOLVER TIMING GATE FAILED (${failures.length} breach(es)):`,
    );
    for (const f of failures) console.error(`  x ${f}`);
    console.error(
      "\nThe solver must finish within the 2s budget on every named route " +
        "(D-05 budget bar / Pitfall 8). A breach is a real perf regression — " +
        "profile the candidate prune (k≤30, D-03) and the crop, do NOT raise " +
        "the budget to mask it.",
    );
    process.exit(1);
  }

  console.log(
    `\nPASS — all ${ROUTES.length} routes within ${BUDGET_MS} ms ` +
      `(worst ${worstMs.toFixed(1)} ms).`,
  );
}

main();
