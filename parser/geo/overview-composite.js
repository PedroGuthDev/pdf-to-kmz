// parser/geo/overview-composite.js
// Remap detail-sheet geometry into page-2 overview PDF space using Padrão viewport boxes.
// Virtual "paste" of high-res detail tiles into the overview coordinate frame (no raster PDF).

import {
  dominantLineOrientation,
  computeScaleFactor,
  latLonToUtm,
  rotatePdfPoint,
  utmFromPdfPoint,
  pdfPointFromUtm,
} from './utm-calibrator.js';

/** Minimum paired viewport boxes to enable overview compositing. */
export const OVERVIEW_COMPOSITE_MIN_VIEWPORTS = 2;

const OVERVIEW_PAGE_NUM = 2;

/**
 * @param {number} detailPageNum
 * @param {Array<{ pageNum: number, rect: { x: number, y: number, w: number, h: number } }>} viewportBoxes
 */
export function viewportBoxForDetailPage(detailPageNum, viewportBoxes) {
  return viewportBoxes.find(v => v.pageNum === detailPageNum) ?? null;
}

/**
 * Map one point from a detail page into page-2 overview coordinates (flipY space).
 * Preserves ground distance: overview_pt × scale_overview ≈ detail_pt × scale_detail.
 *
 * @param {number} x
 * @param {number} y
 * @param {{ x: number, y: number, w: number, h: number }} box  viewport on page 2
 * @param {{ w: number, h: number }} pageDim  detail page size
 * @param {number} scaleDetail  m/pt on the detail sheet
 * @param {number} scaleOverview  m/pt on page 2
 */
export function detailPointToOverview(x, y, box, _pageDim, scaleDetail, scaleOverview) {
  const r =
    scaleOverview > 0 && scaleDetail > 0 ? scaleDetail / scaleOverview : box.w / _pageDim.w;
  return {
    x: box.x + x * r,
    y: box.y + y * r,
  };
}

/**
 * @param {import('../construct-path-parser.js').PathOp} op
 * @param {{ x: number, y: number, w: number, h: number }} box
 * @param {{ w: number, h: number }} pageDim
 * @param {number} scaleDetail
 * @param {number} scaleOverview
 */
export function remapPathOpToOverview(op, box, pageDim, scaleDetail, scaleOverview) {
  const r =
    scaleOverview > 0 && scaleDetail > 0 ? scaleDetail / scaleOverview : box.w / pageDim.w;
  const tx = v => box.x + v * r;
  const ty = v => box.y + v * r;

  switch (op.type) {
    case 'M':
    case 'L':
      return { ...op, x: tx(op.x), y: ty(op.y) };
    case 'C':
      return {
        ...op,
        x1: tx(op.x1),
        y1: ty(op.y1),
        x2: tx(op.x2),
        y2: ty(op.y2),
        x3: tx(op.x3),
        y3: ty(op.y3),
      };
    case 'C2':
      return {
        ...op,
        x1: tx(op.x1),
        y1: ty(op.y1),
        x2: tx(op.x2),
        y2: ty(op.y2),
      };
    case 'Z':
      return op;
    default:
      return op;
  }
}

/**
 * @param {Array<import('../construct-path-parser.js').PathOp>} ops
 * @param {{ x: number, y: number, w: number, h: number }} box
 * @param {{ w: number, h: number }} pageDim
 */
export function remapPathOpsToOverview(ops, box, pageDim, scaleDetail, scaleOverview) {
  return ops.map(op => remapPathOpToOverview(op, box, pageDim, scaleDetail, scaleOverview));
}

/**
 * @param {{ x: number, y: number, pageNum?: number, anchorX?: number, anchorY?: number }} p
 * @param {number} sourcePage
 * @param {{ x: number, y: number, w: number, h: number }} box
 * @param {{ w: number, h: number }} pageDim
 */
function remapPointRecord(p, sourcePage, box, pageDim, scaleDetail, scaleOverview) {
  const pos = detailPointToOverview(p.x, p.y, box, pageDim, scaleDetail, scaleOverview);
  p.x = pos.x;
  p.y = pos.y;
  if (p.anchorX != null && p.anchorY != null) {
    const a = detailPointToOverview(p.anchorX, p.anchorY, box, pageDim);
    p.anchorX = a.x;
    p.anchorY = a.y;
  } else {
    p.anchorX = pos.x;
    p.anchorY = pos.y;
  }
  if (sourcePage !== OVERVIEW_PAGE_NUM) {
    p.detailPageNum = sourcePage;
  }
  p.pageNum = OVERVIEW_PAGE_NUM;
}

