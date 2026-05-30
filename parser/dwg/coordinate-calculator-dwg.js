import { calculateCoordinates } from "../coordinate-calculator.js";
import { deduplicatePostsPreferLowerPage } from "../post-assembler.js";

import {
  buildAdjacencyGraph,
  buildPostIndex,
  pairPostsAgainstRegion,
} from "./region-pairing.js";
import { pairPostsByGraphWalk } from "./graph-walker.js";

/** @param {unknown} w */
export function formatDwgWarning(w) {
  if (typeof w === "string") return w;
  if (!w || typeof w !== "object") return String(w);
  const o = /** @type {Record<string, unknown>} */ (w);
  switch (o.kind) {
    case "dwg-region-miss":
      if (o.regionId)
        return `DWG: região "${o.regionId}" não encontrada na biblioteca.`;
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
    case "dwg-tolerance-relaxed": {
      const d =
        o.picked_distance_m != null
          ? Number(o.picked_distance_m).toFixed(1)
          : "?";
      return `DWG: tolerância relaxada no poste ${o.at_post} (tol ${o.base_tol_m}→${o.tol_m} m, escolhido ${d} m).`;
    }
    case "dwg-pair-collision":
      return `DWG: colisão de INSERT no poste ${o.at_post}. Usando só PDF.`;
    case "dwg-missing-distance":
      return `DWG: distância ausente ${o.from}→${o.to}.`;
    case "dwg-graph-walk-fail": {
      const reasonMap = {
        "no-anchor": "sem âncora próxima ao GPS",
        "no-candidate": "nenhum vizinho de cabo disponível",
        ambiguous: "múltiplos candidatos sem desempate",
        "tolerance-exceeded": "span fora da tolerância",
        unpaired: "poste sem pareamento ao final",
        "no-connection": "conexão ausente",
        collision: "colisão (defensivo)",
      };
      const reason = reasonMap[o.reason] ?? o.reason ?? "falha";
      return `DWG (graph-walk): poste ${o.at_post} — ${reason}. Tentando pdf-walk.`;
    }
    case "dwg-graph-walk-tiebreak":
      return `DWG (graph-walk): poste ${o.at_post} — desempate sem look-ahead (${o.candidates ?? "?"} candidatos).`;
    default:
      return `DWG: ${o.kind ?? "aviso"}`;
  }
}

/**
 * Three-level DWG pairing cascade (D-DWGG-PIV-02):
 *   1. pairPostsByGraphWalk        → dwgPath: "dwg-graph-walk"
 *   2. pairPostsAgainstRegion      → dwgPath: "dwg-pdf-walk"
 *   3. (caller falls through to PDF-only) → dwgStatus: "pdf-fallback"
 */
function runDwgPairingCascade({
  posts,
  distances,
  connections,
  startLat,
  startLon,
  regionData,
  regionPosts,
  regionEdges,
  postIndex,
  adjacencyGraph,
  warnings,
  gpsByPostNumber,
}) {
  // Level 1: DWG-graph-first
  const level1 = pairPostsByGraphWalk({
    posts,
    distances,
    connections,
    startLat,
    startLon,
    region: { ...regionData, posts: regionPosts, cableEdges: regionEdges },
    postIndex,
    adjacencyGraph,
    warnings,
    gpsByPostNumber,
  });
  if (level1.ok) {
    return { ok: true, coords: level1.coords, dwgPath: "dwg-graph-walk" };
  }

  // Level 2: existing PDF-driven walk (UNCHANGED — D-DWGG-PIV-03)
  const level2 = pairPostsAgainstRegion({
    posts,
    distances,
    connections,
    startLat,
    startLon,
    region: { ...regionData, posts: regionPosts, cableEdges: regionEdges },
    postIndex,
    adjacencyGraph,
    warnings,
    gpsByPostNumber,
  });
  if (level2.ok) {
    return { ok: true, coords: level2.coords, dwgPath: "dwg-pdf-walk" };
  }

  // Both DWG levels failed; caller will use pdf-only result.
  return { ok: false };
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
  // Prefer walkConnections: the full consecutive topology snapshotted before
  // finalizeBifurcationConnections prunes branch-return/jumpback edges for KMZ
  // rendering. The graph-walk iterates posts in numeric order and needs an entry
  // for every consecutive pair (e.g. 9→10); the pruned `connections` array would
  // leave it with no-connection at branch-return rejoins and force pdf-fallback.
  const connections =
    Array.isArray(opts?.connections) && opts.connections.length > 0
      ? opts.connections
      : (pdfResult.walkConnections ?? pdfResult.connections ?? []);

  // PDF parse order is not route order; calculateCoordinates returns posts sorted
  // by number and builds connections for consecutive numeric pairs (12→13, not 12→24).
  // Graph-walk must use that same sequence or it hits no-connection on the first
  // out-of-order hop (e.g. Siriu: parse order …12,24,23… after post 12).
  const routePosts = deduplicatePostsPreferLowerPage(
    Array.isArray(pdfResult.posts) && pdfResult.posts.length > 0
      ? pdfResult.posts
      : posts,
  ).sort((a, b) => a.number - b.number);

  const gpsByPostNumber = new Map();
  for (const p of pdfResult.posts ?? []) {
    if (p?.number != null && p.lat != null && p.lon != null) {
      gpsByPostNumber.set(p.number, { lat: p.lat, lon: p.lon });
    }
  }

  const cascade = runDwgPairingCascade({
    posts: routePosts,
    distances,
    connections,
    startLat: lat1,
    startLon: lon1,
    regionData,
    regionPosts,
    regionEdges,
    postIndex,
    adjacencyGraph,
    warnings,
    gpsByPostNumber,
  });

  if (!cascade.ok) {
    return {
      ...pdfResult,
      warnings: [...(pdfResult.warnings ?? []), ...warnings],
      dwgStatus: "pdf-fallback",
      dwgRegionId: region.id ?? region.name,
    };
  }

  const coordByPost = new Map(cascade.coords.map((c) => [c.postNumber, c]));
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
    dwgStatus: cascade.dwgPath,
    dwgRegionId: region.id ?? region.name,
  };
}
