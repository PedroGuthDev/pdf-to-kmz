/**
 * G-3 reproducer (DWG-graph-first only — no cascade):
 *   Loads siriu.dxf, runs pairPostsByGraphWalk against Siriu ground truth.
 *   Prints a per-post error table and a single PASS/FAIL line.
 *
 * Run:
 *   node debug-run-calc-dwg-graph.mjs
 */
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";

import { createRegionLibrary } from "./parser/dwg/region-library.js";
import {
  buildAdjacencyGraph,
  buildPostIndex,
} from "./parser/dwg/region-pairing.js";
import { pairPostsByGraphWalk } from "./parser/dwg/graph-walker.js";
import { haversineMeters, latLonToUtm } from "./parser/geo/utm-calibrator.js";

const MAX_ERROR_M = 2;
const REQUIRED_PAIRS = 85;

function loadSiriuGroundTruth(path = "./coordenadas postes siriu.txt") {
  const text = readFileSync(path, "utf8");
  const gt = [];
  for (const line of text.split("\n")) {
    const m = line.match(/Poste\s+(\d+);\s*([-\d.]+)\s*,\s*([-\d.]+)/);
    if (!m) continue;
    gt.push({
      number: parseInt(m[1], 10),
      lat: parseFloat(m[2]),
      lon: parseFloat(m[3]),
    });
  }
  gt.sort((a, b) => a.number - b.number);
  return gt;
}

async function loadSiriuRegion() {
  const dxfText = readFileSync("./siriu.dxf", "utf8");
  const dxfBlob = new Blob([dxfText], { type: "text/plain" });
  const lib = createRegionLibrary(globalThis.indexedDB);
  await lib.addRegion("siriu", dxfBlob);
  return lib.getRegionWithIndex("siriu");
}

function buildSyntheticPdfInput(gt, region) {
  const regionPosts = region.posts ?? [];
  const adjacency =
    region.adjacencyGraph ??
    buildAdjacencyGraph(regionPosts, region.cableEdges ?? []);

  const gtToIdx = new Map();
  for (const g of gt) {
    const u = latLonToUtm(g.lat, g.lon);
    let bestIdx = -1;
    let bestD = Infinity;
    for (let i = 0; i < regionPosts.length; i++) {
      const p = regionPosts[i];
      const d = Math.hypot(p.x - u.easting, p.y - u.northing);
      if (d < bestD) {
        bestD = d;
        bestIdx = i;
      }
    }
    gtToIdx.set(g.number, bestIdx);
  }

  const posts = gt.map((g) => ({ number: g.number, x: 0, y: 0, pageNum: 1 }));
  const distances = [];
  const connections = [];

  for (let i = 0; i < gt.length - 1; i++) {
    const cur = gt[i];
    const nxt = gt[i + 1];
    const curIdx = gtToIdx.get(cur.number);
    const nxtIdx = gtToIdx.get(nxt.number);
    const curP = regionPosts[curIdx];
    const nxtP = regionPosts[nxtIdx];
    const meters = Math.hypot(nxtP.x - curP.x, nxtP.y - curP.y);
    const cableAdj = adjacency.get(curIdx)?.has(nxtIdx) ?? false;
    distances.push({ from: cur.number, to: nxt.number, meters });
    connections.push({ from: cur.number, to: nxt.number, gap: !cableAdj });
  }

  return { posts, distances, connections };
}

const gt = loadSiriuGroundTruth();
console.log(`[g3-harness] Ground truth: ${gt.length} posts`);
if (gt.length !== REQUIRED_PAIRS) {
  console.warn(
    `[g3-harness] WARNING: expected ${REQUIRED_PAIRS} posts, got ${gt.length}`,
  );
}

const region = await loadSiriuRegion();
console.log(
  `[g3-harness] Region 'siriu' loaded: ${region.posts?.length ?? 0} INSERTs, ${region.cableEdges?.length ?? 0} cable edges`,
);

const { posts, distances, connections } = buildSyntheticPdfInput(gt, region);
const gtNearestIdx = (() => {
  const regionPosts = region.posts ?? [];
  const m = new Map();
  for (const g of gt) {
    const u = latLonToUtm(g.lat, g.lon);
    let bestIdx = -1;
    let bestD = Infinity;
    for (let i = 0; i < regionPosts.length; i++) {
      const p = regionPosts[i];
      const d = Math.hypot(p.x - u.easting, p.y - u.northing);
      if (d < bestD) {
        bestD = d;
        bestIdx = i;
      }
    }
    m.set(g.number, { idx: bestIdx, d: bestD, utm: u });
  }
  return m;
})();

