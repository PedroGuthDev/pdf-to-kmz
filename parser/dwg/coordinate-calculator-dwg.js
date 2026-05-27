import { calculateCoordinates } from "../coordinate-calculator.js";

import {
  buildAdjacencyGraph,
  buildPostIndex,
  pairPostsAgainstRegion,
} from "./region-pairing.js";

/** @param {unknown} w */
export function formatDwgWarning(w) {
  if (typeof w === "string") return w;
  if (!w || typeof w !== "object") return String(w);
  const o = /** @type {Record<string, unknown>} */ (w);
  switch (o.kind) {
    case "dwg-region-miss":
      if (o.regionId) return `DWG: região "${o.regionId}" não encontrada na biblioteca.`;
      return `DWG: nenhuma região cobre o GPS do poste 1 (${o.lat}, ${o.lon}). Usando só PDF.`;
    case "dwg-zone-mismatch":
      return `DWG: zona UTM ${o.got} ≠ esperada ${o.expected}.`;
    case "dwg-pair-fail": {
      const dist =
        o.nearest_dwg_distance_m != null
          ? `${Number(o.nearest_dwg_distance_m).toFixed(1)} m`
          : "sem candidato";
      return `DWG: pareamento falhou no poste ${o.at_post} (mais próximo ${dist}, tol ${o.tolerance_m} m). Usando só PDF.`;
    }
    case "dwg-pair-collision":
      return `DWG: colisão de INSERT no poste ${o.at_post}. Usando só PDF.`;
    case "dwg-missing-distance":
      return `DWG: distância ausente ${o.from}→${o.to}.`;
    default:
      return `DWG: ${o.kind ?? "aviso"}`;
  }
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
  if (!regionLibrary) {
    // D-DWG-COEXIST-01: exact delegation, no extra processing.
    return calculateCoordinates(
      posts,
      distances,
      lat1,
      lon1,
      cableSegments,
      opts,
    );
  }

  const warnings = [];

  let region = null;
  const regionId = opts?.dwgRegionId;
  try {
    if (regionId && typeof regionLibrary.getRegionWithIndex === "function") {
      region = await regionLibrary.getRegionWithIndex(regionId);
      if (!region) {
        warnings.push({
          kind: "dwg-region-miss",
          regionId,
          error: "selected region not found",
        });
      }
    } else {
      region = await regionLibrary.lookupByGps(lat1, lon1);
    }
  } catch (e) {
    warnings.push({
      kind: "dwg-region-miss",
      lat: lat1,
      lon: lon1,
      error: String(e?.message ?? e),
    });
    const fallback = calculateCoordinates(
      posts,
      distances,
      lat1,
      lon1,
      cableSegments,
      opts,
    );
    return {
      ...fallback,
      warnings: [...(fallback.warnings ?? []), ...warnings],
    };
  }

  if (!region) {
    warnings.push({ kind: "dwg-region-miss", lat: lat1, lon: lon1 });
    const fallback = calculateCoordinates(
      posts,
      distances,
      lat1,
      lon1,
      cableSegments,
      opts,
    );
    return {
      ...fallback,
      warnings: [...(fallback.warnings ?? []), ...warnings],
    };
  }

  let regionWithIndex = null;
  if (typeof regionLibrary.getRegionWithIndex === "function") {
    regionWithIndex = await regionLibrary.getRegionWithIndex(region.id);
  }
  const regionData = regionWithIndex ?? region;

  const regionPosts = regionData.posts ?? region.posts ?? [];
  const regionEdges = regionData.cableEdges ?? region.cableEdges ?? [];
  const postIndex = regionData.postIndex ?? buildPostIndex(regionPosts);
  const adjacencyGraph =
    regionData.adjacencyGraph ?? buildAdjacencyGraph(regionPosts, regionEdges);

  // PDF path builds route connections; DWG pairing must use the same topology.
  const pdfResult = calculateCoordinates(
    posts,
    distances,
    lat1,
    lon1,
    cableSegments,
    opts,
  );
  const connections =
    Array.isArray(opts?.connections) && opts.connections.length > 0
      ? opts.connections
      : (pdfResult.connections ?? []);

  const gpsByPostNumber = new Map();
  for (const p of pdfResult.posts ?? []) {
    if (p?.number != null && p.lat != null && p.lon != null) {
      gpsByPostNumber.set(p.number, { lat: p.lat, lon: p.lon });
    }
  }

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
    gpsByPostNumber,
  });

  if (!pairing.ok) {
    return {
      ...pdfResult,
      warnings: [...(pdfResult.warnings ?? []), ...warnings],
      dwgStatus: "pdf-fallback",
    };
  }

  const coordByPost = new Map(pairing.coords.map((c) => [c.postNumber, c]));
  const dwgPosts = (pdfResult.posts ?? posts).map((p) => {
    const c = coordByPost.get(p.number);
    if (!c) return p;
    return {
      ...p,
      lat: c.lat,
      lon: c.lon,
      source: "dwg",
      dwg_block: c.dwg_block,
    };
  });

  return {
    ...pdfResult,
    posts: dwgPosts,
    warnings: [...(pdfResult.warnings ?? []), ...warnings],
    dwgStatus: "dwg-active",
    dwgRegionId: region.id ?? region.name,
  };
}
