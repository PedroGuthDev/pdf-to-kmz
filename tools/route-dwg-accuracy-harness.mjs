/**
 * Route-agnostic DWG graph-walk accuracy harness.
 *
 * Exercises the DWG path: parsePdf -> calculateCoordinatesWithDwg -> per-post error vs GT.
 * Parameterized version of siriu-regression-harness.mjs; Siriu now imports shared helpers.
 *
 * @module route-dwg-accuracy-harness
 */
import { existsSync, readFileSync } from "node:fs";

import "fake-indexeddb/auto";
import { parsePdf } from "../parser/pdf-parser.js";
import { deduplicatePostsPreferLowerPage } from "../parser/post-assembler.js";
import { calculateCoordinatesWithDwg } from "../parser/dwg/coordinate-calculator-dwg.js";
import { pairPostsByGraphWalk } from "../parser/dwg/graph-walker.js";
import {
  buildAdjacencyGraph,
  buildPostIndex,
} from "../parser/dwg/region-pairing.js";
import { haversineMeters } from "../parser/geo/utm-calibrator.js";

function objectToMap(o) {
  if (o == null) return null;
  if (o instanceof Map) return o;
  const m = new Map();
  for (const [k, v] of Object.entries(o)) m.set(Number.isFinite(+k) ? +k : k, v);
  return m;
}

/**
 * Build a region bundle from posts + cableEdges (shared by Siriu and other routes).
 *
 * @param {string} id
 * @param {object[]} posts
 * @param {object[]} cableEdges
 */
export function buildRegionBundle(id, posts, cableEdges) {
  return {
    id,
    posts,
    cableEdges,
    postIndex: buildPostIndex(posts),
    adjacencyGraph: buildAdjacencyGraph(posts, cableEdges),
  };
}

/**
 * Create a minimal library stub from a pre-built bundle (no IndexedDB needed).
 *
 * @param {{ id: string, posts: object[], cableEdges: object[], postIndex: any, adjacencyGraph: any }} bundle
 */
export function createFixtureLibrary(bundle) {
  return {
    async lookupByGps() {
      return bundle;
    },
    async getRegionWithIndex(id) {
      return id === bundle.id ? bundle : null;
    },
    async addRegion() {},
  };
}

/**
 * Run the DWG graph-walk accuracy harness for a single route.
 *
 * @param {{
 *   pdfPath: string,
 *   dwgRegionPath: string,
 *   groundTruthPath: string,
 *   regionId: string,
 * }} opts
 * @returns {Promise<{
 *   dwgStatus: string,
 *   walkOk: boolean,
 *   walkCoords: number,
 *   errorsByPost: Map<number, number>,
 *   idxByPost: Record<number, number>,
 *   gpsFirstDivergentPost: number|null,
 * }>}
 */