function runWalker(limitN = null) {
  const gtLimited = limitN != null ? gt.slice(0, limitN) : gt;
  const { posts, distances, connections } = buildSyntheticPdfInput(
    gtLimited,
    region,
  );
  const warnings = [];
  const anchor = gtLimited[0];
  const res = pairPostsByGraphWalk({
    posts,
    distances,
    connections,
    startLat: anchor.lat,
    startLon: anchor.lon,
    region,
    postIndex: region.postIndex ?? buildPostIndex(region.posts ?? []),
    adjacencyGraph:
      region.adjacencyGraph ??
      buildAdjacencyGraph(region.posts ?? [], region.cableEdges ?? []),
    warnings,
  });
  return { res, warnings, gtLimited };
}

const { res, warnings } = runWalker(null);

let paired = 0;
let maxErr = 0;
const gtByNum = new Map(gt.map((g) => [g.number, g]));

if (res.ok) {
  for (const c of res.coords) {
    const g = gtByNum.get(c.postNumber);
    const err = g ? haversineMeters(c.lat, c.lon, g.lat, g.lon) : NaN;
    if (Number.isFinite(err)) {
      paired++;
      if (err > maxErr) maxErr = err;
    }
    console.log(
      `  Poste ${String(c.postNumber).padStart(3)}: paired=${c.dwg_block}, error=${err.toFixed(2)}m`,
    );
  }
} else {
  console.log(
    `  Walk aborted at poste ${res.failedAt} (nearest=${res.nearestDistance ?? "?"})`,
  );
  if (res.failedAt === 17 && res.idxByPostNumber) {
    const rPosts = region.posts ?? [];
    const idx16 = res.idxByPostNumber["16"];
    const idx17 = res.idxByPostNumber["17"];
    const gt16 = gtNearestIdx.get(16);
    const gt17 = gtNearestIdx.get(17);
    console.log("\n[g3-harness] Debug: post 16/17 indices");
    console.log(
      `  walker idx16=${idx16} (${idx16 != null ? rPosts[idx16]?.block : "?"}), ` +
        `gtNearest16=${gt16?.idx} (d=${gt16?.d?.toFixed?.(2)}m, ${rPosts[gt16?.idx]?.block ?? "?"})`,
    );
    console.log(
      `  walker idx17=${idx17} (${idx17 != null ? rPosts[idx17]?.block : "?"}), ` +
        `gtNearest17=${gt17?.idx} (d=${gt17?.d?.toFixed?.(2)}m, ${rPosts[gt17?.idx]?.block ?? "?"})`,
    );
    if (idx16 != null && gt16?.idx != null) {
      const a = rPosts[idx16];
      const b = rPosts[gt16.idx];
      console.log(
        `  ΔUTM post16 walker↔GTnearest: ${Math.hypot(a.x - b.x, a.y - b.y).toFixed(2)}m`,
      );
    }
    if (idx17 != null && gt17?.idx != null) {
      const a = rPosts[idx17];
      const b = rPosts[gt17.idx];
      console.log(
        `  ΔUTM post17 walker↔GTnearest: ${Math.hypot(a.x - b.x, a.y - b.y).toFixed(2)}m`,
      );
    }
  }
}

if (warnings.length) {
  console.log(`\n[g3-harness] Warnings (${warnings.length}):`);
  for (const w of warnings.slice(0, 20)) console.log(`  ${JSON.stringify(w)}`);
}

if (res.ok && paired === REQUIRED_PAIRS && maxErr <= MAX_ERROR_M) {
  console.log(
    `\nPASS (${paired}/${REQUIRED_PAIRS} paired, max error ${maxErr.toFixed(2)}m)`,
  );
  process.exit(0);
} else {
  const failedAt = res.ok ? null : res.failedAt;
  console.log(
    `\nFAIL (${paired}/${REQUIRED_PAIRS} paired, max error ${maxErr.toFixed(2)}m${failedAt != null ? `, failedAt=${failedAt}` : ""})`,
  );

  // Diagnostic: rerun only the completed prefix (e.g. 1..16 when failing at 17)
  if (!res.ok && res.failedAt != null && res.failedAt > 1) {
    const diagN = res.failedAt - 1;
    const { res: partial, warnings: partialWarnings } = runWalker(diagN);
    if (partial.ok) {
      console.log(
        `\n[g3-harness] Partial run (1..${diagN}) error vs coordenadas postes siriu:`,
      );
      let firstBad = null;
      for (const c of partial.coords) {
        const g = gtByNum.get(c.postNumber);
        const err = g ? haversineMeters(c.lat, c.lon, g.lat, g.lon) : NaN;
        if (firstBad == null && Number.isFinite(err) && err > 20)
          firstBad = c.postNumber;
        console.log(
          `  Poste ${String(c.postNumber).padStart(3)} err=${err.toFixed(2)}m`,
        );
      }
      if (firstBad != null) {
        console.log(
          `\n[g3-harness] First big error (>20m) at poste ${firstBad}.`,
        );
      }
      if (partialWarnings.length) {
        console.log(
          `\n[g3-harness] Partial warnings (${partialWarnings.length}):`,
        );
        for (const w of partialWarnings.slice(0, 10))
          console.log(`  ${JSON.stringify(w)}`);
      }
    }
  }

  process.exit(1);
}