/**
 * Remap route geometry from detail pages into page-2 overview space.
 *
 * @param {{
 *   posts: Array,
 *   posteRawCentroids: Array<{ x: number, y: number, pageNum?: number }>,
 *   cablePaths: Array<{ pageNum?: number, ops: Array }>,
 *   distanceLabelItems: Array<{ x: number, y: number, pageNum?: number }>,
 *   textoItems?: Array<{ x: number, y: number, pageNum?: number }>,
 *   utmGridPathsPerPage: Map<number, Array<Array>>,
 *   viewportBoxes: Array<{ pageNum: number, rect: object }>,
 *   pageDimensions: Map<number, { w: number, h: number }>,
 *   warnings: string[],
 *   perPageScale?: (pageNum: number) => number|null,
 * }} bundle
 * @returns {boolean} true when compositing was applied
 */
export function applyOverviewComposite(bundle) {
  const {
    posts,
    posteRawCentroids,
    cablePaths,
    distanceLabelItems,
    textoItems,
    utmGridPathsPerPage,
    viewportBoxes,
    pageDimensions,
    warnings,
    perPageScale,
  } = bundle;

  if (!viewportBoxes?.length || viewportBoxes.length < OVERVIEW_COMPOSITE_MIN_VIEWPORTS) {
    return false;
  }

  const page2Dim = pageDimensions.get(OVERVIEW_PAGE_NUM);
  if (!page2Dim) {
    warnings.push('[overview-composite] skipped — no page 2 dimensions.');
    return false;
  }

  const scaleOverview =
    perPageScale?.(OVERVIEW_PAGE_NUM) ??
    computeScaleFactor(utmGridPathsPerPage.get(OVERVIEW_PAGE_NUM) ?? [], []) ??
    null;
  if (scaleOverview == null || scaleOverview <= 0) {
    warnings.push('[overview-composite] skipped — no page-2 UTM scale.');
    return false;
  }

  const scaleForPage = sourcePage => {
    const sd = perPageScale?.(sourcePage);
    if (sd != null && sd > 0) return sd;
    return scaleOverview;
  };

  const boxByPage = new Map(
    viewportBoxes.map(v => [v.pageNum, v.rect])
  );
  const detailPages = [...boxByPage.keys()].filter(pn => pn !== OVERVIEW_PAGE_NUM);
  if (!detailPages.length) return false;

  let remappedPoints = 0;
  let remappedPaths = 0;

  const remapPage = (sourcePage, mutate) => {
    if (sourcePage === OVERVIEW_PAGE_NUM) return;
    const box = boxByPage.get(sourcePage);
    const pageDim = pageDimensions.get(sourcePage);
    if (!box || !pageDim) return;
    const scaleDetail = scaleForPage(sourcePage);
    mutate(box, pageDim, scaleDetail);
  };

  for (const p of posts) {
    const src = p.pageNum ?? OVERVIEW_PAGE_NUM;
    remapPage(src, (box, pageDim, scaleDetail) => {
      remapPointRecord(p, src, box, pageDim, scaleDetail, scaleOverview);
      remappedPoints++;
    });
  }

  for (const sym of posteRawCentroids) {
    const src = sym.pageNum ?? OVERVIEW_PAGE_NUM;
    remapPage(src, (box, pageDim, scaleDetail) => {
      const pos = detailPointToOverview(sym.x, sym.y, box, pageDim, scaleDetail, scaleOverview);
      sym.x = pos.x;
      sym.y = pos.y;
      sym.pageNum = OVERVIEW_PAGE_NUM;
      remappedPoints++;
    });
  }

  for (const item of distanceLabelItems) {
    const src = item.pageNum ?? OVERVIEW_PAGE_NUM;
    remapPage(src, (box, pageDim, scaleDetail) => {
      const pos = detailPointToOverview(item.x, item.y, box, pageDim, scaleDetail, scaleOverview);
      item.x = pos.x;
      item.y = pos.y;
      item.pageNum = OVERVIEW_PAGE_NUM;
    });
  }

  if (textoItems) {
    for (const item of textoItems) {
      const src = item.pageNum ?? OVERVIEW_PAGE_NUM;
      remapPage(src, (box, pageDim, scaleDetail) => {
        const pos = detailPointToOverview(item.x, item.y, box, pageDim, scaleDetail, scaleOverview);
        item.x = pos.x;
        item.y = pos.y;
        item.pageNum = OVERVIEW_PAGE_NUM;
      });
    }
  }

  const remappedCable = [];
  for (const path of cablePaths) {
    const src = path.pageNum ?? OVERVIEW_PAGE_NUM;
    if (src === OVERVIEW_PAGE_NUM) {
      remappedCable.push(path);
      continue;
    }
    const box = boxByPage.get(src);
    const pageDim = pageDimensions.get(src);
    if (!box || !pageDim) continue;
    const scaleDetail = scaleForPage(src);
    remappedCable.push({
      pageNum: OVERVIEW_PAGE_NUM,
      ops: remapPathOpsToOverview(path.ops, box, pageDim, scaleDetail, scaleOverview),
    });
    remappedPaths++;
  }
  cablePaths.length = 0;
  cablePaths.push(...remappedCable);

  const mergedGrid = [...(utmGridPathsPerPage.get(OVERVIEW_PAGE_NUM) ?? [])];
  for (const src of detailPages) {
    const box = boxByPage.get(src);
    const pageDim = pageDimensions.get(src);
    const paths = utmGridPathsPerPage.get(src);
    if (!box || !pageDim || !paths?.length) continue;
    const scaleDetail = scaleForPage(src);
    for (const pathOps of paths) {
      mergedGrid.push(remapPathOpsToOverview(pathOps, box, pageDim, scaleDetail, scaleOverview));
    }
    utmGridPathsPerPage.delete(src);
  }
  utmGridPathsPerPage.set(OVERVIEW_PAGE_NUM, mergedGrid);

  warnings.push(
    `[overview-composite] Remapped detail pages ${detailPages.join(', ')} → page ${OVERVIEW_PAGE_NUM} ` +
      `(${remappedPoints} points, ${remappedPaths} cable paths, ${viewportBoxes.length} viewports).`
  );
  return true;
}

