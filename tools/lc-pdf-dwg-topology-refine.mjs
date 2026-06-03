/**
 * LC PDF gate only: re-associate distances and apply bifurcation with DWG cable-topology
 * after projecting posts through page UTM transforms (anchor = GT post 1).
 */
import { buildPageTransforms, computeScaleFactor, projectPost } from "../parser/geo/utm-calibrator.js";
import { buildCablesByPage } from "../parser/cable-builder.js";
import {
  applyBifurcationJunctionLabelRehome,
  associateDistancesRich,
} from "../parser/distance-associator.js";
import { buildTopologyNeighborsByPdfPostNumber } from "../parser/dwg/pdf-post-topology.js";
import { deduplicatePostsPreferLowerPage } from "../parser/post-assembler.js";

/**
 * @param {object} parsed  parsePdf result (mutates distances)
 * @param {{ lat: number, lon: number }} anchor  ground-truth post 1
 * @param {object} dwgRegion  luizcarolino-dwg-region.json payload
 */
export function refinePdfDistancesWithDwgTopology(parsed, anchor, dwgRegion) {
  const posts = deduplicatePostsPreferLowerPage(parsed.posts ?? []);
  const distItems = parsed.distanceLabelItems ?? [];
  const pageDimensions = parsed.pageDimensions;
  const viewportBoxes = parsed.viewportBoxes ?? [];
  const utmGridPathsPerPage = parsed.utmGridPathsPerPage;
  if (!posts.length || !distItems.length || !pageDimensions) return 0;

  const post1 = posts.find((p) => p.number === posts[0].number);
  if (!post1) return 0;

  const page2Paths = utmGridPathsPerPage?.get?.(2) ?? utmGridPathsPerPage?.[2] ?? [];
  const scaleFactor = computeScaleFactor(page2Paths, []) ?? null;
  if (scaleFactor == null) return 0;

  const pageTransforms = buildPageTransforms(
    { ...post1, lat: anchor.lat, lon: anchor.lon },
    pageDimensions,
    viewportBoxes,
    scaleFactor,
    22,
    [],
    utmGridPathsPerPage,
    false,
  );
  if (!pageTransforms?.size) return 0;

  for (const p of posts) {
    const t = pageTransforms.get(p.pageNum ?? 1);
    if (!t) continue;
    const { lat, lon } = projectPost(p.anchorX ?? p.x, p.anchorY ?? p.y, t);
    p.lat = lat;
    p.lon = lon;
  }

  const topologyNeighbors = buildTopologyNeighborsByPdfPostNumber(
    posts,
    dwgRegion,
    { zone: 22 },
  );

  const cablesByPage = buildCablesByPage(parsed.cableSegments ?? []);
  const { distances, warnings } = associateDistancesRich(
    posts,
    distItems,
    [],
    { perPageScale: () => scaleFactor },
  );
  applyBifurcationJunctionLabelRehome(
    posts,
    distItems,
    distances,
    warnings,
    cablesByPage,
    { topologyNeighborsByPost: topologyNeighbors },
  );

  parsed.distances = distances;
  parsed.posts = posts;
  if (warnings.length) parsed.warnings = [...(parsed.warnings ?? []), ...warnings];
  return topologyNeighbors?.size ?? 0;
}
