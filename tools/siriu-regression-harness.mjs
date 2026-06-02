/**
 * Shared Siriu DWG graph-walk harness for regression gate + debug scripts.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import "fake-indexeddb/auto";
import { parsePdf } from "../parser/pdf-parser.js";
import { deduplicatePostsPreferLowerPage } from "../parser/post-assembler.js";
import { calculateCoordinatesWithDwg } from "../parser/dwg/coordinate-calculator-dwg.js";
import { createRegionLibrary } from "../parser/dwg/region-library.js";
import { pairPostsByGraphWalk } from "../parser/dwg/graph-walker.js";
import {
  buildAdjacencyGraph,
  buildPostIndex,
} from "../parser/dwg/region-pairing.js";
import { haversineMeters } from "../parser/geo/utm-calibrator.js";
import groundTruth from "../parser/__tests__/fixtures/siriu-ground-truth.json" with {
  type: "json",
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "parser", "__tests__", "fixtures");

const PDF = path.join(
  ROOT,
  "INFOVIAS_PJC INTERNET_Garopaba_Praia do Siriu_v01.pdf",
);
const DXF = path.join(ROOT, "siriu.dxf");
const TOPO_FIXTURE = path.join(FIXTURES, "siriu-topology.json");
const DWG_FIXTURE = path.join(FIXTURES, "siriu-dwg-region.json");

function objectToMap(o) {
  if (o == null) return null;
  if (o instanceof Map) return o;
  const m = new Map();
  for (const [k, v] of Object.entries(o)) m.set(Number.isFinite(+k) ? +k : k, v);
  return m;
}

async function loadTopology() {
  const useFixtures =
    process.env.SIRIU_USE_FIXTURES === "1" ||
    process.env.CI === "true" ||
    process.env.GITHUB_ACTIONS === "true";
  if (!useFixtures && existsSync(PDF)) {
    const pdfBuf = readFileSync(PDF);
    const parsed = await parsePdf(
      pdfBuf.buffer.slice(
        pdfBuf.byteOffset,
        pdfBuf.byteOffset + pdfBuf.byteLength,
      ),
    );
    if (parsed.error) throw new Error(`parsePdf: ${parsed.error}`);
    return parsed;
  }
  if (existsSync(TOPO_FIXTURE)) {
    const raw = JSON.parse(readFileSync(TOPO_FIXTURE, "utf8"));
    return {
      posts: raw.posts ?? [],
      distances: raw.distances ?? [],
      cableSegments: raw.cableSegments ?? [],
      pageDimensions: objectToMap(raw.pageDimensions),
      viewportBoxes: raw.viewportBoxes ?? [],
      utmGridPathsPerPage: objectToMap(raw.utmGridPathsPerPage),
      distanceLabelItems: raw.distanceLabelItems ?? [],
    };
  }
  throw new Error(
    "Siriu regression inputs missing: need PDF or parser/__tests__/fixtures/siriu-topology.json",
  );
}

function buildRegionBundle(posts, cableEdges) {
  return {
    id: "siriu",
    posts,
    cableEdges,
    postIndex: buildPostIndex(posts),
    adjacencyGraph: buildAdjacencyGraph(posts, cableEdges),
  };
}

function createFixtureLibrary(bundle) {
  return {
    async lookupByGps() {
      return bundle;
    },
    async getRegionWithIndex(id) {
      return id === "siriu" ? bundle : null;
    },
    async addRegion() {},
  };
}

async function loadDwgRegion() {
  const useFixtures =
    process.env.SIRIU_USE_FIXTURES === "1" ||
    process.env.CI === "true" ||
    process.env.GITHUB_ACTIONS === "true";
  if (!useFixtures && existsSync(DXF)) {
    const library = createRegionLibrary(globalThis.indexedDB);
    await library.addRegion(
      "siriu",
      new Blob([readFileSync(DXF, "utf8")], { type: "text/plain" }),
    );
    const region = await library.getRegionWithIndex("siriu");
    return {
      library,
      regionPosts: region.posts ?? [],
      regionEdges: region.cableEdges ?? [],
      postIndex: region.postIndex ?? buildPostIndex(region.posts ?? []),
      adjacencyGraph:
        region.adjacencyGraph ??
        buildAdjacencyGraph(region.posts ?? [], region.cableEdges ?? []),
    };
  }
  if (existsSync(DWG_FIXTURE)) {
    const raw = JSON.parse(readFileSync(DWG_FIXTURE, "utf8"));
    const bundle = buildRegionBundle(raw.posts ?? [], raw.cableEdges ?? []);
    return {
      library: createFixtureLibrary(bundle),
      regionPosts: bundle.posts,
      regionEdges: bundle.cableEdges,
      postIndex: bundle.postIndex,
      adjacencyGraph: bundle.adjacencyGraph,
    };
  }
  throw new Error(
    "Siriu DWG missing: need siriu.dxf or parser/__tests__/fixtures/siriu-dwg-region.json",
  );
}

/**
 * @returns {Promise<{
 *   dwgStatus: string,
 *   posts: Array<{ number: number, lat: number, lon: number, source?: string }>,
 *   errorsByPost: Map<number, number>,
 *   idxByPost: Record<number, number>,
 *   walkOk: boolean,
 *   walkCoords: number,
 *   gpsFirstDivergentPost: number|null,
 * }>}
 */
