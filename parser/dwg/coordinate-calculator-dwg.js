import { calculateCoordinates } from "../coordinate-calculator.js";
import { deduplicatePostsPreferLowerPage } from "../post-assembler.js";
import {
  applyTopologyBranchArmRehome,
  revertFalseBifurcationsByTopology,
  mergeSplitSpanLabels,
  demoteDuplicateWindowRefineLabels,
} from "../distance-associator.js";
import { buildCablesByPage } from "../cable-builder.js";

import {
  buildAdjacencyGraph,
  buildPostIndex,
  pairPostsAgainstRegion,
} from "./region-pairing.js";
import { pairPostsByGraphWalk } from "./graph-walker.js";
import { solveGlobalGraphAlignment, INVENTED_DISTANCE_SOURCES } from "./global-solver.js";
import { deriveCableTopology, buildCableTopologyMaps } from "./cable-topology.js";
import { cropRegionToBbox, routeUtmBbox } from "./region-crop.js";
import { computeResiduals, computeAnchorGap, applyResidualGate, ANCHOR_FALLBACK_M } from "./residual-gate.js";
import { repairMissingPoles } from "./virtual-pole-repair.js";
import { haversineMeters } from "../geo/utm-calibrator.js";


/** @param {number} lat @param {number} lon @param {Array<{ name?: string, bboxLatLon?: { minLat: number, maxLat: number, minLon: number, maxLon: number } }>} regions */
export function noRegionError(lat, lon, regions) {
  let best = null;
  let bestDistKm = Infinity;

  for (const r of regions ?? []) {
    const b = r?.bboxLatLon;
    if (!b) continue;
    const cLat = (b.minLat + b.maxLat) / 2;
    const cLon = (b.minLon + b.maxLon) / 2;
    const distKm = haversineMeters(lat, lon, cLat, cLon) / 1000;
    if (distKm < bestDistKm) {
      bestDistKm = distKm;
      best = { name: r.name ?? r.id ?? "unknown", distanceKm: distKm };
    }
  }

  return { code: "NO_REGION", nearest: best };
}

/** @param {unknown} w */
/**
 * User-facing notices after route calculation (main UI, not developer tools).
 *
 * @param {{ posts?: Array<{ source?: string }>, dwgStatus?: string, dwgRegionId?: string, dwgNoRegion?: { code?: string, nearest?: { name?: string, distanceKm?: number } } | null, dwgConfidence?: { postTiers?: Array<{ postNumber: number, tier: string }> } | null }} result
 * @returns {string[]}
 */
