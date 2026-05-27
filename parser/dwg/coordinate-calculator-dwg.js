import { buildAdjacencyGraph, buildPostIndex, pairPostsAgainstRegion } from "./region-pairing.js";

/** Browser sets globalThis.__pdfToKmzCalculateCoordinates before loading dist/dwg.bundle.js. */
async function resolveCalculateCoordinates() {
  const injected = globalThis.__pdfToKmzCalculateCoordinates;
  if (typeof injected === "function") return injected;
  const { calculateCoordinates } = await import("../coordinate-calculator.js");
  return calculateCoordinates;
}

export async function calculateCoordinatesWithDwg(
  posts,
  distances,
  lat1,
  lon1,
  cableSegments,
  opts,
  regionLibrary,
) {
  const calculateCoordinates = await resolveCalculateCoordinates();

  if (!regionLibrary) {
    // D-DWG-COEXIST-01: exact delegation, no extra processing.
    return calculateCoordinates(posts, distances, lat1, lon1, cableSegments, opts);
  }

  const warnings = [];

  let region = null;
  try {
    region = await regionLibrary.lookupByGps(lat1, lon1);
  } catch (e) {
    warnings.push({ kind: "dwg-region-miss", lat: lat1, lon: lon1, error: String(e?.message ?? e) });
    const fallback = calculateCoordinates(posts, distances, lat1, lon1, cableSegments, opts);
    return { ...fallback, warnings: [...(fallback.warnings ?? []), ...warnings] };
  }

  if (!region) {
    warnings.push({ kind: "dwg-region-miss", lat: lat1, lon: lon1 });
    const fallback = calculateCoordinates(posts, distances, lat1, lon1, cableSegments, opts);
    return { ...fallback, warnings: [...(fallback.warnings ?? []), ...warnings] };
  }

  let regionWithIndex = null;
  if (typeof regionLibrary.getRegionWithIndex === "function") {
    regionWithIndex = await regionLibrary.getRegionWithIndex(region.id);
  }
  const regionData = regionWithIndex ?? region;

  const regionPosts = regionData.posts ?? region.posts ?? [];
  const regionEdges = regionData.cableEdges ?? region.cableEdges ?? [];
  const postIndex = regionData.postIndex ?? buildPostIndex(regionPosts);
  const adjacencyGraph = regionData.adjacencyGraph ?? buildAdjacencyGraph(regionPosts, regionEdges);

  const connections = opts?.connections ?? [];
  const pairing = pairPostsAgainstRegion({
    posts,
    distances,
    connections,
    startLat: lat1,
    startLon: lon1,
    region: { ...regionData, posts: regionPosts, cableEdges: regionEdges },
    postIndex,
    adjacencyGraph,
    warnings,
  });

  if (!pairing.ok) {
    const fallback = calculateCoordinates(posts, distances, lat1, lon1, cableSegments, opts);
    return { ...fallback, warnings: [...(fallback.warnings ?? []), ...warnings] };
  }

  // Keep the connection/topology computation identical to the PDF path; only substitute lat/lon.
  const pdfResult = calculateCoordinates(posts, distances, lat1, lon1, cableSegments, opts);

  const coordByPost = new Map(pairing.coords.map((c) => [c.postNumber, c]));
  const dwgPosts = (pdfResult.posts ?? posts).map((p) => {
    const c = coordByPost.get(p.number);
    if (!c) return p;
    return { ...p, lat: c.lat, lon: c.lon, source: "dwg", dwg_block: c.dwg_block };
  });

  return {
    ...pdfResult,
    posts: dwgPosts,
    warnings: [...(pdfResult.warnings ?? []), ...warnings],
  };
}