/**
 * Move post PDF positions into page-2 space using existing per-page UTM transforms (exact round-trip).
 *
 * @param {Array<{ number: number, x: number, y: number, pageNum?: number, anchorX?: number, anchorY?: number }>} posts
 * @param {Map<number, object>} pageTransforms  from buildPageTransforms
 * @param {object} overviewTransform  single page-2 transform
 * @param {string[]} warnings
 * @returns {number} count remapped
 */
export function remapPostsToOverviewViaUtm(posts, pageTransforms, overviewTransform, warnings = []) {
  const tOverview = overviewTransform.get?.(OVERVIEW_PAGE_NUM) ?? overviewTransform;
  if (!tOverview) return 0;

  let n = 0;
  for (const post of posts) {
    const src = post.pageNum ?? OVERVIEW_PAGE_NUM;
    if (src === OVERVIEW_PAGE_NUM) continue;
    const tSrc = pageTransforms.get(src);
    if (!tSrc) continue;
    const utm = utmFromPdfPoint(post.x, post.y, tSrc);
    const pdf = pdfPointFromUtm(utm.easting, utm.northing, tOverview);
    if (!pdf) {
      warnings.push(`[overview-composite] post ${post.number}: UTM→PDF failed on page ${src}.`);
      continue;
    }
    post.x = pdf.x;
    post.y = pdf.y;
    post.anchorX = pdf.x;
    post.anchorY = pdf.y;
    post.detailPageNum = src;
    post.pageNum = OVERVIEW_PAGE_NUM;
    n++;
  }
  if (n > 0) {
    warnings.push(
      `[overview-composite] UTM round-trip remapped ${n} post(s) to page ${OVERVIEW_PAGE_NUM} PDF space.`
    );
  }
  return n;
}

/**
 * Single page-2 UTM transform when all route geometry lives in overview space.
 *
 * @param {{ x: number, y: number, pageNum?: number, lat: number, lon: number }} post1
 * @param {Map<number, { w: number, h: number }>} pageDimensions
 * @param {number} scaleFactor
 * @param {number} zone
 * @param {string[]} [warnings]
 * @param {Map<number, Array<Array>>|null} [utmGridPathsPerPage]
 */
export function buildOverviewCompositeTransform(
  post1,
  pageDimensions,
  scaleFactor,
  zone,
  warnings = [],
  utmGridPathsPerPage = null
) {
  const transforms = new Map();
  const paths = utmGridPathsPerPage?.get(OVERVIEW_PAGE_NUM) ?? [];
  let anchorTheta = 0;
  if (paths.length) {
    anchorTheta = dominantLineOrientation(paths.flat());
  }

  let scale = scaleFactor;
  if (paths.length) {
    const sf = computeScaleFactor(paths, warnings, anchorTheta);
    if (sf != null) scale = sf;
  }
  if (scale == null || scale <= 0) {
    warnings.push('[overview-composite] Cannot build transform: no scale factor.');
    return transforms;
  }

  const { easting: e1, northing: n1 } = latLonToUtm(post1.lat, post1.lon);
  const { rx, ry } = rotatePdfPoint(post1.x, post1.y, anchorTheta);
  transforms.set(OVERVIEW_PAGE_NUM, {
    origin_e: e1 - rx * scale,
    origin_n: n1 + ry * scale,
    x_scale_sf: scale,
    y_scale_sf: scale,
    theta: anchorTheta,
    zone,
  });

  warnings.push(
    `[overview-composite] GPS via single page-${OVERVIEW_PAGE_NUM} transform ` +
      `(scale ${scale.toFixed(6)} m/pt).`
  );
  return transforms;
}