export function buildCalcUserWarnings(result) {
  const notices = [];
  const posts = result?.posts ?? [];
  const total = posts.length;
  if (total === 0) return notices;

  const dwgCount = posts.filter((p) => p.source === "dwg").length;
  const status = result.dwgStatus ?? null;
  const regionHint = result.dwgRegionId
    ? ` Região DXF: ${result.dwgRegionId}.`
    : "";

  if (status === "pdf-fallback" || dwgCount === 0) {
    // No-region miss must be stated explicitly in the main workflow — not only in
    // the hidden dev-tools warning list (phase 06 UAT test 4 gap).
    const noRegion = result.dwgNoRegion ?? null;
    if (noRegion) {
      let msg =
        "Nenhuma região DXF carregada cobre o GPS do poste 1 — o cálculo usou apenas o PDF.";
      const nearest = noRegion.nearest;
      if (nearest?.name && Number.isFinite(Number(nearest.distanceKm))) {
        msg +=
          ` Região mais próxima: ${nearest.name}` +
          ` (${Number(nearest.distanceKm).toFixed(1)} km).`;
      }
      msg += " Carregue o DXF da região correta e calcule novamente.";
      notices.push(msg);
    }
    notices.push(
      "Precisão limitada: coordenadas calculadas só pelo PDF — o pareamento DXF não concluiu." +
        regionHint +
        " Em projetos grandes a rota costuma ficar imprecisa; carregue a região DXF correta e calcule novamente.",
    );
  } else if (status === "dwg-pdf-walk") {
    notices.push(
      "Precisão parcial: o DXF foi usado em modo guiado pelo PDF (menos rigoroso que graph-walk)." +
        regionHint +
        " Revise o KMZ em trechos críticos antes de liberar o projeto.",
    );
  }

  if (dwgCount > 0 && dwgCount < total) {
    notices.push(
      `Somente ${dwgCount} de ${total} postes usam coordenadas do DXF; os demais permanecem no PDF.`,
    );
  }

  // Per-post confidence call-outs (tiers no longer recolor the KMZ icons, so
  // the MED/LOW posts are listed here instead — labels only, no numeric %).
  const tiers = result?.dwgConfidence?.postTiers ?? [];
  const lowPosts = tiers
    .filter((t) => t.tier === "LOW")
    .map((t) => t.postNumber);
  const medPosts = tiers
    .filter((t) => t.tier === "MED")
    .map((t) => t.postNumber);
  if (lowPosts.length > 0) {
    notices.push(
      `Postes com confiança BAIXA: ${lowPosts.join(", ")} — revise a posição destes postes no KMZ antes de liberar.`,
    );
  }
  if (medPosts.length > 0) {
    notices.push(`Postes com confiança MÉDIA: ${medPosts.join(", ")}.`);
  }

  return notices;
}

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
    case "diverged-at-post":
      // D-09: route diverged from its PDF anchor at this post (meters, never %).
      return `DXF: rota divergiu no poste ${o.at_post} (resíduo ${Number(o.residual_m).toFixed(1)} m).`;
    case "dwg-tolerance-relaxed": {
      const d =
        o.picked_distance_m != null
          ? Number(o.picked_distance_m).toFixed(1)
          : "?";
      return `DWG: tolerância relaxada no poste ${o.at_post} (tol ${o.base_tol_m}→${o.tol_m} m, escolhido ${d} m).`;
    }
    case "dwg-pair-collision":
      return `DWG: colisão de INSERT no poste ${o.at_post}. Usando só PDF.`;
    case "dwg-virtual-pole-repair": {
      const posts = Array.isArray(o.posts) ? o.posts.join(", ") : "?";
      const virt = Array.isArray(o.virtual_posts) ? o.virtual_posts : [];
      const virtTxt = virt.length
        ? ` Poste(s) ${virt.join(", ")} reposicionado(s) como poste projetado (sem correspondente na base DXF).`
        : "";
      return (
        `DXF: postes ${posts} reajustados pela geometria do cabo projetado ` +
        `(resíduo ${o.cost_before_m}m → ${o.cost_after_m}m).` +
        virtTxt
      );
    }
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
 * Four-level DWG pairing cascade (D-DWGG-PIV-02 + SOLVE-02):
 *   0. solveGlobalGraphAlignment   → dwgPath: "global-solve"
 *   1. pairPostsByGraphWalk        → dwgPath: "dwg-graph-walk"
 *   2. pairPostsAgainstRegion      → dwgPath: "dwg-pdf-walk"
 *   3. (caller falls through to PDF-only) → dwgStatus: "pdf-fallback"
 */