export async function runSiriuRegressionHarness() {
  const refByNum = new Map(groundTruth.map((g) => [g.number, g]));
  const start = groundTruth[0];

  const parsed = await loadTopology();
  const posts = parsed.posts ?? [];
  const distances = parsed.distances ?? [];

  const { library, regionPosts, regionEdges, postIndex, adjacencyGraph } =
    await loadDwgRegion();

  const result = await calculateCoordinatesWithDwg(
    posts,
    distances,
    start.lat,
    start.lon,
    parsed.cableSegments ?? [],
    {
      pageDimensions: parsed.pageDimensions,
      viewportBoxes: parsed.viewportBoxes,
      utmGridPathsPerPage: parsed.utmGridPathsPerPage,
      distanceLabelItems: parsed.distanceLabelItems ?? [],
      cablePaths: parsed.cablePaths ?? [],
    },
    library,
  );

  const errorsByPost = new Map();
  for (const p of result.posts ?? []) {
    const ref = refByNum.get(p.number);
    if (!ref || p.lat == null || p.lon == null) continue;
    if ((p.source ?? "pdf") !== "dwg") continue;
    errorsByPost.set(
      p.number,
      haversineMeters(p.lat, p.lon, ref.lat, ref.lon),
    );
  }

  const routePosts = deduplicatePostsPreferLowerPage(
    (result.posts ?? []).length ? result.posts : posts,
  ).sort((a, b) => a.number - b.number);

  const gpsByPostNumber = new Map();
  for (const p of result.posts ?? []) {
    if (p?.number != null && p.lat != null && p.lon != null) {
      gpsByPostNumber.set(p.number, { lat: p.lat, lon: p.lon });
    }
  }

  function runWalk(gps) {
    const prev = process.env.GW_RETURN_IDX;
    process.env.GW_RETURN_IDX = "1";
    const gw = pairPostsByGraphWalk({
      posts: routePosts,
      distances,
      // Use the un-pruned consecutive topology (walkConnections), matching what
      // calculateCoordinatesWithDwg feeds its internal cascade. result.connections
      // is the KMZ-pruned array and would leave the walk no-connection at branch returns.
      connections: result.walkConnections ?? result.connections ?? [],
      startLat: start.lat,
      startLon: start.lon,
      region: { posts: regionPosts, cableEdges: regionEdges },
      postIndex,
      adjacencyGraph,
      warnings: [],
      gpsByPostNumber: gps,
    });
    if (prev == null) delete process.env.GW_RETURN_IDX;
    else process.env.GW_RETURN_IDX = prev;
    return gw;
  }

  const noGps = runWalk(null);
  const withGps = runWalk(gpsByPostNumber);
  const idxByPost = {
    ...(noGps.idxByPostNumber ?? {}),
    ...(withGps.idxByPostNumber ?? {}),
  };

  let gpsFirstDivergentPost = null;
  for (let n = 1; n <= 46; n++) {
    if ((noGps.idxByPostNumber?.[n] ?? null) !== (withGps.idxByPostNumber?.[n] ?? null)) {
      gpsFirstDivergentPost = n;
      break;
    }
  }

  const walk = withGps.ok ? withGps : noGps;

  return {
    dwgStatus: result.dwgStatus ?? "unknown",
    posts: result.posts ?? [],
    errorsByPost,
    idxByPost,
    walkOk: Boolean(walk.ok),
    walkCoords: (walk.coords ?? walk.partialCoords ?? []).length,
    gpsFirstDivergentPost,
  };
}