export async function runRouteDwgAccuracyHarness({
  pdfPath,
  dwgRegionPath,
  groundTruthPath,
  regionId,
}) {
  const groundTruth = JSON.parse(readFileSync(groundTruthPath, "utf8"));
  const refByNum = new Map(groundTruth.map((g) => [g.number, g]));
  const start = groundTruth[0];

  // ── PDF parse ──────────────────────────────────────────────────────────────
  if (!existsSync(pdfPath)) throw new Error(`PDF not found: ${pdfPath}`);
  const pdfBuf = readFileSync(pdfPath);
  const parsed = await parsePdf(
    pdfBuf.buffer.slice(pdfBuf.byteOffset, pdfBuf.byteOffset + pdfBuf.byteLength),
  );
  if (parsed.error) throw new Error(`parsePdf: ${parsed.error}`);

  const pdfTopology = {
    posts: parsed.posts ?? [],
    distances: parsed.distances ?? [],
    cableSegments: parsed.cableSegments ?? [],
    pageDimensions: objectToMap(parsed.pageDimensions),
    viewportBoxes: parsed.viewportBoxes ?? [],
    utmGridPathsPerPage: objectToMap(parsed.utmGridPathsPerPage),
    distanceLabelItems: parsed.distanceLabelItems ?? [],
    cablePaths: parsed.cablePaths ?? [],
  };

  // ── DWG region ─────────────────────────────────────────────────────────────
  if (!existsSync(dwgRegionPath)) throw new Error(`DWG region not found: ${dwgRegionPath}`);
  const raw = JSON.parse(readFileSync(dwgRegionPath, "utf8"));
  const bundle = buildRegionBundle(regionId, raw.posts ?? [], raw.cableEdges ?? []);
  const library = createFixtureLibrary(bundle);

  // ── DWG coordinate calculation ─────────────────────────────────────────────
  const result = await calculateCoordinatesWithDwg(
    pdfTopology.posts,
    pdfTopology.distances,
    start.lat,
    start.lon,
    pdfTopology.cableSegments,
    {
      pageDimensions: pdfTopology.pageDimensions,
      viewportBoxes: pdfTopology.viewportBoxes,
      utmGridPathsPerPage: pdfTopology.utmGridPathsPerPage,
      distanceLabelItems: pdfTopology.distanceLabelItems,
      cablePaths: pdfTopology.cablePaths,
    },
    library,
  );

  // ── Error computation (DWG-sourced posts only) ─────────────────────────────
  const errorsByPost = new Map();
  for (const p of result.posts ?? []) {
    const ref = refByNum.get(p.number);
    if (!ref || p.lat == null || p.lon == null) continue;
    if ((p.source ?? "pdf") !== "dwg") continue;
    errorsByPost.set(p.number, haversineMeters(p.lat, p.lon, ref.lat, ref.lon));
  }

  // ── Walk-index tracking (mirrors siriu-regression-harness.mjs) ─────────────
  const routePosts = deduplicatePostsPreferLowerPage(
    (result.posts ?? []).length ? result.posts : pdfTopology.posts,
  ).sort((a, b) => a.number - b.number);

  const gpsByPostNumber = new Map();
  for (const p of result.posts ?? []) {
    if (p?.number != null && p.lat != null && p.lon != null) {
      gpsByPostNumber.set(p.number, { lat: p.lat, lon: p.lon });
    }
  }

  function runWalk(gps) {
    // Pass returnIdx: true explicitly instead of mutating process.env.GW_RETURN_IDX (WR-06)
    return pairPostsByGraphWalk({
      posts: routePosts,
      distances: pdfTopology.distances,
      connections: result.walkConnections ?? result.connections ?? [],
      startLat: start.lat,
      startLon: start.lon,
      region: { posts: bundle.posts, cableEdges: bundle.cableEdges },
      postIndex: bundle.postIndex,
      adjacencyGraph: bundle.adjacencyGraph,
      warnings: [],
      gpsByPostNumber: gps,
      returnIdx: true,
    });
  }

  const noGps = runWalk(null);
  const withGps = runWalk(gpsByPostNumber);
  const idxByPost = {
    ...(noGps.idxByPostNumber ?? {}),
    ...(withGps.idxByPostNumber ?? {}),
  };

  let gpsFirstDivergentPost = null;
  const maxPost = Math.max(...groundTruth.map((g) => g.number));
  for (let n = 1; n <= maxPost; n++) {
    if ((noGps.idxByPostNumber?.[n] ?? null) !== (withGps.idxByPostNumber?.[n] ?? null)) {
      gpsFirstDivergentPost = n;
      break;
    }
  }

  const walk = withGps.ok ? withGps : noGps;

  return {
    dwgStatus: result.dwgStatus ?? "unknown",
    posts: result.posts ?? [],
    dwgConfidence: result.dwgConfidence ?? null,
    errorsByPost,
    idxByPost,
    walkOk: Boolean(walk.ok),
    walkCoords: (walk.coords ?? walk.partialCoords ?? []).length,
    gpsFirstDivergentPost,
    // Solver cascade observability (level-0 acceptance lock in run-residual-gate)
    solverPath: result.solverPath ?? null,
    solverDemoted: result.solverDemoted ?? null,
    demotionReason: result.demotionReason ?? null,
  };
}