export function runDwgPairingCascade({
  posts,
  distances,
  solverDistances,
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
  routeTopologyNeighbors,
  solverDebugSink,
  _testDeps,
}) {
  const solveFn = _testDeps?.solve ?? solveGlobalGraphAlignment;
  const walkFn = _testDeps?.walk ?? pairPostsByGraphWalk;

  // Level 0: global PDF→DXF solver (strangler-fig; demotes to graph-walk on
  // any accept-bar fail). Sees the repaired solver-only distance view;
  // levels 1–2 below keep the pristine `distances`.
  const level0 = solveFn({
    posts,
    distances: solverDistances ?? distances,
    connections,
    startLat,
    startLon,
    regionData,
    regionPosts,
    regionEdges,
    postIndex,
    adjacencyGraph,
    gpsByPostNumber,
    routeTopologyNeighbors,
    debugSink: solverDebugSink,
  });
  if (solverDebugSink) {
    solverDebugSink.level0Reason = level0.ok ? null : (level0.reason ?? null);
    solverDebugSink.level0Coords = level0.coords ?? level0.partialCoords ?? null;
    solverDebugSink.level0Score = level0.solverScore ?? null;
    solverDebugSink.cascadeInputs = {
      posts,
      distances: solverDistances ?? distances,
      connections,
      regionPosts,
      regionEdges,
      gpsByPostNumber,
    };
  }
  if (level0.ok) {
    return {
      ok: true,
      coords: level0.coords,
      dwgPath: "global-solve",
      solverScore: level0.solverScore ?? null,
      solverDemoted: false,
      demotionReason: null,
    };
  }

  warnings.push({ kind: "dwg-solver-demoted", reason: level0.reason });

  // Level 1: DWG-graph-first (UNCHANGED — pristine inputs, never solver-derived state)
  const level1 = walkFn({
    posts,
    distances,
    connections,
    startLat,
    startLon,
    region: {
      ...regionData,
      posts: regionPosts,
      cableEdges: regionEdges,
    },
    postIndex,
    adjacencyGraph,
    warnings,
    gpsByPostNumber,
  });
  if (level1.ok) {
    return {
      ok: true,
      coords: level1.coords,
      dwgPath: "dwg-graph-walk",
      solverDemoted: true,
      demotionReason: level0.reason ?? null,
      // Diagnostic passthrough: what the demoted solver scored/produced, so
      // demotions are observable downstream (probes + acceptance gate).
      solverScore: level0.solverScore ?? null,
      solverPartialCoords: level0.partialCoords ?? null,
    };
  }

  // Level 2: existing PDF-driven walk (UNCHANGED — D-DWGG-PIV-03)
  const level2 = pairPostsAgainstRegion({
    posts,
    distances,
    connections,
    startLat,
    startLon,
    region: {
      ...regionData,
      posts: regionPosts,
      cableEdges: regionEdges,
    },
    postIndex,
    adjacencyGraph,
    warnings,
    gpsByPostNumber,
  });
  if (level2.ok) {
    return {
      ok: true,
      coords: level2.coords,
      dwgPath: "dwg-pdf-walk",
      solverDemoted: true,
      demotionReason: level0.reason ?? null,
      solverScore: level0.solverScore ?? null,
      solverPartialCoords: level0.partialCoords ?? null,
    };
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
      const hit = await regionLibrary.lookupByGps(lat1, lon1);
      if (hit?.id && typeof regionLibrary.getRegionWithIndex === "function") {
        region = await regionLibrary.getRegionWithIndex(hit.id);
      } else {
        region = hit;
      }
    }
  } catch (e) {
    warnings.push({
      kind: "dwg-region-miss",
      lat: lat1,
      lon: lon1,
      error: String(e?.message ?? e),
    });
    const regions =
      typeof regionLibrary.listRegions === "function"
        ? await regionLibrary.listRegions()
        : [];
    const dwgNoRegion = noRegionError(lat1, lon1, regions);
    const fallback = calculateCoordinates(
      posts,
      distances,
      lat1,
      lon1,
      cableSegments,
      opts,
    );
    const missResult = {
      ...fallback,
      warnings: [...(fallback.warnings ?? []), ...warnings],
      dwgStatus: "pdf-fallback",
      dwgRegionId: regionId ?? null,
      dwgNoRegion,
      hardBlock: true, // D-12/D-13: region lookup threw / no region → BLOCK (no KMZ)
    };
    missResult.userWarnings = buildCalcUserWarnings(missResult);
    return missResult;
  }

  if (!region) {
    warnings.push({ kind: "dwg-region-miss", lat: lat1, lon: lon1 });
    const regions =
      typeof regionLibrary.listRegions === "function"
        ? await regionLibrary.listRegions()
        : [];
    const dwgNoRegion = noRegionError(lat1, lon1, regions);
    const fallback = calculateCoordinates(
      posts,
      distances,
      lat1,
      lon1,
      cableSegments,
      opts,
    );
    const missResult = {
      ...fallback,
      warnings: [...(fallback.warnings ?? []), ...warnings],
      dwgStatus: "pdf-fallback",
      dwgRegionId: regionId ?? null,
      dwgNoRegion,
      hardBlock: true, // D-12/D-13: no region covers post-1 GPS → BLOCK (no KMZ)
    };
    missResult.userWarnings = buildCalcUserWarnings(missResult);
    return missResult;
  }

  const regionData = region;

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

  const zoneExpected = regionData?.crs?.zone ?? 22;
  const cropMarginM = opts?.dwgCropMarginM ?? 200;
  const routeBbox = routeUtmBbox(
    [{ lat: lat1, lon: lon1 }, ...routePosts],
    zoneExpected,
    cropMarginM,
  );
  const croppedRegion = cropRegionToBbox(regionData, routeBbox);
  const regionPosts = croppedRegion.posts ?? [];
  const regionEdges = croppedRegion.cableEdges ?? [];
  const postIndex = buildPostIndex(regionPosts);
  const adjacencyGraph = buildAdjacencyGraph(regionPosts, regionEdges, {
    postIndex,
  });
  if (routeBbox && (regionData.posts?.length ?? 0) > regionPosts.length) {
    warnings.push({
      kind: "dwg-region-cropped",
      full_posts: regionData.posts.length,
      cropped_posts: regionPosts.length,
      margin_m: cropMarginM,
    });
  }

  const gpsByPostNumber = new Map();
  for (const p of pdfResult.posts ?? []) {
    if (p?.number != null && p.lat != null && p.lon != null) {
      gpsByPostNumber.set(p.number, { lat: p.lat, lon: p.lon });
    }
  }

  const distItems = opts?.distanceLabelItems;
  const cablePaths = opts?.cablePaths;
  let routeTopologyNeighbors = null;
  // SOLVER-ONLY distance view (level 0). The bifurcation revert and the
  // split-span merge produce values verified correct against ground truth
  // (Siriu 59→60 merge 51.5 vs GT 51.4), yet feeding them to the graph-walker
  // BREAKS it: the walker's heuristics (hub-hints, branch tie-breaks) are
  // calibrated against the original label set, wrong values included — Siriu
  // posts 65–74 went to 900 m when the walker saw the repaired labels. The
  // cascade contract is "level 1 gets pristine inputs"; the repairs therefore
  // apply to a CLONE consumed only by the level-0 solver (and by the solver
  // path's confidence scoring).
  let solverDistances = distances;
  if (Array.isArray(distItems) && distItems.length > 0) {
    const cablesByPage =
      Array.isArray(cablePaths) && cablePaths.length > 0
        ? buildCablesByPage(cablePaths)
        : null;
    const postsForTopo = (pdfResult.posts ?? routePosts).filter(
      (p) => p.lat != null && p.lon != null,
    );
    // SECONDARY cables only (cable-topology.js design contract): the route
    // strings the distribution network. Primary trunk polylines run past
    // poles the route skips, so contracting them yields false post-to-post
    // adjacency — on the real Palhoca DXF the trunk made LC post 2 read as a
    // junction (2–4 "adjacent" because deformed post 3 missed attachR),
    // which kept the false bifurcation 2→4 alive and broke the whole 4–12
    // chain. Curated fixtures never had primaries, which is why gates stayed
    // green while browser runs against full city DXFs diverged.
    const cableEdgesForTopo = croppedRegion.cableEdges ?? regionEdges ?? [];
    const { neighborsByPost } = buildCableTopologyMaps(
      postsForTopo.length ? postsForTopo : routePosts,
      cableEdgesForTopo,
      { zone: zoneExpected },
    );
    solverDistances = distances.map((d) => ({ ...d }));
    if (neighborsByPost.size > 0) {
      routeTopologyNeighbors = neighborsByPost;
      // Pre-existing, walker-visible (part of the Siriu-green baseline).
      applyTopologyBranchArmRehome(
        routePosts,
        distItems,
        distances,
        warnings,
        cablesByPage,
        { topologyNeighborsByPost: neighborsByPost },
      );
      // Re-clone so the solver view includes the rehome plus the solver-only
      // repairs below.
      solverDistances = distances.map((d) => ({ ...d }));
      revertFalseBifurcationsByTopology(
        routePosts,
        distItems,
        solverDistances,
        warnings,
        { topologyNeighborsByPost: neighborsByPost },
      );
    }
    // Split-span merge needs the ORIGINAL parsed page coords (placement moves
    // posts to match the labels being repaired), hence `posts`, not routePosts.
    // NOTE: deliberately NO placement re-run on the repaired distances — the
    // label-lsq page-origin fit is under-constrained at sheet seams and a
    // re-run destabilizes walkConnections (verified on LC: walker lost its
    // route entirely). The repaired meters feed the level-0 solver only; the
    // PDF placement and the walker keep their original, proven behavior.
    mergeSplitSpanLabels(posts, distItems, solverDistances, warnings);
    demoteDuplicateWindowRefineLabels(solverDistances, warnings, posts, distItems);
  }

  const cascade = runDwgPairingCascade({
    posts: routePosts,
    distances,
    solverDistances,
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
    routeTopologyNeighbors,
    solverDebugSink: opts?.solverDebugSink,
  });

  if (!cascade.ok) {
    const fallbackResult = {
      ...pdfResult,
      warnings: [...(pdfResult.warnings ?? []), ...warnings],
      dwgStatus: "pdf-fallback",
      dwgRegionId: region.id ?? region.name,
      hardBlock: false, // D-13: a DXF region MATCHED then degraded → FLAG + emit, never block
    };
    fallbackResult.userWarnings = buildCalcUserWarnings(fallbackResult);
    return fallbackResult;
  }

  // Virtual-pole repair (solver path only): a projected NEW pole exists only
  // as a Cabo Projetado bend in the PDF, never in the DXF base, so the solver
  // shoehorns its printed-span chain onto wrong neighbors (Bibi Ferreira posts
  // 3–4). Re-place grossly misfitting interior posts from the cable-kink
  // geometry; applied only when it removes most of the local span misfit.
  if (cascade.dwgPath === "global-solve") {
    const repair = repairMissingPoles({
      coords: cascade.coords,
      distances: solverDistances,
      inventedSources: INVENTED_DISTANCE_SOURCES,
      routePosts,
      pageTransforms: pdfResult.pageTransforms,
      cablePaths: opts?.cablePaths,
      postIndex,
      zone: zoneExpected,
      warnings,
    });
    if (repair.changed) cascade.coords = repair.coords;
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

  // Derive route topology from the cable geometry (generic — no post numbers, no
  // per-network corrections). At branch points post numbering + distance labels are
  // ambiguous; the cable polylines encode the real connectivity. Falls back to the
  // label-based connections when the cable can't be read (no GPS / no cable layer).
  // Secondary only — same false-adjacency reasoning as cableEdgesForTopo above.
  const cableEdgesAll = croppedRegion.cableEdges ?? regionEdges ?? [];
  const cableTopo = deriveCableTopology(dwgPosts, cableEdgesAll, {
    zone: zoneExpected,
  });
  const useCable =
    cableTopo && Array.isArray(cableTopo.edges) && cableTopo.edges.length > 0;

  const successResult = {
    ...pdfResult,
    posts: dwgPosts,
    connections: useCable ? cableTopo.edges : pdfResult.connections,
    warnings: [...(pdfResult.warnings ?? []), ...warnings],
    dwgStatus: cascade.dwgPath,
    dwgRegionId: region.id ?? region.name,
    hardBlock: false, // D-13: region matched and coords assembled → FLAG by tier, never block
  };
  if (useCable) {
    successResult.warnings.push(
      `[dwg] route topology derived from cable geometry ` +
        `(${cableTopo.edges.length} edges, ${cableTopo.components} component(s), ${cableTopo.bridges} bridge(s))`,
    );
  }
  // Truth-free residual gate (D-01, pure judge): rate the assembled route with
  // two independent sub-scores and attach a confidence verdict. This NEVER
  // mutates posts/connections/coordinates — it only measures. The solver path
  // is scored against the repaired distance view it solved with — minus the
  // invented-source edges (jumpback-refill / inferred-label / window-refine-
  // duplicate), whose meters are heuristic refills, not printed labels: a
  // correct solve scores relError ≈ 11 on LC's 20→21 jumpback and would be
  // tiered LOW by fiction. Walker paths keep the pristine labels their
  // baselines were locked on.
  const isSolverPath = cascade.dwgPath === "global-solve";
  const shape = computeResiduals(
    cascade.coords,
    isSolverPath
      ? solverDistances.filter((d) => !INVENTED_DISTANCE_SOURCES.has(d.source))
      : distances,
  );
  const anchor = computeAnchorGap(cascade.coords, gpsByPostNumber);
  // dwgConfidence carries `overall` (D-08) + per-post sub-scores (D-06) from the
  // gate. On an ACCEPTED solve the anchor sub-score is advisory: the coords are
  // surveyed DXF nodes (post-1 pinned, topology-gated), so DWG-vs-PDF gaps
  // measure PDF deformation, not route quality — tiering on them marked every
  // post of a ~1 m-true-error route LOW (see residual-gate.js anchorAdvisory).
  successResult.dwgConfidence = applyResidualGate(shape, anchor, {
    anchorAdvisory: isSolverPath,
  });

  // D-09: surface a `diverged-at-post` warning for the worst anchor gap when it
  // crosses the fallback band — a read-only lookup over the already-computed
  // anchor.perPost (no new math). The post with the maximum gapM is reported.
  // Solver path included: there the warning documents WHERE the PDF placement
  // drifts furthest from the accepted solve (diagnostic, dev warning list only).
  let worstGapPost = null;
  for (const p of anchor?.perPost ?? []) {
    if (worstGapPost == null || p.gapM > worstGapPost.gapM) worstGapPost = p;
  }
  if (worstGapPost && worstGapPost.gapM >= ANCHOR_FALLBACK_M) {
    successResult.warnings.push({
      kind: "diverged-at-post",
      at_post: worstGapPost.postNumber,
      residual_m: worstGapPost.gapM,
    });
  }

  successResult.solverPath = cascade.dwgPath;
  successResult.solverDemoted = cascade.solverDemoted ?? false;
  successResult.demotionReason = cascade.demotionReason ?? null;
  successResult.solverScore = cascade.solverScore ?? null;
  successResult.solverPartialCoords = cascade.solverPartialCoords ?? null;
  if (cascade.solverDemoted) {
    successResult.warnings.push(
      `[dwg] solver demoted (${cascade.demotionReason ?? "unknown"}); graph-walker emitted coords`,
    );
  } else if (cascade.dwgPath === "global-solve") {
    successResult.warnings.push("[dwg] global-solve accepted");
  }

  successResult.userWarnings = buildCalcUserWarnings(successResult);
  return successResult;
}
